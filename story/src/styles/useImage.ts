import React from "react";
import { continueRender, delayRender, staticFile } from "remotion";

const cache = new Map<string, HTMLImageElement | null>();

/** an image from public/, held until loaded so no frame renders without it; null when the job has none (e.g. no cutout) */
export function usePublicImage(name: string): HTMLImageElement | null {
  const [img, setImg] = React.useState<HTMLImageElement | null>(cache.get(name) ?? null);
  React.useEffect(() => {
    if (cache.has(name)) return setImg(cache.get(name) ?? null);
    const h = delayRender(`image ${name}`);
    const el = new Image();
    el.onload = () => { cache.set(name, el); setImg(el); continueRender(h); };
    el.onerror = () => { cache.set(name, null); continueRender(h); };
    el.src = staticFile(name);
  }, [name]);
  return img;
}
