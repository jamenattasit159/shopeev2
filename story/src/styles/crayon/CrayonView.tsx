import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Itim";
// plain JS engine (MIT, lemo-opuscar)
import { makeComp } from "./engine/gl.js";
import { BOIL, CAM, sx, sy, text, W, H } from "./engine/crayon.js";
import { camOf, drawPage, drawReveal, drawCallout, drawPriceTag, makeLayers, SUBJ, TOP } from "./page.js";
import { EP } from "../../kit/ui";
import { usePublicImage } from "../useImage";

/** handwritten Thai for labels drawn on the page */
const HAND = loadFont("normal", { weights: ["400"], subsets: ["thai", "latin"] }).fontFamily;
const PAPER: [number, number, number] = [0.957, 0.937, 0.89];
const WASH: [number, number, number] = [0.15, 0.19, 0.44]; // ultramarine: the "cold" of the 3D rooms becomes night falling in watercolour

export type CrayonProps = {
  shot: string; set: string; seed: number; label?: string;
  state?: Record<string, unknown>; you?: string; pet?: string; noPet?: boolean;
  /** undefined: the story's own object; a number: the product photo stands there (0..1 = how far it has popped in) */
  product?: number;
  /** short feature labels pointed at the product on the reveal; the price (digits) on the price shot */
  features?: string[]; price?: string;
};

const INK = "#2d3263";
function fitBox(img: HTMLImageElement, w: number, h: number) { const k = Math.min(w / img.width, h / img.height); return [img.width * k, img.height * k]; }

/** the real product standing with its base at (x, y): a cut-out gets a crayon-ink outline round its own edge and two strips
 *  of tape; a plain photo falls back to a taped picture */
function drawProduct(g: CanvasRenderingContext2D, img: HTMLImageElement, cut: boolean, x: number, y: number, boxW: number, boxH: number, tilt: number) {
  const [w, h] = fitBox(img, boxW, boxH);
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  if (cut) {
    const lw = Math.max(4, w * 0.014);
    g.filter = `drop-shadow(${lw}px 0 0 ${INK}) drop-shadow(-${lw}px 0 0 ${INK}) drop-shadow(0 ${lw}px 0 ${INK}) drop-shadow(0 -${lw}px 0 ${INK})`;
    g.drawImage(img, -w / 2, -h, w, h);
    g.filter = "none";
    g.drawImage(img, -w / 2, -h, w, h);
  } else {
    g.fillStyle = "#fbfaf4";
    g.fillRect(-w / 2 - 14, -h - 14, w + 28, h + 28);
    g.drawImage(img, -w / 2, -h, w, h);
  }
  g.fillStyle = "rgba(236,214,150,0.85)"; // two strips of tape hold it to the page
  g.save(); g.translate(-w * 0.42, -h * 0.92); g.rotate(-0.6); g.fillRect(-w * 0.14, -w * 0.035, w * 0.28, w * 0.07); g.restore();
  g.save(); g.translate(w * 0.42, -h * 0.92); g.rotate(0.6); g.fillRect(-w * 0.14, -w * 0.035, w * 0.28, w * 0.07); g.restore();
  g.restore();
}

export const CrayonView: React.FC<CrayonProps> = (p) => {
  const frame = useCurrentFrame();
  const ref = React.useRef<HTMLCanvasElement>(null);
  const L = React.useMemo(() => makeLayers(), []);
  const comp = React.useRef<ReturnType<typeof makeComp> | null>(null);
  const photo = usePublicImage("product.png");
  const cutout = usePublicImage("cutout.png"); // background removed by the clip pipeline, when it passed its check
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    comp.current ??= makeComp(ref.current, W, H);
    const C = comp.current;
    BOIL.step = Math.floor((frame / 30) * 12); // everything drawn steps at 12 fps
    BOIL.amp = 1;
    const reveal = p.shot === "product" || p.shot === "product-open" || p.shot === "price";
    const showPhoto = p.product !== undefined || Boolean(p.state?.product);
    const img = cutout ?? photo;
    if (reveal) {
      // a fresh page: the product, big, on a scribbled burst, its name written above
      [CAM.x, CAM.y, CAM.s] = [540, 960, 1 + 0.0012 * frame];
      drawReveal(L, frame);
      if (EP.next?.ep && frame > 8) text(L.FX, EP.next.ep, 540, 290, { size: 96, font: HAND, seed: 9, p: 1, reveal: Math.min(1, (frame - 8) / 10) });
      if (p.shot === "price") {
        if (p.price) { drawPriceTag(L, frame); text(L.OVER, "฿" + p.price, 770, 1030, { size: 100, font: HAND, seed: 13, p: 1, col: "#fbfaf4", reveal: Math.min(1, Math.max(0, (frame - 14) / 8)) }); }
      } else {
        (p.features ?? []).forEach((t, i) => { if (drawCallout(L, i, frame)) text(L.OVER, t, i % 2 === 0 ? 170 : 910, ([560, 820, 1040][i] ?? 560) + 14, { size: 46, font: HAND, seed: 20 + i, p: 1, reveal: Math.min(1, (frame - 16 - i * 10) / 8) }); });
      }
      const pop = Math.min(1, (p.product ?? 1) * 1.15);
      if (img) drawProduct(L.PHOTO.g!, img, Boolean(cutout), 540, 1180, 500 * (0.45 + 0.55 * pop), 680 * (0.45 + 0.55 * pop), -0.03); // base above the caption band
    } else {
      [CAM.x, CAM.y, CAM.s] = camOf(p.shot, frame);
      drawPage(L, { set: p.set, state: p.state, you: showPhoto && (!p.you || p.you === "rest") ? "relief" : p.you, pet: p.pet, noPet: p.noPet, seed: p.seed, label: p.label, product: showPhoto ? 1 : undefined });
      for (const t of L.labels as { text: string; x: number; y: number; size: number }[]) {
        text(L.FX, t.text, sx(t.x), sy(t.y) + t.size * 0.35 * CAM.s, { size: t.size * CAM.s, font: HAND, seed: 7, p: 0.95 });
      }
      // on the counter where the story's object stood, sized like a real thing, clear of your face
      if (showPhoto && img) drawProduct(L.PHOTO.g!, img, Boolean(cutout), sx(SUBJ[0] - 60), sy(TOP + 6), 340 * CAM.s, 420 * CAM.s, -0.02);
    }
    C.paperCam(CAM.x * 0.6, CAM.y * 0.6, CAM.s / 0.6);
    C.begin(PAPER);
    C.crayon(L.BG.f.c); C.crayon(L.BG.l.c);
    const go = [(BOIL.step % 7) * 40, (BOIL.step % 5) * 60];
    C.group(L.PEOPLE, { goff: go });
    C.group(L.PROPS, { goff: go });
    C.group(L.FRONT);
    C.crayon(L.FX.c, { goff: go });
    if (p.state?.cold) C.wash(L.WASH.c, { color: WASH });
    C.group(L.PET, { goff: go }); // after the wash: the cat stays readable at night
    C.image(L.PHOTO.c);
    C.crayon(L.OVER.c, { goff: go }); // labels, arrows and the price tag sit on top of the product
    C.finish({ vig: 0.3 });
  }, [frame, p, L, photo, cutout]);
  return <AbsoluteFill><canvas ref={ref} width={W} height={H} style={{ width: "100%", height: "100%" }} /></AbsoluteFill>;
};
