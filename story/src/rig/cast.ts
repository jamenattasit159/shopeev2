import type { Look } from "./char";

/* ─────────────────────────────────────────────────────────────────────────────
   YOUR CAST. One Look per character, written from a text character card
   (see the code-rig-characters skill: references/character-card.md).
   Keep every value here; never edit a character inside a shot, or continuity breaks.

   Fields
     skin / hairC / iris / brow / top / pants / shoes / sole / socks / trim  colours (hex)
     hair      "short" | "pony" | "messy" | "spiky" | "bob"   hairR (0.45 glossy .. 0.8 matte), hairLen (bob length)
     outfit    "tee" | "hoodie" | "shirt" | "coat" | "scrubs" | "uniform" | "blouse" | "jersey"
     face      "dots" (default: two small dark eyes) | "big" (cartoon eyes: eyeW/eyeH/irisK/iris apply)
     build     body proportions, default SLIM { leg 1.38, arm 1.32, torso 1.12, girth 0.82, limb 0.72, neck 1.6 }
               (1 = the rig's base unit). Change these + headS to find YOUR figure.
     headS     head scale (0.9-1.0 with SLIM)      height  overall scale (0.86-0.94 adult, ~0.7 child)
     extras    glasses, clip (hair clip colour), band (headband colour), backpack (colour),
               phones (headphones colour), patch, fangs, lips, holdR ("flashlight" | "phone" | "tape" | "keys")
   ───────────────────────────────────────────────────────────────────────────── */

/** the narrator's "you": dark tee, blue jeans, white sneakers, ponytail */
export const YOU: Look = { skin: "#E3B996", hair: "pony", hairC: "#1E1A18", iris: "#2A211C", eyeW: 1, eyeH: 1, outfit: "tee", top: "#2B2C31", pants: "#4D6C93", shoes: "#F1F0EC", sole: "#D6D3CC", brow: "#2A2420", height: 0.88 };

/** friend: short hair, olive hoodie, grey trousers */
export const FRIEND: Look = { skin: "#D9A67E", hair: "short", hairC: "#211C19", iris: "#2A211C", eyeW: 1, eyeH: 1, outfit: "hoodie", top: "#7C8762", pants: "#55575D", shoes: "#2A2A2E", sole: "#E4E1DA", brow: "#2A2420", height: 0.9 };

/** older neighbour: light shirt, glasses, grey hair */
export const ADULT: Look = { skin: "#D3A07A", hair: "short", hairC: "#8C8A86", iris: "#2E2620", eyeW: 0.95, eyeH: 0.9, outfit: "shirt", top: "#B9C9D6", pants: "#5B5F68", shoes: "#2A2420", sole: "#141210", glasses: true, brow: "#6A6864", height: 0.92 };

/** child: bob hair, yellow tee, shorter build and a slightly bigger head */
export const CHILD: Look = { skin: "#E6BE9C", hair: "bob", hairC: "#1C1816", iris: "#2A211C", eyeW: 1.05, eyeH: 1.05, outfit: "tee", top: "#E2B54E", pants: "#3F5677", shoes: "#E9E6DE", brow: "#2A2420", hairLen: 0.09, hairR: 0.8, headS: 1.08, height: 0.68 };

/** long dark coat, pale, narrow red eyes, fangs (a villain silhouette) */
export const COAT: Look = { skin: "#D5DFE6", hair: "bob", hairC: "#111216", iris: "#6A1016", eyeW: 1.0, eyeH: 0.5, face: "big", outfit: "coat", top: "#17181D", pants: "#17181D", shoes: "#141418", fangs: true, lips: "#6E1A22", brow: "#16161A", height: 0.95 };

/** scrubs (nurse / doctor) */
export const SCRUBS: Look = { skin: "#E2B48E", hair: "short", hairC: "#1E1A18", iris: "#2E2620", eyeW: 1, eyeH: 1, outfit: "scrubs", top: "#4E9C97", pants: "#4E9C97", shoes: "#EDEFF0", brow: "#2A2420", height: 0.9 };

/** any Look turned infected: grey-green skin, pale eyes. Add pose { blood: 1 } only if your series allows gore. */
export const infected = (L: Look): Look => ({ ...L, skin: "#9DB08E", iris: "#C9CFC0", brow: "#3A4034", ...(L.outfit === "blouse" ? { pants: "#9DB08E" } : {}) });


/* ─── เวรดึก cast ─── */
/** คุณ: new night nurse, white scrubs, dark bob, pen light in the pocket (scrubs pocket) */
export const NURSE: Look = { skin: "#E3B996", hair: "bob", hairC: "#1C1816", iris: "#2A211C", eyeW: 1, eyeH: 1, outfit: "scrubs", top: "#EEF1F0", pants: "#E4E8E7", shoes: "#F4F4F2", brow: "#2A2420", hairLen: 0.1, hairR: 0.75, height: 0.88 };
/** คุณ on the phone */
export const NURSE_PHONE: Look = { ...NURSE, holdR: "phone" };
/** พี่แหวว: senior nurse, grey cardigan over white trousers, hair tied back, pale; patient wristband (the twist) */
export const WAEW: Look = { skin: "#DCC3AE", hair: "pony", hairC: "#241E1B", iris: "#1E1A18", eyeW: 1, eyeH: 0.95, outfit: "shirt", top: "#80858C", pants: "#E4E8E7", shoes: "#F2F2F0", brow: "#2A2420", wrist: "#F6F6F2", height: 0.9 };

/** คุณ from ep02 on: the guard's radio clipped on the chest (recurring object) */
export const NURSE_RADIO: Look = { ...NURSE, radio: "#1E1F24" };
/** ลุงเปี๊ยก: night guard, 60s, grey crew cut, navy uniform with a gold badge, big flashlight, radio on the chest */
export const PIAK: Look = { skin: "#C8946E", hair: "short", hairC: "#A19D96", iris: "#2A211C", eyeW: 0.95, eyeH: 0.85, outfit: "uniform", top: "#34425C", pants: "#262C3A", shoes: "#1A1816", sole: "#0E0D0C", trim: "#D9B24A", brow: "#8A8680", holdR: "flashlight", radio: "#1E1F24", height: 0.92 };

/** characters shown by the Turn-<id> QA comps (4 views + face). Add every new character here. */
export const CAST: Record<string, Look> = { you: NURSE_RADIO, waew: WAEW, piak: PIAK };
