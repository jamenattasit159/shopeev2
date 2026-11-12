"use strict";

const $ = (id) => document.getElementById(id);
const STATES = {
  running: "กำลังทำ",
  error: "ล้มเหลว",
  queued: "รอคิว",
  ready: "พร้อมเริ่ม",
  waiting: "รอข้อมูลสินค้า",
  done: "เสร็จแล้ว",
};
const PRIORITY = { running: 0, error: 1, ready: 2, queued: 3, waiting: 4 };
const STEPS = ["เตรียมรูปและคลิป", "AI เขียนสคริปต์", "พากย์เสียง", "จัดเวลา", "เรนเดอร์", "ส่งออก"];
const STYLE_LABELS = {
  "problem-solution": "ปัญหาและทางแก้",
  "three-reasons": "3 เหตุผลที่ต้องมี",
  "review-summary": "สรุปจากรีวิว",
  "worth-it": "คุ้มไหม",
};
const KEYS = ["gemini", "claude", "gpt"];

async function api(path, options = {}) {
  if (typeof options.body === "string") {
    options = { ...options, headers: { "content-type": "application/json" } };
  }
  const response = await fetch(path, options);
  if (response.status === 204) return;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "เกิดข้อผิดพลาด (" + response.status + ")");
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
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

function button(label, action, glyph, classes = "") {
  const node = el("button", "button " + classes, label);
  node.type = "button";
  node.dataset.jobAction = action;
  if (glyph) node.prepend(icon(glyph));
  return node;
}

function link(label, href, glyph, download) {
  const node = el("a", "button", label);
  node.href = href;
  if (glyph) node.prepend(icon(glyph));
  if (download) node.download = download;
  else {
    node.target = "_blank";
    node.rel = "noopener noreferrer";
  }
  return node;
}

function feedback(node, message = "", error = false) {
  node.textContent = message;
  node.dataset.error = error;
}

async function withBusy(control, message, operation) {
  if (control.disabled) return;
  control.disabled = true;
  control.setAttribute("aria-busy", "true");
  feedback(message);
  try {
    await operation();
  } catch (error) {
    feedback(message, error.message, true);
  } finally {
    control.disabled = false;
    control.removeAttribute("aria-busy");
  }
}

function jobPath(job) {
  return "/api/jobs/" + encodeURIComponent(job.id);
}

function filePath(job, name) {
  return "/files/" + encodeURIComponent(job.id) + "/" + name + "?s=" + encodeURIComponent(job.seed);
}

function jobName(job) {
  return job.name || job.title || job.url || job.id;
}

function downloadVideo(job) {
  return link("MP4", filePath(job, "out.mp4"), "download", job.id + ".mp4");
}

function downloadCover(job) {
  return link("ปก JPG", filePath(job, "cover.jpg"), "download", job.id + "-cover.jpg");
}

function jobMenu(job, message) {
  const details = el("details", "job-menu");
  const summary = el("summary", "button subtle icon-button");
  summary.setAttribute("aria-label", "จัดการงาน " + jobName(job));
  summary.append(icon("more"));
  const actions = el("div", "menu-popover");
  actions.append(button("แก้ไขงาน", "edit"));
  if (job.state === "done") {
    actions.append(link("เปิดแคปชัน", filePath(job, "caption.txt"), "external"));
    actions.append(button("สร้างคลิปใหม่", "rerun"));
    uploadControl(job, actions, message);
  }
  actions.append(button("ลบงาน", "delete", null, "remove"));
  details.append(summary, actions);
  return details;
}

function stepper(stage) {
  const list = el("ol", "steps");
  list.setAttribute("aria-label", "ขั้นตอนการสร้างคลิป");
  STEPS.forEach((step, i) => {
    const n = i + 1;
    const item = el("li", n < stage ? "done" : n === stage ? "current" : "", n + " " + step);
    if (n === stage) item.setAttribute("aria-current", "step");
    list.append(item);
  });
  return list;
}

function sourceLink(job) {
  try {
    const url = new URL(job.url);
    if (url.protocol === "https:" && (url.hostname === "shp.ee" || url.hostname === "shopee.co.th" || url.hostname.endsWith(".shopee.co.th"))) {
      return link("เปิดหน้าสินค้า", url, "external");
    }
  } catch {
    // Older records may have no URL.
  }
}

const uploadingJobs = new Set();

function uploadControl(job, actions, message) {
  const upload = button("เพิ่มคลิปดิบ", "upload", "upload", "subtle");
  const input = el("input");
  input.type = "file";
  input.accept = ".mp4,.mov,.webm,.m4v";
  input.multiple = true;
  input.hidden = true;
  upload.disabled = uploadingJobs.has(job.id);
  input.addEventListener("change", async () => {
    if (!input.files.length || uploadingJobs.has(job.id)) return;
    uploadingJobs.add(job.id);
    const startButton = () => cards.get(job.id)?.node.querySelector('[data-job-action="rerun"]');
    const start = startButton();
    if (start) start.disabled = true;
    const status = job.state === "waiting" ? $("queue-message") : message;
    await withBusy(upload, status, async () => {
      feedback(status, "กำลังอัปโหลดคลิป…");
      let uploaded = 0;
      for (const file of input.files) {
        const name = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        await api(jobPath(job) + "/clip?name=" + encodeURIComponent(name), { method: "PUT", body: file });
        uploaded++;
        feedback(status, "อัปโหลดแล้ว " + uploaded + " คลิป");
      }
    });
    uploadingJobs.delete(job.id);
    const currentCard = cards.get(job.id)?.node;
    for (const control of currentCard?.querySelectorAll('[data-job-action="rerun"], [data-job-action="upload"]') ?? []) {
      control.disabled = false;
    }
    input.value = "";
  });
  actions.append(upload, input);
}

function activeJob(job) {
  const card = el("article", "job");
  const head = el("div", "job-head");
  const info = el("div", "job-title");
  const name = el("h3", "", jobName(job));
  const meta = el("div", "job-meta");
  const stage = Number.parseInt(job.stage, 10) || 0;
  const subtitle = job.state === "running" && stage ? "ขั้น " + stage + " จาก 6 · " + STEPS[stage - 1]
    : job.state === "error" && stage ? "หยุดที่ขั้น " + stage + " · " + STEPS[stage - 1]
    : job.stage === STATES[job.state] ? "" : job.stage || "";
  meta.append(el("span", "status " + job.state, STATES[job.state] || job.state));
  if (subtitle) meta.append(el("span", "", subtitle));
  info.append(name, meta);
  head.append(info);
  const idle = job.state !== "queued" && job.state !== "running";
  if (idle) head.append(jobMenu(job));
  card.append(head);

  if (job.state === "running") card.append(stepper(stage));
  if (job.error) {
    const detail = el("details", "error-detail");
    const summary = el("summary", "", "รายละเอียดข้อผิดพลาด");
    const chevron = icon("chevron");
    chevron.classList.add("chevron");
    summary.append(chevron);
    detail.append(summary, el("p", "", job.error));
    card.append(detail);
  }
  for (const warning of job.warnings || []) card.append(el("p", "hint", warning));

  const message = el("p", "feedback");
  message.setAttribute("role", "status");
  if (!idle) {
    const actions = el("div", "actions");
    actions.append(button("ยกเลิกงาน", "cancel", null, "subtle"));
    card.append(actions);
  }
  if (idle) {
    const actions = el("div", "actions");
    if (job.state === "ready") {
      const start = button("เริ่มสร้างคลิป", "rerun", "play", "primary");
      start.disabled = uploadingJobs.has(job.id);
      actions.append(start);
    }
    if (job.state === "error") actions.append(button("ลองสร้างใหม่", "rerun", "retry", "primary"));
    if (job.state === "waiting") {
      const source = sourceLink(job);
      if (source) actions.append(source);
    }
    uploadControl(job, actions, message);
    card.append(actions);
  }
  card.append(message);
  return card;
}

function finishedJob(job) {
  const row = el("article", "done-row");
  const info = el("div", "job-title");
  const metadata = [];
  if (job.seconds > 0) metadata.push(job.seconds.toFixed(1) + " วินาที");
  if (job.provider) metadata.push(job.provider);
  info.append(el("h3", "", jobName(job)));
  if (metadata.length) info.append(el("p", "hint", metadata.join(" · ")));
  const message = el("p", "feedback");
  message.setAttribute("role", "status");
  info.append(message);

  const actions = el("div", "actions");
  actions.append(button("ดูคลิป", "preview", "play", "subtle"), downloadVideo(job));
  if (job.cover_ready) actions.append(downloadCover(job));
  else if (job.warnings?.some((warning) => warning.startsWith("สร้างปกไม่สำเร็จ"))) {
    info.append(el("p", "hint", "สร้างปกไม่สำเร็จ"));
  }
  actions.append(jobMenu(job, message));
  row.append(info, actions);
  return row;
}

let jobIndex = new Map();
const cards = new Map();

function syncList(container, jobs, render) {
  const nodes = new Set();
  for (const [i, job] of jobs.entries()) {
    const signature = JSON.stringify(job);
    let card = cards.get(job.id);
    if (!card || card.signature !== signature) {
      const node = render(job);
      node.dataset.jobId = job.id;
      node.dataset.state = job.state;
      if (card?.node.parentNode === container) card.node.replaceWith(node);
      card = { signature, node };
      cards.set(job.id, card);
    }
    nodes.add(card.node);
    if (container.children[i] !== card.node) container.insertBefore(card.node, container.children[i] || null);
  }
  for (const child of Array.from(container.children)) {
    if (!nodes.has(child)) child.remove();
  }
}

function updateCounts(active, done) {
  const counts = { running: 0, waiting: 0, error: 0, done: done.length };
  for (const job of active) {
    counts[job.state === "running" || job.state === "error" ? job.state : "waiting"]++;
  }
  for (const [state, count] of Object.entries(counts)) $("count-" + state).textContent = count;
  $("open-count").textContent = active.length;
  $("done-count").textContent = done.length;
  $("done-empty").hidden = done.length > 0;
  $("empty").textContent = done.length ? "ไม่มีงานที่ต้องจัดการ" : "ยังไม่มีงาน เริ่มได้จากการวางลิงก์สินค้า Shopee";
  $("empty").hidden = active.length > 0;
}

function connection(online) {
  const node = $("connection");
  const state = online ? "online" : "offline";
  if (node.classList.contains(state)) return;
  node.className = "connection " + state;
  node.replaceChildren(el("span"), online ? "เชื่อมต่อแล้ว" : "ขาดการเชื่อมต่อ");
}

let refreshId = 0;
async function refresh() {
  const id = ++refreshId;
  try {
    const jobs = await api("/api/jobs");
    if (id !== refreshId) return;
    jobIndex = new Map(jobs.map((job) => [job.id, job]));
    const active = jobs.filter((job) => job.state !== "done");
    active.sort((a, b) => (PRIORITY[a.state] ?? 9) - (PRIORITY[b.state] ?? 9));
    const done = jobs.filter((job) => job.state === "done");
    syncList($("queue"), active, activeJob);
    syncList($("done-list"), done, finishedJob);
    for (const key of cards.keys()) if (!jobIndex.has(key)) cards.delete(key);
    updateCounts(active, done);
    connection(true);
  } catch {
    if (id !== refreshId) return;
    connection(false);
    if (!$("empty").hidden && jobIndex.size === 0) {
      $("empty").textContent = "เชื่อมต่อแอปไม่ได้ เปิด Shopee Clip V2 แล้วลองรีเฟรช";
    }
  }
}

async function poll() {
  await refresh();
  window.setTimeout(poll, 2500);
}

function closeMenus(except) {
  for (const menu of document.querySelectorAll(".job-menu[open]")) {
    if (menu !== except) menu.open = false;
  }
}

function openEdit(job) {
  const dialog = $("edit-dialog");
  dialog.dataset.jobId = job.id;
  $("job-name").value = job.name || "";
  $("job-name").placeholder = job.title || job.url || "";
  $("job-style").value = job.style || "";
  feedback($("edit-msg"));
  dialog.showModal();
}

function openDelete(job) {
  const dialog = $("delete-dialog");
  dialog.dataset.jobId = job.id;
  $("delete-name").textContent = jobName(job);
  feedback($("delete-msg"));
  dialog.showModal();
}

function openPreview(job) {
  $("preview-heading").textContent = jobName(job);
  const video = el("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = filePath(job, "out.mp4");
  if (job.cover_ready) video.poster = filePath(job, "cover.jpg");
  video.setAttribute("aria-label", "วิดีโอ " + jobName(job));
  const actions = el("div", "actions");
  actions.append(downloadVideo(job));
  if (job.cover_ready) actions.append(downloadCover(job));
  actions.append(link("เปิดแคปชัน", filePath(job, "caption.txt"), "external"));
  $("preview-body").replaceChildren(video, actions);
  $("preview-dialog").showModal();
}

document.addEventListener("click", (event) => {
  const closer = event.target.closest("[data-close]");
  if (closer) closer.closest("dialog").close();

  const menu = event.target.closest(".job-menu");
  closeMenus(menu);
  const control = event.target.closest("button[data-job-action]");
  const row = control?.closest("[data-job-id]");
  if (!row) return;
  const job = jobIndex.get(row.dataset.jobId);
  if (!job) return;
  if (menu) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
  switch (control.dataset.jobAction) {
    case "edit":
      openEdit(job);
      break;
    case "delete":
      openDelete(job);
      break;
    case "preview":
      openPreview(job);
      break;
    case "upload":
      row.querySelector("input[type=file]").click();
      break;
    case "cancel":
      if (!confirm("ยกเลิกงานนี้? ส่วนที่ทำค้างไว้จะหยุดทันที")) break;
      withBusy(control, $("queue-message"), async () => {
        await api(jobPath(job) + "/cancel", { method: "POST" });
        await refresh();
        feedback($("queue-message"), "ยกเลิกงานแล้ว");
      });
      break;
    case "rerun":
      if (uploadingJobs.has(job.id)) break;
      withBusy(control, $("queue-message"), async () => {
        await api(jobPath(job) + "/run", { method: "POST" });
        await refresh();
        feedback($("queue-message"), "ส่งงานเข้าคิวแล้ว");
      });
      break;
  }
});

document.addEventListener("keydown", (event) => {
  const menu = event.target.closest?.(".job-menu[open]");
  if (event.key === "Escape" && menu) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});

$("preview-dialog").addEventListener("close", () => $("preview-body").replaceChildren());

$("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const urls = $("urls").value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!urls.length) {
    feedback($("msg"), "ใส่ลิงก์อย่างน้อย 1 ลิงก์", true);
    return;
  }
  withBusy($("add"), $("msg"), async () => {
    const result = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ urls, style: $("style").value }),
    });
    const parts = [];
    if (result.added) parts.push("สร้าง " + result.added + " งาน");
    if (result.duplicates?.length) parts.push("มีงานอยู่แล้ว " + result.duplicates.length + " รายการ");
    if (result.rejected.length) parts.push("ลิงก์ไม่ถูกต้อง " + result.rejected.length + " รายการ");
    $("urls").value = result.rejected.join("\n");
    feedback($("msg"), parts.join(" · "), result.rejected.length > 0);
    await refresh();
  });
});

$("edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const dialog = $("edit-dialog");
  const id = dialog.dataset.jobId;
  withBusy($("edit-save"), $("edit-msg"), async () => {
    await api("/api/jobs/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ name: $("job-name").value, style: $("job-style").value }),
    });
    dialog.close();
    await refresh();
    const summary = cards.get(id)?.node.querySelector(".job-menu summary");
    (summary || $("queue-heading")).focus();
    feedback($("queue-message"), "บันทึกการแก้ไขแล้ว");
  });
});

$("delete-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const dialog = $("delete-dialog");
  const id = dialog.dataset.jobId;
  const wasDone = jobIndex.get(id)?.state === "done";
  withBusy($("delete-submit"), $("delete-msg"), async () => {
    await api("/api/jobs/" + encodeURIComponent(id), { method: "DELETE" });
    dialog.close();
    await refresh();
    (wasDone ? $("completed").querySelector("summary") : $("queue-heading")).focus();
    feedback($("queue-message"), "ลบงานออกจากคิวแล้ว");
  });
});

function applyKeys(config) {
  for (const key of KEYS) {
    $("has-" + key).textContent = config.has_key[key] ? "· ตั้งแล้ว" : "· ยังไม่ได้ตั้ง";
  }
}

let configReady = false;
let configRequest;
function loadConfig() {
  if (!configRequest) {
    configRequest = api("/api/config").then((config) => {
      $("director").value = config.director.join(", ");
      $("providers").textContent = config.providers.join(", ");
      $("test-p").replaceChildren(...config.providers.map((p) => new Option(p, p)));
      for (const id of ["style", "job-style"]) {
        const select = $(id);
        select.replaceChildren(new Option("สุ่มแนวสคริปต์", ""), ...config.styles.map((s) => new Option(STYLE_LABELS[s] || s, s)));
      }
      for (const key of KEYS) $("m-" + key).value = config.models[key];
      $("m-claude-code").value = config.models.claude_code || "";
      $("m-effort").value = config.models.effort || "";
      $("voice").value = config.voice;
      $("export").value = config.export_dir;
      applyKeys(config);
      configReady = true;
    }).finally(() => { configRequest = null; });
  }
  return configRequest;
}

$("open-settings").addEventListener("click", () => {
  $("settings-dialog").showModal();
  if (!configReady) loadConfig().catch((error) => feedback($("cfg-msg"), error.message, true));
});

$("open-shutdown").addEventListener("click", () => $("shutdown-dialog").showModal());
$("confirm-shutdown").addEventListener("click", () => {
  withBusy($("confirm-shutdown"), $("shutdown-error"), async () => {
    await api("/api/shutdown", { method: "POST" });
    $("confirm-shutdown").hidden = true;
    $("shutdown-status").textContent = "กำลังปิดระบบ เมื่อคลิปที่กำลังทำเสร็จ ระบบจะปิดเอง";
    const check = async () => {
      try {
        const status = await api("/api/status", { cache: "no-store" });
        if (status.stopping) {
          window.setTimeout(check, 1200);
          return;
        }
        location.reload();
      } catch {
        $("shutdown-heading").textContent = "ปิดระบบแล้ว";
        $("shutdown-status").textContent = "เปิด ShopeeClip.exe เพื่อกลับมาทำงานต่อ";
        $("shutdown-dialog").querySelector("[data-close]").textContent = "ปิดหน้าต่างนี้";
      }
    };
    await check();
  });
});

$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  withBusy($("save"), $("cfg-msg"), async () => {
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify({
        director: $("director").value.split(",").map((s) => s.trim()).filter(Boolean),
        voice: $("voice").value,
        export_dir: $("export").value,
        models: { ...Object.fromEntries(KEYS.map((key) => [key, $("m-" + key).value])), claude_code: $("m-claude-code").value.trim(), effort: $("m-effort").value },
        keys: Object.fromEntries(KEYS.map((key) => [key, $("k-" + key).value])),
      }),
    });
    for (const key of KEYS) $("k-" + key).value = "";
    applyKeys(await api("/api/config"));
    feedback($("cfg-msg"), "บันทึกการตั้งค่าแล้ว");
  });
});

$("test").addEventListener("click", () => {
  withBusy($("test"), $("cfg-msg"), async () => {
    feedback($("cfg-msg"), "กำลังทดสอบการเชื่อมต่อ…");
    const result = await api("/api/test", {
      method: "POST", body: JSON.stringify({ provider: $("test-p").value }),
    });
    feedback($("cfg-msg"), "เชื่อมต่อได้ · ตอบว่า " + result.reply);
  });
});

$("load-voices").addEventListener("click", () => {
  withBusy($("load-voices"), $("cfg-msg"), async () => {
    feedback($("cfg-msg"), "กำลังโหลดรายชื่อเสียง…");
    const voices = await api("/api/voices");
    $("voice-list").replaceChildren(...voices.map((voice) => new Option(voice.name, voice.id)));
    feedback($("cfg-msg"), voices.length ? "พบเสียงโคลน " + voices.length + " เสียง เลือกได้ในช่องเสียงพากย์" : "ไม่พบเสียงโคลนในบัญชีนี้");
  });
});

loadConfig().catch((error) => feedback($("cfg-msg"), error.message, true));
poll();

