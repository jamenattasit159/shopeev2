// THROWAWAY spike: "wow" style test. Timings are hand-set to the V1 voice track.
import React from "react";
import {
  AbsoluteFill, Audio, Composition, Img, OffthreadVideo, Sequence,
  interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";

const FONT = "Prompt, 'Leelawadee UI', sans-serif";
const YELLOW = "#FFD60A", ORANGE = "#EE4D2D", INK = "#111";
const CUTS = [0, 103, 189, 243, 333, 426, 458, 513, 594];

const useSpring = (delay = 0, cfg = { damping: 11, stiffness: 190, mass: 0.6 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: cfg });
};

// Text that slams in from oversized, with thick outline.
const Slam: React.FC<{
  at: number; size: number; color?: string; bg?: string; rot?: number;
  stroke?: number; children: React.ReactNode; style?: React.CSSProperties;
}> = ({ at, size, color = "#fff", bg, rot = 0, stroke = 14, children, style }) => {
  const frame = useCurrentFrame();
  const s = useSpring(at);
  if (frame < at) return null;
  return (
    <div style={{
      fontFamily: FONT, fontWeight: 900, fontSize: size, lineHeight: 1.15, color,
      textAlign: "center", whiteSpace: "nowrap",
      transform: `scale(${interpolate(s, [0, 1], [2.4, 1])}) rotate(${rot}deg)`,
      opacity: interpolate(frame - at, [0, 3], [0, 1], { extrapolateRight: "clamp" }),
      ...(bg
        ? { background: bg, padding: "6px 44px 14px", borderRadius: 28, border: `8px solid ${INK}`, boxShadow: `10px 12px 0 ${INK}` }
        : { WebkitTextStroke: `${stroke}px ${INK}`, paintOrder: "stroke fill", textShadow: `0 10px 0 ${INK}` }),
      ...style,
    }}>{children}</div>
  );
};

const Col: React.FC<{ top: number; gap?: number; children: React.ReactNode }> = ({ top, gap = 18, children }) => (
  <AbsoluteFill style={{ top, height: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap }}>{children}</AbsoluteFill>
);

// Footage with a punch-in at the start and slow push after; shakes on given frames.
const Clip: React.FC<{ src: string; startFrom?: number; shakeAt?: number[]; dim?: number }> = ({ src, startFrom = 0, shakeAt = [], dim = 0.35 }) => {
  const frame = useCurrentFrame();
  const punch = useSpring(0, { damping: 14, stiffness: 120, mass: 0.7 });
  const scale = interpolate(punch, [0, 1], [1.35, 1.06]) + frame * 0.0012;
  let dx = 0, dy = 0;
  for (const a of shakeAt) {
    const t = frame - a;
    if (t >= 0 && t < 9) { const k = (9 - t) * 3; dx += Math.sin(t * 2.6) * k; dy += Math.cos(t * 3.1) * k; }
  }
  return (
    <AbsoluteFill>
      <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `translate(${dx}px,${dy}px) scale(${scale})` }} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,${dim + 0.3}) 100%)` }} />
    </AbsoluteFill>
  );
};

const Sunburst: React.FC<{ from: string; to: string }> = ({ from, to }) => {
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

// Cut-out product: springs up, then floats.
const Product: React.FC<{ at?: number; width: number; top: number; rot?: number }> = ({ at = 0, width, top, rot = -5 }) => {
  const frame = useCurrentFrame();
  const s = useSpring(at, { damping: 10, stiffness: 130, mass: 0.8 });
  const float = Math.sin(frame / 9) * 14;
  return (
    <>
      <div style={{
        position: "absolute", left: (1080 - width * 0.7) / 2, top: top + width * 0.78, width: width * 0.7, height: 70,
        borderRadius: "50%", background: "rgba(0,0,0,.35)", filter: "blur(22px)", opacity: s, transform: `scale(${1 - float / 200})`,
      }} />
      <Img src={staticFile("cut.png")} style={{
        position: "absolute", left: (1080 - width) / 2, top, width,
        transform: `translateY(${interpolate(s, [0, 1], [1300, float])}px) rotate(${interpolate(s, [0, 1], [-28, rot])}deg)`,
        filter: "drop-shadow(0 24px 30px rgba(0,0,0,.35))",
      }} />
    </>
  );
};

const Sparkle: React.FC<{ x: number; y: number; size: number; phase: number }> = ({ x, y, size, phase }) => {
  const frame = useCurrentFrame();
  const k = Math.max(0, Math.sin((frame + phase) / 6));
  return <div style={{ position: "absolute", left: x, top: y, fontSize: size, color: "#fff", transform: `scale(${k}) rotate(${frame * 3}deg)`, textShadow: "0 0 30px #fff" }}>✦</div>;
};

const Hook = () => (
  <AbsoluteFill>
    <Clip src="a_pull.mp4" shakeAt={[62]} />
    <Col top={1020}>
      <Slam at={3} size={78} bg="#fff" color={INK} rot={-2}>คุณแม่ที่กำลังมองหา</Slam>
      <Slam at={36} size={170}>ทิชชู่เปียก</Slam>
      <Slam at={62} size={112} bg={YELLOW} color={INK} rot={-3}>ให้ลูกผิวแพ้ง่าย?</Slam>
    </Col>
  </AbsoluteFill>
);

const Hero = () => {
  const s = useSpring(2);
  return (
    <AbsoluteFill>
      <Sunburst from="#7FD6FF" to="#1273C4" />
      <div style={{
        position: "absolute", top: 250, width: "100%", textAlign: "center", fontFamily: FONT, fontWeight: 900,
        fontSize: 330, lineHeight: 0.92, color: "#fff", letterSpacing: -8,
        transform: `scale(${interpolate(s, [0, 1], [0.5, 1])})`, textShadow: "0 14px 0 rgba(0,0,0,.18)",
      }}>DODO<br />LOVE</div>
      <Product at={4} width={1000} top={560} />
      <Sparkle x={110} y={560} size={110} phase={0} />
      <Sparkle x={860} y={470} size={80} phase={11} />
      <Sparkle x={800} y={1330} size={120} phase={5} />
      <Col top={1420}>
        <Slam at={38} size={124} bg={YELLOW} color={INK} rot={-4}>ต้องมีติดบ้าน!</Slam>
      </Col>
    </AbsoluteFill>
  );
};

const Stretch = () => (
  <AbsoluteFill>
    <Clip src="a_stretch.mp4" shakeAt={[7]} />
    <Col top={1080}>
      <Slam at={7} size={190} color={YELLOW}>เหนียวนุ่ม</Slam>
      <Slam at={30} size={104} bg="#22C55E" rot={3}>ออร์แกนิค</Slam>
    </Col>
  </AbsoluteFill>
);

const TILES = [
  { at: 33, emoji: "👶", word: "หน้า", bg: "#FF8FB1" },
  { at: 48, emoji: "👄", word: "ปาก", bg: "#FFD60A" },
  { at: 63, emoji: "🍑", word: "ก้น", bg: "#7FD6FF" },
  { at: 75, emoji: "✋", word: "มือ", bg: "#86EFAC" },
];
const Tile: React.FC<{ i: number }> = ({ i }) => {
  const t = TILES[i];
  const frame = useCurrentFrame();
  const s = useSpring(t.at, { damping: 9, stiffness: 220, mass: 0.5 });
  if (frame < t.at) return <div style={{ width: 480, height: 560 }} />;
  return (
    <div style={{
      boxSizing: "border-box", width: 480, height: 560, borderRadius: 48, background: t.bg, border: `10px solid ${INK}`, boxShadow: `12px 14px 0 ${INK}`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      transform: `scale(${s}) rotate(${(i % 2 ? 1 : -1) * 2.5}deg)`,
    }}>
      <div style={{ fontSize: 230, lineHeight: 1.1 }}>{t.emoji}</div>
      <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: 150, color: INK, lineHeight: 1.1 }}>{t.word}</div>
    </div>
  );
};
const Grid = () => (
  <AbsoluteFill>
    <AbsoluteFill style={{ filter: "blur(18px) brightness(.55)", transform: "scale(1.15)" }}><Clip src="b_pan.mp4" dim={0} /></AbsoluteFill>
    <Col top={170}><Slam at={2} size={150}>เช็ดได้ทั้ง...</Slam></Col>
    <AbsoluteFill style={{ top: 470, height: "auto", display: "flex", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 40, padding: "0 30px" }}>
      {TILES.map((_, i) => <Tile key={i} i={i} />)}
    </AbsoluteFill>
  </AbsoluteFill>
);

const Stamp: React.FC<{ at: number; x: number; y: number; rot: number; label: string }> = ({ at, x, y, rot, label }) => {
  const frame = useCurrentFrame();
  const s = useSpring(at, { damping: 12, stiffness: 260, mass: 0.5 });
  if (frame < at) return null;
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: 430, height: 430, borderRadius: "50%", background: "#fff",
      border: "16px solid #E11D48", outline: "6px solid #fff", color: "#E11D48", fontFamily: FONT, fontWeight: 900,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1,
      transform: `scale(${interpolate(s, [0, 1], [3, 1])}) rotate(${rot}deg)`, boxShadow: "0 20px 40px rgba(0,0,0,.3)",
    }}>
      <div style={{ fontSize: 190 }}>0%</div>
      <div style={{ fontSize: 66, marginTop: 8 }}>{label}</div>
    </div>
  );
};
const Safe = () => (
  <AbsoluteFill>
    <Sunburst from="#D9FBE8" to="#34B27B" />
    <Col top={170}><Slam at={2} size={210}>ปลอดภัย</Slam></Col>
    <Product at={0} width={900} top={520} rot={4} />
    <Stamp at={38} x={40} y={1180} rot={-12} label="แอลกอฮอล์" />
    <Stamp at={66} x={600} y={1290} rot={9} label="สารเคมี" />
  </AbsoluteFill>
);

const Three = () => {
  const frame = useCurrentFrame();
  const step = Math.min(2, Math.floor(frame / 10));
  const origins = ["30% 66%", "42% 72%", "54% 64%"];
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <Img src={staticFile("i2.png")} style={{
        position: "absolute", top: 330, width: 1080, transformOrigin: origins[step],
        transform: `scale(${1.55 + (frame % 10) * 0.02})`,
      }} />
      <Col top={1330}><Slam at={1} size={230} color={YELLOW}>3 สูตร</Slam></Col>
    </AbsoluteFill>
  );
};

const Count = () => {
  const frame = useCurrentFrame();
  const n = Math.round(interpolate(frame, [2, 20], [0, 80], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const pop = useSpring(20, { damping: 8, stiffness: 240, mass: 0.5 });
  return (
    <AbsoluteFill>
      <Clip src="b_pan.mp4" startFrom={85} shakeAt={[20]} dim={0.5} />
      <Col top={640} gap={0}>
        <Slam at={0} size={110} bg="#fff" color={INK} rot={-3}>ห่อใหญ่</Slam>
        <div style={{
          fontFamily: FONT, fontWeight: 900, fontSize: 520, lineHeight: 1, color: YELLOW,
          WebkitTextStroke: `22px ${INK}`, paintOrder: "stroke fill", textShadow: `0 16px 0 ${INK}`,
          transform: `scale(${interpolate(pop, [0, 1], [1, 1.12])})`,
        }}>{n}</div>
        <Slam at={4} size={150}>แผ่น</Slam>
        <div style={{ height: 30 }} />
        <Slam at={31} size={130} bg="#E11D48" rot={-5}>คุ้มมาก!</Slam>
      </Col>
    </AbsoluteFill>
  );
};

const Cta = () => {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 3.5) * 0.05;
  const bounce = Math.abs(Math.sin(frame / 5)) * 40;
  return (
    <AbsoluteFill>
      <Sunburst from="#FF8A5C" to={ORANGE} />
      <Col top={190} gap={10}>
        <Slam at={2} size={110} bg="#fff" color={ORANGE} rot={-3}>พิกัดอยู่ที่</Slam>
        <Slam at={10} size={190}>ตะกร้าส้ม</Slam>
      </Col>
      <Product at={4} width={900} top={600} />
      <div style={{
        position: "absolute", left: 190, top: 1370, padding: "22px 70px 30px", borderRadius: 999, background: "#fff",
        border: `10px solid ${INK}`, boxShadow: `10px 12px 0 ${INK}`, fontFamily: FONT, fontWeight: 900, fontSize: 104,
        color: ORANGE, transform: `scale(${pulse})`, whiteSpace: "nowrap",
      }}>🛒 กดสั่งเลย</div>
      <div style={{ position: "absolute", left: 70 - bounce * 0.6, top: 1590 + bounce, fontSize: 210, transform: "rotate(135deg)" }}>👉</div>
    </AbsoluteFill>
  );
};

const SCENES = [Hook, Hero, Stretch, Grid, Safe, Three, Count, Cta];
const SFX: [number, string, number][] = [
  ...CUTS.slice(1, -1).map((f) => [f - 2, "sfx-whoosh.mp3", 0.7] as [number, string, number]),
  [62, "sfx-slap.mp3", 1], [141, "sfx-ding.mp3", 0.8], [196, "sfx-slap.mp3", 1],
  ...TILES.map((t) => [243 + t.at, "sfx-pop.mp3", 1] as [number, string, number]),
  [371, "sfx-slap.mp3", 1], [399, "sfx-slap.mp3", 1], [478, "sfx-cash.mp3", 0.9], [489, "sfx-slap.mp3", 1], [523, "sfx-ding.mp3", 0.8],
];

const Flash = () => {
  const frame = useCurrentFrame();
  const since = Math.min(...CUTS.slice(1, -1).map((c) => (frame >= c ? frame - c : 99)));
  return <AbsoluteFill style={{ background: "#fff", opacity: since < 4 ? 0.7 - since * 0.18 : 0 }} />;
};

const Wow = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    {SCENES.map((S, i) => (
      <Sequence key={i} from={CUTS[i]} durationInFrames={CUTS[i + 1] - CUTS[i]}><S /></Sequence>
    ))}
    <Flash />
    <Audio src={staticFile("voice.m4a")} />
    {SFX.map(([f, src, v], i) => (
      <Sequence key={i} from={f} durationInFrames={30}><Audio src={staticFile(src)} volume={v} /></Sequence>
    ))}
  </AbsoluteFill>
);

registerRoot(() => <Composition id="Wow" component={Wow} width={1080} height={1920} fps={30} durationInFrames={594} />);
