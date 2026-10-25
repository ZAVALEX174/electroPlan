"use strict";
/* Тесты общего разбора листа прайса (js/priceSheet.js) — ОДНО место правил для проверки и
   конвертера (§7.1). Проверяем фактами каждое правило; мутационная проверка — в отчёте координатору. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/priceSheet.js");

test("parsePrice: число — как есть; текст с запятой/точкой/пробелами — разобран", () => {
  assert.equal(S.parsePrice(6.99), 6.99);         // число
  assert.equal(S.parsePrice("6,99"), 6.99);       // запятая — дробная часть
  assert.equal(S.parsePrice("12.50"), 12.5);      // точка — дробная часть
  assert.equal(S.parsePrice("1 234,50"), 1234.5); // пробел-разделитель тысяч
  assert.equal(S.parsePrice(0), 0);               // ноль — число (политику «> 0» применяет вызывающий)
  assert.equal(S.parsePrice(-5), -5);             // отрицательное — число
});

test("parsePrice: пусто/мусор → NaN", () => {
  assert.ok(Number.isNaN(S.parsePrice("")));
  assert.ok(Number.isNaN(S.parsePrice(null)));
  assert.ok(Number.isNaN(S.parsePrice("по запросу")));
  assert.ok(Number.isNaN(S.parsePrice(Infinity)));
});

test("findHeaderRow: индекс первой строки со столбцом «Артикул», иначе -1", () => {
  assert.equal(S.findHeaderRow([[], ["x"], ["Артикул", "Цена"], ["20001.0", 5]]), 2);
  assert.equal(S.findHeaderRow([["Артикул"]]), 0);
  assert.equal(S.findHeaderRow([["нет шапки"], [1, 2]]), -1);
  assert.equal(S.findHeaderRow([]), -1);
});

test("startRowOf: номер первой строки из !ref; нет !ref → 1", () => {
  assert.equal(S.startRowOf("A3:X13"), 3);     // диапазон от 3-й строки → смещение
  assert.equal(S.startRowOf("A1:U3194"), 1);   // от A1 — смещения нет
  assert.equal(S.startRowOf("B10:D20"), 10);
  assert.equal(S.startRowOf(undefined), 1);
  assert.equal(S.startRowOf(null), 1);
  assert.equal(S.startRowOf(""), 1);
});

test("rangeOrigin: верхний-левый угол !ref в 0-based {r,c}; нет/битый !ref → A1", () => {
  assert.deepEqual(S.rangeOrigin("C4:X13"), { r: 3, c: 2 });    // смещение и по строке, и по столбцу
  assert.deepEqual(S.rangeOrigin("A1:U3194"), { r: 0, c: 0 });  // от A1 — смещения нет
  assert.deepEqual(S.rangeOrigin("B10:D20"), { r: 9, c: 1 });
  assert.deepEqual(S.rangeOrigin("AA2:AC5"), { r: 1, c: 26 });  // двухбуквенный столбец
  assert.deepEqual(S.rangeOrigin(undefined), { r: 0, c: 0 });
  assert.deepEqual(S.rangeOrigin(null), { r: 0, c: 0 });
  assert.deepEqual(S.rangeOrigin(""), { r: 0, c: 0 });
});

test("moduleCountOf: «+» → сумма, «,» → максимум, дробь → как есть, мусор → null", () => {
  assert.equal(S.moduleCountOf("7+7"), 14);
  assert.equal(S.moduleCountOf("3+3"), 6);
  assert.equal(S.moduleCountOf("1, 2"), 2);
  assert.equal(S.moduleCountOf("0.5"), 0.5);
  assert.equal(S.moduleCountOf("0,5"), 0.5);
  assert.equal(S.moduleCountOf(3), 3);
  assert.equal(S.moduleCountOf(""), null);
  assert.equal(S.moduleCountOf("два"), null);    // текст без цифр — не распознан (ошибка у накладки в check)
  assert.equal(S.moduleCountOf(null), null);
});

test("chooseSheet: лист «VIMAR» по trim — приоритет над остальными", () => {
  const grids = {
    "Служебный": [["мусор"]],
    "VIMAR ": [[], [], ["Артикул", "Цена"], ["20001.0", 5]],
    "Прочее": [["Артикул"]],
  };
  const r = S.chooseSheet({ names: Object.keys(grids), grid: (n) => grids[n], ref: () => "A1:B9" });
  assert.equal(r.name, "VIMAR ");
  assert.equal(r.startRow, 1);
});

test("chooseSheet: нет VIMAR → первый лист со столбцом «Артикул»", () => {
  const grids = {
    "Пояснения": [["Столбец", "Что это"]],
    "Прайс": [["Артикул", "Цена"], ["20001.0", 5]],
  };
  const r = S.chooseSheet({ names: Object.keys(grids), grid: (n) => grids[n], ref: () => "A1:B2" });
  assert.equal(r.name, "Прайс");
});

test("chooseSheet: нет VIMAR и нет «Артикула» → первый лист книги", () => {
  const grids = { "Один": [["нет шапки"]], "Два": [["тоже нет"]] };
  const r = S.chooseSheet({ names: Object.keys(grids), grid: (n) => grids[n] });
  assert.equal(r.name, "Один");
});

test("chooseSheet: startRow берётся из !ref выбранного листа", () => {
  const grids = { "VIMAR": [["Артикул"]] };
  const r = S.chooseSheet({ names: ["VIMAR"], grid: (n) => grids[n], ref: () => "A3:U100" });
  assert.equal(r.startRow, 3);
});
