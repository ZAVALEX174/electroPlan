/* В11 (решение владельца 03.10): нажата «Разместить» — клик по плану ставит пост туда, куда
   кликнули (у самой стены, на линии разметки, рядом с другим постом), КАКОЙ БЫ ИНСТРУМЕНТ ни был
   выбран. Ни стена, ни линия, ни другой пост при этом не удаляются и не выделяются.

   Правило одно (§7.1): «клик в размещении → пост в точку клика» живёт в canvas.onclick →
   placePendingAtEvent (его поведение сторожит roomLabelPlacePending.test.js). Здесь проверяем КРАЯ:
   перехватчики клика на холсте (hit-линия стены, hit-линия разметки, иконка поста/элемента) в режиме
   размещения ОБЯЗАНЫ пропустить событие к canvas.onclick — то есть НЕ звать своё действие
   (removeWall/selectWall/removeRoomLine) и НЕ гасить всплытие (stopPropagation), чтобы единое правило
   отработало. Вне размещения перехватчики ведут себя как раньше (это и проверяем вторым случаем —
   иначе ранний return можно было бы «починить» заглушив ветку целиком).

   ПОДХОД — общий стенд §7.1: вырезаем ИСХОДНЫЙ ТЕКСТ настоящих drawWalls/drawRoomLines/compactIcon и
   исполняем в vm на DOM-шиме; onclick берём с НАСТОЯЩЕГО узла, что повесила функция, и дёргаем его. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

/* Клик-событие: счётчик stopPropagation (его зовут перехватчики вне размещения; в размещении зваться
   НЕ должен — тогда событие всплывёт к canvas.onclick) + координаты (для placePendingAtEvent). */
function clickEvent(over) {
  return Object.assign({ clientX: 50, clientY: 60, _sp: 0, stopPropagation() { this._sp++; } }, over || {});
}

/* Узел как из createElement(NS): setAttribute/style/classList/onclick-слот. Дети у svg собираем в
   appended — по ним находим hit-линию (её style.pointerEvents==="stroke"). */
function makeNode() {
  return {
    dataset: {}, style: {}, classList: stand.makeClassList(),
    onclick: null, onpointerdown: null, onmouseenter: null, onmousemove: null, onmouseleave: null,
    textContent: "", className: "",
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { return c; }   /* svgTitle вешает <title> на ручку вершины — узлу нужен appendChild */
  };
}
function makeSvg() {
  const svg = makeNode();
  svg.appended = [];
  Object.defineProperty(svg, "innerHTML", { get() { return ""; }, set(v) { if (v === "") svg.appended = []; } });
  svg.appendChild = n => { svg.appended.push(n); return n; };
  return svg;
}
function makeDoc() {
  return { createElement: () => makeNode(), createElementNS: () => makeNode() };
}
/* hit-линия = прозрачная линия с pointer-events:stroke (её вешают drawWalls/drawRoomLines). */
const hitOf = svg => svg.appended.find(n => n.style.pointerEvents === "stroke");

/* ----------------------------- Стена: drawWalls (app.js) --------------------------------------- */
function runWalls(state) {
  const spies = { removeWall: [], selectWall: [] };
  const svg = makeSvg();
  const draw = stand.run("drawWalls", {
    state,
    $: id => (id === "wallsSvg" ? svg : makeNode()),
    document: makeDoc(),
    removeWall: id => spies.removeWall.push(id),
    selectWall: id => spies.selectWall.push(id)
  });
  draw();
  return { svg, spies };
}
function wallState(over) {
  return Object.assign({ tool: "delete", pending: null, selected: null,
    autoWalls: [], walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, auto: false }] }, over || {});
}

test("стена: размещение + «Удалить» — клик по стене НЕ удаляет её и пропускает событие к холсту", () => {
  const { svg, spies } = runWalls(wallState({ tool: "delete", pending: { type: "post", templateId: "t" } }));
  const e = clickEvent();
  hitOf(svg).onclick(e);
  assert.deepEqual(spies.removeWall, [], "стену в размещении не удаляем (потеря данных)");
  assert.equal(e._sp, 0, "событие не гасится — всплывёт к canvas.onclick, тот поставит пост");
});

test("стена: размещение + «Выбор» — клик по стене НЕ выделяет её и пропускает событие к холсту", () => {
  const { svg, spies } = runWalls(wallState({ tool: "select", pending: { type: "post", templateId: "t" } }));
  const e = clickEvent();
  hitOf(svg).onclick(e);
  assert.deepEqual(spies.selectWall, [], "стену в размещении не выделяем");
  assert.equal(e._sp, 0, "событие не гасится — всплывёт к canvas.onclick");
});

test("стена: ВНЕ размещения «Удалить» по-прежнему удаляет, «Выбор» выделяет (ветка не заглушена)", () => {
  const del = runWalls(wallState({ tool: "delete", pending: null }));
  const ed = clickEvent(); hitOf(del.svg).onclick(ed);
  assert.deepEqual(del.spies.removeWall, ["w1"], "вне размещения удаляющий инструмент стену удаляет");
  assert.equal(ed._sp, 1, "вне размещения клик по стене гасится (не доходит до canvas.onclick)");
  const sel = runWalls(wallState({ tool: "select", pending: null }));
  const es = clickEvent(); hitOf(sel.svg).onclick(es);
  assert.deepEqual(sel.spies.selectWall, ["w1"], "вне размещения «Выбор» стену выделяет");
});

/* ----------------------- Линия разметки: drawRoomLines (roomDetect.js) ------------------------- */
function runRoomLines(state) {
  const spies = { removeRoomLine: [] };
  const svg = makeSvg();
  const draw = stand.run("drawRoomLines", {
    state, SVG_NS: "http://www.w3.org/2000/svg",
    $: id => (id === "markupSvg" ? svg : makeNode()),
    document: makeDoc(),
    removeRoomLine: id => spies.removeRoomLine.push(id)
  });
  draw();
  return { svg, spies };
}
function lineState(over) {
  return Object.assign({ tool: "delete", pending: null,
    roomLines: [{ id: "rl1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }] }, over || {});
}

test("линия разметки: размещение + «Удалить» — клик по линии НЕ удаляет её и пропускает событие к холсту", () => {
  const { svg, spies } = runRoomLines(lineState({ pending: { type: "post", templateId: "t" } }));
  const e = clickEvent();
  hitOf(svg).onclick(e);
  assert.deepEqual(spies.removeRoomLine, [], "линию разметки в размещении не удаляем (потеря данных)");
  assert.equal(e._sp, 0, "событие не гасится — всплывёт к canvas.onclick, тот поставит пост на линии");
});

test("линия разметки: ВНЕ размещения «Удалить» по-прежнему удаляет линию (ветка не заглушена)", () => {
  const { svg, spies } = runRoomLines(lineState({ pending: null }));
  const e = clickEvent();
  hitOf(svg).onclick(e);
  assert.deepEqual(spies.removeRoomLine, ["rl1"], "вне размещения удаляющий инструмент линию удаляет");
  assert.equal(e._sp, 1, "вне размещения клик по линии гасится (не доходит до canvas.onclick)");
});

/* ----------------------------- Иконка поста: compactIcon (app.js) ------------------------------ */
function runIcon(state) {
  const el = stand.run("compactIcon", {
    state,
    document: makeDoc(),
    EPRoomAssign: { isOutsideRooms: () => false },
    product: () => ({ icon: "?" }),
    showHover() {}, positionHover() {}, hideHover() {},
    makeDraggable() {}
  })({ id: "p1", number: 1, x: 10, y: 20, roomId: "r1" }, "post");
  return el;
}

test("иконка поста: в размещении клик по ней НЕ гасит всплытие — событие уходит к canvas.onclick (новый пост)", () => {
  const el = runIcon({ pending: { type: "post", templateId: "t" }, selected: null, rooms: [{ id: "r1" }] });
  const e = clickEvent();
  el.onclick(e);
  assert.equal(e._sp, 0, "в размещении клик по иконке пропускается к canvas.onclick — старый пост не трогаем");
});

test("иконка поста: ВНЕ размещения клик по ней гасится (не доходит до canvas.onclick, двойной постановки нет)", () => {
  const el = runIcon({ pending: null, selected: null, rooms: [{ id: "r1" }] });
  const e = clickEvent();
  el.onclick(e);
  assert.equal(e._sp, 1, "вне размещения клик по иконке по-прежнему гасится");
});

/* ------------------ Вершины комнаты: renderVertexHandles (rooms.js, «Правка комнат») ----------- */
/* Ручки вершин висят на onpointerdown. В размещении нажатие на ручку НЕ должно править контур (добавить/
   удалить/двигать вершину — потеря данных): выходим РАНО, не гася событие, чтобы click всплыл к
   canvas.onclick. Вне размещения правка работает как раньше. */
function runVertex(state) {
  const spies = { edited: [], refresh: 0, drag: [] };
  const svg = makeSvg();
  const api = stand.run(["svgTitle", "renderVertexHandles"], {
    state, SVG_NS: "http://www.w3.org/2000/svg", document: makeDoc(),
    markRoomEdited: r => spies.edited.push(r.id),
    refreshRoomAfterEdit: () => spies.refresh++,
    dragVertex: (r, i) => spies.drag.push(i),
    updateStatus() {}, toast() {}
  });
  const room = { id: "r1", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
  api(svg, room);
  /* порядок вставки renderVertexHandles: сперва N середин рёбер, затем N ручек вершин */
  const n = room.polygon.length;
  return { spies, room, mid: svg.appended[0], handle: svg.appended[n] };
}

test("вершины: размещение — нажатие на СЕРЕДИНУ ребра НЕ добавляет вершину и пропускает событие к холсту", () => {
  const { spies, room, mid } = runVertex({ pending: { type: "post", templateId: "t" } });
  const e = Object.assign(clickEvent(), { preventDefault() {} });
  mid.onpointerdown(e);
  assert.equal(room.polygon.length, 3, "в размещении вершина не добавляется (контур не трогаем)");
  assert.deepEqual(spies.edited, [], "комната не помечается правленой");
  assert.equal(e._sp, 0, "событие не гасится — всплывёт к canvas.onclick и поставит пост");
});

test("вершины: размещение — нажатие на РУЧКУ вершины не двигает/не удаляет её и пропускает событие к холсту", () => {
  const { spies, room, handle } = runVertex({ pending: { type: "post", templateId: "t" } });
  const e = Object.assign(clickEvent(), { altKey: true, preventDefault() {} });
  handle.onpointerdown(e);
  assert.equal(room.polygon.length, 3, "в размещении Alt+клик вершину не удаляет");
  assert.deepEqual(spies.drag, [], "в размещении перетаскивание вершины не начинается");
  assert.equal(e._sp, 0, "событие не гасится — всплывёт к canvas.onclick");
});

test("вершины: ВНЕ размещения правка контура работает (середина добавляет, ручка начинает перенос)", () => {
  const add = runVertex({ pending: null });
  add.mid.onpointerdown(Object.assign(clickEvent(), { preventDefault() {} }));
  assert.equal(add.room.polygon.length, 4, "вне размещения середина ребра добавляет вершину");
  assert.deepEqual(add.spies.edited, ["r1"], "добавление помечает комнату правленой");
  const drag = runVertex({ pending: null });
  drag.handle.onpointerdown(Object.assign(clickEvent(), { altKey: false, preventDefault() {} }));
  assert.deepEqual(drag.spies.drag, [0], "вне размещения нажатие на ручку начинает перенос вершины");
});
