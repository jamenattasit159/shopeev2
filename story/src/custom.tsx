// Per-clip 3D pieces. Written for ONE job (by Claude, or by hand) and copied to src/custom.tsx before rendering.
// Contract: export `Product` = a model of the product standing on the origin (y=0 is the counter top, about 0.15-0.2 m tall),
// taking `open` 0..1 for its lid/flap if it has one. Export `Product = null` to fall back to the real shop photo.
import React from "react";
import { Bx, Cy, Pl, textTex } from "./kit/three";

const STEEL = "#B9BEC4", POWDER = "#F4E9C8";

/** DODOLOVE jar (shape from the shop photos): square tea-tinted body full of powder, white lid with a flip top,
 *  the scoop held under the flip top by a magnet */
export const Product: React.FC<{ open?: number }> | null = ({ open = 0 }) => {
  const label = textTex("Dodo love", 512, 128, "#E2D6B4", "#3A352C", 84, "jar-label2");
  const H = 0.17, W = 0.135;
  return (
    <group>
      <Bx p={[0, H * 0.34, 0]} s={[W, H * 0.68, W]} c="#E2D6B4" />
      <Bx p={[0, H * 0.84, 0]} s={[W, H * 0.32, W]} c="#9C9483" />
      <Pl p={[0, H * 0.5, W / 2 + 0.003]} s={[0.09, 0.022]} c="#ffffff" map={label} />
      <Bx p={[0, H + 0.014, 0]} s={[W + 0.012, 0.028, W + 0.012]} c="#F1EFEA" />
      {/* flip top, hinged at the back edge */}
      <group position={[0, H + 0.03, -W * 0.42]} rotation={[-1.25 * open, 0, 0]}>
        <Bx p={[0, 0.006, W * 0.42]} s={[W * 0.86, 0.012, W * 0.86]} c="#FAF9F5" />
        <Bx p={[0, -0.004, W * 0.42]} s={[0.085, 0.006, 0.014]} c="#E9E6DE" />
        <Cy p={[0.04, -0.016, W * 0.42]} r={0.019} h={0.024} c="#E9E6DE" seg={24} />
        <Cy p={[-0.03, -0.002, W * 0.42]} r={0.008} h={0.006} c={STEEL} seg={16} />
      </group>
      {open > 0.3 ? <Bx p={[0, H + 0.022, 0.006]} s={[W * 0.8, 0.004, W * 0.72]} c={POWDER} /> : null}
    </group>
  );
};

