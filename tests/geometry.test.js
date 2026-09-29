/* Автотесты чистой геометрии плана (PLAN 7.1): пересечение отрезков, ближайшая
   точка привязки (магнит), расстояние до отрезка. Запуск без сборщика и браузера:
   node --test tests/  — модуль js/geometry.js не знает про DOM и state. */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  segmentsIntersection, allIntersections, nearestEndpoint, nearestIntersection,
  distancePointToSegment, closestPointOnSegment, nearestSegmentPoint,
  polygonAreaPx, pointInPolygon, snapPlanPoint, roomContourProbe,
  polygonCentroid, poleOfInaccessibility, roomLabelPoint, roomNamePoint, roomMatchPoint
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

/* ---- Точка подписи комнаты (В10): выпуклая = прежний центроид, вогнутая = внутрь контура ---- */

const RECT = [{ x: 10, y: 20 }, { x: 210, y: 20 }, { x: 210, y: 120 }, { x: 10, y: 120 }];
/* Г-образный коридор вокруг кухни (из задачи): среднее вершин лежит в кухне, а не в коридоре. */
const GAMMA = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 300 }, { x: 0, y: 300 }];
const KITCHEN = [{ x: 40, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 300 }, { x: 40, y: 300 }];
/* П-образная комната (открыта вверх) с соседом-вырезом в проёме. */
const U_ROOM = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 180, y: 120 }, { x: 180, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }];
const U_NOTCH = [{ x: 120, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 120 }, { x: 120, y: 120 }];

/* Видимый центр таблички ровно так, как его считает сам app.js (строки 1032/1401/1450/4864):
   центр = room.x+55, room.y+18. Якорь кладут в (точка.x−45, точка.y−16), значит видимый центр =
   точка + (55−45, 18−16) = точка + (10, 2). По этой точке пользователь и кликает «поставить пост». */
const visibleCenter = p => ({ x: p.x - 45 + 55, y: p.y - 16 + 18 });

test("roomLabelPoint: у выпуклой (прямоугольной) комнаты — ровно прежний центроид (сдвига нет)", () => {
  const c = polygonCentroid(RECT), p = roomLabelPoint(RECT);
  near(p.x, c.x, "выпуклая: X якоря = центроид");
  near(p.y, c.y, "выпуклая: Y якоря = центроид");
  assert.ok(Math.abs(p.x - c.x) <= 1 && Math.abs(p.y - c.y) <= 1, "в пределах 1 px от прежней точки");
});

test("roomLabelPoint: Г-коридор — видимая табличка внутри своей комнаты, не в соседней кухне", () => {
  const c = polygonCentroid(GAMMA);
  assert.equal(pointInPolygon(c.x, c.y, GAMMA), false, "среднее вершин Г-комнаты — ВНЕ коридора");
  assert.equal(pointInPolygon(c.x, c.y, KITCHEN), true, "и лежит в соседней кухне (мотив дефекта В10)");
  const v = visibleCenter(roomLabelPoint(GAMMA));
  assert.equal(pointInPolygon(v.x, v.y, GAMMA), true, "видимый центр таблички — в коридоре");
  assert.equal(pointInPolygon(v.x, v.y, KITCHEN), false, "и НЕ в кухне (клик не поставит пост в чужую комнату)");
});

test("roomLabelPoint: П-образная комната — видимая табличка внутри своей, не в вырезе-соседе", () => {
  const c = polygonCentroid(U_ROOM);
  assert.equal(pointInPolygon(c.x, c.y, U_ROOM), false, "среднее вершин П-комнаты — ВНЕ контура (в проёме)");
  const v = visibleCenter(roomLabelPoint(U_ROOM));
  assert.equal(pointInPolygon(v.x, v.y, U_ROOM), true, "видимый центр таблички — внутри П-комнаты");
  assert.equal(pointInPolygon(v.x, v.y, U_NOTCH), false, "и НЕ в соседней комнате-вырезе");
});

test("poleOfInaccessibility: точка лежит внутри Г-контура (гарантия «внутри»)", () => {
  const p = poleOfInaccessibility(GAMMA);
  assert.equal(pointInPolygon(p.x, p.y, GAMMA), true, "полюс недоступности — внутри контура");
});

test("roomLabelPoint: вырожденный контур (<3 вершин) не падает — отдаёт среднее", () => {
  const p = roomLabelPoint([{ x: 4, y: 6 }, { x: 8, y: 10 }]);
  near(p.x, 6, "среднее X двух точек");
  near(p.y, 8, "среднее Y двух точек");
});

/* Критерий по ОБЕИМ точкам: вогнутая комната, где центроид внутри, но видимый центр
   (центроид+(10,2)) попадает в вырез/соседа — тоже переставляется. Полигон:
   прямоугольник 200×100 с прямоугольным вырезом справа x[140,200] y[40,80]. */
const NOTCH_POLY = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 40 }, { x: 140, y: 40 }, { x: 140, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
const NOTCH_NEIGHBOR = [{ x: 140, y: 40 }, { x: 200, y: 40 }, { x: 200, y: 80 }, { x: 140, y: 80 }];
test("roomLabelPoint: центроид ВНУТРИ, но видимый центр в соседе — комната переставляется на полюс", () => {
  const c = polygonCentroid(NOTCH_POLY);
  assert.equal(pointInPolygon(c.x, c.y, NOTCH_POLY), true, "центроид сам по себе ВНУТРИ (прежний критерий сказал бы «оставить»)");
  const oldVis = { x: c.x + 10, y: c.y + 2 }; // ДО: якорь=центроид, видимый центр = c+(10,2)
  assert.equal(pointInPolygon(oldVis.x, oldVis.y, NOTCH_POLY), false, "но видимый центр при прежнем якоре — ВНЕ контура (дефект)");
  assert.equal(pointInPolygon(oldVis.x, oldVis.y, NOTCH_NEIGHBOR), true, "и попадал в соседнюю комнату-вырез");
  const v = visibleCenter(roomLabelPoint(NOTCH_POLY));
  assert.equal(pointInPolygon(v.x, v.y, NOTCH_POLY), true, "после: видимый центр таблички — внутри своей комнаты");
  assert.equal(pointInPolygon(v.x, v.y, NOTCH_NEIGHBOR), false, "и не в соседе");
});

test("roomNamePoint: у переставленной комнаты имя в документе = САМ полюс (внутри), не якорь таблички", () => {
  const nm = roomNamePoint(NOTCH_POLY);
  assert.equal(pointInPolygon(nm.x, nm.y, NOTCH_POLY), true, "точка имени — внутри контура");
  const anchor = roomLabelPoint(NOTCH_POLY);
  near(nm.x, anchor.x + 10, "имя = якорь+(10,2): якорь сдвинут на −(10,2) от полюса");
  near(nm.y, anchor.y + 2, "имя по Y = полюс");
});

test("roomNamePoint: у «прежней» (широкой) комнаты имя = центроид (бит-в-бит, как было)", () => {
  const c = polygonCentroid(RECT), nm = roomNamePoint(RECT);
  near(nm.x, c.x, "широкая комната: имя в документе = центроид");
  near(nm.y, c.y, "и по Y");
});

test("узкий коридор 30 px: имя в документе (полюс) внутри, и оно НЕ равно якорю экранной таблички", () => {
  const GAMMA30 = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 300 }, { x: 0, y: 300 }];
  const nm = roomNamePoint(GAMMA30);
  assert.equal(pointInPolygon(nm.x, nm.y, GAMMA30), true, "имя (полюс) — внутри 30-px коридора (И1)");
  const a = roomLabelPoint(GAMMA30);
  /* Имя в документе = полюс, а якорь экранной таблички сдвинут на −(10,2): документ центрирует имя
     translate(−50%) прямо по точке, экранного смещения −45/−16 у него нет. Мутация roomNamePoint=якорь
     краснит здесь. Видимый же центр таблички (якорь+(10,2)) обязан вернуться ровно на полюс. */
  near(nm.x, a.x + 10, "имя = якорь+(10,2) по X");
  near(nm.y, a.y + 2, "имя = якорь+(10,2) по Y");
  assert.equal(pointInPolygon(a.x + 10, a.y + 2, GAMMA30), true, "видимый центр таблички (якорь+(10,2)=полюс) — внутри коридора (И2)");
});

test("узкий выпуклый прямоугольник: держит прежнюю точку при W>20 и H>4, иначе переставляется", () => {
  const rectOf = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const keeps = (w, h) => { const c = polygonCentroid(rectOf(w, h)), p = roomLabelPoint(rectOf(w, h)); return p.x === c.x && p.y === c.y; };
  /* keep ровно когда центроид (w/2,h/2) и видимый центр (w/2+10,h/2+2) оба внутри прямоугольника,
     т.е. w/2+10<w и h/2+2<h → W>20 и H>4. */
  assert.equal(keeps(42, 22), true, "42×22 — обычная комната, точка прежняя (центроид)");
  assert.equal(keeps(22, 6), true, "22×6 — ещё держит прежнюю (видимый центр (21,5) внутри)");
  assert.equal(keeps(20, 6), false, "20×6 — видимый центр (20,5) на правой границе, переставляется на полюс");
  assert.equal(keeps(30, 4), false, "30×4 — видимый центр (25,4) на нижней границе, переставляется");
});

/* Перебор Г- и П-форм по всем 4 ориентациям выреза (мотив ep-adversary: 300×300 с угловым вырезом).
   Для КАЖДОЙ формы держим ОБА инварианта сразу: И1 — точка имени в документе (roomNamePoint) внутри
   своего контура и не в вырезе-соседе; И2 — видимый центр таблички (якорь по roomLabelPoint + (10,2),
   т.е. реальная формула app.js room.x+55/room.y+18) тоже внутри и не в вырезе. Так ловится и прежний
   дефект «центроид в соседней комнате при попадании c+смещение внутрь». */
const inRect = (x, y, x1, y1, x2, y2) => x > x1 && x < x2 && y > y1 && y < y2;
function assertLabelInside(poly, notch, tag) {
  const nm = roomNamePoint(poly), a = roomLabelPoint(poly), v = { x: a.x + 10, y: a.y + 2 };
  assert.equal(pointInPolygon(nm.x, nm.y, poly), true, tag + ": имя внутри контура (И1)");
  assert.equal(inRect(nm.x, nm.y, ...notch), false, tag + ": имя не в вырезе-соседе (И1)");
  assert.equal(pointInPolygon(v.x, v.y, poly), true, tag + ": видимый центр таблички внутри контура (И2)");
  assert.equal(inRect(v.x, v.y, ...notch), false, tag + ": видимый центр не в вырезе-соседе (И2)");
}
test("перебор Г-форм (4 ориентации выреза): имя и видимый центр всегда внутри своей комнаты", () => {
  let n = 0;
  for (let s = 20; s <= 280; s += 10) {
    assertLabelInside([{ x: s, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }, { x: 0, y: s }, { x: s, y: s }], [0, 0, s, s], "Г-верх-лево s=" + s);
    assertLabelInside([{ x: 0, y: 0 }, { x: 300 - s, y: 0 }, { x: 300 - s, y: s }, { x: 300, y: s }, { x: 300, y: 300 }, { x: 0, y: 300 }], [300 - s, 0, 300, s], "Г-верх-право s=" + s);
    assertLabelInside([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 - s }, { x: 300 - s, y: 300 - s }, { x: 300 - s, y: 300 }, { x: 0, y: 300 }], [300 - s, 300 - s, 300, 300], "Г-низ-право s=" + s);
    assertLabelInside([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: s, y: 300 }, { x: s, y: 300 - s }, { x: 0, y: 300 - s }], [0, 300 - s, s, 300], "Г-низ-лево s=" + s);
    n += 4;
  }
  assert.ok(n === 108, "перебрано 108 Г-форм (27 глубин × 4 ориентации)");
});
test("перебор П-форм (4 ориентации выреза): имя и видимый центр всегда внутри своей комнаты", () => {
  let n = 0;
  for (let s = 20; s <= 280; s += 10) {
    assertLabelInside([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: s }, { x: 200, y: s }, { x: 200, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }], [100, 0, 200, s], "П-верх s=" + s);
    assertLabelInside([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 200, y: 300 }, { x: 200, y: 300 - s }, { x: 100, y: 300 - s }, { x: 100, y: 300 }, { x: 0, y: 300 }], [100, 300 - s, 200, 300], "П-низ s=" + s);
    assertLabelInside([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }, { x: 0, y: 200 }, { x: s, y: 200 }, { x: s, y: 100 }, { x: 0, y: 100 }], [0, 100, s, 200], "П-лево s=" + s);
    assertLabelInside([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }, { x: 300 - s, y: 100 }, { x: 300 - s, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }, { x: 0, y: 300 }], [300 - s, 100, 300, 200], "П-право s=" + s);
    n += 4;
  }
  assert.ok(n === 108, "перебрано 108 П-форм (27 глубин × 4 ориентации)");
});
test("контрпример ep-adversary: центроид в соседней комнате, но имя и табличка — внутри своей", () => {
  const ADV = [{ x: 170, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }, { x: 0, y: 170 }, { x: 170, y: 170 }];
  const c = polygonCentroid(ADV);
  assert.equal(pointInPolygon(c.x, c.y, ADV), false, "центроид (156.7,156.7) — ВНЕ Г-комнаты (в вырезе)");
  const nm = roomNamePoint(ADV);
  assert.equal(pointInPolygon(nm.x, nm.y, ADV), true, "имя в документе теперь внутри своей комнаты");
  assert.equal(inRect(nm.x, nm.y, 0, 0, 170, 170), false, "и не в комнате-вырезе [0,0]-[170,170]");
});

/* И4: нечисловая вершина не вешает программу — функция завершается (таймаут теста) и возвращает
   среднее вершин, а не полюс. Плюс замер на вырожденно-плоском контуре 1000×0.001. */
test("нечисловая вершина (NaN/Infinity/undefined/строка): функция завершается, отдаёт центроид", { timeout: 3000 }, () => {
  for (const bad of [NaN, Infinity, undefined, "x"]) {
    const poly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: bad, y: 100 }, { x: 0, y: 100 }];
    const nm = roomNamePoint(poly), c = polygonCentroid(poly);
    // roomNamePoint при битой вершине = центроид (может быть NaN по X, но НЕ виснет)
    assert.equal(Number.isNaN(nm.x) ? Number.isNaN(c.x) : nm.x === c.x, true, "X имени = X центроида");
    assert.equal(nm.y, c.y, "Y имени = Y центроида (по нему вершины числовые)");
  }
});
test("вырожденно-плоский контур 1000×0.001: poleOfInaccessibility завершается быстро", { timeout: 3000 }, () => {
  const flat = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 0.001 }, { x: 0, y: 0.001 }];
  const t = Date.now();
  const p = poleOfInaccessibility(flat);
  assert.ok(Date.now() - t < 1000, "уложился в лимит (жёсткий кап числа ячеек)");
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), "точка числовая");
});

/* ---- Точка СОПОСТАВЛЕНИЯ комнаты при пересборке (В13, EPGeom.roomMatchPoint) ------------------
   Отдельная от точки подписи: гарантирована ВНУТРИ контура и НЕ завязана на смещение таблички.
   На ней держится перенос полей Г/П-комнат (EPRoomCarry.carry). */

test("roomMatchPoint И1: у прямоугольника (в т.ч. с T-вершинами) точка = центроид бит-в-бит, внутри", () => {
  const c = polygonCentroid(RECT), m = roomMatchPoint(RECT);
  assert.equal(m.x, c.x, "выпуклая: X точки сопоставления = центроид");
  assert.equal(m.y, c.y, "выпуклая: Y точки сопоставления = центроид");
  assert.equal(pointInPolygon(m.x, m.y, RECT), true, "точка внутри контура");
  /* Прямоугольник с лишними коллинеарными (T-) вершинами: центроид не тот же, что у чистого,
     но всё равно ВНУТРИ, поэтому точка сопоставления = именно он, бит-в-бит (мутация «всегда полюс»
     краснит здесь). */
  const RECT_T = [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 210, y: 20 }, { x: 210, y: 70 },
    { x: 210, y: 120 }, { x: 110, y: 120 }, { x: 10, y: 120 }, { x: 10, y: 70 }];
  const cT = polygonCentroid(RECT_T), mT = roomMatchPoint(RECT_T);
  assert.equal(pointInPolygon(cT.x, cT.y, RECT_T), true, "центроид прямоугольника с T-вершинами внутри");
  assert.equal(mT.x, cT.x, "T-вершины: точка = центроид бит-в-бит (X)");
  assert.equal(mT.y, cT.y, "T-вершины: точка = центроид бит-в-бит (Y)");
});

test("roomMatchPoint И1: узкая/мелкая комната с центроидом внутри — точка = центроид бит-в-бит", () => {
  const NARROW = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 6 }, { x: 0, y: 6 }]; // 400×6
  const TINY = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }];         // 3×3
  for (const poly of [NARROW, TINY]) {
    const c = polygonCentroid(poly), m = roomMatchPoint(poly);
    assert.equal(pointInPolygon(c.x, c.y, poly), true, "центроид внутри");
    assert.equal(m.x, c.x, "точка = центроид (X)");
    assert.equal(m.y, c.y, "точка = центроид (Y)");
  }
});

test("roomMatchPoint И2: у Г/П центроид СНАРУЖИ, а точка сопоставления строго ВНУТРИ", () => {
  for (const [poly, tag] of [[GAMMA, "Г"], [U_ROOM, "П"]]) {
    const c = polygonCentroid(poly), m = roomMatchPoint(poly);
    assert.equal(pointInPolygon(c.x, c.y, poly), false, tag + ": среднее вершин вне контура");
    assert.equal(pointInPolygon(m.x, m.y, poly), true, tag + ": точка сопоставления внутри контура");
    assert.ok(m.x !== c.x || m.y !== c.y, tag + ": точка сдвинута с центроида на полюс");
  }
});

test("roomMatchPoint И2: сдвиг начальной вершины и разворот обхода не меняют точку (Г/П на сетке)", () => {
  const rot = (p, k) => p.slice(k).concat(p.slice(0, k));
  for (const [poly, tag] of [[GAMMA, "Г"], [U_ROOM, "П"]]) {
    const base = roomMatchPoint(poly);
    for (let k = 1; k < poly.length; k++) {
      const r = roomMatchPoint(rot(poly, k));
      assert.equal(r.x, base.x, tag + ": сдвиг начала на " + k + " не меняет X");
      assert.equal(r.y, base.y, tag + ": сдвиг начала на " + k + " не меняет Y");
    }
    const rev = roomMatchPoint([...poly].reverse());
    assert.equal(rev.x, base.x, tag + ": разворот обхода не меняет X");
    assert.equal(rev.y, base.y, tag + ": разворот обхода не меняет Y");
  }
});

test("roomMatchPoint И3: точка НЕ зависит от смещения таблички (в отличие от roomNamePoint)", () => {
  /* NOTCH_POLY: центроид ВНУТРИ, но центроид+(10,2) в вырезе-соседе. Точка подписи (roomNamePoint)
     из-за смещения таблички уезжает на полюс; точка сопоставления смотрит ТОЛЬКО на центроид —
     значит остаётся на нём. Так доказано, что roomMatchPoint не завязан на LABEL_ANCHOR_* и CSS. */
  const c = polygonCentroid(NOTCH_POLY), m = roomMatchPoint(NOTCH_POLY), nm = roomNamePoint(NOTCH_POLY);
  assert.equal(pointInPolygon(c.x, c.y, NOTCH_POLY), true, "центроид сам по себе внутри");
  assert.equal(m.x, c.x, "точка сопоставления = центроид (смещение таблички не учтено), X");
  assert.equal(m.y, c.y, "точка сопоставления = центроид, Y");
  assert.ok(nm.x !== c.x || nm.y !== c.y, "а точка ИМЕНИ из-за смещения таблички ушла на полюс — правила разные");
});

test("roomMatchPoint И4: вырожденный/битый вход не роняет и не виснет", { timeout: 3000 }, () => {
  const avg2 = roomMatchPoint([{ x: 4, y: 6 }, { x: 8, y: 10 }]);
  near(avg2.x, 6, "<3 вершин — среднее X");
  near(avg2.y, 8, "<3 вершин — среднее Y");
  assert.doesNotThrow(() => roomMatchPoint([]), "пустой контур не роняет");
  assert.doesNotThrow(() => roomMatchPoint(null), "null не роняет");
  for (const bad of [NaN, Infinity, undefined, "x"]) {
    const poly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: bad, y: 100 }, { x: 0, y: 100 }];
    const m = roomMatchPoint(poly), c = polygonCentroid(poly);
    /* нечисловая вершина: возвращаем центроид как есть (может быть NaN по X), но НЕ виснем на полюсе */
    assert.equal(Number.isNaN(m.x) ? Number.isNaN(c.x) : m.x === c.x, true, "битая вершина → X центроида");
    assert.equal(m.y, c.y, "битая вершина → Y центроида");
  }
});
