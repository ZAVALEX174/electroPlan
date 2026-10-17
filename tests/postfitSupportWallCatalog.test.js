/* К4а на НАСТОЯЩЕМ каталоге: суппорт немецкого поста выбирается по типу стены (602 бетон /
   603 ГКЛ) ВЕЗДЕ (решение владельца 17.10, К4). Фикстурные тесты в postfit.test.js брали
   немецкую накладку на 2 модуля (frameModules:2) и попадали на точное совпадение модульности
   `byType.find(mod===target)`, минуя запасную ветку `byType[0]`. Но в каталоге ВСЕ немецкие
   накладки — на 4/6/8 мест (постов 2/3/4), а суппорты 602/603 все 2-модульные, поэтому у них
   точное совпадение модульности промахивается и планку выбирает именно `byType[0]`. Этот тест
   грузит каталог теми же тремя файлами и в том же порядке, что index.html, и прогоняет подбор
   на реальных многопостовых немецких накладках — иначе дефект в `byType[0]` остаётся незамеченным. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const postfit = require("../js/postfit.js");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "js");
const FILES = ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"];

/* Каталог как в браузере: исполняем те же файлы в том же порядке, что index.html. */
async function loadProducts() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), "utf8"), context, { filename: file });
  }
  return win.DataService.getProducts();
}

/* Подбор суппорта ровно как его зовёт posts.postComposition: resolveSupport получает
   реальную накладку, подобранную коробку и ПОЛНОЕ число модулей поста (modules), а не 2.
   Именно modules=6/4 заставляет сработать `byType[0]`. */
function pickSupport(products, frameCode, boxCode) {
  const frame = products.find(p => p.code === frameCode);
  assert.ok(frame, `накладка ${frameCode} должна быть в каталоге`);
  const box = products.find(p => p.code === boxCode);
  assert.ok(box, `коробка ${boxCode} должна быть в каталоге`);
  const supports = products.filter(p => p.kind === "support" &&
    (p.series || []).some(s => (frame.series || []).includes(s)));
  const r = postfit.resolveSupport({
    supports, frame, standard: frame.standard,
    modules: frame.slotCount,                 // полное число мест накладки (6 или 4), не 2
    series: frame.series, box, seriesOf: p => p.series
  });
  return { frame, support: r && r.support };
}

test("К4а/каталог: немецкая Plana 14644.01 (6 мест, 3 поста) — бетон → 14602, ГКЛ → 14603", async () => {
  const products = await loadProducts();
  const concrete = pickSupport(products, "14644.01", "V71001");
  const hollow = pickSupport(products, "14644.01", "V71701");
  assert.equal(concrete.frame.standard, "DE");
  assert.equal(concrete.frame.slotCount, 6, "накладка на 6 мест — целевая модульность не равна 2");
  assert.ok(concrete.support, "в бетоне суппорт должен подобраться");
  assert.equal(concrete.support.code, "14602", "бетон → 602-суппорт (с защёлками)");
  assert.equal(hollow.support.code, "14603", "ГКЛ → 603-суппорт (без винтов)");
  /* Доказываем, что сработала именно ветка byType[0]: выбранный суппорт 2-модульный,
     а целевая модульность поста — 6, точного совпадения модульности нет. */
  assert.equal(concrete.support.moduleCount, 2);
  assert.notEqual(concrete.frame.slotCount, concrete.support.moduleCount);
});

test("К4а/каталог: немецкая Eikon Exe 22643.02 (4 места, 2 поста) — бетон → 21602, ГКЛ → 21603", async () => {
  const products = await loadProducts();
  const concrete = pickSupport(products, "22643.02", "V71001");
  const hollow = pickSupport(products, "22643.02", "V71701");
  assert.equal(concrete.frame.standard, "DE");
  assert.equal(concrete.frame.slotCount, 4);
  assert.equal(concrete.support.code, "21602", "бетон → 602 (с защёлками)");
  assert.equal(hollow.support.code, "21603", "ГКЛ → 603 (без винтов)");
  assert.equal(concrete.support.moduleCount, 2);
  assert.notEqual(concrete.frame.slotCount, concrete.support.moduleCount);
});
