/* Наложение помещений (js/roomOverlap.js): площадь пересечения и обрезка свежего контура по уже
   размещённым. Блок «Комнаты не налезают друг на друга», ч.1 (решение владельца 30.10: новая комната
   строится соседней с общей стеной, а не клином внутрь существующей; спорная область остаётся у той,
   что была раньше). Чистый модуль — считаем настоящими EPRoomOverlap/EPGeom/EPRoomsFromLines.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте — прогнано руками):
     • difference() → всегда [poly] (обрезка отключена): краснеет «реальный случай» (П3 остаётся клином,
       overlap≠0) и «рассечение надвое»;
     • снять ветку «P внутри M» (ov>=aP-touch → всё равно режем): краснеет «вложенная комната сохранена»;
     • overlapArea считает грани «в A ИЛИ в B» вместо «в A И в B»: краснеет «соседи по стене → 0».
   Запуск: node --test tests/roomOverlap.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../js/roomOverlap.js");
const G = require("../js/geometry.js");

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const area = p => G.polygonAreaPx(p);
/* контур как множество округлённых вершин — для сравнения без зависимости от точки старта обхода */
const vset = p => new Set(p.map(v => `${Math.round(v.x * 10) / 10},${Math.round(v.y * 10) / 10}`));

/* --- overlapArea: базовые отношения контуров ---------------------------------------------------- */

test("соседи по общей стене: площадь пересечения 0 (касание — не наложение)", () => {
  const left = rect(0, 0, 100, 100), right = rect(100, 0, 200, 100);   // общая стена x=100
  assert.equal(O.overlapArea(left, right), 0, "смежные комнаты не перекрываются по площади");
});

test("непересекающиеся контуры: площадь пересечения 0", () => {
  assert.equal(O.overlapArea(rect(0, 0, 100, 100), rect(300, 300, 400, 400)), 0);
});

test("вложенный контур: площадь пересечения = площади вложенного", () => {
  const big = rect(0, 0, 400, 400), small = rect(100, 100, 200, 200);
  assert.equal(Math.round(O.overlapArea(big, small)), Math.round(area(small)), "малый целиком внутри большого");
});

test("частичное наложение: площадь пересечения = площади общей зоны", () => {
  const a = rect(0, 0, 200, 200), b = rect(100, 100, 300, 300);   // общий квадрат 100×100
  assert.equal(Math.round(O.overlapArea(a, b)), 10000);
});

/* --- clipAgainst: обрезка свежего контура по уже размещённым ------------------------------------ */

test("реальный случай владельца: П3 обрезана по левой кромке П1, пересечение ≈0, П1 не меняется", () => {
  // П1 — поправленная руками комната (пятиугольник), П3 — свежая грань из линий, заехавшая клином
  const P1 = [{ x: 217, y: 925 }, { x: 250, y: 400 }, { x: 850, y: 400 }, { x: 955, y: 890 }, { x: 550, y: 867 }];
  const P3 = [{ x: 250, y: 400 }, { x: 250, y: 650 }, { x: 100, y: 650 }, { x: 100, y: 400 }];
  const before = JSON.stringify(P1);

  const pieces = O.clipAgainst(P3, [P1], { minArea: 100 });
  assert.equal(pieces.length, 1, "П3 осталась одним куском (клин срезан, а не раздроблена)");
  assert.ok(O.overlapArea(pieces[0], P1) <= 1, "обрезанная П3 больше не налезает на П1 (пересечение ≈0)");
  // правая граница пошла по кромке П1: вместо (250,650) появилась точка на отрезке П1 (250,400)-(217,925)
  assert.ok(vset(pieces[0]).has("234.3,650"), "правый-нижний угол сел на кромку П1 (x≈234.3 при y=650)");
  assert.ok(area(pieces[0]) < area(P3), "площадь уменьшилась на величину клина");
  assert.equal(JSON.stringify(P1), before, "существующая комната П1 не изменена");
});

test("касание по стене: смежная комната не обрезается (возвращается как есть)", () => {
  const existing = rect(100, 0, 200, 100);
  const neigh = rect(0, 0, 100, 100);           // общая стена x=100
  const pieces = O.clipAgainst(neigh, [existing], { minArea: 100 });
  assert.equal(pieces.length, 1);
  assert.deepEqual(vset(pieces[0]), vset(neigh), "контур соседа не тронут");
});

test("вложенная комната (P целиком внутри существующей) НЕ обрезается — её судьбу решает coveredByManual", () => {
  const existing = rect(0, 0, 400, 400);
  const inner = rect(100, 100, 200, 200);       // санузел посреди зала
  const pieces = O.clipAgainst(inner, [existing], { minArea: 100 });
  assert.equal(pieces.length, 1, "вложенную комнату не съели");
  assert.deepEqual(vset(pieces[0]), vset(inner), "её контур не тронут (обрезка — не её задача)");
});

test("непересекающаяся комната не обрезается", () => {
  const pieces = O.clipAgainst(rect(0, 0, 100, 100), [rect(300, 300, 400, 400)], { minArea: 100 });
  assert.equal(pieces.length, 1);
  assert.deepEqual(vset(pieces[0]), vset(rect(0, 0, 100, 100)));
});

test("существующая комната рассекает свежую надвое: две комнаты, ни одна не налезает", () => {
  // свежая широкая комната; существующая — вертикальная полоса поперёк, рассекающая её
  const fresh = rect(0, 0, 300, 100);
  const bar = rect(100, -50, 200, 150);         // полоса x[100..200] на всю высоту fresh
  const pieces = O.clipAgainst(fresh, [bar], { minArea: 100 });
  assert.equal(pieces.length, 2, "свежая комната рассечена полосой на два куска");
  pieces.forEach(p => assert.ok(O.overlapArea(p, bar) <= 1, "кусок не налезает на существующую"));
  const xs = pieces.map(p => G.polygonCentroid(p).x).sort((a, b) => a - b);
  assert.ok(xs[0] < 100 && xs[1] > 200, "один кусок слева от полосы, другой справа");
});

test("вырожденный осколок обрезки (меньше minArea) не создаётся", () => {
  // свежая комната почти целиком внутри существующей, снаружи торчит полоска 0.05×1000 = 50 px² < minArea
  const existing = rect(0, 0, 1000, 1000);
  const slim = rect(-0.05, 0, 500, 1000);
  const pieces = O.clipAgainst(slim, [existing], { minArea: 100 });
  assert.equal(pieces.length, 0, "осколок площадью <minArea отброшен, вырожденной комнаты нет");
});

/* --- clipRoomsAgainst: обёртка для оркестратора ------------------------------------------------- */

test("clipRoomsAgainst обрезает список граней и сохраняет source", () => {
  const P1 = [{ x: 217, y: 925 }, { x: 250, y: 400 }, { x: 850, y: 400 }, { x: 955, y: 890 }, { x: 550, y: 867 }];
  const faces = [
    { polygon: rect(250, 100, 850, 400), area: 180000, source: "lines" },   // П2, касается П1 по стене y=400
    { polygon: rect(100, 400, 250, 650), area: 37500, source: "lines" }     // П3, клин в П1
  ];
  const out = O.clipRoomsAgainst(faces, [P1], { minArea: 100 });
  assert.equal(out.length, 2, "обе грани остались (П2 цела, П3 обрезана)");
  out.forEach(r => assert.equal(r.source, "lines", "source сохранён"));
  const p3 = out.find(r => G.polygonCentroid(r.polygon).y > 400);
  assert.ok(O.overlapArea(p3.polygon, P1) <= 1, "обрезанная П3 не налезает на П1");
});
