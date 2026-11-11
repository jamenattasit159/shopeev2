// Reads the product's gallery and visible page text for the local clip generator.
const isProduct = () => /-i\.\d+\.\d+|\/product\/\d+\/\d+/.test(location.pathname);
const mediaUrl = (raw) => raw?.match(/https:\/\/[a-z0-9.-]+susercontent\.com\/file\/[A-Za-z0-9_.-]+/)?.[0].replace(/_tn$/, "");
const imageUrl = (img) => mediaUrl(img.currentSrc) || mediaUrl(img.src) || mediaUrl(img.srcset);

function collect() {
  const heading = document.querySelector("h1");
  const title = (heading?.innerText || document.title).trim();
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
  const ogImage = heading && title && ogTitle?.includes(title)
    ? mediaUrl(document.querySelector('meta[property="og:image"]')?.content)
    : undefined;
  const pageImages = [...document.querySelectorAll("img")];
  const excluded = new Set(pageImages.filter((img) => img.closest("header, nav, [role=banner]")
    || /^(profile|avatar)(\b|$)/i.test(img.alt?.trim() || "")).map(imageUrl).filter(Boolean));
  const hero = pageImages.find((img) => heading && title && img.alt?.trim().endsWith(title) && imageUrl(img))
    ?? pageImages.find((img) => ogImage && imageUrl(img) === ogImage);
  const section = hero?.closest("section");
  const gallery = section && !section.contains(heading) ? section : null;
  const images = new Set();
  const cover = hero ? imageUrl(hero) : ogImage;
  if (cover && !excluded.has(cover)) images.add(cover);
  // Product thumbnails are pictures in the gallery. The campaign overlays are separate images.
  for (const img of gallery?.querySelectorAll("picture img") ?? []) {
    const url = imageUrl(img);
    if (url && !excluded.has(url)) images.add(url);
  }
  const videos = [...(gallery?.querySelectorAll("video") ?? [])].map((v) => v.currentSrc || v.src).filter((s) => s.startsWith("https://"));
  const main = document.querySelector("main, [role=main]") || document.body;
  return { url: location.href, title, text: main.innerText.slice(0, 12000), images: [...images].slice(0, 12), videos: videos.slice(0, 1), gallery_schema: 1 };
}

function send(reply) {
  const data = collect();
  if (!isProduct() || !data.images.length) return reply?.({ ok: false, error: "ยังไม่พบรูปจากแกลเลอรีสินค้า รอหน้าโหลดเสร็จแล้วลองอีกครั้ง" });
  chrome.runtime.sendMessage({ type: "ingest", data }, (res) => reply?.(res));
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "collect") { send(reply); return true; }
});

// Auto-send only for tabs the app opened (it is waiting for this item); other visits need the toolbar button.
if (isProduct()) {
  let tries = 0;
  const timer = setInterval(() => {
    const data = collect();
    const hasHeading = document.querySelector("h1");
    if ((hasHeading && data.images.length >= 2) || ++tries >= 20) {
      clearInterval(timer);
      if (hasHeading && data.images.length) chrome.runtime.sendMessage({ type: "ingest", data, onlyIfWaiting: true });
    }
  }, 1000);
}
