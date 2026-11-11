import React from "react";
import { Bx, Cy, Glow, Pl, Sp, type V3 } from "../kit/three";

/** Ad set: a bathroom late at night. Same footprint as the kitchen, so the shot library works unchanged.
 *  Plan (metres): room x -2.2..2.2, back wall z=-1.9, floor y=0.
 *    vanity: x -1.3..1.3, z -0.31..0.31, top y=TOP, basin on the right. You stand behind it (z≈-0.62) facing +z (the camera).
 *    on the vanity: a pump bottle (BOTTLE, the story's own object), a toothbrush cup (CUP), the cat sits at CAT.
 *    back wall: mirror (x=0.2), wall shelf (x=-1.2), towel rail (x=1.5), shower corner on the left. */
export const TOP = 0.88;
export const BOTTLE: V3 = [-0.28, TOP, 0.04];
export const CUP: V3 = [-0.07, TOP, 0.14];
export const CAT: V3 = [0.24, TOP, -0.04];
export const YOU_P: V3 = [-0.08, 0, -0.62];

const TILE = "#BFD3D2", FLOOR = "#7C8B8C", STONE = "#EDEDE8", STEEL = "#B9BEC4", SOAP = "#7FB6A8", MOLD = "#55644F";
const BOTTLE_H = 0.16;

export type BathroomProps = {
  /** the pump bottle's cap: "on", "open" (pump head unscrewed and tilted), "off" (lying beside the bottle) */ cap?: "on" | "open" | "off";
  /** a puddle of leaked liquid under the bottle */ leak?: boolean;
  /** dark mould spots on the wall tiles and round the bottle's base, 0..1 */ mold?: number;
  /** mirror: "clear" or "fog" */ mirror?: "clear" | "fog";
  /** tap: "off", "drip" (a drop hangs and the basin is wet) */ tap?: "off" | "drip";
  /** towel: "hung" on the rail, or "floor" */ towel?: "hung" | "floor";
  /** toothbrush cup on the vanity; slime = a ring of residue inside it */ cup?: boolean; slime?: boolean;
  /** the product (a 3D model from src/custom.tsx) replaces the bottle */ product?: React.ReactNode;
  /** cold moonlight mood 0..1 (the twist) */ cold?: number;
  twist?: React.ReactNode;
  wall?: string;
  children?: React.ReactNode;
};

const Bottle: React.FC<Pick<BathroomProps, "cap" | "leak" | "mold">> = ({ cap = "on", leak, mold = 0 }) => {
  const H = BOTTLE_H - 0.045, R = 0.04;
  const pump = (
    <>
      <Cy p={[0, 0.012, 0]} r={0.016} h={0.024} c="#F1EFEA" />
      <Cy p={[0, 0.032, 0]} r={0.006} h={0.02} c={STEEL} />
      <Bx p={[0.012, 0.045, 0]} s={[0.05, 0.012, 0.02]} c="#F1EFEA" />
    </>
  );
  return (
    <group position={BOTTLE}>
      <Cy p={[0, H / 2, 0]} r={R} h={H} c={SOAP} seg={32} />
      <Cy p={[0, H * 0.5, 0]} r={R + 0.001} h={H * 0.42} c="#FFFFFF" seg={32} />
      <Cy p={[0, H + 0.006, 0]} r={0.02} h={0.012} c="#DDE2E4" />
      {cap === "off" ? (
        <>
          <Cy p={[0, H + 0.013, 0]} r={0.013} h={0.003} c="#15110D" />
          <group position={[-0.13, 0.012, 0.06]} rotation={[0, 0, Math.PI / 2]}>{pump}</group>
        </>
      ) : (
        <group position={[-0.016, H + 0.012, 0]} rotation={[0, 0, cap === "open" ? 0.3 : 0]}>
          <group position={[0.016, 0, 0]}>{pump}</group>
        </group>
      )}
      {cap === "open" ? <Cy p={[0, H + 0.014, 0]} r={0.013} h={0.004} c="#15110D" /> : null}
      {leak ? <Sp p={[0.03, 0.002, 0.03]} r={0.075} c="#9CCFC2" sc={[1.2, 0.03, 0.9]} /> : null}
      {mold > 0 ? [[-0.045, 0.02], [0.03, 0.045], [0.05, -0.01], [-0.02, -0.05], [0.0, 0.055]].map(([x, z], i) => (
        <Sp key={i} p={[x, 0.002, z]} r={0.012 * mold + i * 0.001} c={MOLD} sc={[1, 0.08, 1]} />
      )) : null}
    </group>
  );
};

export const Bathroom: React.FC<BathroomProps> = ({ cap, leak, mold = 0, mirror = "clear", tap = "off", towel = "hung", cup, slime, product, cold = 0, twist, wall = TILE, children }) => {
  const warm = 1 - cold * 0.75;
  return (
    <>
      <ambientLight intensity={0.4 + cold * 0.3} color={cold > 0.5 ? "#B9C8E8" : "#F4F1EA"} />
      <pointLight position={[0.2, 2.1, -1.2]} intensity={1.3 * warm} distance={4.4} color="#FFF1D8" />
      <pointLight position={[-1.4, 1.7, -1.4]} intensity={0.45 + cold * 0.9} distance={4} color="#9DB6F0" />
      <pointLight position={[0.2, 1.5, 1.6]} intensity={0.5} distance={3.2} color={cold > 0.5 ? "#C8D8FF" : "#FFF3E0"} />
      {/* room: tiled walls with grout lines */}
      <Pl p={[0, 0, 0]} s={[6, 6]} c={FLOOR} rx={-Math.PI / 2} />
      <Bx p={[0, 1.4, -1.95]} s={[4.6, 2.8, 0.1]} c={wall} />
      <Bx p={[-2.3, 1.4, 0]} s={[0.1, 2.8, 4]} c={wall} />
      <Bx p={[2.3, 1.4, 0]} s={[0.1, 2.8, 4]} c={wall} />
      {[0.7, 1.4, 2.1].map((y) => <Bx key={y} p={[0, y, -1.895]} s={[4.6, 0.012, 0.01]} c="#93A8A7" />)}
      {[-1.5, -0.75, 0, 0.75, 1.5].map((x) => <Bx key={x} p={[x, 1.4, -1.895]} s={[0.012, 2.8, 0.01]} c="#93A8A7" />)}
      {mold > 0 ? [[-0.72, 1.05], [-0.6, 0.98], [-0.78, 0.9], [0.74, 1.42], [-0.7, 1.36], [-0.66, 1.2]].map(([x, y], i) => (
        <Sp key={i} p={[x, y, -1.89]} r={0.014 * mold + i * 0.002} c={MOLD} sc={[1.3, 1, 0.08]} />
      )) : null}
      {/* mirror with a light bar */}
      <Bx p={[0.2, 1.62, -1.89]} s={[1.0, 0.8, 0.03]} c={mirror === "fog" ? "#C9D3D6" : "#8FA6B4"} e={mirror === "fog" ? "#000" : "#5C7890"} ei={0.25} r={mirror === "fog" ? 0.95 : 0.25} />
      <Bx p={[0.2, 2.1, -1.86]} s={[0.8, 0.05, 0.06]} c="#FFF6E2" e="#FFF1D8" ei={0.9 * warm} />
      <Glow p={[0.2, 2.08, -1.8]} s={0.9} c="#FFF1D8" o={0.5 * warm} />
      {/* shelf, shower corner, towel */}
      <Bx p={[-1.2, 1.5, -1.82]} s={[0.7, 0.03, 0.2]} c="#F1EFEA" />
      <Cy p={[-1.38, 1.6, -1.8]} r={0.045} h={0.17} c="#E9C46A" />
      <Cy p={[-1.12, 1.58, -1.8]} r={0.04} h={0.13} c="#C97B5A" />
      <Bx p={[-1.75, 1.1, -1.2]} s={[0.02, 2.2, 1.4]} c="#D5E6EA" o={0.35} />
      <Cy p={[-2.0, 2.05, -1.6]} r={0.07} h={0.02} c={STEEL} />
      <Cy p={[1.5, 1.25, -1.85]} r={0.012} h={0.6} c={STEEL} rz={Math.PI / 2} />
      {towel === "hung"
        ? <Bx p={[1.5, 0.98, -1.83]} s={[0.42, 0.55, 0.03]} c="#E7D9C4" />
        : <Sp p={[1.3, 0.06, -1.2]} r={0.3} c="#E7D9C4" sc={[1.2, 0.2, 0.9]} />}
      {/* vanity with a basin on the right */}
      <Bx p={[0, 0.42, 0]} s={[2.6, 0.84, 0.6]} c="#F1EFEA" />
      <Bx p={[0, TOP - 0.02, 0]} s={[2.7, 0.04, 0.66]} c={STONE} />
      <Cy p={[0.85, TOP + 0.002, 0.02]} r={0.2} h={0.006} c={tap === "drip" ? "#BFD9E0" : "#DDE2E4"} seg={40} />
      <Cy p={[0.85, TOP + 0.004, 0.02]} r={0.02} h={0.006} c="#5A6268" />
      <Cy p={[0.85, TOP + 0.09, -0.22]} r={0.014} h={0.18} c={STEEL} />
      <Bx p={[0.85, TOP + 0.17, -0.15]} s={[0.022, 0.022, 0.16]} c={STEEL} />
      {tap === "drip" ? <Sp p={[0.85, TOP + 0.13, -0.08]} r={0.01} c="#BFE3F2" sc={[1, 1.5, 1]} /> : null}
      {product ? <group position={BOTTLE}>{product}</group> : <Bottle cap={cap} leak={leak} mold={mold} />}
      {twist ? <group position={CUP}>{twist}</group> : cup ? (
        <group position={CUP}>
          <Cy p={[0, 0.045, 0]} r={0.034} h={0.09} c="#F1EFEA" seg={32} />
          <Cy p={[0, 0.089, 0]} r={0.03} h={0.004} c={slime ? "#6E7B4E" : "#D9E6EA"} seg={32} />
          <Bx p={[0.008, 0.11, 0]} s={[0.01, 0.15, 0.008]} c="#5A8FD0" rz={-0.18} />
          <Bx p={[0.022, 0.185, 0]} s={[0.014, 0.03, 0.012]} c="#FFFFFF" rz={-0.18} />
        </group>
      ) : null}
      {children}
    </>
  );
};

export const ANCHORS = { you: YOU_P, pet: CAT, petRy: -0.7, petS: 0.82, subject: BOTTLE, subjectH: BOTTLE_H, aux: CUP, top: TOP };
