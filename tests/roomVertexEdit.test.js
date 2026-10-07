/* З8: поведенческое покрытие ПРАВКИ ВЕРШИН КОНТУРА комнаты (инструмент «Правка комнат», js/rooms.js).
   До сих пор НИ ОДИН тест не ИСПОЛНЯЛ функции правки вершин фабрики EPRooms.attach
   (renderVertexHandles/dragVertex/markRoomEdited/refreshRoomAfterEdit/svgTitle): мутация «dragVertex
   не помечает комнату edited» (M6, mut-i1d.json) не краснела — поломку правки можно было внести молча.
   Здесь дыра закрывается.

   ПОДХОД (общий стенд §7.1). rooms.js в node не грузится (IIFE + window-namespace). Вырезаем ИСХОДНЫЙ
   ТЕКСТ настоящих функций (renderRooms + вся правка вершин) и исполняем их ВМЕСТЕ в одном vm-контексте:
   так renderRooms изнутри зовёт НАСТОЯЩИЙ renderVertexHandles, тот — НАСТОЯЩИЙ dragVertex, а
   refreshRoomAfterEdit считает якорь/seed НАСТОЯЩИМИ roomLabelPoint/roomNamePoint из geometry.js
   (второй копии правила геометрии не заводим). Точка входа — renderRooms в режиме "vertex" на
   ВЫДЕЛЕННОЙ комнате: это единственный, кто создаёт полигон и вешает ручки, ровно как в браузере.

   Шим SVG/узла реально доставляет pointerdown в обработчик ручки (его повесил renderVertexHandles на
   .onpointerdown), а шим document — pointermove/pointerup в обработчики, которые dragVertex повесил на
   document. Так тест идёт по тому же пути событий, что и браузер. Масштаб берём ≠1 (scale=2), иначе
   деление на масштаб в переносе не отличить от его отсутствия. roomAreaM2/formatArea/esc и привязки
   постов — заглушки-шпионы: это зависимости app.js, не часть правки вершин под тестом. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const { roomLabelPoint, roomNamePoint, pointInPolygon } = require("../js/geometry.js");
const EPViewport = require("../js/viewport.js");

const SVG_NS = "http://www.w3.org/2000/svg";

/* Г-образная (вогнутая) комната из задания: у неё якорь таблички может лечь ВНЕ контура, а seed
   обязан остаться внутри — на ней проверяем пересчёт подписи после правки. Свежий массив на каждый
   тест: правка мутирует полигон на месте. */
const GAMMA = () => [
  { x: 300, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 160 },
  { x: 360, y: 160 }, { x: 360, y: 500 }, { x: 300, y: 500 }
];

/* Указательное событие: поля, что читают onpointerdown-обработчик и move (altKey — ветка удаления,
   clientX/Y — позиция, preventDefault/stopPropagation обработчики зовут). */
function pointer(over) {
  return Object.assign(
    { altKey: false, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} },
    over
  );
}

function classesOf(node) {
  const attrClass = node.attrs && node.attrs.class ? node.attrs.class : "";
  return ((node.className || "") + " " + attrClass).split(/\s+/).filter(Boolean);
}

/* Разбирает РОВНО те селекторы, что зовут функции rooms.js: `.vertex-handle`, `.vertex-mid`,
   `.room-label`, `polygon[data-room-id="…"]`. Честно сверяет тег, класс и data-атрибут — подмена
   имени класса или места вставки увела бы поиск в пустоту, ровно как в браузере. */
function matchSel(node, sel) {
  const tagM = sel.match(/^([a-zA-Z][\w-]*)/);
  if (tagM && node.tag !== tagM[1]) return false;
  const clsM = sel.match(/\.([\w-]+)/);
  if (clsM && !classesOf(node).includes(clsM[1])) return false;
  const attrM = sel.match(/\[data-([\w-]+)\s*=\s*"([^"]*)"\]/);
  if (attrM) {
    const prop = attrM[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // data-room-id → roomId
    if (String(node.dataset[prop]) !== attrM[2]) return false;
  }
  return true;
}

/* Узел как из createElement(NS): setAttribute/appendChild/querySelector* поверх массива детей;
   innerHTML="" очищает детей (так renderRooms сбрасывает слой ручек перед перерисовкой). */
function makeEl(tag) {
  const el = {
    tag: tag || "", attrs: {}, dataset: {}, style: {}, children: [],
    className: "", textContent: "", value: "", _html: "", _parent: null,
    onpointerdown: null, onclick: null,
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

/* document-шим: createElement(NS) отдаёт свежий узел; на нём же копятся pointermove/pointerup,
   которые вешает dragVertex, и fire их доставляет — как addEventListener + dispatchEvent.
   removeEventListener честно снимает слушателя: после отпускания повторное движение уже не пройдёт. */
function makeDoc() {
  const listeners = {};
  return {
    createElement: t => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn); },
    fire(type, ev) { (listeners[type] || []).slice().forEach(fn => fn(ev)); }
  };
}

/* Готовит vm-контекст с настоящими renderRooms + функциями правки вершин. Зависимости вне темы
   правки (площадь для статуса, привязка постов, перерисовка) — тихие заглушки-шпионы; ключевое
   (геометрия якоря/seed, масштаб, ветвление alt/минимум вершин) остаётся настоящим. */
function buildRooms(state) {
  const spies = { status: [], toast: [], persist: 0, refreshAssign: 0 };
  const doc = makeDoc();
  const svg = makeEl("svg");
  const canvas = makeEl("div");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const ctx = {
    document: doc, SVG_NS, canvas, state,
    $: id => (id === "roomsSvg" ? svg : makeEl("div")),
    esc: String,
    /* clientToWorld — то же правило, что в app.js (Б3 ч.2а): окно холста в тесте в (0,0), pan=0,
       поэтому экран→мир через НАСТОЯЩИЙ EPViewport.screenToWorld с масштабом и углом мира из state.
       При scale≠1 деление на масштаб сохраняется, при worldAngle≠0 работает обратная матрица. */
    clientToWorld: (cx, cy) => EPViewport.screenToWorld({ x: cx, y: cy },
      { panX: 0, panY: 0, scale: state.scale, angle: state.worldAngle || 0 }),
    roomLabelPoint, roomNamePoint,                         // НАСТОЯЩАЯ геометрия из js/geometry.js
    roomAreaM2: () => 0,                                    // площадь — лишь текст статуса, зависимость app.js
    formatArea: v => String(v),
    getObjectsInRoom: () => [],
    roomDisplayArea: () => "",
    placePendingAtEvent() {}, selectEntity() {}, removeEntity() {}, makeDraggable() {},
    /* Б4 п.3: перетаскивание вершины помечает жест (шаг фиксируется на отпускании). История тут не
       под тестом — тихие заглушки, чтобы dragVertex нашёл их в контексте. */
    beginGesture() {}, endGesture() {},
    persistProject() { spies.persist++; },
    refreshAfterRoomAssignments() { spies.refreshAssign++; },   // перерисовку app.js в тесте не гоняем
    updateStatus(m) { spies.status.push(m); },
    toast(m) { spies.toast.push(m); }
  };
  const code = [
    stand.functionSource("renderRooms"),
    stand.functionSource("svgTitle"),
    stand.functionSource("markRoomEdited"),
    stand.functionSource("refreshRoomAfterEdit"),
    stand.functionSource("renderVertexHandles"),
    stand.functionSource("dragVertex"),
    ";({ renderRooms, renderVertexHandles, dragVertex });"
  ].join("\n");
  vm.createContext(ctx);
  const api = vm.runInContext(code, ctx);
  return { api, svg, doc, canvas, spies };
}

function makeState(over) {
  return Object.assign({ tool: "vertex", selected: null, scale: 1, rooms: [], pending: null }, over);
}

/* Отрендерить комнату в режиме правки (tool=vertex + она выделена) и вернуть комнату вместе с
   ручками, которые создал НАСТОЯЩИЙ renderVertexHandles — по ним же их найдёт dragVertex. */
function setup(scale) {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const state = makeState({ selected: { kind: "room", id: "r1" }, rooms: [room], scale: scale || 1 });
  const built = buildRooms(state);
  built.api.renderRooms();
  return Object.assign({
    room, state,
    vhandles: built.svg.querySelectorAll(".vertex-handle"),
    mids: built.svg.querySelectorAll(".vertex-mid")
  }, built);
}

const last = arr => arr[arr.length - 1];

/* --- Перенос вершины с учётом масштаба (dragVertex.move) --------------------------------------- */
test("перетаскивание ручки вершины переносит её на экранную дельту делённую на масштаб", () => {
  const { room, vhandles, doc } = setup(2);
  /* вершина №1 (700,100); rect={0,0}, scale=2 → мировые = экранные/2. Старт кладём на её текущую
     экранную позицию (1400,200), затем ведём в (1480,240). */
  vhandles[1].onpointerdown(pointer({ clientX: 1400, clientY: 200 }));
  doc.fire("pointermove", pointer({ clientX: 1480, clientY: 240 }));
  doc.fire("pointerup", pointer({}));
  assert.equal(room.polygon[1].x, 740, "экранный X 1480 / масштаб 2 = 740");
  assert.equal(room.polygon[1].y, 120, "экранный Y 240 / масштаб 2 = 120");
  /* остальные вершины перенос не трогает */
  assert.equal(room.polygon[0].x, 300, "соседняя вершина осталась на месте по X");
  assert.equal(room.polygon[0].y, 100, "соседняя вершина осталась на месте по Y");
});

/* --- Б3, ч.2а: правка вершины при ПОВЁРНУТОМ виде садится под курсор, не мимо ------------------ */
test("перетаскивание вершины при угле мира 90° кладёт её в обратно-повёрнутую мировую точку", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const state = makeState({ selected: { kind: "room", id: "r1" }, rooms: [room], scale: 1, worldAngle: 90 });
  const built = buildRooms(state);
  built.api.renderRooms();
  const vhandles = built.svg.querySelectorAll(".vertex-handle");
  /* окно холста в (0,0), pan=0, scale=1, угол 90°: экран→мир = R(−90)·(x,y) = (y, −x).
     Ведём курсор в экранную (740,120) → мир (120, −740). */
  vhandles[1].onpointerdown(pointer({ clientX: 700, clientY: 100 }));
  built.doc.fire("pointermove", pointer({ clientX: 740, clientY: 120 }));
  built.doc.fire("pointerup", pointer({}));
  assert.ok(Math.abs(room.polygon[1].x - 120) < 1e-6, "world X = экранный Y (R(−90))");
  assert.ok(Math.abs(room.polygon[1].y - (-740)) < 1e-6, "world Y = −экранный X (R(−90))");
});

/* --- Пометка «ручной» комнаты после отпускания (dragVertex.up → markRoomEdited) ---------------- */
test("после отпускания вершины комната помечена ручной (edited=true, autoPolygon=false)", () => {
  const { room, vhandles, doc } = setup(1);
  vhandles[0].onpointerdown(pointer({ clientX: 300, clientY: 100 }));
  doc.fire("pointermove", pointer({ clientX: 320, clientY: 130 }));
  doc.fire("pointerup", pointer({}));
  assert.equal(room.edited, true, "правка вершины делает комнату ручной — переживёт авто-определение");
  assert.equal(room.autoPolygon, false, "autoPolygon снят: авто-определение её больше не перезапишет");
});

/* --- Пересчёт подписи и seed после правки (dragVertex.up → refreshRoomAfterEdit) --------------- */
test("после правки якорь таблички и seed пересчитаны, seed вогнутой комнаты — ВНУТРИ контура", () => {
  const { room, vhandles, doc } = setup(1);
  vhandles[1].onpointerdown(pointer({ clientX: 700, clientY: 100 }));
  doc.fire("pointermove", pointer({ clientX: 740, clientY: 120 }));   // (700,100) → (740,120)
  doc.fire("pointerup", pointer({}));
  const nm = roomNamePoint(room.polygon), c = roomLabelPoint(room.polygon);
  assert.equal(room.seedX, nm.x, "seedX пересчитан через roomNamePoint по НОВОМУ контуру");
  assert.equal(room.seedY, nm.y, "seedY пересчитан через roomNamePoint");
  assert.equal(room.x, c.x - 45, "якорь таблички — roomLabelPoint со сдвигом −45 по X");
  assert.equal(room.y, c.y - 16, "якорь таблички — roomLabelPoint со сдвигом −16 по Y");
  assert.equal(pointInPolygon(room.seedX, room.seedY, room.polygon), true,
    "seed (привязка постов) лежит ВНУТРИ вогнутого контура");
});

/* --- Добавление вершины ручкой середины ребра (renderVertexHandles → mid.onpointerdown) -------- */
test("ручка середины ребра добавляет вершину МЕЖДУ его концами (в правильное место контура)", () => {
  const { room, mids, spies } = setup(1);
  /* ребро №2: (700,160)→(360,160), середина (530,160). mids[i] отвечает за ребро poly[i]→poly[i+1]. */
  mids[2].onpointerdown(pointer({}));
  assert.equal(room.polygon.length, 7, "вершин стало 7");
  /* середина ребра вставлена ПОСЛЕ его начала (index i+1) — не в начало массива и не в конец */
  assert.equal(room.polygon[3].x, 530, "новая вершина на index i+1: X = середина ребра");
  assert.equal(room.polygon[3].y, 160, "новая вершина на index i+1: Y = середина ребра");
  assert.equal(room.polygon[2].x, 700, "начало ребра осталось на своём месте (X)");
  assert.equal(room.polygon[2].y, 160, "начало ребра осталось на своём месте (Y)");
  assert.equal(room.polygon[4].x, 360, "конец ребра сдвинулся на index+1, порядок обхода сохранён (X)");
  assert.equal(room.polygon[4].y, 160, "конец ребра сдвинулся на index+1, порядок обхода сохранён (Y)");
  assert.equal(room.edited, true, "добавление вершины делает комнату ручной");
  assert.equal(room.autoPolygon, false, "autoPolygon снят");
  assert.match(last(spies.status), /всего 7/, "статус сообщает новое число вершин");
});

/* --- Удаление вершины (renderVertexHandles → h.onpointerdown, Alt) ----------------------------- */
test("Alt+клик по ручке вершины удаляет её из контура", () => {
  const { room, vhandles, spies } = setup(1);
  vhandles[4].onpointerdown(pointer({ altKey: true }));   // вершина №4 = (360,500)
  assert.equal(room.polygon.length, 5, "вершин стало 5");
  assert.equal(room.polygon.some(p => p.x === 360 && p.y === 500), false, "удалённой вершины (360,500) в контуре нет");
  assert.equal(room.edited, true, "удаление вершины делает комнату ручной");
  assert.match(last(spies.status), /осталось 5/, "статус сообщает остаток вершин");
});

/* --- Защита минимума: контур не опустить ниже трёх вершин -------------------------------------- */
test("Alt+клик не опускает контур ниже трёх вершин (защита минимума)", () => {
  const room = { id: "r1", name: "Т", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], autoPolygon: true, edited: false };
  const state = makeState({ selected: { kind: "room", id: "r1" }, rooms: [room], scale: 1 });
  const built = buildRooms(state);
  built.api.renderRooms();
  built.svg.querySelectorAll(".vertex-handle")[0].onpointerdown(pointer({ altKey: true }));
  assert.equal(room.polygon.length, 3, "три вершины удаление не трогает");
  assert.equal(room.edited, false, "заблокированное удаление НЕ помечает комнату ручной");
  assert.match(last(built.spies.toast), /не менее трёх/, "показан тост о минимуме вершин");
});
