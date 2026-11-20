"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const Remote = require("../js/catalogRemote.js");

const product = (price = 12.5) => ({ id: 1, code: "M-1", name: "Механизм", kind: "mechanism",
  price, currency: "EUR", active: true, series: ["Arke"], packQty: 10 });
function release(products = [product()]) {
  const bytes = Buffer.from(JSON.stringify({ schema: 1, products }));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, manifest: { schema: 1, sha256, file: "versions/" + sha256 + ".json", count: products.length } };
}
function options(releaseData = release()) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    return url.endsWith("current.json")
      ? { ok: true, json: async () => releaseData.manifest }
      : { ok: true, arrayBuffer: async () => Uint8Array.from(releaseData.bytes).buffer };
  };
  return { baseUrl: "https://example.test/electroPlan/index.html", crypto: webcrypto,
    fallback: [product(8)], fetch, calls };
}

test("К9: загружается проверенная версия из каталога GitHub Pages с относительным путём", async () => {
  const o = options();
  const loaded = await Remote.load(o);
  assert.equal(loaded.products[0].price, 12.5);
  assert.equal(loaded.status.source, "published");
  assert.equal(o.calls[0].url, "https://example.test/electroPlan/catalog/current.json");
  assert.equal(o.calls[1].url, "https://example.test/electroPlan/catalog/versions/" + loaded.status.version + ".json");
  assert.equal(o.calls[0].opts.cache, "no-store");
  assert.equal(o.calls[1].opts.cache, "force-cache");
});

test("К9: ошибки manifest, состава или hash не заменяют встроенные цены", async () => {
  const variants = [
    r => { r.manifest.schema = 2; },
    r => { r.manifest.file = "https://other.test/catalog.json"; },
    r => { r.manifest.count = 2; },
    r => { r.bytes = Buffer.from(r.bytes.toString().replace('12.5', '9999')); },
    r => { r.manifest.sha256 = "invalid"; }
  ];
  for (const change of variants) {
    const r = release(); change(r);
    const o = options(r), loaded = await Remote.load(o);
    assert.equal(loaded.status.source, "embedded");
    assert.equal(loaded.products[0].price, 8);
    assert.notEqual(loaded.products, o.fallback);
    loaded.products[0].price = 100;
    assert.equal(o.fallback[0].price, 8);
  }
});

test("К9: недоступная или ещё не развернутая версия и битый JSON оставляют рабочий каталог", async () => {
  for (const failure of ["offline", "manifest404", "version404", "json"]) {
    const o = options(), original = o.fetch;
    o.fetch = async (url, opts) => {
      if (failure === "offline") throw new Error("offline");
      if (failure === "manifest404" || failure === "version404" && !url.endsWith("current.json")) return { ok: false };
      if (failure === "json") return { ok: true, json: async () => { throw new SyntaxError("JSON"); } };
      return original(url, opts);
    };
    const loaded = await Remote.load(o);
    assert.equal(loaded.status.source, "embedded", failure);
    assert.equal(loaded.products[0].price, 8);
  }
});

test("К9: подписанный hash не разрешает повтор ID/артикула, неверную цену или опасное изображение", async () => {
  const invalid = [
    [product(), product()],
    [product(), { ...product(), id: 2, code: " m-1 " }],
    [{ ...product(), id: "not-a-number" }],
    [{ ...product(), id: "1" }],
    [{ ...product(), price: "12.5" }],
    [{ ...product(), price: -1 }],
    [{ ...product(), imageUrl: "javascript:alert(1)" }],
    [{ ...product(), kind: "unknown" }],
    [{ ...product(), packQty: 0 }],
    [JSON.parse(JSON.stringify(product()).replace('"name":"Механизм"', '"name":"Механизм","__proto__":{}'))]
  ];
  for (const list of invalid) {
    const loaded = await Remote.load(options(release(list)));
    assert.equal(loaded.status.source, "embedded");
    assert.equal(loaded.products[0].price, 8);
  }
});

test("К9: нет Web Crypto или запрос превысил срок — приложение получает встроенный каталог", async () => {
  const o = options();
  o.crypto = {};
  assert.equal((await Remote.load(o)).status.source, "embedded");
  o.crypto = webcrypto; o.timeoutMs = 5;
  o.fetch = (_, opts) => new Promise((resolve, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.equal((await Remote.load(o)).status.source, "embedded");
});

test("К9: DataService подключает опубликованный список, сохраняя API и localStorage постов", async () => {
  const o = options(), calls = [];
  const context = { window: { location: { href: o.baseUrl }, EPCatalogRemote: {
    load: input => Remote.load({ ...input, fetch: o.fetch, crypto: webcrypto })
  } }, structuredClone, fetch: async url => { calls.push(url); return { ok: true, json: async () => [product(99)] }; },
    localStorage: { getItem: key => key === "ep_post_templates" ? '[{"id":"t1"}]' : null } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("../js/data.js"), "utf8"), context);
  const service = context.window.DataService;
  assert.equal(service.mode, "static");
  assert.equal((await service.getProducts())[0].price, 12.5);
  assert.equal(service.catalogStatus.source, "published");
  assert.equal((await service.getSavedPosts())[0].id, "t1");
  service.mode = "api";
  assert.equal((await service.getProducts())[0].price, 99);
  assert.deepEqual(calls, ["/api/products"]);
});

test("К9: опубликованный модуль загружается до DataService", () => {
  const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
  assert.ok(html.indexOf('src="js/catalogRemote.js?') < html.indexOf('src="js/data.js?'));
  assert.ok(html.includes('src="js/catalogRemote.js?'));
});
