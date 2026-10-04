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
const EPViewport = require("../js/viewport.js");
/* ВАЖНО (§7.1): clientToWorld НЕ копируем в тест — исполняем НАСТОЯЩИЙ view()+clientToWorld() из app.js
   вместе с canvasEventPoint/placePendingAtEvent из canvasInput.js в одном vm-контексте. Раньше тут жила
   рукописная копия формулы (makeClientToWorld), и она разошлась бы с продакшеном молча: ослабление
   настоящего clientToWorld не покраснело бы. Окно холста (.canvas-scroll) задаёт getBoundingClientRect;
   pan/масштаб/угол мира берутся из state через настоящий view(). */
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
  const canvasScroll = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  /* view+clientToWorld из app.js, canvasEventPoint+placePendingAtEvent из canvasInput.js — в одном vm:
     canvasEventPoint зовёт НАСТОЯЩИЙ clientToWorld (free-var-ссылка на соседнюю cut-функцию). */
  const fn = stand.run(["view", "clientToWorld", "canvasEventPoint", "placePendingAtEvent"], {
    state, canvasScroll, EPViewport, addPending: (x, y) => calls.push([x, y])
  });
  return { fn, calls };
}

test("placePendingAtEvent: пост встаёт в координаты клика с учётом масштаба", () => {
  const { fn, calls } = buildPlacer({ pending: { type: "post" }, scale: 2, panX: 0, panY: 0, worldAngle: 0 });
  fn(makeEvent({ clientX: 110, clientY: 220 }));
  // (110-10)/2 = 50, (220-20)/2 = 100 — та же формула, что у диспетчера клика
  assert.deepEqual(calls, [[50, 100]]);
});

test("placePendingAtEvent: нет режима размещения — addPending не зовётся", () => {
  const { fn, calls } = buildPlacer({ pending: null, scale: 1, panX: 0, panY: 0, worldAngle: 0 });
  fn(makeEvent());
  assert.deepEqual(calls, [], "без state.pending клик по табличке ничего не ставит");
});

/* --- диспетчер клика по холсту: маршрутизация ------------------------------------------------- */
/* Диспетчер — это ПРИСВАИВАНИЕ стрелки (canvasScroll.onclick=e=>…), а не function-декларация, поэтому
   stand.run его не вырежет. Берём текст из js/canvasInput.js от маркера `canvasScroll.onclick=` до парной
   `}` (пропуская строковые литералы, как constBlock в стенде) и исполняем ВМЕСТЕ с настоящими
   view()+clientToWorld() (app.js) и canvasEventPoint (canvasInput.js) в одном vm. МАРКЕР `canvasScroll` —
   это и проверка Б3-ч.2а «клик слушается на ОКНЕ холста»: верни регистрацию на #canvas (canvas.onclick=)
   — маркер не найдётся, и все тесты диспетчера покраснеют. */
function canvasOnclickSource() {
  const src = stand.sourceOf("canvasInput.js");
  const start = src.indexOf("canvasScroll.onclick=");
  assert.ok(start >= 0, "в js/canvasInput.js клик холста должен вешаться на canvasScroll (окно .canvas-scroll), а не на #canvas");
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
  const spies = { place: 0, scale: [], wall: 0, sel: [] };
  const canvasScroll = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  const canvas = {};   /* отдельный узел #canvas — только для сравнения e.target===canvas в диспетчере */
  const ctx = {
    state, canvas, canvasScroll, EPViewport,
    placePendingAtEvent: () => { spies.place++; },
    addScalePoint: (x, y) => spies.scale.push([x, y]),
    addWallPoint: () => { spies.wall++; }, addRoomLinePoint: () => {},
    tightestRoomAtPoint: () => null,
    selectEntity: (k, id) => spies.sel.push([k, id]),
    setTool: () => {}, renderAll: () => {}, renderProperties: () => {},
    markCanvasUsed: () => {}, uid: () => "id", renderSummary: () => {},
    toast: () => {}, removeEntity: () => {}, $: () => null
  };
  /* view/clientToWorld/canvasEventPoint — настоящие: подмена координатной строки в диспетчере на «мимо
     масштаба/угла» тогда разойдётся с ними и покраснеет в тесте масштаба ниже. */
  const code = stand.functionSource("view") + "\n" + stand.functionSource("clientToWorld") + "\n"
    + stand.functionSource("canvasEventPoint") + "\n" + canvasOnclickSource() + "\n;canvasScroll.onclick;";
  vm.createContext(ctx);
  return { onclick: vm.runInContext(code, ctx), spies, canvasScroll };
}

test("диспетчер: в режиме размещения клик по холсту ставит объект (placePendingAtEvent)", () => {
  const { onclick, spies } = buildCanvasClick({ pending: { type: "post" }, tool: "select", rooms: [], scale: 1, panX: 0, panY: 0, worldAngle: 0 });
  onclick(makeEvent());
  assert.equal(spies.place, 1, "в размещении клик по холсту обязан звать placePendingAtEvent");
  assert.equal(spies.sel.length, 0, "в размещении клик по холсту не выделяет комнату");
});

test("диспетчер: вне размещения placePendingAtEvent не зовётся", () => {
  const { onclick, spies } = buildCanvasClick({ pending: null, tool: "select", rooms: [], scale: 1, panX: 0, panY: 0, worldAngle: 0 });
  onclick(makeEvent());
  assert.equal(spies.place, 0, "без state.pending клик по холсту ничего не размещает");
});

test("диспетчер: координаты инструмента идут через canvasEventPoint (с учётом масштаба)", () => {
  const { onclick, spies } = buildCanvasClick({ pending: null, tool: "scale", rooms: [], scale: 2, panX: 0, panY: 0, worldAngle: 0 });
  onclick(makeEvent({ clientX: 110, clientY: 220 }));
  // (110-10)/2 = 50, (220-20)/2 = 100 — мимо масштаба в addScalePoint ушло бы 110,220
  assert.deepEqual(spies.scale, [[50, 100]]);
});

/* --- Б3, ч.2а / п.2: клик по ОКНУ холста вне коробки #canvas работает (цель — .canvas-scroll) ---- */
test("клик по серому фону окна (цель .canvas-scroll) в размещении ставит объект", () => {
  const { onclick, spies, canvasScroll } = buildCanvasClick({ pending: { type: "post" }, tool: "select", rooms: [], scale: 1, panX: 0, panY: 0, worldAngle: 0 });
  onclick(makeEvent({ target: canvasScroll }));
  assert.equal(spies.place, 1, "клик по окну вне #canvas в размещении обязан поставить объект");
});

test("клик по серому фону окна (цель .canvas-scroll) в режиме «Стены» добавляет точку стены", () => {
  const { onclick, spies, canvasScroll } = buildCanvasClick({ pending: null, tool: "wall", rooms: [], scale: 1, panX: 0, panY: 0, worldAngle: 0 });
  onclick(makeEvent({ target: canvasScroll }));
  assert.equal(spies.wall, 1, "клик по окну вне #canvas в режиме стен обязан добавить точку стены");
});

test("клик по серому фону окна (цель .canvas-scroll) в режиме выбора снимает выделение (пустое место)", () => {
  const state = { pending: null, tool: "select", rooms: [], scale: 1, panX: 0, panY: 0, worldAngle: 0, selected: { kind: "post", id: "x" } };
  const { onclick, spies, canvasScroll } = buildCanvasClick(state);
  onclick(makeEvent({ target: canvasScroll }));
  assert.equal(spies.sel.length, 0, "клик по пустому окну комнату не выделяет");
  assert.equal(state.selected, null, "клик по серому фону окна (.canvas-scroll) трактуется как пустое место и снимает выделение");
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

test("В11 — размещение: нажатие на иконку ПОСТА НЕ выделяет и НЕ гасит pending (ранний return для ЛЮБОГО kind)", () => {
  const spies = { ensure: 0 };
  const pending = { type: "post", templateId: "t" };
  const state = { pending, tool: "select", selected: null };
  const el = buildDraggable(state, spies, "post");
  el.fire("pointerdown", makeEvent());
  /* В11 (решение владельца 03.10): нажатие на уже стоящий пост в размещении его не трогает — пост в
     точку клика ставит click через canvas.onclick, а старый пост остаётся как был. beginPress обязан
     выйти ДО ensureSelectTool/выделения для ВСЕХ kind, не только "room". Вернёшь прежний
     `state.pending&&kind==="room"` — для поста снова сработает ensureSelectTool+выделение, и обе
     проверки ниже покраснеют. */
  assert.equal(spies.ensure, 0, "для поста в размещении ранний return срабатывает — ensureSelectTool не зовётся");
  assert.equal(state.pending, pending, "режим размещения на иконке поста не сбрасывается");
  assert.equal(state.selected, null, "нажатие на пост в размещении его НЕ выделяет (старый пост не трогаем)");
});

test("В11 — размещение + инструмент «Удалить»: нажатие на иконку поста его НЕ удаляет", () => {
  /* Самый опасный край: при tool==="delete" beginPress раньше звал removeEntity прямо на нажатии
     (потеря данных). Ранний `if(state.pending)return` стоит ВЫШE ветки delete — removeEntity не зовётся. */
  const spies = { ensure: 0, remove: [] };
  const state = { pending: { type: "post", templateId: "t" }, tool: "delete", selected: null };
  const el = makeDragEl();
  const md = stand.run("makeDraggable", {
    state, HAS_POINTER: true, spaceDown: false,
    ensureSelectTool: () => { spies.ensure++; state.pending = null; return false; },
    applySelectionClasses: () => {}, renderProperties: () => {},
    removeEntity: (k, id) => spies.remove.push([k, id]),
    document: { addEventListener: () => {} },
    trackDrag: () => () => {}
  });
  md(el, { id: "G1", x: 200, y: 50 }, "post");
  el.fire("pointerdown", makeEvent());
  assert.deepEqual(spies.remove, [], "в размещении удаляющий инструмент не стирает пост под курсором");
  assert.equal(spies.ensure, 0, "beginPress вышел до ветки delete и до ensureSelectTool");
});
