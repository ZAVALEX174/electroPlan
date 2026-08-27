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

test("applyKindOverrides: frame→socket_box пересчитывает производные признаки", () => {
  // как запись из readNomenclature: у накладки есть slotCount, категория/иконка рамки
  const records = [
    { code: "14902", kind: "frame", name: "Коробка IP55 2 модуля", moduleSize: 2, slotCount: 2, categoryId: 100, icon: "□" },
    { code: "14653.01", kind: "frame", name: "Накладка 2М", moduleSize: 2, slotCount: 2, categoryId: 100, icon: "□" },
  ];
  const { applied } = N.applyKindOverrides(records, { "14902": { kind: "socket_box", why: "корпус" } });
  assert.equal(applied, 1);
  const box = records[0];
  assert.equal(box.kind, "socket_box");
  assert.equal("slotCount" in box, false);            // признак рамки снят
  assert.equal(box.boxShape, "rect");                 // без слова формы → прямоугольная
  assert.deepEqual(box.boxStandards, ["IT"]);
  assert.deepEqual({ categoryId: box.categoryId, icon: box.icon }, { categoryId: 200, icon: "○" });
  // не тронутая запись осталась рамкой
  assert.equal(records[1].kind, "frame");
  assert.equal(records[1].slotCount, 2);
});

test("applyKindOverrides: mechanism→accessory не даёт признаков поста (не в buildAttrs)", () => {
  const records = [
    { code: "00938.B", kind: "mechanism", name: "Светодиод для подсветок", moduleSize: 1 },
  ];
  const { applied } = N.applyKindOverrides(records, { "00938.B": { kind: "accessory", why: "не модуль поста" } });
  assert.equal(applied, 1);
  assert.equal(records[0].kind, "accessory");
  // accessory не попадает ни в накладки, ни в суппорты, ни в коробки автосостава
  const a = N.buildAttrs(records);
  assert.equal("00938.B" in a.standards, false);
  assert.equal("00938.B" in a.supports, false);
  assert.equal("00938.B" in a.boxes, false);
});

test("applyKindOverrides: пустая карта и совпадающий kind — ноль правок", () => {
  const records = [{ code: "X", kind: "mechanism", name: "Механизм", moduleSize: 1 }];
  assert.equal(N.applyKindOverrides(records, {}).applied, 0);
  // артикула нет в записях — игнорируется без ошибки
  assert.equal(N.applyKindOverrides(records, { "Y": { kind: "accessory" } }).applied, 0);
  // kind уже совпадает — не считается правкой
  assert.equal(N.applyKindOverrides(records, { "X": { kind: "mechanism" } }).applied, 0);
});

test("buildAttrs: формат признаков для рантайма (standards/supports/boxes)", () => {
  const records = [
    { code: "14653.01", kind: "frame", standard: "IT" },
    { code: "14613", kind: "support", standard: "IT", moduleSize: 3, pitchMm: null },
    { code: "V71303", kind: "socket_box", standard: "IT", wallType: "solid", boxShape: "rect", moduleSize: 3, boxStandards: ["IT"] },
    { code: "09001", kind: "mechanism", standard: "BOTH" },  // механизм без правила в attrs не попадает
  ];
  const a = N.buildAttrs(records);
  assert.deepEqual(a.standards["14653.01"], { standard: "IT", postCount: null });
  assert.deepEqual(a.supports["14613"], { standard: "IT", modules: 3, pitchMm: null });
  assert.deepEqual(a.boxes["V71303"], { wallType: "solid", shape: "rect", modules: 3, standards: ["IT"] });
  assert.equal(a.wallTypes["V71303"], "solid");
  assert.equal("09001" in a.standards, false);
  assert.equal("09001" in a.supports, false);
  assert.equal("09001" in a.mounting, false);   // и в mounting тоже: правила у записи нет
});

test("buildAttrs: монтажное правило (принцип + модульность коробки) доходит до рантайма", () => {
  /* Без этих двух полей подбор считает коробку и суппорт по ёмкости накладки, и все
     «центральные» позиции получают не то: 09672 (2М-накладка в коробку на 3 модуля)
     подбирала обычный 2М-суппорт вместо выделенного 09606. Поля нужны И накладке, И
     суппорту — именно совпадение пары связывает их между собой. */
  const records = [
    { code: "09672.01", kind: "frame", standard: "IT", principle: "2M_CENTRAL", boxModularity: 3 },
    { code: "09606", kind: "support", standard: "IT", moduleSize: 2, pitchMm: null, principle: "2M_CENTRAL", boxModularity: 3 },
  ];
  const a = N.buildAttrs(records);
  assert.deepEqual(a.standards["09672.01"], { standard: "IT", postCount: null, principle: "2M_CENTRAL", boxModularity: 3 });
  assert.deepEqual(a.supports["09606"], { standard: "IT", modules: 2, pitchMm: null, principle: "2M_CENTRAL", boxModularity: 3 });
});

test("buildAttrs: у позиции без монтажного правила ключей principle/boxModularity нет", () => {
  /* Правило есть у 449 позиций из 2146 — пустые ключи у остальных раздули бы файл
     атрибутов и заставили бы рантайм отличать «нет правила» от «правило пустое». */
  const a = N.buildAttrs([{ code: "14613", kind: "support", standard: "IT", moduleSize: 3, pitchMm: null, principle: null, boxModularity: null }]);
  assert.equal("principle" in a.supports["14613"], false);
  assert.equal("boxModularity" in a.supports["14613"], false);
});

test("buildAttrs: принцип обработки МЕХАНИЗМА едет в рантайм разделом mounting", () => {
  /* Своего раздела признаков у механизмов нет (стандарт сборки и модульность поста им
     ни к чему), и правило им долго не проставлялось вовсе: addMountingRule звался только
     в ветках накладки и суппорта, из-за чего 158 механизмов с заполненным «Принципом
     обработки» (BUTTON, SCHUP, Bluetooth) до каталога не доезжали. Ключ — артикул. */
  const records = [
    { code: "09001", kind: "mechanism", standard: "BOTH", principle: "BUTTON" },
    { code: "03925", kind: "mechanism", standard: "IT", principle: "Bluetooth" },
    { code: "00935.A", kind: "accessory", principle: "LED", boxModularity: 1 },   // прочие виды — туда же
  ];
  const a = N.buildAttrs(records);
  assert.deepEqual(a.mounting["09001"], { principle: "BUTTON" });
  assert.deepEqual(a.mounting["03925"], { principle: "Bluetooth" });
  assert.deepEqual(a.mounting["00935.A"], { principle: "LED", boxModularity: 1 });
  // механизм не должен просочиться в разделы накладок/суппортов/коробок
  assert.equal("09001" in a.standards, false);
  assert.equal("09001" in a.boxes, false);
});

test("buildAttrs: принцип обработки КОРОБКИ едет в её запись boxes", () => {
  /* IP55-корпуса 14901–14904 переклассифицированы из накладок в socket_box
     (tools/data/kind-overrides.json), а ветка socket_box монтажное правило не переносила —
     «NO_INNERS, AQUAPLATE» терялся ровно у тех четырёх позиций, ради которых оверрайд
     и делался. Правило живёт в самой записи коробки, а не в mounting: раздел признаков
     у коробки есть, и js/data.js читает её одним лукапом. */
  const a = N.buildAttrs([
    { code: "14901", kind: "socket_box", wallType: "unknown", boxShape: "rect", moduleSize: 1, boxStandards: ["IT"], principle: "NO_INNERS, AQUAPLATE" },
  ]);
  assert.deepEqual(a.boxes["14901"], {
    wallType: "unknown", shape: "rect", modules: 1, standards: ["IT"], principle: "NO_INNERS, AQUAPLATE",
  });
  assert.equal("14901" in a.mounting, false);   // без дублирования между разделами
  assert.equal("14901" in a.wallTypes, false);  // тип стены неизвестен — в подбор не идёт
});
