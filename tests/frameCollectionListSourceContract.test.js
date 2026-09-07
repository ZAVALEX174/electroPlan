/* КОНТРАКТ ИСТОЧНИКА (не поведение!) для frameCollectionList (js/app.js).
   Запуск: node --test tests/

   ⚠️ ПОЧЕМУ КОНТРАКТ, А НЕ ПОВЕДЕНИЕ. frameCollectionList строит список коллекций для селектора
   «Коллекция комнаты» из накладок: EPCatalog.productCollections(byKind("frame")). На ТЕКУЩЕМ прайсе
   три подмены источника дают тот же результат — 9 коллекций совпадают побайтно:
     • byKind("frame")            → 9 коллекций (эталон);
     • state.products (все kind)  → те же 9 (проверено: механизмы не добавляют НИ ОДНОЙ новой серии);
     • byKind("mechanism")        → те же 9 (мультиколлекционные механизмы живут в тех же сериях);
     • накладки без фильтра active → те же 9 (снятых с производства накладок с уникальной серией нет).
   Поэтому ПОВЕДЕНЧЕСКИ (по составу списка) эти мутации неразличимы и остаются зелёными — доказано
   состязательным проходом. Но неразличимость СЛУЧАЙНА: первая же серия, которая заведётся ТОЛЬКО в
   механизмах или ТОЛЬКО в снятых с производства позициях, молча просочится в селектор комнаты — а
   там место лишь для реальных накладок. Держим источник КОНТРАКТОМ: шпион на byKind фиксирует, что
   список берётся ровно из активных НАКЛАДОК (byKind("frame")), а не из другого множества товаров.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     productCollections(state.products)      → byKind не зван вовсе → §1 краснеет (calls.length===0);
     productCollections(byKind("mechanism")) → зван с "mechanism"   → §1 краснеет (arg!=="frame");
     productCollections(state.products.filter(x=>x.kind==="frame")) (без active, минуя byKind)
                                             → byKind не зван вовсе → §1 краснеет (calls.length===0). */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPCatalog = require("../js/catalog.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const FRAMES = PRODUCTS.filter(x => x.kind === "frame" && x.active);

test("§1 frameCollectionList берёт список ровно из byKind(\"frame\"), а не из иного множества товаров", () => {
  /* Шпион на byKind: продакшн-функция сама выбирает, что запросить. Возвращаем реальные накладки,
     чтобы результат остался осмысленным, но проверяем НЕ его состав (он совпал бы у всех источников),
     а сам запрос: ровно один вызов, ровно с "frame". */
  const calls = [];
  const ctx = {
    EPCatalog,
    byKind(kind) { calls.push(kind); return FRAMES; }
  };
  const frameCollectionList = stand.run("frameCollectionList", ctx);
  const result = frameCollectionList();

  assert.equal(calls.length, 1, "byKind вызван ровно один раз — список строится из одного множества товаров");
  assert.equal(calls[0], "frame",
    "запрошены именно накладки (byKind(\"frame\")): подмена на state.products/mechanism/без-active уводит источник в другое множество");
  /* Контрольная привязка к продакшн-выводу: на переданных накладках список = productCollections(FRAMES). */
  assert.deepEqual(result, EPCatalog.productCollections(FRAMES),
    "результат — productCollections поверх запрошенных накладок (контроль, что функция действительно строит список из byKind(\"frame\"))");
});
