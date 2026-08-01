/* Автотесты доменного каталога (EPCatalog, js/catalog.js). Модуль чистый — товары
   приходят объектами, браузер не нужен. Здесь проверяем ёмкость рамок: конструктор
   расширен до 8 модулей (основные размеры заказчика 6-7-8, ответы 31.07 §2.6), а
   многорядные накладки (14=7+7, 21=7+7+7) в подбор НЕ попадают — их двумерную нумерацию
   конструктор пока не поддерживает (отложено владельцем). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { frameSlotCount, frameOpening } = require("../js/catalog.js");

/* --- ёмкость рамки: явная slotCount 1..8 авторитетна --- */
test("frameSlotCount: рамки 6/7/8 модулей теперь распознаются", () => {
  assert.equal(frameSlotCount({ slotCount: 6 }), 6);
  assert.equal(frameSlotCount({ slotCount: 7 }), 7);
  assert.equal(frameSlotCount({ slotCount: 8 }), 8);
});
test("frameSlotCount: прежние размеры 1..5 не сломаны", () => {
  for (const n of [1, 2, 3, 4, 5]) assert.equal(frameSlotCount({ slotCount: n }), n);
});
test("frameSlotCount: многорядные 14 (7+7) и 21 (7+7+7) → null (не предлагаются)", () => {
  assert.equal(frameSlotCount({ slotCount: 14, name: "Накладка для 14 модулей (7+7)" }), null);
  assert.equal(frameSlotCount({ slotCount: 21, name: "Накладка для 21 модуля (7+7+7)" }), null);
});
test("frameSlotCount: явная ёмкость >8 не угадывается по названию (14 модулей ≠ 4)", () => {
  // Раньше при slotCount вне диапазона логика падала на regex и «14 модулей» давало 4 —
  // многорядная накладка утекала под размер 4. Явная ёмкость должна возвращать null.
  assert.equal(frameSlotCount({ slotCount: 14, name: "Рамка на 14 модулей" }), null);
});
test("frameSlotCount: без явного slotCount берём число из названия (1..8)", () => {
  assert.equal(frameSlotCount({ name: "Накладка на 7 модулей, белая" }), 7);
  assert.equal(frameSlotCount({ name: "Накладка на 8 модулей (2+2+2+2)" }), 8);
});

/* --- превью: у 6/7/8 есть свои пропорции окна (не падение на дефолт 3 мод.) --- */
test("frameOpening: для 8 модулей своя геометрия окна, а не запасная под 3", () => {
  const wide = frameOpening({}, 8);
  const narrow = frameOpening({}, 3);
  assert.notEqual(wide.aspect, narrow.aspect);
  assert.ok(wide.aspect > narrow.aspect, "окно 8М шире окна 3М");
  assert.ok(wide.left + wide.width <= 100, "окно не выходит за пределы рамки");
});
