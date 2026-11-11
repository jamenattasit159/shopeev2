// Voiceover, ported from V1 (src/lib/tts.ts + audioPolish.ts).
// Fixed to the one style the owner uses: "เร่งปิดการขาย" (flash-close) at high intensity on gemini-3.8-flash-tts.
//   tsx tts.ts <request.json>   request = { lines: string[], voice: string, outDir: string, cacheDir: string }
//   tsx tts.ts --voices         prints replicated (cloned) voices as JSON
// Needs GEMINI_API_KEY in the environment. Prints one JSON line on stdout.
import { GoogleGenAI } from "@google/genai";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

process.chdir(path.dirname(fileURLToPath(import.meta.url))); // speechText reads ./data/pronunciation-map.json
const { normalizeForSpeech } = await import("./speechText.ts");

const MODEL = "gemini-3.8-flash-tts";
const STYLE = "ชัดเจนมั่นใจ เร่งจังหวะเล็กน้อย ชวนกดตะกร้าส้มทันที จัดเต็มขึ้นอีกนิด ชัดเจน";
// flash-close polish: atempo 1.08, compressor, +3dB presence, -14 LUFS. Silence trimmed so cuts stay tight.
const TRIM = "silenceremove=start_periods=1:start_threshold=-45dB";
const POLISH = [
  TRIM, "areverse", TRIM, "areverse", "highpass=f=80", "acompressor=threshold=-18dB:ratio=3:attack=5:release=80",
  "equalizer=f=3000:t=q:w=1:g=3", "atempo=1.08", "loudnorm=I=-14:TP=-1.5:LRA=11",
].join(",");

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY is not set"); process.exit(2); }
const ai = new GoogleGenAI({ apiKey });

if (process.argv[2] === "--voices") {
  const res: any = await (ai as any).voices.list({ type: ["replicated"] });
  console.log(JSON.stringify((res.voices || []).map((v: any) => ({ id: v.id, name: v.display_name || v.displayName || v.id }))));
} else {
  await run();
}

async function run() {

const req = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
fs.mkdirSync(req.outDir, { recursive: true });
fs.mkdirSync(req.cacheDir, { recursive: true });

async function synth(text: string, raw: string) {
  const spoken = normalizeForSpeech(text.trim()).textForSpeech || text.trim();
  const res: any = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: spoken, speechMetadata: { style: STYLE } } as any] }],
    config: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: req.voice } } } as any,
  });
  const part = res.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!part?.data) throw new Error("Gemini TTS returned no audio");
  const buf = Buffer.from(part.data, "base64");
  fs.writeFileSync(raw, buf);
  // V1 saved this straight to .wav; guard in case the API hands back headerless PCM instead.
  return buf.subarray(0, 4).toString() === "RIFF" ? [] : ["-f", "s16le", "-ar", "24000", "-ac", "1"];
}

const out: { file: string; seconds: number }[] = [];
for (let i = 0; i < req.lines.length; i++) {
  const text: string = req.lines[i];
  const key = createHash("sha1").update([MODEL, req.voice, STYLE, POLISH, text].join("|")).digest("hex");
  const cached = path.join(req.cacheDir, key + ".wav");
  if (!fs.existsSync(cached)) {
    const raw = path.join(req.cacheDir, key + ".raw");
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fmt = await synth(text, raw);
        execFileSync("ffmpeg", ["-v", "error", "-y", ...fmt, "-i", raw, "-af", POLISH, "-ar", "48000", "-ac", "1", cached + ".tmp.wav"]);
        fs.renameSync(cached + ".tmp.wav", cached);
        lastErr = undefined;
        break;
      } catch (e) { lastErr = e; }
    }
    fs.rmSync(raw, { force: true });
    if (lastErr) throw new Error(`line ${i}: ${(lastErr as Error).message}`);
  }
  const file = path.join(req.outDir, `${i}.wav`);
  fs.copyFileSync(cached, file);
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
  out.push({ file: `${i}.wav`, seconds });
}
console.log(JSON.stringify(out));
}
