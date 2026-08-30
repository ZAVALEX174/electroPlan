/* Автотесты допуска привязки к комнате у границы контура (PLAN 7.1). Закрывают
   денежный дефект: пост у дверного проёма стоит центром РОВНО на линии стены, а
   pointInPolygon трактует точку на границе как «снаружи» — один пиксель менял
   схему проводки и сумму сметы. Тестируется чистая EPRoomAssign.nearestRoomWithinTolerance;
   геометрия — настоящая (EPGeom.distancePointToSegment), свою проекцию не заводим.
   Запуск без сборщика и браузера: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const { nearestRoomWithinTolerance } = require("../js/roomAssign.js");
const { distancePointToSegment, pointInPolygon } = require("../js/geometry.js");

/* Прямоугольник как полигон-контур: расстояние до его рёбер считается руками и
   проверяемо. Комнаты храним в форме {id, polygon:[{x,y}]} — как в state.rooms. */
const rect = (x1, y1, x2, y2) => [
  { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }
];
const room = (id, poly) => ({ id, polygon: poly });
/* всегда прогоняем через настоящую геометрию проекта, а не через свою копию */
const nearest = (cx, cy, rooms, tol) =>
  nearestRoomWithinTolerance(cx, cy, rooms, tol, distancePointToSegment);

test("точка ровно на границе (расстояние 0) — привязывается", () => {
  const rooms = [room("a", rect(0, 0, 100, 100))];
  // (50,0) лежит на верхнем ребре: расстояние до контура ровно 0
  const r = nearest(50, 0, rooms, 12);
  assert.ok(r, "точка на ребре должна привязаться");
  assert.equal(r.id, "a");
});

test("точка ровно на расстоянии tolerance — привязывается (допуск включительный)", () => {
  const rooms = [room("a", rect(0, 0, 100, 100))];
  // (50,-12): проекция на верхнее ребро (50,0), расстояние ровно 12 = tolerance
  const r = nearest(50, -12, rooms, 12);
  assert.ok(r, "расстояние == tolerance входит в допуск");
  assert.equal(r.id, "a");
});

test("точка чуть дальше допуска — null", () => {
  const rooms = [room("a", rect(0, 0, 100, 100))];
  // (50,-13): расстояние 13 > 12 → за пределами допуска
  assert.equal(nearest(50, -13, rooms, 12), null);
});

test("равное расстояние до двух комнат — выбор не зависит от порядка входа", () => {
  const a = room("a", rect(0, 0, 100, 100));
  const b = room("b", rect(120, 0, 220, 100));
  // (110,50): до правого ребра A (x=100) — 10, до левого ребра B (x=120) — 10, поровну
  const forward = nearest(110, 50, [a, b], 12);
  const backward = nearest(110, 50, [b, a], 12);
  assert.ok(forward && backward, "обе раскладки должны что-то вернуть");
  assert.equal(forward.id, backward.id, "результат обязан совпасть при любом порядке");
  // тай-брейк по строковому id: "a" < "b" — детерминированно A в обоих случаях
  assert.equal(forward.id, "a");
});

test("комната без полигона (grid-комната) не роняет функцию и в поиске не участвует", () => {
  const grid = { id: "grid" };                 // polygon отсутствует
  const degenerate = room("deg", [{ x: 0, y: 0 }, { x: 5, y: 0 }]); // < 3 вершин
  const valid = room("a", rect(0, 0, 100, 100));
  // grid-комнаты не должны мешать найти настоящий контур
  const r = nearest(50, 0, [grid, degenerate, valid], 12);
  assert.ok(r, "функция не должна упасть на комнатах без контура");
  assert.equal(r.id, "a");
  // без единого контура — привязываться не к чему
  assert.equal(nearest(50, 0, [grid, degenerate], 12), null);
});

test("из двух комнат в допуске берётся ближайшая, а не первая по списку", () => {
  const far = room("a", rect(0, 0, 100, 100));       // до правого ребра x=100 — 10
  const near = room("b", rect(113, 0, 213, 100));     // до левого ребра x=113 — 3
  // far стоит ПЕРВОЙ и имеет МЕНЬШИЙ id — ловушка и для «взять первую», и для «взять меньший id»
  const r = nearest(110, 50, [far, near], 12);
  assert.ok(r, "обе комнаты в допуске");
  assert.equal(r.id, "b", "ближе именно вторая комната (расстояние 3 против 10)");
});

test("пустой список и null — возвращают null без исключения", () => {
  assert.equal(nearest(10, 10, [], 12), null);
  assert.equal(nearest(10, 10, null, 12), null);
});

/* --- Регресс исходного замера: x=188 из PLAN-дефекта -------------------------
   Привязка считается по ЦЕНТРУ объекта (obj.x+12, obj.y+12). При x=188 центр по
   X = 200 попадает ровно на правую стену комнаты. pointInPolygon такую точку
   считает «снаружи» (без комнаты, два выключателя, 40.52 €), а допуск должен
   вернуть комнату (два переключателя, 51.58 €). Ради этого случая всё и делалось. */
test("регресс x=188: пост центром ровно на стене привязывается к комнате, а не выпадает", () => {
  const poly = rect(100, 100, 200, 300);   // правая стена — x=200
  const cx = 188 + 12, cy = 200 + 12;       // центр объекта: x=200 (на стене), y внутри диапазона
  // сначала фиксируем причину дефекта: полигонная проверка эту точку не видит внутри
  assert.equal(pointInPolygon(cx, cy, poly), false, "точка на границе для pointInPolygon — снаружи");
  // а допуск обязан её вернуть
  const r = nearest(cx, cy, [room("A", poly)], 12);
  assert.ok(r, "пост у проёма (центр на стене) должен привязаться к комнате");
  assert.equal(r.id, "A");
});
