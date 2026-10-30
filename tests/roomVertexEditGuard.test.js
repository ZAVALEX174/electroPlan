/* Блок «Комнаты не налезают друг на друга», ЧАСТЬ 2: ручная правка контура НЕ заводит комнату внутрь
   соседней. Два слоя покрытия:
     1) чистые функции EPRoomOverlap (overlapEach/overlapGrew/clampVertexMove) — на простых прямоуголь-
        никах, где ответ считается руками;
     2) НАСТОЯЩИЙ путь правки из js/rooms.js (overlapGuardFor + dragVertex + удаление вершины), вырезанный
        исходным текстом и исполняемый в vm — тот же событийный путь, что в браузере (как roomVertexEdit).

   МУТАЦИОННАЯ ТАБЛИЦА (прогнано руками, см. отчёт):
     • clampVertexMove всегда возвращает to (зажим убран): краснеет «вершину тащат в соседа → упёрлась»
       и vm-тест «drag в П1 останавливается на кромке».
     • overlapGrew сравнивает с 0 вместо base[i] (запрет уменьшения тоже): краснеет «старое наложение
       уменьшать можно» и vm «удаление, снижающее наложение, выполняется».
     • удаление не зовёт overlapGrew (зажим снят): краснеет vm «удаление, заводящее в соседа, отклонено».

   Запуск: node --test tests/roomVertexEditGuard.test.js */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const O = require("../js/roomOverlap.js");
const G = require("../js/geometry.js");
const EPConfig = require("../js/config.js");
const { roomLabelPoint, roomNamePoint } = require("../js/geometry.js");
const EPViewport = require("../js/viewport.js");

const SVG_NS = "http://www.w3.org/2000/svg";
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const opts = { tol: EPConfig.roomWeldTol };

/* ===== Слой 1: чистые функции EPRoomOverlap ====================================================== */

test("overlapEach: наложение с каждым соседом; далёкий (bbox мимо) → 0 без счёта", () => {
  const R = rect(0, 0, 200, 200);
  const near = rect(100, 100, 300, 300);     // общий квадрат 100×100 = 10000
  const far = rect(1000, 1000, 1100, 1100);  // далеко — bbox не пересекается
  const base = O.overlapEach(R, [near, far], opts);
  assert.equal(Math.round(base[0]), 10000, "наложение с ближним соседом посчитано");
  assert.equal(base[1], 0, "далёкий сосед отфильтрован по bbox → 0");
});

test("overlapGrew: рост наложения сверх base → индекс соседа; в пределах base (уменьшение) → −1", () => {
  const M = rect(100, 0, 300, 100);
  const base0 = O.overlapEach(rect(0, 0, 200, 100), [M], opts);   // наложение 100×100 = 10000
  // контур стал ШИРЕ (заехал глубже) — наложение выросло → возвращается индекс 0
  assert.equal(O.overlapGrew(rect(0, 0, 250, 100), [M], base0, opts), 0, "рост наложения пойман");
  // контур стал УЖЕ (отступил) — наложение уменьшилось → −1 (уменьшать разрешаем)
  assert.equal(O.overlapGrew(rect(0, 0, 150, 100), [M], base0, opts), -1, "уменьшение наложения разрешено");
  // без base (нули) даже прежнее наложение считается ростом
  assert.equal(O.overlapGrew(rect(0, 0, 200, 100), [M], null, opts), 0, "без base любое наложение сверх касания — рост");
});

test("clampVertexMove: вершину тащат в соседа → упёрлась на границе, наложение ≤ порога", () => {
  const R = rect(0, 0, 100, 100);            // [(0,0),(100,0),(100,100),(0,100)], общая стена x=100
  const M = rect(100, 0, 200, 100);
  const base = O.overlapEach(R, [M], opts);  // касание → [0]
  const res = O.clampVertexMove(R, 2, { x: 150, y: 100 }, [M], base, opts);   // угол (100,100) тянем вправо в M
  assert.equal(res.clamped, true, "движение зажато границей соседа");
  assert.ok(Math.abs(res.x - 100) < 1, `вершина упёрлась в стену x=100 (факт ${res.x.toFixed(2)})`);
  const after = O.withVertex(R, 2, res);
  assert.ok(O.overlapArea(after, M) <= 1, "наложение после зажима ≤ порога касания");
});

test("clampVertexMove: вершину тащат ОТ соседа → следует за курсором (без зажима)", () => {
  const R = rect(0, 0, 100, 100);
  const M = rect(100, 0, 200, 100);
  const base = O.overlapEach(R, [M], opts);
  const res = O.clampVertexMove(R, 2, { x: 80, y: 100 }, [M], base, opts);   // угол внутрь своей комнаты
  assert.equal(res.clamped, false, "в свою сторону зажима нет");
  assert.equal(res.x, 80, "вершина точно под курсором (X)");
  assert.equal(res.y, 100, "вершина точно под курсором (Y)");
});

/* ===== Слой 2: настоящий путь правки из js/rooms.js в vm ========================================= */

function pointer(over) {
  return Object.assign({ altKey: false, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} }, over);
}
function classesOf(node) {
  const a = node.attrs && node.attrs.class ? node.attrs.class : "";
  return ((node.className || "") + " " + a).split(/\s+/).filter(Boolean);
}
function matchSel(node, sel) {
  const tagM = sel.match(/^([a-zA-Z][\w-]*)/);
  if (tagM && node.tag !== tagM[1]) return false;
  const clsM = sel.match(/\.([\w-]+)/);
  if (clsM && !classesOf(node).includes(clsM[1])) return false;
  const attrM = sel.match(/\[data-([\w-]+)\s*=\s*"([^"]*)"\]/);
  if (attrM) {
    const prop = attrM[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (String(node.dataset[prop]) !== attrM[2]) return false;
  }
  return true;
}
function makeEl(tag) {
  const el = {
    tag: tag || "", attrs: {}, dataset: {}, style: {}, children: [],
    className: "", textContent: "", value: "", _html: "", _parent: null, onpointerdown: null, onclick: null,
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = v; if (v === "") el.children = []; },
    setAttribute(n, v) { el.attrs[n] = String(v); },
    getAttribute(n) { return n in el.attrs ? el.attrs[n] : null; },
    appendChild(c) { c._parent = el; el.children.push(c); return c; },
    remove() { if (el._parent) el._parent.children = el._parent.children.filter(x => x !== el); },
    querySelector(sel) { return el.children.find(c => matchSel(c, sel)) || null; },
    querySelectorAll(sel) { return el.children.filter(c => matchSel(c, sel)); }
  };
  return el;
}
function makeDoc() {
  const listeners = {};
  return {
    createElement: t => makeEl(t), createElementNS: (_ns, t) => makeEl(t),
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn); },
    fire(type, ev) { (listeners[type] || []).slice().forEach(fn => fn(ev)); }
  };
}

/* vm-контекст с настоящими renderRooms + overlapGuardFor + правкой вершин. В отличие от roomVertexEdit
   даём контексту window-глобалы EPRoomOverlap/EPConfig — их зовёт overlapGuardFor (в браузере это
   window.*; внутри EPRoomOverlap геометрия/грани резолвятся его же require). Масштаб 1, окно в (0,0) →
   экран==мир, чтобы координаты вершин совпадали с clientX/Y. */
function buildRooms(state) {
  const spies = { status: [], toast: [], persist: 0, refreshAssign: 0 };
  const doc = makeDoc();
  const svg = makeEl("svg");
  const canvas = makeEl("div");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const ctx = {
    document: doc, SVG_NS, canvas, state, EPRoomOverlap: O, EPConfig,
    $: id => (id === "roomsSvg" ? svg : makeEl("div")),
    esc: String,
    clientToWorld: (cx, cy) => EPViewport.screenToWorld({ x: cx, y: cy },
      { panX: 0, panY: 0, scale: state.scale, angle: state.worldAngle || 0 }),
    roomLabelPoint, roomNamePoint,
    roomAreaM2: () => 0, formatArea: v => String(v),
    getObjectsInRoom: () => [], roomDisplayArea: () => "",
    placePendingAtEvent() {}, selectEntity() {}, removeEntity() {}, makeDraggable() {},
    beginGesture() {}, endGesture() {},
    persistProject() { spies.persist++; },
    refreshAfterRoomAssignments() { spies.refreshAssign++; },
    updateStatus(m) { spies.status.push(m); },
    toast(m) { spies.toast.push(m); }
  };
  const code = [
    stand.functionSource("renderRooms"),
    stand.functionSource("computeOverlaps"),
    stand.functionSource("overlapOpts"),
    stand.functionSource("joinRoomNames"),
    stand.functionSource("overlapNoteText"),
    stand.functionSource("overlapHatchDefs"),
    stand.functionSource("overlapGuardFor"),
    stand.functionSource("svgTitle"),
    stand.functionSource("markRoomEdited"),
    stand.functionSource("refreshRoomAfterEdit"),
    stand.functionSource("renderVertexHandles"),
    stand.functionSource("dragVertex"),
    ";({ renderRooms });"
  ].join("\n");
  vm.createContext(ctx);
  const api = vm.runInContext(code, ctx);
  return { api, svg, doc, canvas, spies };
}
function makeState(over) {
  return Object.assign({ tool: "vertex", selected: null, scale: 1, rooms: [], pending: null }, over);
}
/* Отрендерить ПРАВИМУЮ комнату edit (она выделена) рядом с соседкой neigh и вернуть её ручки. */
function setup(edit, neigh) {
  const state = makeState({ selected: { kind: "room", id: edit.id }, rooms: [edit, neigh], scale: 1 });
  const built = buildRooms(state);
  built.api.renderRooms();
  return Object.assign({ state, vhandles: built.svg.querySelectorAll(".vertex-handle") }, built);
}
const last = arr => arr[arr.length - 1];

test("vm drag: вершину П3 тянут в П1 — останавливается на кромке соседа, наложение ≈0", () => {
  // данные владельца: П1 поправлена руками (пятиугольник), П3 — соседка с общей стеной по кромке П1
  const P1 = { id: "p1", name: "П1", polygon: [{ x: 217, y: 925 }, { x: 250, y: 400 }, { x: 850, y: 400 }, { x: 955, y: 890 }, { x: 550, y: 867 }] };
  const P3 = { id: "p3", name: "П3", polygon: [{ x: 250, y: 400 }, { x: 234.3, y: 650 }, { x: 100, y: 650 }, { x: 100, y: 400 }], autoPolygon: true, edited: false };
  const { vhandles, doc } = setup(P3, P1);
  // вершина №1 (234.3,650) лежит на левой кромке П1; тянем её вправо в (300,650) — внутрь П1
  vhandles[1].onpointerdown(pointer({ clientX: 234.3, clientY: 650 }));
  doc.fire("pointermove", pointer({ clientX: 300, clientY: 650 }));
  doc.fire("pointerup", pointer({}));
  assert.ok(P3.polygon[1].x < 236, `вершина упёрлась в кромку П1 (x≈234.3, факт ${P3.polygon[1].x.toFixed(2)}), а не ушла в 300`);
  assert.ok(O.overlapArea(P3.polygon, P1.polygon) <= 1, "обрезанная П3 не налезает на П1 (наложение ≈0)");
  assert.equal(P3.edited, true, "правка всё равно помечает комнату ручной");
});

test("vm drag: вершину П3 тянут В СВОЮ сторону (от П1) — идёт за курсором, не зажимается", () => {
  const P1 = { id: "p1", name: "П1", polygon: [{ x: 217, y: 925 }, { x: 250, y: 400 }, { x: 850, y: 400 }, { x: 955, y: 890 }, { x: 550, y: 867 }] };
  const P3 = { id: "p3", name: "П3", polygon: [{ x: 250, y: 400 }, { x: 234.3, y: 650 }, { x: 100, y: 650 }, { x: 100, y: 400 }], autoPolygon: true, edited: false };
  const { vhandles, doc } = setup(P3, P1);
  vhandles[1].onpointerdown(pointer({ clientX: 234.3, clientY: 650 }));
  doc.fire("pointermove", pointer({ clientX: 150, clientY: 650 }));   // влево, в тело своей комнаты
  doc.fire("pointerup", pointer({}));
  assert.equal(P3.polygon[1].x, 150, "вершина точно под курсором — зажима в свою сторону нет");
  assert.equal(P3.polygon[1].y, 650, "Y под курсором");
});

test("vm удаление: вершина, снятие которой заводит контур в соседа, НЕ удаляется (тост с именем)", () => {
  const M = { id: "m", name: "Гостиная", polygon: rect(200, 0, 400, 400) };
  // контур с вогнутой вершиной (100,200): без неё прямая кромка (260,0)-(260,400) залезет в M на x[200..260]
  const R = { id: "r", name: "Кухня", polygon: [{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 100, y: 200 }, { x: 260, y: 400 }, { x: 0, y: 400 }], autoPolygon: true, edited: false };
  const { vhandles, spies } = setup(R, M);
  vhandles[2].onpointerdown(pointer({ altKey: true }));   // попытка удалить (100,200)
  assert.equal(R.polygon.length, 5, "вершина не удалена — контур заехал бы в соседа");
  assert.equal(R.edited, false, "заблокированное удаление не метит комнату ручной");
  assert.match(last(spies.toast), /Гостиная/, "тост называет соседнюю комнату");
});

test("vm удаление: вершина, снятие которой УМЕНЬШАЕТ существующее наложение, удаляется (старый проект)", () => {
  const M = { id: "m", name: "Гостиная", polygon: rect(200, 0, 400, 400) };
  // тот же R уже налезает на M двумя клиньями; снятие (260,0) наложение уменьшает → удаление разрешено
  const R = { id: "r", name: "Кухня", polygon: [{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 100, y: 200 }, { x: 260, y: 400 }, { x: 0, y: 400 }], autoPolygon: true, edited: false };
  const { vhandles, spies } = setup(R, M);
  vhandles[1].onpointerdown(pointer({ altKey: true }));   // удалить (260,0) — верхний клин исчезает
  assert.equal(R.polygon.length, 4, "вершина удалена — наложение уменьшилось, не выросло");
  assert.equal(R.polygon.some(p => p.x === 260 && p.y === 0), false, "удалённой вершины в контуре нет");
  assert.equal(spies.toast.length, 0, "тоста-отказа нет");
});
