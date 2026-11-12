// 1930s rubber-hose page for Story Ad: the three rooms of the 3D library redrawn as a black-and-white cartoon
// (engine: ./engine, MIT © LemoLab). Portrait world 1080×1920; a shot = a camera on the page. Every object breathes on the beat,
// the cast has pie eyes and white gloves, and the real product photo is the only colour in the film.
import * as T from './engine/toon.js';
import { P, pieEye, mouth, glove, hose, brow } from './engine/chars.js';
import { hash, mulberry, vnoise } from './engine/lib.js';

const { shape, stroke, ell, spline, rr, rect } = T;
export const TOP = 1180;
export const YOU = [470, TOP];
export const SUBJ = [330, TOP];
export const AUX = [585, TOP];
export const PET = [830, TOP];
const BEAT = 16; // frames per beat at 30 fps: every beat lands on a drawing (characters on twos)

export function camOf(shot, f) {
  const c = {
    wide: [540, 1000, 0.95], face: [YOU[0], 900, 2.0], subject: [SUBJ[0], 1070, 2.3], 'subject-close': [SUBJ[0] + 10, 1030, 3.4],
    top: [SUBJ[0], 1020, 2.9], pet: [PET[0], 1050, 2.3], 'pet-subject': [(SUBJ[0] + PET[0]) / 2, 1070, 1.45], aux: [AUX[0], 1090, 2.7],
    product: [SUBJ[0], 1050, 2.1], 'product-open': [SUBJ[0], 1050, 2.3],
  }[shot] ?? [540, 1000, 0.95];
  return [c[0], c[1], c[2] * (1 + 0.0014 * f)];
}

/** squash-and-stretch on the beat, sampled on twos; drawn around a point on the floor of the object */
function breathe(f, k = 1) { const ff = f - (f % 2); return Math.cos((ff / BEAT) * Math.PI * 2) * 0.055 * k; }
function atBase(x, y, b, fn) { T.push(); T.translate(x, y); T.scale(1 - b * 0.5, 1 + b); fn(); T.pop(); }

/* ─── rooms: painted greys, never boil ─── */
function wash(pts, col, seed) {
  const g = T.g, Pth = shape(pts, { fill: col, stroke: false, boil: 0 });
  const rnd = mulberry(seed);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clip(Pth); g.filter = 'blur(10px)';
  const s = pts.map((p) => T.tx(p[0], p[1])), xs = s.map((p) => p[0]), ys = s.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let i = 0; i < 24; i++) { g.fillStyle = rnd() > 0.5 ? `rgba(30,28,25,${0.03 + rnd() * 0.05})` : `rgba(255,253,245,${0.03 + rnd() * 0.05})`; g.beginPath(); g.ellipse(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 40 + rnd() * 120, 30 + rnd() * 80, rnd() * 3, 0, 7); g.fill(); }
  g.filter = 'none'; g.restore();
  T.outline(Pth, 3.2, '#2A2927');
}
function room(set, st, f) {
  wash(rect(-300, -300, 1680, 1600), set === 'bathroom' ? P.light : P.mid, 3);
  // wallpaper motif
  for (let y = 60; y < 1280; y += 150) for (let x = (y / 150) % 2 ? 70 : 0; x < 1100; x += 140) stroke(ell(x, y, 16, 16), 2.5, { boil: 0, line: P.dmid });
  wash(rect(-300, 1300, 1680, 900), P.dmid, 5);
  for (let x = -300; x < 1400; x += 120) stroke([[x, 1300], [x - 160, 2200]], 3, { boil: 0, line: P.dark }); // checker-ish floor boards
  if (set !== 'bathroom') {
    const [x0, y0] = set === 'bedroom' ? [640, 340] : [90, 360];
    wash(rr(x0, y0, 330, 330, 18), P.dark, 7);
    shape(ell(x0 + 230, y0 + 100, 40, 40), { fill: P.pale, lw: 3, boil: 0 });
    stroke([[x0 + 165, y0], [x0 + 165, y0 + 330]], 6, { boil: 0 });
    if (set === 'bedroom') {
      const gap = st.curtain === 'gap' ? 70 : 6;
      wash(rect(x0 - 30, y0 - 20, 195 - gap, 380), P.pale, 8);
      wash(rect(x0 + 165 + gap, y0 - 20, 195 - gap, 380), P.pale, 9);
    }
  }
  const b = breathe(f, 0.5);
  if (set === 'kitchen') {
    stroke([[600, 520], [1000, 520]], 7, { boil: 0 });
    [650, 760, 880].forEach((x, i) => atBase(x, 515, b, () => { shape(rr(-28, -84, 56, 84, 10), { fill: [P.light, P.pale, P.mid][i], lw: 4 }); pieEye(-9, -48, 7, 10, { lwk: 0.5 }); pieEye(9, -48, 7, 10, { lwk: 0.5 }); }));
  }
  if (set === 'bedroom') {
    wash(rect(560, 880, 520, 300), P.pale, 11);
    if (st.blanket !== 'floor') wash(st.blanket === 'messy' ? spline([[560, 960], [700, 900], [820, 960], [980, 910], [1080, 980], [1080, 1180], [560, 1180]]) : rect(560, 980, 520, 200), P.light, 12);
    else wash(spline([[620, 1330], [780, 1300], [960, 1340], [1000, 1420], [640, 1440]]), P.light, 13);
    if (st.cot) for (let i = 0; i < 7; i++) stroke([[60 + i * 30, 940], [60 + i * 30, 1180]], 5, { boil: 0 });
  }
  if (set === 'bathroom') {
    wash(rr(160, 300, 460, 560, 30), st.mirror === 'fog' ? P.paper : P.pale, 14);
    stroke([[760, 520], [1020, 520]], 7, { boil: 0 });
    wash(st.towel === 'floor' ? spline([[760, 1340], [960, 1320], [1010, 1400], [780, 1420]]) : rect(790, 520, 200, 300), P.white, 15);
    if (st.mold) { const rnd = mulberry(4); for (let i = 0; i < 16; i++) shape(ell(80 + rnd() * 900, 1000 + rnd() * 260, 8 + 12 * rnd(), 6 + 8 * rnd()), { fill: P.dark, stroke: false, alpha: 0.6 * Number(st.mold), boil: 0 }); }
  }
}
function front(set) {
  wash(rect(30, TOP, 1020, 460), set === 'bathroom' ? P.pale : P.light, 21);
  shape(rect(10, TOP - 24, 1060, 26), { fill: P.white, lw: 5, boil: 0 });
  if (set === 'bedroom') for (const y of [1320, 1480]) { stroke([[60, y], [1020, y]], 4, { boil: 0 }); shape(ell(540, y + 70, 14, 14), { fill: P.dark, lw: 3, boil: 0 }); }
  if (set === 'kitchen') stroke([[540, TOP + 30], [540, 1640]], 4, { boil: 0 });
  if (set === 'bathroom') { shape(ell(540, TOP - 8, 150, 26), { fill: P.pale, lw: 5, boil: 0 }); stroke(spline([[500, TOP - 30], [500, TOP - 90], [560, TOP - 92]], false), 9, { boil: 0 }); }
}

/* ─── object characters: the story's thing and the aux prop, each with a face ─── */
function face(x, y, s, mood) {
  const type = mood === 'shock' ? 'wide' : mood === 'sleep' ? 'shut' : 'open';
  pieEye(x - 18 * s, y, 13 * s, 18 * s, { type }); pieEye(x + 18 * s, y, 13 * s, 18 * s, { type });
  mouth(x, y + 34 * s, 30 * s, mood === 'shock' ? 'o' : mood === 'sad' ? 'frown' : mood === 'sleep' ? 'flat' : 'smile');
}
function subject(set, st, f, mood, label) {
  const b = breathe(f);
  atBase(SUBJ[0], SUBJ[1], b, () => {
    if (set === 'kitchen') {
      shape(rr(-72, -175, 144, 175, 14), { fill: P.white, lw: 6 });
      if (label) T.text(label, 0, -40, { font: '400 30px Itim', fill: P.ink });
      if (st.board) { shape(rr(120, -20, 210, 20, 6), { fill: P.light, lw: 4 }); if (st.raw) shape(spline([[170, -20], [230, -44], [290, -22], [230, -16]]), { fill: P.dmid, lw: 4 }); }
      if (st.stain) for (let i = 0; i < 5; i++) shape(ell(-90 + hash(i) * 200, -2, 14 + 10 * hash(i + 2), 5), { fill: P.dark, stroke: false, alpha: 0.6 * Number(st.stain) });
      const lid = st.lid ?? 'ajar';
      if (lid === 'off') {
        shape(ell(0, -176, 64, 12), { fill: P.pale, lw: 5 });
        if (st.scoop) stroke([[-10, -180], [34, -228]], 10);
        if (st.clump) for (let i = 0; i < 4; i++) shape(ell(-36 + i * 24, -180, 9 + 6 * Number(st.clump), 7), { fill: P.light, lw: 3 });
        shape(ell(-140, -8, 76, 14), { fill: P.dark, lw: 5 });
      } else {
        T.push(); T.translate(-76, -176); T.rotate(lid === 'ajar' ? -0.16 : 0);
        shape(rr(0, -24, 152, 26, 8), { fill: P.dark, lw: 6 });
        T.pop();
        if (lid === 'ajar') shape([[-70, -176], [70, -176], [74, -198]], { fill: P.ink, stroke: false });
      }
      face(0, -120, 1, mood);
    } else if (set === 'bedroom') {
      const on = (st.lamp ?? 'on') !== 'off';
      if (on) for (let i = 0; i < 3; i++) shape(ell(0, -220, 150 - i * 30, 120 - i * 24), { fill: P.white, stroke: false, alpha: st.lamp === 'dim' ? 0.06 : 0.12 });
      shape(rr(-16, -150, 32, 150, 8), { fill: P.dark, lw: 5 });
      shape([[-110, -150], [110, -150], [70, -290], [-70, -290]], { fill: on ? P.white : P.light, lw: 6 });
      face(0, -225, 0.9, mood);
      const plug = st.cord === 'loose' ? [190, -30] : [190, -14];
      stroke(spline([[0, -4], [80, 8], [150, -6], plug], false), 5);
      shape(rr(170, -40, 90, 40, 6), { fill: P.pale, lw: 4 });
      shape(rr(plug[0] - 18, plug[1] - 22, 28, 26, 4), { fill: P.dark, lw: 4 });
      if (st.cord === 'loose') { stroke([[plug[0] + 10, plug[1] - 14], [plug[0] + 26, plug[1] - 14]], 4); stroke([[plug[0] + 10, plug[1] - 4], [plug[0] + 26, plug[1] - 4]], 4); }
    } else {
      const cap = st.cap ?? 'on';
      shape(spline([[-60, 0], [-64, -120], [-40, -170], [40, -170], [64, -120], [60, 0]]), { fill: P.white, lw: 6 });
      if (label) T.text(label, 0, -30, { font: '400 26px Itim', fill: P.ink });
      const head = cap === 'off' ? [-150, -30] : [0, -200];
      T.push(); T.translate(head[0], head[1]); T.rotate(cap === 'open' ? 0.4 : 0);
      shape(rr(-22, -30, 44, 60, 8), { fill: P.dark, lw: 5 });
      if (cap !== 'off') stroke([[0, -30], [50, -34]], 9);
      T.pop();
      if (st.leak) shape(ell(20, 4, 110, 16), { fill: P.light, lw: 3 });
      face(0, -100, 0.9, mood);
    }
  });
  if (set === 'bathroom' && st.tap === 'drip') shape(ell(540, TOP - 40 + ((f * 4) % 40), 7, 10), { fill: P.white, lw: 3 });
}
function aux(set, st, f) {
  const b = breathe(f, 0.8);
  atBase(AUX[0], AUX[1], b, () => {
    if ((set === 'kitchen' || set === 'bathroom') && st.cup) {
      shape([[-44, -130], [44, -130], [36, 0], [-36, 0]], { fill: P.pale, lw: 6 });
      if (st.lumps) for (let i = 0; i < 4; i++) shape(ell(-24 + i * 16, -120, 9, 7), { fill: P.light, lw: 3 });
      if (st.slime) shape(rect(-32, -40, 64, 36), { fill: P.mid, stroke: false, alpha: 0.7 });
      if (set === 'bathroom') { stroke([[-10, -120], [-24, -220]], 9); stroke([[12, -120], [26, -210]], 9); }
    }
    if (set === 'bedroom' && st.phone) { shape(rr(-36, -16, 72, 16, 4), { fill: P.ink, lw: 4 }); if (st.lit) shape(ell(0, -8, 60, 30), { fill: P.white, stroke: false, alpha: 0.35 }); }
  });
}

/* ─── cast: you (rubber-hose human) and the cat ─── */
const POSE = {
  rest: { eye: 'open', m: 'smile', arm: 'down' }, sleepy: { eye: 'open', lid: 0.55, m: 'flat', arm: 'down' }, look: { eye: 'wide', m: 'o', arm: 'down' },
  reach: { eye: 'open', m: 'smile', arm: 'reach' }, dig: { eye: 'open', m: 'wavy', arm: 'dig', brow: 'sad' }, shock: { eye: 'wide', m: 'wavy', arm: 'up', brow: 'up' },
  relief: { eye: 'happy', m: 'grin', arm: 'down' },
};
function you(pose, f, seed) {
  const p = POSE[pose] ?? POSE.rest, b = breathe(f, 0.6), [x] = YOU, sh = TOP - 120;
  const shirt = [P.white, P.pale, P.light][seed % 3];
  atBase(x, TOP + 80, b, () => {
    // arms first (behind the body), then the body, head, gloves on top
    const L = [-80, sh - TOP - 70], R = [80, sh - TOP - 70];
    const handR = p.arm === 'reach' ? [-120, -40] : p.arm === 'dig' ? [-140, -10] : p.arm === 'up' ? [150, -360] : [140, -40];
    const handL = p.arm === 'up' ? [-150, -360] : [-140, -40];
    hose(L, handL, 30, 22); hose(R, handR, -30, 22);
    shape(spline([[-95, -200], [95, -200], [120, 40], [-120, 40]]), { fill: shirt, lw: 6 });
    const hy = -330;
    shape(ell(0, hy, 110, 104), { fill: P.white, lw: 6 });
    shape(spline([[-110, hy - 10], [-90, hy - 90], [0, hy - 120], [90, hy - 90], [110, hy - 10], [60, hy - 70], [0, hy - 80], [-60, hy - 70]]), { fill: P.ink, lw: 5 });
    pieEye(-36, hy + 4, 22, 32, { type: p.eye, lid: p.lid, lidCol: P.white });
    pieEye(36, hy + 4, 22, 32, { type: p.eye, lid: p.lid, lidCol: P.white });
    if (p.brow) { brow(-36, hy - 44, 34, p.brow, -1); brow(36, hy - 44, 34, p.brow, 1); }
    shape(ell(0, hy + 44, 10, 8), { fill: P.ink, stroke: false });
    mouth(0, hy + 70, 54, p.m);
    glove(handL[0], handL[1], Math.atan2(handL[1] - L[1], handL[0] - L[0]), p.arm === 'up' ? 'open' : 'fist', 1.4);
    glove(handR[0], handR[1], Math.atan2(handR[1] - R[1], handR[0] - R[0]), p.arm === 'dig' ? 'grab' : p.arm === 'reach' ? 'point' : p.arm === 'up' ? 'open' : 'fist', 1.4, { flip: true });
  });
}
function cat(pose, f, seed) {
  const b = breathe(f, pose === 'sleep' ? 0.4 : 1), body = [P.ink, P.dmid, P.mid][seed % 3], [x, y] = PET;
  atBase(x, y, b, () => {
    stroke(spline([[60, -20], [130, -60], [150, -150], [120, -180]], false), 16, { line: body });
    shape(ell(0, -80, 80, 80), { fill: body, lw: 6 });
    shape(ell(0, -55, 40, 46), { fill: P.white, lw: 4 });
    const hy = pose === 'sleep' ? -150 : -190;
    shape([[-62, hy - 20], [-50, hy - 96], [-10, hy - 50]], { fill: body, lw: 5 });
    shape([[62, hy - 20], [50, hy - 96], [10, hy - 50]], { fill: body, lw: 5 });
    shape(ell(0, hy, 68, 62), { fill: body, lw: 6 });
    shape(ell(0, hy + 22, 44, 30), { fill: P.white, stroke: false });
    const t = pose === 'sleep' ? 'shut' : pose === 'stare' ? 'wide' : 'open';
    pieEye(-24, hy - 6, 15, 21, { type: t }); pieEye(24, hy - 6, 15, 21, { type: t });
    shape(ell(0, hy + 18, 8, 6), { fill: P.ink, stroke: false });
    [-1, 1].forEach((k) => stroke([[k * 20, hy + 26], [k * 72, hy + 18]], 3));
  });
}

/** fit an image into a w×h box, keeping its shape */
function fitBox(img, w, h) { const k = Math.min(w / img.width, h / img.height); return [img.width * k, img.height * k]; }

/** the real product in colour, standing with its base at (x, y) screen px. A cut-out gets a thick ink outline traced round
 *  its own silhouette (it reads as a drawn object); a plain photo falls back to a framed picture. */
function product(g, o, x, y, boxW, boxH, b) {
  const img = o.cutout ?? o.photo;
  if (!img) return;
  const [w, h] = fitBox(img, boxW, boxH);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.save();
  g.translate(x, y); g.scale(1 - b * 0.5, 1 + b); // breathes on the beat like everything else
  if (o.cutout) {
    const lw = Math.max(5, w * 0.018);
    // four hard drop-shadows in ink = an outline that follows the cut-out's own edge
    g.filter = `drop-shadow(${lw}px 0 0 ${P.ink}) drop-shadow(-${lw}px 0 0 ${P.ink}) drop-shadow(0 ${lw}px 0 ${P.ink}) drop-shadow(0 -${lw}px 0 ${P.ink})`;
    g.drawImage(img, -w / 2, -h, w, h);
    g.filter = 'none';
    g.drawImage(img, -w / 2, -h, w, h);
  } else {
    g.fillStyle = P.white; g.fillRect(-w / 2 - 16, -h - 16, w + 32, h + 32);
    g.lineWidth = 6; g.strokeStyle = P.ink; g.strokeRect(-w / 2 - 16, -h - 16, w + 32, h + 32);
    g.drawImage(img, -w / 2, -h, w, h);
  }
  g.restore();
}

/** the reveal shot: curtains part on a stage, a spotlight finds the product, a title card names it */
function reveal(g, o) {
  const f = o.f, pop = Math.min(1, o.product ?? 1), open = Math.min(1, f / 14);
  T.BASE.splice(0, 6, 1, 0, 0, 1, 0, 0);
  T.frame(f / 30, { amp: 1.1 });
  wash(rect(-100, -100, 1300, 2200), P.dark, 31);
  wash(rect(-100, 1460, 1300, 700), P.dmid, 32); // stage floor
  // spotlight cone + pool
  g.setTransform(1, 0, 0, 1, 0, 0);
  const cone = g.createLinearGradient(540, 0, 540, 1500);
  cone.addColorStop(0, 'rgba(255,253,240,0.05)'); cone.addColorStop(1, 'rgba(255,253,240,0.28)');
  g.fillStyle = cone; g.beginPath(); g.moveTo(470, 0); g.lineTo(610, 0); g.lineTo(920, 1185); g.lineTo(160, 1185); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,253,240,0.45)'; g.beginPath(); g.ellipse(540, 1185, 380, 80, 0, 0, 7); g.fill();
  // curtains slide open; their folds are ink strokes
  for (const side of [-1, 1]) {
    const edge = 540 + side * (40 + 520 * open), x0 = side < 0 ? -100 : edge, x1 = side < 0 ? edge : 1200;
    shape(rect(x0, -100, x1 - x0, 2200), { fill: P.mid, lw: 6, boil: 0.4 });
    for (let k = 1; k < 5; k++) stroke([[x0 + (x1 - x0) * k / 5, -100], [x0 + (x1 - x0) * k / 5 + side * 20, 2100]], 4, { line: P.dark });
  }
  shape(rect(-100, -100, 1300, 230), { fill: P.dark, lw: 6, boil: 0 }); // valance
  for (let x = -60; x < 1200; x += 120) shape(T.arc(x + 60, 130, 60, 40, 0, Math.PI, 12), { fill: P.dark, lw: 5, boil: 0 });
  // the product pops in on the beat
  const s = 0.4 + 0.6 * Math.min(1, pop * 1.15), b = breathe(f, 0.8);
  product(g, o, 540, 1180, 520 * s, 760 * s, b); // base above the caption band (y ≈ 1230); narrow enough to leave room for the labels
  if (o.shot === 'price') { if (o.price) ticket(g, o.price, f); }
  else (o.features ?? []).forEach((t, i) => callout(g, t, i, f));
  // title card with the brand, period style
  if (o.brand && f > 8) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.save(); g.translate(540, 300); g.rotate(-0.03);
    g.fillStyle = P.ink; g.fillRect(-380, -70, 760, 140);
    g.strokeStyle = P.white; g.lineWidth = 4; g.strokeRect(-366, -56, 732, 112); g.strokeRect(-356, -46, 712, 92);
    g.fillStyle = P.white; g.font = '400 76px Itim'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(o.brand, 0, 4, 700);
    g.restore();
  }
}

/** a feature label in a period plate with an ink arrow to the product; they pop in one after another */
function callout(g, text, i, f) {
  const at = 16 + i * 10;
  if (f < at) return;
  const pop = Math.min(1, (f - at) / 5), left = i % 2 === 0;
  const y = [560, 820, 1040][i] ?? 560, x = left ? 160 : 920, tip = [left ? 330 : 750, y + 70];
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.save();
  g.translate(x, y); g.scale(pop, pop); g.rotate(left ? -0.05 : 0.05);
  g.font = '400 46px Itim';
  const w = Math.min(290, g.measureText(text).width + 40);
  g.fillStyle = P.white; g.strokeStyle = P.ink; g.lineWidth = 6;
  g.beginPath(); g.roundRect(-w / 2, -36, w, 72, 14); g.fill(); g.stroke();
  g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 2, w - 24);
  g.restore();
  if (pop < 1) return;
  // the arrow: a curved ink line from the plate to the product with a filled head
  const sx = x + (left ? 90 : -90), sy = y + 30, mx = (sx + tip[0]) / 2, my = Math.min(sy, tip[1]) - 50;
  g.strokeStyle = P.ink; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(mx, my, tip[0], tip[1]); g.stroke();
  const a = Math.atan2(tip[1] - my, tip[0] - mx);
  g.fillStyle = P.ink; g.beginPath(); g.moveTo(tip[0] + Math.cos(a) * 14, tip[1] + Math.sin(a) * 14);
  g.lineTo(tip[0] + Math.cos(a + 2.5) * 22, tip[1] + Math.sin(a + 2.5) * 22); g.lineTo(tip[0] + Math.cos(a - 2.5) * 22, tip[1] + Math.sin(a - 2.5) * 22); g.fill();
}

/** the price as a 1930s admission ticket: notched corners, double rule, big numerals; it stamps in on the beat */
function ticket(g, price, f) {
  const pop = Math.min(1, Math.max(0, (f - 8) / 6)), s = 0.6 + 0.4 * pop + (pop >= 1 ? breathe(f, 0.6) : 0);
  if (pop <= 0) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.save(); g.translate(760, 1000); g.rotate(-0.12); g.scale(s, s);
  const w = 420, h = 200, r = 26;
  g.beginPath();
  g.moveTo(-w / 2 + r, -h / 2); g.lineTo(w / 2 - r, -h / 2); g.arc(w / 2, -h / 2, r, Math.PI, Math.PI / 2, true);
  g.lineTo(w / 2, h / 2 - r); g.arc(w / 2, h / 2, r, -Math.PI / 2, Math.PI, true); g.lineTo(-w / 2 + r, h / 2);
  g.arc(-w / 2, h / 2, r, 0, -Math.PI / 2, true); g.lineTo(-w / 2, -h / 2 + r); g.arc(-w / 2, -h / 2, r, Math.PI / 2, 0, true); g.closePath();
  g.fillStyle = P.white; g.fill(); g.strokeStyle = P.ink; g.lineWidth = 8; g.stroke();
  g.lineWidth = 3; g.strokeRect(-w / 2 + 34, -h / 2 + 22, w - 68, h - 44);
  g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '400 112px Itim'; g.fillText('฿' + price, 0, 10, w - 90);
  g.restore();
}

/** draw one frame. o: shot, set, state, you, pet, noPet, seed, label, brand, photo / cutout (Image or null), product (0..1 pop), f (frame) */
export function drawPage(g, o) {
  T.init(g.canvas);
  if (o.shot === 'product' || o.shot === 'product-open' || o.shot === 'price') return reveal(g, o);
  const [cx, cy, z] = camOf(o.shot, o.f);
  T.BASE.splice(0, 6, z, 0, 0, z, 540 - cx * z, 960 - cy * z);
  T.frame(o.f / 30, { amp: 1.1 });
  const st = o.state ?? {}, f = o.f;
  room(o.set, st, f);
  aux(o.set, st, f);
  const showPhoto = o.product !== undefined || Boolean(st.product);
  // once the product is here, you look pleased with it instead of standing blank behind it
  you(showPhoto && (!o.you || o.you === 'rest') ? 'relief' : (o.you ?? 'rest'), f, o.seed);
  front(o.set);
  const mood = o.you === 'shock' ? 'shock' : st.cold ? 'sad' : 'rest';
  if (!showPhoto) subject(o.set, st, f, mood, o.label);
  if (!o.noPet) cat(o.pet ?? 'stare', f, o.seed);
  if (showPhoto) {
    // the real product, in colour: the one thing in this black-and-white world that is in colour.
    // It stands on the counter where the story's object stood, sized like a real object, clear of your face.
    const [px, py] = T.tx(SUBJ[0] - 60, TOP + 6);
    product(g, o, px, py, 340 * z, 420 * z, breathe(f));
  }
  if (st.cold) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = `rgba(10,10,12,${0.35 * Number(st.cold)})`; g.fillRect(0, 0, T.W, T.H); }
}

/** worn-print pass over the finished frame: weave, flicker, scratches, dust, vignette (period look) */
export function post(dst, src, f) {
  const g = dst, t = f / 30, W = T.W, H = T.H;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const wx = (vnoise(t * 1.3) - 0.5) * 2.4, wy = (vnoise(t * 1.1 + 40) - 0.5) * 2.6;
  g.save(); g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 34); g.clip();
  g.filter = 'blur(0.55px) contrast(1.14) grayscale(0)'; g.drawImage(src, wx, wy); g.filter = 'none';
  const fl = (hash(f * 1.618) - 0.5) * 0.08;
  g.fillStyle = fl > 0 ? `rgba(255,252,240,${fl})` : `rgba(0,0,0,${-fl})`; g.fillRect(0, 0, W, H);
  const seg = Math.floor(t * 2.3);
  for (let i = 0; i < 3; i++) {
    if (hash(seg * 13.7 + i * 3.1) < 0.45) continue;
    const sx = hash(seg * 5.3 + i) * W + Math.sin(t * 7 + i) * 6, y0 = hash(seg * 3 + i) * H * 0.5;
    g.strokeStyle = hash(seg + i * 9) > 0.4 ? 'rgba(245,242,230,.5)' : 'rgba(10,10,8,.45)'; g.lineWidth = 0.8 + hash(seg * 2 + i) * 1.4;
    g.beginPath(); g.moveTo(sx, y0); g.lineTo(sx + (hash(f + i) - 0.5) * 3, y0 + H * (0.4 + hash(seg + i * 5) * 0.6)); g.stroke();
  }
  const nd = 3 + Math.floor(hash(f * 2.7) * 6);
  for (let i = 0; i < nd; i++) { g.fillStyle = hash(f * 1.3 + i) > 0.35 ? 'rgba(12,11,10,.75)' : 'rgba(250,248,240,.7)'; g.beginPath(); g.ellipse(hash(f * 11.1 + i * 1.7) * W, hash(f * 17.3 + i * 2.9) * H, 1 + hash(f + i * 4.4) * 3, 1 + hash(i) * 2, 0, 0, 7); g.fill(); }
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
  g.restore();
}
