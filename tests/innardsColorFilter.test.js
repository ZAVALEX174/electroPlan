/* ОТДЕЛКА-ПОРЯДОК (пп. 3–4, решение владельца 16.09): начинка (клавиши/розетки/механизмы) сужается
   под цвет накладки комнаты ТЕМ ЖЕ EPCatalog.productsForRoom, что сужает накладки (§7.1 — правило
   «что подходит комнате» одно). Ограничение ВКЛЮЧАЕТСЯ галочкой поста restrictInnardsColor; по
   умолчанию ВЫКЛЮЧЕНО — начинка любого цвета (у 169 из 181 цвета накладок начинки того же цвета нет).

   Здесь три уровня:
   1) ЧИСТЫЙ — productsForRoom по elementColor + facingColorKey (родовая складка «Белая»↔«Белый»);
   2) ДАННЫЕ — «Цвет элемента» доезжает до каталога через data.js (раздел colors);
   3) ПОВЕДЕНИЕ — НАСТОЯЩИЙ renderBuilder сужает карточки начинки через productsForRoom ТОЛЬКО при
      включённой галочке (state.builder.restrictInnardsColor). Это и есть связка «фильтр начинки
      ходит в общий отбор», которая на прошлой задаче оказалась не покрыта ничем.
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

/* ---------- 1. ЧИСТЫЙ УРОВЕНЬ: productsForRoom по цвету начинки ---------- */

test("facingColorKey: родовая/числовая складка сводит цвет накладки и цвет начинки к одной гамме", () => {
  const k = EPCatalog.facingColorKey;
  assert.equal(k("Белая"), k("Белый"), "«Белая» (накладка) и «Белый» (начинка) — одна гамма");
  assert.equal(k("Чёрная"), k("Чёрный"), "ё и род не должны разводить чёрный");
  assert.equal(k("Никель Матовый"), k("Никель матовый"), "регистр не разводит");
  assert.notEqual(k("Белый"), k("Чёрный"), "разные цвета остаются разными");
});

test("productsForRoom: отбор начинки по elementColor — складка гаммы, чужой цвет и беспелый отсеяны", () => {
  const items = [
    { id: 1, elementColor: "Белый" },
    { id: 2, elementColor: "Чёрный" },
    { id: 3, elementColor: "Белые матовые" },
    { id: 4, frameColor: "Белая" }               // накладка: своего elementColor нет
  ];
  // критерий — цвет НАКЛАДКИ комнаты («Белая»), сравнивается с elementColor начинки
  const out = EPCatalog.productsForRoom(items, { elementColor: "Белая" });
  assert.deepEqual(out.map(p => p.id), [1], "остаётся только «Белый»; «Чёрный», «Белые матовые» и беспелый — вон");
  // МУТАЦИЯ-ЯКОРЬ: равенство строк вместо facingColorKey выкинуло бы «Белый» из «Белой» комнаты
  assert.equal(items.filter(p => p.elementColor === "Белая").length, 0,
    "прямое равенство строк дало бы ПУСТО — именно поэтому нужна складка facingColorKey");
});

test("productsForRoom: пустой критерий цвета начинки → список копией (галочка = начинка любого цвета)", () => {
  const items = [{ id: 1, elementColor: "Белый" }, { id: 2, elementColor: "Чёрный" }];
  assert.deepEqual(EPCatalog.productsForRoom(items, {}).map(p => p.id), [1, 2], "без критерия начинка не сужается");
});

/* ---------- 2. ДАННЫЕ: «Цвет элемента» доезжает до каталога ---------- */

test("data.js: elementColor подмешивается механизмам из раздела colors, у накладок его нет", () => {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), context, { filename: f });
  }
  const attrs = win.EP_VIMAR_ATTRS;
  assert.ok(attrs.colors && Object.keys(attrs.colors).length > 300,
    "раздел colors обязан быть в атрибутах (конвертер провёл «Цвет элемента»)");
  // синхронно, DataService.mock → structuredClone(products)
  let prods;
  win.DataService.getProducts().then(p => { prods = p; });
  return win.DataService.getProducts().then(list => {
    const mechs = list.filter(p => p.kind === "mechanism" && p.elementColor);
    assert.ok(mechs.length > 300, `механизмы получили elementColor (${mechs.length})`);
    // конкретный якорь: для кода из colors у товара тот же цвет
    const code = Object.keys(attrs.colors)[0];
    const prod = list.find(p => p.code === code);
    assert.equal(prod.elementColor, attrs.colors[code], "elementColor товара = каноническому цвету из colors");
    // у накладок «Цвет элемента» пуст → поля нет вовсе
    assert.equal(list.filter(p => p.kind === "frame" && p.elementColor).length, 0,
      "у накладок elementColor не появляется — столбец L у них пуст");
  });
});

/* ---------- 3. ПОВЕДЕНИЕ: renderBuilder сужает начинку через общий отбор, галочка снимает ---------- */

/* Синтетический каталог: одна серия «Test», накладка «Белая» на 3 модуля и начинка трёх видов —
   «Белый» (гамма комнаты), «Чёрный» (чужая гамма) и вовсе без цвета. Управляем цветами точно,
   а productsForRoom/builderInnardsFilter/builderFilterRoom/renderBuilder исполняются НАСТОЯЩИЕ. */
const FRAME = { id: 10, kind: "frame", active: true, series: ["Test"], frameColor: "Белая", slotCount: 3, code: "F-белая", name: "рамка Test белая" };
const M_WHITE = { id: 21, kind: "mechanism", active: true, series: ["Test"], elementColor: "Белый", moduleSpan: 1, code: "M-бел", name: "клавиша белая", price: 5 };
const M_BLACK = { id: 22, kind: "mechanism", active: true, series: ["Test"], elementColor: "Чёрный", moduleSpan: 1, code: "M-черн", name: "клавиша чёрная", price: 5 };
const M_NONE = { id: 23, kind: "mechanism", active: true, series: ["Test"], moduleSpan: 1, code: "M-без", name: "механизм без цвета", price: 5 };
const PRODUCTS = [FRAME, M_WHITE, M_BLACK, M_NONE];
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));

const CUT = ["frameCollectionList", "frameFacingList", "builderFilterRoom", "roomCatalogFilter", "builderRoomFilter", "builderInnardsFilter",
  "collectionFramePool", "frameFacingLabels", "frameFacingHintText", "frameFacingEmptyText", "frameOptions",
  "builderCapacity", "renderBuilder"];

function makeCtx(state, dom) {
  const byKind = kind => state.products.filter(x => x.kind === kind && x.active);
  return {
    state, product, byKind, frameProduct: id => product(id), $: dom.$,
    frameSlotCount: EPCatalog.frameSlotCount,
    compatibleMechanisms: EPCatalog.compatibleMechanisms,
    mechanismSpan: EPCatalog.mechanismSpan,
    moduleWord: EPCatalog.moduleWord,
    productSeries: EPCatalog.productSeries,
    productOptionLabel: i => `[${i.code}] ${i.name}`,
    esc: s => String(s == null ? "" : s),
    EPCatalog, EPRoom,
    enhancePicker: () => {}, resolveMissingFrame: () => null,
    mechanismModulesTotal: ids => ids.reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>",
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    renderBuilderSlots: () => {}, lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    builderErrorHtml: () => "",
    renderBuilderCatalog: () => {}, renderBuilderComposition: () => {},
    renderBuilder: () => {}, builderCtx: {}, EPBuilderSlots, EPPosts
  };
}

/* Открыть конструктор поста, стоящего в комнате room. restrict — состояние галочки «ограничить
   цветом накладки» (по умолчанию false → начинка любого цвета; true → только в цвет комнаты).
   fieldSet=false имитирует СТАРЫЙ пост без поля restrictInnardsColor (проверка п.4 владельца). */
function render(room, restrict, fieldSet = true) {
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  const post = { id: "p1", roomId: room.id, frameId: FRAME.id };
  const builder = {
    slots: EPBuilderSlots.fromPost({ mechanismIds: [M_WHITE.id] }, () => false),
    target: { mode: "add" }, editingPlacedId: "p1", roomId: room.id
  };
  if (fieldSet) builder.restrictInnardsColor = !!restrict;   // иначе поля нет вовсе — как у старого поста
  const state = { products: PRODUCTS, posts: [post], rooms: [room], builder };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(FRAME.id);
  dom.$("postSlotCount").value = "3";
  stand.run(CUT, ctx)();
  return ctx;
}

const ROOM = { id: "r1", name: "Гостиная", collection: "Test", frameColor: "Белая" };
const has = (list, id) => (list || []).some(m => Number(m.id) === Number(id));

test("★ галочка ВКЛЮЧЕНА: карточки начинки сужены под цвет накладки комнаты ЧЕРЕЗ productsForRoom", () => {
  const ctx = render(ROOM, true);
  assert.ok(has(ctx.builderCtx.mechs, M_WHITE.id), "«Белый» — гаммы комнаты «Белая» — предлагается");
  assert.ok(!has(ctx.builderCtx.mechs, M_BLACK.id), "«Чёрный» — чужой гаммы — из карточек исключён");
  assert.ok(!has(ctx.builderCtx.mechs, M_NONE.id), "механизм без цвета при включённом ограничении не предлагается");
  // серийный набор (для fit) остаётся ПОЛНЫМ — цвет режет только предложение, не удержание
  assert.ok(has(ctx.builderCtx.keepMechs, M_BLACK.id),
    "keepMechs (fit/упаковка) НЕ сужен цветом — уже стоящий механизм чужого цвета не выпадет");
});

test("★ галочка ВЫКЛЮЧЕНА (новый дефолт): начинка НЕ сужается по цвету — «Чёрный» в карточках", () => {
  const ctx = render(ROOM, false);
  assert.ok(has(ctx.builderCtx.mechs, M_WHITE.id) && has(ctx.builderCtx.mechs, M_BLACK.id) && has(ctx.builderCtx.mechs, M_NONE.id),
    "дефолт — предлагается вся совместимая по серии начинка, любого цвета (в т.ч. в медной комнате)");
});

test("★ ПУНКТ 4: старый пост БЕЗ поля restrictInnardsColor читается как «ограничение выключено»", () => {
  // поля в builder нет вовсе (fieldSet=false) — как у поста, сохранённого до этой правки
  const ctx = render(ROOM, undefined, false);
  assert.ok(has(ctx.builderCtx.mechs, M_BLACK.id) && has(ctx.builderCtx.mechs, M_NONE.id),
    "нет поля → !!undefined === false → ограничение выключено (новый дефолт), начинка любого цвета");
});

test("★ без комнаты (комнаты в проекте нет) начинка не сужается — поведение прежнее", () => {
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  const post = { id: "p1", roomId: null, frameId: FRAME.id };
  const state = {
    products: PRODUCTS, posts: [post], rooms: [],
    builder: { slots: EPBuilderSlots.fromPost({ mechanismIds: [M_WHITE.id] }, () => false),
      target: { mode: "add" }, editingPlacedId: "p1", roomId: null, restrictInnardsColor: true }
  };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(FRAME.id);
  dom.$("postSlotCount").value = "3";
  stand.run(CUT, ctx)();
  assert.ok(has(ctx.builderCtx.mechs, M_BLACK.id) && has(ctx.builderCtx.mechs, M_NONE.id),
    "нет комнат → даже при включённой галочке цвета нет → не сужаем, вся начинка серии на месте");
});

/* builderInnardsFilter отдельно: галочка ВКЛючает критерий (цвет накладки комнаты), выключенная — пуст. */
test("builderInnardsFilter: галочка вкл → {elementColor: цвет накладки комнаты}; выкл → пусто", () => {
  const filterFor = (roomId, restrict) => {
    const builder = { editingPlacedId: "p1", roomId };
    if (restrict !== undefined) builder.restrictInnardsColor = restrict;
    const state = { products: PRODUCTS, posts: [{ id: "p1", roomId: "r1", frameId: FRAME.id }], rooms: [ROOM], builder };
    return stand.run(["frameCollectionList", "frameFacingList", "builderFilterRoom", "builderInnardsFilter"],
      { state, byKind: k => state.products.filter(x => x.kind === k && x.active), EPCatalog, EPRoom })();
  };
  // объект приходит из vm-realm — deepStrictEqual сверял бы прототип между realm'ами, проверяем поля вручную.
  const on = filterFor("r1", true);
  assert.equal(on.elementColor, "Белая", "галочка вкл → критерий начинки = цвет накладки комнаты");
  assert.equal(Object.keys(on).length, 1, "критерий несёт РОВНО цвет — материал/форму/серию начинке не навязываем");
  const off = filterFor("r1", false);
  assert.equal(off.elementColor, undefined, "галочка выкл → цветового критерия нет");
  assert.equal(Object.keys(off).length, 0, "выкл → критерий пуст");
  // п.4 на уровне фильтра: поля нет вовсе → тоже пусто (новый дефолт)
  assert.equal(Object.keys(filterFor("r1", undefined)).length, 0, "нет поля (старый пост) → критерий пуст");
});

/* ---------- Item 5: пустой отбор начинки объясняется словами и указывает на галочку ---------- */

function renderCatalog(builderCtx) {
  const dom = stand.makeDom();
  const ctx = {
    state: { builder: { target: { mode: "add" }, slots: [], query: "", openSections: new Set() } },
    builderCtx, $: dom.$, product,
    esc: s => String(s == null ? "" : s),
    moduleWord: EPCatalog.moduleWord,
    EPCatalogSections: { build: () => ({ sections: [] }) },
    productCardHtml: () => "", bindProductPictureFallbacks: () => {},
    resolveMissingMechanism: () => null, emptyCatalogHtml: () => "",
    isBareMechanism: () => false, pickBuilderProduct: () => {}
  };
  stand.run(["innardsEmptyText", "renderBuilderCatalog"], ctx)();
  return dom.$("builderCatalog").innerHTML;
}

test("renderBuilderCatalog: цвет комнаты обнулил начинку → объяснение словами + указание СНЯТЬ галочку", () => {
  const html = renderCatalog({ frameMissing: false, mechs: [], seriesCount: 5, innardsColor: "Медь Матовая",
    remaining: 3, addMax: 1, maxPostCap: 3 });
  assert.match(html, /Медь Матовая/, "названа причина — цвет накладки комнаты");
  assert.match(html, /Снимите галочку/, "объяснение указывает выход — снять галочку ограничения (она достижима только при включённой)");
  assert.match(html, /любого цвета/, "и обещает начинку любого цвета после снятия");
  assert.doesNotMatch(html, /не загружен/, "это НЕ «каталог не загружен» — прайс подключён, дело в цвете");
});

test("renderBuilderCatalog: пустой каталог БЕЗ цветового сужения → честное «не загружен»", () => {
  const html = renderCatalog({ frameMissing: false, mechs: [], seriesCount: 0, innardsColor: null,
    remaining: 3, addMax: 1, maxPostCap: 3 });
  assert.match(html, /не загружен/, "серийный набор пуст и цвета нет → причина «каталог не загружен»");
  assert.doesNotMatch(html, /Снимите галочку/, "про галочку не говорим — она тут ни при чём");
});
