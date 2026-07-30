/* Автотесты состава и стоимости поста (PLAN 7.1).
   Запуск без зависимостей и без сборщика:  node --test tests/
   Модуль js/posts.js — чистый: каталог и подбор суппорта/коробки приходят через deps,
   поэтому браузер поднимать не нужно. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { postCost, postComposition, boxCount } = require("../js/posts.js");

/* Каталог-заглушка на реальных артикулах VIMAR. Накладки (kind frame) несут стандарт
   и число постов ровно так, как их проставит загрузчик из колонок прайса.
   Механизм 1M — 4.30 €, 2M — 6.01 €, накладки/коробка — свои цены. */
const CATALOG = {
  1: { id: 1, code: "09001", name: "Выключатель 1М", price: 4.30, moduleSpan: 1 },
  2: { id: 2, code: "09001.2", name: "Выключатель 2М", price: 6.01, moduleSpan: 2 },
  // накладки
  14653: { id: 14653, code: "14653", name: "Накладка Plana 3М", price: 3.0, standard: "IT", series: "Plana", slotCount: 3 },
  14643: { id: 14643, code: "14643", name: "Накладка Plana 2+2", price: 5.0, standard: "DE", postCount: 2, series: "Plana", slotCount: 4 },
  14644: { id: 14644, code: "14644", name: "Накладка Plana 2+2+2", price: 7.0, standard: "DE", postCount: 3, series: "Plana", slotCount: 6 },
  9662:  { id: 9662, code: "09662", name: "Накладка Neve Up 2М", price: 3.12, standard: "unknown", series: "Neve Up", slotCount: 2 },
  // суппорт и коробки
  14613: { id: 14613, code: "14613", name: "Суппорт Plana 3М", price: 2.5, kind: "support", series: "Plana", moduleCount: 3 },
  71303: { id: 71303, code: "V71303", name: "Коробка 3М прямоуг.", price: 1.2, kind: "socket_box", wallType: "solid" },
  71001: { id: 71001, code: "V71001", name: "Коробка кругл. ø60", price: 0.85, kind: "socket_box", wallType: "solid" }
};
const product = id => CATALOG[id];
const mechanismSpan = item => (item && item.moduleSpan) || 1;
/* Универсальный подрозетник по умолчанию — как socketBox() в приложении. */
const socketBox = () => CATALOG[71001];
const baseDeps = (over) => Object.assign({ product, frameProduct: product, socketBox, mechanismSpan }, over || {});

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${msg}: получено ${actual}, ожидалось ${expected}`);

test("итальянская 3-модульная накладка: одна коробка на всю сборку", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };   // три 1М-механизма
  const comp = postComposition(post, baseDeps());
  assert.equal(comp.standard, "IT");
  assert.equal(comp.boxCount, 1, "IT — ровно одна прямоугольная коробка");
  assert.equal(comp.approximate, false);
  // цена: 3×4.30 механизмы + 3.0 накладка + 1×0.85 коробка (суппорт не подобран)
  near(postCost(post, baseDeps()), 3 * 4.30 + 3.0 + 0.85, "стоимость IT-поста");
});

test("немецкая накладка 2+2: коробка на каждый пост (2 поста)", () => {
  const post = { frameId: 14643, mechanismIds: [2, 2] };   // два 2М-механизма = 2 поста
  const comp = postComposition(post, baseDeps());
  assert.equal(comp.standard, "DE");
  assert.equal(comp.boxCount, 2, "DE 2+2 — две круглые коробки");
  assert.equal(comp.postCount, 2);
  near(postCost(post, baseDeps()), 2 * 6.01 + 5.0 + 2 * 0.85, "стоимость DE-поста 2+2");
});

test("немецкая 2+2+2 берёт число постов из накладки (postCount=3)", () => {
  const post = { frameId: 14644, mechanismIds: [2, 2, 2] };
  assert.equal(postComposition(post, baseDeps()).boxCount, 3);
});

test("немецкий стандарт без явного postCount: по 2 модуля на пост", () => {
  const frame = { id: 999, code: "X", name: "DE 4М", price: 5, standard: "DE", series: "Plana" };
  const deps = baseDeps({ frameProduct: id => (id === 999 ? frame : product(id)) });
  const post = { frameId: 999, mechanismIds: [1, 1, 1, 1] };   // 4 модуля → 2 поста
  assert.equal(postComposition(post, deps).boxCount, 2, "ceil(4/2)=2");
});

test("неизвестный стандарт: старое поведение (коробка на механизм) + пометка", () => {
  const post = { frameId: 9662, mechanismIds: [1, 1] };
  const comp = postComposition(post, baseDeps());
  assert.equal(comp.standard, "UNKNOWN");
  assert.equal(comp.approximate, true, "состав помечен приблизительным");
  assert.equal(comp.boxCount, 2, "по числу механизмов, как раньше");
});

test("старый набор deps (без стандарта/подбора) считает как прежняя формула", () => {
  /* Регресс: postCost со старыми deps = механизмы + socketBox×N + накладка. */
  const post = { frameId: 9662, mechanismIds: [1, 1] };
  const oldDeps = { product, frameProduct: product, socketBox };
  near(postCost(post, oldDeps), 2 * 4.30 + 2 * 0.85 + 3.12, "совпадает со старой формулой");
});

test("суппорт подбирается через deps и входит в цену и состав", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findSupport: () => CATALOG[14613] });
  const comp = postComposition(post, deps);
  assert.equal(comp.support && comp.support.code, "14613", "суппорт найден");
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 2.5 + 0.85, "суппорт учтён в стоимости");
});

test("суппорт не подобран — поле null, в цену не попадает", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findSupport: () => null });
  assert.equal(postComposition(post, deps).support, null);
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 0.85, "без суппорта");
});

test("подобранная коробка задаёт цену коробки вместо универсального подрозетника", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findBox: () => CATALOG[71303] });   // прямоугольная 1.2 €
  const comp = postComposition(post, deps);
  assert.equal(comp.box && comp.box.code, "V71303");
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 1 * 1.2, "цена по подобранной коробке");
});

test("пустой пост — ноль коробок, нулевая стоимость коробок", () => {
  const post = { frameId: 14653, mechanismIds: [] };
  assert.equal(postComposition(post, baseDeps()).boxCount, 0);
});

test("boxCount экспортируется и считает независимо", () => {
  assert.equal(boxCount({ mechanismIds: [1, 1, 1] }, product(14653), "IT", baseDeps()), 1);
  assert.equal(boxCount({ mechanismIds: [2, 2] }, product(14643), "DE", baseDeps()), 2);
});
