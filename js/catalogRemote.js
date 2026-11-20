/* К9: опубликованный общий каталог. Встроенный каталог остаётся резервом при сбое сети/выпуска.
   Не изменяет проекты: их catalogSnapshot восстанавливается приложением после getProducts(). */
(() => {
"use strict";

const HASH = /^[a-f0-9]{64}$/;
const KINDS = new Set(["frame", "mechanism", "support", "socket_box", "accessory"]);
const safeImage = value => typeof value === "string" && /^(https?:\/\/[^\s]+|\/(?!\/)[^\s]+|(?:\.\/)?img\/[^\s]+)$/i.test(value);

function safeKeys(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Недопустимое поле каталога");
    safeKeys(child);
  }
}

/* Общая проверка для выпуска и получения: ошибка отвергает весь каталог, а не часть товаров. */
function validateProducts(products) {
  if (!Array.isArray(products) || !products.length || products.length > 100000)
    throw new Error("Некорректный список товаров");
  const ids = new Set(), codes = new Set();
  for (const p of products) {
    if (!p || typeof p !== "object" || Array.isArray(p)
      || !Number.isSafeInteger(p.id) || p.id <= 0
      || typeof p.code !== "string" || !p.code.trim() || typeof p.name !== "string" || !p.name.trim()
      || !KINDS.has(p.kind) || typeof p.price !== "number" || !Number.isFinite(p.price) || p.price < 0
      || p.currency !== "EUR" || typeof p.active !== "boolean"
      || !Array.isArray(p.series) || !p.series.every(s => typeof s === "string"))
      throw new Error("Некорректный товар каталога");
    const id = String(p.id), code = p.code.trim().toUpperCase();
    if (ids.has(id) || codes.has(code)) throw new Error("Повтор ID или артикула каталога");
    ids.add(id); codes.add(code);
    if (p.packQty != null && (!Number.isSafeInteger(p.packQty) || p.packQty < 1)) throw new Error("Некорректная упаковка");
    for (const field of ["imageUrl", "previewImageUrl"]) {
      if (p[field] != null && p[field] !== "" && !safeImage(p[field])) throw new Error("Некорректный адрес изображения");
    }
    safeKeys(p);
  }
  return products;
}

async function load(options) {
  const o = options || {}, fallback = () => structuredClone(o.fallback || []);
  const fetcher = o.fetch || (typeof fetch === "function" ? fetch : null);
  const crypt = o.crypto || (typeof crypto !== "undefined" ? crypto : null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs || 6000);
  try {
    if (!fetcher || !crypt || !crypt.subtle) throw new Error("Загрузка каталога недоступна");
    const base = new URL(o.baseUrl);
    const manifestUrl = new URL(o.manifestUrl || "catalog/current.json", base);
    if (!["http:", "https:"].includes(manifestUrl.protocol) || manifestUrl.origin !== base.origin)
      throw new Error("Каталог должен находиться на этом сайте");
    const response = await fetcher(manifestUrl.href, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("Не удалось получить версию каталога");
    const manifest = await response.json();
    if (!manifest || manifest.schema !== 1 || !HASH.test(manifest.sha256)
      || manifest.file !== "versions/" + manifest.sha256 + ".json"
      || !Number.isSafeInteger(manifest.count) || manifest.count < 1 || manifest.count > 100000)
      throw new Error("Некорректная версия каталога");
    const versionUrl = new URL(manifest.file, manifestUrl);
    const versionResponse = await fetcher(versionUrl.href, { cache: "force-cache", signal: controller.signal });
    if (!versionResponse.ok) throw new Error("Не удалось получить товары каталога");
    const bytes = await versionResponse.arrayBuffer();
    if (bytes.byteLength > 30000000) throw new Error("Каталог слишком велик");
    const digest = await crypt.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== manifest.sha256) throw new Error("Версия каталога не прошла проверку целостности");
    const version = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!version || version.schema !== 1 || !Array.isArray(version.products) || version.products.length !== manifest.count)
      throw new Error("Состав каталога не соответствует версии");
    validateProducts(version.products);
    return { products: version.products, status: { source: "published", version: hash } };
  } catch (error) {
    return { products: fallback(), status: { source: "embedded", error: String(error.message || error) } };
  } finally {
    clearTimeout(timer);
  }
}

const api = { load, validateProducts };
if (typeof window !== "undefined") window.EPCatalogRemote = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
