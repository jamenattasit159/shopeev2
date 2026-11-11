// All traffic to the local app goes through here so requests carry the extension's own origin.
const APP = "http://127.0.0.1:4317";

async function ingest(data) {
  const res = await fetch(APP + "/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: body.error || "โปรแกรมไม่รับข้อมูล" };
}

async function isWaiting(url) {
  const jobs = await fetch(APP + "/api/jobs").then((r) => r.json());
  const id = (url.match(/(\d{6,})(?:[?#]|$)/) || [])[1];
  return jobs.some((j) => j.state === "waiting" && (j.id === id || j.id.startsWith("link")));
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "ingest") return;
  (async () => {
    try {
      if (msg.onlyIfWaiting && !(await isWaiting(msg.data.url))) return reply({ ok: false, skipped: true });
      reply(await ingest(msg.data));
    } catch { reply({ ok: false, error: "ติดต่อโปรแกรม Shopee Clip V2 ไม่ได้ เปิดโปรแกรมอยู่หรือเปล่า" }); }
  })();
  return true;
});

// A tab opened before the extension was (re)loaded has no content script: put it in, then ask again.
function collectFrom(tab, done) {
  chrome.tabs.sendMessage(tab.id, { type: "collect" }, (res) => {
    if (!chrome.runtime.lastError) return done(res);
    if (!/^https:\/\/([a-z0-9-]+\.)?shopee\.co\.th\//.test(tab.url || "")) return done({ ok: false, error: "ใช้ได้เฉพาะหน้าสินค้า Shopee" });
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
      if (chrome.runtime.lastError) return done({ ok: false, error: "อ่านหน้านี้ไม่ได้ รีเฟรชหน้าแล้วลองอีกครั้ง" });
      chrome.tabs.sendMessage(tab.id, { type: "collect" }, (again) => done(chrome.runtime.lastError ? { ok: false, error: "อ่านหน้านี้ไม่ได้ รีเฟรชหน้าแล้วลองอีกครั้ง" } : again));
    });
  });
}

chrome.action.onClicked.addListener((tab) => {
  collectFrom(tab, (res) => {
    const ok = res?.ok;
    chrome.action.setBadgeText({ tabId: tab.id, text: ok ? "OK" : "!" });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: ok ? "#157347" : "#b3261e" });
    chrome.action.setTitle({ tabId: tab.id, title: ok ? "ส่งแล้ว" : (res?.error || "ใช้ได้เฉพาะหน้าสินค้า Shopee") });
  });
});
