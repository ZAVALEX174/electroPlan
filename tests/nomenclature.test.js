"use strict";
/* Тесты классификации номенклатуры VIMAR и сведения цен с прайсом (tools/lib/nomenclature.mjs).
   Модуль — ESM (.mjs), подключаем через динамический import в before(); чистые функции
   файлов не читают, поэтому тесты детерминированы и не зависят от .xls. */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

let N;
before(async () => {
  N = await import(pathToFileURL(path.join(__dirname, "../tools/lib/nomenclature.mjs")).href);
});

test("kindOf: функциональная группа → тип товара", () => {
  assert.equal(N.kindOf("Монтажные коробки"), "socket_box");
  assert.equal(N.kindOf("Суппорты"), "support");
  assert.equal(N.kindOf("Декоративные накладки"), "frame");
  assert.equal(N.kindOf("управление светом"), "mechanism");
  assert.equal(N.kindOf("Розетки"), "mechanism");
  assert.equal(N.kindOf("отели"), "mechanism");      // регистр в файле разный
  assert.equal(N.kindOf("Отели"), "mechanism");
  assert.equal(N.kindOf(""), "mechanism");           // пусто → устройство по умолчанию
});

test("standardOf: монтажный стандарт", () => {
  assert.equal(N.standardOf("Итальянский"), "IT");
  assert.equal(N.standardOf("Немецкий"), "DE");
  assert.equal(N.standardOf("Итальянский, Немецкий"), "BOTH");
  assert.equal(N.standardOf(""), "UNKNOWN");
});

test("wallTypeOf: тип стены (оба → universal/unknown)", () => {
  assert.equal(N.wallTypeOf("Кирпич"), "solid");
  assert.equal(N.wallTypeOf("ГКЛ"), "hollow");
  assert.equal(N.wallTypeOf("ГКЛ, Кирпич"), "unknown");   // подходит к любой стене
  assert.equal(N.wallTypeOf(""), "unknown");
});

test("moduleCountOf: размер в модулях (число и диапазон-строка)", () => {
  assert.equal(N.moduleCountOf(3), 3);
  assert.equal(N.moduleCountOf(7), 7);
  assert.equal(N.moduleCountOf("1, 2"), 2);   // круглая коробка «для 1-2 модулей» → до 2
  assert.equal(N.moduleCountOf(null), null);
  assert.equal(N.moduleCountOf(""), null);
});

test("boxShapeOf / boxStandardsOf: форма и совместимые стандарты коробки", () => {
  assert.equal(N.boxShapeOf("Коробка встраиваемая круглая для 1-2 модулей"), "round");
  assert.equal(N.boxShapeOf("Коробка встраиваемая прямоугольная для 3 модулей"), "rect");
  assert.equal(N.boxShapeOf("Коробка встраиваемая для 8 модулей"), "rect");  // без слова формы → прямоугольная (IT)
  assert.deepEqual(N.boxStandardsOf("round"), ["IT_ROUND", "DE", "FR"]);
  assert.deepEqual(N.boxStandardsOf("rect"), ["IT"]);
});

test("seriesListOf: список серий → массив с показным регистром", () => {
  assert.deepEqual(N.seriesListOf("NEVE UP"), ["Neve Up"]);
  assert.deepEqual(N.seriesListOf("EIKON EVO, EIKON EXE"), ["Eikon Evo", "Eikon Exe"]);
  assert.deepEqual(N.seriesListOf("ARKE FIT"), ["Arke Fit"]);
  assert.deepEqual(N.seriesListOf(""), []);   // коробки без серии
});

test("categoryAndIcon: фикс для рамки/суппорта/коробки, classify для механизма", () => {
  assert.deepEqual(N.categoryAndIcon("frame", "Накладка на 2 модуля, белая"), { categoryId: 100, icon: "□" });
  assert.deepEqual(N.categoryAndIcon("support", "Суппорт для 2 модулей 71мм"), { categoryId: 200, icon: "≡" });
  assert.deepEqual(N.categoryAndIcon("socket_box", "Коробка круглая"), { categoryId: 200, icon: "○" });
  // механизм: категория для группировки выпадающего списка (не 100/200)
  const sw = N.categoryAndIcon("mechanism", "Выключатель 1П 16AX 1 модуль, белый");
  assert.equal(sw.categoryId, 500);
  const socket = N.categoryAndIcon("mechanism", "Розетка 2P+T 16A немецкий стандарт, белая");
  assert.equal(socket.categoryId, 300);
});

test("resolveCatalogPrice: приоритет прайса, номенклатура — фолбэк", () => {
  // цена есть в прайсе → берём её, источник price
  assert.deepEqual(N.resolveCatalogPrice(0.64, { price: 0.85, pack: 10 }), { price: 0.85, source: "price", packQty: 10 });
  // нет в прайсе (price=null) → фолбэк на номенклатуру
  assert.deepEqual(N.resolveCatalogPrice(7.36, { price: null, pack: null }), { price: 7.36, source: "nomenclature", packQty: null });
  // нет записи в прайсе вовсе → фолбэк
  assert.deepEqual(N.resolveCatalogPrice(12.5, undefined), { price: 12.5, source: "nomenclature", packQty: null });
  // битая цена прайса (0/отрицательная) не должна победить номенклатуру
  assert.equal(N.resolveCatalogPrice(5, { price: 0 }).source, "nomenclature");
  // округление до 2 знаков
  assert.equal(N.resolveCatalogPrice(null, { price: 1.239 }).price, 1.24);
});

test("buildAttrs: формат признаков для рантайма (standards/supports/boxes)", () => {
  const records = [
    { code: "14653.01", kind: "frame", standard: "IT" },
    { code: "14613", kind: "support", standard: "IT", moduleSize: 3, pitchMm: null },
    { code: "V71303", kind: "socket_box", standard: "IT", wallType: "solid", boxShape: "rect", moduleSize: 3, boxStandards: ["IT"] },
    { code: "09001", kind: "mechanism", standard: "BOTH" },  // механизм в attrs не попадает
  ];
  const a = N.buildAttrs(records);
  assert.deepEqual(a.standards["14653.01"], { standard: "IT", postCount: null });
  assert.deepEqual(a.supports["14613"], { standard: "IT", modules: 3, pitchMm: null });
  assert.deepEqual(a.boxes["V71303"], { wallType: "solid", shape: "rect", modules: 3, standards: ["IT"] });
  assert.equal(a.wallTypes["V71303"], "solid");
  assert.equal("09001" in a.standards, false);
  assert.equal("09001" in a.supports, false);
});
