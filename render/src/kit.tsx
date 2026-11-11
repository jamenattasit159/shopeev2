// Shared building blocks for all scenes.
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, interpolate, random, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from "remotion";

export const INK = "#111";
export const ORANGE = "#EE4D2D";

export type Palette = { light: string; deep: string; pop: string; alt: string };
export const PALETTES: Record<string, Palette> = {
  sky: { light: "#7FD6FF", deep: "#1273C4", pop: "#FFD60A", alt: "#FF5C8A" },
  mint: { light: "#D9FBE8", deep: "#1FA36B", pop: "#FFD60A", alt: "#E11D48" },
  candy: { light: "#FFC2DD", deep: "#E0368C", pop: "#FFF06A", alt: "#3B82F6" },
  sun: { light: "#FFE27A", deep: "#F59E0B", pop: "#FFFFFF", alt: "#E11D48" },
  grape: { light: "#C9B8FF", deep: "#5B3FD6", pop: "#FFD60A", alt: "#22C55E" },
};
export const FONTS = ["Prompt, 'Leelawadee UI', sans-serif", "Kanit, Prompt, 'Leelawadee UI', sans-serif"];

export type Media = { type: "video" | "image"; src: string; startFrom?: number };
export type Beat = {
  scene: string; say: string; text?: string[]; badges?: string[];
  number?: number; unit?: string; from: number; frames: number; audio?: string; media?: Media | null;
};
export type Ctx = {
  seed: number; pal: Palette; font: string; cutout: string | null; images: string[];
  product: { name: string; brand?: string; price?: string; priceBefore?: string; rating?: number; sold?: string };
};

export const useSpr = (delay = 0, cfg = { damping: 11, stiffness: 190, mass: 0.6 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: cfg });
};

// Shrinks font so the longest line always fits the 1080 frame (Thai has no reliable word wrap).
export const fit = (text: string, size: number, maxWidth = 960) =>
  Math.min(size, Math.floor(maxWidth / Math.max(1, [...text].length * 0.6)));

export const Slam: React.FC<{
  at: number; size: number; font: string; color?: string; bg?: string; rot?: number;
  maxWidth?: number; children: string;
}> = ({ at, size, font, color = "#fff", bg, rot = 0, maxWidth = 960, children }) => {
  const frame = useCurrentFrame();
  const s = useSpr(at);
  if (frame < at) return null;
  const fs = fit(children, size, bg ? maxWidth - 110 : maxWidth);
  const stroke = Math.max(6, Math.round(fs / 11));
  return (
    <div style={{
      fontFamily: font, fontWeight: 900, fontSize: fs, lineHeight: 1.15, color, textAlign: "center", whiteSpace: "nowrap",
      transform: `scale(${interpolate(s, [0, 1], [2.4, 1])}) rotate(${rot}deg)`,
      opacity: interpolate(frame - at, [0, 3], [0, 1], { extrapolateRight: "clamp" }),
      ...(bg
        ? { background: bg, padding: "6px 44px 14px", borderRadius: 28, border: `8px solid ${INK}`, boxShadow: `10px 12px 0 ${INK}` }
        : { WebkitTextStroke: `${stroke}px ${INK}`, paintOrder: "stroke fill", textShadow: `0 ${Math.round(stroke * 0.7)}px 0 ${INK}` }),
    }}>{children}</div>
  );
};

export const Col: React.FC<{ top: number; gap?: number; children: React.ReactNode }> = ({ top, gap = 18, children }) => (
  <AbsoluteFill style={{ top, height: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap }}>{children}</AbsoluteFill>
);

export const Sunburst: React.FC<{ from: string; to: string }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 45%, ${from}, ${to})`, overflow: "hidden" }}>
      <div style={{
        position: "absolute", left: -760, top: -340, width: 2600, height: 2600,
        background: "repeating-conic-gradient(rgba(255,255,255,.16) 0 9deg, transparent 9deg 18deg)",
        transform: `rotate(${frame * 0.5}deg)`,
      }} />
    </AbsoluteFill>
  );
};

// Full-bleed footage or photo with punch-in, slow push and optional shake.
export const Backdrop: React.FC<{ media?: Media | null; ctx: Ctx; shakeAt?: number[]; dim?: number; blur?: boolean }> =
  ({ media, ctx, shakeAt = [], dim = 0.35, blur }) => {
    const frame = useCurrentFrame();
    const punch = useSpr(0, { damping: 14, stiffness: 120, mass: 0.7 });
    if (!media) return <Sunburst from={ctx.pal.light} to={ctx.pal.deep} />;
    const scale = interpolate(punch, [0, 1], [1.35, 1.06]) + frame * 0.0012;
    let dx = 0, dy = 0;
    for (const a of shakeAt) {
      const t = frame - a;
      if (t >= 0 && t < 9) { const k = (9 - t) * 3; dx += Math.sin(t * 2.6) * k; dy += Math.cos(t * 3.1) * k; }
    }
    const style: React.CSSProperties = {
      width: "100%", height: "100%", objectFit: "cover",
      transform: `translate(${dx}px,${dy}px) scale(${scale})`, filter: blur ? "blur(18px) brightness(.55)" : undefined,
    };
    return (
      <AbsoluteFill style={{ background: ctx.pal.deep }}>
        {media.type === "video"
          ? <OffthreadVideo src={staticFile(media.src)} startFrom={media.startFrom ?? 0} muted style={style} />
          : <>
            {/* square shop photos: blurred copy fills the frame, sharp copy sits on top */}
            <Img src={staticFile(media.src)} style={{ ...style, filter: "blur(40px) brightness(.8)", transform: "scale(1.3)" }} />
            <Img src={staticFile(media.src)} style={{ ...style, objectFit: "contain" }} />
          </>}
        <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,${dim + 0.3}) 100%)` }} />
      </AbsoluteFill>
    );
  };

// Cut-out product that springs up then floats. Falls back to a framed photo when there is no cutout.
export const Product: React.FC<{ ctx: Ctx; at?: number; width: number; top: number; rot?: number }> = ({ ctx, at = 0, width, top, rot = -5 }) => {
  const frame = useCurrentFrame();
  const s = useSpr(at, { damping: 10, stiffness: 130, mass: 0.8 });
  const float = Math.sin(frame / 9) * 14;
  const src = ctx.cutout ?? ctx.images[0];
  if (!src) return null;
  const framed = !ctx.cutout;
  const w = framed ? width * 0.78 : width;
  return (
    <>
      <div style={{
        position: "absolute", left: (1080 - w * 0.7) / 2, top: top + w * 0.8, width: w * 0.7, height: 70,
        borderRadius: "50%", background: "rgba(0,0,0,.35)", filter: "blur(22px)", opacity: s,
      }} />
      <Img src={staticFile(src)} style={{
        position: "absolute", left: (1080 - w) / 2, top, width: w, maxHeight: w, objectFit: "contain",
        transform: `translateY(${interpolate(s, [0, 1], [1300, float])}px) rotate(${interpolate(s, [0, 1], [-28, rot])}deg)`,
        ...(framed
          ? { borderRadius: 40, border: "14px solid #fff", boxShadow: "0 30px 50px rgba(0,0,0,.35)" }
          : { filter: "drop-shadow(0 24px 30px rgba(0,0,0,.35))" }),
      }} />
    </>
  );
};

export const Sparkles: React.FC<{ seed: number }> = ({ seed }) => {
  const frame = useCurrentFrame();
  return <>{[0, 1, 2, 3].map((i) => {
    const x = 60 + random(`${seed}x${i}`) * 900, y = 380 + random(`${seed}y${i}`) * 1000;
    const k = Math.max(0, Math.sin((frame + i * 7) / 6));
    return <div key={i} style={{
      position: "absolute", left: x, top: y, fontSize: 80 + i * 14, color: "#fff",
      transform: `scale(${k}) rotate(${frame * 3}deg)`, textShadow: "0 0 30px #fff",
    }}>✦</div>;
  })}</>;
};

// Evenly spaces n entrance times across the first 70% of a beat.
export const stagger = (frames: number, n: number, i: number, lead = 2) =>
  Math.round(lead + (frames * 0.7 * i) / Math.max(1, n));
