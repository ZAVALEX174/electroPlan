/* Геометрия плана — чистые вычисления над полигонами и сеткой свободного
   пространства (PLAN 2.1). Ни state, ни DOM, ни EP_DATA: точки и стены приходят
   аргументами, наружу — числа и простые объекты. Это разблокирует автотесты
   геометрии комнат (PLAN 7.1), как estimate.js разблокировал тесты сметы.

   Интерфейс приложению — window.EPGeom. */
(() => {
"use strict";

/* Центроид (среднее вершин) — им позиционируется подпись комнаты. */
function polygonCentroid(poly) {
  let x = 0, y = 0;
  poly.forEach(p => { x += p.x; y += p.y; });
  return { x: x / poly.length, y: y / poly.length };
}

/* Площадь замкнутого полигона в px² (формула шнурков). */
function polygonAreaPx(poly) {
  if (!poly || poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(sum) / 2;
}

/* Точка внутри полигона (луч по горизонтали, чётность пересечений). */
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* Расстояние от точки до отрезка (проекция с зажимом в [0;1]). */
function distancePointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* Карта связных «свободных» областей плана: холст режется на ячейки cell px,
   ячейка ближе wallRadius px к любой стене помечается заблокированной, остальное
   разбивается флуд-фолл'ом (BFS) на компоненты. Комнаты без ручного контура потом
   привязываются к объектам через общий id компонента. Размеры и стены —
   аргументами, чтобы функция не зависела от DOM (magic-числа cell/wallRadius — PLAN 2.3). */
function buildSpaceComponents(width, height, walls, cell = 10, wallRadius = 7) {
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const blocked = new Uint8Array(cols * rows);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = gx * cell + cell / 2, cy = gy * cell + cell / 2;
      for (const w of walls) {
        if (distancePointToSegment(cx, cy, w.a.x, w.a.y, w.b.x, w.b.y) <= wallRadius) {
          blocked[gy * cols + gx] = 1; break;
        }
      }
    }
  }

  const component = new Int32Array(cols * rows); component.fill(-1);
  let nextId = 0;
  const qx = new Int32Array(cols * rows), qy = new Int32Array(cols * rows);
  for (let sy = 0; sy < rows; sy++) {
    for (let sx = 0; sx < cols; sx++) {
      const start = sy * cols + sx;
      if (blocked[start] || component[start] !== -1) continue;
      let head = 0, tail = 0; qx[tail] = sx; qy[tail++] = sy; component[start] = nextId;
      while (head < tail) {
        const x = qx[head], y = qy[head++];
        const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const idx = ny * cols + nx;
          if (blocked[idx] || component[idx] !== -1) continue;
          component[idx] = nextId; qx[tail] = nx; qy[tail++] = ny;
        }
      }
      nextId++;
    }
  }
  return { cell, cols, rows, blocked, component };
}

/* id компонента в точке; если точка попала на стену — ищем ближайшую свободную
   ячейку в радиусе 3 клеток, иначе -1. */
function componentAt(map, x, y) {
  const gx = Math.max(0, Math.min(map.cols - 1, Math.floor(x / map.cell)));
  const gy = Math.max(0, Math.min(map.rows - 1, Math.floor(y / map.cell)));
  const idx = gy * map.cols + gx;
  if (!map.blocked[idx]) return map.component[idx];

  for (let radius = 1; radius <= 3; radius++) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        const nx = gx + ox, ny = gy + oy;
        if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
        const nidx = ny * map.cols + nx;
        if (!map.blocked[nidx]) return map.component[nidx];
      }
    }
  }
  return -1;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { polygonCentroid, polygonAreaPx, pointInPolygon, distancePointToSegment, buildSpaceComponents, componentAt };
if (typeof window !== "undefined") window.EPGeom = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
