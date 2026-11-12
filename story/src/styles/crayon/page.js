// Crayon Picture Book page for Story Ad: the three rooms of the 3D library redrawn in wax crayon (engine: ./engine, MIT © LemoLab).
// One portrait page (1080×1920 world px). A shot = a camera on that page. Everything the AI can set in a plan (set state, poses,
// product on the counter, cold light) has a drawing here, so the same film.json renders in 3D or in crayon.
import { line, fill, dab, ellipse, handCircle, smooth, CAM, BOIL, clear } from './engine/crayon.js';
import { part, tube, curve, group, clearGroup } from './engine/rig.js';
import { girl } from './engine/chars.js';
import { layer } from './engine/crayon.js';
import { hash } from './engine/lib.js';

const K = {
  ink: '#2d3263', paper: '#f4efe3', yellow: '#f5c63c', orange: '#ec8a3c', red: '#d4483c', pink: '#ee8ea4', peach: '#f4c7a4',
  brown: '#7a4b31', ochre: '#e7b867', green: '#62a24c', sky: '#79acd9', violet: '#6a5aa6', white: '#fbfaf4', grey: '#9a9aa6', teal: '#4fa3a0',
};
/* page plan (world px): the surface everyone stands behind; the counter front hides the body below it */
export const TOP = 1180;
export const YOU = [470, 1500];
export const SUBJ = [330, TOP];
export const AUX = [585, TOP];
export const PET = [830, TOP];
const WALLS = { kitchen: [K.ochre, K.sky, K.pink, K.green], bedroom: [K.violet, K.sky, K.pink, K.ochre], bathroom: [K.teal, K.sky, K.green, K.ochre] };
const CATS = [[K.orange, K.white], [K.grey, K.white], ['#3a3540', K.white], [K.white, K.peach]];

/** camera per shot: [x, y, zoom]; every shot pushes in a little */
export function camOf(shot, f) {
  const c = {
    wide: [540, 1010, 0.95], face: [YOU[0], 930, 2.1], subject: [SUBJ[0], 1080, 2.4], 'subject-close': [SUBJ[0] + 10, 1040, 3.6],
    top: [SUBJ[0], 1030, 3.0], pet: [PET[0], 1060, 2.4], 'pet-subject': [(SUBJ[0] + PET[0]) / 2, 1080, 1.45], aux: [AUX[0], 1100, 2.8],
    product: [SUBJ[0], 1060, 2.2], 'product-open': [SUBJ[0], 1060, 2.4],
  }[shot] ?? [540, 1010, 0.95];
  return [c[0], c[1], c[2] * (1 + 0.0016 * f)];
}

const lo = (seed, x = {}) => ({ w: 7, seed, col: K.ink, ...x });
const hatch = (col, seed, x = {}) => ({ col, p: 0.6, gap: 11, w: 12, ang: 0.5, seed, ...x });
// starts mid-top: the engine closes an outline by drawing back to the 2nd point, which must lie on the same edge
const rect = (x0, y0, x1, y1) => [[(x0 + x1) / 2, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

export function makeLayers() {
  return { BG: { f: layer(), l: layer() }, PEOPLE: group(), PET: group(), FRONT: group(), PROPS: group(), FX: layer(), WASH: layer(), PHOTO: layer(), OVER: layer(), labels: [] };
}
export function clearLayers(L) {
  clear(L.BG.f); clear(L.BG.l); clear(L.FX); clear(L.WASH); clear(L.PHOTO); clear(L.OVER);
  clearGroup(L.PEOPLE); clearGroup(L.PET); clearGroup(L.FRONT); clearGroup(L.PROPS);
}

/* ─── rooms ─── */
function room(L, set, st, seed) {
  const wall = WALLS[set][seed % 4];
  fill(L.BG.f, rect(-200, -200, 1280, 1300), hatch(wall, 11, { p: 0.32, gap: 16, w: 14 }));
  fill(L.BG.f, rect(-200, 1300, 1280, 2200), hatch(K.brown, 12, { p: 0.45, gap: 14, ang: 0.15 }));
  line(L.BG.l, [[-200, 1300], [1280, 1300]], lo(13, { w: 6, p: 0.7 }));
  // a window with the moon: the night is in every room
  const win = set === 'bathroom' ? null : set === 'bedroom' ? [640, 360, 1000, 760] : [90, 380, 400, 700];
  if (win) {
    const [x0, y0, x1, y1] = win;
    fill(L.BG.f, rect(x0, y0, x1, y1), hatch(K.violet, 14, { p: 0.85, gap: 8, w: 10 }));
    dab(L.BG.f, x0 + (x1 - x0) * 0.68, y0 + (y1 - y0) * 0.32, 38, { col: K.yellow, p: 0.95, seed: 15 });
    line(L.BG.l, [...rect(x0, y0, x1, y1), [x0, y0]], lo(16, { w: 8 }));
    line(L.BG.l, [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]], lo(17, { w: 6 }));
    if (set === 'bedroom') {   // curtains: closed, or a gap that lets moonlight onto the bed
      const gap = st.curtain === 'gap' ? 70 : 8;
      const mid = (x0 + x1) / 2;
      fill(L.BG.f, rect(x0 - 30, y0 - 20, mid - gap, y1 + 40), hatch(K.pink, 18, { p: 0.75 }));
      fill(L.BG.f, rect(mid + gap, y0 - 20, x1 + 30, y1 + 40), hatch(K.pink, 19, { p: 0.75 }));
      line(L.BG.l, [[mid - gap, y0 - 20], [mid - gap - 6, y1 + 40]], lo(20, { w: 5 }));
      line(L.BG.l, [[mid + gap, y0 - 20], [mid + gap + 6, y1 + 40]], lo(21, { w: 5 }));
    }
  }
  if (set === 'kitchen') {
    // shelf with jars, a fridge
    line(L.BG.l, [[600, 520], [1000, 520]], lo(30, { w: 9, col: K.brown }));
    [[650, K.red], [760, K.green], [880, K.orange]].forEach(([x, c], i) => { fill(L.BG.f, rect(x - 30, 430, x + 30, 515), hatch(c, 31 + i, { p: 0.7 })); line(L.BG.l, [...rect(x - 30, 430, x + 30, 515), [x - 30, 430]], lo(34 + i, { w: 5 })); });
  }
  if (set === 'bedroom') {
    // the bed behind the dresser, its blanket
    fill(L.BG.f, rect(560, 900, 1060, 1180), hatch(K.white, 40, { p: 0.7 }));
    const bl = st.blanket === 'floor' ? null : st.blanket === 'messy' ? smooth([[560, 960], [700, 900], [820, 960], [980, 910], [1060, 980], [1060, 1180], [560, 1180]], 4) : rect(560, 980, 1060, 1180);
    if (bl) { fill(L.BG.f, bl, hatch(K.sky, 41, { p: 0.8 })); line(L.BG.l, [...bl, bl[0]], lo(42, { w: 6 })); }
    if (st.blanket === 'floor') { const b = smooth([[620, 1330], [780, 1300], [960, 1340], [1000, 1420], [640, 1440]], 4); fill(L.BG.f, b, hatch(K.sky, 43, { p: 0.8 })); line(L.BG.l, [...b, b[0]], lo(44, { w: 6 })); }
    line(L.BG.l, [...rect(560, 860, 1060, 1180)], lo(45, { w: 8, col: K.brown }));
    if (st.cot) { line(L.BG.l, [[60, 900], [60, 1180]], lo(46, { w: 7, col: K.brown })); for (let i = 0; i < 6; i++) line(L.BG.l, [[60 + i * 30, 940], [60 + i * 30, 1180]], lo(47 + i, { w: 4, col: K.brown, p: 0.7 })); }
  }
  if (set === 'bathroom') {
    // tiles, a mirror (clear or fogged), a towel rail
    for (let y = 120; y < 1300; y += 110) line(L.BG.l, [[-100, y], [1180, y]], lo(50 + y, { w: 3, p: 0.35, wob: 2 }));
    for (let x = 0; x < 1180; x += 110) line(L.BG.l, [[x, 0], [x, 1300]], lo(60 + x, { w: 3, p: 0.35, wob: 2 }));
    const m = rect(160, 300, 620, 860);
    fill(L.BG.f, m, hatch(st.mirror === 'fog' ? K.white : K.sky, 70, { p: st.mirror === 'fog' ? 0.9 : 0.5, gap: st.mirror === 'fog' ? 6 : 14 }));
    line(L.BG.l, [...m, m[0]], lo(71, { w: 9 }));
    line(L.BG.l, [[760, 520], [1020, 520]], lo(72, { w: 8, col: K.grey }));
    const towel = st.towel === 'floor' ? smooth([[760, 1340], [960, 1320], [1010, 1400], [780, 1420]], 4) : rect(790, 520, 990, 820);
    fill(L.BG.f, towel, hatch(K.pink, 73, { p: 0.8 })); line(L.BG.l, [...towel, towel[0]], lo(74, { w: 6 }));
    if (st.mold) for (let i = 0; i < 18; i++) dab(L.BG.f, 80 + hash(i) * 900, 1000 + hash(i + 9) * 260, 6 + 10 * hash(i + 3), { col: '#2f3a2c', p: 0.5 * Number(st.mold), seed: 75 + i });
  }
}

/** the surface in front of you (counter / dresser / vanity): its knock-out hides your body below it */
function front(L, set, seed) {
  const col = set === 'kitchen' ? K.brown : set === 'bedroom' ? K.ochre : K.white;
  const body = rect(30, TOP, 1050, 1640);
  part(L.FRONT, body, hatch(col, 80 + seed % 7, { p: 0.42, gap: 16 }), lo(81, { w: 9 }));
  part(L.FRONT, rect(10, TOP - 22, 1070, TOP + 4), hatch(set === 'kitchen' ? K.white : col, 82, { p: 0.8, gap: 7, w: 9 }), lo(83, { w: 7 }), { occ: false });
  if (set === 'bedroom') for (const y of [1320, 1480]) { line(L.FRONT.l, [[60, y], [1020, y]], lo(84 + y, { w: 5 })); dab(L.FRONT.l, 540, y + 70, 12, { col: K.brown, seed: 85 + y }); }
  if (set === 'kitchen') line(L.FRONT.l, [[540, TOP + 30], [540, 1640]], lo(86, { w: 5, p: 0.6 }));
  if (set === 'bathroom') { part(L.FRONT, ellipse(540, TOP - 6, 150, 26, 30), hatch(K.sky, 87, { p: 0.6 }), lo(88, { w: 6 }), { occ: false }); line(L.FRONT.l, curve([[500, TOP - 30], [500, TOP - 90], [560, TOP - 92]]), lo(89, { w: 8, col: K.grey })); }
}

/* ─── the thing the story is about (kitchen tin, bedroom lamp, bathroom bottle) and the aux prop ─── */
function subject(L, set, st, label) {
  const [x, y] = SUBJ, P = L.PROPS;
  if (set === 'kitchen') {
    const body = rect(x - 70, y - 170, x + 70, y);
    part(P, body, hatch(K.yellow, 100, { p: 0.75 }), lo(101));
    part(P, rect(x - 70, y - 120, x + 70, y - 50), hatch(K.white, 102, { p: 0.9, gap: 8 }), lo(103, { w: 5 }), { occ: false });
    if (label) L.labels.push({ text: label, x, y: y - 85, size: 34 });
    if (st.board) { part(P, rect(x + 120, y - 18, x + 330, y), hatch(K.ochre, 104), lo(105, { w: 5 })); if (st.raw) part(P, smooth([[x + 170, y - 20], [x + 230, y - 44], [x + 290, y - 22], [x + 230, y - 16]], 4), hatch(K.red, 106, { p: 0.85 }), lo(107, { w: 5 })); }
    if (st.stain) for (let i = 0; i < 6; i++) dab(P.f, x - 90 + hash(i) * 200, y - 6 + hash(i + 4) * 10, 10 + 14 * hash(i + 2), { col: K.brown, p: 0.6 * Number(st.stain), seed: 108 + i, sq: 0.35 });
    const lid = st.lid ?? 'ajar';
    if (lid === 'off') {
      fill(P.f, ellipse(x, y - 172, 62, 12, 24), hatch(K.white, 110, { p: 0.95, gap: 5, w: 7 }));
      if (st.scoop) line(P.l, [[x - 10, y - 176], [x + 34, y - 220]], lo(111, { w: 10, col: K.sky }));
      if (st.clump) for (let i = 0; i < 4; i++) dab(P.f, x - 36 + i * 24, y - 176, 9 + 6 * Number(st.clump), { col: K.ochre, p: 0.9, seed: 112 + i });
      part(P, ellipse(x - 130, y - 8, 74, 14, 24), hatch(K.sky, 113, { p: 0.8 }), lo(114, { w: 6 }), { occ: false });
    } else {
      // the planted detail: "ajar" tilts the lid up on one side and leaves a dark gap
      const tilt = lid === 'ajar' ? 0.16 : 0;
      const lidPts = rect(x - 76, y - 196, x + 76, y - 170).map(([px, py]) => { const dx = px - (x - 76), dy = py - (y - 170); return [x - 76 + dx * Math.cos(tilt) + dy * Math.sin(tilt), y - 170 - dx * Math.sin(tilt) + dy * Math.cos(tilt)]; });
      if (tilt) fill(P.f, [[x - 70, y - 170], [x + 70, y - 170], [x + 74, y - 192]], { col: K.ink, p: 1, gap: 3, w: 5, seed: 115 });
      part(P, lidPts, hatch(K.sky, 116, { p: 0.85 }), lo(117), { occ: false });
    }
  } else if (set === 'bedroom') {
    const on = (st.lamp ?? 'on') !== 'off', dim = st.lamp === 'dim';
    if (on) for (let i = 0; i < 5; i++) dab(L.FX, x, y - 210, 140 - i * 22, { col: K.yellow, p: (dim ? 0.12 : 0.22), seed: 120 + i });
    part(P, rect(x - 18, y - 150, x + 18, y), hatch(K.brown, 121), lo(122));
    const shade = [[x - 110, y - 150], [x + 110, y - 150], [x + 70, y - 290], [x - 70, y - 290]];
    part(P, shade, hatch(on ? K.yellow : K.ochre, 123, { p: dim ? 0.55 : 0.85 }), lo(124));
    const plug = st.cord === 'loose' ? [x + 190, y - 30] : [x + 190, y - 14];
    line(P.l, curve([[x, y - 4], [x + 80, y + 8], [x + 150, y - 6], plug]), lo(125, { w: 5 }));
    part(P, rect(x + 170, y - 40, x + 260, y), hatch(K.white, 126, { p: 0.9 }), lo(127, { w: 5 }), { occ: false });
    part(P, rect(plug[0] - 18, plug[1] - 22, plug[0] + 10, plug[1] + 4), hatch(K.grey, 128, { p: 0.9 }), lo(129, { w: 4 }), { occ: false });
    if (st.cord === 'loose') { line(P.l, [[plug[0] + 10, plug[1] - 14], [plug[0] + 26, plug[1] - 14]], lo(130, { w: 4, col: K.yellow })); line(P.l, [[plug[0] + 10, plug[1] - 4], [plug[0] + 26, plug[1] - 4]], lo(131, { w: 4, col: K.yellow })); }
  } else {
    const cap = st.cap ?? 'on';
    part(P, smooth([[x - 60, y], [x - 64, y - 120], [x - 40, y - 170], [x + 40, y - 170], [x + 64, y - 120], [x + 60, y]], 4), hatch(K.pink, 140, { p: 0.8 }), lo(141));
    if (label) L.labels.push({ text: label, x, y: y - 80, size: 30 });
    const head = cap === 'off' ? [x - 150, y - 30] : [x, y - 200];
    const r = cap === 'open' ? 0.4 : 0;
    part(P, rect(head[0] - 22, head[1] - 30, head[0] + 22, head[1] + 30).map(([px, py]) => [head[0] + (px - head[0]) * Math.cos(r) - (py - head[1]) * Math.sin(r), head[1] + (px - head[0]) * Math.sin(r) + (py - head[1]) * Math.cos(r)]), hatch(K.white, 142, { p: 0.95 }), lo(143), { occ: false });
    if (cap !== 'off') line(P.l, [[head[0], head[1] - 30], [head[0] + 50, head[1] - 34]], lo(144, { w: 9 }));
    if (st.leak) part(P, ellipse(x + 20, y + 4, 110, 16, 24), hatch(K.pink, 145, { p: 0.5 }), lo(146, { w: 4, p: 0.6 }), { occ: false });
    if (st.tap === 'drip') dab(L.FX, 540, TOP - 40 + ((BOIL.step * 7) % 40), 7, { col: K.sky, seed: 147 });
  }
}
function aux(L, set, st) {
  const [x, y] = AUX, P = L.PROPS;
  if ((set === 'kitchen' || set === 'bathroom') && st.cup) {
    part(P, [[x - 44, y - 130], [x + 44, y - 130], [x + 36, y], [x - 36, y]], hatch(K.sky, 150, { p: 0.4 }), lo(151));
    if (st.lumps) for (let i = 0; i < 4; i++) dab(P.f, x - 24 + i * 16, y - 120, 9, { col: K.ochre, p: 0.95, seed: 152 + i });
    if (st.slime) part(P, rect(x - 32, y - 40, x + 32, y - 4), hatch(K.green, 156, { p: 0.7 }), null, { occ: false });
    if (set === 'bathroom') { line(P.l, [[x - 10, y - 120], [x - 24, y - 220]], lo(157, { w: 9, col: K.red })); line(P.l, [[x + 12, y - 120], [x + 26, y - 210]], lo(158, { w: 9, col: K.green })); }
  }
  if (set === 'bedroom' && st.phone) {
    part(P, rect(x - 36, y - 16, x + 36, y), hatch(K.ink, 160, { p: 0.9 }), lo(161, { w: 5 }));
    if (st.lit) for (let i = 0; i < 3; i++) dab(L.FX, x, y - 8, 50 - i * 14, { col: K.white, p: 0.4, seed: 162 + i });
  }
}

/* ─── cast ─── */
const EXPR = { rest: 'awake', sleepy: 'sleepy', look: 'wide', reach: 'awake', dig: 'worried', shock: 'surprised', relief: 'happy' };
function you(L, pose, seed) {
  const s = 2.2, R = pose === 'reach' || pose === 'dig' ? [[34, -182], [-20, -150], [-70, pose === 'dig' ? -110 : -140]] : undefined;
  girl(L.PEOPLE, { x: YOU[0], y: YOU[1], s, view: 'front', pose: 'stand', expr: EXPR[pose] ?? 'awake', seed: 200 + (seed % 3), arms: R ? { R } : {} });
}
function cat(L, pose, seed) {
  const [x, y] = PET, [fur, chest] = CATS[seed % CATS.length], C = L.PET, sd = 300;
  const crouch = pose === 'sleep' ? 0.5 : 0;
  part(C, tube(curve([[x + 60, y - 20], [x + 130, y - 60], [x + 140, y - 140]]), 18), hatch(fur, sd, { p: 0.85 }), lo(sd + 1));
  part(C, ellipse(x, y - 80 + crouch * 30, 80, 80 - crouch * 30, 36), hatch(fur, sd + 2, { p: 0.85 }), lo(sd + 3));
  part(C, ellipse(x - 10, y - 60 + crouch * 30, 34, 44 - crouch * 14, 24), hatch(chest, sd + 4, { p: 0.95 }), null, { occ: false });
  const hy = y - 190 + crouch * 70;
  part(C, [[x - 62, hy - 20], [x - 50, hy - 92], [x - 10, hy - 52]], hatch(fur, sd + 5, { p: 0.85 }), lo(sd + 6));
  part(C, [[x + 62, hy - 20], [x + 50, hy - 92], [x + 10, hy - 52]], hatch(fur, sd + 7, { p: 0.85 }), lo(sd + 8));
  part(C, handCircle(x, hy, 66, sd + 9, 0.05), hatch(fur, sd + 10, { p: 0.85 }), lo(sd + 11));
  if (pose === 'sleep') [-24, 24].forEach((dx, i) => line(C.l, [[x + dx - 12, hy - 4], [x + dx, hy + 4], [x + dx + 12, hy - 4]], lo(sd + 12 + i, { w: 5 })));
  else [-24, 24].forEach((dx, i) => { dab(C.l, x + dx, hy - 4, pose === 'stare' ? 12 : 9, { col: K.ink, p: 1, seed: sd + 14 + i }); dab(C.l, x + dx + 3, hy - 8, 3, { col: K.white, p: 1, seed: sd + 16 + i }); });
  dab(C.f, x, hy + 16, 7, { col: K.pink, p: 0.9, seed: sd + 18 });
  [-1, 1].forEach((k, i) => line(C.l, [[x + k * 20, hy + 20], [x + k * 70, hy + 12]], lo(sd + 19 + i, { w: 3, p: 0.6 })));
}

/** draw one frame of the page. o: set, state, you, pet, noPet, product (number = the product photo stands in for the subject), seed, label */
export function drawPage(L, o) {
  clearLayers(L);
  L.labels = [];
  const st = o.state ?? {};
  room(L, o.set, st, o.seed);
  if (o.product === undefined && !st.product) subject(L, o.set, st, o.label);
  aux(L, o.set, st);
  you(L, o.you ?? 'rest', o.seed);
  front(L, o.set, o.seed);
  if (!o.noPet) cat(L, o.pet ?? 'stare', o.seed);
  if (st.cold) fill(L.WASH, rect(-300, -300, 1400, 2300), { col: '#ffffff', p: 0.55 * Number(st.cold), gap: 30, w: 60, over: 0, seed: 400 });
}
export { K, CAM };

/** a feature label's crayon arrow (the words are written by the view in the hand font); true once it should show */
export function drawCallout(L, i, f) {
  const at = 16 + i * 10;
  if (f < at) return false;
  const left = i % 2 === 0, y = [560, 820, 1040][i] ?? 560, sx0 = left ? 200 : 880, tip = [left ? 330 : 750, y + 70];
  const draw = Math.min(1, (f - at) / 8);
  line(L.OVER, [[sx0, y + 30], [(sx0 + tip[0]) / 2, y - 10], tip], lo(600 + i, { w: 7, col: K.red, draw }));
  if (draw >= 1) line(L.OVER, [[tip[0] + (left ? -22 : 22), tip[1] - 18], tip, [tip[0] + (left ? -26 : 26), tip[1] + 12]], lo(610 + i, { w: 6, col: K.red }));
  return true;
}
/** the price tag: a red crayon circle scribbled in, then the price is written on it in white wax (the view writes the digits) */
export function drawPriceTag(L, f) {
  const draw = Math.min(1, Math.max(0, (f - 6) / 10));
  if (draw <= 0) return;
  fill(L.OVER, handCircle(770, 1000, 150, 700, 0.1), hatch(K.red, 701, { p: 0.95, gap: 9, draw }));
  line(L.OVER, handCircle(770, 1000, 154, 702, 0.12), lo(703, { w: 8, draw }));
}

/** the reveal page: a fresh page, a yellow scribbled burst for the product to stand on, an underline for the name */
export function drawReveal(L, f) {
  clearLayers(L);
  L.labels = [];
  const burst = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 330 : 430; burst.push([540 + Math.cos(a) * r, 860 + Math.sin(a) * r]); }
  fill(L.FX, burst, hatch(K.yellow, 500, { p: 0.7, gap: 13, draw: Math.min(1, f / 12) }));
  line(L.FX, [...burst, burst[1]], lo(501, { w: 7, col: K.orange, draw: Math.min(1, f / 12) }));
  line(L.FX, [[260, 330], [820, 316]], lo(502, { w: 10, col: K.red, draw: Math.min(1, Math.max(0, (f - 10) / 8)) }));
}
