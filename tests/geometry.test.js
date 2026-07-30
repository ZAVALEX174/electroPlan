/* Автотесты чистой геометрии плана (PLAN 7.1): пересечение отрезков, ближайшая
   точка привязки (магнит), расстояние до отрезка. Запуск без сборщика и браузера:
   node --test tests/  — модуль js/geometry.js не знает про DOM и state. */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  segmentsIntersection, allIntersections, nearestEndpoint, nearestIntersection,
  distancePointToSegment, polygonAreaPx, pointInPolygon
} = require("../js/geometry.js");

/* отрезок из двух точек в форме {a,b} — как хранятся стены и линии разметки */
const seg = (ax, ay, bx, by) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
/* сравнение координат: погрешность плавающей точки, а не биты */
const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: получено ${actual}, ожидалось ${expected}`);

test("пересечение крестом даёт центр", () => {
  const p = segmentsIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
  assert.ok(p, "крест пересекается");
  near(p.x, 5, "x центра");
  near(p.y, 5, "y центра");
});

test("параллельные отрезки не пересекаются", () => {
  assert.equal(segmentsIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }), null);
});

test("коллинеарные (на одной прямой) не дают единственной точки", () => {
  assert.equal(segmentsIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 20, y: 0 }), null);
});

test("продолжения пересеклись бы, но за пределами отрезков — null", () => {
  /* линии как прямые пересекаются в (10,10), но обе точки лежат вне [0;1] по параметру */
  assert.equal(segmentsIntersection({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 20 }, { x: 4, y: 16 }), null);
});

test("касание концом (T-стык) считается пересечением", () => {
  const p = segmentsIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 });
  assert.ok(p, "конец второго отрезка лежит на первом");
  near(p.x, 5, "x стыка");
  near(p.y, 0, "y стыка");
});

test("allIntersections перебирает все пары", () => {
  /* три линии: две вертикали пересекают одну горизонталь → две точки */
  const pts = allIntersections([
    seg(0, 5, 20, 5),   // горизонталь
    seg(4, 0, 4, 10),   // вертикаль 1
    seg(12, 0, 12, 10)  // вертикаль 2 (две вертикали параллельны — их пара не даёт точки)
  ]);
  assert.equal(pts.length, 2, "две точки пересечения, параллельные вертикали пропущены");
});

test("nearestEndpoint ловит конец в радиусе и игнорирует далёкий", () => {
  const segs = [seg(0, 0, 100, 0), seg(100, 0, 100, 100)];
  const hit = nearestEndpoint({ x: 103, y: 2 }, segs, 14);
  assert.ok(hit, "конец (100,0) в радиусе 14");
  near(hit.x, 100, "притянулись к концу по x");
  near(hit.y, 0, "притянулись к концу по y");
  assert.equal(nearestEndpoint({ x: 50, y: 40 }, segs, 14), null, "середина далеко от концов — привязки нет");
});

test("nearestEndpoint выбирает ближайший из нескольких концов", () => {
  const segs = [seg(0, 0, 10, 0), seg(0, 0, 0, 10)];
  const hit = nearestEndpoint({ x: 9, y: 1 }, segs, 14);
  near(hit.x, 10, "ближе конец (10,0)");
  near(hit.y, 0, "ближе конец (10,0)");
});

test("nearestIntersection притягивает к точке скрещивания", () => {
  const segs = [seg(0, 0, 20, 20), seg(0, 20, 20, 0)];
  const hit = nearestIntersection({ x: 8, y: 9 }, segs, 14);
  assert.ok(hit, "рядом с центром (10,10) есть пересечение");
  near(hit.x, 10, "x пересечения");
  near(hit.y, 10, "y пересечения");
  assert.equal(nearestIntersection({ x: 0, y: 0 }, segs, 5), null, "далеко от пересечения — привязки нет");
});

test("distancePointToSegment: проекция и зажим в концах", () => {
  near(distancePointToSegment(5, 4, 0, 0, 10, 0), 4, "перпендикуляр к отрезку");
  near(distancePointToSegment(-3, 0, 0, 0, 10, 0), 3, "зажим в начале отрезка");
  near(distancePointToSegment(5, 0, 5, 5, 5, 5), 5, "вырожденный отрезок = расстояние до точки");
});

/* Смежные чистые функции, на которые опирается деление пространства — короткая
   страховка, что базовая геометрия полигонов не деградировала. */
test("polygonAreaPx: площадь квадрата 10×10 = 100", () => {
  near(polygonAreaPx([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), 100, "площадь");
});

test("pointInPolygon: внутри и снаружи квадрата", () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(pointInPolygon(5, 5, sq), true, "центр внутри");
  assert.equal(pointInPolygon(15, 5, sq), false, "точка снаружи");
});
