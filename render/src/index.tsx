// Entry: one composition, fully driven by props.json written by the Rust app.
import React from "react";
import { AbsoluteFill, Audio, Composition, Sequence, registerRoot, staticFile, useCurrentFrame } from "remotion";
import { Beat, Ctx, FONTS, PALETTES } from "./kit";
import { SCENES, SCENE_SFX } from "./scenes";
import { Cover } from "./cover";

type Props = {
  seed: number; palette: string; product: Ctx["product"]; cutout: string | null; images: string[];
  bgm: string | null; beats: Beat[]; totalFrames: number;
};

const Flash: React.FC<{ cuts: number[] }> = ({ cuts }) => {
  const frame = useCurrentFrame();
  const since = Math.min(99, ...cuts.map((c) => (frame >= c ? frame - c : 99)));
  return <AbsoluteFill style={{ background: "#fff", opacity: since < 4 ? 0.7 - since * 0.18 : 0 }} />;
};

const Clip: React.FC<Props> = (p) => {
  const ctx: Ctx = {
    seed: p.seed, pal: PALETTES[p.palette] ?? PALETTES.sky, font: FONTS[p.seed % FONTS.length],
    cutout: p.cutout, images: p.images, product: p.product,
  };
  const cuts = p.beats.slice(1).map((b) => b.from);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {p.beats.map((b, i) => {
        const Scene = SCENES[b.scene] ?? SCENES.bigword;
        return (
          <Sequence key={i} from={b.from} durationInFrames={b.frames}>
            <Scene beat={b} ctx={ctx} />
            {b.audio && <Audio src={staticFile(b.audio)} />}
            {(SCENE_SFX[b.scene] ?? []).map(([f, at], k) => (
              <Sequence key={k} from={Math.round(b.frames * at)} durationInFrames={30}><Audio src={staticFile(`sfx/${f}`)} volume={0.8} /></Sequence>
            ))}
          </Sequence>
        );
      })}
      <Flash cuts={cuts} />
      {cuts.map((c) => <Sequence key={c} from={Math.max(0, c - 2)} durationInFrames={20}><Audio src={staticFile("sfx/sfx-whoosh.mp3")} volume={0.5} /></Sequence>)}
      {p.bgm && <Audio src={staticFile(p.bgm)} volume={0.12} loop />}
    </AbsoluteFill>
  );
};

const defaults: Props = { seed: 1, palette: "sky", product: { name: "" }, cutout: null, images: [], bgm: null, beats: [], totalFrames: 30 };

registerRoot(() => (
  <>
    <Composition
      id="Clip" component={Clip} width={1080} height={1920} fps={30} durationInFrames={30} defaultProps={defaults}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.totalFrames) })}
    />
    <Composition id="Cover" component={Cover} width={1080} height={1920} fps={30} durationInFrames={1} defaultProps={defaults} />
  </>
));
