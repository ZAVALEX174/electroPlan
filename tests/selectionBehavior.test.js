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
    /* canvas нужен групповой ветке beginPress (ищет узлы прочих членов по data-id); в тестах секции 1
       перенос группы не проверяется — узлы не важны, querySelector возвращает null (член без узла). */
    canvas: { querySelector() { return null; } },
    spaceDown: false, setPanReady() {}, setRoomDropHighlight() {}, clearRoomDropHighlight() {}, applyDropHighlight() {},
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
function buildProps(state, props, spies) {
  const dom = stand.makeDom();
  dom.els.props = props;
  return {
    render: stand.run("renderProperties", {
      state, props, EPSelection, esc: String, money: v => "m" + v, $: dom.$,
      projectLighting: () => ({}), postTotalCost: () => 10,
      flushRoomDraft() {}, renderTemplates() {}, updateSelectionCount() {}, applySelectionClasses() {},
      findSelectedEntity() { return null; },
      /* removePosts зовётся только из onclick кнопки — спай фиксирует, что кнопка на него провязана */
      removePosts(ids) { if (spies) spies.removed = ids; }
    }),
    dom
  };
}
test("renderProperties: группа постов → карточка «Выделено постов: N» + суммарная цена + «Удалить выделенные (N)» (Б5 ч.2)", () => {
  const state = { posts: [{ id: "p1" }, { id: "p2" }], selected: { kind: "posts", ids: ["p1", "p2"] } };
  const props = stand.makeElement();
  const spies = {};
  const { render, dom } = buildProps(state, props, spies);
  render();
  assert.match(props.innerHTML, /Выделено постов/);
  assert.match(props.innerHTML, /value="2"/);
  assert.match(props.innerHTML, /m20/, "суммарная стоимость = 10+10 через money");
  assert.ok(!/editSelected/.test(props.innerHTML), "«Редактировать» у группы нет (правка набора разом смысла не имеет)");
  assert.match(props.innerHTML, /Удалить выделенные \(2\)/, "Б5 ч.2: кнопка удаления набора с числом");
  /* кнопка провязана на removePosts с тем же составом, что показан (та же функция, что и Delete) */
  dom.$("removeSelectedPosts").onclick();
  assert.deepEqual(spies.removed, ["p1", "p2"], "кнопка карточки зовёт removePosts с id набора");
  assert.deepEqual(plain(state.selected), { kind: "posts", ids: ["p1", "p2"] }, "карточка не сбрасывает выделение группы");
});
test("renderProperties: все id группы мертвы → нормализация в null, пустая панель, без падения", () => {
  const state = { posts: [], selected: { kind: "posts", ids: ["zz", "yy"] } };
  const props = stand.makeElement();
  buildProps(state, props).render();
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
   6. Сдвиг ГРУППЫ постов стрелками (moveSelectedBy, Б5 ч.2): все на одну мировую дельту,
      пересчёт привязки — через единую точку контракта refreshAfterRoomAssignments
   ==================================================================================== */
function buildGroupMove(state, spies) {
  return stand.run("moveSelectedBy", {
    state, updateObjectRoom() {}, renderRooms() { if (spies) spies.renderRooms++; },
    renderProperties() {}, renderSummary() {}, scheduleSave() { if (spies) spies.save++; },
    /* ядро контракта заглушено спаем: тест ловит, что сдвиг группы идёт ИМЕННО через него
       (а не мимо — иначе roomId не пересчитался бы) и зовёт его РОВНО один раз на сдвиг */
    refreshAfterRoomAssignments(paint, save) { if (spies) spies.refresh++; if (paint) paint(); if (save) save(); },
    findEntityNode() { return null; }
  });
}
test("moveSelectedBy при группе сдвигает ВСЕ выделенные посты на одну дельту и возвращает true", () => {
  const state = { selected: { kind: "posts", ids: ["p1", "p2"] },
    posts: [{ id: "p1", x: 0, y: 0 }, { id: "p2", x: 50, y: 20 }, { id: "p3", x: 100, y: 100 }], devices: [], rooms: [] };
  const spies = { refresh: 0, renderRooms: 0, save: 0 };
  assert.equal(buildGroupMove(state, spies)(5, -3), true);
  assert.deepEqual([state.posts[0].x, state.posts[0].y], [5, -3], "p1 сдвинут на (5,-3)");
  assert.deepEqual([state.posts[1].x, state.posts[1].y], [55, 17], "p2 сдвинут на ту же дельту");
  assert.deepEqual([state.posts[2].x, state.posts[2].y], [100, 100], "p3 вне группы — не сдвинут");
  assert.equal(spies.refresh, 1, "привязка к комнатам пересчитана ОДИН раз через контракт (roomId перешедших границу обновится)");
});
test("moveSelectedBy при группе, где все id мертвы, возвращает false и контракт не зовёт", () => {
  const state = { selected: { kind: "posts", ids: ["zz", "yy"] }, posts: [{ id: "p1", x: 0, y: 0 }], devices: [], rooms: [] };
  const spies = { refresh: 0, renderRooms: 0, save: 0 };
  assert.equal(buildGroupMove(state, spies)(5, 0), false);
  assert.equal(state.posts[0].x, 0, "посторонний пост не тронут");
  assert.equal(spies.refresh, 0, "нечего двигать — контракт не зовётся");
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

/* ====================================================================================
   8. Перетаскивание ВЫДЕЛЕННОЙ ГРУППЫ постов мышью (makeDraggable, Б5 ч.3). Исполняем настоящий
      текст trackDrag+makeDraggable: нажатие на член группы не сворачивает её, протяжка за порог
      двигает ВСЕХ на одну мировую дельту, отпускание пересчитывает привязку ОДНОЙ точкой контракта
      (один шаг истории), клик без переноса сворачивает до одного поста, Esc возвращает всех.
   ==================================================================================== */
/* Узел иконки поста: как makeNode, но с готовым dataset.id — его ищет canvas.querySelector по data-id
   (ведущего makeDraggable держит сам, остальных членов группы находит через canvas). */
function iconNode(id) { const n = makeNode(); n.dataset.id = String(id); return n; }
function buildGroupDrag(state, nodes) {
  const spies = { refresh: 0, save: 0, renderProps: 0, renderRooms: 0, drop: [] };
  /* canvas.querySelector('.plan-icon[data-id="X"]') → узел X (или null). Разбираем только data-id —
     этого хватает makeDraggable для членов группы. */
  const canvas = {
    querySelector(sel) { const m = sel.match(/data-id="([^"]*)"/); return (m && nodes[m[1]]) || null; }
  };
  const ctx = {
    HAS_POINTER: true, document: makeDoc(), EPDrag, EPConfig, EPSelection, state, canvas,
    spaceDown: false, setPanReady() {},
    setRoomDropHighlight() {}, clearRoomDropHighlight() {}, applyDropHighlight(ids) { spies.drop.push([...(ids || [])]); },
    ensureSelectTool() { return false; },
    applySelectionClasses() {}, renderProperties() { spies.renderProps++; },
    hideHover() {}, buildSpaceComponents() { return null; },
    /* комната центра поста по X: x<100 → r1, иначе r2 (граница на x=100) — проверяем пересчёт у перешедших */
    getRoomForPoint(x) { return { id: x < 100 ? "r1" : "r2" }; },
    renderGroupLinks() {}, renderRooms() { spies.renderRooms++; }, renderSummary() {},
    updateObjectRoom() { return null; }, updateStatus() {},
    scheduleSave() { spies.save++; }, beginGesture() {}, endGesture() {},
    refreshAfterRoomAssignments(paint, save) { spies.refresh++; if (paint) paint(); if (save) save(); },
    removeEntity() {}
  };
  const code = [stand.functionSource("trackDrag"), stand.functionSource("makeDraggable"),
    ";({ makeDraggable });"].join("\n");
  vm.createContext(ctx);
  return { api: vm.runInContext(code, ctx), spies, nodes };
}
/* Состояние с группой из p1,p2 (оба в r1, x<100) и посторонним p3. worldAngle/scale задаются сверху. */
function groupState(over) {
  return Object.assign(
    { pending: null, tool: "select", scale: 1, worldAngle: 0, rooms: [],
      selected: { kind: "posts", ids: ["p1", "p2"] },
      posts: [{ id: "p1", x: 0, y: 0 }, { id: "p2", x: 40, y: 10 }, { id: "p3", x: 200, y: 200 }] }, over);
}
/* Нажать на member по его узлу и протянуть на (sxpx,sypx) экранных пикселей за порог. */
function dragMember(api, nodes, memberId, state, dxScreen, dyScreen) {
  const el = nodes[memberId];
  const obj = state.posts.find(p => String(p.id) === String(memberId));
  api.makeDraggable(el, obj, "post");
  el.fire("pointerdown", pointer({ clientX: 500, clientY: 500 }));
  el.fire("pointermove", pointer({ clientX: 500 + dxScreen, clientY: 500 + dyScreen }));
  return el;
}

test("группа: протяжка члена двигает ВСЕХ на одну мировую дельту (угол 0), p3 вне группы не тронут", () => {
  const state = groupState();
  const nodes = { p1: iconNode("p1"), p2: iconNode("p2"), p3: iconNode("p3") };
  const { api } = buildGroupDrag(state, nodes);
  const el = dragMember(api, nodes, "p1", state, 60, 42);   // scale 1, угол 0 → мировая дельта (+60,+42)
  el.fire("pointerup", pointer({ clientX: 560, clientY: 542 }));
  assert.deepEqual([state.posts[0].x, state.posts[0].y], [60, 42], "ведущий p1 сдвинут на (60,42)");
  assert.deepEqual([state.posts[1].x, state.posts[1].y], [100, 52], "p2 сдвинут на ту же дельту");
  assert.deepEqual([state.posts[2].x, state.posts[2].y], [200, 200], "p3 вне группы не сдвинут");
  assert.equal(nodes.p2.style.left, "100px", "узел p2 сдвинут точечно (style.left)");
});

test("группа: протяжка при scale=2 и угле 90° — экранные (+60,+42) → мировые (+21,−30) всем членам", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9, `${a} ≈ ${b}`);
  const state = groupState({ scale: 2, worldAngle: 90 });
  const nodes = { p1: iconNode("p1"), p2: iconNode("p2"), p3: iconNode("p3") };
  const { api } = buildGroupDrag(state, nodes);
  const el = dragMember(api, nodes, "p2", state, 60, 42);   // тянем НЕ ведущего набора — едут всё равно все
  el.fire("pointerup", pointer({ clientX: 560, clientY: 542 }));
  /* R(−90)/scale2: dx=(dxs*c+dys*sn)/2=42/2=21, dy=(−dxs*sn+dys*c)/2=−60/2=−30 */
  near(state.posts[0].x, 21); near(state.posts[0].y, -30);   // p1 от базы (0,0)
  near(state.posts[1].x, 61); near(state.posts[1].y, -20);   // p2 от базы (40,10)
  assert.deepEqual([state.posts[2].x, state.posts[2].y], [200, 200], "p3 не тронут");
});

test("группа: отпускание зовёт контракт refreshAfterRoomAssignments РОВНО один раз и один scheduleSave (один шаг истории)", () => {
  const state = groupState();
  const nodes = { p1: iconNode("p1"), p2: iconNode("p2"), p3: iconNode("p3") };
  const { api, spies } = buildGroupDrag(state, nodes);
  const el = dragMember(api, nodes, "p1", state, 120, 0);   // p1 (0,0)→(120,0) пересёк границу x=100 в r2
  el.fire("pointerup", pointer({ clientX: 620, clientY: 500 }));
  assert.equal(spies.refresh, 1, "привязка пересчитана ОДИН раз через контракт (roomId перешедших сменится)");
  assert.equal(spies.save, 1, "ровно один scheduleSave → один шаг истории");
  assert.deepEqual(plain(state.selected), { kind: "posts", ids: ["p1", "p2"] }, "группа осталась выделенной");
});

test("группа: нажатие на члена НЕ сворачивает группу; клик без переноса сворачивает до одного поста", () => {
  const state = groupState();
  const nodes = { p1: iconNode("p1"), p2: iconNode("p2"), p3: iconNode("p3") };
  const { api } = buildGroupDrag(state, nodes);
  const el = nodes.p1;
  api.makeDraggable(el, state.posts[0], "post");
  el.fire("pointerdown", pointer({ clientX: 500, clientY: 500 }));
  assert.deepEqual(plain(state.selected), { kind: "posts", ids: ["p1", "p2"] }, "на нажатии группа цела");
  el.fire("pointermove", pointer({ clientX: 502, clientY: 500 }));   // Δ=2px < порог → клик
  el.fire("pointerup", pointer({ clientX: 502, clientY: 500 }));
  assert.deepEqual(plain(state.selected), { kind: "post", id: "p1" }, "клик без переноса → выделен только p1");
  assert.deepEqual([state.posts[1].x, state.posts[1].y], [40, 10], "p2 не двигался");
});

test("группа: Esc посреди переноса возвращает ВСЕХ членов и шага истории нет", () => {
  const state = groupState();
  const nodes = { p1: iconNode("p1"), p2: iconNode("p2"), p3: iconNode("p3") };
  /* нужен доступ к document-шиму (обработчик Esc навешан на него, capture) — собираем ctx тут */
  const doc = makeDoc();
  const canvas = { querySelector(sel) { const m = sel.match(/data-id="([^"]*)"/); return (m && nodes[m[1]]) || null; } };
  const spies = { save: 0 };
  const ctx = {
    HAS_POINTER: true, document: doc, EPDrag, EPConfig, EPSelection, state, canvas,
    spaceDown: false, setPanReady() {}, setRoomDropHighlight() {}, clearRoomDropHighlight() {}, applyDropHighlight() {},
    ensureSelectTool() { return false; }, applySelectionClasses() {}, renderProperties() {}, hideHover() {},
    buildSpaceComponents() { return null; }, getRoomForPoint() { return null; }, renderGroupLinks() {},
    renderRooms() {}, renderSummary() {}, updateObjectRoom() { return null; }, updateStatus() {},
    scheduleSave() { spies.save++; }, beginGesture() {}, endGesture() {},
    refreshAfterRoomAssignments() { spies.save++; }, removeEntity() {}
  };
  const code = [stand.functionSource("trackDrag"), stand.functionSource("makeDraggable"), ";({ makeDraggable });"].join("\n");
  vm.createContext(ctx);
  const api = vm.runInContext(code, ctx);
  const el = nodes.p1;
  api.makeDraggable(el, state.posts[0], "post");
  el.fire("pointerdown", pointer({ clientX: 500, clientY: 500 }));
  el.fire("pointermove", pointer({ clientX: 570, clientY: 570 }));   // перенос пошёл
  assert.deepEqual([state.posts[0].x, state.posts[0].y], [70, 70], "предусловие: p1 поехал");
  assert.deepEqual([state.posts[1].x, state.posts[1].y], [110, 80], "предусловие: p2 тоже поехал");
  doc.fire("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual([state.posts[0].x, state.posts[0].y], [0, 0], "Esc вернул p1 в исходную точку");
  assert.deepEqual([state.posts[1].x, state.posts[1].y], [40, 10], "Esc вернул p2 в исходную точку");
  assert.equal(spies.save, 0, "Esc не сохраняет и не пишет шаг истории");
});

test("одиночный перенос поста (выделение не группа) НЕ трогает групповую ветку", () => {
  const state = groupState({ selected: { kind: "post", id: "p1" } });
  const nodes = { p1: iconNode("p1"), p2: iconNode("p2"), p3: iconNode("p3") };
  const { api, spies } = buildGroupDrag(state, nodes);
  const el = dragMember(api, nodes, "p1", state, 60, 42);
  el.fire("pointerup", pointer({ clientX: 560, clientY: 542 }));
  assert.deepEqual([state.posts[0].x, state.posts[0].y], [60, 42], "одиночный p1 сдвинут");
  assert.deepEqual([state.posts[1].x, state.posts[1].y], [40, 10], "p2 (не выбран) не сдвинут — групповая ветка не сработала");
  assert.equal(spies.refresh, 0, "одиночный перенос идёт через updateObjectRoom, а не контракт группы");
  assert.equal(spies.save, 1, "одиночный перенос сохраняет один раз");
});
