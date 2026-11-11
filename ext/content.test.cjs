const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(require.resolve("./content.js"), "utf8");
const cdn = "https://down-th.img.susercontent.com/file/";
const media = (id, attrs = {}) => ({ src: cdn + id, closest: () => null, ...attrs });

function page({ heroAlt = "Product image Storage jar", thumbnails = true, ogTitle = "Storage jar | Shopee" } = {}) {
  const heading = { innerText: "Storage jar", textContent: "Storage jar" };
  const cover = media("jar-cover@resize_w400", { alt: heroAlt });
  const detail = media("jar-detail_tn");
  const banner = media("campaign-banner", { alt: "" });
  const avatar = media("profile-avatar", { alt: "profile" });
  const video = media("jar-video");
  const gallery = {
    contains: (node) => node !== heading,
    querySelectorAll: (selector) => {
      if (selector === "picture img") return thumbnails ? [cover, detail, avatar] : [];
      if (selector === "video") return [video];
      return [cover, banner, detail];
    },
  };
  cover.closest = (selector) => selector === "section" ? gallery : null;
  const document = {
    querySelector(selector) {
      if (selector === "h1") return heading;
      if (selector === 'meta[property="og:image"]') return { content: cdn + "jar-cover" };
      if (selector === 'meta[property="og:title"]') return { content: ogTitle };
      return { innerText: "Product details" };
    },
    querySelectorAll(selector) {
      if (selector === "video") return [media("review-video"), video];
      return [avatar, cover, banner, detail, media("suggested-product")];
    },
  };
  const context = vm.createContext({ document, location: { pathname: "/product/12/34", href: "https://shopee.co.th/product/12/34" },
    chrome: { runtime: { onMessage: { addListener() {} } } }, setInterval() {}, clearInterval() {} });
  return JSON.parse(vm.runInContext(`${script}\nJSON.stringify(collect())`, context));
}

test("collects the cover and gallery photos without account or promo images", () => {
  const result = page();
  assert.deepEqual(result.images, [cdn + "jar-cover", cdn + "jar-detail"]);
  assert.deepEqual(result.videos, [cdn + "jar-video"]);
  assert.equal(result.gallery_schema, 1);
});

test("uses the product cover metadata to locate a localized hero", () => {
  const result = page({ heroAlt: "รูปภาพสินค้า", thumbnails: false });
  assert.deepEqual(result.images, [cdn + "jar-cover"]);
});

test("does not use metadata for a different page when the gallery is missing", () => {
  const result = page({ heroAlt: "", thumbnails: false, ogTitle: "Shopee Thailand" });
  assert.deepEqual(result.images, []);
});
