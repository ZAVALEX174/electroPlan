/* Тесты пересчётов вида холста (EPViewport): экран↔мир (round-trip), bounding box,
   «вписать в экран», зум к точке и подбор сетки свободного пространства.
   Главное, что здесь проверяется численно, — «ничего не поехало»: мировая точка,
   отрисованная при любом виде и «кликнутая» обратно, обязана вернуться к себе. */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  worldToScreen, screenToWorld, clampScale, zoomAt, bounds, fitView, spaceGrid
} = require("../js/viewport.js");

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("round-trip экран↔мир возвращает исходную точку при разных видах", () => {
  const views = [
    { panX: 0, panY: 0, scale: 1 },
    { panX: 137, panY: -84, scale: 1.75 },
    { panX: -960, panY: 512, scale: 0.4 },
    { panX: 3.5, panY: 7.25, scale: 2.333 },
  ];
  for (const v of views) {
    for (const p of [{ x: 0, y: 0 }, { x: 512, y: 300 }, { x: -220, y: 1840 }]) {
      const back = screenToWorld(worldToScreen(p, v), v);
      near(back.x, p.x, 1e-7);
      near(back.y, p.y, 1e-7);
    }
  }
});

test("объект приклеен к миру: при смене вида клик по его экранной точке даёт ту же мировую координату", () => {
  const P = { x: 640, y: 410 };              // мировая координата объекта — не меняется
  const v1 = { panX: 0, panY: 0, scale: 1 };
  const v2 = { panX: -300, panY: 220, scale: 2.2 };   // сдвинутый и отмасштабированный вид
  const onScreen1 = worldToScreen(P, v1);
  const onScreen2 = worldToScreen(P, v2);
  // экранные позиции разные (вид изменился)...
  assert.notDeepEqual(onScreen1, onScreen2);
  // ...но клик по той точке экрана, где объект нарисован, возвращает исходный мир
  const world2 = screenToWorld(onScreen2, v2);
  near(world2.x, P.x, 1e-7);
  near(world2.y, P.y, 1e-7);
});

test("bounds: прямоугольник по набору точек, null на пустом", () => {
  assert.equal(bounds([]), null);
  assert.equal(bounds(null), null);
  const b = bounds([{ x: 10, y: 20 }, { x: -5, y: 100 }, { x: 40, y: -8 }]);
  assert.deepEqual(b, { minX: -5, minY: -8, maxX: 40, maxY: 100 });
});

test("zoomAt держит точку экрана на месте (зум к курсору)", () => {
  const v = { panX: 50, panY: 30, scale: 1 };
  const cursor = { x: 400, y: 250 };
  const worldUnder = screenToWorld(cursor, v);
  const nv = zoomAt(v, cursor, 1.5, { min: 0.1, max: 4 });
  near(nv.scale, 1.5);
  // курсор указывает на ту же мировую точку и после зума
  const after = worldToScreen(worldUnder, nv);
  near(after.x, cursor.x, 1e-7);
  near(after.y, cursor.y, 1e-7);
});

test("zoomAt зажимает масштаб в границах", () => {
  const v = { panX: 0, panY: 0, scale: 3.5 };
  const nv = zoomAt(v, { x: 0, y: 0 }, 2, { min: 0.1, max: 4 });
  near(nv.scale, 4);   // 3.5*2=7 → зажато до 4
  assert.equal(clampScale(0.01, 0.1, 4), 0.1);
});

test("fitView: всё содержимое умещается в окне с полями и центрируется", () => {
  const b = { minX: 100, minY: 100, maxX: 900, maxY: 500 };
  const viewW = 1000, viewH = 700, padding = 50;
  const v = fitView(b, viewW, viewH, { padding, minScale: 0.1, maxScale: 4 });
  // проверяем все четыре угла bbox: экранные X в [padding, viewW-padding], Y в [padding, viewH-padding]
  const corners = [
    { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
    { x: b.minX, y: b.maxY }, { x: b.maxX, y: b.maxY },
  ];
  for (const c of corners) {
    const s = worldToScreen(c, v);
    assert.ok(s.x >= padding - 1e-6 && s.x <= viewW - padding + 1e-6, `x ${s.x} в полях`);
    assert.ok(s.y >= padding - 1e-6 && s.y <= viewH - padding + 1e-6, `y ${s.y} в полях`);
  }
  // центр содержимого встал в центр окна
  const center = worldToScreen({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, v);
  near(center.x, viewW / 2, 1e-6);
  near(center.y, viewH / 2, 1e-6);
});

test("fitView: пусто → 100% и начало координат", () => {
  assert.deepEqual(fitView(null, 800, 600, {}), { panX: 0, panY: 0, scale: 1 });
});

test("fitView: масштаб не превышает maxScale на маленьком содержимом", () => {
  const b = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const v = fitView(b, 1000, 800, { padding: 20, minScale: 0.1, maxScale: 4 });
  assert.ok(v.scale <= 4 + 1e-9);
});

test("spaceGrid: сетка накрывает bbox с запасом, origin кратен cell", () => {
  const b = { minX: 133, minY: -47, maxX: 812, maxY: 640 };
  const g = spaceGrid(b, { cell: 10, margin: 40, maxCells: 300000 });
  assert.equal(g.cell, 10);
  // кратность cell (Number.isInteger вместо %, чтобы -90%10 === -0 не ломало strict)
  assert.ok(Number.isInteger(g.originX / g.cell));
  assert.ok(Number.isInteger(g.originY / g.cell));
  // origin не правее (minX-margin), правый/нижний край покрыты
  assert.ok(g.originX <= b.minX - 40);
  assert.ok(g.originY <= b.minY - 40);
  assert.ok(g.originX + g.width >= b.maxX + 40);
  assert.ok(g.originY + g.height >= b.maxY + 40);
});

test("spaceGrid: предохранитель укрупняет cell при превышении maxCells", () => {
  const b = { minX: 0, minY: 0, maxX: 100000, maxY: 100000 };   // 10000×10000 клеток при cell=10
  const g = spaceGrid(b, { cell: 10, margin: 40, maxCells: 300000 });
  const cols = Math.ceil(g.width / g.cell), rows = Math.ceil(g.height / g.cell);
  assert.ok(g.cell > 10, "cell укрупнён");
  assert.ok(cols * rows <= 300000, `клеток ${cols * rows} ≤ предела`);
});

test("spaceGrid: пустой bbox даёт валидную сетку без падения", () => {
  const g = spaceGrid(null, { cell: 10, margin: 40, maxCells: 300000 });
  assert.ok(g.width > 0 && g.height > 0 && g.cell > 0);
});
