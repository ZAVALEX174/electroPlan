/* З10: поведенческое покрытие ПЕРЕТАСКИВАНИЯ объектов на плане (js/canvasInput.js). Чистую
   математику жеста уже сторожит drag.test.js (EPDrag.beyondThreshold/worldPosition), а вот
   СВЯЗКА этой математики с указательным вводом — makeDraggable + trackDrag внутри
   EPCanvasInput.attach — до сих пор исполнялась в тестах лишь до pointerdown (см.
   roomLabelPlacePending.test.js: там trackDrag — пустая заглушка). Поэтому порог «клик/перенос»,
   пересчёт при масштабе, Esc-отмена, сохранение и блокировка пробелом никакой тест не проверял:
   их можно было сломать молча. Здесь эта дыра закрывается.

   ПОДХОД (общий стенд §7.1). app.js/canvasInput.js в node не грузятся; вырезаем ИСХОДНЫЙ ТЕКСТ
   настоящих функций (trackDrag, makeDraggable, onSpaceKeydown) и исполняем их ВМЕСТЕ в одном
   vm-контексте — так у makeDraggable внутри работает НАСТОЯЩИЙ trackDrag (его free-var-ссылка
   находит соседнюю function-декларацию), а onSpaceKeydown и beginPress делят одну переменную
   spaceDown (в стенде это глобал контекста, но переключаем мы его РЕАЛЬНЫМ onSpaceKeydown, как
   ветка «пробел» глобального keydown в app.js, а не подменой текста). EPDrag/EPConfig берём
   настоящими модулями — порог (4px) и формула world=base+Δscreen/scale не переписаны.

   Шим узла реально доставляет pointermove/pointerup в обработчики, которые trackDrag повесил на
   ЭТОТ узел (через setPointerCapture), а шим document — keydown Escape в обработчик отмены,
   повешенный на document. Так тест идёт по тому же пути событий, что и браузер. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPDrag = require("../js/drag.js");
const EPConfig = require("../js/config.js");

/* Указательное событие: ровно те поля, что читают pointerdown-обработчик и trackDrag
   (isPrimary/button — фильтр основного указателя, clientX/Y — позиция, pointerId — сверка
   с захваченным). preventDefault/stopPropagation — заглушки-счётчики (обработчики их зовут). */
function pointer(over) {
  return Object.assign(
    { isPrimary: true, button: 0, clientX: 0, clientY: 0, pointerId: 1,
      preventDefault() {}, stopPropagation() {} },
    over
  );
}

/* keydown-событие отмены: key + счётчики гашения (onKey зовёт preventDefault/stopPropagation,
   чтобы глобальный Esc→setTool не перерисовал сцену). */
function keydown(key) {
  return { key, _pd: 0, _sp: 0, preventDefault() { this._pd++; }, stopPropagation() { this._sp++; } };
}

/* Шим DOM-узла-иконки: копит слушатели по типу и доставляет их через fire (как addEventListener +
   dispatchEvent). trackDrag вешает pointermove/pointerup/pointercancel именно на ЭТОТ узел (он же
   владелец pointer capture), поэтому сюда и прилетают движения. removeEventListener честно снимает
   слушателя — cleanup после отпускания/Esc отписывается, повторное событие уже не пройдёт. */
function makeNode() {
  const listeners = {};
  return {
    dataset: {}, style: {}, classList: stand.makeClassList(),
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    fire(type, ev) { (listeners[type] || []).slice().forEach(fn => fn(ev)); }
  };
}

/* Шим document: обработчик отмены переноса вешается сюда (keydown, capture). fire доставляет Escape. */
function makeDoc() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter(f => f !== fn); },
    fire(type, ev) { (listeners[type] || []).slice().forEach(fn => fn(ev)); }
  };
}

/* Готовит vm-контекст с настоящими trackDrag/makeDraggable/onSpaceKeydown. Зависимости, не
   относящиеся к переносу (подсветка комнаты-приёмника, hover, перерисовки), — тихие заглушки-шпионы:
   мутации M7–M10 их не трогают, а их DOM тут не под тестом. Ключевое остаётся настоящим: EPDrag,
   EPConfig, порог, формула масштаба, ветвление режимов, scheduleSave. */
function buildDrag(state) {
  const spies = { scheduleSave: 0, ensure: 0, updateStatus: [] };
  const doc = makeDoc();
  const ctx = {
    HAS_POINTER: true,          // ветка PointerEvent (нижняя граница проекта её имеет)
    document: doc,
    EPDrag, EPConfig,
    state,
    spaceDown: false,           // глобал контекста; пишет его onSpaceKeydown, читает beginPress
    setPanReady() {},           // onSpaceKeydown дергает подсказку «рука» — вне темы переноса
    setRoomDropHighlight() {}, clearRoomDropHighlight() {},
    ensureSelectTool() { spies.ensure++; return false; },
    applySelectionClasses() {}, renderProperties() {},
    hideHover() {},
    buildSpaceComponents() { return null; },
    getRoomForPoint() { return null; },
    renderGroupLinks() {}, renderRooms() {}, renderSummary() {},
    updateObjectRoom() { return null; },
    updateStatus(m) { spies.updateStatus.push(m); },
    scheduleSave() { spies.scheduleSave++; },
    /* Б4 п.3: перенос помечает начало/конец жеста (шаг истории фиксируется на отпускании). Здесь
       история не под тестом — тихие заглушки, лишь бы makeDraggable их нашёл в контексте. */
    beginGesture() {}, endGesture() {},
    refreshAfterRoomAssignments() {},
    removeEntity() {}
  };
  const code = [
    stand.functionSource("trackDrag"),
    stand.functionSource("makeDraggable"),
    stand.functionSource("onSpaceKeydown"),
    ";({ makeDraggable, onSpaceKeydown });"
  ].join("\n");
  vm.createContext(ctx);
  const api = vm.runInContext(code, ctx);
  return { api, doc, spies };
}

function makeState(over) {
  return Object.assign({ pending: null, tool: "select", selected: null, scale: 1, rooms: [] }, over);
}

/* --- Порог «клик vs перенос» (onMove) --------------------------------------------------------- */
test("сдвиг в пределах порога — это клик: объект не двигается и проект не сохраняется", () => {
  const obj = { id: "p1", x: 100, y: 100 };
  const { api, spies } = buildDrag(makeState());
  const el = makeNode();
  api.makeDraggable(el, obj, "post");
  el.fire("pointerdown", pointer({ clientX: 500, clientY: 500 }));
  el.fire("pointermove", pointer({ clientX: 501, clientY: 500 }));   // Δ=1px, порог 4px → ещё клик
  el.fire("pointerup", pointer({ clientX: 501, clientY: 500 }));
  assert.equal(obj.x, 100, "клик в пределах порога не двигает объект по X");
  assert.equal(obj.y, 100, "клик в пределах порога не двигает объект по Y");
  assert.equal(spies.scheduleSave, 0, "клик (не перенос) ничего не сохраняет");
});

/* --- Перенос с учётом масштаба + сохранение позиции (onMove/finishDrag) ------------------------ */
test("перенос сдвигает объект на экранную дельту делённую на масштаб и сохраняет позицию", () => {
  const obj = { id: "p1", x: 100, y: 100 };
  const { api, spies } = buildDrag(makeState({ scale: 2 }));
  const el = makeNode();
  api.makeDraggable(el, obj, "post");
  el.fire("pointerdown", pointer({ clientX: 500, clientY: 500 }));
  el.fire("pointermove", pointer({ clientX: 560, clientY: 542 }));   // +60/+42 экранных, scale=2
  el.fire("pointerup", pointer({ clientX: 560, clientY: 542 }));
  assert.equal(obj.x, 130, "при scale=2 экранные +60 → мировые +30");
  assert.equal(obj.y, 121, "при scale=2 экранные +42 → мировые +21");
  assert.equal(spies.scheduleSave, 1, "завершённый перенос сохраняет новую позицию (scheduleSave)");
});

/* --- Перенос при повёрнутом холсте: экранная дельта → мировая обратной матрицей R(−угол) -------- */
/* Б3, ч.2а. makeDraggable передаёт state.worldAngle в EPDrag.worldPosition; при угле 90° экранное
   «вправо-вниз» становится другим направлением в мире. МУТАЦИЯ M1 (canvasInput.js): убрать
   `,state.worldAngle` из вызова worldPosition — тогда дельта не повернётся, и объект поедет не туда. */
test("перенос при угле мира 90° учитывает угол: экранные (+60,+42) → мировые (+42,−60)", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9, `${a} ≈ ${b}`);
  const obj = { id: "p1", x: 100, y: 100 };
  const { api } = buildDrag(makeState({ scale: 1, worldAngle: 90 }));
  const el = makeNode();
  api.makeDraggable(el, obj, "post");
  el.fire("pointerdown", pointer({ clientX: 500, clientY: 500 }));
  el.fire("pointermove", pointer({ clientX: 560, clientY: 542 }));   // экранные +60/+42
  el.fire("pointerup", pointer({ clientX: 560, clientY: 542 }));
  /* R(−90): wx=(dxs*c+dys*sn)/s, wy=(−dxs*sn+dys*c)/s при c≈0,sn=1 → (dys,−dxs)=(42,−60) */
  near(obj.x, 142);   // без передачи угла (мутация M1) было бы 160
  near(obj.y, 40);    // без угла было бы 142
});

/* --- Esc посреди переноса возвращает объект на место (onKey) ----------------------------------- */
test("Esc во время переноса возвращает объект на исходные координаты и не сохраняет", () => {
  const obj = { id: "p1", x: 100, y: 100 };
  const { api, doc, spies } = buildDrag(makeState());
  const el = makeNode();
  api.makeDraggable(el, obj, "post");
  el.fire("pointerdown", pointer({ clientX: 500, clientY: 500 }));
  el.fire("pointermove", pointer({ clientX: 560, clientY: 542 }));   // объект реально уехал в 160/142
  assert.equal(obj.x, 160, "предусловие: перенос начался");
  assert.equal(obj.y, 142, "предусловие: перенос начался");
  const esc = keydown("Escape");
  doc.fire("keydown", esc);
  assert.equal(obj.x, 100, "Esc возвращает X на исходное");
  assert.equal(obj.y, 100, "Esc возвращает Y на исходное");
  assert.equal(spies.scheduleSave, 0, "отменённый перенос не сохраняется");
  assert.ok(esc._pd > 0 && esc._sp > 0, "Esc гасится, чтобы глобальный Esc→setTool не перерисовал сцену");
});

/* --- Зажатый пробел отдаёт жест панораме (beginPress) ------------------------------------------ */
test("при зажатом пробеле нажатие на объект не начинает перенос", () => {
  const obj = { id: "p1", x: 100, y: 100 };
  const state = makeState();
  const { api, spies } = buildDrag(state);
  const el = makeNode();
  api.makeDraggable(el, obj, "post");
  api.onSpaceKeydown();                                              // РЕАЛЬНО ставит spaceDown=true
  el.fire("pointerdown", pointer({ clientX: 500, clientY: 500 }));
  el.fire("pointermove", pointer({ clientX: 560, clientY: 542 }));   // переноса быть не должно
  assert.equal(obj.x, 100, "при зажатом пробеле объект не переносится (жест у панорамы)");
  assert.equal(obj.y, 100, "при зажатом пробеле объект не переносится (жест у панорамы)");
  assert.equal(state.selected, null, "нажатие при зажатом пробеле не выделяет объект");
  assert.equal(spies.ensure, 0, "beginPress выходит до ensureSelectTool, пока держат пробел");
  assert.equal(spies.scheduleSave, 0, "перенос не начинался — сохранять нечего");
});
