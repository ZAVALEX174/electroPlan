/* Автотесты чистой геометрии плана (PLAN 7.1): пересечение отрезков, ближайшая
   точка привязки (магнит), расстояние до отрезка. Запуск без сборщика и браузера:
   node --test tests/  — модуль js/geometry.js не знает про DOM и state. */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  segmentsIntersection, allIntersections, nearestEndpoint, nearestIntersection,
  distancePointToSegment, polygonAreaPx, pointInPolygon, snapPlanPoint
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

/* Выбор точки постановки под режимами «привязка к сетке» и «ортогонально».
   Магниты к линиям в snapPlanPoint не входят — они перебивают её у вызывающего. */
test("snapPlanPoint: привязка вкл — округляет к узлу сетки", () => {
  const p = snapPlanPoint(23, 27, null, { grid: 10, snapGrid: true, ortho: false });
  near(p.x, 20, "23 → 20 при шаге 10");
  near(p.y, 30, "27 → 30 при шаге 10");
});

test("snapPlanPoint: привязка выкл — точка ровно под курсором", () => {
  const p = snapPlanPoint(23.4, 27.9, null, { grid: 10, snapGrid: false, ortho: false });
  near(p.x, 23.4, "x не округлён");
  near(p.y, 27.9, "y не округлён");
});

test("snapPlanPoint: разный шаг сетки даёт разные узлы", () => {
  near(snapPlanPoint(23, 0, null, { grid: 5, snapGrid: true }).x, 25, "шаг 5: 23 → 25");
  near(snapPlanPoint(23, 0, null, { grid: 50, snapGrid: true }).x, 0, "шаг 50: 23 → 0");
});

test("snapPlanPoint: ортогональность подтягивает короткую ось к prev", () => {
  /* сегмент почти горизонтальный (dx>dy) → выравниваем y к prev.y */
  const horiz = snapPlanPoint(100, 8, { x: 0, y: 0 }, { grid: 10, snapGrid: false, ortho: true });
  near(horiz.x, 100, "x остаётся");
  near(horiz.y, 0, "y притянут к prev — строго горизонтально");
  /* сегмент почти вертикальный (dy>dx) → выравниваем x к prev.x */
  const vert = snapPlanPoint(8, 100, { x: 0, y: 0 }, { grid: 10, snapGrid: false, ortho: true });
  near(vert.x, 0, "x притянут к prev — строго вертикально");
  near(vert.y, 100, "y остаётся");
});

test("snapPlanPoint: ортогональность без prev (первая точка) ничего не выравнивает", () => {
  const p = snapPlanPoint(23, 27, null, { grid: 10, snapGrid: true, ortho: true });
  near(p.x, 20, "первая точка — только сетка");
  near(p.y, 30, "первая точка — только сетка");
});

test("snapPlanPoint: сетка и ортогональность вместе — узел, затем выравнивание оси", () => {
  /* prev на узле (10,10); сырой (43,12): сетка → (40,10), почти горизонтально → y=prev.y=10 */
  const p = snapPlanPoint(43, 12, { x: 10, y: 10 }, { grid: 10, snapGrid: true, ortho: true });
  near(p.x, 40, "x на узле сетки");
  near(p.y, 10, "y выровнен к prev, остаётся на узле");
});
