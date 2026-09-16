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

const SWAP_CUT = ["frameCollectionList", "frameFacingList", "frameFacingLabels", "frameFacingSelectionLabels",
  "frameSwapEmptyText", "roomCatalogFilter", "frameForRoomPlacement", "addPending"];

function placeTemplate({ template, room, catalog = EPCatalog }) {
  const state = { pending: { type: "post", templateId: template.id }, posts: [], devices: [], templates: [template], rooms: room ? [room] : [], products: PRODUCTS };
  const toasts = [];
  const ctx = {
    state,
    EPCatalog: catalog, EPRoom, EPPosts,
    byKind, frameProduct: product, product,
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
  stand.run(["frameCollectionList", "frameFacingList", "frameFacingView", "renderTemplates", "renderProperties"], ctx)();
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
