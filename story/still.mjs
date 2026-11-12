// Renders single frames of a composition (cover, custom-model check, library check).
//   node still.mjs <composition> <frame>:<outFile> [<frame>:<outFile> ...]      frame "last" = the last frame
// Reads the job that is currently staged in src/. Prints one JSON line: {"ok": [files]}
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";

const [id, ...jobs] = process.argv.slice(2);
if (!id || !jobs.length) { console.error("usage: node still.mjs <composition> <frame>:<out> ..."); process.exit(2); }
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const chromiumOptions = { gl: "angle" };
const composition = await selectComposition({ serveUrl, id, chromiumOptions });
const ok = [];
for (const job of jobs) {
  const cut = job.indexOf(":");
  const out = job.slice(cut + 1);
  const frame = Math.min(composition.durationInFrames - 1, job.slice(0, cut) === "last" ? Infinity : Math.max(0, Number(job.slice(0, cut)) || 0));
  const png = /\.png$/i.test(out); // the renderer refuses a jpeg quality on png output
  await renderStill({ composition, serveUrl, frame, output: path.resolve(out), imageFormat: png ? "png" : "jpeg", ...(png ? {} : { jpegQuality: 90 }), chromiumOptions });
  ok.push(out);
}
console.log(JSON.stringify({ ok }));
