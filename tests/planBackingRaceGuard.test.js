/* Поведенческий тест «поколения подложки»: исполняем НАСТОЯЩИЙ текст detectRoomsML/annotatePlan
   вместе с предикатом planUnchanged, реакцией planLostDuringOp и updatePlanUi из app.js в
   vm-стенде. Дефект состязательного прохода по cac1c01: долгая операция над подложкой не
   перепроверяет после await, что подложка ещё на месте, — «Убрать план» посреди распознавания
   удаляет авто-комнаты с ручными полями и включает кнопки мимо updatePlanUi. Здесь фиксируем
   контракт: смена поколения (state.planToken) во время await → операция ничего не удаляет, ничего
   не пишет в state и не включает кнопки сама, а зовёт updatePlanUi. Мутационная опора — по строке
   на предикат, его точку вызова и «нормальный» путь. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const PLAN_BTNS = ["autoTraceBtn", "detectRoomsBtn", "detectRoomsMlBtn", "annotateBtn"];

/* Базовый контекст: настоящие planUnchanged/updatePlanUi/planLostDuringOp + шимы связок, которых
   касается путь отмены. showTraceProgress/toast — спаи (их поведение не наше), canvas — размеры. */
function makeCtx(state, extra) {
  const dom = stand.makeDom();
  const img = { naturalWidth: 1000, naturalHeight: 800, src: "data:image/png;base64,AAAA" };
  dom.els.planImage = img;
  const calls = { toast: [], showTraceProgress: [] };
  const ctx = Object.assign({
    state,
    $: dom.$,
    canvas: { clientWidth: 800, clientHeight: 600 },
    toast: t => calls.toast.push(t),
    showTraceProgress: (...a) => calls.showTraceProgress.push(a),
    setTimeout: (fn, ms) => setTimeout(fn, ms), // vm-контекст не наследует таймеры node
    console: { error() {} }
  }, extra);
  return { ctx, dom, img, calls };
}

/* Две авто-комнаты с введёнными вручную именами/площадями — вход, который дефект терял. */
function autoRooms() {
  return [
    { id: "room_1", name: "Кухня", area: "12.5", autoPolygon: true, polygon: [{ x: 0, y: 0 }] },
    { id: "room_2", name: "Спальня", area: "18", autoPolygon: true, polygon: [{ x: 1, y: 1 }] }
  ];
}

test("detectRoomsML: сброс подложки во время await НЕ теряет авто-комнаты с ручными полями", async () => {
  const rooms = autoRooms();
  const state = { planToken: 7, planLoaded: true, rooms };
  const EPFloorplanML = {
    /* имитируем клик «Убрать план» ровно во время await: bumpPlanToken меняет поколение,
       planLoaded гаснет, а сеть по опустевшей подложке отдаёт rooms:[] (сценарий дефекта). */
    segmentRooms: async () => { state.planToken++; state.planLoaded = false; return { rooms: [] }; },
    mapPolygon: p => p
  };
  const { ctx, dom } = makeCtx(state, { EPFloorplanML });
  await stand.run(["planUnchanged", "updatePlanUi", "planLostDuringOp", "detectRoomsML"], ctx)();

  assert.equal(state.rooms, rooms, "ссылка на массив комнат не подменялась (фильтр авто-комнат не выполнялся)");
  assert.equal(state.rooms.length, 2, "обе авто-комнаты на месте");
  assert.deepEqual(state.rooms.map(r => r.name), ["Кухня", "Спальня"], "ручные имена целы");
  assert.deepEqual(state.rooms.map(r => r.area), ["12.5", "18"], "ручные площади целы");
  /* кнопки приведены к НЫНЕШНЕМУ (пустому) состоянию подложки — не включены мимо updatePlanUi */
  PLAN_BTNS.forEach(id => assert.equal(dom.$(id).disabled, true, id + " задизейблен: плана нет"));
  assert.equal(dom.$("clearPlanBtn").hidden, true, "«Убрать план» спрятана — плана больше нет");
});

test("detectRoomsML: при неизменной подложке операция идёт как раньше (перестраивает авто-комнаты)", async () => {
  const rooms = autoRooms();
  const state = { planToken: 7, planLoaded: true, rooms };
  const EPFloorplanML = {
    segmentRooms: async () => ({ rooms: [{ polygon: [{ x: 5, y: 5 }] }] }),
    mapPolygon: p => p
  };
  const extra = {
    EPFloorplanML,
    polygonCentroid: () => ({ x: 5, y: 5 }),
    uid: p => p + "new",
    carryUserRoomFields: () => {},
    refreshAfterRoomAssignments: fn => { if (fn) fn(); },
    renderAll: () => {},
    updateStatus: () => {}
  };
  const { ctx } = makeCtx(state, extra);
  await stand.run(["planUnchanged", "updatePlanUi", "planLostDuringOp", "detectRoomsML"], ctx)();

  /* авто-комнаты снесены и построены заново из res.rooms — путь не заблокирован предикатом */
  assert.equal(state.rooms.length, 1, "старые авто-комнаты удалены, построена одна новая");
  assert.equal(state.rooms[0].autoPolygon, true, "новая комната — авто-контур");
});

test("annotatePlan: сброс подложки во время await не пишет detections и не включает кнопки", async () => {
  const state = { planToken: 3, planLoaded: true };
  const EPFloorplanML = {
    ensureReady: async () => {},
    detect: async () => { state.planToken++; state.planLoaded = false; return { detections: [] }; },
    backend: "wasm"
  };
  const { ctx, dom } = makeCtx(state, {
    EPFloorplanML,
    renderAnnotations: () => {},
    updateStatus: () => {},
    ANNOT_STYLE: {}
  });
  dom.$("clearAnnotateBtn").hidden = true; // исходно скрыта — проверяем, что так и осталась
  await stand.run(["planUnchanged", "updatePlanUi", "planLostDuringOp", "annotatePlan"], ctx)();

  assert.equal("detections" in state, false, "detections не записаны для убранной подложки");
  assert.equal(dom.$("clearAnnotateBtn").hidden, true, "«Убрать разметку» не показана — плана нет");
  /* finally зовёт updatePlanUi, а не btn.disabled=false: при пустой подложке кнопка остаётся выкл. */
  assert.equal(dom.$("annotateBtn").disabled, true, "annotateBtn не включён мимо updatePlanUi");
});

test("annotatePlan: при неизменной подложке пишет detections, показывает «Убрать разметку» и включает кнопку", async () => {
  const state = { planToken: 3, planLoaded: true };
  const EPFloorplanML = {
    ensureReady: async () => {},
    detect: async () => ({ detections: [{ name: "socket" }], natW: 10, natH: 20 }),
    backend: "wasm"
  };
  const { ctx, dom } = makeCtx(state, {
    EPFloorplanML,
    renderAnnotations: () => {},
    updateStatus: () => {},
    ANNOT_STYLE: {}
  });
  dom.$("clearAnnotateBtn").hidden = true;
  await stand.run(["planUnchanged", "updatePlanUi", "planLostDuringOp", "annotatePlan"], ctx)();

  assert.equal(state.detections.natW, 10, "detections записаны при живой подложке");
  assert.equal(dom.$("clearAnnotateBtn").hidden, false, "«Убрать разметку» показана");
  assert.equal(dom.$("annotateBtn").disabled, false, "annotateBtn возвращён в активное состояние");
});
