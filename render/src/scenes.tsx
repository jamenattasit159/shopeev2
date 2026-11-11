// The 10 scene templates. Each gets one beat (text + length in frames) and animates itself.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, Beat, Col, Ctx, INK, ORANGE, Product, Slam, Sparkles, Sunburst, fit, stagger, useSpr } from "./kit";

type P = { beat: Beat; ctx: Ctx };
const lines = (b: Beat) => (b.text ?? []).filter(Boolean);
const tilt = (ctx: Ctx, i: number) => (((ctx.seed + i) % 2 ? 1 : -1) * (2 + ((ctx.seed + i) % 3)));

const Hook: React.FC<P> = ({ beat, ctx }) => {
  const t = lines(beat);
  const last = t.length - 1;
  const ats = t.map((_, i) => stagger(beat.frames, t.length, i, 3));
  return (
    <AbsoluteFill>
      <Backdrop media={beat.media} ctx={ctx} shakeAt={[ats[last] ?? 0]} />
      {!beat.media && <Product ctx={ctx} at={0} width={820} top={260} />}
      <Col top={beat.media ? 1000 : 1130}>
        {t.map((s, i) => i === last && t.length > 1
          ? <Slam key={i} at={ats[i]} size={116} font={ctx.font} bg={ctx.pal.pop} color={INK} rot={tilt(ctx, i)}>{s}</Slam>
          : i === 0 && t.length > 2
            ? <Slam key={i} at={ats[i]} size={80} font={ctx.font} bg="#fff" color={INK} rot={tilt(ctx, i)}>{s}</Slam>
            : <Slam key={i} at={ats[i]} size={170} font={ctx.font}>{s}</Slam>)}
      </Col>
    </AbsoluteFill>
  );
};

const Hero: React.FC<P> = ({ beat, ctx }) => {
  const s = useSpr(2);
  const brand = (ctx.product.brand || "").toUpperCase();
  const half = Math.ceil(brand.length / 2);
  const rows = brand.length > 6 ? [brand.slice(0, half), brand.slice(half)] : [brand];
  const size = Math.min(330, Math.floor(1000 / Math.max(1, rows[0].length * 0.68)));
  return (
    <AbsoluteFill>
      <Sunburst from={ctx.pal.light} to={ctx.pal.deep} />
      <div style={{
        position: "absolute", top: 250, width: "100%", textAlign: "center", fontFamily: ctx.font, fontWeight: 900,
        fontSize: size, lineHeight: 0.92, color: "#fff", transform: `scale(${interpolate(s, [0, 1], [0.5, 1])})`,
        textShadow: "0 14px 0 rgba(0,0,0,.18)",
      }}>{rows.map((r, i) => <div key={i}>{r}</div>)}</div>
      <Product ctx={ctx} at={4} width={1000} top={560} />
      <Sparkles seed={ctx.seed} />
      <Col top={1420}>
        {lines(beat).slice(0, 1).map((t) =>
          <Slam key={t} at={Math.round(beat.frames * 0.4)} size={124} font={ctx.font} bg={ctx.pal.pop} color={INK} rot={tilt(ctx, 0)}>{t}</Slam>)}
      </Col>
    </AbsoluteFill>
  );
};

const BigWord: React.FC<P> = ({ beat, ctx }) => {
  const t = lines(beat);
  return (
    <AbsoluteFill>
      <Backdrop media={beat.media} ctx={ctx} shakeAt={[6]} />
      {!beat.media && <Product ctx={ctx} width={860} top={300} rot={4} />}
      <Col top={beat.media ? 1080 : 1200}>
        {t[0] && <Slam at={6} size={200} font={ctx.font} color={ctx.pal.pop}>{t[0]}</Slam>}
        {t[1] && <Slam at={Math.round(beat.frames * 0.5)} size={104} font={ctx.font} bg={ctx.pal.alt} rot={tilt(ctx, 1)}>{t[1]}</Slam>}
      </Col>
    </AbsoluteFill>
  );
};

const TILE_BG = ["#FF8FB1", "#FFD60A", "#7FD6FF", "#86EFAC"];
const Grid: React.FC<P> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const items = (beat.badges ?? []).slice(0, 4);
  // first 30% is the header; tiles then pop one by one
  const at = (i: number) => Math.round(beat.frames * (0.3 + (0.6 * i) / items.length));
  return (
    <AbsoluteFill>
      <Backdrop media={beat.media ?? (ctx.images[0] ? { type: "image", src: ctx.images[0] } : null)} ctx={ctx} blur dim={0} />
      <Col top={170}>{lines(beat).slice(0, 1).map((t) => <Slam key={t} at={2} size={150} font={ctx.font}>{t}</Slam>)}</Col>
      <AbsoluteFill style={{ top: 470, height: "auto", display: "flex", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignContent: "flex-start", gap: 40, padding: "0 30px" }}>
        {items.map((raw, i) => {
          const [emoji, ...rest] = raw.trim().split(/\s+/);
          const word = rest.join(" ") || emoji;
          const show = frame >= at(i);
          return <Tile key={i} at={at(i)} show={show} emoji={rest.length ? emoji : ""} word={word} bg={TILE_BG[(i + ctx.seed) % 4]} rot={(i % 2 ? 1 : -1) * 2.5} font={ctx.font} />;
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
const Tile: React.FC<{ at: number; show: boolean; emoji: string; word: string; bg: string; rot: number; font: string }> = ({ at, show, emoji, word, bg, rot, font }) => {
  const s = useSpr(at, { damping: 9, stiffness: 220, mass: 0.5 });
  return (
    <div style={{
      boxSizing: "border-box", width: 480, height: 540, borderRadius: 48, background: bg, border: `10px solid ${INK}`,
      boxShadow: `12px 14px 0 ${INK}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      transform: `scale(${show ? s : 0}) rotate(${rot}deg)`,
    }}>
      {emoji && <div style={{ fontSize: 220, lineHeight: 1.1 }}>{emoji}</div>}
      <div style={{ fontFamily: font, fontWeight: 900, fontSize: fit(word, emoji ? 150 : 170, 420), color: INK, lineHeight: 1.1 }}>{word}</div>
    </div>
  );
};

const Stamp: React.FC<P> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const stamps = (beat.badges ?? []).slice(0, 2);
  const pos = [{ x: 40, y: 1180, rot: -12 }, { x: 600, y: 1290, rot: 9 }];
  return (
    <AbsoluteFill>
      <Sunburst from={ctx.pal.light} to={ctx.pal.deep} />
      <Col top={170}>{lines(beat).slice(0, 1).map((t) => <Slam key={t} at={2} size={210} font={ctx.font}>{t}</Slam>)}</Col>
      <Product ctx={ctx} width={900} top={520} rot={4} />
      {stamps.map((raw, i) => {
        const at = Math.round(beat.frames * (0.4 + 0.3 * i));
        if (frame < at) return null;
        const [big, small] = raw.includes("|") ? raw.split("|") : [raw, ""];
        return <StampDisc key={i} at={at} {...pos[stamps.length === 1 ? 1 : i]} big={big.trim()} small={small.trim()} font={ctx.font} color={ctx.pal.alt} />;
      })}
    </AbsoluteFill>
  );
};
const StampDisc: React.FC<{ at: number; x: number; y: number; rot: number; big: string; small: string; font: string; color: string }> = ({ at, x, y, rot, big, small, font, color }) => {
  const s = useSpr(at, { damping: 12, stiffness: 260, mass: 0.5 });
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: 430, height: 430, borderRadius: "50%", background: "#fff",
      border: `16px solid ${color}`, outline: "6px solid #fff", color, fontFamily: font, fontWeight: 900,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.05, textAlign: "center",
      transform: `scale(${interpolate(s, [0, 1], [3, 1])}) rotate(${rot}deg)`, boxShadow: "0 20px 40px rgba(0,0,0,.3)",
    }}>
      <div style={{ fontSize: fit(big, small ? 190 : 120, 340) }}>{big}</div>
      {small && <div style={{ fontSize: fit(small, 66, 330), marginTop: 8 }}>{small}</div>}
    </div>
  );
};

const Count: React.FC<P> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const target = beat.number ?? 0;
  const n = Math.round(interpolate(frame, [2, 20], [0, target], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const pop = useSpr(20, { damping: 8, stiffness: 240, mass: 0.5 });
  const t = lines(beat);
  const digits = String(target).length;
  return (
    <AbsoluteFill>
      <Backdrop media={beat.media} ctx={ctx} shakeAt={[20]} dim={0.5} />
      <Col top={600} gap={0}>
        {t[0] && <Slam at={0} size={110} font={ctx.font} bg="#fff" color={INK} rot={-3}>{t[0]}</Slam>}
        <div style={{
          fontFamily: ctx.font, fontWeight: 900, fontSize: Math.min(520, Math.floor(1700 / digits) * 0.6), lineHeight: 1, color: ctx.pal.pop,
          WebkitTextStroke: `22px ${INK}`, paintOrder: "stroke fill", textShadow: `0 16px 0 ${INK}`,
          transform: `scale(${interpolate(pop, [0, 1], [1, 1.12])})`,
        }}>{n.toLocaleString("en-US")}</div>
        {beat.unit && <Slam at={4} size={150} font={ctx.font}>{beat.unit}</Slam>}
        <div style={{ height: 30 }} />
        {t[1] && <Slam at={Math.round(beat.frames * 0.6)} size={130} font={ctx.font} bg={ctx.pal.alt} rot={-5}>{t[1]}</Slam>}
      </Col>
    </AbsoluteFill>
  );
};

const Price: React.FC<P> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const { price, priceBefore } = ctx.product;
  const strike = interpolate(frame, [8, 16], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const slamAt = priceBefore ? 18 : 4;
  return (
    <AbsoluteFill>
      <Sunburst from="#FF8A5C" to={ORANGE} />
      <Col top={150}>{lines(beat).slice(0, 1).map((t) => <Slam key={t} at={2} size={130} font={ctx.font} bg="#fff" color={ORANGE} rot={-3}>{t}</Slam>)}</Col>
      <Product ctx={ctx} width={760} top={380} />
      <Col top={1130} gap={0}>
        {priceBefore && (
          <div style={{ position: "relative", fontFamily: ctx.font, fontWeight: 900, fontSize: 110, color: "rgba(255,255,255,.85)" }}>
            ฿{priceBefore}
            <div style={{ position: "absolute", left: 0, top: "52%", height: 12, width: `${strike}%`, background: INK, transform: "rotate(-6deg)" }} />
          </div>
        )}
        {price && <Slam at={slamAt} size={300} font={ctx.font} color={ctx.pal.pop}>{`฿${price}`}</Slam>}
      </Col>
    </AbsoluteFill>
  );
};

const Review: React.FC<P> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const s = useSpr(4);
  const quote = lines(beat)[0] ?? "";
  const rating = ctx.product.rating;
  return (
    <AbsoluteFill>
      <Backdrop media={beat.media ?? (ctx.images[0] ? { type: "image", src: ctx.images[0] } : null)} ctx={ctx} blur dim={0} />
      <Col top={260} gap={10}>
        <div style={{ fontSize: 150, letterSpacing: 6 }}>
          {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ display: "inline-block", transform: `scale(${frame > 3 + i * 3 ? 1 : 0})`, color: "#FFD60A", textShadow: `0 8px 0 ${INK}` }}>★</span>)}
        </div>
        {rating ? <Slam at={18} size={150} font={ctx.font}>{`${rating.toFixed(1)} / 5`}</Slam> : null}
      </Col>
      <div style={{
        position: "absolute", left: 70, top: 760, width: 940, boxSizing: "border-box", padding: "50px 56px 60px", borderRadius: 56,
        background: "#fff", border: `10px solid ${INK}`, boxShadow: `14px 16px 0 ${INK}`, fontFamily: ctx.font, fontWeight: 700,
        fontSize: Math.max(54, Math.min(84, Math.floor(5200 / Math.max(20, [...quote].length)))), lineHeight: 1.35, color: INK,
        transform: `scale(${s}) rotate(-2deg)`, wordBreak: "break-word",
      }}>
        <div style={{ fontSize: 160, lineHeight: 0.6, color: ctx.pal.deep }}>“</div>
        {quote}
        <div style={{ marginTop: 26, fontSize: 44, color: "#666" }}>— รีวิวจากผู้ซื้อ</div>
      </div>
    </AbsoluteFill>
  );
};

const Compare: React.FC<P> = ({ beat, ctx }) => {
  const [bad = "", good = ""] = beat.badges ?? [];
  const goodAt = Math.round(beat.frames * 0.45);
  const frame = useCurrentFrame();
  const wipe = interpolate(frame, [goodAt, goodAt + 8], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#2B2B33" }}>
      <Col top={420} gap={30}>
        <div style={{ fontSize: 260 }}>😩</div>
        <Slam at={3} size={150} font={ctx.font} color="#C9C9D4">{bad}</Slam>
      </Col>
      <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${100 - wipe}%)` }}>
        <Sunburst from={ctx.pal.light} to={ctx.pal.deep} />
        <Product ctx={ctx} at={goodAt} width={880} top={300} />
        <Col top={1220} gap={24}>
          <Slam at={goodAt + 4} size={170} font={ctx.font} color={ctx.pal.pop}>{good}</Slam>
          {lines(beat).slice(0, 1).map((t) => <Slam key={t} at={goodAt + 14} size={96} font={ctx.font} bg="#fff" color={INK} rot={-3}>{t}</Slam>)}
        </Col>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Cta: React.FC<P> = ({ beat, ctx }) => {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 3.5) * 0.05;
  const bounce = Math.abs(Math.sin(frame / 5)) * 40;
  const t = lines(beat);
  return (
    <AbsoluteFill>
      <Sunburst from="#FF8A5C" to={ORANGE} />
      <Col top={190} gap={10}>
        <Slam at={2} size={110} font={ctx.font} bg="#fff" color={ORANGE} rot={-3}>{t[0] ?? "พิกัดอยู่ที่"}</Slam>
        <Slam at={10} size={190} font={ctx.font}>{t[1] ?? "ตะกร้าส้ม"}</Slam>
      </Col>
      <Product ctx={ctx} at={4} width={900} top={600} />
      <div style={{
        position: "absolute", left: 190, top: 1370, padding: "22px 70px 30px", borderRadius: 999, background: "#fff",
        border: `10px solid ${INK}`, boxShadow: `10px 12px 0 ${INK}`, fontFamily: ctx.font, fontWeight: 900, fontSize: 104,
        color: ORANGE, transform: `scale(${pulse})`, whiteSpace: "nowrap",
      }}>🛒 กดสั่งเลย</div>
      <div style={{ position: "absolute", left: 70 - bounce * 0.6, top: 1590 + bounce, fontSize: 210, transform: "rotate(135deg)" }}>👉</div>
    </AbsoluteFill>
  );
};

export const SCENES: Record<string, React.FC<P>> = {
  hook: Hook, hero: Hero, bigword: BigWord, grid: Grid, stamp: Stamp,
  count: Count, price: Price, review: Review, compare: Compare, cta: Cta,
};
// Sound effect per scene: [file, offset as fraction of the beat]
export const SCENE_SFX: Record<string, [string, number][]> = {
  hook: [["sfx-slap.mp3", 0.5]], hero: [["sfx-ding.mp3", 0.4]], bigword: [["sfx-slap.mp3", 0.05]],
  grid: [["sfx-pop.mp3", 0.3], ["sfx-pop.mp3", 0.5], ["sfx-pop.mp3", 0.7]], stamp: [["sfx-slap.mp3", 0.4], ["sfx-slap.mp3", 0.7]],
  count: [["sfx-cash.mp3", 0.3]], price: [["sfx-cash.mp3", 0.3]], review: [["sfx-sparkle.mp3", 0.1]],
  compare: [["sfx-whoosh.mp3", 0.42]], cta: [["sfx-ding.mp3", 0.1]],
};
