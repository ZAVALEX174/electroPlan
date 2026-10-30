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

/* --- intersection: контуры области пересечения (ч.4 — закраска на холсте) ------------------------
   МУТАЦИОННАЯ ТАБЛИЦА (прогнано руками):
     • intersection берёт «в A ИЛИ в B» вместо «в A И в B»: краснеет «касание → пусто» (появится грань).
     • overlaps НЕ исключает полную вложенность (убрать `ia>=area-touch`): краснеет «санузел внутри зала
       → без закраски» (появятся регион и строки).
     • overlaps сравнивает с 0 вместо touch: краснеет «касание по стене → ни закраски, ни строк». */

test("intersection: частичное наложение даёт контур площадью общей зоны", () => {
  const a = rect(0, 0, 200, 200), b = rect(100, 100, 300, 300);   // общий квадрат 100×100
  const polys = O.intersection(a, b);
  assert.equal(polys.length, 1, "одна область пересечения");
  assert.equal(Math.round(area(polys[0])), 10000, "площадь контура пересечения = общая зона");
});

test("intersection: касание по общей стене → пустой список (не наложение)", () => {
  assert.deepEqual(O.intersection(rect(0, 0, 100, 100), rect(100, 0, 200, 100)), [], "смежные по стене не дают области");
});

test("intersection: вложенный контур → область = сам вложенный", () => {
  const polys = O.intersection(rect(0, 0, 400, 400), rect(100, 100, 200, 200));
  assert.equal(polys.length, 1);
  assert.equal(Math.round(area(polys[0])), 10000, "область пересечения = площадь вложенного");
});

/* --- overlaps: отчёт о наложениях для показа (ч.4) ----------------------------------------------- */

test("overlaps: клин двух контурных комнат — одна область и взаимные строки «пересекается с»", () => {
  const P1 = [{ x: 217, y: 925 }, { x: 250, y: 400 }, { x: 850, y: 400 }, { x: 955, y: 890 }, { x: 550, y: 867 }];
  const P3old = rect(100, 400, 250, 650);   // старый П3 ДО обрезки — клин в П1
  const rep = O.overlaps([{ id: "p1", name: "Помещение 1", polygon: P1 }, { id: "p3", name: "Помещение 3", polygon: P3old }]);
  assert.equal(rep.regions.length, 1, "закрашиваемая область одна");
  assert.deepEqual(rep.notes.p1.overlaps, ["Помещение 3"], "у П1 строка называет П3");
  assert.deepEqual(rep.notes.p3.overlaps, ["Помещение 1"], "у П3 строка называет П1");
});

test("overlaps: вложенная комната (санузел в зале) НЕ помечается наложением", () => {
  const rep = O.overlaps([{ id: "z", name: "Зал", polygon: rect(0, 0, 300, 300) }, { id: "s", name: "Санузел", polygon: rect(100, 100, 200, 200) }]);
  assert.equal(rep.regions.length, 0, "законная вложенность не красится");
  assert.deepEqual(rep.notes, {}, "и строк «пересекается» нет");
});

test("overlaps: касание по стене — ни области, ни строк", () => {
  const rep = O.overlaps([{ id: "a", name: "A", polygon: rect(0, 0, 100, 100) }, { id: "b", name: "B", polygon: rect(100, 0, 200, 100) }]);
  assert.equal(rep.regions.length, 0);
  assert.deepEqual(rep.notes, {});
});

test("overlaps: бесконтурная табличка внутри контурной → строка «внутри», без области", () => {
  const P2 = [{ x: 250, y: 400 }, { x: 300, y: 100 }, { x: 850, y: 100 }, { x: 850, y: 400 }];
  const rep = O.overlaps([
    { id: "p2", name: "Помещение 2", polygon: P2 },
    { id: "nw", name: "Новая комната", point: { x: 475, y: 280 } }   // seed внутри П2
  ]);
  assert.equal(rep.regions.length, 0, "у бесконтурной таблички площади нет — закраски нет");
  assert.deepEqual(rep.notes.nw.inside, ["Помещение 2"], "строка «внутри «Помещения 2»»");
});

test("overlaps: несколько соседей — все имена в списке (усечение решает показ)", () => {
  const C = rect(0, 0, 100, 100);
  const rep = O.overlaps([
    { id: "c", name: "C", polygon: C },
    { id: "d", name: "D", polygon: rect(50, 50, 150, 150) },
    { id: "e", name: "E", polygon: rect(-50, -50, 50, 50) }
  ]);
  assert.deepEqual(rep.notes.c.overlaps.sort(), ["D", "E"], "у C оба соседа");
});

test("overlaps: проект без наложений → пустой отчёт (ни области, ни строк)", () => {
  const rep = O.overlaps([
    { id: "a", name: "A", polygon: rect(0, 0, 100, 100) },
    { id: "b", name: "B", polygon: rect(300, 300, 400, 400) },
    { id: "g", name: "Без контура", point: { x: 700, y: 700 } }
  ]);
  assert.equal(rep.regions.length, 0, "лишних элементов подсветки нет");
  assert.deepEqual(rep.notes, {}, "строк наложения нет");
});
