import React from "react";
import { useCurrentFrame } from "remotion";
import { EP, SANS, fr, lin } from "../kit/ui";

/** "ตอนที่แล้ว" strip over the first seconds (episode.json "prev"), so someone who lands on a middle episode can follow.
 *  Sits above the RuleSign (top 210); shows nothing when "prev" is empty (episode 1). */
export function Recap({ len = 3.2 }: { len?: number }) {
  const f = useCurrentFrame();
  if (!EP.prev || f >= fr(len)) return null;
  const o = Math.min(lin(f, 0, 8, 0, 1), lin(f, fr(len) - 10, fr(len), 1, 0));
  return (
    <div style={{ position: "absolute", top: 28, left: 40, right: 40, opacity: o, fontFamily: SANS, background: "rgba(8,9,14,0.82)", borderLeft: `10px solid ${EP.color}`, borderRadius: 12, padding: "12px 24px 16px", color: "#F2EEE6" }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: EP.color }}>{`${EP.series} · ตอนที่แล้ว`}</div>
      <div style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.25 }}>{EP.prev}</div>
    </div>
  );
}
