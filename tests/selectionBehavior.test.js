/* ПОВЕДЕНЧЕСКИЕ тесты группового выделения (Б5, ч.1): исполняем НАСТОЯЩИЙ текст функций app.js/
   canvasInput.js через общий стенд (tests/helpers/appStand.js), без копий продакшн-кода. Проверяем
   связки, которые чистый модуль EPSelection не покрывает: Ctrl+клик через makeDraggable, карточку
   группы в renderProperties, предикат в compactIcon, надпись «Выделено: N», рамку (applyRubberSelection)
   при повороте и гашение клика после рамки, безопасность стрелок/двойного клика при группе. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPSelection = require("../js/selection.js");
const EPViewport = require("../js/viewport.js");
const EPDrag = require("../js/drag.js");
const EPConfig = require("../js/config.js");

/* ---------- общие шимы ---------- */
function pointer(over) {
  return Object.assign({ isPrimary: true, button: 0, clientX: 0, clientY: 0, pointerId: 1,
    ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} }, over);
}
function makeNode() {
  const listeners = {};
  return {
    dataset: {}, style: {}, classList: stand.makeClassList(),
    addEventListener(t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
    removeEventListener(t, fn) { if (listeners[t]) listeners[t] = listeners[t].filter(f => f !== fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    fire(t, ev) { (listeners[t] || []).slice().forEach(fn => fn(ev)); }
  };
}
function makeDoc() {
  const listeners = {};
  return {
    body: { appendChild() {} },
    createElement: () => ({ className: "", style: {}, remove() {} }),
    addEventListener(t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
    removeEventListener(t, fn) { if (listeners[t]) listeners[t] = listeners[t].filter(f => f !== fn); },
    fire(t, ev) { (listeners[t] || []).slice().forEach(fn => fn(ev)); }
  };
}
/* Выделение создаётся ВНУТРИ vm-песочницы — у объекта прототип чужого realm, и deepStrictEqual
   спотыкается на нём. Снимаем в простой объект НАШЕГО realm и сравниваем по значению. */
function plain(s) { return !s ? s : (s.kind === "posts" ? { kind: "posts", ids: [...s.ids] } : { kind: s.kind, id: s.id }); }

/* ====================================================================================
   1. Ctrl+клик через makeDraggable: переключение члена набора, устройство игнорируется
   ==================================================================================== */
function buildDrag(state) {
  const spies = { renderProps: 0, applyCls: 0, save: 0 };
  const ctx = {
    HAS_POINTER: true, document: makeDoc(), EPDrag, EPConfig, EPSelection, state,
    spaceDown: false, setPanReady() {}, setRoomDropHighlight() {}, clearRoomDropHighlight() {},
    ensureSelectTool() { return false; },
    applySelectionClasses() { spies.applyCls++; }, renderProperties() { spies.renderProps++; },
    hideHover() {}, buildSpaceComponents() { return null; }, getRoomForPoint() { return null; },
    renderGroupLinks() {}, renderRooms() {}, renderSummary() {}, updateObjectRoom() { return null; },
    updateStatus() {}, scheduleSave() { spies.save++; }, beginGesture() {}, endGesture() {},
    refreshAfterRoomAssignments() {}, removeEntity() {}
  };
  const code = [stand.functionSource("trackDrag"), stand.functionSource("makeDraggable"),
    ";({ makeDraggable });"].join("\n");
  vm.createContext(ctx);
  return { api: vm.runInContext(code, ctx), spies };
}
const dragState = over => Object.assign(
  { pending: null, tool: "select", selected: null, scale: 1, worldAngle: 0, rooms: [],
    posts: [{ id: "p1", x: 0, y: 0 }, { id: "p2", x: 50, y: 0 }], devices: [{ id: "d1", x: 9, y: 9 }] }, over);

test("Ctrl+клик по посту ДОБАВЛЯЕТ его в набор и не начинает перенос", () => {
  const state = dragState({ selected: { kind: "post", id: "p1" } });
  const { api } = buildDrag(state);
  const el = makeNode();
  api.makeDraggable(el, state.posts[1], "post");
  el.fire("pointerdown", pointer({ ctrlKey: true, clientX: 60, clientY: 10 }));
  assert.deepEqual(plain(state.selected), { kind: "posts", ids: ["p1", "p2"] });
  /* перенос не начат: pointermove за порогом не двигает пост (обработчики жеста не навешаны) */
  el.fire("pointermove", pointer({ clientX: 200, clientY: 200 }));
  assert.equal(state.posts[1].x, 50, "Ctrl+клик не тащит пост");
});

test("Ctrl+клик не сохраняет проект → выделение не создаёт шага истории", () => {
  const state = dragState({ selected: { kind: "post", id: "p1" } });
  const { api, spies } = buildDrag(state);
  const el = makeNode();
  api.makeDraggable(el, state.posts[1], "post");
  el.fire("pointerdown", pointer({ ctrlKey: true, clientX: 60, clientY: 10 }));
  assert.equal(spies.save, 0, "смена выделения не зовёт scheduleSave (шаг истории пишется только из сейва)");
});

test("Ctrl+клик по уже выделенному посту УБИРАЕТ его из набора (схлопывание до одного)", () => {
  const state = dragState({ selected: { kind: "posts", ids: ["p1", "p2"] } });
  const { api } = buildDrag(state);
  const el = makeNode();
  api.makeDraggable(el, state.posts[1], "post");
  el.fire("pointerdown", pointer({ ctrlKey: true, clientX: 60, clientY: 10 }));
  assert.deepEqual(plain(state.selected), { kind: "post", id: "p1" });
});

test("Ctrl+клик по УСТРОЙСТВУ игнорируется: оно не входит в группу (обычный одиночный выбор)", () => {
  const state = dragState({ selected: { kind: "posts", ids: ["p1", "p2"] } });
  const { api } = buildDrag(state);
  const el = makeNode();
  api.makeDraggable(el, state.devices[0], "device");
  el.fire("pointerdown", pointer({ ctrlKey: true, clientX: 9, clientY: 9 }));
  assert.deepEqual(plain(state.selected), { kind: "device", id: "d1" }, "устройство выбрано одиночно, в группу не добавлено");
});

test("простой клик по члену группы сворачивает выделение до ОДНОГО этого поста", () => {
  const state = dragState({ selected: { kind: "posts", ids: ["p1", "p2"] } });
  const { api } = buildDrag(state);
  const el = makeNode();
  api.makeDraggable(el, state.posts[0], "post");
  el.fire("pointerdown", pointer({ clientX: 10, clientY: 10 }));   /* без Ctrl */
  el.fire("pointerup", pointer({ clientX: 10, clientY: 10 }));
  assert.deepEqual(plain(state.selected), { kind: "post", id: "p1" });
});

/* ====================================================================================
   2. compactIcon: член группы получает класс .selected
   ==================================================================================== */
function runIcon(state, entity, kind) {
  return stand.run("compactIcon", {
    state, document: stand.makeDocument(), EPSelection,
    EPRoomAssign: { isOutsideRooms: () => false },
    product: () => ({ icon: "?" }),
    showHover() {}, positionHover() {}, hideHover() {}, makeDraggable() {}
  })(entity, kind);
}
test("compactIcon: иконки членов группы получают .selected, посторонний пост — нет", () => {
  const state = { rooms: [], selected: { kind: "posts", ids: ["p1", "p2"] } };
  assert.ok(runIcon(state, { id: "p1", number: 1, x: 0, y: 0 }, "post").className.includes("selected"));
  assert.ok(runIcon(state, { id: "p2", number: 2, x: 0, y: 0 }, "post").className.includes("selected"));
  assert.ok(!runIcon(state, { id: "p3", number: 3, x: 0, y: 0 }, "post").className.includes("selected"));
});

/* ====================================================================================
   3. renderProperties: карточка группы; мёртвые id отсеиваются; выделение не сбрасывается
   ==================================================================================== */
function buildProps(state, props) {
  return stand.run("renderProperties", {
    state, props, EPSelection, esc: String, money: v => "m" + v,
    projectLighting: () => ({}), postTotalCost: () => 10,
    flushRoomDraft() {}, renderTemplates() {}, updateSelectionCount() {}, applySelectionClasses() {},
    findSelectedEntity() { return null; }
  });
}
test("renderProperties: группа постов → карточка «Выделено постов: N» + суммарная цена, без правки/удаления", () => {
  const state = { posts: [{ id: "p1" }, { id: "p2" }], selected: { kind: "posts", ids: ["p1", "p2"] } };
  const props = stand.makeElement();
  buildProps(state, props)();
  assert.match(props.innerHTML, /Выделено постов/);
  assert.match(props.innerHTML, /value="2"/);
  assert.match(props.innerHTML, /m20/, "суммарная стоимость = 10+10 через money");
  assert.ok(!/editSelected|removeSelected/.test(props.innerHTML), "в ч.1 ни «Редактировать», ни «Удалить»");
  assert.deepEqual(plain(state.selected), { kind: "posts", ids: ["p1", "p2"] }, "карточка не сбрасывает выделение группы");
});
test("renderProperties: все id группы мертвы → нормализация в null, пустая панель, без падения", () => {
  const state = { posts: [], selected: { kind: "posts", ids: ["zz", "yy"] } };
  const props = stand.makeElement();
  buildProps(state, props)();
  assert.equal(state.selected, null, "мёртвые id отсеяны, группа схлопнута в null");
  assert.match(props.innerHTML, /Выберите объект/);
});

/* ====================================================================================
   4. updateSelectionCount: «Выделено: N» виден при N≥2, скрыт при N<2
   ==================================================================================== */
function runCount(state) {
  const dom = stand.makeDom();
  stand.run("updateSelectionCount", { state, $: dom.$, EPSelection })();
  return dom.els.selectionCount;
}
test("updateSelectionCount: группа из 3 → «Выделено: 3» и видим", () => {
  const el = runCount({ selected: { kind: "posts", ids: ["a", "b", "c"] } });
  assert.equal(el.textContent, "Выделено: 3");
  assert.equal(el.hidden, false);
});
test("updateSelectionCount: один пост → пусто и скрыт (надпись не показывается при N=1)", () => {
  const el = runCount({ selected: { kind: "post", id: "a" } });
  assert.equal(el.textContent, "");
  assert.equal(el.hidden, true);
});

/* ====================================================================================
   5. Рамка выделения (canvasInput.js): applyRubberSelection при угле 90, гашение клика после рамки
   ==================================================================================== */
function buildRubber(over) {
  const spies = { applyCls: 0, renderProps: 0 };
  const captured = {};
  const canvasScroll = Object.assign(makeNode(), { getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  const dom = stand.makeDom();
  const ctx = Object.assign({
    EPSelection, EPViewport, EPDrag, EPConfig, document: makeDoc(),
    canvasScroll, canvas: makeNode(), $: dom.$,
    state: { tool: "select", pending: null, posts: [] },
    view: () => ({ panX: 0, panY: 0, scale: 1, angle: 90 }),
    hideHover() {},
    applySelectionClasses() { spies.applyCls++; }, renderProperties() { spies.renderProps++; },
    trackDrag(el, pid, onMove, onUp) { captured.onMove = onMove; captured.onUp = onUp; return () => { captured.stopped = true; }; },
    spaceDown: false, panMoved: false,
    rbStartX: 0, rbStartY: 0, rbLastX: 0, rbLastY: 0, rbMoved: false, rbEl: null, rbStop: null, rbSuppressClick: false
  }, over);
  const code = [
    stand.functionSource("beginRubberBand"), stand.functionSource("rubberMove"),
    stand.functionSource("rubberUp"), stand.functionSource("applyRubberSelection"),
    stand.functionSource("suppressSyntheticClick"),
    ";({ beginRubberBand, rubberMove, rubberUp, applyRubberSelection, suppressSyntheticClick });"
  ].join("\n");
  vm.createContext(ctx);
  return { api: vm.runInContext(code, ctx), ctx, canvasScroll, captured, spies };
}

test("рамка при угле мира 90°: выделяет посты, чьи ЭКРАННЫЕ центры попали в рамку", () => {
  /* при 90°,scale1,pan0: центр (x+12,y+12) → экран (-(y+12), x+12).
     a(0,0)→(-12,12), b(100,0)→(-12,112), c(0,100)→(-112,12). Рамка {-30..0}×{0..200} берёт a,b. */
  const r = buildRubber();
  r.ctx.state.posts = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }, { id: "c", x: 0, y: 100 }];
  r.ctx.rbStartX = -30; r.ctx.rbStartY = 0; r.ctx.rbLastX = 0; r.ctx.rbLastY = 200; r.ctx.rbMoved = true;
  r.api.applyRubberSelection();
  assert.deepEqual(plain(r.ctx.state.selected), { kind: "posts", ids: ["a", "b"] });
});

test("полный жест рамки: протяжка выделяет и ВЗВОДИТ гашение клика; суммарный click не сбрасывает выделение", () => {
  const r = buildRubber();
  r.ctx.state.posts = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }];
  r.api.beginRubberBand(pointer({ target: r.canvasScroll, clientX: -30, clientY: 0 }));
  r.captured.onMove(0, 200);     /* за порогом — рисуем рамку */
  r.captured.onUp();             /* отпускание — применяем выделение */
  assert.deepEqual(plain(r.ctx.state.selected), { kind: "posts", ids: ["a", "b"] });
  assert.equal(r.ctx.rbSuppressClick, true, "после протяжки следующий click взведён на гашение");
  /* синтетический click после рамки гасится — ветка пустого места до него не доходит */
  const ev = { _sp: 0, _pd: 0, stopPropagation() { this._sp++; }, preventDefault() { this._pd++; } };
  r.api.suppressSyntheticClick(ev);
  assert.equal(ev._sp, 1, "click после рамки погашен (иначе сбросил бы выделение)");
});

test("простой клик по пустому (без протяжки) НЕ гасится: обычный сброс выделения работает", () => {
  const r = buildRubber();
  r.api.beginRubberBand(pointer({ target: r.canvasScroll, clientX: 5, clientY: 5 }));
  r.captured.onMove(6, 5);       /* в пределах порога — рамки нет */
  r.captured.onUp();
  assert.equal(r.ctx.rbSuppressClick, false, "клик без протяжки не взводит гашение");
  const ev = { _sp: 0, stopPropagation() { this._sp++; }, preventDefault() {} };
  r.api.suppressSyntheticClick(ev);
  assert.equal(ev._sp, 0, "простой клик по пустому проходит (снимет выделение как раньше)");
});

test("рамка не стартует вне инструмента «Выбор» и по непустой цели", () => {
  const r1 = buildRubber({ state: { tool: "wall", pending: null, posts: [] } });
  r1.api.beginRubberBand(pointer({ target: r1.canvasScroll }));
  assert.equal(r1.captured.onMove, undefined, "в инструменте «Стены» рамка не начинается");
  const r2 = buildRubber();
  r2.api.beginRubberBand(pointer({ target: makeNode() }));   /* цель — не пустое место */
  assert.equal(r2.captured.onMove, undefined, "по непустой цели рамка не начинается");
});

/* ====================================================================================
   6. Безопасность при группе: стрелки (moveSelectedBy) не двигают и не падают
   ==================================================================================== */
test("moveSelectedBy при группе постов возвращает false и ничего не меняет (стрелки — но-оп)", () => {
  const state = { selected: { kind: "posts", ids: ["p1", "p2"] }, posts: [{ id: "p1", x: 0, y: 0 }], devices: [], rooms: [] };
  const move = stand.run("moveSelectedBy", {
    state, updateObjectRoom() {}, renderRooms() {}, renderProperties() {}, renderSummary() {},
    scheduleSave() {}, refreshAfterRoomAssignments() {}, findEntityNode() { return null; }
  });
  assert.equal(move(5, 0), false);
  assert.equal(state.posts[0].x, 0, "пост не сдвинут");
});

/* ====================================================================================
   7. Ctrl+двойной клик по посту НЕ открывает окно поста
   ==================================================================================== */
test("renderPosts: Ctrl(⌘)+двойной клик по иконке поста не зовёт openPostOnDblClick, обычный — зовёт", () => {
  const opened = [];
  const appended = [];
  const canvas = { querySelectorAll: () => [], appendChild: el => appended.push(el) };
  stand.run(["compactIcon", "renderPosts"], {
    state: { posts: [{ id: "p1", number: 1, x: 0, y: 0 }], rooms: [], selected: null },
    document: stand.makeDocument(), EPSelection, canvas,
    EPRoomAssign: { isOutsideRooms: () => false },
    product: () => ({ icon: "?" }), showHover() {}, positionHover() {}, hideHover() {}, makeDraggable() {},
    openPostOnDblClick: id => opened.push(id)
  })();
  const el = appended[0];
  el.ondblclick({ ctrlKey: true, stopPropagation() {} });
  assert.deepEqual(opened, [], "Ctrl+двойной клик окно не открывает");
  el.ondblclick({ ctrlKey: false, metaKey: false, stopPropagation() {} });
  assert.deepEqual(opened, ["p1"], "обычный двойной клик открывает пост");
});
