// Renders the film one SCENE at a time, so a single scene can be redone without touching the others.
//   node render-scenes.mjs <outDir> [scene numbers, 1-based ...]     no numbers = every scene
// Reads src/lines.json + src/film.json (copied in for the current job). Writes <outDir>/seg_NN.mp4 (+ seg_NN.jpg thumbnail)
// and prints one JSON line: [{scene, file, thumb, start, seconds}]
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";

const [outDir, ...picked] = process.argv.slice(2);
if (!outDir) { console.error("usage: node render-scenes.mjs <outDir> [scene ...]"); process.exit(2); }
const FPS = 30;
const lines = JSON.parse(fs.readFileSync("src/lines.json", "utf8"));
const film = JSON.parse(fs.readFileSync("src/film.json", "utf8"));
// same arithmetic as sceneSpan() in src/Film.tsx
const dur = Math.round(Math.round((lines.total + 2.6) * 10) / 10 * FPS);
const fr = (s) => Math.round(s * FPS);
const T = (i) => lines.lines[film.scenes[i].line - 1].t - 0.1;
const span = (i) => [i === 0 ? 0 : fr(T(i)), i === film.scenes.length - 1 ? dur : fr(T(i + 1))];

fs.mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const chromiumOptions = { gl: "angle" };
const composition = await selectComposition({ serveUrl, id: "Film", chromiumOptions });
const want = picked.length ? picked.map(Number) : film.scenes.map((_, i) => i + 1);
const done = [];
for (const n of want) {
  const i = n - 1;
  if (!film.scenes[i]) { console.error(`no scene ${n}`); process.exit(2); }
  const [a, b] = span(i);
  const name = `seg_${String(n).padStart(2, "0")}`;
  const file = path.join(outDir, name + ".mp4");
  // write to a temp name first: a crash mid-render must not leave a broken segment in place of a good one
  await renderMedia({ composition, serveUrl, codec: "h264", crf: 20, frameRange: [a, b - 1], outputLocation: file + ".tmp.mp4", chromiumOptions, concurrency: 2 });
  fs.renameSync(file + ".tmp.mp4", file);
  await renderStill({ composition, serveUrl, frame: Math.floor((a + b) / 2), output: path.join(outDir, name + ".jpg"), imageFormat: "jpeg", scale: 0.33, chromiumOptions });
  done.push({ scene: n, file: name + ".mp4", thumb: name + ".jpg", start: a / FPS, seconds: (b - a) / FPS });
  process.stderr.write(`scene ${n} ok\n`);
}
console.log(JSON.stringify(done));
