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
    renderSummary() {}, updateScaleUi() {}, applyPlanRotation() {}, renderScaleRuler() {},
    /* подложка (ч.Б): bumpPlanToken со счётчиком — проверяем, что токен дёргается ТОЛЬКО при смене
       подложки; updatePlanUi/applyPlanVisibility — заглушки (их эффект на DOM здесь не предмет) */
    bumpPlanToken() { spies.bump++; state.planToken = (state.planToken || 0) + 1; },
    updatePlanUi() {}, applyPlanVisibility() {},
    /* соседи clearPlan/applyImportedPlan, не относящиеся к истории */
    clearAnnotations() { state.detections = null; }, markCanvasUsed() {}, updateStatus() {}, toast() {},
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
    "applyPlanUnderlay", "applyPlanSnapshot", "flushPendingRoomBuild", "undoPlan", "redoPlan",
    "clearPlan"].map(stand.functionSource).join("\n")
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
