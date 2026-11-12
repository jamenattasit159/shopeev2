import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Itim";
import { EP } from "../../kit/ui";
import { usePublicImage } from "../useImage";
import { drawPage, post } from "./page.js";

loadFont("normal", { weights: ["400"], subsets: ["thai", "latin"] }); // labels and the title card are written in Itim
const W = 1080, H = 1920;

export type ToonProps = {
  shot: string; set: string; seed: number; label?: string;
  state?: Record<string, unknown>; you?: string; pet?: string; noPet?: boolean; product?: number;
  /** short feature labels pointed at the product on the reveal; the price (digits) on the price shot */
  features?: string[]; price?: string;
};

export const ToonView: React.FC<ToonProps> = (p) => {
  const f = useCurrentFrame();
  const ref = React.useRef<HTMLCanvasElement>(null);
  const scene = React.useMemo(() => Object.assign(document.createElement("canvas"), { width: W, height: H }), []);
  const photo = usePublicImage("product.png");
  const cutout = usePublicImage("cutout.png"); // background removed by the clip pipeline, when it passed its check
  React.useLayoutEffect(() => {
    const out = ref.current?.getContext("2d");
    const g = scene.getContext("2d");
    if (!out || !g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    drawPage(g, { ...p, f, photo, cutout, brand: EP.next?.ep });
    post(out, scene, f);
  }, [f, p, photo, cutout, scene]);
  return <AbsoluteFill><canvas ref={ref} width={W} height={H} style={{ width: "100%", height: "100%" }} /></AbsoluteFill>;
};
