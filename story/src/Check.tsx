import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CutView, SetName, View } from "./Film";
import { SETS } from "./sets";

/** Library check: one frame per shot per set (node still.mjs Library 0:out/lib_00.jpg ...). Order: sets x LIB_SHOTS. */
export const LIB_SHOTS = ["subject", "subject-close", "top", "face", "wide", "pet", "pet-subject", "aux"];
const DEMO: Record<string, Record<string, unknown>> = {
  kitchen: { lid: "off", scoop: true, clump: 1, cup: true, lumps: true, stain: 1, board: true, raw: true },
  bedroom: { cord: "loose", phone: true, lit: true, cot: true, curtain: "gap", blanket: "messy" },
  bathroom: { cap: "open", leak: true, mold: 1, cup: true, slime: true, tap: "drip", towel: "floor", mirror: "fog" },
};
export const LIB_FRAMES = Object.keys(SETS).length * LIB_SHOTS.length;
export const Library: React.FC = () => {
  const f = useCurrentFrame();
  const set = Object.keys(SETS)[Math.floor(f / LIB_SHOTS.length) % Object.keys(SETS).length];
  return (
    <AbsoluteFill style={{ background: "#07090F" }}>
      <SetName value={set}><CutView c={{ shot: LIB_SHOTS[f % LIB_SHOTS.length], state: DEMO[set] }} /></SetName>
    </AbsoluteFill>
  );
};

/** Check of this clip's src/custom.tsx: frame 0 = product closed, 1 = product open, 2 = the twist prop. */
export const CustomCheck: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#07090F" }}>
      {f < 2 ? <View cam="subject" noPet product={f} /> : <View cam="aux" noPet state={{ twist: true }} />}
    </AbsoluteFill>
  );
};
