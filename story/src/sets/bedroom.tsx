import React from "react";
import { Bx, Cy, Glow, Pl, Sp, type V3 } from "../kit/three";

/** Ad set: a bedroom at night. Same footprint as the kitchen, so the shot library works unchanged.
 *  Plan (metres): room x -2.2..2.2, back wall z=-1.9, floor y=0.
 *    dresser: x -1.3..1.3, z -0.31..0.31, top y=TOP. You stand behind it (z≈-0.62) facing +z (the camera).
 *    on the dresser: the night lamp (LAMP, the story's own object), a phone (PHONE), the cat sits at CAT.
 *    behind you: the bed against the back wall, a window with a curtain (x=-0.9), an optional cot (x=1.45). */
export const TOP = 0.88;
export const LAMP: V3 = [-0.28, TOP, 0.04];
export const PHONE: V3 = [-0.07, TOP, 0.14];
export const CAT: V3 = [0.24, TOP, -0.04];
export const YOU_P: V3 = [-0.08, 0, -0.62];

const WALL = "#B9B4C6", FLOOR = "#5E4B3E", WOOD = "#7A5A44", LINEN = "#E9E4DA", BLANKET = "#6F86A6", CORD = "#2A2622";
const LAMP_H = 0.16;

export type BedroomProps = {
  /** the night lamp on the dresser: "on", "dim" (weak, yellow), "off" */ lamp?: "on" | "dim" | "off";
  /** its power cord: "in", or "loose" (the plug hangs half out of the socket strip on the dresser) */ cord?: "in" | "loose";
  /** the bed's blanket: "neat", "messy" (bunched to one side), "floor" (slid off) */ blanket?: "neat" | "messy" | "floor";
  /** curtain: "closed", or "gap" (a strip of street light falls across the bed) */ curtain?: "closed" | "gap";
  /** a baby cot beside the bed */ cot?: boolean;
  /** phone on the dresser; lit = its screen is on */ phone?: boolean; lit?: boolean;
  /** the product (a 3D model from src/custom.tsx) replaces the lamp */ product?: React.ReactNode;
  /** cold moonlight mood 0..1 (the twist) */ cold?: number;
  twist?: React.ReactNode;
  wall?: string;
  children?: React.ReactNode;
};

const Lamp: React.FC<Pick<BedroomProps, "lamp" | "cord">> = ({ lamp = "on", cord = "in" }) => {
  const glow = lamp === "on" ? 1 : lamp === "dim" ? 0.3 : 0;
  return (
    <group position={LAMP}>
      <Cy p={[0, 0.012, 0]} r={0.05} h={0.024} c="#D8D2C4" seg={32} />
      <Cy p={[0, 0.06, 0]} r={0.008} h={0.08} c="#B9BEC4" />
      <Cy p={[0, LAMP_H - 0.035, 0]} r={0.04} r2={0.062} h={0.075} c="#F3E3BE" e="#FFD9A0" ei={0.9 * glow} seg={32} />
      {glow > 0 ? <Glow p={[0, LAMP_H - 0.03, 0.02]} s={0.5} c="#FFD9A0" o={0.6 * glow} /> : null}
      {/* socket strip + plug. "loose": the plug is tilted and a gap of bare prong shows */}
      <Bx p={[-0.13, 0.012, 0.02]} s={[0.1, 0.024, 0.045]} c="#F1EFEA" />
      <group position={[-0.13, 0.024, 0.02]} rotation={[0, 0, cord === "loose" ? 0.42 : 0]}>
        {cord === "loose" ? <Bx p={[0, 0.006, 0]} s={[0.012, 0.014, 0.004]} c="#C9A455" /> : null}
        <Bx p={[0, cord === "loose" ? 0.024 : 0.012, 0]} s={[0.03, 0.024, 0.026]} c={CORD} />
      </group>
      <Bx p={[-0.07, 0.004, 0.02]} s={[0.1, 0.005, 0.005]} c={CORD} />
    </group>
  );
};

export const Bedroom: React.FC<BedroomProps> = ({ lamp = "on", cord, blanket = "neat", curtain = "closed", cot, phone, lit, product, cold = 0, twist, wall = WALL, children }) => {
  const glow = product ? 0.5 : lamp === "on" ? 1 : lamp === "dim" ? 0.3 : 0;
  const warm = (1 - cold * 0.75) * (0.35 + 0.65 * glow);
  return (
    <>
      <ambientLight intensity={0.3 + cold * 0.32} color={cold > 0.5 ? "#B9C8E8" : "#F1E2D6"} />
      <pointLight position={[LAMP[0], TOP + 0.3, 0.3]} intensity={1.3 * warm} distance={3.6} color="#FFD9A0" />
      <pointLight position={[-1.2, 1.7, -1.5]} intensity={0.5 + cold * 0.9 + (curtain === "gap" ? 0.5 : 0)} distance={4} color="#9DB6F0" />
      <pointLight position={[0.2, 1.5, 1.6]} intensity={0.5} distance={3.2} color={cold > 0.5 ? "#C8D8FF" : "#FFE6CC"} />
      {/* room */}
      <Pl p={[0, 0, 0]} s={[6, 6]} c={FLOOR} rx={-Math.PI / 2} />
      <Bx p={[0, 1.4, -1.95]} s={[4.6, 2.8, 0.1]} c={wall} />
      <Bx p={[-2.3, 1.4, 0]} s={[0.1, 2.8, 4]} c={wall} />
      <Bx p={[2.3, 1.4, 0]} s={[0.1, 2.8, 4]} c={wall} />
      <Bx p={[0.2, 0.012, -0.9]} s={[2.6, 0.02, 1.5]} c="#8C7A8E" />
      {/* window and curtain */}
      <Bx p={[-0.9, 1.6, -1.9]} s={[0.9, 1.0, 0.04]} c="#22314F" e="#31508A" ei={0.5} />
      {curtain === "gap" ? (
        <>
          <Bx p={[-1.2, 1.6, -1.86]} s={[0.4, 1.16, 0.04]} c="#7D6A86" />
          <Bx p={[-0.56, 1.6, -1.86]} s={[0.3, 1.16, 0.04]} c="#7D6A86" />
          <Glow p={[-0.86, 1.65, -1.82]} s={0.5} c="#DCE8FF" o={0.6} />
          <Pl p={[0.1, 0.565, -1.35]} s={[0.16, 0.9]} c="#C8D8FF" e="#C8D8FF" ei={0.5} rx={-Math.PI / 2} o={0.5} />
        </>
      ) : <Bx p={[-0.9, 1.6, -1.86]} s={[1.06, 1.16, 0.04]} c="#7D6A86" />}
      <Cy p={[-0.9, 2.2, -1.85]} r={0.012} h={1.2} c="#2A2622" rz={Math.PI / 2} />
      {/* bed against the back wall, headboard on the right */}
      <Bx p={[0.3, 0.2, -1.35]} s={[1.9, 0.4, 0.95]} c={WOOD} />
      <Bx p={[0.3, 0.48, -1.35]} s={[1.84, 0.16, 0.9]} c={LINEN} />
      <Bx p={[1.28, 0.7, -1.35]} s={[0.08, 1.0, 0.98]} c={WOOD} />
      <Sp p={[0.95, 0.62, -1.35]} r={0.2} c="#F6F2EA" sc={[1, 0.38, 1.5]} />
      {blanket === "neat" ? <Bx p={[-0.05, 0.585, -1.35]} s={[1.2, 0.05, 0.94]} c={BLANKET} /> : null}
      {blanket === "messy" ? (
        <>
          <Sp p={[-0.35, 0.62, -1.2]} r={0.3} c={BLANKET} sc={[1.2, 0.36, 0.9]} />
          <Sp p={[0.05, 0.6, -1.5]} r={0.22} c={BLANKET} sc={[1.1, 0.34, 0.8]} />
        </>
      ) : null}
      {blanket === "floor" ? <Sp p={[-0.5, 0.07, -0.72]} r={0.34} c={BLANKET} sc={[1.3, 0.2, 0.8]} /> : null}
      {/* cot */}
      {cot ? (
        <group position={[1.75, 0, -0.95]}>
          <Bx p={[0, 0.34, 0]} s={[0.62, 0.06, 1.0]} c="#F1EFEA" />
          <Bx p={[0, 0.4, 0]} s={[0.56, 0.06, 0.94]} c="#F6E7C8" />
          {[-0.3, 0.3].map((x) => <Bx key={x} p={[x, 0.52, 0]} s={[0.03, 0.42, 1.0]} c="#F1EFEA" o={0.9} />)}
          {[-0.49, 0.49].map((z) => <Bx key={z} p={[0, 0.52, z]} s={[0.62, 0.42, 0.03]} c="#F1EFEA" />)}
          {[[-0.28, -0.47], [0.28, -0.47], [-0.28, 0.47], [0.28, 0.47]].map(([x, z], i) => <Bx key={i} p={[x, 0.16, z]} s={[0.04, 0.32, 0.04]} c="#F1EFEA" />)}
        </group>
      ) : null}
      {/* dresser */}
      <Bx p={[0, 0.42, 0]} s={[2.6, 0.84, 0.6]} c={WOOD} />
      <Bx p={[0, TOP - 0.02, 0]} s={[2.7, 0.04, 0.66]} c="#8E6B52" />
      {[-0.85, 0, 0.85].map((x) => <Bx key={x} p={[x, 0.5, 0.305]} s={[0.78, 0.3, 0.012]} c="#8A6850" />)}
      {[-0.85, 0, 0.85].map((x) => <Cy key={x} p={[x, 0.5, 0.32]} r={0.016} h={0.02} c="#C9A455" rx={Math.PI / 2} />)}
      {product ? <group position={LAMP}>{product}</group> : <Lamp lamp={lamp} cord={cord} />}
      {twist ? <group position={PHONE}>{twist}</group> : phone ? (
        <group position={PHONE}>
          <Bx p={[0, 0.005, 0]} s={[0.072, 0.01, 0.15]} c="#17181D" />
          <Pl p={[0, 0.0105, 0]} s={[0.064, 0.14]} c={lit ? "#DCE8FF" : "#22252C"} e={lit ? "#BFD3FF" : "#000"} ei={lit ? 0.9 : 0} rx={-Math.PI / 2} />
          {lit ? <Glow p={[0, 0.05, 0]} s={0.3} c="#BFD3FF" o={0.45} /> : null}
        </group>
      ) : null}
      {children}
    </>
  );
};

export const ANCHORS = { you: YOU_P, pet: CAT, petRy: -0.7, petS: 0.82, subject: LAMP, subjectH: LAMP_H, aux: PHONE, top: TOP };
