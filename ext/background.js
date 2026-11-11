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

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "collect" }, (res) => {
    const ok = res?.ok;
    chrome.action.setBadgeText({ tabId: tab.id, text: ok ? "OK" : "!" });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: ok ? "#157347" : "#b3261e" });
    chrome.action.setTitle({ tabId: tab.id, title: ok ? "ส่งแล้ว" : (res?.error || "ใช้ได้เฉพาะหน้าสินค้า Shopee") });
  });
});
