"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const release = require("../js/catalogRelease.js");
const base = () => [
  { id: 1, code: "A", name: "Первый", kind: "mechanism", price: 10, currency: "EUR", active: true, series: ["Test"], packQty: 10,
    imageUrl: "img/catalog/A.jpg", faceRect: { left: 2, top: 3 }, articleColor: "Белый", moduleSpan: 1 },
  { id: 2, code: "B", name: "Второй", kind: "frame", price: 30, currency: "EUR", active: true, series: ["Test"], slotCount: 2 }
];
test("выпуск меняет цену, сохраняет вычисленные признаки и отсутствующий артикул", () => {
  const input = base();
  const { products, report } = release.build(input, [{ id: 1, code: "A", name: "Первый", kind: "mechanism", price: 12,
    currency: "EUR", active: true, series: ["Test"], imageUrl: "img/catalog/A.jpg", moduleSpan: 1 }]);
  assert.equal(products[0].price, 12);
  assert.deepEqual(products[0].faceRect, { left: 2, top: 3 });
  assert.equal(products[0].articleColor, "Белый");
  assert.equal(products[0].packQty, undefined, "пустая ячейка шаблона очищает управляемый признак");
  assert.deepEqual(products[1], input[1]);
  assert.deepEqual(report.prices, [{ code: "A", before: 10, after: 12 }]);
  assert.deepEqual(report.missing, ["B"]);
  assert.deepEqual(report.retired, []);
  assert.equal(input[0].price, 10);
});
test("снятие отсутствующих требует отдельного флага", () => {
  const { products, report } = release.build(base(), [base()[0]], { retireMissing: true });
  assert.equal(products[1].active, false);
  assert.deepEqual(report.retired, ["B"]);
});
test("новое фото сбрасывает кадрирование прежнего", () => {
  const { products } = release.build(base(), [{ ...base()[0], imageUrl: "https://example.com/new.jpg" }]);
  assert.equal(products[0].faceRect, undefined);
});
test("порядок ключей не создаёт ложное изменение", () => {
  const p = base()[0];
  const result = release.build([p], [Object.fromEntries(Object.entries(p).reverse())]);
  assert.deepEqual(result.report.unchanged, ["A"]);
});
test("выпуск отвергает пустой список, повторы, цену и опасное фото", () => {
  assert.throws(() => release.validate([]));
  assert.throws(() => release.validate([base()[0], { ...base()[1], id: 1 }]));
  assert.throws(() => release.validate([base()[0], { ...base()[1], code: "a" }]));
  for (const price of [NaN, Infinity, -1, "12"])
    assert.throws(() => release.validate([{ ...base()[0], price }]));
  assert.throws(() => release.validate([{ ...base()[0], imageUrl: "javascript:alert(1)" }]));
});
test("CLI: неизменяемые версии, откат и ошибка записи сохраняют прежний указатель", async t => {
  const cli = await import("../tools/publish-price.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ep-price-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = cli.publish(root, base(), { first: true });
  const bytes = fs.readFileSync(path.join(root, "catalog", first.file));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), first.sha256);
  cli.publish(root, [{ ...base()[0], price: 99 }, base()[1]], { second: true });
  const secondManifest = fs.readFileSync(path.join(root, "catalog/current.json"));
  const firstReport = fs.readFileSync(path.join(root, "catalog/reports", first.sha256 + ".json"));
  const dry = await cli.run(["--rollback", first.sha256], root);
  assert.equal(dry.published, false);
  assert.deepEqual(fs.readFileSync(path.join(root, "catalog/current.json")), secondManifest);
  const rollback = await cli.run(["--rollback", first.sha256, "--publish"], root);
  assert.equal(rollback.manifest.sha256, first.sha256);
  assert.deepEqual(fs.readFileSync(path.join(root, "catalog", first.file)), bytes);
  assert.deepEqual(fs.readFileSync(path.join(root, "catalog/reports", first.sha256 + ".json")), firstReport);
  const manifest = fs.readFileSync(path.join(root, "catalog/current.json"));
  // Файл вместо каталога reports вызывает ошибку до атомарной замены current.json.
  fs.renameSync(path.join(root, "catalog/reports"), path.join(root, "catalog/reports-old"));
  fs.writeFileSync(path.join(root, "catalog/reports"), "blocked");
  assert.throws(() => cli.publish(root, [{ ...base()[0], price: 15 }, base()[1]], {}));
  assert.deepEqual(fs.readFileSync(path.join(root, "catalog/current.json")), manifest);
});
test("CLI bootstrap: 3364 исходных товара и признаки воспроизводятся без записи", async () => {
  const cli = await import("../tools/publish-price.mjs");
  const result = await cli.run(["--bootstrap"]);
  assert.equal(result.published, false);
  assert.equal(result.count, 3364);
  const products = cli.embeddedProducts(path.resolve(__dirname, ".."));
  const real = products.find(p => p.faceRect && p.price > 0);
  assert.ok(real, "в реальном каталоге есть товар с геометрией фото");
  const { products: merged } = release.build(products, [{ ...real, price: real.price + 1 }]);
  assert.equal(merged[0].price, real.price + 1);
  assert.deepEqual(merged[0].faceRect, real.faceRect);
  assert.equal(merged[0].packQty, real.packQty);
  assert.deepEqual(products.find(p => p.id === real.id), real);
});

test("настоящий Excel-шаблон: dry-run, выпуск с новой ценой в смете, откат", async t => {
  const cli = await import("../tools/publish-price.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ep-price-xlsx-"));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const all = cli.embeddedProducts(path.resolve(__dirname, ".."));
  const old = all.find(p => p.code === "09001");
  const first = cli.publish(root, all, { baseline: true });
  const pointer = fs.readFileSync(path.join(root, "catalog/current.json"));
  const file = path.join(root, "template.xlsx");
  fs.writeFileSync(file, require("../js/priceTemplateFile.js").build().bytes);
  const checked = await cli.run(["--file", file], root);
  assert.equal(checked.published, false);
  assert.deepEqual(fs.readFileSync(path.join(root, "catalog/current.json")), pointer);
  const published = await cli.run(["--file", file, "--publish"], root);
  const products = cli.currentProducts(root);
  const updated = products.find(p => p.code === "09001");
  assert.equal(updated.price, 4.3, "цена примера настоящего шаблона 4,30 EUR");
  assert.equal(updated.id, old.id);
  assert.equal(products.length, all.length, "прочие товары сохранены");
  const estimate = require("../js/estimate.js").build({ devices: [{ productId: old.id }], posts: [],
    product: id => products.find(p => p.id === id), settings: {
      workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 0, vatMode: "none" } });
  assert.equal(estimate.equipment, 4.3, "смета берёт именно цену выпуска");
  assert.ok(published.manifest.sha256 !== first.sha256);
  await cli.run(["--rollback", first.sha256, "--publish"], root);
  assert.deepEqual(cli.currentProducts(root), all);
  fs.writeFileSync(file, "broken Excel");
  await assert.rejects(cli.run(["--file", file, "--publish"], root));
  assert.deepEqual(fs.readFileSync(path.join(root, "catalog/current.json")), pointer);
});

test("опубликованная начальная версия точна и принимается браузерным загрузчиком", async () => {
  const cli = await import("../tools/publish-price.mjs");
  const root = path.resolve(__dirname, "..");
  const sha256 = "4c36ec535022133eddaf48944bde1260db21ddcad9f1dc74686a785cacc9c17e";
  const manifest = { schema: 1, sha256, file: "versions/" + sha256 + ".json", count: 3364 };
  const bytes = fs.readFileSync(path.join(root, "catalog", manifest.file));
  const expected = cli.embeddedProducts(root);
  assert.deepEqual(JSON.parse(bytes).products, expected);
  const Remote = require("../js/catalogRemote.js");
  const loaded = await Remote.load({ baseUrl: "https://example.com/electroPlan/", crypto: crypto.webcrypto,
    fetch: async url => url.endsWith("current.json") ? { ok: true, json: async () => manifest }
      : { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer }, fallback: [] });
  assert.equal(loaded.status.source, "published");
  assert.deepEqual(loaded.products, expected);
});
