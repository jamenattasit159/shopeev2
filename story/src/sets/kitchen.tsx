import React from "react";
import { Bx, Cy, Glow, Pl, Sp, textTex, type V3 } from "../kit/three";

/** Ad set: a small kitchen at 2 a.m. A counter between you and the camera, so faces and props are both open.
 *  Plan (metres): room x -2.2..2.2, back wall z=-1.9, floor y=0.
 *    counter: x -1.3..1.3, z -0.31..0.31, top y=TOP. You stand behind it (z≈-0.62) facing +z (the camera).
 *    on the counter: the formula tin (TIN), a glass of warm water (CUP), the cat sits at CAT.
 *    back wall: night window (x=-0.9), shelf (x=0.9). Pendant lamp over the counter. */
export const TOP = 0.88;
export const TIN: V3 = [-0.28, TOP, 0.04];
export const CUP: V3 = [-0.07, TOP, 0.14];
export const CAT: V3 = [0.24, TOP, -0.04];
export const YOU_P: V3 = [-0.08, 0, -0.62];

const WALL = "#CDBB9C", FLOOR = "#6E5340", WOOD = "#8A6446", STONE = "#E6DCC8", STEEL = "#B9BEC4";
const TIN_C = "#E3B93F", LID_C = "#3B6FB5", POWDER = "#F4E9C8", CLUMP = "#D9C79A";

export type KitchenProps = {
  /** tin lid: "ajar" (the planted detail: it sits crooked), "off" (lying beside the tin), "on" */ lid?: "ajar" | "off" | "on";
  /** scoop handle sticking out of the powder (only seen with the lid off) */ scoop?: boolean;
  /** clumps in the powder 0..1 */ clump?: number;
  /** glass of warm water on the counter; lumps = powder that will not dissolve */ cup?: boolean; lumps?: boolean;
  /** the product (a 3D model from src/custom.tsx) replaces the tin */ product?: React.ReactNode;
  /** cold moonlight mood 0..1 (the twist) */ cold?: number;
  children?: React.ReactNode;
};

const Tin: React.FC<Pick<KitchenProps, "lid" | "scoop" | "clump">> = ({ lid = "ajar", scoop, clump = 0 }) => {
  const sticker = textTex("เปิดมาแล้ว 19 วัน", 512, 160, "#FFFDF4", "#C0392B", 62, "tin-19");
  const brand = textTex("นมผง", 512, 200, "#FFFFFF", "#2A4E8A", 120, "tin-brand");
  const H = 0.16, R = 0.066;
  return (
    <group position={TIN}>
      <Cy p={[0, H / 2, 0]} r={R} h={H} c={TIN_C} seg={40} />
      <Cy p={[0, H / 2, 0]} r={R + 0.001} h={H * 0.5} c="#FFFFFF" seg={40} />
      <Pl p={[0, H * 0.56, R + 0.003]} s={[0.085, 0.034]} c="#ffffff" map={brand} />
      <Pl p={[0, H * 0.3, R + 0.003]} s={[0.092, 0.029]} c="#ffffff" map={sticker} />
      {lid === "off" ? (
        <>
          <Cy p={[0, H - 0.012, 0]} r={R - 0.006} h={0.004} c={POWDER} seg={40} />
          {scoop ? <Bx p={[0.012, H + 0.004, -0.008]} s={[0.014, 0.05, 0.005]} c={LID_C} rz={0.5} rx={0.3} /> : null}
          {clump > 0 ? [[-0.025, 0.02], [0.02, 0.028], [0.03, -0.022], [-0.012, -0.03], [-0.035, -0.008]].map(([x, z], i) => (
            <Sp key={i} p={[x, H - 0.006, z]} r={0.014 * clump + i * 0.0012} c={CLUMP} sc={[1, 0.7, 1]} />
          )) : null}
          {/* the lid, put down beside the tin */}
          <Cy p={[-0.17, 0.006, 0.06]} r={R + 0.004} h={0.012} c={LID_C} seg={40} />
        </>
      ) : (
        // "ajar": one edge rides high, a dark gap under it. Small on purpose: you only find it on a rewatch.
        <group position={[-R, H + 0.006, 0]} rotation={[0, 0, lid === "ajar" ? 0.11 : 0]}>
          <Cy p={[R, 0, 0]} r={R + 0.004} h={0.012} c={LID_C} seg={40} />
        </group>
      )}
      {lid === "ajar" ? <Cy p={[0, H + 0.002, 0]} r={R - 0.002} h={0.012} c="#15110D" seg={40} /> : null}
    </group>
  );
};

export const Kitchen: React.FC<KitchenProps> = ({ lid, scoop, clump, cup, lumps, product, cold = 0, children }) => {
  const warm = 1 - cold * 0.75;
  return (
    <>
      <ambientLight intensity={0.34 + cold * 0.32} color={cold > 0.5 ? "#B9C8E8" : "#FFE9D2"} />
      <pointLight position={[0, 2.05, 0.25]} intensity={1.5 * warm} distance={4.2} color="#FFD9A0" />
      <pointLight position={[-1.2, 1.7, -1.5]} intensity={0.5 + cold * 0.9} distance={4} color="#9DB6F0" />
      <pointLight position={[0.2, 1.5, 1.6]} intensity={0.45} distance={3.2} color={cold > 0.5 ? "#C8D8FF" : "#FFE6CC"} />
      {/* room */}
      <Pl p={[0, 0, 0]} s={[6, 6]} c={FLOOR} rx={-Math.PI / 2} />
      <Bx p={[0, 1.4, -1.95]} s={[4.6, 2.8, 0.1]} c={WALL} />
      <Bx p={[-2.3, 1.4, 0]} s={[0.1, 2.8, 4]} c={WALL} />
      <Bx p={[2.3, 1.4, 0]} s={[0.1, 2.8, 4]} c={WALL} />
      {/* night window */}
      <Bx p={[-0.9, 1.55, -1.9]} s={[0.9, 0.9, 0.04]} c="#22314F" e="#31508A" ei={0.5} />
      <Bx p={[-0.9, 1.55, -1.88]} s={[0.04, 0.9, 0.05]} c={WOOD} />
      <Bx p={[-0.9, 1.55, -1.88]} s={[0.9, 0.04, 0.05]} c={WOOD} />
      <Glow p={[-1.1, 1.78, -1.86]} s={0.34} c="#DCE8FF" o={0.5} />
      {/* shelf with a few things */}
      <Bx p={[0.95, 1.55, -1.82]} s={[1.0, 0.04, 0.22]} c={WOOD} />
      <Cy p={[0.65, 1.66, -1.8]} r={0.06} h={0.18} c="#C97B5A" />
      <Cy p={[0.9, 1.63, -1.8]} r={0.05} h={0.12} c="#7FA58A" />
      <Bx p={[1.2, 1.67, -1.8]} s={[0.14, 0.2, 0.1]} c="#D9C7A0" />
      {/* fridge */}
      <Bx p={[-1.75, 0.95, -1.55]} s={[0.7, 1.9, 0.65]} c="#DDE2E4" />
      <Bx p={[-1.45, 1.2, -1.21]} s={[0.03, 0.4, 0.03]} c={STEEL} />
      {/* pendant lamp */}
      <Cy p={[0, 2.5, 0.2]} r={0.006} h={0.7} c="#2A2622" />
      <Cy p={[0, 2.1, 0.2]} r={0.05} r2={0.2} h={0.16} c="#C9A455" e="#FFD9A0" ei={0.35 * warm} />
      <Glow p={[0, 2.02, 0.2]} s={0.75} c="#FFD9A0" o={0.6 * warm} />
      {/* counter */}
      <Bx p={[0, 0.42, 0]} s={[2.6, 0.84, 0.6]} c={WOOD} />
      <Bx p={[0, TOP - 0.02, 0]} s={[2.7, 0.04, 0.66]} c={STONE} />
      {product ? <group position={TIN}>{product}</group> : <Tin lid={lid} scoop={scoop} clump={clump} />}
      {cup ? (
        <group position={CUP}>
          <Cy p={[0, 0.05, 0]} r={0.036} h={0.1} c="#CFE3EE" seg={32} />
          <Cy p={[0, 0.098, 0]} r={0.033} h={0.004} c={lumps ? "#F2EEDF" : "#EAF4F8"} seg={32} />
          {lumps ? [[-0.012, 0.008], [0.011, 0.012], [0.004, -0.014], [-0.016, -0.01]].map(([x, z], i) => (
            <Sp key={i} p={[x, 0.102, z]} r={0.009 + i * 0.001} c={CLUMP} sc={[1, 0.6, 1]} />
          )) : null}
        </group>
      ) : null}
      {children}
    </>
  );
};

/** what every set gives the shot library: where things are, so one set of cameras works in any room */
export const ANCHORS = { you: YOU_P, pet: CAT, petRy: -0.7, petS: 0.82, subject: TIN, subjectH: 0.16, aux: CUP, top: TOP };
/** state keys the AI may set on this set (checked by the app before rendering) */
export const STATE_KEYS = ["lid", "scoop", "clump", "cup", "lumps", "cold"];
