"use strict";
// Story Ad page: paste a link, watch the job, review the draft scene by scene, confirm to export.

const $ = (id) => document.getElementById(id);
const STATES = { queued: "รอคิว", running: "กำลังทำ", review: "รอตรวจ", done: "ส่งออกแล้ว", error: "ล้มเหลว" };
const STATE_CLASS = { queued: "queued", running: "running", review: "waiting", done: "done", error: "error" };
const STEPS = ["เตรียมรูป", "เขียนบท", "พากย์เสียง", "จับเวลา", "โมเดลสินค้า", "เรนเดอร์", "รวมร่าง"];
const SET_NAMES = { kitchen: "ครัว", bedroom: "ห้องนอน", bathroom: "ห้องน้ำ" };

let jobs = [];
let selected = new URLSearchParams(location.search).get("job") || "";
let detail = null;
let scene = 1; // 1-based, the scene being looked at
let shownKey = ""; // what the review panel currently shows; it is only rebuilt when this changes
let stopAt = null; // seconds: where "play this scene" stops

async function api(path, options = {}) {
  if (typeof options.body === "string") options = { ...options, headers: { "content-type": "application/json" } };
  const response = await fetch(path, options);
  if (response.status === 204) return;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "เกิดข้อผิดพลาด (" + response.status + ")");
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}
function button(label, className, iconName, onClick) {
  const b = el("button", "button " + (className || ""));
  b.type = "button";
  if (iconName) b.append(icon(iconName));
  b.append(el("span", "", label));
  b.addEventListener("click", onClick);
  return b;
}
function say(node, text, isError) {
  node.textContent = text;
  node.dataset.error = isError ? "true" : "false";
}
const file = (id, path, stamp) => "/files/" + encodeURIComponent(id) + "/" + path + (stamp ? "?v=" + stamp : "");

/* ─── job list ─── */

function renderJobs() {
  $("job-count").textContent = jobs.length;
  $("jobs-empty").hidden = jobs.length > 0;
  $("jobs-empty").textContent = "ยังไม่มีงาน วางลิงก์สินค้าด้านบนเพื่อเริ่ม";
  const list = $("jobs");
  list.replaceChildren(...jobs.map((job) => {
    const card = el("button", "job story-job");
    card.type = "button";
    card.dataset.state = job.state === "review" ? "queued" : job.state;
    card.setAttribute("aria-current", String(job.id === selected));
    card.append(el("h3", "", job.title || job.id));
    const meta = el("div", "job-meta");
    meta.append(el("span", "status " + (STATE_CLASS[job.state] || ""), STATES[job.state] || job.state));
    if (job.state === "running" || job.state === "queued") meta.append(el("span", "", job.stage));
    if (job.seconds) meta.append(el("span", "", job.seconds.toFixed(1) + " วินาที"));
    card.append(meta);
    card.addEventListener("click", () => select(job.id));
    return card;
  }));
}

function select(id) {
  selected = id;
  scene = 1;
  shownKey = "";
  history.replaceState(null, "", id ? "?job=" + encodeURIComponent(id) : location.pathname);
  renderJobs();
  loadDetail();
}

/* ─── review panel ─── */

async function loadDetail() {
  if (!selected) return;
  try {
    detail = await api("/api/story/" + encodeURIComponent(selected));
  } catch (error) {
    // the job was asked for but the extension has not delivered the product yet
    detail = null;
    const waiting = !jobs.some((j) => j.id === selected);
    showMessage(waiting ? "กำลังรอข้อมูลสินค้าจากส่วนขยาย Chrome เปิดแท็บสินค้าที่เพิ่งเปิดขึ้นมาค้างไว้ งานจะเริ่มเองเมื่อได้ข้อมูล" : error.message);
    return;
  }
  const job = detail.job;
  const key = [job.id, job.state, job.stage, job.error, detail.stamp, job.warnings.join("|")].join("§");
  if (key === shownKey) return;
  shownKey = key;
  renderReview();
}

function showMessage(text) {
  if (shownKey === "msg:" + text) return;
  shownKey = "msg:" + text;
  $("review").replaceChildren(el("p", "hint", text));
}

function head(job) {
  const box = el("div", "review-head");
  const title = el("div");
  title.append(el("h2", "", (detail.script && detail.script.title) || job.title || job.id));
  const meta = el("div", "job-meta");
  meta.append(el("span", "status " + (STATE_CLASS[job.state] || ""), STATES[job.state] || job.state));
  if (job.seconds) meta.append(el("span", "", "ยาว " + job.seconds.toFixed(1) + " วินาที"));
  if (detail.script) meta.append(el("span", "", "ฉาก" + (SET_NAMES[detail.script.set || "kitchen"] || detail.script.set)));
  if (job.state === "review" || job.state === "done") meta.append(el("span", "", detail.model3d ? "สินค้าเป็นโมเดล 3 มิติ" : "สินค้าเป็นรูปจริงในกรอบ"));
  if (job.provider) meta.append(el("span", "", "บทโดย " + job.provider));
  title.append(meta);
  box.append(title);
  return box;
}

function progress(job) {
  const box = el("div", "progress");
  const current = Number((job.stage.match(/^(\d)\/7/) || [])[1] || 0);
  const steps = el("ol", "steps seven");
  STEPS.forEach((name, i) => steps.append(el("li", i + 1 < current ? "done" : i + 1 === current ? "current" : "", name)));
  box.append(el("p", "", job.stage), steps);
  box.append(el("p", "hint", "ทั้งงานใช้เวลาหลายนาที ปิดหน้านี้ได้ งานยังทำต่อ"));
  return box;
}

function warnings(job) {
  if (!job.warnings.length) return null;
  const box = el("div", "warnings");
  box.append(el("strong", "", "ตรวจก่อนยืนยัน"));
  const list = el("ul");
  job.warnings.forEach((w) => list.append(el("li", "", w)));
  box.append(list);
  return box;
}

function describeCut(cut) {
  const parts = [cut.shot];
  if (cut.you) parts.push("คุณ:" + cut.you);
  if (cut.pet) parts.push("แมว:" + cut.pet);
  if (cut.card && cut.card.type) parts.push("การ์ด:" + cut.card.type);
  const state = Object.entries(cut.state || {}).map(([k, v]) => k + "=" + v).join(" ");
  if (state) parts.push(state);
  return parts.join(" · ");
}

function playScene(video, info) {
  if (!info) return;
  stopAt = info.start + info.seconds - 0.05;
  video.currentTime = info.start;
  video.play();
}

function renderReview() {
  const job = detail.job;
  const root = $("review");
  const nodes = [head(job)];

  if (job.state === "queued" || job.state === "running") {
    nodes.push(progress(job));
  } else if (job.state === "error") {
    const error = el("p", "feedback", job.error || "งานล้มเหลว");
    error.dataset.error = "true";
    const actions = el("div", "actions");
    actions.style.marginTop = "14px";
    actions.append(
      button("ลองต่อจากขั้นนี้", "primary", "retry", () => act("retry")),
      button("เขียนเรื่องใหม่", "subtle", null, () => act("restart", "ทิ้งบทและเสียงพากย์เดิม แล้วให้ AI เขียนเรื่องใหม่ทั้งหมด?")),
      button("ลบงาน", "subtle", null, removeJob),
    );
    nodes.push(error, el("p", "hint", "ค้างที่ขั้น: " + job.stage + " · ลองต่อจะเก็บบทและเสียงพากย์เดิมไว้"), actions);
  } else if (detail.script) {
    nodes.push(job.state === "done" ? doneBody(job) : reviewBody(job));
  }
  root.replaceChildren(...nodes.filter(Boolean));
}

function reviewBody(job) {
  const rows = detail.script.rows;
  scene = Math.min(Math.max(scene, 1), rows.length);
  const body = el("div", "review-body");

  const video = el("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = file(job.id, "story/draft.mp4", detail.stamp);
  video.addEventListener("timeupdate", () => {
    if (stopAt !== null && video.currentTime >= stopAt) {
      video.pause();
      stopAt = null;
    }
  });
  video.addEventListener("seeking", () => { if (stopAt !== null && video.currentTime > stopAt) stopAt = null; });
  const left = el("div");
  left.append(video, el("p", "hint", "ฉบับร่าง: ทุกฉากต่อกันพร้อมเสียง"));
  body.append(left);

  const right = el("div");
  const warn = warnings(job);
  if (warn) right.append(warn);

  const strip = el("div", "strip");
  strip.setAttribute("role", "group");
  strip.setAttribute("aria-label", "ฉากทั้งหมด");
  const editor = el("div", "scene-editor");
  const info = (n) => detail.scenes.find((s) => s.scene === n);

  const showScene = () => {
    [...strip.children].forEach((b, i) => b.setAttribute("aria-pressed", String(i + 1 === scene)));
    const row = rows[scene - 1];
    const instruction = el("textarea");
    instruction.id = "instruction";
    instruction.maxLength = 400;
    instruction.placeholder = "เช่น ให้แมวหันมามองกล้อง · เปลี่ยนเป็นมุมกว้าง · เปลี่ยนคำพูดเป็น… · ทำฝาสินค้าเป็นสีฟ้า";
    const label = el("label", "", "อยากแก้อะไรในฉากนี้");
    label.htmlFor = "instruction";
    const message = el("p", "feedback");
    message.setAttribute("role", "status");
    const send = button("แก้ฉากนี้", "primary", "retry", async () => {
      const text = instruction.value.trim();
      if (!text) return say(message, "พิมพ์สิ่งที่อยากแก้ก่อน", true);
      send.disabled = true;
      try {
        await api("/api/story/" + encodeURIComponent(job.id) + "/scene/" + scene, { method: "POST", body: JSON.stringify({ instruction: text }) });
        await refresh();
      } catch (error) {
        say(message, error.message, true);
        send.disabled = false;
      }
    });
    const actions = el("div", "actions");
    actions.append(send, button("เล่นฉากนี้", "", "play", () => playScene(video, info(scene))));
    editor.replaceChildren(
      el("p", "hint", "ฉากที่ " + scene + " จาก " + rows.length),
      el("p", "vo", row.vo),
      el("p", "sub", row.sub),
      el("p", "shots", row.cuts.map(describeCut).join("  →  ")),
      label, instruction, actions, message,
      el("p", "hint", "แก้ภาพ: เรนเดอร์เฉพาะฉากนี้ · แก้คำพูด: พากย์ใหม่เฉพาะประโยคนี้ · แก้โมเดลสินค้า: เรนเดอร์ทุกฉากที่มีสินค้า (ช้ากว่า)"),
    );
  };

  rows.forEach((row, i) => {
    const n = i + 1;
    const tile = el("button", "scene");
    tile.type = "button";
    tile.title = row.vo;
    const thumb = info(n);
    const img = el("img");
    img.alt = "";
    img.loading = "lazy";
    if (thumb) img.src = file(job.id, "story/segs/" + thumb.thumb, detail.stamp);
    tile.append(img, el("span", "", String(n)));
    tile.setAttribute("aria-label", "ฉากที่ " + n + ": " + row.vo);
    tile.addEventListener("click", () => {
      scene = n;
      showScene();
      playScene(video, info(n));
    });
    strip.append(tile);
  });
  showScene();

  const finish = el("div", "actions finish");
  const rest = el("div", "actions");
  rest.append(button("เขียนเรื่องใหม่", "subtle", "retry", () => act("restart", "ทิ้งฉบับร่างนี้แล้วให้ AI เขียนเรื่องใหม่ทั้งหมด?")), button("ลบงาน", "subtle", null, removeJob));
  finish.append(rest, button("ยืนยันและส่งออก", "primary", "check", () => act("confirm")));
  right.append(strip, editor, finish);
  body.append(right);
  return body;
}

function doneBody(job) {
  const body = el("div", "review-body");
  const video = el("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = file(job.id, "out.mp4", detail.stamp);
  if (job.cover_ready) video.poster = file(job.id, "cover.jpg", detail.stamp);
  const left = el("div");
  left.append(video);
  body.append(left);

  const right = el("div");
  const warn = warnings(job);
  if (warn) right.append(warn);
  right.append(el("p", "", "ส่งออกแล้ว ไฟล์อยู่ในโฟลเดอร์ส่งออกเดียวกับคลิปรีวิว ชื่อ " + job.id + ".mp4"));
  if (detail.caption) {
    right.append(el("p", "hint", "แคปชัน"), el("div", "caption", detail.caption.trim()));
    const copied = el("span", "hint");
    const copy = button("คัดลอกแคปชัน", "", null, async () => {
      await navigator.clipboard.writeText(detail.caption.trim());
      copied.textContent = "คัดลอกแล้ว";
    });
    const actions = el("div", "actions");
    actions.style.marginTop = "10px";
    actions.append(copy, copied);
    right.append(actions);
  }
  const links = el("div", "actions finish");
  const download = el("a", "button primary nav-link");
  download.href = file(job.id, "out.mp4");
  download.download = job.id + ".mp4";
  download.append(icon("download"), el("span", "", "ดาวน์โหลดคลิป"));
  const rest = el("div", "actions");
  rest.append(button("เขียนเรื่องใหม่", "subtle", "retry", () => act("restart", "ให้ AI เขียนเรื่องใหม่สำหรับสินค้านี้? ไฟล์ที่ส่งออกแล้วจะยังอยู่")), button("ลบงาน", "subtle", null, removeJob));
  links.append(rest, download);
  right.append(links);
  body.append(right);
  return body;
}

async function act(action, question) {
  if (question && !confirm(question)) return;
  try {
    await api("/api/story/" + encodeURIComponent(selected) + "/" + action, { method: "POST" });
    shownKey = "";
    await refresh();
  } catch (error) {
    alert(error.message);
  }
}

async function removeJob() {
  if (!confirm("ลบงานนี้? ไฟล์ในโฟลเดอร์ส่งออกจะยังอยู่")) return;
  try {
    await api("/api/jobs/" + encodeURIComponent(selected), { method: "DELETE" });
    selected = "";
    detail = null;
    shownKey = "";
    history.replaceState(null, "", location.pathname);
    $("review").replaceChildren(el("p", "hint", "ลบงานแล้ว"));
    await refresh();
  } catch (error) {
    alert(error.message);
  }
}

/* ─── start a job ─── */

$("link-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("link-msg");
  const url = $("url").value.trim().split(/\s+/)[0] || "";
  $("start").disabled = true;
  try {
    const result = await api("/api/story/link", { method: "POST", body: JSON.stringify({ url }) });
    $("url").value = "";
    say(message, result.started ? "เริ่มงานแล้ว" : "เปิดหน้าสินค้าให้แล้ว รอส่วนขยาย Chrome ส่งข้อมูล งานจะเริ่มเอง");
    select(result.job);
    await refresh();
  } catch (error) {
    say(message, error.message, true);
  } finally {
    $("start").disabled = false;
  }
});

/* ─── keep in step with the server ─── */

async function refresh() {
  const connection = $("connection");
  try {
    jobs = await api("/api/story");
    connection.className = "connection online";
    connection.lastChild.textContent = "เชื่อมต่อแล้ว";
  } catch {
    connection.className = "connection offline";
    connection.lastChild.textContent = "เชื่อมต่อไม่ได้";
    return;
  }
  if (!selected && jobs.length) selected = jobs[0].id;
  renderJobs();
  await loadDetail();
}

async function health() {
  try {
    const result = await api("/api/story/health");
    const notes = [...result.missing];
    if (!result.claude) notes.push("ไม่พบ Claude Code ในเครื่อง: คลิปยังสร้างได้ แต่สินค้าจะแสดงเป็นรูปจริงในกรอบแทนโมเดล 3 มิติ");
    const box = $("health");
    box.hidden = notes.length === 0;
    if (notes.length) {
      const list = el("ul");
      notes.forEach((n) => list.append(el("li", "", n)));
      box.replaceChildren(el("strong", "", "เครื่องนี้ยังขาดบางอย่าง"), list);
    }
  } catch { /* the connection badge already says so */ }
}

refresh();
health();
setInterval(refresh, 3000);
