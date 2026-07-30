/* Автотесты фильтра поиска кастомного списка EPPicker (PLAN 7.1).
   Тестируем ЧИСТУЮ функцию filterOptions — она не трогает DOM, поэтому браузер не нужен.
   Запуск: node --test tests/  */
const test = require("node:test");
const assert = require("node:assert/strict");
const { filterOptions } = require("../js/picker.js");

/* Опции как их формирует приложение: searchText = артикул + название. */
const OPTIONS = [
  { value: "1", searchText: "09001 Выключатель 1П 16AX 1 модуль" },
  { value: "2", searchText: "09002 Розетка 2К+З Plana" },
  { value: "3", searchText: "20114 Диммер поворотный Eikon" },
  { value: "4", searchText: "14653 Накладка Plana 3 модуля" }
];

test("пустой запрос возвращает все опции", () => {
  assert.equal(filterOptions(OPTIONS, "").length, 4);
  assert.equal(filterOptions(OPTIONS, "   ").length, 4);
  assert.equal(filterOptions(OPTIONS, null).length, 4);
});

test("фильтр по названию — регистронезависимо", () => {
  const res = filterOptions(OPTIONS, "РОЗЕТКА");
  assert.equal(res.length, 1);
  assert.equal(res[0].value, "2");
});

test("фильтр по артикулу", () => {
  const res = filterOptions(OPTIONS, "20114");
  assert.equal(res.length, 1);
  assert.equal(res[0].value, "3");
});

test("несколько токенов — И-логика (все должны совпасть)", () => {
  const res = filterOptions(OPTIONS, "plana 3");
  assert.equal(res.length, 1, "«plana 3» находит только накладку Plana 3 модуля");
  assert.equal(res[0].value, "4");
});

test("частичное совпадение подстрокой", () => {
  const res = filterOptions(OPTIONS, "выкл");
  assert.equal(res.length, 1);
  assert.equal(res[0].value, "1");
});

test("нет совпадений — пустой массив", () => {
  assert.equal(filterOptions(OPTIONS, "термостат").length, 0);
});

test("один токен совпал по артикулу, второй нигде — опция отсеивается", () => {
  assert.equal(filterOptions(OPTIONS, "09001 розетка").length, 0);
});

test("возвращается копия, исходный массив не мутируется", () => {
  const res = filterOptions(OPTIONS, "");
  assert.notEqual(res, OPTIONS, "новый массив, а не ссылка на исходный");
  res.pop();
  assert.equal(OPTIONS.length, 4, "исходный массив не тронут");
});

test("опция без searchText не падает и не совпадает при запросе", () => {
  const opts = [{ value: "x" }, { value: "y", searchText: "розетка" }];
  assert.equal(filterOptions(opts, "розетка").length, 1);
  assert.equal(filterOptions(opts, "").length, 2);
});
