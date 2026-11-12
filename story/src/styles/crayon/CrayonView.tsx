import React from "react";
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Itim";
// plain JS engine (MIT, lemo-opuscar)
import { makeComp } from "./engine/gl.js";
import { BOIL, CAM, sx, sy, text, W, H } from "./engine/crayon.js";
import { camOf, drawPage, makeLayers, SUBJ, TOP } from "./page.js";

/** handwritten Thai for labels drawn on the page */
const HAND = loadFont("normal", { weights: ["400"], subsets: ["thai", "latin"] }).fontFamily;
const PAPER: [number, number, number] = [0.957, 0.937, 0.89];
const WASH: [number, number, number] = [0.15, 0.19, 0.44]; // ultramarine: the "cold" of the 3D rooms becomes night falling in watercolour

export type CrayonProps = {
  shot: string; set: string; seed: number; label?: string;
  state?: Record<string, unknown>; you?: string; pet?: string; noPet?: boolean;
  /** undefined: the story's own object; a number: the product photo stands there (0..1 = how far it has popped in) */
  product?: number;
};

const photos = new Map<string, HTMLImageElement>();
function usePhoto(src: string) {
  const [img, setImg] = React.useState<HTMLImageElement | null>(photos.get(src) ?? null);
  React.useEffect(() => {
    if (img) return;
    const h = delayRender(`photo ${src}`);
    const el = new Image();
    el.onload = () => { photos.set(src, el); setImg(el); continueRender(h); };
    el.onerror = () => continueRender(h); // no photo: the subject is drawn instead
    el.src = staticFile(src);
  }, [img, src]);
  return img;
}

/** the real product photo taped onto the page where the story's object stood */
function tapePhoto(g: CanvasRenderingContext2D, img: HTMLImageElement, pop: number) {
  const size = 300 * CAM.s * (0.6 + 0.4 * pop), x = sx(SUBJ[0]), y = sy(TOP - 170);
  g.save();
  g.translate(x, y);
  g.rotate(-0.06);
  g.fillStyle = "#fbfaf4";
  g.fillRect(-size / 2 - 14, -size / 2 - 14, size + 28, size + 28);
  g.drawImage(img, -size / 2, -size / 2, size, size);
  g.fillStyle = "rgba(236,214,150,0.85)"; // two strips of tape
  g.rotate(0.5); g.fillRect(-size * 0.62, -size * 0.6, size * 0.34, size * 0.1);
  g.rotate(-1.0); g.fillRect(size * 0.3, -size * 0.36, size * 0.34, size * 0.1);
  g.restore();
}

export const CrayonView: React.FC<CrayonProps> = (p) => {
  const frame = useCurrentFrame();
  const ref = React.useRef<HTMLCanvasElement>(null);
  const L = React.useMemo(() => makeLayers(), []);
  const comp = React.useRef<ReturnType<typeof makeComp> | null>(null);
  const photo = usePhoto("product.png");
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    comp.current ??= makeComp(ref.current, W, H);
    const C = comp.current;
    BOIL.step = Math.floor((frame / 30) * 12); // everything drawn steps at 12 fps
    BOIL.amp = 1;
    [CAM.x, CAM.y, CAM.s] = camOf(p.shot, frame);
    const showPhoto = p.product !== undefined || Boolean(p.state?.product);
    drawPage(L, { set: p.set, state: p.state, you: p.you, pet: p.pet, noPet: p.noPet, seed: p.seed, label: p.label, product: showPhoto ? 1 : undefined });
    for (const t of L.labels as { text: string; x: number; y: number; size: number }[]) {
      text(L.FX, t.text, sx(t.x), sy(t.y) + t.size * 0.35 * CAM.s, { size: t.size * CAM.s, font: HAND, seed: 7, p: 0.95 });
    }
    if (showPhoto && photo) tapePhoto(L.PHOTO.g!, photo, Math.min(1, p.product ?? 1));
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
    C.finish({ vig: 0.3 });
  }, [frame, p, L, photo]);
  return <AbsoluteFill><canvas ref={ref} width={W} height={H} style={{ width: "100%", height: "100%" }} /></AbsoluteFill>;
};
