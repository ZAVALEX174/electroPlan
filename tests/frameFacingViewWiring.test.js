/* ПОВЕДЕНЧЕСКИЙ тест второго ВИДА отделки («С картинками»): переключатель в свойствах комнаты и
   запись мастера. Главное, что проверяем (§7.1, требование блока): мастер — второй ВИД, а не второе
   правило. Он читает/пишет ТЕ ЖЕ поля комнаты (collection/frameMaterial/frameShape/frameColor), что
   и вид-список, а выбранный ВИД лежит в EPPrefs (привычка человека), не в проекте.

   Исполняем НАСТОЯЩИЙ текст renderProperties/applyFramePicker из app.js в vm (общий стенд), как
   остальные *Wiring-тесты, — копии логики не держим.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     frameFacingView всегда "list" (игнорит EPPrefs)              → красит «вид С картинками: кнопка мастера вместо селекторов»;
     applyFramePicker: room[s.prop]=v всегда (убрать `if(v)`)     → красит «Применить пишет заданные признаки» (пустой не снят);
     applyFramePicker: убрать `else delete room[s.prop]`         → красит «Применить СНИМАЕТ пустой признак» (старый цвет остался);
     applyFramePicker без persistProject()                       → красит «Применить сохраняет проект».
   В3 (строка «Стандарт: …» над кнопкой мастера в виде «С картинками»):
     строка только у заданного стандарта (пусто → "")              → красит «В3 не задан», «В3 мёртвый стандарт», «В3 поток»;
     всегда «не задан» (заданный стандарт не показан)              → красит «В3 задан», «В3 сводка», «В3 поток»;
     код вместо слова (roomStd||"не задан")                        → красит «В3 задан», «В3 сводка», «В3 поток»;
     сырой r.standard вместо валидированного roomStd               → красит «В3 мёртвый стандарт»;
     стандарт снова в общей сводке                                 → красит «В3 сводка» (дубль);
     строка под кнопкой, а не над ней                              → красит «В3 не задан», «В3 задан», «В3 мёртвый стандарт», «В3 поток» (порядок в standardLine).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPRoom = require("../js/room.js");
const EPCatalog = require("../js/catalog.js");
const EPFramePicker = require("../js/framePicker.js");
const EPLightingGroups = require("../js/lightingGroups.js");

/* Обогащённый каталог — как в браузере: catalog-vimar.js → catalog-vimar-attrs.js → data.js (тот же
   порядок, что index.html). Отделка (frameMaterial/frameShape/frameColor) подмешивается data.js;
   сырой catalog-vimar.js её не несёт, поэтому loadVimarCatalog тут не годится. */
const JS_DIR = path.join(__dirname, "..", "js");
const win = {};
const ctx0 = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), "utf8"), ctx0, { filename: f });
}
let PRODUCTS;
test("подготовка: обогащённый каталог получен через DataService (как в браузере)", async () => {
  PRODUCTS = await win.DataService.getProducts();
  assert.ok(PRODUCTS.length > 2000, "каталог загружен");
});
const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };

/* --- Вид «С картинками» в свойствах комнаты: кнопка мастера вместо селекторов --- */
function renderRoomView(view, room) {
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomCollectionSelect", "roomSchemeSelect"] });
  const props = stand.makeElement();
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    flushRoomDraft: spy(),
    updateSelectionCount: () => {},   /* Б5: «Выделено: N» — здесь не проверяется */
    renderTemplates: () => {},   /* renderProperties синхронит библиотеку готовых постов; здесь не проверяется */
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(),
    getObjectsInRoom: () => [],
    roomAutoAreaText: () => "",
    polygonAreaPx: () => 0,
    lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog,
    /* EPPrefs отдаёт запрошенный вид — привычка человека; тест доказывает, что renderProperties им
       управляется (а не проектом). */
    EPPrefs: { get: (k, fb) => (k === "frameFacingView" ? view : fb), set: () => {} },
    setTool: spy(),
    persistProject: spy(), renderSummary: spy(), renderAll: spy(),
    mountedRoomId: null
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView", "renderProperties"], ctx)();
  return props.innerHTML;
}

test("вид «С картинками»: на месте селекторов — кнопка «Подобрать накладку», выбор виден сводкой", () => {
  const html = renderRoomView("pictures", { id: "r1", name: "Гостиная", polygon: null, collection: "Eikon Evo", frameMaterial: "Металл" });
  assert.match(html, /id="roomFramePickerBtn"/, "кнопка мастера есть");
  assert.match(html, /Подобрать накладку/);
  assert.doesNotMatch(html, /id="roomCollectionSelect"/, "селекторов коллекции/отделки в этом виде нет");
  assert.doesNotMatch(html, /id="room_frameMaterialSelect"/);
  /* «Что выбрано в одном виде, видно в другом»: сводка называет действующие серию и материал. */
  assert.match(html, /Eikon Evo/, "сводка показывает серию комнаты");
  assert.match(html, /Металл/, "сводка показывает материал комнаты");
});

test("вид «Списком»: селекторы на месте, кнопки мастера нет — тот же переключатель, другой вид", () => {
  const html = renderRoomView("list", { id: "r1", name: "Гостиная", polygon: null, collection: "Eikon Evo", frameMaterial: "Металл" });
  assert.match(html, /id="roomCollectionSelect"/, "селектор коллекции на месте");
  assert.match(html, /id="room_frameMaterialSelect"/);
  assert.doesNotMatch(html, /id="roomFramePickerBtn"/, "кнопки мастера в виде-списке нет");
});

test("переключатель есть в ОБОИХ видах, активна кнопка текущего вида", () => {
  const pics = renderRoomView("pictures", { id: "r1", name: "К", polygon: null });
  assert.match(pics, /id="roomFacingViewPictures"[^>]*class="room-facing-view-btn active"/, "в виде-картинках активна «С картинками»");
  assert.match(pics, /id="roomFacingViewList" class="room-facing-view-btn"/, "«Списком» не активна");
  const list = renderRoomView("list", { id: "r1", name: "К", polygon: null });
  assert.match(list, /id="roomFacingViewList" class="room-facing-view-btn active"/);
});

/* --- «Применить» пишет ТЕ ЖЕ поля комнаты, что и вид-список --- */
test("applyFramePicker пишет заданные признаки и СНИМАЕТ незаданные — те же поля комнаты", () => {
  const room = { id: "r1", name: "Гостиная", collection: "Старая серия", frameColor: "Чёрный" };
  const dom = stand.makeDom();
  const persistProject = spy(), renderProperties = spy();
  const ctx = {
    framePickerRoomId: "r1",
    framePickerSel: { collection: "Arke", frameMaterial: "Металл" },
    framePickerStep: 2,
    EPFramePicker,
    state: { rooms: [{ id: "r0", name: "Другая" }, room] },
    persistProject, renderProperties,
    $: dom.$
  };
  stand.run(["closeFramePicker", "applyFramePicker"], ctx)();
  assert.equal(room.collection, "Arke", "серия записана в комнату");
  assert.equal(room.frameMaterial, "Металл", "материал записан");
  assert.ok(!("frameColor" in room), "незаданный цвет СНЯТ (delete), а не оставлен старым");
  assert.ok(!("frameShape" in room), "незаданная форма не появилась");
  assert.equal(persistProject.calls, 1, "проект сохранён");
  assert.equal(renderProperties.calls, 1, "карточка перерисована — сводка/селекторы обновятся");
});

test("applyFramePicker бьёт по ВЫДЕЛЕННОЙ комнате мастера, не по первой", () => {
  const decoy = { id: "r0", name: "Другая", collection: "Decoy" };
  const target = { id: "r1", name: "Цель" };
  const dom = stand.makeDom();
  const ctx = {
    framePickerRoomId: "r1", framePickerSel: { collection: "Plana" }, framePickerStep: 0,
    EPFramePicker, state: { rooms: [decoy, target] },
    persistProject: spy(), renderProperties: spy(), $: dom.$
  };
  stand.run(["closeFramePicker", "applyFramePicker"], ctx)();
  assert.equal(target.collection, "Plana", "запись ушла в комнату мастера");
  assert.equal(decoy.collection, "Decoy", "первая комната не тронута");
});

/* --- В3: строка «Стандарт: …» над кнопкой «Подобрать накладку» в виде «С картинками» ---
   Владелец (24.09) не нашёл слово «Стандарт», пока стандарт не выбран: сводка называла его только
   заданным. Утверждено 29.09: строка над кнопкой стоит ВСЕГДА — «не задан» либо название; название —
   то же слово, что в селекторе вида «Списком» (EPCatalog.standardLabel), а не вторая копия. */
function standardLine(html) {
  const found = [...html.matchAll(/<div class="([^"]*\broom-facing-standard\b[^"]*)">([^<]*)<\/div>/g)];
  assert.equal(found.length, 1, "строка «Стандарт: …» в виде «С картинками» ровно одна");
  assert.ok(html.indexOf('id="roomFramePickerBtn"') > found[0].index, "строка стоит НАД кнопкой «Подобрать накладку»");
  return { own: /\bown\b/.test(found[0][1]), text: found[0][2] };
}

/* «Живая» панель комнаты: выбранный вид лежит в общих prefs (как EPPrefs в браузере), а
   renderProperties/applyFramePicker — настоящие, поэтому переключатель видов, селектор стандарта и
   «Применить» мастера перерисовывают ту же панель, что видит человек. */
function makeLive(room, view) {
  const prefs = { frameFacingView: view };
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomStandardSelect", "roomCollectionSelect", "roomSchemeSelect"] });
  const props = stand.makeElement();
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    flushRoomDraft: spy(), updateSelectionCount: () => {}, renderTemplates: () => {},
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(), getObjectsInRoom: () => [], roomAutoAreaText: () => "",
    polygonAreaPx: () => 0, lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog, EPFramePicker,
    EPPrefs: { get: (k, fb) => (k in prefs ? prefs[k] : fb), set: (k, v) => { prefs[k] = v; } },
    setTool: spy(), persistProject: spy(), renderSummary: spy(), renderAll: spy(),
    mountedRoomId: null
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView", "renderProperties",
    "closeFramePicker", "applyFramePicker"], ctx);
  ctx.renderProperties();
  const toView = v => dom.$(v === "list" ? "roomFacingViewList" : "roomFacingViewPictures").onclick();
  /* Черновик мастера кладём ВНУТРИ vm: стенд вырезает frameFacingView вместе с соседним
     `let framePickerRoomId…`, и эта привязка затеняет одноимённые свойства ctx — снаружи их не задать. */
  const applyWizard = sel => {
    vm.runInContext("framePickerRoomId=" + JSON.stringify(room.id) + ";framePickerSel=" + JSON.stringify(sel) + ";framePickerStep=0;", ctx);
    ctx.applyFramePicker();
  };
  return { ctx, dom, props, toView, applyWizard };
}

test("В3 не задан: строка «Стандарт: не задан» есть и без выбора — над кнопкой, без акцента", () => {
  const line = standardLine(renderRoomView("pictures", { id: "r1", name: "Гостиная", polygon: null }));
  assert.equal(line.text, "Стандарт: не задан");
  assert.ok(!line.own, "стандарт не задан — приглушённо, без класса own");
});

test("В3 задан: строка называет стандарт СЛОВОМ — тем же, что выбрано в селекторе вида «Списком»", () => {
  for (const [code, word] of [["IT", "итальянский"], ["DE", "немецкий"]]) {
    const room = { id: "r1", name: "Гостиная", polygon: null, standard: code };
    const line = standardLine(renderRoomView("pictures", room));
    assert.equal(line.text, "Стандарт: " + word, "слово, а не код " + code);
    assert.ok(line.own, "стандарт задан — акцент own");
    const select = renderRoomView("list", room).match(/id="roomStandardSelect">([\s\S]*?)<\/select>/)[1];
    const chosen = select.match(/<option value="([^"]+)" selected>([^<]*)<\/option>/);
    assert.ok(chosen, "в списке выбрана опция стандарта");
    assert.equal(line.text, "Стандарт: " + chosen[2], "строка и селектор называют стандарт одинаково (один источник)");
  }
});

test("В3 мёртвый стандарт (нет в каталоге): «не задан», как в списке; данные комнаты не тронуты", () => {
  const room = { id: "r1", name: "Гостиная", polygon: null, standard: "FR" };
  assert.equal(standardLine(renderRoomView("pictures", room)).text, "Стандарт: не задан");
  assert.equal(room.standard, "FR", "рендер только показывает «не задан», значение в проекте не портит");
});

test("В3 сводка: стандарт не дублируется, а пустая сводка при заданном стандарте не врёт «все накладки»", () => {
  const html = renderRoomView("pictures", { id: "r1", name: "Гостиная", polygon: null, standard: "IT", collection: "Eikon Evo" });
  assert.equal(html.split("Стандарт: итальянский").length - 1, 1, "название стандарта — один раз, в своей строке");
  assert.match(html, /Серия: Eikon Evo/, "серия в сводке на месте");
  const onlyStandard = renderRoomView("pictures", { id: "r1", name: "Гостиная", polygon: null, standard: "IT" });
  assert.doesNotMatch(onlyStandard, /все накладки каталога/, "стандарт уже сужает выдачу — «все накладки» было бы неправдой");
  assert.match(onlyStandard, /Серия, материал, форма и цвет не заданы/);
  const nothing = renderRoomView("pictures", { id: "r1", name: "Гостиная", polygon: null });
  assert.match(nothing, /Отделка не задана — предлагаются все накладки каталога/, "пустое состояние — прежний текст");
});

test("В3: вид «Списком» не менялся — своей строки «Стандарт: …» нет, селектор и подпись на месте", () => {
  const html = renderRoomView("list", { id: "r1", name: "Гостиная", polygon: null });
  assert.doesNotMatch(html, /room-facing-standard/, "отдельной строки в виде-списке нет");
  assert.doesNotMatch(html, /Стандарт: /);
  assert.match(html, /<label class="room-standard-field">Стандарт монтажа<select id="roomStandardSelect">/);
  assert.match(html, /Стандарт не задан — предлагаются накладки любого стандарта/);
});

test("В3 поток: строка показывает актуальное значение после выбора списком и мастером и при переключении видов", () => {
  const room = { id: "r1", name: "Гостиная", polygon: null };
  const { dom, props, toView, applyWizard } = makeLive(room, "pictures");
  assert.equal(standardLine(props.innerHTML).text, "Стандарт: не задан", "старт: вид «С картинками», стандарт не выбран");

  toView("list");
  assert.match(props.innerHTML, /id="roomStandardSelect"/, "переключились в «Списком»");
  dom.$("roomStandardSelect").onchange({ target: { value: "IT" } });
  toView("pictures");
  assert.equal(standardLine(props.innerHTML).text, "Стандарт: итальянский", "выбрали списком, вернулись в «С картинками»");

  applyWizard({ standard: "DE" });
  assert.equal(standardLine(props.innerHTML).text, "Стандарт: немецкий", "«Применить» мастера сразу обновляет строку");

  applyWizard({ collection: "Eikon Evo" });
  assert.equal(standardLine(props.innerHTML).text, "Стандарт: не задан", "мастер без стандарта снял его — строка «не задан»");
  toView("list"); toView("pictures");
  assert.equal(standardLine(props.innerHTML).text, "Стандарт: не задан", "и после круга по видам");
});
