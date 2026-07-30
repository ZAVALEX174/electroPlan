/* Построение помещений из линий разметки (Этап 3, PLAN 3.1/5.7). Чистый модуль:
   ни state, ни DOM, ни EP_DATA — линии приходят аргументом в форме {a:{x,y},b:{x,y}}
   (та же форма, что state.roomLines и стены), все зависимости (геометрия, конфиг) —
   через opts. Это разблокирует автотесты (PLAN 7.1), как geometry.js/estimate.js.

   Донор (docs/донор-отрисовка-схем.md §5) даёт только предобработку — разрез линий
   в пересечениях и склейку узлов по ключу координаты. Поиска граней у него НЕТ,
   его граф одномерный (пути воздуха). Поэтому основной проход — планарные грани —
   написан здесь с нуля.

   Два прохода:
     • основной  — грани планарного графа (точные контуры ровно по линиям);
     • запасной  — по сетке через EPGeom.buildSpaceComponents (если контур не замкнут).
   Каждый полигон помечается source: 'lines' | 'grid' — запасной проход НЕ подменяет
   основной молча, вызывающий видит, чем получен результат.

   Интерфейс приложению — window.EPRoomsFromLines. */
(() => {
"use strict";

/* Ключ узла для склейки: квантование координат к сетке допуска tol. После магнитов
   разметки координаты почти целые, но точное сравнение float опасно (после разреза
   в пересечении получаются дробные значения) — близкие точки сводим в один узел. */
function nodeKey(x, y, tol) {
  return Math.round(x / tol) + ":" + Math.round(y / tol);
}

/* Знаковая площадь (шнурки) в ТОМ ЖЕ порядке членов, что EPGeom.polygonAreaPx, но
   без модуля: знак несёт ориентацию обхода. При принятом ниже правиле обхода граней
   (см. findFaces) внутренние грани получают положительную площадь, внешняя каждой
   компоненты — отрицательную. Это и есть критерий отсечения внешней грани. */
function signedArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return s / 2;
}

/* Разрез всех отрезков в точках взаимных пересечений и в точках, где чужой узел
   лежит на теле отрезка. Возвращает список под-отрезков — вход для планарного графа.

   Почему две «сущности» точек: geom.segmentsIntersection ловит настоящие скрещивания
   и T-стыки (конец одной линии на теле другой — u∈[0;1] включает концы), но НЕ ловит
   коллинеарные наложения (denom=0 → null). Поэтому дополнительно проверяем, лежит ли
   любой значимый узел (конец любого отрезка или точка пересечения) на теле данного
   отрезка, и режем по нему. Так дубли и частично совпадающие коллинеарные линии не
   ломают обход: общий кусок после дедупа рёбер становится одним ребром. */
function splitAtIntersections(segments, geom, tol) {
  const pts = [];
  for (const s of segments) { pts.push(s.a, s.b); }
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const p = geom.segmentsIntersection(segments[i].a, segments[i].b, segments[j].a, segments[j].b);
      if (p) pts.push(p);
    }

  const out = [];
  for (const s of segments) {
    const ax = s.a.x, ay = s.a.y, bx = s.b.x, by = s.b.y;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue; // вырожденный отрезок-точка не даёт ребра
    /* параметры t точек, попадающих на этот отрезок (0 и 1 — сами концы) */
    const ts = [0, 1];
    for (const p of pts) {
      const t = ((p.x - ax) * dx + (p.y - ay) * dy) / len2;
      if (t <= 0 || t >= 1) continue;               // концы уже учтены
      const px = ax + t * dx, py = ay + t * dy;
      if (Math.hypot(p.x - px, p.y - py) <= tol) ts.push(t); // точка реально на отрезке
    }
    ts.sort((m, n) => m - n);
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-9) continue;                 // совпавшие точки разреза
      out.push({ a: { x: ax + t0 * dx, y: ay + t0 * dy }, b: { x: ax + t1 * dx, y: ay + t1 * dy } });
    }
  }
  return out;
}

/* Планарный граф из под-отрезков: склейка узлов по ключу координаты, дедуп рёбер по
   паре узлов (гасит дубли и коллинеарные наложения), список смежности с углами рёбер
   (углы нужны обходу граней). Возвращает { nodes:[{x,y}], adj:[[{to,angle}]] }. */
function buildPlanarGraph(subSegments, tol) {
  const nodes = [];
  const keyToId = new Map();
  function getNode(p) {
    const k = nodeKey(p.x, p.y, tol);
    let id = keyToId.get(k);
    if (id === undefined) { id = nodes.length; nodes.push({ x: p.x, y: p.y }); keyToId.set(k, id); }
    return id;
  }
  const adj = [];
  const ensure = id => { while (adj.length <= id) adj.push([]); };
  const edgeSet = new Set();
  for (const s of subSegments) {
    const u = getNode(s.a), v = getNode(s.b);
    if (u === v) continue;                          // самопетля после склейки — не ребро
    const ek = u < v ? u + "-" + v : v + "-" + u;
    if (edgeSet.has(ek)) continue;                  // повтор ребра (дубль/наложение)
    edgeSet.add(ek);
    ensure(u); ensure(v);
    adj[u].push({ to: v, angle: Math.atan2(nodes[v].y - nodes[u].y, nodes[v].x - nodes[u].x) });
    adj[v].push({ to: u, angle: Math.atan2(nodes[u].y - nodes[v].y, nodes[u].x - nodes[v].x) });
  }
  ensure(nodes.length - 1);
  /* полурёбра вокруг узла упорядочиваем по углу — на этом порядке строится обход граней */
  for (const list of adj) list.sort((p, q) => p.angle - q.angle);
  return { nodes, adj };
}

/* Минимальные циклы (грани) планарного графа обходом полуребёр.

   Правило обхода: придя в узел по ребру u→v, следующим берём полуребро v→w, которое
   стоит СРАЗУ ПО ЧАСОВОЙ (предыдущее в упорядоченном по возрастанию угла списке) от
   обратного ребра v→u. Это стандартный «самый правый поворот»: он режет плоскость на
   минимальные грани, каждое полуребро входит ровно в одну грань.

   Критерий внешней грани — ЗНАК площади, а не «самая большая». Обоснование: при этом
   правиле все ограниченные (внутренние) грани обходятся с положительной знаковой
   площадью, а внешняя грань КАЖДОЙ связной компоненты — с отрицательной (проверено
   аналитически на единичном квадрате: внутренняя грань +100, внешняя −100). Знак —
   локальный признак самой грани, поэтому он корректен и при нескольких компонентах, и
   при вложенных контурах (комната в комнате), где «самая большая площадь» уже не
   выделяет единственную внешнюю грань. Вырожденные грани (тупики-«усы» дают циклы
   нулевой площади) отсекаются порогом minArea. */
function findFaces(graph, minArea, maxFaces) {
  const { nodes, adj } = graph;
  if (!adj.length) return [];
  /* для каждого узла — позиция соседа в отсортированном списке (сосед уникален после
     дедупа рёбер), чтобы за O(1) находить обратное ребро v→u */
  const posOf = adj.map(list => {
    const m = new Map();
    list.forEach((e, i) => m.set(e.to, i));
    return m;
  });
  let totalHalf = 0;
  for (const list of adj) totalHalf += list.length;

  const visited = new Set();
  const faces = [];
  const hkey = (a, b) => a + ">" + b;
  for (let u0 = 0; u0 < adj.length; u0++) {
    for (const e0 of adj[u0]) {
      if (visited.has(hkey(u0, e0.to))) continue;
      const poly = [];
      let curFrom = u0, curTo = e0.to, guard = 0;
      let ok = true;
      const startKey = hkey(u0, e0.to);
      do {
        visited.add(hkey(curFrom, curTo));
        poly.push({ x: nodes[curFrom].x, y: nodes[curFrom].y });
        const list = adj[curTo];
        const backIdx = posOf[curTo].get(curFrom);   // обратное ребро v→u
        if (backIdx === undefined) { ok = false; break; }
        const nextIdx = (backIdx - 1 + list.length) % list.length; // сразу по часовой
        const nextTo = list[nextIdx].to;
        curFrom = curTo; curTo = nextTo;
        /* предохранитель от зацикливания на битой геометрии: грань не может пройти
           больше полурёбер, чем есть в графе */
        if (++guard > totalHalf + 4) { ok = false; break; }
      } while (hkey(curFrom, curTo) !== startKey);
      if (!ok || poly.length < 3) continue;
      const area = signedArea(poly);
      if (area > 0 && area >= minArea) {             // положительная = внутренняя грань
        faces.push({ polygon: poly, area });
        if (faces.length >= maxFaces) return faces;  // предел числа граней (предохранитель)
      }
    }
  }
  return faces;
}

/* ---- Запасной проход по сетке (если основной не дал ни одной грани: контур не
   замкнут — щели, недоведённые линии). Используем уже существующий флуд-фолл
   EPGeom.buildSpaceComponents: он «заклеивает» щели радиусом стены. Границу каждой
   внутренней компоненты трассируем в полигон, упрощаем и ортогонализируем.
   Результат — заведомо приблизительный (по клеткам), поэтому помечается source:'grid'. */

/* Убрать точки, лежащие на прямой между соседями (спрямление коллинеарных участков). */
function removeCollinear(poly) {
  if (poly.length < 3) return poly.slice();
  const out = [], n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  return out.length >= 3 ? out : poly.slice();
}

/* Расстояние от точки до прямой a—b (для Дугласа-Пекера). */
function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/* Упрощение полилинии Дугласом-Пекером. Контур подаём как открытую полилинию —
   шов на стыке первой/последней точки для грубого запасного контура несуществен. */
function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const seg = stack.pop(), s = seg[0], e = seg[1];
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { keep[idx] = true; stack.push([s, idx]); stack.push([idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* Трассировка границы одной компоненты: собираем направленные граничные рёбра клеток
   (там, где сосед не принадлежит компоненте), сшиваем head-to-tail в контуры, берём
   контур максимальной площади (внешняя граница компоненты). Координаты углов клеток
   целые → умножаем на cell для перевода в px. */
function traceCells(cells, cols, rows, component, compId, cell, originX = 0, originY = 0) {
  const inComp = (gx, gy) => gx >= 0 && gy >= 0 && gx < cols && gy < rows && component[gy * cols + gx] === compId;
  const edges = [];
  for (const gc of cells) {
    const gx = gc[0], gy = gc[1];
    if (!inComp(gx, gy - 1)) edges.push({ ax: gx, ay: gy, bx: gx + 1, by: gy });         // верх →
    if (!inComp(gx + 1, gy)) edges.push({ ax: gx + 1, ay: gy, bx: gx + 1, by: gy + 1 }); // право ↓
    if (!inComp(gx, gy + 1)) edges.push({ ax: gx + 1, ay: gy + 1, bx: gx, by: gy + 1 }); // низ ←
    if (!inComp(gx - 1, gy)) edges.push({ ax: gx, ay: gy + 1, bx: gx, by: gy });         // лево ↑
  }
  if (!edges.length) return null;
  const key = (x, y) => x + "_" + y;
  const byTail = new Map();
  for (const e of edges) { const k = key(e.ax, e.ay); if (!byTail.has(k)) byTail.set(k, []); byTail.get(k).push(e); }
  const used = new Set();
  let best = null, bestArea = -1;
  for (const start of edges) {
    if (used.has(start)) continue;
    const loop = []; let cur = start, guard = 0;
    while (cur && !used.has(cur)) {
      used.add(cur);
      loop.push({ x: originX + cur.ax * cell, y: originY + cur.ay * cell });
      const cand = byTail.get(key(cur.bx, cur.by));
      let nxt = null;
      if (cand) for (const c of cand) { if (!used.has(c)) { nxt = c; break; } }
      cur = nxt;
      if (++guard > edges.length + 2) break;
    }
    if (loop.length >= 4) {
      const a = Math.abs(signedArea(loop));
      if (a > bestArea) { bestArea = a; best = loop; }
    }
  }
  return best;
}

/* Запасной проход целиком: возвращает массив полигонов (px). originX/originY —
   мировое начало сетки: на бесконечном холсте линии бывают не от (0,0), поэтому
   вызывающий передаёт bounding box разметки. По умолчанию 0 — прежнее поведение. */
function fallbackByGrid(segments, geom, opts) {
  const width = opts.width, height = opts.height;
  const cell = opts.cell || 10, wallRadius = opts.wallRadius || 7;
  const originX = opts.originX || 0, originY = opts.originY || 0;
  if (!width || !height || !geom.buildSpaceComponents) return [];
  const map = geom.buildSpaceComponents(width, height, segments, cell, wallRadius, originX, originY);
  const cols = map.cols, rows = map.rows, component = map.component;
  /* компоненты, касающиеся границы холста, — это внешнее пространство, а не помещения */
  const border = new Set();
  for (let gx = 0; gx < cols; gx++) { border.add(component[gx]); border.add(component[(rows - 1) * cols + gx]); }
  for (let gy = 0; gy < rows; gy++) { border.add(component[gy * cols]); border.add(component[gy * cols + cols - 1]); }
  const cellsByComp = new Map();
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < cols; gx++) {
      const c = component[gy * cols + gx];
      if (c < 0 || border.has(c)) continue;
      if (!cellsByComp.has(c)) cellsByComp.set(c, []);
      cellsByComp.get(c).push([gx, gy]);
    }
  const minCells = Math.max(1, Math.floor((opts.minArea || 0) / (cell * cell)));
  const eps = opts.simplifyEps || 6;
  const polys = [];
  for (const entry of cellsByComp) {
    const cells = entry[1];
    if (cells.length < minCells) continue;
    const loop = traceCells(cells, cols, rows, component, entry[0], cell, originX, originY);
    if (!loop || loop.length < 4) continue;
    let poly = removeCollinear(loop);
    poly = douglasPeucker(poly, eps);
    /* ортогонализация: узлы сетки сдвинуты на origin (кратно cell), поэтому и
       округляем относительно origin — иначе на смещённой сетке контур «съедет» */
    poly = poly.map(p => ({ x: originX + Math.round((p.x - originX) / cell) * cell, y: originY + Math.round((p.y - originY) / cell) * cell }));
    poly = removeCollinear(poly);
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

/* Главный вход. segments — линии разметки {a,b}. opts:
     geom         — EPGeom (segmentsIntersection, polygonAreaPx, buildSpaceComponents);
     tol          — допуск склейки узлов, px;
     minArea      — порог отсечения вырожденных граней, px²;
     maxSegments  — предохранитель по числу линий на входе;
     maxFaces     — предохранитель по числу граней;
     width,height,cell,wallRadius,simplifyEps — параметры запасного прохода;
     originX,originY — мировое начало сетки запасного прохода (по умолчанию 0).
   Возвращает { rooms:[{polygon,area,source}], method, stats }. method ∈
   'faces' | 'grid' | 'none' | 'empty' | 'skipped-limit'. */
function roomsFromLines(segments, opts) {
  opts = opts || {};
  const geom = opts.geom;
  const tol = opts.tol > 0 ? opts.tol : 0.75;
  const minArea = opts.minArea >= 0 ? opts.minArea : 0;
  const maxSegments = opts.maxSegments || 400;
  const maxFaces = opts.maxFaces || 200;
  const stats = { input: segments ? segments.length : 0, subSegments: 0, faces: 0, method: "none" };

  if (!segments || !segments.length || !geom) { stats.method = "empty"; return { rooms: [], method: "empty", stats }; }
  /* предохранитель: на патологическом вводе O(n²)/O(n³) обход не должен вешать UI */
  if (segments.length > maxSegments) { stats.method = "skipped-limit"; return { rooms: [], method: "skipped-limit", stats }; }

  // ---- основной проход: грани планарного графа
  const sub = splitAtIntersections(segments, geom, tol);
  stats.subSegments = sub.length;
  const graph = buildPlanarGraph(sub, tol);
  const faces = findFaces(graph, minArea, maxFaces);
  stats.faces = faces.length;
  if (faces.length) {
    stats.method = "faces";
    return { rooms: faces.map(f => ({ polygon: f.polygon, area: f.area, source: "lines" })), method: "faces", stats };
  }

  // ---- запасной проход по сетке (только если основной пуст и переданы размеры холста)
  if (opts.width && opts.height && geom.buildSpaceComponents) {
    const polys = fallbackByGrid(segments, geom, opts);
    stats.method = polys.length ? "grid" : "none";
    return {
      rooms: polys.map(p => ({ polygon: p, area: geom.polygonAreaPx ? geom.polygonAreaPx(p) : Math.abs(signedArea(p)), source: "grid" })),
      method: stats.method, stats
    };
  }
  return { rooms: [], method: "none", stats };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { roomsFromLines, splitAtIntersections, buildPlanarGraph, findFaces,
  fallbackByGrid, traceCells, douglasPeucker, removeCollinear, signedArea };
if (typeof window !== "undefined") window.EPRoomsFromLines = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
