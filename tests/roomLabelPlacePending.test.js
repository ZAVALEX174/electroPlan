/* В1: в режиме размещения (state.pending) клик прямо по табличке комнаты обязан поставить пост
   в точку клика — тем же правилом, что клик по пустому месту (placePendingAtEvent → addPending),
   а не «съедаться» подписью. Вне размещения табличка ведёт себя как раньше: выделяет комнату
   (контурная — своим onclick; без контура — через makeDraggable/beginPress).

   ИДЕЯ (общий стенд §7.1): app.js — монолит-оркестратор, в node не грузится. Вырезаем ИСХОДНЫЙ
   ТЕКСТ проверяемых функций и исполняем в vm-контексте с DOM-шимами. Правило placePendingAtEvent
   проверяем отдельно (расчёт координат + addPending), а renderRooms/makeDraggable — что они К НЕМУ
   ПОДКЛЮЧЕНЫ (wiring): стенд не заводит второй копии правила, а исполняет настоящий код. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

function makeEvent(over) {
  return Object.assign(
    { isPrimary: true, button: 0, clientX: 100, clientY: 60, pointerId: 1, _pd: 0, _sp: 0,
      preventDefault() { this._pd++; }, stopPropagation() { this._sp++; } },
    over
  );
}

/* --- placePendingAtEvent: единое правило «клик в размещении → addPending в точку клика» -------- */
function buildPlacer(state) {
  const calls = [];
  const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  const fn = stand.run(["canvasEventPoint", "placePendingAtEvent"], {
    state, canvas, addPending: (x, y) => calls.push([x, y])
  });
  return { fn, calls };
}

test("placePendingAtEvent: пост встаёт в координаты клика с учётом масштаба", () => {
  const { fn, calls } = buildPlacer({ pending: { type: "post" }, scale: 2 });
  fn(makeEvent({ clientX: 110, clientY: 220 }));
  // (110-10)/2 = 50, (220-20)/2 = 100 — та же формула, что у canvas.onclick
  assert.deepEqual(calls, [[50, 100]]);
});

test("placePendingAtEvent: нет режима размещения — addPending не зовётся", () => {
  const { fn, calls } = buildPlacer({ pending: null, scale: 1 });
  fn(makeEvent());
  assert.deepEqual(calls, [], "без state.pending клик по табличке ничего не ставит");
});

/* --- canvas.onclick: маршрутизация клика по холсту -------------------------------------------- */
/* canvas.onclick — это ПРИСВАИВАНИЕ стрелки (canvas.onclick=e=>…), а не function-декларация, поэтому
   stand.run его не вырежет. Берём текст из stand.SRC от маркера `canvas.onclick=` до парной `}`
   (пропуская строковые литералы, как constBlock в стенде) и исполняем ВМЕСТЕ с настоящим
   canvasEventPoint в vm — так проверяем и ветку размещения, и что координаты идут через масштаб. */
function canvasOnclickSource() {
  const src = stand.SRC;
  const start = src.indexOf("canvas.onclick=");
  assert.ok(start >= 0, "в app.js должно быть присваивание canvas.onclick");
  let depth = 0, quote = null, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote && src[i - 1] !== "\\") quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { i++; break; }
  }
  if (src[i] === ";") i++;
  return src.slice(start, i);
}

function buildCanvasClick(state) {
  const spies = { place: 0, scale: [], sel: [] };
  const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  const ctx = {
    state, canvas,
    placePendingAtEvent: () => { spies.place++; },
    addScalePoint: (x, y) => spies.scale.push([x, y]),
    addWallPoint: () => {}, addRoomLinePoint: () => {},
    pointInPolygon: () => false,
    selectEntity: (k, id) => spies.sel.push([k, id]),
    setTool: () => {}, renderAll: () => {}, renderProperties: () => {},
    markCanvasUsed: () => {}, uid: () => "id", renderSummary: () => {},
    toast: () => {}, removeEntity: () => {}, $: () => null
  };
  /* canvasEventPoint берём настоящий: подмена координатной строки в onclick на «мимо масштаба»
     тогда разойдётся с ним и покраснеет в тесте масштаба ниже. */
  const code = stand.functionSource("canvasEventPoint") + "\n" + canvasOnclickSource() + "\n;canvas.onclick;";
  vm.createContext(ctx);
  return { onclick: vm.runInContext(code, ctx), spies };
}

test("canvas.onclick: в режиме размещения клик по холсту ставит объект (placePendingAtEvent)", () => {
  const { onclick, spies } = buildCanvasClick({ pending: { type: "post" }, tool: "select", rooms: [], scale: 1 });
  onclick(makeEvent());
  assert.equal(spies.place, 1, "в размещении клик по холсту обязан звать placePendingAtEvent");
  assert.equal(spies.sel.length, 0, "в размещении клик по холсту не выделяет комнату");
});

test("canvas.onclick: вне размещения placePendingAtEvent не зовётся", () => {
  const { onclick, spies } = buildCanvasClick({ pending: null, tool: "select", rooms: [], scale: 1 });
  onclick(makeEvent());
  assert.equal(spies.place, 0, "без state.pending клик по холсту ничего не размещает");
});

test("canvas.onclick: координаты инструмента идут через canvasEventPoint (с учётом масштаба)", () => {
  const { onclick, spies } = buildCanvasClick({ pending: null, tool: "scale", rooms: [], scale: 2 });
  onclick(makeEvent({ clientX: 110, clientY: 220 }));
  // (110-10)/2 = 50, (220-20)/2 = 100 — мимо масштаба в addScalePoint ушло бы 110,220
  assert.deepEqual(spies.scale, [[50, 100]]);
});

/* --- renderRooms: обработчики подписей подключены к placePendingAtEvent ------------------------ */
function renderLabels() {
  const state = {
    rooms: [
      { id: "P1", name: "Зал", x: 10, y: 10,
        polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] },
      { id: "G1", name: "Кухня", x: 200, y: 50 }   // без polygon → комната без контура
    ],
    selected: null, tool: "select", pending: null, scale: 1
  };
  const appended = [];
  const canvas = { querySelectorAll: () => [], appendChild: el => appended.push(el) };
  const spies = { place: [], sel: [], rm: [] };
  const render = stand.run("renderRooms", {
    state, canvas,
    $: () => null,                                   // roomsSvg отсутствует → svg-ветку контура пропускаем
    document: { createElement: () => stand.makeElement() },
    esc: String,
    getObjectsInRoom: () => [],
    roomDisplayArea: () => "",
    selectEntity: (k, id) => spies.sel.push([k, id]),
    removeEntity: (k, id) => spies.rm.push([k, id]),
    placePendingAtEvent: e => spies.place.push(e),
    makeDraggable: () => {}                           // beginPress проверяем отдельным тестом
  });
  render();
  return {
    state, spies,
    poly: appended.find(el => el.dataset.id === "P1"),
    grid: appended.find(el => el.dataset.id === "G1")
  };
}

test("размещение + табличка С контуром: ставит пост через placePendingAtEvent, комнату не выделяет", () => {
  const r = renderLabels();
  r.state.pending = { type: "post", templateId: "t" };
  const e = makeEvent();
  r.poly.onclick(e);
  assert.equal(r.spies.place.length, 1, "клик по контурной табличке в размещении обязан звать placePendingAtEvent");
  assert.equal(r.spies.sel.length, 0, "в размещении клик по табличке не выделяет комнату");
  assert.equal(e._sp, 1, "клик по подписи не всплывает к canvas.onclick (иначе двойная постановка)");
});

test("размещение + табличка БЕЗ контура: ставит пост через placePendingAtEvent", () => {
  const r = renderLabels();
  r.state.pending = { type: "post", templateId: "t" };
  const e = makeEvent();
  r.grid.onclick(e);
  assert.equal(r.spies.place.length, 1, "клик по табличке комнаты без контура в размещении обязан звать placePendingAtEvent");
  assert.equal(e._sp, 1, "клик по подписи не всплывает к canvas.onclick");
});

test("вне размещения: клик по контурной табличке по-прежнему выделяет комнату", () => {
  const r = renderLabels();
  r.state.pending = null;
  r.poly.onclick(makeEvent());
  assert.deepEqual(r.spies.sel, [["room", "P1"]], "обычный режим — выделение комнаты сохраняется");
  assert.equal(r.spies.place.length, 0, "без размещения placePendingAtEvent не зовётся");
});

/* --- makeDraggable/beginPress: комната без контура выделяется, а в размещении не гасит pending -- */
function makeDragEl() {
  const handlers = {};
  return {
    dataset: {}, classList: stand.makeClassList(),
    addEventListener: (type, fn) => { handlers[type] = fn; },
    fire: (type, e) => handlers[type] && handlers[type](e)
  };
}

function buildDraggable(state, spies, kind) {
  const el = makeDragEl();
  const md = stand.run("makeDraggable", {
    state, HAS_POINTER: true, spaceDown: false,
    /* Заглушка ведёт себя как настоящий ensureSelectTool при инструменте ≠ select: гасит pending.
       Иначе проверка «pending не сброшен» была бы пустой — заглушка его в любом случае не трогала бы,
       и снятие раннего return в beginPress осталось бы незамеченным. */
    ensureSelectTool: () => { spies.ensure++; state.pending = null; return false; },
    applySelectionClasses: () => {}, renderProperties: () => {},
    removeEntity: () => {},
    document: { addEventListener: () => {} },
    trackDrag: () => () => {}
  });
  md(el, { id: "G1", x: 200, y: 50 }, kind || "room");
  return el;
}

test("вне размещения: нажатие на табличку без контура выделяет комнату (makeDraggable/beginPress)", () => {
  const spies = { ensure: 0 };
  const state = { pending: null, tool: "select", selected: null };
  const el = buildDraggable(state, spies);
  el.fire("pointerdown", makeEvent());
  /* state.selected рождается в vm-контексте (чужой Object.prototype) — deepStrictEqual бракует его
     по прототипу, хотя поля равны. Разворачиваем в обычный объект тест-реалма: проверка полная
     (лишние ключи всё равно всплывут), но без придирки к прототипу. */
  assert.deepEqual({ ...state.selected }, { kind: "room", id: "G1" }, "обычный режим — жест выделяет комнату");
  assert.equal(spies.ensure, 1, "beginPress проходит к ensureSelectTool вне размещения");
});

test("размещение: нажатие на табличку без контура НЕ гасит state.pending и не выделяет", () => {
  const spies = { ensure: 0 };
  const pending = { type: "post", templateId: "t" };
  const state = { pending, tool: "select", selected: null };
  const el = buildDraggable(state, spies);
  el.fire("pointerdown", makeEvent());
  assert.equal(state.pending, pending, "beginPress не должен сбрасывать режим размещения на табличке комнаты");
  assert.equal(state.selected, null, "в размещении жест по табличке комнату не выделяет");
  assert.equal(spies.ensure, 0, "ensureSelectTool (сбрасывающий pending) не вызывается в размещении");
});

test("размещение: нажатие на иконку ПОСТА идёт обычным путём (ранний return только для комнаты)", () => {
  const spies = { ensure: 0 };
  const state = { pending: { type: "post", templateId: "t" }, tool: "select", selected: null };
  const el = buildDraggable(state, spies, "post");
  el.fire("pointerdown", makeEvent());
  /* Ранний return в beginPress ограничен kind==="room". Для поста нажатие в размещении ведёт себя
     как в HEAD: ensureSelectTool + выделение. Мутация state.pending&&kind==="room" → state.pending
     заставила бы beginPress выйти и на посте — тогда обе проверки ниже покраснеют. */
  assert.equal(spies.ensure, 1, "для поста ранний return не срабатывает — ensureSelectTool вызывается");
  assert.deepEqual({ ...state.selected }, { kind: "post", id: "G1" }, "нажатие на пост в размещении выделяет пост");
});
