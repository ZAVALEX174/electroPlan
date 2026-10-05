/* ПОВЕДЕНЧЕСКАЯ отмена/возврат (Б4, ч.А) на НАСТОЯЩИХ связках app.js (общий стенд §7.1): исполняем
   реальный текст projectSnapshot / captureHistory / scheduleSave / persistProject / applyPlanSnapshot /
   flushPendingRoomBuild / undoPlan / redoPlan в одном vm-контексте. Рендер и DOM заглушены; состояние —
   обычный объект. Деньги здесь проверяем на уровне ПЛАНА: смета — детерминированная функция плана, а
   EPHistory.planKey — тождество плана, поэтому равный planKey до и после ⇒ равная сумма (литеральное
   число ₽ проверяет браузерный хвост tools/qa/tails/undo.txt). Запуск: node --test. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");
const EPHistory = require("../js/history.js");
const EPPlanRotate = require("../js/planRotate.js");
const EPEstimate = require("../js/estimate.js");
const EPOfferOptions = require("../js/offerOptions.js");

function freshDefaults() {
  const win = {};
  require("node:vm").runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

/* Собрать «приложение»: исполнить настоящие связки истории в vm, вернуть state и вызовы. Рендер —
   заглушки; renderAll повторяет настоящий app.js (его последняя строка — scheduleSave), поэтому любое
   изменение состояния «проходит через точку сохранения» ровно как в проде. setWorldAngle — заглушка,
   пишущая state.worldAngle (угол мира — часть плана; реальный setWorldAngle ещё двигает pan, здесь нам
   важен сам угол и ФАКТ, что откат идёт через него). */
function makeApp() {
  const dom = stand.makeDom();
  const state = {
    devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [],
    roomLinePoints: [], roomLineIds: [], roomLineHover: null, roomFieldMemory: [],
    pxPerMeter: null, scaleSegment: null, planRotation: 0, worldAngle: 0, rotateTarget: "image",
    planVisibility: "show", orthoMode: true, snapGrid: true, gridStep: 10,
    panX: 0, panY: 0, scale: 1, planLoaded: false, planLabel: "", selected: null, pending: null,
    wallPoints: [], scalePoints: []
  };
  const spies = { setWorldAngle: [], store: null };
  const ctx = {
    state, EP_DATA: { settings: freshDefaults() }, EPEstimate, EPOfferOptions,
    EPHistory, EPPlanRotate, EPConfig: { historyLimit: 50, autosaveDelay: 700 },
    Date, console, $: dom.$,
    ProjectStore: { save: s => { spies.store = s; } },
    /* дебаунс не должен срабатывать сам: шаг фиксируется синхронно в scheduleSave, а отложенный
       persist в этих тестах не нужен (и склеил бы контроль) */
    setTimeout: () => 1, clearTimeout: () => {},
    canvas: { classList: { add() {}, remove() {} } },
    finishRoomLineChain() { state.roomLinePoints = []; state.roomLineIds = []; state.roomLineHover = null; },
    setWorldAngle(a) { spies.setWorldAngle.push(a); state.worldAngle = EPPlanRotate.normalizeAngle(a) || 0; },
    /* renderProperties мимикрирует ОПАСНОСТЬ R1: если комната «смонтирована» (mountedRoomId) и в поле
       #roomName лежит значение, оно пишется обратно в комнату (как настоящий flushRoomDraft). Если
       applyPlanSnapshot не обнулил mountedRoomId перед перерисовкой — откат имени был бы тут же отменён. */
    renderProperties() {
      if (ctx.mountedRoomId) {
        const room = state.rooms.find(r => r.id === ctx.mountedRoomId);
        if (room) room.name = dom.$("roomName").value;
      }
    },
    renderSummary() {}, updateScaleUi() {}, applyPlanRotation() {}, renderScaleRuler() {},
    /* buildRoomsFromLines заглушка: автопересборка добавляет комнату и сохраняет (как настоящая через
       refreshAfterRoomAssignments → persistProject) */
    buildRoomsFromLines() { state.rooms.push({ id: "auto1", name: "Помещение 1", polygon: [], autoPolygon: true }); ctx.persistProject(); },
    /* модульные переменные app.js (не объявлены в вырезанных функциях — живут в контексте) */
    _history: EPHistory.create(50),
    _applyingSnapshot: false, _historyAmend: false, _histBusy: false, _autosaveOn: true,
    _saveTimer: null, _roomsTimer: null,
    mountedRoomId: null, _lastIconPlacement: null, _placeOnPostIcon: null
  };
  ctx.renderAll = () => ctx.scheduleSave();   /* последняя строка настоящего renderAll */
  const code = ["projectSnapshot", "captureHistory", "syncHistoryUi", "persistProject", "scheduleSave",
    "applyPlanSnapshot", "flushPendingRoomBuild", "undoPlan", "redoPlan"].map(stand.functionSource).join("\n")
    + "\n;({});";
  require("node:vm").createContext(ctx);
  require("node:vm").runInContext(code, ctx);
  /* Вырезка persistProject тянет за собой соседний `var _saveTimer=null,_autosaveOn=false;` (он стоит
     ровно перед scheduleSave), и при инициализации vm он сбрасывает _autosaveOn в false. Возвращаем
     true — как init после восстановления; то же и с _history (var пересоздал стек). */
  ctx._autosaveOn = true;
  /* базовая точка истории — как init после восстановления */
  ctx._history.reset(ctx.projectSnapshot());
  ctx.syncHistoryUi();
  const key = () => EPHistory.planKey(ctx.projectSnapshot());
  const undoDepth = () => { let n = 0, h = ctx._history; while (h.canUndo()) { h.undo(); n++; } for (let i = 0; i < n; i++) h.redo(); return n; };
  return { ctx, state, dom, spies, key, undoDepth };
}

test("поставил пост → undo → поста нет и план (сумма сметы) прежний → redo → пост есть", () => {
  const a = makeApp();
  const keyBefore = a.key();
  a.state.posts.push({ id: "p1", x: 10, y: 20, number: 1, frameId: "f", mechanismIds: ["m"] });
  a.ctx.renderAll();                           // точка сохранения → шаг «поставил»
  const keyAfter = a.key();
  assert.notEqual(keyBefore, keyAfter, "постановка изменила план");
  a.ctx.undoPlan();
  assert.equal(a.state.posts.length, 0, "после отмены поста нет");
  assert.equal(a.key(), keyBefore, "план (а значит и сумма сметы) вернулся к прежнему");
  a.ctx.redoPlan();
  assert.equal(a.state.posts.length, 1, "после возврата пост снова есть");
  assert.equal(a.key(), keyAfter, "план совпал с состоянием после постановки");
});

test("два клика стен подряд без паузы = два шага (дебаунс не склеивает)", () => {
  const a = makeApp();
  a.state.walls.push({ id: "w1", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } });
  a.ctx.scheduleSave();
  a.state.walls.push({ id: "w2", a: { x: 1, y: 0 }, b: { x: 1, y: 1 } });
  a.ctx.scheduleSave();
  assert.equal(a.undoDepth(), 2, "две быстрые стены — два отдельных шага");
  a.ctx.undoPlan();
  assert.equal(a.state.walls.length, 1, "первая отмена снимает вторую стену");
  a.ctx.undoPlan();
  assert.equal(a.state.walls.length, 0, "вторая отмена снимает первую стену");
});

test("правка имени комнаты → undo → имя прежнее и НЕ откатывается обратно renderProperties (R1)", () => {
  const a = makeApp();
  a.state.rooms.push({ id: "r1", name: "Кухня", polygon: [] });
  a.ctx.scheduleSave();                        // шаг с комнатой «Кухня»
  // человек правит имя: значение в поле, mountedRoomId указывает на комнату, имя записано
  const room = a.state.rooms[0];
  room.name = "Столовая"; a.dom.$("roomName").value = "Столовая"; a.ctx.mountedRoomId = "r1";
  a.ctx.scheduleSave();                         // шаг с «Столовая»
  a.ctx.undoPlan();                             // откат к «Кухня»
  assert.equal(a.state.rooms[0].name, "Кухня",
    "после отмены имя прежнее и renderProperties его НЕ вернул на «Столовая» (mountedRoomId обнулён)");
});

test("undo НЕ трогает настройки проекта (скидка/НДС) и вид (pan/scale)", () => {
  const a = makeApp();
  a.ctx.EP_DATA.settings.discountPercent = 25;
  a.ctx.EP_DATA.settings.vatPercent = 20;
  a.state.panX = 123; a.state.panY = 456; a.state.scale = 2.5;
  a.state.posts.push({ id: "p1", x: 1, y: 2, number: 1 });
  a.ctx.renderAll();
  a.ctx.undoPlan();
  assert.equal(a.ctx.EP_DATA.settings.discountPercent, 25, "скидка не откатилась");
  assert.equal(a.ctx.EP_DATA.settings.vatPercent, 20, "НДС не откатился");
  assert.equal(a.state.panX, 123, "pan не откатился");
  assert.equal(a.state.scale, 2.5, "масштаб вида не откатился");
});

test("поворот плана → undo → угол прежний, восстановлен через setWorldAngle", () => {
  const a = makeApp();
  a.ctx.setWorldAngle(90);                      // как rotatePlanBy → setWorldAngle
  a.ctx.persistProject();                        // как setWorldAngle → persistProject: шаг «повернул»
  assert.equal(a.state.worldAngle, 90);
  const callsBefore = a.spies.setWorldAngle.length;
  a.ctx.undoPlan();
  assert.equal(a.state.worldAngle, 0, "после отмены угол вернулся к 0");
  assert.ok(a.spies.setWorldAngle.length > callsBefore, "угол восстановлен именно через setWorldAngle");
  assert.equal(a.spies.setWorldAngle[a.spies.setWorldAngle.length - 1], 0, "setWorldAngle(0) при откате");
});

test("«Очистить холст» → undo → всё вернулось (посты и угол) одним шагом", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 1, y: 2, number: 1 }, { id: "p2", x: 3, y: 4, number: 2 });
  a.ctx.renderAll();                             // шаг: добавили посты
  a.ctx.setWorldAngle(270); a.ctx.persistProject();   // шаг: повернули
  // «Очистить холст» как в app.js: оба внутренних сохранения под замком, один шаг завершающим persist
  a.ctx._applyingSnapshot = true;
  a.state.posts = []; a.ctx.scheduleSave();
  a.ctx.setWorldAngle(0); a.ctx.persistProject();
  a.ctx._applyingSnapshot = false;
  a.ctx.persistProject();
  assert.equal(a.state.posts.length, 0);
  assert.equal(a.state.worldAngle, 0);
  a.ctx.undoPlan();                              // одна отмена возвращает и посты, и угол
  assert.equal(a.state.posts.length, 2, "очистка отменилась ОДНИМ шагом — посты вернулись");
  assert.equal(a.state.worldAngle, 270, "и угол вернулся тем же шагом");
});

test("зум и выделение НЕ создают шагов истории", () => {
  const a = makeApp();
  const depth0 = a.undoDepth();
  a.state.scale = 1.7; a.ctx.scheduleSave();     // зум (вид) — не план
  a.state.panX = 50; a.ctx.scheduleSave();       // панорама — не план
  a.state.selected = { kind: "post", id: "p1" }; a.ctx.renderAll();   // выделение — не план
  assert.equal(a.undoDepth(), depth0, "ни зум, ни панорама, ни выделение шага не добавили");
});

test("В19: поставил и тут же убрал двойным кликом — в истории шага не осталось", () => {
  const a = makeApp();
  a.state.posts.push({ id: "pnew", x: 1, y: 2, number: 1 });
  a.ctx.renderAll();                             // шаг «поставил»
  assert.ok(a.ctx._history.canUndo(), "шаг «поставил» записан");
  // ветка openPostOnDblClick.undo: удаление под замком + снятие шага
  a.ctx._applyingSnapshot = true;
  a.state.posts = [];
  a.ctx.persistProject();
  a.ctx._applyingSnapshot = false;
  a.ctx._history.dropHead();
  a.ctx.syncHistoryUi();
  assert.equal(a.ctx._history.canUndo(), false, "в истории «поставил/убрал» не осталось — отменять нечего");
});

test("автопересборка комнат из разметки ДОПОЛНЯЕТ шаг клика, а не плодит новый", () => {
  const a = makeApp();
  a.state.roomLines.push({ id: "l1", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
  a.ctx.scheduleSave();                           // шаг: клик по линии
  const depthAfterClick = a.undoDepth();
  a.ctx._roomsTimer = 7;                          // как будто ждёт отложенная пересборка
  a.ctx.flushPendingRoomBuild();                  // пересборка дополняет текущий шаг (amend)
  assert.equal(a.undoDepth(), depthAfterClick, "пересборка не добавила отдельный шаг");
  assert.equal(a.state.rooms.length, 1, "комната из разметки появилась");
  a.ctx.undoPlan();                               // один шаг назад — и линии, и комнаты ушли вместе
  assert.equal(a.state.roomLines.length, 0, "линия откатилась");
  assert.equal(a.state.rooms.length, 0, "комната откатилась ТЕМ ЖЕ шагом");
});
