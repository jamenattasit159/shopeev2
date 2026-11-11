import React from "react";
import { AbsoluteFill } from "remotion";
import { Film } from "./Film";
import { EP, RED, SANS } from "./kit/ui";

/** Cover = the film without captions + the title near the top, inside the 3:4 / 4:5 crop IG and Facebook grids show (y 240–1680): series name (big, in the series colour from episode.json "color"),
 *  "ตอนที่ n/of · title", then the rule in a red pill — so a profile grid shows at a glance which clip belongs to which series.
 *  The comp is as long as the film; render ONE frame: npx remotion still src/index.ts Cover out/cover.png --frame=<episode.json coverFrame>
 *  (A 1-frame comp with <Freeze> does not mount later Sequences and shows the wrong shot.)
 *  Pick a frame where a face shows emotion and nothing important sits under the title. */
const shadow = "0 4px 18px rgba(0,0,0,0.75)";
export const Cover: React.FC = () => (
  <AbsoluteFill>
    <Film noCaps />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,6,12,0.9) 0%, rgba(5,6,12,0.75) 34%, rgba(5,6,12,0.45) 42%, transparent 54%)" }} />
    <div style={{ position: "absolute", top: 330, left: 0, right: 0, textAlign: "center", fontFamily: SANS }}>
      {EP.of > 1 ? (
        <>
          <div style={{ color: EP.color, fontSize: 150, fontWeight: 800, lineHeight: 1.1, textShadow: shadow }}>{EP.series}</div>
          <div style={{ color: "#F6F4EE", fontSize: 68, fontWeight: 700, lineHeight: 1.25, marginTop: 6, textShadow: shadow }}>
            <span style={{ color: EP.color }}>{`ตอนที่ ${EP.ep}/${EP.of}`}</span>{` · ${EP.title}`}
          </div>
        </>
      ) : (
        // a single ad: the story's title carries the cover
        <div style={{ color: EP.color, fontSize: 112, fontWeight: 800, lineHeight: 1.15, padding: "0 60px", textShadow: shadow }}>{EP.title}</div>
      )}
      <div style={{ display: "inline-block", marginTop: 20, background: RED, color: "#FFF6EE", fontSize: 70, fontWeight: 700, padding: "4px 30px 10px", borderRadius: 14 }}>{EP.rule}</div>
    </div>
  </AbsoluteFill>
);
