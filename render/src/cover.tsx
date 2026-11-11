import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Beat, Ctx, FONTS, INK, PALETTES, Sunburst, fit } from "./kit";

type CoverProps = Pick<Ctx, "seed" | "product" | "images" | "cutout"> & {
  palette: string;
  beats: Beat[];
};

export const Cover: React.FC<CoverProps> = (props) => {
  const { seed, product, beats, images, cutout } = props;
  const palette = PALETTES[props.palette] ?? PALETTES.sky;
  const fontFamily = FONTS[seed % FONTS.length];
  const [hook, secondLine] = (beats[0]?.text ?? []).map((line) => line.trim()).filter(Boolean);
  const headline = hook || product.name;
  const src = cutout || images[0];

  return (
    <AbsoluteFill style={{ fontFamily, color: INK }}>
      <Sunburst from={palette.light} to={palette.deep} />
      <div style={{ position: "absolute", inset: "180px 88px auto", textAlign: "center", fontWeight: 900 }}>
        <div style={{
          fontSize: hook ? fit(headline, 113, 900) : 73,
          lineHeight: 1.14, color: "#fff", WebkitTextStroke: "10px #111", paintOrder: "stroke fill",
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", padding: "10px 8px 14px",
        }}>{headline}</div>
        {secondLine && <div style={{
          display: "inline-block", marginTop: 24, background: palette.pop, border: "8px solid #111", borderRadius: 28,
          padding: "6px 28px 15px", fontSize: fit(secondLine, 105, 825), lineHeight: 1.08,
          transform: "rotate(-3deg)", boxShadow: "10px 12px 0 #111",
        }}>{secondLine}</div>}
      </div>
      {src && <div style={{
        position: "absolute", left: 100, right: 100, top: 580, height: 900, borderRadius: 58,
        boxSizing: "border-box", background: "#fffdf8", border: "12px solid #fff",
        boxShadow: "0 28px 0 rgba(0,0,0,.18), 0 45px 100px rgba(0,0,0,.26)", transform: "rotate(2deg)",
        overflow: "hidden", padding: cutout ? 42 : 0,
      }}>
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>}
      {product.brand && <div style={{
        position: "absolute", top: 1585, left: 100, right: 100, textAlign: "center", fontWeight: 900,
        fontSize: fit(product.brand, 61, 800), letterSpacing: 8, color: "#fff", textShadow: "0 5px 0 rgba(0,0,0,.45)",
      }}>{product.brand.toUpperCase()}</div>}
    </AbsoluteFill>
  );
};
