// Background removal, same library V1 used. Runs locally.
//   node cutout.mjs <in.png> <out.png>
// Prints "ok ..." and exits 0 when the cutout is usable; prints "reject ..." and exits 3 when it is
// not (typical for infographic-style shop photos), so the caller falls back to a framed photo.
import { removeBackground } from "@imgly/background-removal-node";
import { execFileSync } from "child_process";
import fs from "fs";
import { pathToFileURL } from "url";

const [, , input, output] = process.argv;
const N = 256;
const tmp = output + ".full.png";
const blob = await removeBackground(pathToFileURL(input).href);
fs.writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));

// The library may write a paletted PNG, so force RGBA before reading the alpha plane.
const alpha = execFileSync("ffmpeg", ["-v", "error", "-i", tmp, "-vf", `format=rgba,alphaextract,format=gray,scale=${N}:${N}:flags=area`, "-f", "rawvideo", "-"]);
let solid = 0, soft = 0;
const rows = new Array(N).fill(0);
for (let i = 0; i < alpha.length; i++) {
  if (alpha[i] > 12) { rows[(i / N) | 0]++; alpha[i] < 230 ? soft++ : solid++; }
}
const cover = (solid + soft) / alpha.length;
const softShare = soft / Math.max(1, solid + soft);
// A real product has crisp edges. Measured on three shop photos: product 0.32, infographics 0.71 and 0.81.
// shortcut: threshold from 3 samples only; revisit if good cutouts get rejected or bad ones pass.
if (cover < 0.08 || cover > 0.85 || softShare > 0.5) {
  fs.rmSync(tmp, { force: true });
  console.log(`reject cover=${cover.toFixed(2)} soft=${softShare.toFixed(2)}`);
  process.exitCode = 3;
} else {
  // Keep only the tallest block of rows: drops headline text the shop baked in above or below the product.
  let best = [0, 0], start = -1;
  for (let y = 0; y <= N; y++) {
    const filled = y < N && rows[y] > N * 0.01;
    if (filled && start < 0) start = y;
    if (!filled && start >= 0) { if (y - start > best[1] - best[0]) best = [start, y]; start = -1; }
  }
  let x0 = N, x1 = 0;
  for (let y = best[0]; y < best[1]; y++) for (let x = 0; x < N; x++) if (alpha[y * N + x] > 12) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); }
  const f = (v) => `${(v / N).toFixed(4)}`;
  const crop = `format=rgba,crop=iw*${f(x1 - x0)}:ih*${f(best[1] - best[0])}:iw*${f(x0)}:ih*${f(best[0])}`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-vf", crop, output]);
  fs.rmSync(tmp, { force: true });
  console.log(`ok cover=${cover.toFixed(2)} soft=${softShare.toFixed(2)}`);
}
