/* Автотесты построения помещений из линий разметки (Этап 3, PLAN 7.1). Модуль
   js/roomsFromLines.js чистый — не знает про DOM и state, геометрию получает
   аргументом (EPGeom). Запуск без сборщика и браузера: npm test. */
const test = require("node:test");
const assert = require("node:assert/strict");
const geom = require("../js/geometry.js");
const R = require("../js/roomsFromLines.js");

/* отрезок в форме {a,b} — как хранятся линии разметки (state.roomLines) */
const seg = (ax, ay, bx, by) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
/* базовые опции основного прохода: реальные значения близки к EPConfig */
const OPT = { geom, tol: 0.75, minArea: 100 };
const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${msg}: получено ${actual}, ожидалось ${expected}`);

test("замкнутый прямоугольник → одно помещение с ожидаемой площадью", () => {
  const r = R.roomsFromLines([seg(0, 0, 100, 0), seg(100, 0, 100, 80), seg(100, 80, 0, 80), seg(0, 80, 0, 0)], OPT);
  assert.equal(r.method, "faces", "контур замкнут — работает основной проход");
  assert.equal(r.rooms.length, 1, "одна грань");
  assert.equal(r.rooms[0].source, "lines", "получено по линиям, а не по сетке");
  near(r.rooms[0].area, 8000, "площадь 100×80");
});

test("прямоугольник с перегородкой → ДВА помещения", () => {
  const r = R.roomsFromLines([
    seg(0, 0, 100, 0), seg(100, 0, 100, 80), seg(100, 80, 0, 80), seg(0, 80, 0, 0),
    seg(50, 0, 50, 80)   // перегородка от верхней стены к нижней (T-стыки)
  ], OPT);
  assert.equal(r.method, "faces");
  assert.equal(r.rooms.length, 2, "перегородка делит на два помещения");
  r.rooms.forEach(rm => near(rm.area, 4000, "каждая половина 50×80"));
});

test("незамкнутый контур → основной проход не даёт граней", () => {
  /* три стороны прямоугольника: контур разомкнут. Без width/height запасной проход
     не запускается — проверяем именно отсутствие граней в основном. */
  const r = R.roomsFromLines([seg(0, 0, 100, 0), seg(100, 0, 100, 80), seg(100, 80, 0, 80)], OPT);
  assert.equal(r.stats.faces, 0, "граней нет");
  assert.equal(r.rooms.length, 0);
  assert.equal(r.method, "none");
});

test("вложенный контур (комната в комнате) → два помещения, одно внутри другого", () => {
  const r = R.roomsFromLines([
    seg(0, 0, 200, 0), seg(200, 0, 200, 200), seg(200, 200, 0, 200), seg(0, 200, 0, 0),   // внешний
    seg(60, 60, 140, 60), seg(140, 60, 140, 140), seg(140, 140, 60, 140), seg(60, 140, 60, 60) // внутренний
  ], OPT);
  assert.equal(r.rooms.length, 2, "две грани: внешняя и вложенная");
  const sorted = r.rooms.slice().sort((a, b) => b.area - a.area);
  const outer = sorted[0].polygon, inner = sorted[1].polygon;
  /* каждая вершина внутреннего контура лежит внутри внешнего */
  inner.forEach(p => assert.ok(geom.pointInPolygon(p.x, p.y, outer), "вершина вложенного контура внутри внешнего"));
});

test("пересекающиеся линии крест-накрест → четыре ячейки", () => {
  const r = R.roomsFromLines([
    seg(0, 0, 100, 0), seg(100, 0, 100, 100), seg(100, 100, 0, 100), seg(0, 100, 0, 0), // квадрат
    seg(0, 50, 100, 50), seg(50, 0, 50, 100)   // крест делит квадрат на 4
  ], OPT);
  assert.equal(r.method, "faces");
  assert.equal(r.rooms.length, 4, "квадрат крестом делится на четыре ячейки");
  r.rooms.forEach(rm => near(rm.area, 2500, "каждая ячейка 50×50"));
});

test("дублирующиеся и коллинеарные отрезки не ломают обход", () => {
  const r = R.roomsFromLines([
    seg(0, 0, 100, 0), seg(0, 0, 100, 0),        // дубль нижней стены
    seg(100, 0, 100, 80), seg(100, 80, 0, 80), seg(0, 80, 0, 0),
    seg(20, 0, 60, 0)                            // коллинеарное наложение на нижнюю стену
  ], OPT);
  assert.equal(r.rooms.length, 1, "дубли и коллинеарность схлопнулись в один контур");
  near(r.rooms[0].area, 8000, "площадь не исказилась");
});

test("вырожденные случаи: пустой ввод, одна линия, две точки", () => {
  assert.equal(R.roomsFromLines([], OPT).method, "empty", "пустой ввод");
  assert.equal(R.roomsFromLines([], OPT).rooms.length, 0);
  const one = R.roomsFromLines([seg(0, 0, 50, 0)], OPT);
  assert.equal(one.rooms.length, 0, "одна линия — граней нет");
  assert.equal(one.stats.faces, 0);
  /* «две точки» — два вырожденных отрезка нулевой длины: не крешат, граней нет */
  const dots = R.roomsFromLines([seg(10, 10, 10, 10), seg(40, 40, 40, 40)], OPT);
  assert.equal(dots.rooms.length, 0, "точки не дают помещений");
});

test("предохранитель: слишком много линий — пересчёт пропускается", () => {
  const many = [];
  for (let i = 0; i < 10; i++) many.push(seg(i, 0, i, 10));
  const r = R.roomsFromLines(many, { geom, tol: 0.75, minArea: 100, maxSegments: 5 });
  assert.equal(r.method, "skipped-limit", "выше предела — не считаем");
  assert.equal(r.rooms.length, 0);
});

/* ---- Запасной проход по сетке. Функция чистая (берёт width/height/segments/geom),
   поэтому тестируется отдельно от основного. ---- */
test("запасной проход: замкнутый прямоугольник стен трассируется в один полигон", () => {
  const walls = [seg(40, 40, 200, 40), seg(200, 40, 200, 160), seg(200, 160, 40, 160), seg(40, 160, 40, 40)];
  const polys = R.fallbackByGrid(walls, geom, { width: 240, height: 200, cell: 10, wallRadius: 7, minArea: 100, simplifyEps: 6 });
  assert.equal(polys.length, 1, "одна внутренняя область");
  assert.ok(polys[0].length >= 4, "полигон замкнут (≥4 вершины)");
  const area = geom.polygonAreaPx(polys[0]);
  assert.ok(area > 8000 && area < 22000, `площадь внутренней области правдоподобна: ${Math.round(area)}`);
});

test("маршрутизация: почти замкнутый контур со щелью уходит в запасной проход", () => {
  /* щель в левой стене (16 px) заклеивается радиусом стены при флуд-фолле:
     основной проход граней не даёт, запасной находит помещение по сетке */
  const gap = [seg(40, 40, 200, 40), seg(200, 40, 200, 160), seg(200, 160, 40, 160),
    seg(40, 160, 40, 108), seg(40, 92, 40, 40)];
  const r = R.roomsFromLines(gap, { geom, tol: 0.75, minArea: 100, width: 240, height: 200, cell: 10, wallRadius: 7, simplifyEps: 6 });
  assert.equal(r.method, "grid", "разомкнутый контур обслужил запасной проход");
  assert.ok(r.rooms.length >= 1, "помещение по сетке найдено");
  assert.equal(r.rooms[0].source, "grid", "помечено как полученное по сетке, а не по линиям");
});

test("маршрутизация: разомкнутый и не заклеенный контур с размерами → ничего", () => {
  /* две стены буквой «Г»: даже флуд-фолл не образует замкнутой области */
  const r = R.roomsFromLines([seg(0, 0, 100, 0), seg(100, 0, 100, 80)],
    { geom, tol: 0.75, minArea: 100, width: 400, height: 300, cell: 10, wallRadius: 7 });
  assert.equal(r.method, "none", "ни грани, ни области по сетке");
  assert.equal(r.rooms.length, 0);
});

/* ---- Аварийная починка зазоров: недоведённый конец подтягивается на тело линии. ---- */

/* healEndpointGaps как чистая функция: конец в 2px от тела горизонтали садится на неё,
   конец в 20px — нет; счётчик и неизменность входа. */
test("healEndpointGaps: конец в пределах допуска садится на тело, дальше — нет", () => {
  const horiz = seg(0, 10, 100, 10);
  const near2 = seg(50, 30, 50, 12);   // верх (50,12) в 2px над телом горизонтали
  const h = R.healEndpointGaps([horiz, near2], geom, 3);
  assert.equal(h.healed, 1, "зашит ровно один стык");
  const movedTop = h.segments[1].b;
  near(movedTop.x, 50, "x конца остался");
  near(movedTop.y, 10, "конец подтянут ровно на тело (y=10)");
  assert.equal(near2.b.y, 12, "вход НЕ мутирован — исходный конец на месте");

  const far = seg(50, 30, 50, 40);     // верх (50,40) в 30px от горизонтали
  const h2 = R.healEndpointGaps([horiz, far], geom, 3);
  assert.equal(h2.healed, 0, "зазор больше допуска не чинится");
});

test("healEndpointGaps: конец у КОНЦА соседа (не тело) не чинится", () => {
  /* конец (52,0) в 2px от конца (50,0), но проекция попадает на t≈1 — это стык
     конец-в-конец, а не привязка к телу; его лечит склейка узлов, не эта функция */
  const h = R.healEndpointGaps([seg(0, 0, 50, 0), seg(52, 0, 52, 40)], geom, 3);
  assert.equal(h.healed, 0, "к концу соседа не подтягиваем — только к телу");
});

/* Случай владельца: прямоугольные стены, диагональ и вертикаль, НЕ доведённая до
   диагонали. Диагональ (0,120)-(200,40) на x=100 проходит через y=80. */
const ownerCase = (verticalTop) => [
  seg(0, 0, 200, 0),        // низ
  seg(200, 0, 200, 40),     // право
  seg(0, 120, 200, 40),     // диагональ (наклонный потолок)
  seg(100, 0, 100, verticalTop) // вертикаль от низа вверх к диагонали
];

test("починка: вертикаль с зазором 2px до диагонали — помещение определяется", () => {
  const r = R.roomsFromLines(ownerCase(78), { geom, tol: 0.75, minArea: 100, healTol: 3 });
  assert.equal(r.method, "faces", "стык зашит — основной проход нашёл грань");
  assert.equal(r.rooms.length, 1, "появилось одно помещение");
  assert.equal(r.healedJoints, 1, "зашит один стык");
  assert.equal(r.stats.healedJoints, 1, "счётчик продублирован в stats");
});

test("починка выключена (healTol нет) — тот же зазор помещения НЕ даёт", () => {
  const r = R.roomsFromLines(ownerCase(78), { geom, tol: 0.75, minArea: 100 });
  assert.equal(r.rooms.length, 0, "без починки контур остаётся разомкнутым");
  assert.equal(r.healedJoints, 0, "ничего не зашивали");
});

test("починка: зазор 20px больше допуска — помещение не появляется", () => {
  const r = R.roomsFromLines(ownerCase(60), { geom, tol: 0.75, minArea: 100, healTol: 3 });
  assert.equal(r.rooms.length, 0, "слишком большой зазор не склеиваем");
  assert.equal(r.healedJoints, 0, "стык не зашит");
  assert.equal(r.method, "none");
});
