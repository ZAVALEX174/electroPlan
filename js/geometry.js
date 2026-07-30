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

/* ---- Магниты разметки помещений (PLAN 3.1): чистая геометрия привязки.
   Отрезки приходят в виде {a:{x,y}, b:{x,y}} — та же форма, что у стен и линий
   разметки, — чтобы функции годились и для магнита, и для будущего поиска граней
   планарного графа (Этап 3). Радиус привязки задаёт вызывающий (EPConfig), сюда
   он приходит аргументом — модуль не знает про конфиг и остаётся тестируемым. */

/* Точка пересечения двух отрезков или null, если они параллельны/коллинеарны или
   пересекаются вне своих границ. Параметрический метод: t,u ∈ [0;1] — касание
   концами тоже считаем пересечением (концы всё равно ловит nearestEndpoint). */
function segmentsIntersection(p1, p2, p3, p4) {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return null; // параллельны или совпадают по направлению
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

/* Все попарные пересечения набора отрезков (O(n²) — для разметки помещений число
   линий небольшое). Возвращает список точек {x,y}; тот же приём переиспользует
   Этап 3 для разрезания линий перед поиском граней. */
function allIntersections(segments) {
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const p = segmentsIntersection(segments[i].a, segments[i].b, segments[j].a, segments[j].b);
      if (p) out.push(p);
    }
  }
  return out;
}

/* Ближайший конец отрезка к точке в пределах радиуса — {x,y,dist} или null.
   Ловит привязку к уже поставленным вершинам разметки. */
function nearestEndpoint(point, segments, radius) {
  let best = null, bestDist = radius;
  for (const s of segments) {
    for (const end of [s.a, s.b]) {
      const d = Math.hypot(point.x - end.x, point.y - end.y);
      if (d <= bestDist) { bestDist = d; best = { x: end.x, y: end.y, dist: d }; }
    }
  }
  return best;
}

/* Ближайшее пересечение линий к точке в пределах радиуса — {x,y,dist} или null. */
function nearestIntersection(point, segments, radius) {
  let best = null, bestDist = radius;
  for (const p of allIntersections(segments)) {
    const d = Math.hypot(point.x - p.x, point.y - p.y);
    if (d <= bestDist) { bestDist = d; best = { x: p.x, y: p.y, dist: d }; }
  }
  return best;
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
const api = { polygonCentroid, polygonAreaPx, pointInPolygon, distancePointToSegment,
  segmentsIntersection, allIntersections, nearestEndpoint, nearestIntersection,
  buildSpaceComponents, componentAt };
if (typeof window !== "undefined") window.EPGeom = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
