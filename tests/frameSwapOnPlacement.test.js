/* ОТДЕЛКА-ПОРЯДОК, п.5 (решение владельца 16.09): готовый пост из памяти можно ставить в комнаты с
   ТЕМ ЖЕ ЦВЕТОМ накладки (серия не важна), а ПРИ ПОСТАНОВКЕ накладка меняется на накладку СЕРИИ
   комнаты той же модульности и цвета. Что владелец увидит: в списке готовых постов остаются только
   посты цвета выбранной комнаты; поставил такой пост — накладка стала накладкой серии этой комнаты,
   и в смету пошла именно она.

   Здесь четыре уровня:
   1) ЧИСТЫЙ — EPPosts.templateFrameColor / templateFitsRoomColor / pickRoomFrame (без state и DOM);
   2) СПИСОК — настоящий renderTemplates сужает библиотеку по цвету выбранной комнаты;
   3) ПОСТАНОВКА — настоящий addPending подменяет накладку через ОБЩИЙ отбор и НЕ ставит пост с чужой;
   4) ДЕНЬГИ — подменённая накладка доезжает до сметы (EPEstimate.build) и до цены поста (postCost).
   Уровни 3–4 — те самые связки, что на прошлых задачах дважды оставались не покрыты (см. постановку).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPPosts = require("../js/posts.js");
const EPEstimate = require("../js/estimate.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPLightingGroups = require("../js/lightingGroups.js");

/* --- Синтетический каталог: две серии, один цвет-гамма «Белая», разные модульности. Цветами и
   ценами управляем точно, а productsForRoom/frameSlotCount/facingColorKey исполняются НАСТОЯЩИЕ. --- */
const FA2 = { id: 100, kind: "frame", active: true, series: ["A"], frameColor: "Белая", slotCount: 2, price: 10, code: "A2", name: "A рамка белая 2М" };
const FA4 = { id: 104, kind: "frame", active: true, series: ["A"], frameColor: "Белая", slotCount: 4, price: 12, code: "A4", name: "A рамка белая 4М" };
const FB2 = { id: 200, kind: "frame", active: true, series: ["B"], frameColor: "Белая", slotCount: 2, price: 25, code: "B2", name: "B рамка белая 2М" };
const FB3 = { id: 201, kind: "frame", active: true, series: ["B"], frameColor: "Белая", slotCount: 3, price: 40, code: "B3", name: "B рамка белая 3М" };
const FB2K = { id: 202, kind: "frame", active: true, series: ["B"], frameColor: "Чёрная", slotCount: 2, price: 30, code: "B2K", name: "B рамка чёрная 2М" };
const M1 = { id: 300, kind: "mechanism", active: true, series: ["A", "B"], moduleSpan: 1, price: 5, code: "M1", name: "клавиша 1 модуль" };
const PRODUCTS = [FA2, FA4, FB2, FB3, FB2K, M1];
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byKind = kind => PRODUCTS.filter(p => p.kind === kind && p.active);

/* Шаблоны из памяти: белый на серии A (2 модуля) и чёрный. frameColor запомнен при сохранении. */
const T_WHITE = { id: "tW", name: "Пост белый", frameId: FA2.id, frameColor: "Белая", mechanismIds: [M1.id, M1.id] };
const T_BLACK = { id: "tK", name: "Пост чёрный", frameId: FB2K.id, frameColor: "Чёрная", mechanismIds: [M1.id, M1.id] };
const T_WIDE = { id: "t4", name: "Пост 4М", frameId: FA4.id, frameColor: "Белая", mechanismIds: [M1.id, M1.id, M1.id, M1.id] };
const ROOM_B_WHITE = { id: "rBw", name: "Гостиная", collection: "B", frameColor: "Белая" };
const ROOM_PLAIN = { id: "rP", name: "Кладовка" };   /* без серии и цвета — накладку не трогаем */

/* ============================ 1. ЧИСТЫЙ УРОВЕНЬ (EPPosts) ============================ */

test("templateFrameColor: сохранённый цвет главнее; иначе выводим из накладки; неизвестен → null", () => {
  const deps = { frameProduct: product };
  assert.equal(EPPosts.templateFrameColor({ frameColor: "Медь Матовая", frameId: FA2.id }, deps), "Медь Матовая",
    "сохранённый цвет шаблона переживает перезаливку прайса — берём его, а не выводим из frameId");
  assert.equal(EPPosts.templateFrameColor({ frameId: FA2.id }, deps), "Белая",
    "старый шаблон без сохранённого цвета — выводим из накладки по frameId");
  assert.equal(EPPosts.templateFrameColor({ frameId: 999 }, deps), null,
    "накладка снята/удалена из прайса → цвет неизвестен (null), а не выдуманный");
});

test("templateFitsRoomColor: null-цвет комнаты → всё; складка facingColorKey; неизвестный цвет скрыт", () => {
  const deps = { frameProduct: product, facingColorKey: EPCatalog.facingColorKey };
  assert.equal(EPPosts.templateFitsRoomColor(T_WHITE, null, deps), true,
    "комната без цвета / не выбрана → показываем ВСЁ (работу не блокируем, п.2)");
  // ЯКОРЬ на facingColorKey: цвет накладки «Белая» и род комнаты «Белый» — одна гамма ТОЛЬКО через складку
  assert.equal(EPPosts.templateFitsRoomColor({ frameColor: "Белая" }, "Белый", deps), true,
    "«Белая» (шаблон) и «Белый» (комната) — одна гамма через facingColorKey; равенство строк дало бы false");
  assert.notEqual(EPCatalog.facingColorKey("Белая"), EPCatalog.facingColorKey("Чёрная"));
  assert.equal(EPPosts.templateFitsRoomColor(T_BLACK, "Белая", deps), false, "чёрный пост под белую комнату не идёт");
  assert.equal(EPPosts.templateFitsRoomColor({ frameId: 999 }, "Белая", deps), false,
    "цвет шаблона неизвестен → цветной комнате не равен → не предлагаем (чужой накладки не покажем)");
});

test("pickRoomFrame: из пула серии комнаты берём накладку ТОЙ ЖЕ модульности; нет — null", () => {
  const deps = { frameProduct: product, frameSlotCount: EPCatalog.frameSlotCount };
  // пул серии B по цвету «Белая» = FB2 (2М) и FB3 (3М); шаблон 2-модульный (FA2) → берём FB2
  assert.equal(EPPosts.pickRoomFrame(FA2.id, [FB2, FB3], deps), FB2,
    "модульность шаблона (2) совпадает у FB2 — её и подставляем; мутация ===wanted→!==wanted вернула бы FB3");
  assert.equal(EPPosts.pickRoomFrame(FA2.id, [FB3], deps), null, "в пуле нет 2-модульной → null (пост не поставим)");
  assert.equal(EPPosts.pickRoomFrame(999, [FB2, FB3], deps), null, "модульность шаблона неизвестна → null");
});

test("pickRoomFrame: при совпадении модульности отвергает накладку, куда клавиши НЕ встают (правило конструктора)", () => {
  /* Клавиша серии B, две 2-модульные накладки одного цвета: FB2 (серия B — принимает) и FX2 (серия X —
     не принимает). У FX2 серия X НЕ пустая по совместимости (в пуле есть клавиша MX серии X), поэтому
     compatibleMechanisms не срывается в фолбэк «показать всё» и честно отвергает клавишу B. Это тот же
     набор, что строит конструктор (compatibleMechanisms(frame, allMechs)) — не своя копия сравнения. */
  const FX2 = { id: 400, kind: "frame", active: true, series: ["X"], frameColor: "Белая", slotCount: 2, code: "X2", name: "X рамка белая 2М" };
  const MB = { id: 500, kind: "mechanism", active: true, series: ["B"], moduleSpan: 1, code: "MB", name: "клавиша серии B" };
  const MX = { id: 501, kind: "mechanism", active: true, series: ["X"], moduleSpan: 1, code: "MX", name: "клавиша серии X" };
  const allMechs = [MB, MX];
  const lookup = id => [FB2, FB3, FX2, MB, MX].find(p => p.id === id) || product(id);
  const fitsMB = frame => { const c = EPCatalog.compatibleMechanisms(frame, allMechs.concat([MB])); return c.includes(MB); };
  const deps = { frameProduct: lookup, frameSlotCount: EPCatalog.frameSlotCount, frameFitsMechs: fitsMB };
  assert.equal(EPPosts.pickRoomFrame(FB2.id, [FX2, FB2], deps), FB2,
    "пул ставит несовместимую FX2 первой, но клавиша серии B в неё не встаёт → берём FB2; мутация «убрать && fitsMechs(f)» вернула бы FX2");
  assert.equal(EPPosts.pickRoomFrame(FB2.id, [FX2], deps), null,
    "в пуле только несовместимая по серии накладка → null: пост не поставим с несобираемым составом");
  assert.equal(EPPosts.pickRoomFrame(FB2.id, [FX2, FB2], { frameProduct: lookup, frameSlotCount: EPCatalog.frameSlotCount }),
    FX2, "контроль: без frameFitsMechs (старый вызов) решает только размер — берётся первая 2М (FX2)");
});

/* ============================ 2. СПИСОК: renderTemplates ============================ */

function renderLibrary(selected) {
  const dom = stand.makeDom();
  const state = { templates: [T_WHITE, T_BLACK], rooms: [ROOM_B_WHITE], products: PRODUCTS, selected };
  const ctx = {
    state, $: dom.$, esc: s => String(s == null ? "" : s),
    frameProduct: product, byKind,
    EPCatalog, EPRoom, EPPosts,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord,
    mechanismModulesTotal: ids => (ids || []).reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>",
    document: { querySelectorAll: () => [] }   /* привязку кнопок в этом тесте не проверяем */
  };
  stand.run(["frameFacingList", "renderTemplates"], ctx)();
  return dom.$("postLibrary").innerHTML;
}

test("★ renderTemplates: выбрана белая комната → в библиотеке ТОЛЬКО белый пост, чёрный скрыт", () => {
  const html = renderLibrary({ kind: "room", id: ROOM_B_WHITE.id });
  assert.match(html, /Пост белый/, "белый пост цвета комнаты остаётся");
  assert.doesNotMatch(html, /Пост чёрный/, "чёрный пост чужого цвета не предлагается");
});

test("★ renderTemplates: выбрана не комната (или ничего) → показываем ВСЁ (п.2)", () => {
  const all = renderLibrary(null);
  assert.match(all, /Пост белый/);
  assert.match(all, /Пост чёрный/, "без выбранной комнаты фильтра нет — оба поста на месте");
  const onPost = renderLibrary({ kind: "post", id: "px" });
  assert.match(onPost, /Пост чёрный/, "выбран пост, а не комната → тоже не сужаем");
});

test("renderTemplates: белая комната, а белых постов нет → честное сообщение с цветом, не «пока нет»", () => {
  const dom = stand.makeDom();
  const state = { templates: [T_BLACK], rooms: [ROOM_B_WHITE], products: PRODUCTS, selected: { kind: "room", id: ROOM_B_WHITE.id } };
  const ctx = {
    state, $: dom.$, esc: s => String(s == null ? "" : s),
    frameProduct: product, byKind, EPCatalog, EPRoom, EPPosts,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord,
    mechanismModulesTotal: () => 2, assembledPostHtml: () => "", document: { querySelectorAll: () => [] }
  };
  stand.run(["frameFacingList", "renderTemplates"], ctx)();
  const html = dom.$("postLibrary").innerHTML;
  assert.match(html, /Белая/, "назван цвет накладки комнаты, под который постов нет");
  assert.doesNotMatch(html, /пока нет/, "это НЕ «сохранённых постов пока нет» — посты есть, просто другого цвета");
});

/* ============================ 3. ПОСТАНОВКА: addPending ============================ */

const SWAP_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingLabels", "frameFacingSelectionLabels",
  "templateMechSeries", "frameSwapEmptyText", "roomCatalogFilter", "frameFitsTemplateMechs", "preferOwnFrame", "frameForRoomPlacement", "addPending"];

function placeTemplate({ template, room, catalog = EPCatalog, products = PRODUCTS }) {
  const prod = id => products.find(p => Number(p.id) === Number(id));
  const byKindL = kind => products.filter(p => p.kind === kind && p.active);
  const state = { pending: { type: "post", templateId: template.id }, posts: [], devices: [], templates: [template], rooms: room ? [room] : [], products };
  const toasts = [];
  const ctx = {
    state,
    EPCatalog: catalog, EPRoom, EPPosts,
    byKind: byKindL, frameProduct: prod, product: prod, compatibleMechanisms: EPCatalog.compatibleMechanisms,
    productSeries: EPCatalog.productSeries,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord,
    markCanvasUsed: () => {}, uid: p => p + "GEN",
    getRoomForPoint: () => room || null,   /* центр поста ложится в эту комнату */
    updateObjectRoom: created => { created.roomId = room ? room.id : null; },
    setTool: () => {}, renderAll: () => {}, renderSummary: () => {},
    toast: m => toasts.push(m),
    EPRoomAssign: { isOutsideRooms: () => false }
  };
  stand.run(SWAP_CUT, ctx)(40, 50);
  return { state, toasts };
}

test("★ addPending: белый пост серии A в белую комнату серии B → накладка стала FB2 (серия B, 2М)", () => {
  const { state, toasts } = placeTemplate({ template: T_WHITE, room: ROOM_B_WHITE });
  assert.equal(state.posts.length, 1, "пост размещён");
  assert.equal(state.posts[0].frameId, FB2.id, "накладка подменена на накладку СЕРИИ КОМНАТЫ той же модульности и цвета");
  assert.notEqual(state.posts[0].frameId, T_WHITE.frameId, "старая накладка шаблона (серия A) НЕ осталась");
  assert.deepEqual([...state.posts[0].mechanismIds], [M1.id, M1.id], "начинка шаблона перенесена как есть");
  assert.ok(toasts.every(m => !/не размещён/.test(m)), "ошибки размещения нет");
});

test("★ addPending: замены нет (в серии комнаты нет накладки нужной модульности) → пост НЕ ставим, говорим почему", () => {
  const { state, toasts } = placeTemplate({ template: T_WIDE, room: ROOM_B_WHITE });   /* 4М, а в B белых только 2М и 3М */
  assert.equal(state.posts.length, 0, "пост НЕ размещён с чужой накладкой");
  assert.ok(toasts.some(m => /не размещён/.test(m) && /Гостиная/.test(m)), "человеку сказано, что и где не нашли: " + JSON.stringify(toasts));
});

test("addPending: комната без серии/цвета → накладку НЕ трогаем (пост несёт свою)", () => {
  const { state } = placeTemplate({ template: T_WHITE, room: ROOM_PLAIN });
  assert.equal(state.posts[0].frameId, T_WHITE.frameId, "нет отделки у комнаты → подмены нет, иначе взяли бы случайную накладку");
});

test("addPending: пост лёг вне комнат → накладку НЕ трогаем", () => {
  const { state } = placeTemplate({ template: T_WHITE, room: null });
  assert.equal(state.posts[0].frameId, T_WHITE.frameId, "вне комнаты подмены нет — поведение прежнее");
});

test("★ ПУНКТ 4: подмену считает ОБЩИЙ отбор EPCatalog.productsForRoom по накладкам комнаты, не своя копия", () => {
  const calls = [];
  const spyCat = Object.assign({}, EPCatalog, {
    productsForRoom: (items, crit) => { calls.push({ items, crit }); return EPCatalog.productsForRoom(items, crit); }
  });
  const { state } = placeTemplate({ template: T_WHITE, room: ROOM_B_WHITE, catalog: spyCat });
  assert.equal(state.posts[0].frameId, FB2.id, "результат прежний — спай лишь считает вызовы");
  const framePool = calls.find(c => c.crit && c.crit.collection === "B");
  assert.ok(framePool, "frameForRoomPlacement обязан звать productsForRoom с критерием серии/цвета комнаты — иначе это своя копия правил (§7.1)");
  assert.equal(framePool.crit.frameColor, "Белая", "критерий несёт цвет накладки комнаты");
  assert.ok(framePool.items.every(it => it.kind === "frame"), "сужаем именно накладки (byKind('frame'))");
});

/* ============================ 4. ДЕНЬГИ: подмена доезжает до сметы и цены поста ============ */

const compDeps = { frameProduct: product, product, mechanismSpan: EPCatalog.mechanismSpan };
const costDeps = compDeps;   /* без findBox/socketBox коробка = 0 → цена = механизмы + накладка */

test("★ ДЕНЬГИ: цена размещённого поста считается по НОВОЙ накладке (FB2 25 €), а не по старой (FA2 10 €)", () => {
  const { state } = placeTemplate({ template: T_WHITE, room: ROOM_B_WHITE });
  const placed = state.posts[0];
  const cost = EPPosts.postCost(placed, costDeps);
  const asOldFrame = EPPosts.postCost(Object.assign({}, placed, { frameId: FA2.id }), costDeps);
  assert.equal(cost, 10 + 25, "механизмы 2×5 + накладка FB2 25 € — цена по новой накладке");
  assert.equal(asOldFrame, 10 + 10, "контроль: со старой накладкой было бы 20 € — разница именно в накладке");
  assert.notEqual(cost, asOldFrame, "подмена накладки МЕНЯЕТ цену поста (п.5)");
});

test("★ ДЕНЬГИ: смета (EPEstimate.build) печатает НОВУЮ накладку FB2 и НЕ содержит старую FA2", () => {
  const { state } = placeTemplate({ template: T_WHITE, room: ROOM_B_WHITE });
  const est = EPEstimate.build({
    posts: state.posts, product, frameProduct: product,
    postComposition: p => EPPosts.postComposition(p, compDeps),
    postCost: p => EPPosts.postCost(p, costDeps),
    settings: {}
  });
  const frameItems = est.groups.flatMap(g => g.items).filter(it => it.kind === "frame");
  assert.ok(frameItems.some(it => it.code === FB2.code), "в смете стоит накладка серии комнаты (FB2)");
  assert.ok(!frameItems.some(it => it.code === FA2.code), "старой накладки шаблона (FA2) в смете нет");
});

/* ============================ 5. СОХРАНЕНИЕ: шаблон запоминает цвет накладки ============ */

test("★ savePostBuilder: сохранённый шаблон запоминает цвет накладки, под который собран", async () => {
  const FRAME = { id: 100, kind: "frame", active: true, series: ["Test"], frameColor: "Медь Матовая", slotCount: 2, code: "F100", name: "рамка тест" };
  const MECH2 = { id: 300, kind: "mechanism", active: true, series: ["Test"], moduleSpan: 2, price: 5, code: "M2", name: "механизм 2М" };
  const products = [FRAME, MECH2];
  const prod = id => products.find(p => Number(p.id) === Number(id));
  const dom = stand.makeDom();
  dom.$("postName").value = "Пост";
  dom.$("postFrameSelect").value = String(FRAME.id);
  const state = { products, posts: [], templates: [],
    builder: { slots: EPBuilderSlots.fromPost({ mechanismIds: [MECH2.id] }, () => false),
      editingPlacedId: null, editingTemplateId: null, restrictInnardsColor: false } };
  let saved;
  const ctx = {
    state, $: dom.$, EPCatalog, EPPosts, EPBuilderSlots,
    frameProduct: prod, product: prod, mechanismSpan: EPCatalog.mechanismSpan,
    socketBox: () => null, uid: p => p + "GEN",
    builderWallType: () => "solid", EP_DATA: { settings: { wallType: "solid" } },
    askWallScope: () => Promise.resolve("self"),
    DataService: { savePost: t => { saved = t; return Promise.resolve(); }, getSavedPosts: () => Promise.resolve(state.templates) },
    toast: () => {}, renderAll: () => {}, renderProperties: () => {}, renderSummary: () => {},
    renderTemplates: () => {}, closePostBuilder: () => {}
  };
  await stand.run("savePostBuilder", ctx)();
  assert.ok(saved, "шаблон сохранён");
  assert.equal(saved.frameColor, "Медь Матовая", "шаблон запомнил цвет накладки — мутация (не писать frameColor) оставит его undefined");
});

/* ============ 6. СВЯЗКА С ЭКРАНОМ: renderProperties пересобирает библиотеку по цвету выделенной комнаты ============
   Чистый фильтр (раздел 2) верен, но если renderProperties не зовёт renderTemplates, при клике по
   комнате список готовых постов НЕ пересобирается — то, ради чего сделан п.5, на экране не появляется,
   а тесты чистых функций зелёные. Поэтому здесь исполняем НАСТОЯЩИЙ renderProperties (ветка комнаты) и
   читаем НАСТОЯЩИЙ renderTemplates по #postLibrary: тест сторожит именно ПОДКЛЮЧЕНИЕ, через наблюдаемое
   (содержимое библиотеки меняется вслед за цветом комнаты), а не по имени функции. */
const ROOM_B_BLACK = { id: "rBk", name: "Спальня", collection: "B", frameColor: "Чёрная" };

/* Исполнить настоящий renderProperties для текущего state (ветка комнаты/пустое выделение) на общем
   dom и вернуть содержимое #postLibrary. renderTemplates вырезается НАСТОЯЩИЙ (не стаб) — проверяем
   связку. Остальное окружение ветки комнаты — безопасные стабы (как в roomCollectionPropertiesWiring). */
function renderPropsLibrary(state, dom) {
  const ctx = {
    state, props: stand.makeElement(), $: dom.$, esc: s => String(s == null ? "" : s),
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameProduct: product, EPCatalog, EPRoom, EPPosts, EPLightingGroups,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord,
    mechanismModulesTotal: ids => (ids || []).reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>", document: { querySelectorAll: () => [] },
    flushRoomDraft: () => {}, findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: () => {}, getObjectsInRoom: () => [], roomAutoAreaText: () => "",
    polygonAreaPx: () => 0, lightingScheme: () => "classic",
    EPPrefs: { get: (k, fb) => fb, set: () => {} },
    setTool: () => {}, persistProject: () => {}, renderSummary: () => {}, renderAll: () => {},
    mountedRoomId: null
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView", "renderTemplates", "renderProperties"], ctx)();
  return dom.$("postLibrary").innerHTML;
}

test("★ СВЯЗКА: смена выделения на комнату другого цвета пересобирает #postLibrary по новому цвету", () => {
  const dom = stand.makeDom();
  const state = { templates: [T_WHITE, T_BLACK], rooms: [ROOM_B_WHITE, ROOM_B_BLACK], products: PRODUCTS,
    selected: { kind: "room", id: ROOM_B_WHITE.id } };
  const whiteView = renderPropsLibrary(state, dom);
  assert.match(whiteView, /Пост белый/, "выбрана белая комната → в библиотеке белый пост");
  assert.doesNotMatch(whiteView, /Пост чёрный/, "чёрный пост скрыт");
  /* Тот же dom, меняем ТОЛЬКО выделение на чёрную комнату и снова зовём renderProperties. */
  state.selected = { kind: "room", id: ROOM_B_BLACK.id };
  const blackView = renderPropsLibrary(state, dom);
  assert.match(blackView, /Пост чёрный/, "перевыбор на чёрную комнату → библиотека пересобрана: чёрный пост");
  assert.doesNotMatch(blackView, /Пост белый/, "белый пост теперь скрыт — список изменился вслед за цветом (снятие renderTemplates() из renderProperties краснит здесь)");
});

test("★ СВЯЗКА (до ранних return): снятие выделения возвращает библиотеку к «показать всё»", () => {
  const dom = stand.makeDom();
  const state = { templates: [T_WHITE, T_BLACK], rooms: [ROOM_B_WHITE, ROOM_B_BLACK], products: PRODUCTS,
    selected: { kind: "room", id: ROOM_B_BLACK.id } };
  const blackView = renderPropsLibrary(state, dom);
  assert.match(blackView, /Пост чёрный/, "исходно выбрана чёрная комната — только чёрный пост");
  assert.doesNotMatch(blackView, /Пост белый/);
  /* Снимаем выделение: renderProperties уходит в ранний return (!state.selected). renderTemplates
     обязан отработать ДО него — иначе фильтр не сбросится на «показать всё». */
  state.selected = null;
  const emptyView = renderPropsLibrary(state, dom);
  assert.match(emptyView, /Пост белый/, "выделение снято → показываем ВСЁ (перенос renderTemplates() ПОСЛЕ раннего return краснит здесь)");
  assert.match(emptyView, /Пост чёрный/, "оба поста на месте — фильтр сброшен");
});

/* ============ 7. СОВМЕСТИМОСТЬ КЛАВИШ С ПОДМЕНЁННОЙ НАКЛАДКОЙ (ОТДЕЛКА-ПОРЯДОК, доводка 16.09) ======
   Дефект: пост серии N (клавиши серии N) ставили в комнату серии A → накладка становилась A, клавиши
   оставались N, и конструктор показывал «Занято 0 из 3» — несобираемый пост в смете. Правка: готовый
   пост встаёт в комнату СВОЕЙ серии (по правилу конструктора compatibleMechanisms), в чужую — не встаёт
   с понятным сообщением. Здесь синтетика c контролем серий; ниже (раздел 8) — тот же сценарий на РЕАЛЬНОМ
   каталоге VIMAR. Серии заданы так, что у каждой накладки есть совместимая клавиша в каталоге → фолбэк
   compatibleMechanisms «показать всё» не срабатывает и честно судит по серии. */
const FN3 = { id: 700, kind: "frame", active: true, series: ["N"], frameColor: "Белая", slotCount: 3, price: 10, code: "N3", name: "N рамка белая 3М" };
const FN3K = { id: 701, kind: "frame", active: true, series: ["N"], frameColor: "Чёрная", slotCount: 3, price: 12, code: "N3K", name: "N рамка чёрная 3М" };
const FA3 = { id: 710, kind: "frame", active: true, series: ["A"], frameColor: "Белая", slotCount: 3, price: 20, code: "A3", name: "A рамка белая 3М" };
const MN = { id: 720, kind: "mechanism", active: true, series: ["N"], moduleSpan: 1, price: 5, code: "MN", name: "клавиша N 1М" };
const MA = { id: 721, kind: "mechanism", active: true, series: ["A"], moduleSpan: 1, price: 5, code: "MA", name: "клавиша A 1М" };
const COMPAT_PRODUCTS = [FN3, FN3K, FA3, MN, MA];
const T_N = { id: "tN", name: "Пост N", frameId: FN3.id, frameColor: "Белая", mechanismIds: [MN.id, MN.id, MN.id] };
const ROOM_A_WHITE = { id: "rAw", name: "Гостиная", collection: "A", frameColor: "Белая" };
const ROOM_N_BLACK = { id: "rNk", name: "Спальня", collection: "N", frameColor: "Чёрная" };
const ROOM_ONLY_WHITE = { id: "rOw", name: "Прихожая", frameColor: "Белая" };   /* задан ТОЛЬКО цвет, серии нет */

test("★ пост серии N в комнату серии A (клавиши несовместимы) → пост НЕ поставлен, в сообщении обе серии", () => {
  const { state, toasts } = placeTemplate({ template: T_N, room: ROOM_A_WHITE, products: COMPAT_PRODUCTS });
  assert.equal(state.posts.length, 0, "несобираемый пост (клавиши N, накладка A) в проект НЕ добавлен — мутация «при blocked всё же добавить» краснит здесь");
  const msg = toasts.join(" | ");
  assert.match(msg, /не размещён/, "человеку сказано, что пост не размещён");
  assert.match(msg, /«N»/, "названа серия клавиш поста");
  assert.match(msg, /«A»/, "названа серия комнаты");
});

test("★ пост серии N в комнату серии N другого цвета → накладка стала FN3K (серия N, 3М, цвет комнаты), клавиши на месте", () => {
  const { state, toasts } = placeTemplate({ template: T_N, room: ROOM_N_BLACK, products: COMPAT_PRODUCTS });
  assert.equal(state.posts.length, 1, "пост размещён — серия своя, клавиши совместимы");
  assert.equal(state.posts[0].frameId, FN3K.id, "накладка сменилась на серию N цвета комнаты той же модульности");
  assert.deepEqual([...state.posts[0].mechanismIds], [MN.id, MN.id, MN.id], "3 клавиши перенесены как есть");
  const placed = state.posts[0], frame = COMPAT_PRODUCTS.find(p => p.id === placed.frameId);
  const compat = EPCatalog.compatibleMechanisms(frame, COMPAT_PRODUCTS.filter(p => p.kind === "mechanism"));
  assert.ok(placed.mechanismIds.every(id => compat.includes(COMPAT_PRODUCTS.find(p => p.id === id))),
    "ВСЕ клавиши встают в новую накладку по правилу конструктора (compatibleMechanisms)");
  assert.ok(toasts.every(m => !/не размещён/.test(m)), "ошибки размещения нет");
});

test("★ снятая с производства (active:false) клавиша СВОЕЙ серии не даёт ложной блокировки: пост ставится в комнату своей серии", () => {
  /* Клавиша MND серии N снята с производства (active:false) → byKind('mechanism') её не видит. Судить
     совместимость ТОЛЬКО по активному каталогу — значит выкинуть её по отсутствию, и пост своей же серии
     перестанет ставиться (ложная блокировка). frameFitsTemplateMechs добавляет клавиши шаблона в пул
     сравнения (.concat(items)) — снятую судим ПО СЕРИИ, как keepMechs в конструкторе. Серия N имеет
     активную клавишу (MN), поэтому фолбэк compatibleMechanisms не срабатывает и сравнение честное. */
  const MND = { id: 722, kind: "mechanism", active: false, series: ["N"], moduleSpan: 1, price: 5, code: "MND", name: "клавиша N снятая" };
  const products = COMPAT_PRODUCTS.concat([MND]);
  const template = { id: "tND", name: "Пост N со снятой клавишей", frameId: FN3.id, frameColor: "Белая", mechanismIds: [MN.id, MND.id, MN.id] };
  const { state, toasts } = placeTemplate({ template, room: ROOM_N_BLACK, products });
  assert.equal(state.posts.length, 1, "пост своей серии ставится, несмотря на снятую клавишу — мутация «pool без .concat(items)» краснит здесь ложной блокировкой");
  assert.equal(state.posts[0].frameId, FN3K.id, "накладка подменена на серию N цвета комнаты той же модульности");
  assert.deepEqual([...state.posts[0].mechanismIds], [MN.id, MND.id, MN.id], "состав (со снятой клавишей) перенесён как есть");
  assert.ok(toasts.every(m => !/не размещён/.test(m)), "ложной ошибки размещения нет");
});

test("★ комната задана ТОЛЬКО цветом (серии нет): подмена берёт накладку СОВМЕСТИМОЙ серии, не первую белую", () => {
  /* Пул под «только Белая» = FN3 (N) и FA3 (A) — обе 3М белые. Без проверки клавиш подмена могла бы
     молча взять FA3 (серия A) и снова собрать несобираемый пост. Проверка обязана удержать серию N. */
  const { state } = placeTemplate({ template: T_N, room: ROOM_ONLY_WHITE, products: COMPAT_PRODUCTS });
  assert.equal(state.posts.length, 1, "пост размещён — в пуле есть белая накладка совместимой серии (FN3)");
  assert.equal(state.posts[0].frameId, FN3.id, "взята FN3 (серия N), а НЕ FA3 (серия A): мутация «для ветки только-цвет всегда true» взяла бы несовместимую и краснит здесь");
});

test("комната только цветом, но совместимой накладки этого цвета нет → пост НЕ поставлен", () => {
  /* Убираем FN3 из каталога: под «Белая» остаётся только FA3 (серия A), клавиши N в неё не встают. */
  const products = COMPAT_PRODUCTS.filter(p => p !== FN3);
  const { state, toasts } = placeTemplate({ template: T_N, room: ROOM_ONLY_WHITE, products });
  assert.equal(state.posts.length, 0, "совместимой накладки нужного цвета нет → пост не ставим с чужой");
  assert.match(toasts.join(" | "), /не размещён/, "человеку объяснено");
});

/* ============ 8. РЕАЛЬНЫЙ КАТАЛОГ VIMAR: тот самый дефектный сценарий (браузерный путь) ============
   Пост 09673.01 (накладка Neve Up, белая, 3М) + 09001×3 (выключатели Neve Up). Каталог и обогащение —
   те же файлы и в том же порядке, что index.html (catalog-vimar.js → attrs → data.js), поэтому у товаров
   реальные series/frameColor/slotCount. Прогоняем НАСТОЯЩИЙ addPending. */
const fsN = require("node:fs"), pathN = require("node:path"), vmN = require("node:vm");
function loadRuntimeProducts() {
  const jsDir = pathN.join(__dirname, "..", "js");
  const win = {};
  const context = vmN.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vmN.runInContext(fsN.readFileSync(pathN.join(jsDir, file), "utf8"), context, { filename: file });
  }
  return win.DataService.getProducts();
}

test("★ РЕАЛЬНЫЙ КАТАЛОГ: 09673.01 + 09001×3 → комната Arke/Белая = blocked, обе серии в сообщении; → комната Neve Up другого цвета = подмена+совместимость", async () => {
  const products = await loadRuntimeProducts();
  const byCode = code => products.find(p => String(p.code) === code);
  const frameNU = byCode("09673.01"), mechNU = byCode("09001");
  assert.ok(frameNU && mechNU, "контрольные артикулы найдены в каталоге");
  assert.equal(frameNU.slotCount, 3, "накладка на 3 модуля");
  assert.deepEqual(frameNU.series, ["Neve Up"]);
  const template = { id: "tNU", name: "Пост Neve Up", frameId: frameNU.id, frameColor: frameNU.frameColor,
    mechanismIds: [mechNU.id, mechNU.id, mechNU.id] };

  /* --- в комнату Arke/Белая: клавиши Neve Up в накладку Arke по правилу конструктора не встают --- */
  const roomArke = { id: "rArke", name: "Гостиная", collection: "Arke", frameColor: "Белая" };
  const blocked = placeTemplate({ template, room: roomArke, products });
  assert.equal(blocked.state.posts.length, 0, "пост Neve Up НЕ добавлен в комнату Arke (несобираемый состав)");
  const msg = blocked.toasts.join(" | ");
  assert.match(msg, /Neve Up/, "в сообщении серия клавиш поста (Neve Up)");
  assert.match(msg, /Arke/, "в сообщении серия комнаты (Arke)");

  /* --- в комнату Neve Up другого цвета (Слоновая кость), где есть накладка на 3 модуля --- */
  const frameNUiv = products.find(p => p.kind === "frame" && p.active && (p.series || []).includes("Neve Up")
    && p.slotCount === 3 && p.frameColor === "Слоновая кость");
  assert.ok(frameNUiv, "в каталоге есть накладка Neve Up 3М цвета «Слоновая кость»");
  const roomNU = { id: "rNU", name: "Спальня", collection: "Neve Up", frameColor: "Слоновая кость" };
  const ok = placeTemplate({ template, room: roomNU, products });
  assert.equal(ok.state.posts.length, 1, "пост размещён в комнату своей серии другого цвета");
  const placed = ok.state.posts[0], newFrame = products.find(p => p.id === placed.frameId);
  assert.notEqual(placed.frameId, frameNU.id, "накладка сменилась (на цвет комнаты)");
  assert.equal(newFrame.frameColor, "Слоновая кость", "новая накладка — цвета комнаты");
  assert.deepEqual(newFrame.series, ["Neve Up"], "и своей серии Neve Up");
  assert.equal(placed.mechanismIds.length, 3, "3 механизма на месте");
  const activeMechs = products.filter(p => p.kind === "mechanism" && p.active);
  const compat = EPCatalog.compatibleMechanisms(newFrame, activeMechs);
  assert.ok(placed.mechanismIds.every(id => compat.includes(products.find(p => p.id === id))),
    "ВСЕ 3 механизма встают в новую накладку по правилу конструктора (compatibleMechanisms)");
});

/* ============ 9. МОНТАЖНЫЙ СТАНДАРТ КОМНАТЫ ЗАПУСКАЕТ ПОДМЕНУ (задача 22.09) ============
   Владелец: «при перетаскивании готового поста в комнату стандарт — сделай его». Стандарт стал
   настройкой помещения (roomCatalogFilter.standard) и уже сужал пул, но в комнате, где задан ТОЛЬКО
   стандарт, подмена не запускалась (стандарта не было в гейте constrained). Теперь запускается, но
   ТОЛЬКО когда накладка поста стандарту не годится, и сохраняет серию/цвет поста, если такая накладка
   в нужном стандарте есть. Порядок STD_PRODUCTS специально таков, что без предпочтения own
   pickRoomFrame(pool) взял бы накладку ЧУЖОЙ серии (SB2_DE) — так тесты ловят потерю серии/цвета. */
const SB2_DE = { id: 803, kind: "frame", active: true, series: ["B"], frameColor: "Белая", standard: "DE", slotCount: 2, price: 20, code: "SB2DE", name: "B немецкая белая 2М" };
const SA2_DE_BLACK = { id: 802, kind: "frame", active: true, series: ["A"], frameColor: "Чёрная", standard: "DE", slotCount: 2, price: 12, code: "SA2DEK", name: "A немецкая чёрная 2М" };
const SA2_DE = { id: 801, kind: "frame", active: true, series: ["A"], frameColor: "Белая", standard: "DE", slotCount: 2, price: 11, code: "SA2DE", name: "A немецкая белая 2М" };
const SA2_BOTH = { id: 804, kind: "frame", active: true, series: ["A"], frameColor: "Белая", standard: "BOTH", slotCount: 2, price: 9, code: "SA2BOTH", name: "A универсальная белая 2М" };
const SA2_IT = { id: 800, kind: "frame", active: true, series: ["A"], frameColor: "Белая", standard: "IT", slotCount: 2, price: 10, code: "SA2IT", name: "A итальянская белая 2М" };
const SM = { id: 810, kind: "mechanism", active: true, series: ["A", "B"], moduleSpan: 1, price: 5, code: "SM", name: "клавиша A/B 1М" };
/* Порядок важен: чужая по серии SB2_DE и чужая по цвету SA2_DE_BLACK стоят В ПУЛЕ ПЕРЕД SA2_DE —
   без own-предпочтения pickRoomFrame(pool) взял бы первую подходящую по модульности (SB2_DE). */
const STD_PRODUCTS = [SB2_DE, SA2_DE_BLACK, SA2_DE, SA2_BOTH, SA2_IT, SM];
const T_IT = { id: "tIT", name: "Пост IT", frameId: SA2_IT.id, frameColor: "Белая", mechanismIds: [SM.id, SM.id] };
const ROOM_DE = { id: "rDE", name: "Немецкая", standard: "DE" };   /* задан ТОЛЬКО стандарт, серии/цвета нет */

test("★ СТАНДАРТ: пост итальянской накладки в немецкую комнату (только стандарт) → подменился, серия и цвет сохранены", () => {
  const { state, toasts } = placeTemplate({ template: T_IT, room: ROOM_DE, products: STD_PRODUCTS });
  assert.equal(state.posts.length, 1, "пост размещён (в немецком стандарте есть накладка его серии и цвета)");
  const placed = state.posts[0], newFrame = STD_PRODUCTS.find(p => p.id === placed.frameId);
  assert.equal(placed.frameId, SA2_DE.id, "накладка стала немецкой (SA2_DE); мутация «убрать ||standardMismatch из гейта» оставит SA2_IT и краснит здесь");
  assert.notEqual(placed.frameId, SA2_IT.id, "итальянская накладка НЕ осталась — стандарт комнаты сделан");
  assert.equal(newFrame.standard, "DE", "новая накладка немецкого стандарта — как у комнаты");
  assert.deepEqual(newFrame.series, ["A"], "серия поста (A) сохранена, а не сменилась на первую из пула (B); мутация «убрать own-предпочтение» вернула бы SB2DE и краснит здесь");
  assert.equal(newFrame.frameColor, "Белая", "цвет поста (Белая) сохранён, а не сменился на первый цвет пула (Чёрная)");
  assert.ok(toasts.every(m => !/не размещён/.test(m)), "ошибки размещения нет");
});

test("★ СТАНДАРТ: пост УЖЕ немецкой накладки в немецкую комнату → подмены НЕТ (менять нечего)", () => {
  const T_DE = { id: "tDE", name: "Пост DE", frameId: SA2_DE.id, frameColor: "Белая", mechanismIds: [SM.id, SM.id] };
  const { state } = placeTemplate({ template: T_DE, room: ROOM_DE, products: STD_PRODUCTS });
  assert.equal(state.posts.length, 1, "пост размещён");
  assert.equal(state.posts[0].frameId, SA2_DE.id, "накладка та же — стандарт совпадает, подменять не из-за чего; мутация «стандарт всегда сужает» подменила бы её и краснит здесь");
});

test("★ СТАНДАРТ: пост УНИВЕРСАЛЬНОЙ (BOTH) накладки в немецкую комнату → подмены НЕТ (годится под любой)", () => {
  const T_BOTH = { id: "tBOTH", name: "Пост универсальный", frameId: SA2_BOTH.id, frameColor: "Белая", mechanismIds: [SM.id, SM.id] };
  const { state } = placeTemplate({ template: T_BOTH, room: ROOM_DE, products: STD_PRODUCTS });
  assert.equal(state.posts.length, 1, "пост размещён");
  assert.equal(state.posts[0].frameId, SA2_BOTH.id, "универсальная накладка годится под немецкий стандарт → НЕ подменяем; мутация «стандарт всегда сужает» сменила бы её на SA2_DE и краснит здесь");
});

test("★ СТАНДАРТ: накладки поста серии/цвета в нужном стандарте НЕТ → подмена по нынешнему правилу (что есть), пост ставится", () => {
  /* Убираем белые немецкие серии A (SA2_DE, SA2_BOTH): под немецкий остаются SB2_DE (серия B) и
     SA2_DE_BLACK (серия A, но чёрная). own (серия A + Белая) пуст → фолбэк pickRoomFrame(pool). */
  const products = STD_PRODUCTS.filter(p => p !== SA2_DE && p !== SA2_BOTH);
  const { state, toasts } = placeTemplate({ template: T_IT, room: ROOM_DE, products });
  assert.equal(state.posts.length, 1, "пост размещён — своей серии/цвета в стандарте нет, берём первую подходящую");
  const newFrame = products.find(p => p.id === state.posts[0].frameId);
  assert.equal(EPCatalog.productsForRoom([newFrame], { standard: "DE" }).length, 1, "новая накладка годится под немецкий стандарт комнаты");
  assert.notEqual(state.posts[0].frameId, SA2_IT.id, "итальянская накладка не осталась");
  assert.ok(toasts.every(m => !/не размещён/.test(m)), "ошибки размещения нет");
});
