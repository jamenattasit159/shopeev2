import React from "react";
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Itim";
import { drawPage, post } from "./page.js";

loadFont("normal", { weights: ["400"], subsets: ["thai", "latin"] }); // labels on the props are written in Itim
const W = 1080, H = 1920;

export type ToonProps = {
  shot: string; set: string; seed: number; label?: string;
  state?: Record<string, unknown>; you?: string; pet?: string; noPet?: boolean; product?: number;
};

let photo: HTMLImageElement | null = null;
function usePhoto() {
  const [img, setImg] = React.useState(photo);
  React.useEffect(() => {
    if (img) return;
    const h = delayRender("product photo");
    const el = new Image();
    el.onload = () => { photo = el; setImg(el); continueRender(h); };
    el.onerror = () => continueRender(h);
    el.src = staticFile("product.png");
  }, [img]);
  return img;
}

export const ToonView: React.FC<ToonProps> = (p) => {
  const f = useCurrentFrame();
  const ref = React.useRef<HTMLCanvasElement>(null);
  const scene = React.useMemo(() => Object.assign(document.createElement("canvas"), { width: W, height: H }), []);
  const img = usePhoto();
  React.useLayoutEffect(() => {
    const out = ref.current?.getContext("2d");
    const g = scene.getContext("2d");
    if (!out || !g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    drawPage(g, { ...p, f, photo: img });
    post(out, scene, f);
  }, [f, p, img, scene]);
  return <AbsoluteFill><canvas ref={ref} width={W} height={H} style={{ width: "100%", height: "100%" }} /></AbsoluteFill>;
};
