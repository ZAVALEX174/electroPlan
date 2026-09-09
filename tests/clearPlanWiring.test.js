/* Поведенческий тест сброса подложки (ПЛАН-В-ДОКУМЕНТЕ, часть 2): исполняем НАСТОЯЩИЙ текст
   updatePlanUi и clearPlan из app.js в vm-стенде (helpers/appStand). Структурные *Wiring-тесты
   ловят удаление строки, но не смену смысла; здесь проверяем контракт: сброс гасит подложку и в
   state, и на кнопках, а нарисованное и масштаб не трогает; та же updatePlanUi на загрузке
   включает ровно те же органы. Мутационная опора — по строке на каждый эффект. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const PLAN_BTNS = ["autoTraceBtn", "detectRoomsBtn", "detectRoomsMlBtn", "annotateBtn"];

/* DOM-шим: плановые кнопки + статус-точка + «Убрать план» + переключатель видимости. planImage —
   кастомный узел с src и removeAttribute (generic makeElement их не знает): именно removeAttribute,
   а не src="", проверяет постановка. */
function makeDom() {
  const dom = stand.makeDom();
  const img = { src: "data:image/png;base64,AAAA", removeAttribute(n) { if (n === "src") delete this.src; } };
  dom.els.planImage = img;
  return { $: dom.$, els: dom.els, img };
}

/* Спаи внешних связок clearPlan: их вызов — часть контракта, а поведение не наше. */
function makeSpies() {
  const calls = { clearAnnotations: 0, applyPlanVisibility: 0, persistProject: 0, updateStatus: [], toast: [] };
  return {
    calls,
    clearAnnotations: () => { calls.clearAnnotations++; },
    applyPlanVisibility: () => { calls.applyPlanVisibility++; },
    persistProject: () => { calls.persistProject++; },
    updateStatus: t => { calls.updateStatus.push(t); },
    toast: t => { calls.toast.push(t); }
  };
}

test("clearPlan гасит подложку: src снят removeAttribute, planLoaded/planLabel/planVisibility сброшены", () => {
  const dom = makeDom();
  const state = { planLoaded: true, planLabel: "chertezh.png", planVisibility: "hide" };
  const spies = makeSpies();
  stand.run(["updatePlanUi", "bumpPlanToken", "clearPlan"], Object.assign({ state, $: dom.$ }, spies))();

  assert.equal("src" in dom.img, false, "src снят через removeAttribute, а не выставлен в пустую строку");
  assert.equal(state.planLoaded, false, "плановый флаг снят");
  assert.equal(state.planLabel, "", "подпись плана очищена");
  assert.equal(state.planVisibility, "show", "видимость возвращена на show — следующая загрузка не откроется скрытой");
});

test("clearPlan гасит плановые кнопки, статус-точку и прячет саму себя", () => {
  const dom = makeDom();
  const state = { planLoaded: true, planLabel: "x", planVisibility: "show" };
  const spies = makeSpies();
  dom.$("planStatusDot").classList.add("ready");
  stand.run(["updatePlanUi", "bumpPlanToken", "clearPlan"], Object.assign({ state, $: dom.$ }, spies))();

  PLAN_BTNS.forEach(id => assert.equal(dom.$(id).disabled, true, id + " задизейблен без плана"));
  assert.equal(dom.$("planStatusDot").classList.contains("ready"), false, "статус-точка погашена");
  assert.equal(dom.$("clearPlanBtn").hidden, true, "«Убрать план» спрятана — плана больше нет");
  assert.equal(dom.$("planVisibilityBtn").disabled, true, "переключатель видимости задизейблен без плана");
});

test("clearPlan дёргает связки очистки/перерисовки/сохранения и сообщает пользователю", () => {
  const dom = makeDom();
  const state = { planLoaded: true, planLabel: "x", planVisibility: "show" };
  const spies = makeSpies();
  stand.run(["updatePlanUi", "bumpPlanToken", "clearPlan"], Object.assign({ state, $: dom.$ }, spies))();

  assert.equal(spies.calls.clearAnnotations, 1, "разметка распознавания снята вместе с подложкой");
  assert.equal(spies.calls.applyPlanVisibility, 1, "видимость применена после сброса");
  assert.equal(spies.calls.persistProject, 1, "проект сохранён — подложка ушла и из снимка");
  assert.deepEqual(spies.calls.updateStatus, ["План убран"], "статус сообщён");
  assert.deepEqual(spies.calls.toast, ["План убран"], "тост показан");
});

test("clearPlan не трогает нарисованное и масштаб — они в мировых координатах, от картинки не зависят", () => {
  const dom = makeDom();
  const rooms = [{ name: "Кухня" }], walls = [{ a: 1 }], posts = [{ number: 1 }], roomLines = [{ id: 2 }];
  const seg = { a: {}, b: {}, meters: 3 };
  const state = {
    planLoaded: true, planLabel: "x", planVisibility: "show",
    rooms, walls, posts, roomLines, pxPerMeter: 42, scaleSegment: seg
  };
  stand.run(["updatePlanUi", "bumpPlanToken", "clearPlan"], Object.assign({ state, $: dom.$ }, makeSpies()))();

  assert.equal(state.rooms, rooms, "комнаты не тронуты");
  assert.equal(state.walls, walls, "стены не тронуты");
  assert.equal(state.posts, posts, "посты не тронуты");
  assert.equal(state.roomLines, roomLines, "разметка не тронута");
  assert.equal(state.pxPerMeter, 42, "масштаб (px/м) цел");
  assert.equal(state.scaleSegment, seg, "эталонный отрезок масштаба цел");
});

test("updatePlanUi на загрузке включает ровно те же органы (одно правило, оба места)", () => {
  const dom = makeDom();
  const state = { planLoaded: true };
  stand.run(["updatePlanUi"], { state, $: dom.$ })();

  PLAN_BTNS.forEach(id => assert.equal(dom.$(id).disabled, false, id + " включён при загруженном плане"));
  assert.equal(dom.$("planStatusDot").classList.contains("ready"), true, "статус-точка зажжена");
  assert.equal(dom.$("clearPlanBtn").hidden, false, "«Убрать план» показана при наличии плана");
  assert.equal(dom.$("planVisibilityBtn").disabled, false, "переключатель видимости доступен при плане");
});
