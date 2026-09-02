/* Автотесты чистой геометрии плана (PLAN 7.1): пересечение отрезков, ближайшая
   точка привязки (магнит), расстояние до отрезка. Запуск без сборщика и браузера:
   node --test tests/  — модуль js/geometry.js не знает про DOM и state. */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  segmentsIntersection, allIntersections, nearestEndpoint, nearestIntersection,
  distancePointToSegment, closestPointOnSegment, nearestSegmentPoint,
  polygonAreaPx, pointInPolygon, snapPlanPoint, roomContourProbe
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

/* Ближайшая точка НА отрезке (привязка к телу линии): проекция внутри, зажим за
   концом, точка ровно на перпендикуляре. */
test("closestPointOnSegment: проекция внутрь отрезка", () => {
  const cp = closestPointOnSegment(5, 4, 0, 0, 10, 0);
  near(cp.x, 5, "x проекции — под точкой");
  near(cp.y, 0, "y проекции — на отрезке");
  near(cp.t, 0.5, "параметр в середине");
  near(cp.dist, 4, "расстояние = высота перпендикуляра");
});

test("closestPointOnSegment: за концом — зажим в конец (t=0)", () => {
  const cp = closestPointOnSegment(-3, 5, 0, 0, 10, 0);
  near(cp.x, 0, "x зажат в начало");
  near(cp.y, 0, "y зажат в начало");
  near(cp.t, 0, "параметр упёрся в 0");
  near(cp.dist, Math.hypot(3, 5), "расстояние до ближнего конца");
});

test("closestPointOnSegment: на перпендикуляре к диагонали", () => {
  /* точка (0,10) над диагональю (0,0)-(10,10): проекция — середина (5,5) */
  const cp = closestPointOnSegment(0, 10, 0, 0, 10, 10);
  near(cp.x, 5, "x проекции на диагональ");
  near(cp.y, 5, "y проекции на диагональ");
  near(cp.dist, Math.hypot(5, 5), "перпендикуляр к диагонали");
});

test("nearestSegmentPoint: ловит тело линии там, где нет ни конца, ни пересечения", () => {
  /* диагональ; курсор в 2px от её тела вдали от концов — привязка к проекции */
  const diag = [seg(0, 0, 100, 100)];
  const hit = nearestSegmentPoint({ x: 51, y: 49 }, diag, 14);
  assert.ok(hit, "тело диагонали в радиусе");
  near(hit.x, 50, "x проекции на тело");
  near(hit.y, 50, "y проекции на тело");
  assert.equal(nearestSegmentPoint({ x: 60, y: 30 }, diag, 14), null, "далеко от тела — привязки нет");
});

/* Приоритет магнитов, как он реализован в roomLineMagnet (app.js): конец → пересечение
   → тело. Проверяем на чистых функциях, что при точке у самого узла ПОБЕЖДАЕТ конец,
   а тело лишь дополняет — иначе пользователь промахивался бы мимо узлов. */
test("приоритет магнитов: конец линии перебивает тело линии", () => {
  const segs = [seg(0, 0, 100, 0), seg(0, 0, 0, 100)];
  const pt = { x: 3, y: 2 };                 // почти в углу (0,0)
  const R = 14;
  const ep = nearestEndpoint(pt, segs, R);
  const bp = nearestSegmentPoint(pt, segs, R);
  assert.ok(ep, "конец (0,0) в радиусе");
  assert.ok(bp, "тело тоже в радиусе");
  /* порядок из roomLineMagnet: сначала конец — он и выбирается */
  const chosen = ep || nearestIntersection(pt, segs, R) || bp;
  near(chosen.x, 0, "выбран узел (0,0), не тело");
  near(chosen.y, 0, "выбран узел (0,0), не тело");
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

/* Дискриминатор шага A: от точки у границы идём до ближайшего места контура и чуть внутрь.
   Важно отличить дверной проём (пути ничего не мешает) от такого же расстояния за глухой стеной. */
const rectWalls = (x1, y1, x2, y2) => [
  seg(x1, y1, x2, y1), seg(x2, y1, x2, y2),
  seg(x2, y2, x1, y2), seg(x1, y2, x1, y1)
];

test("roomContourProbe: точка ровно на любой стороне контура доступна одинаково", () => {
  const poly = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }];
  const walls = rectWalls(100, 100, 200, 200);
  for (const [x, y, side] of [[150, 100, "верх"], [200, 150, "право"], [150, 200, "низ"], [100, 150, "лево"]]) {
    const probe = roomContourProbe(x, y, poly, walls, 2);
    assert.equal(probe.blocked, false, `${side}: стена через саму точку не считается преградой`);
    near(probe.dist, 0, `${side}: расстояние до контура`);
  }
});

test("roomContourProbe: 8 px за глухой стеной — заблокировано", () => {
  const poly = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }];
  const probe = roomContourProbe(208, 150, poly, rectWalls(100, 100, 200, 200), 2);
  assert.equal(probe.blocked, true, "зонд пересекает правую стену x=200");
  near(probe.dist, 8, "расстояние до правого ребра");
});

test("roomContourProbe: те же 8 px напротив дверного проёма — доступны", () => {
  const poly = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }];
  const walls = [
    seg(100, 100, 200, 100), seg(200, 100, 200, 140),
    seg(200, 160, 200, 200), seg(200, 200, 100, 200), seg(100, 200, 100, 100)
  ];
  const probe = roomContourProbe(208, 150, poly, walls, 2);
  assert.equal(probe.blocked, false, "в разрыве стены зонд проходит внутрь");
  near(probe.dist, 8, "расстояние такое же, как в закрытом случае");
});

test("roomContourProbe: Г-образная комната не принимает точку за внутренней глухой стеной", () => {
  const poly = [
    { x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 200 },
    { x: 200, y: 200 }, { x: 200, y: 500 }, { x: 100, y: 500 }
  ];
  /* Точка лежит в вырезе Г справа от внутреннего ребра x=200. Центроид этого полигона находится
     в вырезе, поэтому прежняя проверка через seed давала ложное совпадение; зонд seed не использует. */
  const wall = [seg(200, 200, 200, 500)];
  const forward = roomContourProbe(208, 266, poly, wall, 2);
  const backward = roomContourProbe(208, 266, [...poly].reverse(), wall, 2);
  assert.equal(forward.blocked, true);
  assert.equal(backward.blocked, true, "обратный порядок вершин не меняет сторону комнаты");
  near(forward.dist, 8, "расстояние до внутреннего ребра");
});

test("roomContourProbe: битый вход безопасно отвергается", () => {
  const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  for (const inset of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(roomContourProbe(5, -1, poly, [], inset).blocked, true, `inset=${String(inset)}`);
  }
  assert.equal(roomContourProbe(5, -1, [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 0, y: 2 }], [], 2).blocked, true);
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
