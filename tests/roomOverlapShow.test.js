/* Блок «Комнаты не налезают друг на друга», ЧАСТЬ 4: ПОКАЗ уже существующих наложений (старые проекты,
   сохранённые до ч.1–3). Два слоя:
     1) чистые функции EPRoomOverlap.intersection/overlaps — в tests/roomOverlap.test.js;
     2) НАСТОЯЩИЙ путь показа из js/rooms.js (renderRooms рисует закраску и красную строку,
        updateRoomLabelText держит ту же строку при точечном коммите имени) — вырезан исходным текстом
        и исполнен в vm, как roomVertexEdit.

   МУТАЦИОННАЯ ТАБЛИЦА (прогнано руками):
     • renderRooms не рисует регионы (убрать блок report.regions): краснеет «клин → есть .room-overlap».
     • renderRooms не добавляет строку (noteText не в innerHTML): краснеет «табличка со строкой».
     • updateRoomLabelText не трогает .room-overlap-note (убрать блок note): краснеет «коммит имени
       оставляет строку» и «коммит убирает устаревшую строку».
   Запуск: node --test tests/roomOverlapShow.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const O = require("../js/roomOverlap.js");
const EPConfig = require("../js/config.js");

const SVG_NS = "http://www.w3.org/2000/svg";
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const P1 = [{ x: 217, y: 925 }, { x: 250, y: 400 }, { x: 850, y: 400 }, { x: 955, y: 890 }, { x: 550, y: 867 }];
const P3old = rect(100, 400, 250, 650);   // старый П3 ДО обрезки — клин в П1

/* Узел, достаточный для renderRooms/updateRoomLabelText: класс/атрибуты, дети, querySelector по классу/тегу,
   innerHTML="" чистит детей (так renderRooms сбрасывает слой перед отрисовкой). */
function matchSel(node, sel) {
  const tagM = sel.match(/^([a-zA-Z][\w-]*)/);
  if (tagM && node.tag !== tagM[1]) return false;
  const clsM = sel.match(/\.([\w-]+)/);
  if (clsM && !String(node.className || "").split(/\s+/).includes(clsM[1])) return false;
  return true;
}
function makeEl(tag) {
  const el = {
    tag: tag || "", attrs: {}, dataset: {}, style: {}, children: [],
    className: "", textContent: "", _html: "", _parent: null, onclick: null,
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = v; if (v === "") el.children = []; },
    setAttribute(n, v) { el.attrs[n] = String(v); if (n === "class") el.className = String(v); },
    getAttribute(n) { return n in el.attrs ? el.attrs[n] : null; },
    appendChild(c) { c._parent = el; el.children.push(c); return c; },
    remove() { if (el._parent) el._parent.children = el._parent.children.filter(x => x !== el); },
    querySelector(sel) { return el.children.find(c => matchSel(c, sel)) || null; },
    querySelectorAll(sel) { return el.children.filter(c => matchSel(c, sel)); }
  };
  return el;
}
const doc = { createElement: t => makeEl(t), createElementNS: (_ns, t) => makeEl(t) };

function buildCtx(state, canvas, svg) {
  return {
    document: doc, SVG_NS, canvas, state, EPRoomOverlap: O, EPConfig,
    $: id => (id === "roomsSvg" ? svg : makeEl("div")),
    esc: s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    getObjectsInRoom: () => [], roomDisplayArea: () => "",
    selectEntity() {}, removeEntity() {}, placePendingAtEvent() {}, makeDraggable() {}
  };
}
function runRooms(state) {
  const canvas = makeEl("div"), svg = makeEl("svg");
  const ctx = buildCtx(state, canvas, svg);
  const code = [
    stand.functionSource("renderRooms"),
    stand.functionSource("computeOverlaps"),
    stand.functionSource("overlapOpts"),
    stand.functionSource("joinRoomNames"),
    stand.functionSource("overlapNoteText"),
    stand.functionSource("overlapHatchDefs"),
    stand.functionSource("updateRoomLabelText"),
    ";({ renderRooms, updateRoomLabelText });"
  ].join("\n");
  const api = require("node:vm").runInContext(code, require("node:vm").createContext(ctx));
  return { api, canvas, svg };
}
const labelOf = (canvas, id) => canvas.children.find(e => e.dataset.id === id);

/* --- renderRooms: закраска области и красная строка --------------------------------------------- */

test("клин двух комнат: на холсте появляется .room-overlap, у обеих табличек красная строка", () => {
  const state = { rooms: [{ id: "p1", name: "Помещение 1", x: 0, y: 0, polygon: P1 },
    { id: "p3", name: "Помещение 3", x: 0, y: 0, polygon: P3old }], selected: null, tool: "select", pending: null, scale: 1 };
  const { api, canvas, svg } = runRooms(state);
  api.renderRooms();
  assert.equal(svg.children.filter(c => c.className === "room-overlap").length, 1, "одна закрашенная область наложения");
  assert.ok(svg.children.some(c => c.tag === "defs"), "подключён defs со штриховкой");
  assert.match(labelOf(canvas, "p1").innerHTML, /room-overlap-note">пересекается с «Помещение 3»</, "у П1 строка про П3");
  assert.match(labelOf(canvas, "p3").innerHTML, /room-overlap-note">пересекается с «Помещение 1»</, "у П3 строка про П1");
});

test("бесконтурная табличка внутри контурной: строка «внутри», закраски нет", () => {
  const P2 = [{ x: 250, y: 400 }, { x: 300, y: 100 }, { x: 850, y: 100 }, { x: 850, y: 400 }];
  const state = { rooms: [{ id: "p2", name: "Помещение 2", x: 0, y: 0, polygon: P2 },
    { id: "nw", name: "Новая комната", x: 420, y: 262 }], selected: null, tool: "select", pending: null, scale: 1 };
  // x+55=475, y+18=280 — seed бесконтурной таблички внутри П2
  const { api, canvas, svg } = runRooms(state);
  api.renderRooms();
  assert.equal(svg.children.filter(c => c.className === "room-overlap").length, 0, "у таблички без контура площади нет — закраски нет");
  assert.match(labelOf(canvas, "nw").innerHTML, /room-overlap-note">внутри «Помещение 2»</, "строка «внутри»");
});

test("проект без наложений: ни .room-overlap, ни строки, ни defs", () => {
  const state = { rooms: [{ id: "a", name: "A", x: 0, y: 0, polygon: rect(0, 0, 100, 100) },
    { id: "b", name: "B", x: 0, y: 0, polygon: rect(300, 300, 400, 400) }], selected: null, tool: "select", pending: null, scale: 1 };
  const { api, canvas, svg } = runRooms(state);
  api.renderRooms();
  assert.equal(svg.children.filter(c => c.className === "room-overlap").length, 0, "лишних узлов подсветки нет");
  assert.equal(svg.children.some(c => c.tag === "defs"), false, "defs без наложений не добавляется");
  assert.equal(labelOf(canvas, "a").innerHTML.includes("room-overlap-note"), false, "у таблички без наложения строки нет");
});

/* --- updateRoomLabelText: та же строка держится при точечном коммите имени ---------------------- */

test("коммит имени через updateRoomLabelText ДОБАВЛЯЕТ красную строку, если комната налезла", () => {
  const state = { rooms: [{ id: "p1", name: "Помещение 1", x: 0, y: 0, polygon: P1 },
    { id: "p3", name: "Помещение 3", x: 0, y: 0, polygon: P3old }], selected: null, tool: "select", pending: null, scale: 1 };
  const { api, canvas } = runRooms(state);
  // табличка, собранная без строки наложения (как будто налезание возникло после рендера)
  const el = makeEl("div"); el.className = "room-label"; el.dataset.id = "p1";
  const title = makeEl("span"); title.className = "room-title"; title.textContent = "Помещение 1"; el.appendChild(title);
  canvas.appendChild(el);
  api.updateRoomLabelText(state.rooms[0]);
  const note = el.querySelector(".room-overlap-note");
  assert.ok(note, "строка наложения добавлена на табличку");
  assert.equal(note.textContent, "пересекается с «Помещение 3»", "текст строки называет соседа");
});

test("коммит имени УБИРАЕТ устаревшую строку, если наложения больше нет", () => {
  const state = { rooms: [{ id: "a", name: "A", x: 0, y: 0, polygon: rect(0, 0, 100, 100) }], selected: null, tool: "select", pending: null, scale: 1 };
  const { api, canvas } = runRooms(state);
  const el = makeEl("div"); el.className = "room-label"; el.dataset.id = "a";
  const title = makeEl("span"); title.className = "room-title"; el.appendChild(title);
  const stale = makeEl("span"); stale.className = "room-overlap-note"; stale.textContent = "пересекается с «B»"; el.appendChild(stale);
  canvas.appendChild(el);
  api.updateRoomLabelText(state.rooms[0]);
  assert.equal(el.querySelector(".room-overlap-note"), null, "устаревшая строка удалена — наложения нет");
});
