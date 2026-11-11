// one-off: voice the ad episode with the studio's own voice module (story-tense tone)
import fs from "node:fs";
const studio = "file:///D:/งานที่ให้ AI ทำ/motion/studio/";
for (const f of [".env", ".env.local"]) {
  try { for (const l of fs.readFileSync(new URL(f, studio), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)="?(.*?)"?$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; } } catch {}
}
const { voiceEpisode } = await import(studio + "voice.mjs");
const { stylePrompt, polishFilter } = await import(studio + "presets.mjs");
await voiceEpisode(process.argv[2], { voice: process.env.VOICE_ID, style: stylePrompt("story-tense", "mid"), maxLen: 450, polish: polishFilter("story-tense") }, (l) => console.log(l));
