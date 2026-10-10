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
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPHistory = require("../js/history.js");
const EPPlanRotate = require("../js/planRotate.js");
const EPEstimate = require("../js/estimate.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPConfig = require("../js/config.js");
const EPGeom = require("../js/geometry.js");
const EPViewport = require("../js/viewport.js");
const EPRoomsFromLines = require("../js/roomsFromLines.js");
const EPRoomCarry = require("../js/roomCarry.js");
const EPPlaceDblClick = require("../js/placeDblClick.js");

/* Текст top-level `function name(...)` по БАЛАНСУ СКОБОК — для функций, за которыми идут НЕ
   function-соседи (clearCanvas: ниже неё строки $("…").onclick=…), где stand.functionSource прихватил бы
   лишнее. Пропускаем строковые литералы, считаем {}. */
function fnByBraces(name) {
  const src = stand.sourceOf("app.js");
  const start = src.indexOf("function " + name + "(");
  assert.ok(start >= 0, "в js/app.js должна быть функция " + name);
  let depth = 0, quote = null, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote && src[i - 1] !== "\\") quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(start, i);
}

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
  /* #planImage со шпионом: считаем ЛЮБОЕ касание src (присвоение и removeAttribute) — ч.Б должна не
     трогать растр, когда подложка шага та же. onload в node не стреляет (нет движка изображений) —
     поэтому applyPlanRotation из onload в юнит-тестах не выполняется; его проверяет браузерный хвост. */
  const planImage = {
    _src: "", onload: null, onerror: null, style: {}, naturalWidth: 10, naturalHeight: 10, touches: 0,
    get src() { return this._src; },
    set src(v) { this._src = String(v); this.touches++; },
    removeAttribute(name) { if (name === "src") { this._src = ""; this.touches++; } }
  };
  dom.els.planImage = planImage;
  const state = {
    devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [],
    roomLinePoints: [], roomLineIds: [], roomLineHover: null, roomFieldMemory: [],
    pxPerMeter: null, scaleSegment: null, planRotation: 0, worldAngle: 0, rotateTarget: "image",
    planVisibility: "show", orthoMode: true, snapGrid: true, gridStep: 10, planToken: 0,
    panX: 0, panY: 0, scale: 1, planLoaded: false, planLabel: "", selected: null, pending: null,
    wallPoints: [], scalePoints: []
  };
  const spies = { setWorldAngle: [], store: null, bump: 0 };
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
    renderSummary() {}, updateScaleUi() {}, applyPlanRotation() { spies.rotate = (spies.rotate || 0) + 1; }, renderScaleRuler() {},
    /* подложка (ч.Б): bumpPlanToken со счётчиком — проверяем, что токен дёргается ТОЛЬКО при смене
       подложки; updatePlanUi/applyPlanVisibility — заглушки (их эффект на DOM здесь не предмет) */
    bumpPlanToken() { spies.bump++; state.planToken = (state.planToken || 0) + 1; },
    updatePlanUi() {}, applyPlanVisibility() {},
    /* соседи clearPlan/applyImportedPlan, не относящиеся к истории */
    clearAnnotations() { state.detections = null; }, markCanvasUsed() {}, updateStatus() {}, toast() {},
    /* buildRoomsFromLines заглушка: автопересборка добавляет комнату и сохраняет (как настоящая через
       refreshAfterRoomAssignments → persistProject) */
    buildRoomsFromLines() { state.rooms.push({ id: "auto1", name: "Помещение 1", polygon: [], autoPolygon: true }); ctx.persistProject(); },
    /* соседи реальных обработчиков, которые дёргают очистку/В19/стрелки/перенос */
    EPPlaceDblClick,
    openPostBuilder() { spies.openPost = (spies.openPost || 0) + 1; },
    findEntityNode() { return null; }, updateObjectRoom() { return null; }, renderRooms() {},
    refreshAfterRoomAssignments(paint, save) { if (paint) paint(); if (save) save(); },
    /* undoPlan зовёт notices.prune() (Б9/2б) — заглушка, сообщения здесь не предмет проверки */
    notices: { prune() {} },
    /* модульные переменные app.js (не объявлены в вырезанных функциях — живут в контексте) */
    _history: EPHistory.create(50),
    _applyingSnapshot: false, _historyAmend: false, _histBusy: false, _gestureActive: false, _autosaveOn: true,
    _saveTimer: null, _roomsTimer: null, _roomsJustScheduled: false, _fieldEditEl: null,
    mountedRoomId: null, _lastIconPlacement: null, _placeOnPostIcon: null
  };
  ctx.renderAll = () => ctx.scheduleSave();   /* последняя строка настоящего renderAll */
  /* clearCanvas и removeEntity режем ПО СКОБКАМ: за ними идут не function-соседи (clearCanvas → строки
     onclick=…; removeEntity → `let mountedRoomId=null;`), и functionSource прихватил бы лишнее — в т.ч.
     второе объявление mountedRoomId, которое перекрыло бы контекстный глобал и сломало бы R1. */
  /* removePosts (Б5 ч.2) режем ПО СКОБКАМ по той же причине, что removeEntity: за ним идёт
     `let mountedRoomId=null;`, и functionSource прихватил бы это второе объявление, перекрыв глобал R1. */
  const code = fnByBraces("clearCanvas") + "\n" + fnByBraces("removeEntity") + "\n" + fnByBraces("removePosts") + "\n"
    + ["projectSnapshot", "captureHistory", "syncHistoryUi", "persistProject", "scheduleSave",
    "applyPlanUnderlay", "applyPlanSnapshot", "flushPendingRoomBuild", "undoPlan", "redoPlan",
    "clearPlan", "moveSelectedBy", "moveSelectedByKey", "openPostOnDblClick",
    "beginGesture", "endGesture", "fieldInputSave", "endFieldEdit"].map(stand.functionSource).join("\n")
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

test("«Очистить холст» → undo → всё вернулось (посты и угол) одним шагом (НАСТОЯЩИЙ clearCanvas)", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 1, y: 2, number: 1 }, { id: "p2", x: 3, y: 4, number: 2 });
  a.ctx.renderAll();                             // шаг: добавили посты
  a.ctx.setWorldAngle(270); a.ctx.persistProject();   // шаг: повернули
  const depthBefore = a.undoDepth();
  a.ctx.clearCanvas();                           // НАСТОЯЩИЙ обработчик кнопки «Очистить холст»
  assert.equal(a.state.posts.length, 0);
  assert.equal(a.state.worldAngle, 0);
  assert.equal(a.undoDepth(), depthBefore + 1, "очистка — РОВНО один шаг (оба внутренних сейва под замком)");
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

test("В19: поставил и тут же убрал двойным кликом — в истории шага не осталось (НАСТОЯЩИЙ openPostOnDblClick)", () => {
  const a = makeApp();
  const depth0 = a.undoDepth();
  a.state.posts.push({ id: "pnew", x: 1, y: 2, number: 1 });
  a.state.selected = { kind: "post", id: "pnew" };
  a.ctx.renderAll();                             // шаг «поставил»
  assert.equal(a.undoDepth(), depth0 + 1, "шаг «поставил» записан");
  /* постановка пришлась по иконке старого поста → _lastIconPlacement свежий, и dblclick по новому посту
     в пределах окна EPPlaceDblClick → ветка undo. Ставим как addPending (В19). */
  a.ctx._lastIconPlacement = { newId: "pnew", overId: "pold", t: Date.now() };
  a.ctx.openPostOnDblClick("pnew");              // НАСТОЯЩИЙ обработчик двойного клика
  assert.equal(a.state.posts.length, 0, "новый пост убран");
  assert.equal(a.undoDepth(), depth0, "в истории «поставил/убрал» не осталось — dropHead снял шаг");
  assert.equal(a.ctx._history.canUndo(), depth0 > 0, "отменять нечего (кроме того, что было до постановки)");
});

/* --- Б4 п.1-2: автопересборка комнат на НАСТОЯЩЕМ пути таймеров (управляемые таймеры) --------------
   makeRoomApp исполняет НАСТОЯЩИЕ scheduleRoomsFromLines/flushPendingRoomBuild/captureHistory/
   buildRoomsFromLines (+ roomsFromLines/geometry/viewport/roomCarry) в одном vm; setTimeout управляемый
   (fn копятся, runTimers() их спускает — как в браузере через 600 мс). Клик по линии воспроизводим ровно
   как reordered addRoomLinePoint: push линии → scheduleRoomsFromLines() → scheduleSave() (шаг). */
function makeRoomApp() {
  const dom = stand.makeDom();
  const planImage = { _src: "", onload: null, onerror: null, style: {}, naturalWidth: 10, naturalHeight: 10,
    get src() { return this._src; }, set src(v) { this._src = String(v); }, removeAttribute() { this._src = ""; } };
  dom.els.planImage = planImage;
  const state = { devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [], roomLinePoints: [], roomLineIds: [],
    roomLineHover: null, roomFieldMemory: [], pxPerMeter: null, scaleSegment: null, planRotation: 0, worldAngle: 0, rotateTarget: "image",
    planVisibility: "show", orthoMode: true, snapGrid: true, gridStep: 10, planToken: 0, panX: 0, panY: 0, scale: 1, planLoaded: false,
    planLabel: "", selected: null, pending: null, wallPoints: [], scalePoints: [] };
  let tid = 0; const timers = new Map();
  const ctx = {
    state, EP_DATA: { settings: freshDefaults() }, EPEstimate, EPOfferOptions, EPHistory, EPPlanRotate, EPConfig, EPGeom, EPViewport,
    EPRoomsFromLines, EPRoomCarry, Date, console, Math, $: dom.$,
    ProjectStore: { save: () => {} },
    setTimeout: (fn) => { tid++; timers.set(tid, fn); return tid; }, clearTimeout: id => { timers.delete(id); },
    canvas: { classList: { add() {}, remove() {} } },
    finishRoomLineChain() { state.roomLinePoints = []; state.roomLineIds = []; state.roomLineHover = null; },
    setWorldAngle(a) { state.worldAngle = EPPlanRotate.normalizeAngle(a) || 0; ctx.persistProject(); },
    renderProperties() {}, renderSummary() {}, updateScaleUi() {}, applyPlanRotation() {}, renderScaleRuler() {},
    bumpPlanToken() { state.planToken++; }, updatePlanUi() {}, applyPlanVisibility() {},
    clearAnnotations() {}, markCanvasUsed() {}, updateStatus() {}, toast() {},
    recalculateRoomAssignments() {}, renderGroupLinks() {}, renderRooms() {}, drawRoomLines() {},
    roomLabelPoint: EPGeom.roomLabelPoint, roomNamePoint: EPGeom.roomNamePoint,
    uid: p => p + (++ctx._uidn), _uidn: 0,
    notices: { prune() {} },   /* undoPlan зовёт notices.prune() (Б9/2б) — заглушка */
    _history: EPHistory.create(50), _applyingSnapshot: false, _historyAmend: false, _histBusy: false, _gestureActive: false,
    _autosaveOn: true, _saveTimer: null, _roomsTimer: null, _roomsJustScheduled: false, _fieldEditEl: null,
    mountedRoomId: null, _lastIconPlacement: null, _placeOnPostIcon: null
  };
  ctx.renderAll = () => ctx.scheduleSave();
  const code = ["projectSnapshot", "captureHistory", "syncHistoryUi", "persistProject", "scheduleSave",
    "applyPlanUnderlay", "applyPlanSnapshot", "flushPendingRoomBuild", "undoPlan", "redoPlan",
    "refreshAfterRoomAssignments", "wallRadiusFor", "carryUserRoomFields", "buildRoomsFromLines",
    "scheduleRoomsFromLines"].map(stand.functionSource).join("\n") + "\n;({});";
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  ctx._autosaveOn = true;
  ctx._history.reset(ctx.projectSnapshot()); ctx.syncHistoryUi();
  const runTimers = () => { const all = [...timers.entries()]; timers.clear(); all.forEach(([, fn]) => fn()); };
  const depth = () => { let n = 0; const h = ctx._history; while (h.canUndo()) { h.undo(); n++; } for (let i = 0; i < n; i++) h.redo(); return n; };
  const redoDepth = () => { let n = 0; const h = ctx._history; while (h.canRedo()) { h.redo(); n++; } for (let i = 0; i < n; i++) h.undo(); return n; };
  /* клик инструментом «Разметка» в reordered-порядке handler'а: scheduleRoomsFromLines ДО scheduleSave */
  const click = l => { state.roomLines.push(l); ctx.scheduleRoomsFromLines(); ctx.scheduleSave(); };
  return { ctx, state, runTimers, timers, depth, redoDepth, click };
}
const L = (id, ax, ay, bx, by) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
const contour = a => { [L("l1", 0, 0, 200, 0), L("l2", 200, 0, 200, 200), L("l3", 200, 200, 0, 200), L("l4", 0, 200, 0, 0)].forEach(a.click); a.runTimers(); };

test("4 клика контура + таймер пересборки = 4 шага (а не 5); 1-й Ctrl+Z снимает последнюю линию, без комнаты-призрака", () => {
  const a = makeRoomApp();
  [L("l1", 0, 0, 200, 0), L("l2", 200, 0, 200, 200), L("l3", 200, 200, 0, 200), L("l4", 0, 200, 0, 0)].forEach(a.click);
  assert.equal(a.depth(), 4, "4 клика — 4 шага (пересборка ещё не сработала)");
  assert.equal(a.state.rooms.length, 0, "до таймера комнаты нет");
  a.runTimers();   // прошло 600 мс — таймер пересборки
  assert.equal(a.depth(), 4, "таймер пересборки ДОПОЛНИЛ 4-й шаг (amend), не создал 5-й");
  assert.equal(a.state.rooms.length, 1, "контур замкнут — комната появилась");
  assert.equal(a.ctx._roomsTimer, null, "таймер обнулён при срабатывании (Б4 п.2)");
  a.ctx.undoPlan();
  assert.equal(a.state.roomLines.length, 3, "1-й Ctrl+Z снял последнюю линию");
  assert.equal(a.state.rooms.length, 0, "и комната ушла с ней — не осталась призраком на открытом контуре");
});

test("пост поставлен ДО срабатывания таймера: пересборка дополняет шаг контура, Ctrl+Z снимает ТОЛЬКО пост (s4)", () => {
  const a = makeRoomApp();
  [L("l1", 0, 0, 200, 0), L("l2", 200, 0, 200, 200), L("l3", 200, 200, 0, 200), L("l4", 0, 200, 0, 0)].forEach(a.click);
  // пост ставится раньше 600 мс — таймер пересборки ещё висит
  a.state.posts.push({ id: "p1", x: 50, y: 50, number: 1 }); a.ctx.renderAll();
  assert.equal(a.state.rooms.length, 1, "перед фиксацией шага-поста captureHistory выполнил пересборку (дополнив шаг контура)");
  a.ctx.undoPlan();
  assert.equal(a.state.posts.length, 0, "Ctrl+Z снял пост");
  assert.equal(a.state.rooms.length, 1, "комната осталась — она в шаге контура, не в шаге поста");
  assert.equal(a.state.roomLines.length, 4, "линии контура на месте");
});

test("Б4 п.2: удалил авто-комнату → Z → Y → комната удалена (таймер не оживляет её на текущей голове)", () => {
  const a = makeRoomApp();
  contour(a);
  assert.equal(a.state.rooms.length, 1);
  a.state.rooms = []; a.ctx.renderAll();   // removeEntity("room") → renderAll
  assert.equal(a.state.rooms.length, 0, "комната удалена");
  a.ctx.undoPlan(); assert.equal(a.state.rooms.length, 1, "Ctrl+Z вернул комнату");
  a.ctx.redoPlan(); assert.equal(a.state.rooms.length, 0, "Ctrl+Y снова удалил — таймер не пересобрал её под amend");
});

test("Б4 п.2: «Определить комнаты» поверх разметки → Z → Y → остаются распознанные, не подменены линиями", () => {
  const a = makeRoomApp();
  contour(a);
  a.state.rooms = a.state.rooms.filter(r => !r.autoPolygon);
  a.state.rooms.push({ id: "cv1", name: "Комната 1", polygon: [{ x: 300, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 400 }, { x: 300, y: 400 }], autoPolygon: true });
  a.ctx.renderAll();   // detectRooms → scheduleSave
  assert.deepEqual(a.state.rooms.map(r => r.id), ["cv1"]);
  a.ctx.undoPlan(); a.ctx.redoPlan();
  assert.deepEqual(a.state.rooms.map(r => r.id), ["cv1"], "Ctrl+Z,Ctrl+Y вернули распознанную, а не пересобранную из линий");
});

test("Б4 п.3: перенос — отложенный автосейв ПОСРЕДИ жеста не фиксирует промежуточное положение; шаг на отпускании", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 100, y: 100, number: 1 }); a.ctx.renderAll();   // шаг: поставил (x=100)
  const depth0 = a.undoDepth();
  a.ctx.beginGesture();                 // пошёл перенос (makeDraggable onMove → dragging)
  a.state.posts[0].x = 150;             // объект мутируется по ходу движения
  a.ctx.persistProject();               // отложенный автосейв от постановки сработал ПОСРЕДИ жеста
  a.state.posts[0].x = 300;             // тащим дальше
  a.ctx.endGesture();                   // отпустили (endInteraction)
  a.ctx.scheduleSave();                 // finishDrag → scheduleSave (единственный шаг жеста)
  assert.equal(a.undoDepth(), depth0 + 1, "перенос дал РОВНО один шаг (промежуточный 150 не зафиксирован)");
  a.ctx.undoPlan();
  assert.equal(a.state.posts[0].x, 100, "Ctrl+Z вернул точку ПОСТАНОВКИ, а не промежуточные 150");
});

test("Б4 п.6: удержание стрелки — один шаг (Ctrl+Z возвращает исходную точку); отдельные нажатия — отдельные шаги", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 0, y: 0, number: 1 }); a.state.selected = { kind: "post", id: "p1" };
  a.ctx.renderAll();                    // базовый шаг с постом x=0
  const depth0 = a.undoDepth();
  a.ctx.moveSelectedByKey({ key: "ArrowRight", shiftKey: false, repeat: false });        // первое нажатие — открывает шаг
  for (let i = 0; i < 59; i++) a.ctx.moveSelectedByKey({ key: "ArrowRight", shiftKey: false, repeat: true });  // автоповторы
  assert.equal(a.state.posts[0].x, 600, "60 сдвигов по шагу сетки 10 = +600");
  assert.equal(a.undoDepth(), depth0 + 1, "удержание = ОДИН шаг (автоповторы дополнили первый)");
  a.ctx.undoPlan();
  assert.equal(a.state.posts[0].x, 0, "Ctrl+Z вернул исходную точку одним шагом");
  a.state.selected = { kind: "post", id: "p1" };   // undoPlan снимает выделение (R7) — выбираем снова
  const d1 = a.undoDepth();
  a.ctx.moveSelectedByKey({ key: "ArrowRight", shiftKey: false, repeat: false });
  a.ctx.moveSelectedByKey({ key: "ArrowRight", shiftKey: false, repeat: false });
  assert.equal(a.undoDepth(), d1 + 2, "два отдельных нажатия (repeat:false) остаются двумя шагами");
});

test("Б4 п.6: поток ввода в поле высоты — один шаг; после потери фокуса следующая правка — новый шаг", () => {
  const a = makeApp();
  a.state.devices.push({ id: "d1", x: 1, y: 1, height: "" }); a.ctx.renderAll();   // базовый шаг
  const d = a.state.devices[0], depth0 = a.undoDepth();
  const el = { field: "propHeight" };   // «тот же элемент поля» — одна ссылка на всём потоке ввода
  for (const ch of "1100 мм") { d.height += ch; a.ctx.fieldInputSave(el); }
  assert.equal(a.undoDepth(), depth0 + 1, "весь поток ввода «1100 мм» — ОДИН шаг");
  assert.equal(d.height, "1100 мм");
  a.ctx.undoPlan();
  assert.equal(a.state.devices[0].height, "", "Ctrl+Z убрал всю правку высоты одним шагом");
  a.ctx.redoPlan();                     // вернуть «1100 мм»
  const before = a.undoDepth();
  a.ctx.endFieldEdit();                 // blur закрыл поток
  a.state.devices[0].height = "1100 мм!"; a.ctx.fieldInputSave(el);   // тот же el, но поток закрыт → отдельный шаг
  assert.equal(a.undoDepth(), before + 1, "после потери фокуса правка того же поля — новый шаг");
});

/* ======================= Б5 ч.2: удаление и сдвиг стрелками ГРУППЫ постов =======================
   Деньги проверяем на уровне плана (как и весь файл): равный planKey ⇒ равная сумма. Литеральные ₽ и
   пересчёт roomId у перешедшего границу поста проверяет браузерный хвост tools/qa/tails/select.txt. */
test("Б5 ч.2: Delete по группе — removePosts удаляет ВСЕ выделенные ОДНИМ шагом; Ctrl+Z возвращает все", () => {
  const a = makeApp();
  const keyBefore = a.key();
  a.state.posts.push({ id: "p1", x: 0, y: 0, number: 1, frameId: "f", mechanismIds: ["m"] },
    { id: "p2", x: 10, y: 0, number: 2, frameId: "f", mechanismIds: ["m"] },
    { id: "p3", x: 20, y: 0, number: 3, frameId: "f", mechanismIds: ["m"] });
  a.ctx.renderAll();                                   // базовый шаг: три поста
  const keyThree = a.key();
  const depth0 = a.undoDepth();
  a.state.selected = { kind: "posts", ids: ["p1", "p3"] };
  a.ctx.removePosts(a.state.selected.ids);
  assert.deepEqual(a.state.posts.map(p => p.id), ["p2"], "оба выделенных поста удалены, невыделенный остался");
  assert.equal(a.state.selected, null, "выделение снято после удаления");
  assert.equal(a.undoDepth(), depth0 + 1, "удаление группы — РОВНО один шаг истории (не N)");
  a.ctx.undoPlan();
  assert.deepEqual(a.state.posts.map(p => p.id).sort(), ["p1", "p2", "p3"], "один Ctrl+Z вернул все удалённые посты");
  assert.equal(a.key(), keyThree, "план (а значит и сумма сметы) вернулся к состоянию из трёх постов");
  assert.notEqual(keyThree, keyBefore, "контроль: три поста — это другой план, чем пустой");
});

test("Б5 ч.2: одиночный Delete поста по-прежнему один шаг (removeEntity не изменён)", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 0, y: 0, number: 1 }, { id: "p2", x: 10, y: 0, number: 2 });
  a.ctx.renderAll();
  const depth0 = a.undoDepth();
  a.ctx.removeEntity("post", "p1");
  assert.deepEqual(a.state.posts.map(p => p.id), ["p2"], "удалён только выбранный пост");
  assert.equal(a.undoDepth(), depth0 + 1, "одиночное удаление — один шаг");
  a.ctx.undoPlan();
  assert.equal(a.state.posts.length, 2, "Ctrl+Z вернул пост");
});

test("Б5 ч.2: стрелка при группе сдвигает ВСЕ посты на одну дельту ОДНИМ шагом; Ctrl+Z возвращает все", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 0, y: 0, number: 1 }, { id: "p2", x: 100, y: 50, number: 2 });
  a.state.selected = { kind: "posts", ids: ["p1", "p2"] };
  a.ctx.renderAll();
  const depth0 = a.undoDepth();
  a.ctx.moveSelectedByKey({ key: "ArrowRight", shiftKey: false, repeat: false });   // шаг сетки 10, угол 0 → (+10,0)
  assert.deepEqual([a.state.posts[0].x, a.state.posts[1].x], [10, 110], "оба поста сдвинуты на +10 по X");
  assert.deepEqual([a.state.posts[0].y, a.state.posts[1].y], [0, 50], "Y не изменился");
  assert.equal(a.undoDepth(), depth0 + 1, "одно нажатие стрелки по группе — один шаг");
  a.ctx.undoPlan();
  assert.deepEqual([a.state.posts[0].x, a.state.posts[1].x], [0, 100], "Ctrl+Z вернул оба поста в исходные точки");
});

test("Б5 ч.2: УДЕРЖАНИЕ стрелки при группе — один шаг (автоповторы дополняют первый, как у одиночного)", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 0, y: 0, number: 1 }, { id: "p2", x: 100, y: 0, number: 2 });
  a.state.selected = { kind: "posts", ids: ["p1", "p2"] };
  a.ctx.renderAll();
  const depth0 = a.undoDepth();
  a.ctx.moveSelectedByKey({ key: "ArrowRight", shiftKey: false, repeat: false });          // открывает шаг
  for (let i = 0; i < 59; i++) a.ctx.moveSelectedByKey({ key: "ArrowRight", shiftKey: false, repeat: true });   // автоповторы
  assert.deepEqual([a.state.posts[0].x, a.state.posts[1].x], [600, 700], "60 сдвигов по 10 = +600 у каждого");
  assert.equal(a.undoDepth(), depth0 + 1, "удержание стрелки по группе = ОДИН шаг");
  a.ctx.undoPlan();
  assert.deepEqual([a.state.posts[0].x, a.state.posts[1].x], [0, 100], "один Ctrl+Z вернул оба поста");
});

/* ======================= Б4, ч.Б: подложка-чертёж в отмене/возврате =======================
   loadChart воспроизводит РЕЗУЛЬТАТ успешной загрузки чертежа (то, что applyImportedPlan делает в
   onload: bumpPlanToken, флаги, подпись, img.src), а ШАГ истории создаёт НАСТОЯЩИЙ persistProject —
   именно его откат/возврат и applyPlanUnderlay здесь предмет проверки. Что applyImportedPlan вообще
   зовёт persistProject (а значит, загрузка — отдельный шаг и переживает F5), сторожит отдельный
   структурный тест ниже: саму функцию в node не исполнить (её onload стреляет только в браузере, а
   вырезка тела тянет за собой обработчики загрузки файла). */
const URL_A = "data:image/png;base64," + "QUJD".repeat(40);
const URL_B = "data:image/jpeg;base64," + "Z".repeat(200) + "end";
function loadChart(a, url, name) {
  a.ctx.bumpPlanToken();
  a.state.planLoaded = true; a.state.planLabel = name;
  a.state.planVisibility = "show"; a.state.planRotation = 0;
  a.dom.els.planImage.src = url;
  a.ctx.persistProject();   // как applyImportedPlan в конце onload — отдельный шаг
}

test("загрузка чертежа — отдельный шаг; undo убирает чертёж, redo возвращает", () => {
  const a = makeApp();
  loadChart(a, URL_A, "plan1.png");
  assert.equal(a.state.planLoaded, true, "после загрузки чертёж на месте");
  assert.equal(a.dom.els.planImage.src, URL_A, "растр в #planImage");
  assert.ok(a.ctx._history.canUndo(), "загрузка записалась ОТДЕЛЬНЫМ шагом");
  a.ctx.undoPlan();
  assert.equal(a.state.planLoaded, false, "undo убрал чертёж");
  assert.equal(a.dom.els.planImage.src, "", "img.src снят");
  a.ctx.redoPlan();
  assert.equal(a.state.planLoaded, true, "redo вернул чертёж");
  assert.equal(a.dom.els.planImage.src, URL_A, "тот же растр");
});

test("applyImportedPlan зовёт persistProject после загрузки (загрузка = шаг и переживает F5)", () => {
  /* Структурный сторож (как roomFieldMemoryWiring): привязываем persistProject к ЕДИНСТВЕННОМУ месту
     в onload — между markCanvasUsed() и updateStatus('План загружен…'). Мутация, снявшая этот вызов,
     рвёт цепочку. Якоря уникальны для applyImportedPlan, поэтому persistProject из соседних обработчиков
     (clearBtn и т.п.) совпадение не даст. Источник — стрипнутый (комментарии убраны). */
  assert.match(stand.SRC,
    /markCanvasUsed\(\);\s*persistProject\(\);\s*const suffix=result\.detail/,
    "в onload applyImportedPlan между markCanvasUsed и updateStatus должен стоять persistProject()");
});

test("загрузка второго чертежа поверх первого → undo → первый чертёж", async () => {
  const a = makeApp();
  await loadChart(a, URL_A, "a.png");
  await loadChart(a, URL_B, "b.png");
  assert.equal(a.dom.els.planImage.src, URL_B, "виден второй");
  assert.equal(a.state.planLabel, "b.png");
  a.ctx.undoPlan();
  assert.equal(a.dom.els.planImage.src, URL_A, "undo вернул ПЕРВЫЙ чертёж");
  assert.equal(a.state.planLabel, "a.png", "и его подпись");
});

test("Б4 п.4: ТОТ ЖЕ растр под другим именем — undo возвращает подпись (applyPlanUnderlay применяет её и при совпадении растра)", () => {
  const a = makeApp();
  loadChart(a, URL_A, "plan.png");        // шаг 1
  loadChart(a, URL_A, "plan (1).png");    // шаг 2: тот же растр, другое имя файла (s6)
  assert.equal(a.state.planLabel, "plan (1).png");
  const touchesBefore = a.dom.els.planImage.touches, bumpBefore = a.spies.bump;
  a.ctx.undoPlan();
  assert.equal(a.state.planLabel, "plan.png", "подпись откатилась, хотя растр не менялся — иначе автосейв стёр бы «Вернуть»");
  assert.equal(a.dom.els.planImage.touches, touchesBefore, "img.src при совпадении растра НЕ трогали");
  assert.equal(a.spies.bump, bumpBefore, "bumpPlanToken при совпадении растра НЕ дёргали");
});

test("«Убрать план» → undo → растр, подпись, угол и видимость вернулись; redo → снова убран; посты не задеты", async () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 1, y: 2, number: 1 });   // пост должен пережить clear+undo
  await loadChart(a, URL_A, "plan1.png");                     // шаг: загрузка (rot 0, vis show)
  a.state.planRotation = 90; a.ctx.persistProject();          // шаг: повернули подложку
  a.state.planVisibility = "dim"; a.ctx.persistProject();     // не шаг, но голова освежается видимостью «dim»
  const touchesBeforeClear = a.dom.els.planImage.touches;
  a.ctx.clearPlan();                                          // «Убрать план» — ОДИН шаг
  assert.equal(a.state.planLoaded, false, "план убран");
  assert.equal(a.dom.els.planImage.src, "", "растр снят");
  a.ctx.undoPlan();
  assert.equal(a.state.planLoaded, true, "undo вернул подложку");
  assert.equal(a.dom.els.planImage.src, URL_A, "тот же растр (та же строка)");
  assert.equal(a.state.planLabel, "plan1.png", "подпись вернулась");
  assert.equal(a.state.planRotation, 90, "угол подложки вернулся");
  assert.equal(a.state.planVisibility, "dim", "видимость, что была ДО удаления, вернулась");
  assert.equal(a.state.posts.length, 1, "посты clear/undo не задели");
  assert.ok(a.dom.els.planImage.touches > touchesBeforeClear, "возврат растра реально тронул img.src");
  a.ctx.redoPlan();
  assert.equal(a.state.planLoaded, false, "redo снова убрал план");
  assert.equal(a.dom.els.planImage.src, "", "растр снова снят");
});

test("шаг БЕЗ смены подложки не трогает img.src и не дёргает bumpPlanToken (шпион)", async () => {
  const a = makeApp();
  await loadChart(a, URL_A, "a.png");
  a.state.walls.push({ id: "w1", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } });
  a.ctx.renderAll();                                // шаг: стена (подложка та же)
  const touches0 = a.dom.els.planImage.touches, bump0 = a.spies.bump;
  a.ctx.undoPlan();                                 // откат стены — подложка не меняется
  assert.equal(a.state.walls.length, 0, "стена откатилась");
  assert.equal(a.dom.els.planImage.touches, touches0, "img.src не трогали (та же подложка)");
  assert.equal(a.spies.bump, bump0, "bumpPlanToken не вызывали (та же подложка)");
  a.ctx.redoPlan();
  assert.equal(a.dom.els.planImage.touches, touches0, "и при возврате стены img.src не трогали");
  assert.equal(a.spies.bump, bump0, "и bumpPlanToken не вызывали");
});

test("bumpPlanToken дёргается ТОЛЬКО при смене подложки (не на обычном откате)", async () => {
  const a = makeApp();
  await loadChart(a, URL_A, "a.png");
  a.state.posts.push({ id: "p1", x: 1, y: 2, number: 1 }); a.ctx.renderAll();   // не-подложечный шаг
  const b0 = a.spies.bump;
  a.ctx.undoPlan(); a.ctx.redoPlan();               // подложка та же
  assert.equal(a.spies.bump, b0, "откат/возврат без смены подложки токен не трогают");
  a.ctx.clearPlan();                                // смена подложки (убрали) — токен дёрнулся
  const b1 = a.spies.bump;
  assert.ok(b1 > b0, "clearPlan дёрнул токен");
  a.ctx.undoPlan();                                 // возврат подложки — снова смена → токен дёрнулся
  assert.ok(a.spies.bump > b1, "возврат растра дёрнул токен");
});

test("Б4 п.1: Ctrl+Z ДО срабатывания таймера сам доводит пересборку (undoPlan флашит перед откатом)", () => {
  const a = makeRoomApp();
  [L("l1", 0, 0, 200, 0), L("l2", 200, 0, 200, 200), L("l3", 200, 200, 0, 200), L("l4", 0, 200, 0, 0)].forEach(a.click);
  assert.equal(a.state.rooms.length, 0, "таймер ещё висит — комнаты нет");
  a.ctx.undoPlan();                 // flush пересборки ДО отката → шаг контура дополнен комнатой
  a.ctx.redoPlan();                 // redo возвращает шаг контура уже С комнатой
  assert.equal(a.state.rooms.length, 1, "undoPlan выполнил пересборку перед откатом (иначе комната родилась бы на откаченных линиях)");
  assert.equal(a.ctx._roomsTimer, null, "таймер снят");
});

test("Б4 R7: применение снимка сбрасывает эфемерное (выделение, незаконченная стена, режим размещения)", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 1, y: 2, number: 1 }); a.ctx.renderAll();   // шаг
  a.state.selected = { kind: "post", id: "p1" }; a.state.wallPoints = [{ x: 1, y: 1 }]; a.state.pending = { type: "device" };
  a.ctx.undoPlan();
  assert.equal(a.state.selected, null, "выделение сброшено");
  assert.equal(a.state.wallPoints.length, 0, "незаконченная стена сброшена");
  assert.equal(a.state.pending, null, "режим размещения сброшен");
});

test("Б4: undo/redo защищены от повторного входа при удержании (_histBusy)", () => {
  const a = makeApp();
  a.state.posts.push({ id: "p1", x: 0, y: 0, number: 1 }); a.ctx.renderAll();   // шаг1 (x=0)
  a.state.posts[0].x = 10; a.ctx.renderAll();                                   // шаг2 (x=10)
  let reentered = false;
  a.ctx.renderProperties = () => { if (!reentered) { reentered = true; a.ctx.undoPlan(); } };   // повторный вход изнутри applyPlanSnapshot
  a.ctx.undoPlan();
  assert.ok(reentered, "повторный вход был предпринят");
  assert.equal(a.state.posts[0].x, 0, "выполнен РОВНО один шаг назад (повторный вход заблокирован _histBusy), а не два до базы");
});

test("Б4 п.2: roomFieldMemory откатывается и возвращается вместе с планом", () => {
  const a = makeApp();
  a.state.roomFieldMemory = []; a.ctx.renderAll();                              // база без памяти
  a.state.roomFieldMemory = [{ roomKey: "k1", name: "Кухня", area: "12" }]; a.ctx.renderAll();   // шаг с памятью
  a.ctx.undoPlan();
  assert.equal(a.state.roomFieldMemory.length, 0, "память полей откатилась");
  a.ctx.redoPlan();
  assert.equal(a.state.roomFieldMemory.length, 1, "и вернулась");
});

test("Б4 ч.Б: устаревший onload подложки (сменился planToken) НЕ зовёт applyPlanRotation", () => {
  const a = makeApp();
  loadChart(a, URL_A, "a.png");
  loadChart(a, URL_B, "b.png");
  a.ctx.undoPlan();                      // applyPlanUnderlay(A): растр сменился → повесил img.onload с текущим токеном
  assert.equal(typeof a.dom.els.planImage.onload, "function", "onload взведён на смене растра");
  const rot0 = a.spies.rotate || 0;
  a.ctx.bumpPlanToken();                 // пришло более новое действие (ещё откат/очистка) — токен сменился
  a.dom.els.planImage.onload();          // браузер только теперь дозагрузил УСТАРЕВШИЙ растр
  assert.equal(a.spies.rotate || 0, rot0, "applyPlanRotation НЕ вызван — токен устарел (гонка обезврежена)");
});

test("50 шагов с одной подложкой держат ОДНУ строку (а не 50 копий)", () => {
  /* ⚠️ Модель БРАУЗЕРА: там img.src отдаёт РАЗНЫЙ экземпляр одного и того же data-URL на каждом чтении,
     и без переиспользования в стеке осело бы 50 копий многомегабайтной строки. В node V8 дедуплицирует
     равные строковые ПРИМИТИВЫ (любые две равные по содержимому строки оказываются ===), поэтому
     «копия/ссылка» на примитивах неразличима. Чтобы идентичность стала наблюдаемой — используем обёртки
     new String(url): это разные ОБЪЕКТЫ равного содержимого (как разные экземпляры из img.src). planFp
     видит их содержимое (String(src)), а стек обязан вернуть ПЕРВУЮ обёртку, а не свои копии. */
  const url = "data:image/png;base64," + "Q".repeat(600);
  const S0 = new String(url);
  const base = {
    devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [], roomFieldMemory: [],
    pxPerMeter: null, scaleSegment: null, planRotation: 0, worldAngle: 0, planVisibility: "show", planLabel: "a.png"
  };
  const h = EPHistory.create(50);
  h.reset(Object.assign({}, base, { plan: S0 }));
  for (let i = 1; i <= 50; i++) {
    const fresh = new String(url);                  // отдельный объект того же содержимого (как свежий img.src)
    assert.ok(fresh !== S0, "фикстура честная: экземпляры строки разные");
    h.push(Object.assign({}, base, { plan: fresh, walls: Array.from({ length: i }, (_, k) => ({ id: "w" + k })) }));
  }
  const refs = [];
  let p;
  while ((p = h.undo())) refs.push(p.plan);
  assert.equal(refs.length, 50, "накопили 50 шагов");
  for (const r of refs) assert.ok(r === S0, "каждый шаг отдаёт ПЕРВУЮ строку (переиспользование по ссылке), а не свою копию");
});
