/* Автотесты чистой математики переноса объектов (EPDrag, PLAN 7.1).
   Проверяем ровно то, что легко сломать: порог «клик vs перенос» и пересчёт
   мировых координат с учётом масштаба вида. DOM не нужен — функции чистые.
   Запуск: node --test tests/  */
const test = require("node:test");
const assert = require("node:assert/strict");
const { beyondThreshold, worldPosition } = require("../js/drag.js");

test("порог: точное значение порога уже считается переносом", () => {
  /* ровно 4px по одной оси — граница включительно (>=), это уже перенос */
  assert.equal(beyondThreshold(4, 0, 4), true);
  assert.equal(beyondThreshold(0, 4, 4), true);
});

test("порог: мелкое дрожание в пределах порога — ещё клик", () => {
  assert.equal(beyondThreshold(3, 0, 4), false);
  assert.equal(beyondThreshold(2, 2, 4), false, "диагональ 2,2 (~2.83px) короче 4px");
  assert.equal(beyondThreshold(0, 0, 4), false);
});

test("порог: диагональ длиннее порога — перенос", () => {
  assert.equal(beyondThreshold(3, 3, 4), true, "диагональ 3,3 (~4.24px) длиннее 4px");
});

test("пересчёт координат при масштабе 1: дельта курсора 1:1", () => {
  const p = worldPosition({ x: 100, y: 50 }, { x: 200, y: 200 }, { x: 230, y: 180 }, 1);
  assert.deepEqual(p, { x: 130, y: 30 });
});

test("пересчёт координат при зуме: экранную дельту делим на scale", () => {
  /* вид увеличен вдвое: сдвиг курсора на 40 экранных px = 20 мировых */
  const p = worldPosition({ x: 100, y: 100 }, { x: 0, y: 0 }, { x: 40, y: 0 }, 2);
  assert.deepEqual(p, { x: 120, y: 100 });
});

test("пересчёт координат при отдалении: scale<1 увеличивает мировую дельту", () => {
  const p = worldPosition({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 0.5);
  assert.deepEqual(p, { x: 20, y: 20 });
});

test("нулевой масштаб не делит на ноль (страховка → как scale 1)", () => {
  const p = worldPosition({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 3, y: 3 }, 0);
  assert.deepEqual(p, { x: 8, y: 8 });
});
