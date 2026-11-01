/* К13 ч.1: поведенческое покрытие УДАЛЕНИЯ ВЫДЕЛЕННОЙ ВЕРШИНЫ клавишей Delete (инструмент «Правка
   комнат», js/rooms.js). Слова заказчика 15.10 (0:24:46): «точку можно удалить? если делит нажимаю,
   вся комната удаляется?» — нет, удаляется только точка, комната остаётся. Владелец утвердил 01.11:
   «щёлкнул точку, нажал Delete — пропала только точка, комната осталась».

   ПОДХОД — тот же общий стенд, что в roomVertexEdit/roomVertexEditGuard (§7.1): rooms.js в node не
   грузится (IIFE+namespace), поэтому вырезаем ИСХОДНЫЙ ТЕКСТ настоящих функций правки (renderRooms +
   renderVertexHandles + dragVertex + selectVertex + deleteVertex + tryDeleteSelectedVertex) и исполняем
   их ВМЕСТЕ в одном vm-контексте с общей модульной переменной selectedVertex. Щелчок по ручке
   воспроизводим ровно как в браузере: onpointerdown (его повесил renderVertexHandles) без движения +
   pointerup — так selectVertex выделяет вершину, dragVertex по отпусканию её НЕ трогает. Затем зовём
   tryDeleteSelectedVertex (её в app.js зовёт обработчик Delete) и проверяем контур/наличие комнаты.

   МУТАЦИОННАЯ ТАБЛИЦА (прогнано руками, см. отчёт):
     • tryDeleteSelectedVertex всегда возвращает true (не зовёт deleteVertex) — краснеет «Delete по
       выделенной вершине убирает её из контура» (вершина не исчезает).
     • deleteVertex пропускает проверку ≤3 (splice без охраны) — краснеет «Delete у треугольника не
       опускает ниже трёх вершин».
     • deleteVertex пропускает проверку overlapGrew — краснеет «Delete вершины, заводящей в соседа,
       отклонён с тостом».
     • app.js: убрать `!tryDeleteSelectedVertex()` из условия Delete — краснеет структурный тест связки.

   Запуск: node --test tests/roomVertexDeleteKey.test.js */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const O = require("../js/roomOverlap.js");
const EPConfig = require("../js/config.js");
const { roomLabelPoint, roomNamePoint } = require("../js/geometry.js");
const EPViewport = require("../js/viewport.js");

const SVG_NS = "http://www.w3.org/2000/svg";
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

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

/* vm-контекст с настоящими функциями правки вершин и ОБЩЕЙ selectedVertex. EPRoomOverlap/EPConfig
   нужны ветке удаления рядом с соседом (overlapGuardFor их зовёт как window-глобалы). Масштаб 1,
   окно в (0,0) → экран==мир, координаты вершин совпадают с clientX/Y. */
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
    /* КАК В НАСТОЯЩЕМ app.js:1075–1077 — зовём переданный paint (renderRooms) и save (persistProject):
       без этого сброс selectedVertex после удаления вершины не воспроизводится, и дефект «второй Delete
       сносит комнату» (раунд 3) прошёл бы мимо теста. */
    refreshAfterRoomAssignments(paint, save) { spies.refreshAssign++; if (typeof paint === "function") paint(); if (typeof save === "function") save(); },
    updateStatus(m) { spies.status.push(m); },
    toast(m) { spies.toast.push(m); }
  };
  const code = [
    "let selectedVertex=null;",
    stand.functionSource("vertexSelectionValid"),
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
    stand.functionSource("deleteVertex"),
    stand.functionSource("selectVertex"),
    stand.functionSource("tryDeleteSelectedVertex"),
    stand.functionSource("renderVertexHandles"),
    stand.functionSource("dragVertex"),
    ";({ renderRooms, tryDeleteSelectedVertex });"
  ].join("\n");
  vm.createContext(ctx);
  const api = vm.runInContext(code, ctx);
  return { api, svg, doc, canvas, spies };
}
function makeState(over) {
  return Object.assign({ tool: "vertex", selected: null, scale: 1, rooms: [], pending: null }, over);
}
/* Отрисовать комнаты в режиме правки с выделенной edit; остальные комнаты (соседи) — в rooms. */
function setup(edit, others) {
  const rooms = [edit].concat(others || []);
  const state = makeState({ selected: { kind: "room", id: edit.id }, rooms, scale: 1 });
  const built = buildRooms(state);
  built.api.renderRooms();
  return Object.assign({ state, vhandles: built.svg.querySelectorAll(".vertex-handle") }, built);
}
/* Щелчок по ручке i без движения: onpointerdown + pointerup (dragVertex по отпусканию контур не
   трогает, вершина остаётся выделенной) — ровно как одиночный клик по вершине в браузере. */
function clickVertex(built, i, clientXY) {
  built.vhandles[i].onpointerdown(pointer(clientXY || {}));
  built.doc.fire("pointerup", pointer({}));
}
/* Событие click с подсчётом stopPropagation — так проверяем, гасит ли ручка всплытие к canvasScroll.onclick. */
function clickEv(over) {
  const e = { _sp: 0, stopPropagation() { e._sp++; }, preventDefault() {} };
  if (over) Object.assign(e, over);
  return e;
}
const last = arr => arr[arr.length - 1];
const highlighted = built => built.svg.querySelectorAll(".vertex-handle").filter(h => /\bselected\b/.test(h.attrs.class || ""));

const GAMMA = () => [
  { x: 300, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 160 },
  { x: 360, y: 160 }, { x: 360, y: 500 }, { x: 300, y: 500 }
];

/* --- Основной сценарий владельца: щелчок + Delete убирает ОДНУ вершину, комната остаётся ---------- */
test("Delete по выделенной вершине убирает её из контура, комната остаётся", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const built = setup(room);
  clickVertex(built, 1, { clientX: 700, clientY: 100 });   // выделяем вершину (700,100)
  const handled = built.api.tryDeleteSelectedVertex();
  assert.equal(handled, true, "Delete обработан вершиной — к удалению комнаты не переходим");
  assert.equal(room.polygon.length, 5, "в контуре осталось 5 вершин (одна удалена)");
  assert.equal(room.polygon.some(p => p.x === 700 && p.y === 100), false, "удалённой вершины (700,100) нет");
  assert.equal(built.state.rooms.includes(room), true, "комната на месте — удалилась только точка");
  assert.equal(room.edited, true, "удаление вершины делает комнату ручной");
  assert.match(last(built.spies.status), /осталось 5/, "статус сообщает остаток вершин");
});

/* --- Дефект приёмки 01.11: обычный клик (pointerdown+pointerup+click) НЕ должен терять выделение --- */
test("обычный клик по ручке переживает перерисовку: вершина остаётся выделенной, Delete убирает только её", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const built = setup(room);
  clickVertex(built, 1, { clientX: 700, clientY: 100 });   // pointerdown без движения + pointerup
  /* click по ручке НЕ всплывает к окну холста — иначе canvasScroll.onclick перевыбрал бы комнату и
     renderRooms снял бы выделение (ровно жалоба заказчика: удалялась ВСЯ комната). */
  const ce = clickEv();
  built.vhandles[1].onclick(ce);
  assert.ok(ce._sp > 0, "click по ручке гасится (вне размещения) — до canvasScroll.onclick не доходит");
  /* даже если перерисовка всё же случится (конец перетаскивания / перевыбор) — выделение её переживает */
  built.api.renderRooms();
  const handles = built.svg.querySelectorAll(".vertex-handle");
  assert.match(handles[1].attrs.class, /\bselected\b/, "после перерисовки ручка снова подсвечена — выделение сохранено");
  const handled = built.api.tryDeleteSelectedVertex();
  assert.equal(handled, true, "Delete обработан вершиной");
  assert.equal(room.polygon.length, 5, "удалена только одна вершина");
  assert.equal(room.polygon.some(p => p.x === 700 && p.y === 100), false, "удалённой вершины нет");
  assert.equal(built.state.rooms.includes(room), true, "комната осталась — не удалилась целиком");
});

/* --- В11: в размещении поста клик по ручке НЕ гасится (пост ставится через canvasScroll.onclick) --- */
test("в размещении клик по ручке не гасится — событие доходит до холста и ставит пост (В11)", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const state = makeState({ selected: { kind: "room", id: "r1" }, rooms: [room], scale: 1, pending: { type: "post", templateId: "t" } });
  const built = buildRooms(state);
  built.api.renderRooms();
  const h = built.svg.querySelectorAll(".vertex-handle")[0];
  const ce = clickEv();
  h.onclick(ce);
  assert.equal(ce._sp, 0, "в размещении click по ручке не гасится — всплывёт к холсту и поставит пост");
});

/* --- Раунд 3: ВТОРОЙ Delete подряд НЕ удаляет комнату (после удаления вершины selectedVertex сброшен) */
test("Delete дважды подряд: первый убирает вершину, второй в режиме правки НИЧЕГО не делает", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const built = setup(room);
  clickVertex(built, 1, { clientX: 700, clientY: 100 });
  assert.equal(built.api.tryDeleteSelectedVertex(), true, "первый Delete обработан вершиной");
  assert.equal(room.polygon.length, 5, "одна вершина удалена (6→5)");
  assert.equal(highlighted(built).length, 0, "после удаления выделение сброшено перерисовкой (как в app.js)");
  const second = built.api.tryDeleteSelectedVertex();   // имитируем второе нажатие Delete
  assert.equal(second, true, "второй Delete в режиме правки ОБРАБОТАН — к удалению комнаты не переходим");
  assert.equal(room.polygon.length, 5, "второй Delete вершину не трогает");
  assert.equal(built.state.rooms.includes(room), true, "комната на месте — Delete в режиме правки её не удаляет");
  assert.match(last(built.spies.status), /инструмент «Удалить»/, "подсказка про инструмент «Удалить»");
});

/* --- В режиме правки без выделенной вершины Delete ничего не делает (комнату не удаляет) --------- */
test("в режиме правки без выделенной вершины Delete комнату не удаляет (обработан, контур цел)", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const built = setup(room);   // отрисовали, ни одной вершины не щёлкали
  assert.equal(built.api.tryDeleteSelectedVertex(), true, "в режиме правки Delete всегда обработан (комнату не трогаем)");
  assert.equal(room.polygon.length, 6, "контур не тронут");
  assert.equal(built.state.rooms.includes(room), true, "комната на месте");
  assert.match(last(built.spies.status), /Щёлкните точку/, "подсказка, как удалить вершину/комнату");
});

/* --- Перерисовка снимает выделение (индекс устарел бы): смена числа вершин / смена комнаты -------- */
test("перерисовка после изменения числа вершин снимает подсветку выделения", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const built = setup(room);
  clickVertex(built, 1, { clientX: 700, clientY: 100 });
  room.polygon.push({ x: 310, y: 490 });   // число вершин 6→7, как при добавлении серединой ребра
  built.api.renderRooms();
  assert.equal(highlighted(built).length, 0, "после смены числа вершин ни одна ручка не подсвечена");
});
test("перерисовка после смены выделенной комнаты снимает подсветку вершины прежней комнаты", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA(), autoPolygon: true, edited: false };
  const other = { id: "r2", name: "Зал", polygon: rect(800, 800, 1000, 1000) };
  const built = setup(room, [other]);
  clickVertex(built, 1, { clientX: 700, clientY: 100 });
  built.state.selected = { kind: "room", id: "r2" };   // выбрали другую комнату
  built.api.renderRooms();
  assert.equal(room.polygon.length, 6, "контур прежней комнаты не тронут (вершина не удалена)");
});

/* --- В режиме «Выбор» Delete удаляет сущность как раньше (tryDeleteSelectedVertex=false) --------- */
test("в режиме «Выбор» tryDeleteSelectedVertex возвращает false — Delete удаляет выделенную сущность", () => {
  const room = { id: "r1", name: "Коридор", polygon: GAMMA() };
  const state = makeState({ tool: "select", selected: { kind: "room", id: "r1" }, rooms: [room], scale: 1 });
  const built = buildRooms(state);
  assert.equal(built.api.tryDeleteSelectedVertex(), false, "вне режима правки Delete идёт прежним путём (deleteSelectedEntity удалит комнату)");
});

/* --- Отказ при ≤3 вершинах: Delete обработан (true), но вершина и комната на месте ---------------- */
test("Delete не опускает контур ниже трёх вершин; комната не удаляется", () => {
  const room = { id: "r1", name: "Т", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], autoPolygon: true, edited: false };
  const built = setup(room);
  clickVertex(built, 0, { clientX: 0, clientY: 0 });
  const handled = built.api.tryDeleteSelectedVertex();
  assert.equal(handled, true, "вершина была выделена → Delete НЕ должен снести комнату");
  assert.equal(room.polygon.length, 3, "три вершины остались — удаление отклонено");
  assert.equal(room.edited, false, "заблокированное удаление не метит комнату ручной");
  assert.equal(built.state.rooms.includes(room), true, "комната на месте");
  assert.match(last(built.spies.toast), /не менее трёх/, "тост о минимуме вершин");
});

/* --- Отказ при заезде в соседа: Delete обработан (true), контур не тронут, тост с именем ---------- */
test("Delete вершины, снятие которой заводит контур в соседа, отклонён; комната остаётся", () => {
  const M = { id: "m", name: "Гостиная", polygon: rect(200, 0, 400, 400) };
  // вогнутая вершина (100,200): без неё прямая кромка (260,0)-(260,400) залезет в M
  const R = { id: "r", name: "Кухня", polygon: [{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 100, y: 200 }, { x: 260, y: 400 }, { x: 0, y: 400 }], autoPolygon: true, edited: false };
  const built = setup(R, [M]);
  clickVertex(built, 2, { clientX: 100, clientY: 200 });   // выделяем (100,200)
  const handled = built.api.tryDeleteSelectedVertex();
  assert.equal(handled, true, "вершина выделена → Delete перехвачен (комнату не трогаем)");
  assert.equal(R.polygon.length, 5, "вершина не удалена — контур заехал бы в соседа");
  assert.equal(R.edited, false, "заблокированное удаление не метит комнату ручной");
  assert.equal(built.state.rooms.includes(R), true, "комната на месте");
  assert.match(last(built.spies.toast), /Гостиная/, "тост называет соседнюю комнату");
});

/* --- Структурная связка в app.js: Delete гейтится e.repeat И tryDeleteSelectedVertex ------------- */
test("app.js: Delete игнорирует автоповтор и пробует удалить вершину перед deleteSelectedEntity", () => {
  /* e.repeat→return ВНУТРИ блока Delete (мутация «убрать e.repeat» краснит именно этот матч), затем
     гейт tryDeleteSelectedVertex перед deleteSelectedEntity. stand.SRC без комментариев — между строк \s*. */
  assert.match(
    stand.SRC,
    /e\.key==="Delete"&&!typing&&!inBuilder\)\{\s*if\(e\.repeat\)return;\s*if\(!tryDeleteSelectedVertex\(\)\)deleteSelectedEntity\(\)/,
    "блок Delete должен гасить автоповтор (e.repeat) и сначала пробовать удалить выделенную вершину"
  );
  assert.ok(
    /const\s*\{[^}]*tryDeleteSelectedVertex[^}]*\}\s*=\s*EPRooms\.attach/.test(stand.SRC),
    "tryDeleteSelectedVertex должен приходить из EPRooms.attach"
  );
});
