import React from "react";
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Cam, Shot, type V3 } from "./kit/three";
import { BlurIn, CREAM, Click, DUR, FPS, FadeOut, Grain, INK, LINE, PAPER, RED, SANS, Vig, fr, useSpr } from "./kit/ui";
import { Char, headCenter, type Pose } from "./rig/char";
import { YOU } from "./rig/cast";
import { Cat, TABBY, type CatColors, type CatPose } from "./rig/pets";
import { setOf } from "./sets";
import { Captions } from "./ui/captions";
import { Clock, NextCard, ProofCard, RuleSign, RuleTag } from "./ui/cards";
import * as Custom from "./custom";
import FILM from "./film.json";

/** per-clip 3D pieces (src/custom.tsx). null = not made for this clip: the product is shown as the real shop photo */
const Product = ((Custom as Record<string, unknown>).Product ?? null) as React.FC<{ open?: number }> | null;
const Twist = ((Custom as Record<string, unknown>).Twist ?? null) as React.FC | null;

/** Story Ad film: built entirely from src/film.json (the plan) + src/lines.json (voice timing).
 *  A SCENE = one voice line = the unit that is reviewed, edited and re-rendered on its own.
 *  Each scene has 1-2 CUTS; a cut picks a shot, poses, set state and an optional card from the library below. */

type Card =
  | { type: "rule" } | { type: "tag" } | { type: "clock"; t: string; label?: string }
  | { type: "proof"; title: string; big: string; unit?: string; note?: string; source?: string }
  | { type: "photo"; src: string; label?: string } | { type: "price"; amount: string; src?: string };
type CutPlan = { shot: string; you?: string; pet?: string; noPet?: boolean; state?: Record<string, unknown>; card?: Card };
type ScenePlan = { line: number; cuts: CutPlan[] };
type FilmPlan = { set?: string; seed?: number; subject?: { label?: string; note?: string }; scenes: ScenePlan[] };
const PLAN = FILM as unknown as FilmPlan;
const SCENES = PLAN.scenes;
/** the room this clip plays in; `set` on a component overrides it (used by the library check) */
const SetCtx = React.createContext<string | undefined>(PLAN.set);
export const SetName = SetCtx.Provider;

/* ─── look: the same three rooms must not make every clip look alike, so walls, clothes and the cat change with the seed ─── */
const SEED = Math.abs(Math.floor(PLAN.seed ?? 0));
const TEES = ["#9FB7C9", "#C9A9A0", "#A9C2A4", "#C8BD93", "#B4A9C9"];
const CATS: CatColors[] = [TABBY, { fur: "#8E8E93", stripe: "#6F7076", chest: "#F2F2F0", collar: "#3B6FB5" }, { fur: "#2E2B2A", stripe: "#242120", chest: "#F4F1EC", collar: "#E9B84A" }, { fur: "#EDE6DA", stripe: "#D9CDB8", chest: "#FFFFFF", collar: "#2F9A5A" }];

/* ─── pose library ─── */
const YOU_POSES: Record<string, Pose> = {
  rest: { head: [0.18, 0.08, 0] },
  sleepy: { head: [0.2, 0.1, 0], blink: 0.6 },
  look: { head: [0.3, 0.1, 0], browUp: 0.4 },
  reach: { shR: [-0.95, 0, 0.25], elR: -0.55, head: [0.3, 0.12, 0], spine: [0.12, 0, 0] },
  dig: { shR: [-1.1, 0, 0.3], elR: -0.9, head: [0.42, 0.12, 0], spine: [0.2, 0, 0], browUp: 0.3 },
  shock: { head: [0.3, 0.1, 0], browUp: 1, blink: 0, mouth: 0.3 },
  relief: { head: [0.25, 0.1, 0], blink: 0.4 },
};
const PET_POSES: Record<string, CatPose> = {
  stare: { crouch: 0.55, puff: 0.35, head: [0, -0.3], blink: 0 },
  calm: { crouch: 0.2, head: [0, -0.2] },
  sleep: { crouch: 0.75, blink: 1 },
};

const PARENT = { ...YOU, outfit: "tee" as const, top: TEES[SEED % TEES.length], pants: "#C9CFD6" };
const FACE_Y = headCenter(PARENT);

type Scene = { you?: Pose; pet?: CatPose; noPet?: boolean; state?: Record<string, unknown>; product?: number };
/** the room with everyone in it. product = undefined: the story's own object; a number: the product stands there (0..1 = how open) */
const Room: React.FC<Scene> = ({ you, pet = PET_POSES.stare, noPet, state, product }) => {
  const f = useCurrentFrame();
  const { Set, anchors: A, walls } = setOf(React.useContext(SetCtx));
  return (
    <Set label={PLAN.subject?.label} note={PLAN.subject?.note} {...state} wall={walls[SEED % walls.length]}
      product={product !== undefined && Product ? <Product open={product} /> : undefined}
      twist={state?.twist && Twist ? <Twist /> : undefined}>
      <Char L={PARENT} p={A.you} ry={0} pose={{ ...YOU_POSES.rest, ...you }} seed={3} />
      {noPet ? null : <Cat p={A.pet} ry={A.petRy} s={A.petS} pose={{ tail: f / 14, ...pet }} colors={CATS[SEED % CATS.length]} />}
    </Set>
  );
};

/* ─── shot library: cameras placed from the set's anchors (every shot pushes in) ─── */
type Rig = (f: number) => { p: V3; t: V3; fov: number; drift: number; tilt?: { band: number; px: number } };
const cams = (set: string | undefined): Record<string, Rig> => {
  const A = setOf(set).anchors;
  const S = A.subject, X = A.aux, P = A.pet, T0 = A.top, Y = A.you;
  return {
    subject: (f) => ({ p: [S[0] + 0.16, T0 + 0.26, S[2] + 1.26 - f * 0.002], t: [S[0], T0 + 0.03, S[2]], fov: 28, drift: 0.3, tilt: { band: 440, px: 7 } }),
    "subject-close": (f) => ({ p: [S[0] + 0.05, T0 + 0.21, S[2] + 0.76 - f * 0.0012], t: [S[0] + 0.02, T0 + 0.1, S[2]], fov: 22, drift: 0.2, tilt: { band: 400, px: 8 } }),
    top: (f) => ({ p: [S[0] + 0.03, T0 + 0.62 - f * 0.001, S[2] + 0.2], t: [S[0], T0 + A.subjectH, S[2]], fov: 26, drift: 0.2, tilt: { band: 400, px: 7 } }),
    face: (f) => ({ p: [Y[0] + 0.3, FACE_Y + 0.04, Y[2] + 1.62 - f * 0.003], t: [Y[0], FACE_Y - 0.05, Y[2]], fov: 32, drift: 0.4 }),
    wide: (f) => ({ p: [-0.75, 1.62, 3.0 - f * 0.004], t: [0.05, 1.0, -0.3], fov: 42, drift: 0.3 }),
    pet: (f) => ({ p: [P[0] - 0.3, T0 + 0.3, P[2] + 1.29 - f * 0.002], t: [P[0], T0 + 0.02, P[2]], fov: 32, drift: 0.3 }),
    "pet-subject": (f) => ({ p: [(S[0] + P[0]) / 2, T0 + 0.34, 2.0 - f * 0.003], t: [(S[0] + P[0]) / 2, T0 - 0.08, 0], fov: 36, drift: 0.3 }),
    aux: (f) => ({ p: [X[0] + 0.1, T0 + 0.5 - f * 0.001, X[2] + 0.62], t: [X[0], T0 - 0.02, X[2]], fov: 26, drift: 0.2, tilt: { band: 400, px: 7 } }),
  };
};
export const SHOTS = [...Object.keys(cams(undefined)), "product", "product-open", "photo", "price"];

export const View: React.FC<Scene & { cam: string }> = ({ cam, ...s }) => {
  const f = useCurrentFrame();
  const all = cams(React.useContext(SetCtx));
  const c = (all[cam] ?? all.wide)(f);
  return <Shot tilt={c.tilt}><Room {...s} /><Cam p={c.p} t={c.t} fov={c.fov} drift={c.drift} /></Shot>;
};

/* ─── ad cards (DOM, next to the shot) ─── */
const paper: React.CSSProperties = { position: "absolute", background: PAPER, color: INK, fontFamily: SANS, borderRadius: 26, boxShadow: "0 18px 50px rgba(0,0,0,0.45)" };
const Photo: React.FC<{ src: string; y?: number; size?: number; label?: string }> = ({ src, y = 250, size = 620, label }) => {
  const a = useSpr(2, 13);
  return (
    <div style={{ ...paper, left: (1080 - size) / 2 - 18, top: y, padding: 18, opacity: a, scale: String(0.9 + 0.1 * a), rotate: "-2deg" }}>
      <Click at={2} v={0.45} />
      <Img src={staticFile(src)} style={{ width: size, height: size, objectFit: "cover", borderRadius: 14, display: "block" }} />
      {label ? <div style={{ fontSize: 30, fontWeight: 600, textAlign: "center", marginTop: 10 }}>{label}</div> : null}
    </div>
  );
};
const Price: React.FC<{ amount: string }> = ({ amount }) => {
  const a = useSpr(10, 11);
  return (
    <div style={{ ...paper, left: 640, top: 800, padding: "8px 34px 14px", background: RED, color: CREAM, opacity: a, scale: String(1.6 - 0.6 * a), rotate: "5deg" }}>
      <Click at={10} v={0.6} kind="tick" />
      <span style={{ fontSize: 120, fontWeight: 700, lineHeight: 1 }}>{amount}</span><span style={{ fontSize: 46, fontWeight: 700 }}> บาท</span>
    </div>
  );
};
const CardView: React.FC<{ c?: Card }> = ({ c }) => {
  if (!c) return null;
  switch (c.type) {
    case "rule": return <RuleSign />;
    case "tag": return <RuleTag />;
    case "clock": return <Clock t={c.t} label={c.label} />;
    case "proof": return <ProofCard title={c.title} big={c.big} unit={c.unit} note={c.note} source={c.source} y={250} />;
    case "photo": return <Photo src={c.src} size={560} y={230} label={c.label} />;
    case "price": return <><Photo src={c.src ?? "product.png"} /><Price amount={c.amount} /></>;
  }
};

/** the flip top / lid opens during the cut */
const Opening: React.FC<Scene> = (s) => {
  const f = useCurrentFrame();
  return <View cam="subject" {...s} noPet product={Math.min(1, Math.max(0, (f - 6) / 12))} />;
};

export const CutView: React.FC<{ c: CutPlan }> = ({ c }) => {
  const s: Scene = { you: YOU_POSES[c.you ?? "rest"], pet: PET_POSES[c.pet ?? "stare"], noPet: c.noPet, state: c.state };
  const has3d = Product !== null;
  let picture: React.ReactNode;
  if (c.shot === "photo" || c.shot === "price" || (!has3d && c.shot.startsWith("product"))) {
    // no 3D model for this clip (or a pure photo beat): the real shop photo over the soft room
    picture = <BlurIn px={8}><View cam="wide" {...s} product={has3d ? 0 : undefined} /></BlurIn>;
    const card: Card = c.card ?? { type: "photo", src: "product.png" };
    return <>{picture}<CardView c={card} /></>;
  }
  if (c.shot === "product-open") picture = <Opening {...s} />;
  else if (c.shot === "product") picture = <View cam="subject" {...s} product={0} />;
  // after the product has appeared it stays on the counter in the wider shots
  else picture = <View cam={c.shot} {...s} product={c.state?.product ? Number(c.state.productOpen ?? 0) : undefined} />;
  return <>{picture}<CardView c={c.card} /></>;
};

/* ─── timing: scene n runs from just before its line to just before the next ─── */
const END = LINE[LINE.length - 1].end + 0.4;
/** [start, end] in seconds of scene i (0-based); the last one also carries the end card */
export const sceneSpan = (i: number): [number, number] => [
  i === 0 ? 0 : LINE[SCENES[i].line - 1].t - 0.1,
  i === SCENES.length - 1 ? DUR / FPS : LINE[SCENES[i + 1].line - 1].t - 0.1,
];
type Cut = { a: number; b: number; el: React.ReactNode };
export const CUTS: Cut[] = SCENES.flatMap((sc, i) => {
  const [a, b0] = sceneSpan(i);
  const last = i === SCENES.length - 1;
  const b = last ? END : b0;
  const n = sc.cuts.length;
  const cuts: Cut[] = sc.cuts.map((c, k) => ({ a: a + ((b - a) * k) / n, b: a + ((b - a) * (k + 1)) / n, el: <CutView c={c} /> }));
  if (last) cuts.push({ a: END, b: DUR / FPS, el: <><BlurIn><CutView c={{ ...sc.cuts[n - 1], card: undefined }} /></BlurIn><NextCard /></> });
  return cuts;
});

export const HERO_S = 0;
export const Film: React.FC<{ noCaps?: boolean }> = ({ noCaps }) => (
  <AbsoluteFill style={{ background: "#07090F" }}>
    {CUTS.map((k, i) => (
      <Sequence key={i} from={fr(k.a)} durationInFrames={Math.max(1, fr(k.b) - fr(k.a))}>
        <AbsoluteFill>{k.el}</AbsoluteFill>
      </Sequence>
    ))}
    <Vig a={0.4} />
    <FadeOut from={DUR - 24} />
    <Grain amount={0.045} />
    {noCaps ? null : <Captions hideFrom={END} />}
  </AbsoluteFill>
);
