import type React from "react";
import type { V3 } from "../kit/three";
import { ANCHORS as KITCHEN_A, Kitchen } from "./kitchen";
import { ANCHORS as BEDROOM_A, Bedroom } from "./bedroom";
import { ANCHORS as BATHROOM_A, Bathroom } from "./bathroom";

/** what every set gives the shot library: where things are, so one set of cameras works in any room */
export type Anchors = { you: V3; pet: V3; petRy: number; petS: number; subject: V3; subjectH: number; aux: V3; top: number };
/** props every set understands; the rest is that set's own state (listed for the AI in app/src/story.rs) */
export type SetProps = { product?: React.ReactNode; twist?: React.ReactNode; wall?: string; cold?: number; children?: React.ReactNode } & Record<string, unknown>;
export type SetDef = { Set: React.FC<SetProps>; anchors: Anchors; walls: string[] };

export const SETS: Record<string, SetDef> = {
  kitchen: { Set: Kitchen as React.FC<SetProps>, anchors: KITCHEN_A, walls: ["#CDBB9C", "#C4C9B4", "#D6C2B0", "#BFC6CC"] },
  bedroom: { Set: Bedroom as React.FC<SetProps>, anchors: BEDROOM_A, walls: ["#B9B4C6", "#C9BBA8", "#A9B8C4", "#C6B3B3"] },
  bathroom: { Set: Bathroom as React.FC<SetProps>, anchors: BATHROOM_A, walls: ["#BFD3D2", "#D2D6C4", "#C4CCDA", "#D8CFC4"] },
};
export const setOf = (name: string | undefined): SetDef => SETS[name ?? "kitchen"] ?? SETS.kitchen;
