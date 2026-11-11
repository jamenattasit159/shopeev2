// Voices a story job in ONE take with the cloned voice (same method as MotionStudio's voice.mjs, story-tense tone).
//   node voice.mjs <jobStoryDir> <voiceId>      needs GEMINI_API_KEY; reads script.md, writes vo/own.wav + vo/takeA.mp3
// Finished chunks are cached in vo/tts, so a rerun after a quota stop only sends what is missing.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// the SDK is already installed for the clip renderer; no second copy
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../render/package.json"));
const { GoogleGenAI } = require("@google/genai");

const [dir, voice] = process.argv.slice(2);
const MODEL = "gemini-3.8-flash-tts";
const STYLE = "เล่าเรื่องระทึก จังหวะกระชับ น้ำเสียงตึงเครียด เน้นคำว่าอย่าและห้ามให้หนักแน่น";
const POLISH = "highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,equalizer=f=3000:t=q:w=1:g=3,atempo=1.04,loudnorm=I=-14:TP=-1.5:LRA=11";
const MAX = 450, GAP_MS = 12000;

const md = fs.readFileSync(path.join(dir, "script.md"), "utf8");
const text = (md.match(/```\n([\s\S]*?)\n```/)?.[1] ?? "").replace(/\s+/g, " ").trim();
if (!text) { console.error("script.md has no narration block"); process.exit(2); }
// split at spaces (sentence gaps) into pieces the model handles well
const parts = [];
for (const s of text.split(" ")) {
  if (parts.length && (parts.at(-1) + " " + s).length <= MAX) parts[parts.length - 1] += " " + s; else parts.push(s);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
async function synth(t) {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: t, speechMetadata: { style: STYLE } }] }],
    config: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice } } },
  });
  const d = res.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!d?.data) throw new Error("Gemini returned no audio");
  const buf = Buffer.from(d.data, "base64");
  return /L16|pcm/i.test(d.mimeType || "") ? wav(buf, Number(d.mimeType.match(/rate=(\d+)/)?.[1] || 24000)) : buf;
}

const cache = path.join(dir, "vo", "tts");
fs.mkdirSync(cache, { recursive: true });
const files = [];
let sent = 0;
for (const t of parts) {
  const f = path.join(cache, crypto.createHash("sha256").update(`${voice}|${STYLE}|${t}`).digest("hex").slice(0, 24) + ".wav");
  files.push(f);
  if (fs.existsSync(f) && fs.statSync(f).size > 0) continue;
  if (sent++) await sleep(GAP_MS); // stay under the per-minute limit
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.writeFileSync(f, await synth(t)); last = undefined; break; } catch (e) { last = e; await sleep(15000 * (attempt + 1)); }
  }
  if (last) throw last;
}
const vo = path.join(dir, "vo");
const filter = files.map((_, i) => `[${i}:a]`).join("") + `concat=n=${files.length}:v=0:a=1,${POLISH}`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", filter, "-ar", "24000", "-ac", "1", path.join(vo, "own.wav")]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(vo, "own.wav"), "-b:a", "192k", path.join(vo, "takeA.mp3")]);
console.log(JSON.stringify({ chunks: files.length }));
