/* Наложение помещений: пересечение и ОБРЕЗКА контуров (блок «Комнаты не налезают друг на друга»).
   Чистый модуль — ни state, ни DOM, ни EP_DATA: контуры приходят массивами точек [{x,y}], наружу —
   числа и новые контуры. Это разблокирует автотесты (PLAN 7.1), как geometry.js/roomsFromLines.js.

   ЗАЧЕМ. «Определить помещения по линиям» строит грани планарного графа из линий разметки, но ничего
   не знает про УЖЕ размещённые комнаты (поправленные руками, autoPolygon===false): их контуры в граф
   не входят, поэтому свежая грань может клином заехать внутрь существующей комнаты (случай владельца
   30.10: «одна заехала в другую»). Решение владельца: новая комната строится соседней С ОБЩЕЙ СТЕНОЙ,
   а не клином внутрь; спорная область остаётся у той комнаты, что была РАНЬШЕ, — новая обрезается по её
   границе. Касание по общей стене наложением НЕ считается (площадь пересечения ноль).

   КАК СЧИТАЕМ — через тот же планарный аппарат, что строит сами комнаты (EPRoomsFromLines.
   splitAtIntersections/buildPlanarGraph/findFaces), а не второй реализацией булевых операций над
   многоугольниками. Разрезаем стороны ОБОИХ контуров в точках пересечения, собираем планарный граф и
   берём его минимальные грани; затем классифицируем каждую грань по её точке ВНУТРИ (EPGeom.
   roomMatchPoint — гарантированно внутри грани): пересечение A∩B — грани, чья точка лежит и в A, и в B;
   разность A\B — грани, чья точка в A, но не в B. Склейка узлов по допуску (nodeKey/tol) и разрез на
   T-стыках уже обкатаны на реальных планах — поэтому общие вершины и совпавшие рёбра (комната касается
   соседней по стене) обрабатываются устойчиво, без спецслучаев Грайнера-Хормана.

   Модуль понадобится и частям 2/4 блока (правка контура мышью, подсветка наложений), поэтому API
   простое: overlapArea(a,b) — площадь пересечения; clipAgainst(poly, others) — обрезка контура по уже
   существующим; clipRoomsAgainst — тонкая обёртка над списком граней для оркестратора (roomDetect).

   Интерфейс приложению — window.EPRoomOverlap. */
(() => {
"use strict";

/* Геометрию и планарный аппарат берём из уже загруженных модулей — второй копии pointInPolygon/
   площади/поиска граней не заводим. В браузере namespace'ы подключены раньше (geometry.js,
   roomsFromLines.js в index.html идут до этого файла), в Node — резолвим через require. Можно передать
   свои аргументом (для тестов), по умолчанию хватает глобальных. */
function defaultGeom(g) {
  if (g) return g;
  if (typeof window !== "undefined" && window.EPGeom) return window.EPGeom;
  if (typeof require !== "undefined") return require("./geometry.js");
  return null;
}
function defaultFaces(f) {
  if (f) return f;
  if (typeof window !== "undefined" && window.EPRoomsFromLines) return window.EPRoomsFromLines;
  if (typeof require !== "undefined") return require("./roomsFromLines.js");
  return null;
}

/* Допуск склейки узлов планарного графа, px. Тот же смысл, что EPConfig.roomWeldTol (0.75): после
   магнитов координаты почти целые, но точное сравнение float опасно (точки разреза в пересечениях
   дробные). Модуль про EPConfig не знает — значение приходит в opts, здесь лишь запас по умолчанию. */
const DEFAULT_TOL = 0.75;
/* Порог отсечения числовой «пыли» при поиске граней арангемента: грань площадью меньше этого —
   артефакт склейки/разреза, не настоящая область. На саму обрезку не влияет (настоящие части гораздо
   крупнее), служит лишь тому, чтобы сумма пересечения и список кусков не ловили суб-микропиксельный шум. */
const DUST_AREA = 1e-6;
/* Площадной допуск «касание, а не наложение» (px²): пересечение не больше него считаем нулевым —
   комната, примкнувшая к соседней по общей стене, границу делит, но площади не перекрывает. Берём с
   запасом над суб-пиксельным шумом склейки, но много меньше реального клина (случай владельца ≈1964 px²). */
const TOUCH_AREA = 1;

/* Стороны замкнутого контура как отрезки {a,b} — вход для планарного аппарата (та же форма, что
   state.roomLines и стены). Замыкаем последнюю вершину на первую. */
function polyEdges(poly) {
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    out.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
  }
  return out;
}

/* Валидный контур: массив из ≥3 вершин. */
function ok(poly) { return Array.isArray(poly) && poly.length >= 3; }

/* Минимальные грани планарного АРАНЖЕМЕНТА двух контуров (все рёбра A и B, разрезанные в пересечениях).
   Возвращает [{polygon, area}] — тот же формат, что EPRoomsFromLines.findFaces. На этих гранях строятся
   и пересечение, и разность: грань целиком лежит по одну сторону каждого ребра (рёбра обоих контуров в
   графе), поэтому её внутренняя точка однозначно «в A/не в A» и «в B/не в B». */
function arrangementFaces(a, b, geom, faces, tol) {
  const segs = polyEdges(a).concat(polyEdges(b));
  const sub = faces.splitAtIntersections(segs, geom, tol);
  const graph = faces.buildPlanarGraph(sub, tol);
  return faces.findFaces(graph, DUST_AREA, 4000);
}

/* Площадь пересечения двух контуров, px². Касание по стене/вершине даёт 0 (нет грани, лежащей и в A,
   и в B). deps (необязательно): { geom, faces, tol } — по умолчанию глобальные модули и DEFAULT_TOL. */
function overlapArea(a, b, deps) {
  deps = deps || {};
  const geom = defaultGeom(deps.geom), faces = defaultFaces(deps.faces);
  if (!geom || !faces || !ok(a) || !ok(b)) return 0;
  const tol = deps.tol > 0 ? deps.tol : DEFAULT_TOL;
  let sum = 0;
  for (const f of arrangementFaces(a, b, geom, faces, tol)) {
    const mp = geom.roomMatchPoint(f.polygon);   /* точка гарантированно ВНУТРИ грани */
    if (geom.pointInPolygon(mp.x, mp.y, a) && geom.pointInPolygon(mp.x, mp.y, b)) sum += f.area;
  }
  return sum;
}

/* Разность A\B как список контуров: грани аранжемента, чья внутренняя точка лежит в A, но НЕ в B.
   Несколько кусков (B рассекает A надвое) → несколько контуров; полное поглощение (A⊆B) → пустой список. */
function difference(a, b, deps) {
  deps = deps || {};
  const geom = defaultGeom(deps.geom), faces = defaultFaces(deps.faces);
  if (!geom || !faces || !ok(a)) return ok(a) ? [a.map(p => ({ x: p.x, y: p.y }))] : [];
  if (!ok(b)) return [a.map(p => ({ x: p.x, y: p.y }))];
  const tol = deps.tol > 0 ? deps.tol : DEFAULT_TOL;
  const out = [];
  for (const f of arrangementFaces(a, b, geom, faces, tol)) {
    const mp = geom.roomMatchPoint(f.polygon);
    if (geom.pointInPolygon(mp.x, mp.y, a) && !geom.pointInPolygon(mp.x, mp.y, b)) out.push(f.polygon);
  }
  return out;
}

/* Обрезка контура poly по уже существующим контурам others. Для каждого существующего M:
     • пересечение ≤ TOUCH_AREA — касание/непересечение, кусок не трогаем;
     • poly ПОЛНОСТЬЮ внутри M (пересечение ≈ площади poly) — это НЕ клин, а «комната в комнате»
       (вложенная) или дубль тела: обрезка тут НЕ наша задача (её решает EPRoomCarry.coveredByManual),
       кусок оставляем как есть, чтобы не «съесть» вложенную комнату;
     • частичное наложение (клин) — заменяем кусок на разность poly\M; спорная область уходит M.
   Каждый следующий M режет уже полученные куски. Куски площадью меньше opts.minArea отбрасываем
   (вырожденные осколки обрезки — не комнаты). Возвращает массив контуров (0..n). deps/пороги — в opts:
   { geom, faces, tol, minArea, touchArea }. */
function clipAgainst(poly, others, opts) {
  opts = opts || {};
  if (!ok(poly)) return [];
  const list = (others || []).filter(ok);
  if (!list.length) return [poly.map(p => ({ x: p.x, y: p.y }))];
  const geom = defaultGeom(opts.geom), faces = defaultFaces(opts.faces);
  const deps = { geom, faces, tol: opts.tol > 0 ? opts.tol : DEFAULT_TOL };
  const minArea = opts.minArea >= 0 ? opts.minArea : 0;
  const touch = opts.touchArea >= 0 ? opts.touchArea : TOUCH_AREA;
  const areaPx = geom ? geom.polygonAreaPx : null;

  let pieces = [poly.map(p => ({ x: p.x, y: p.y }))];
  if (!geom || !faces) return pieces;   /* нет модулей (в Node без require) — не обрезаем, а не падаем */
  for (const M of list) {
    const next = [];
    for (const P of pieces) {
      const ov = overlapArea(P, M, deps);
      if (ov <= touch) { next.push(P); continue; }                 /* касание/мимо — не наложение */
      const aP = areaPx(P);
      if (ov >= aP - touch) { next.push(P); continue; }            /* P внутри M — не клин (coveredByManual) */
      for (const c of difference(P, M, deps)) if (areaPx(c) >= minArea) next.push(c);
    }
    pieces = next;
  }
  return pieces;
}

/* Обёртка для оркестратора (roomDetect.buildRoomsFromLines): обрезает список свежих ГРАНЕЙ
   ({polygon, area, source}) по контурам existingPolys уже размещённых комнат. Одна грань → 0..n граней
   (клин обрезан; при рассечении надвое — несколько комнат). source сохраняем (по линиям/по сетке),
   площадь пересчитываем по обрезанному контуру. opts — как у clipAgainst. */
function clipRoomsAgainst(faceRooms, existingPolys, opts) {
  opts = opts || {};
  const geom = defaultGeom(opts.geom);
  const areaPx = geom ? geom.polygonAreaPx : null;
  const out = [];
  for (const fr of (faceRooms || [])) {
    const pieces = clipAgainst(fr.polygon, existingPolys, opts);
    for (const poly of pieces) out.push({ polygon: poly, area: areaPx ? areaPx(poly) : fr.area, source: fr.source });
  }
  return out;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { overlapArea, difference, clipAgainst, clipRoomsAgainst };
if (typeof window !== "undefined") window.EPRoomOverlap = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
