/* ПОВЕДЕНЧЕСКИЙ тест К8г «нельзя собрать несовместимое» (решения владельца 24.10). В виде «Списком»
   панели комнаты каждое поле отделки предлагает ТОЛЬКО значения, совместимые с ВЕРХНИМИ полями
   ВЫБРАННОГО варианта; сохранённое несовместимое значение остаётся выбранным опцией «(не подходит)»
   (решение А), а под вариантом без накладок видно «нет подходящих накладок» (решение Б) — и в панели,
   и в селекторе «Вариант отделки» окна поста.

   Исполняем НАСТОЯЩИЙ renderProperties из app.js в vm на НАСТОЯЩЕМ каталоге VIMAR, ОБОГАЩЁННОМ data.js
   (тот же путь и порядок, что index.html: catalog-vimar.js → catalog-vimar-attrs.js → data.js), —
   стандарт/серии доезжают до товара ровно как в браузере. EPCatalog/EPRoom/EPRoomVariants/
   EPRoomVariantsUi настоящие (сужение и «(не подходит)» строит EPRoomVariantsUi.facingFieldOptionsHtml).

   ЯКОРИ (замерено продакшн-функциями): DE → 6 серий из 10 (нет Eikon Flat/Tactil/Tondo/Vintage),
   IT → все 10; DE + Eikon Flat → 0 накладок.

   МУТАЦИОННАЯ ТАБЛИЦА (прогнана руками, см. отчёт):
     (а) facingUpperPool без productsForRoom (values от полного каталога)  → §DE-list (появятся 4 пустые серии);
     (б) facingUpperPool: критерий от ВСЕХ полей (не только верхних)       → §A-variant2 (вариант 1 сузит вариант 2);
         builderFilterRoom/панель от варианта 1 вместо выбранного          → §A-variant2;
     (в) facingFieldOptionsHtml без ветки «(не подходит)»                   → §A-notfit (несовместимое пропадёт из селектора);
     (г) builderVariantLabel без « — нет накладок»                         → §B-postselect (пометки в окне поста нет).
   Запуск: node --test tests/frameFacingNarrowingWiring.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPRoomVariants = require("../js/roomVariants.js");
const EPRoomVariantsUi = require("../js/roomVariantsUi.js");
const EPLightingGroups = require("../js/lightingGroups.js");

/* Обогащённый каталог — как в браузере: стандарт (поле standard) подмешивает data.js. */
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
const byKindOf = k => PRODUCTS.filter(x => x.kind === k && x.active);
const activeFrames = () => byKindOf("frame");

const DE_EMPTY = ["Eikon Flat", "Eikon Tactil", "Eikon Tondo", "Eikon Vintage"];

test("предпосылки якорей держатся на текущем каталоге", () => {
  const fr = activeFrames();
  const de = EPCatalog.productCollections(EPCatalog.productsForRoom(fr, { standard: "DE" }));
  const it = EPCatalog.productCollections(EPCatalog.productsForRoom(fr, { standard: "IT" }));
  assert.equal(de.length, 6, "DE → 6 серий");
  assert.equal(it.length, 10, "IT → все 10 серий");
  DE_EMPTY.forEach(c => assert.ok(!de.includes(c), c + " под DE пуста"));
  assert.equal(EPCatalog.productsForRoom(fr, { standard: "DE", collection: "Eikon Flat" }).length, 0,
    "DE + Eikon Flat — накладок нет");
});

/* --- Рендер панели свойств комнаты (вид «Списком») на настоящем renderProperties --- */
const PANEL_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView",
  "frameFacingLabels", "frameFacingSelectionLabels", "frameFacingEmptyText", "roomCatalogFilter", "renderProperties"];
function renderPanel(room, activeIdx) {
  EPRoomVariantsUi.setActiveIndex(room.id, activeIdx || 0);
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomStandardSelect", "roomCollectionSelect", "roomSchemeSelect", "room_frameMaterialSelect", "room_frameShapeSelect", "room_frameColorSelect"] });
  const props = stand.makeElement();
  const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: byKindOf, flushRoomDraft: spy(), updateSelectionCount: () => {}, renderTemplates: () => {},
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(), getObjectsInRoom: () => [], roomAutoAreaText: () => "",
    polygonAreaPx: () => 0, lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog, EPRoomWalls: require("../js/roomWalls.js"), EPRoomVariants, EPRoomVariantsUi,
    EPPrefs: { get: (k, fb) => (k === "frameFacingView" ? "list" : fb), set: () => {} },
    setTool: spy(), persistProject: spy(), renderSummary: spy(), renderAll: spy(), mountedRoomId: null
  };
  stand.run(PANEL_CUT, ctx)();
  return props.innerHTML;
}
/* value+selected опций указанного селектора из отрисованного innerHTML. */
function options(html, id) {
  const m = html.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>'));
  assert.ok(m, "селектор #" + id + " есть");
  return [...m[1].matchAll(/<option value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/g)]
    .map(o => ({ value: o[1], selected: /selected/.test(o[2]), text: o[3] }));
}

test("§DE-list: у комнаты DE селектор серий НЕ содержит 4 пустые серии, но содержит 6 совместимых", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, standard: "DE" });
  const named = options(html, "roomCollectionSelect").slice(1).map(o => o.value);
  DE_EMPTY.forEach(c => assert.ok(!named.includes(c), "несовместимая серия «" + c + "» скрыта из списка DE"));
  assert.equal(named.length, 6, "показаны ровно 6 совместимых серий DE");
  assert.ok(named.includes("Plana") && named.includes("Eikon Evo"), "совместимые серии на месте");
});

test("§IT-list: у комнаты IT селектор серий содержит все 10 серий каталога", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, standard: "IT" });
  const named = options(html, "roomCollectionSelect").slice(1).map(o => o.value);
  assert.equal(named.length, 10, "итальянский совместим со всеми 10 сериями");
});

test("§A-notfit: сохранённое DE+Eikon Flat — серия выбрана опцией «(не подходит)», данные не тронуты", () => {
  const room = { id: "r1", name: "Гостиная", polygon: null, standard: "DE", collection: "Eikon Flat" };
  const html = renderPanel(room);
  const opts = options(html, "roomCollectionSelect");
  const notFit = opts.find(o => /Eikon Flat \(не подходит\)/.test(o.text));
  assert.ok(notFit, "несовместимая серия видна отдельной опцией «Eikon Flat (не подходит)»");
  assert.ok(notFit.selected, "именно она остаётся ВЫБРАННОЙ");
  assert.equal(opts.filter(o => o.selected).length, 1, "выбрана ровно одна опция");
  assert.ok(!opts.slice(1).filter(o => !/не подходит/.test(o.text)).some(o => o.value === "Eikon Flat"),
    "в суженном списке обычной опции «Eikon Flat» нет");
  assert.equal(room.collection, "Eikon Flat", "⚠️ данные проекта не тронуты (r.collection цел)");
  assert.equal(room.standard, "DE", "стандарт цел");
});

test("§A-filter-prev: roomCatalogFilter несовместимой комнаты ПРЕЖНИЙ (мёртвые значения не вводим)", () => {
  // Отбор окна поста и размещения обязан остаться по ПОЛНЫМ спискам каталога: Eikon Flat — живая серия,
  // поэтому остаётся фильтром. Иначе несовместимое превратилось бы в «не задано» и изменило подбор.
  const room = { id: "r1", name: "Гостиная", collection: "Eikon Flat", standard: "DE" };
  const rf = stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "roomCatalogFilter"],
    { state: { products: PRODUCTS }, byKind: byKindOf, EPCatalog, EPRoom });
  const f = rf(room);
  assert.equal(f.collection, "Eikon Flat", "серия осталась фильтром (валидна по полному каталогу)");
  assert.equal(f.standard, "DE", "стандарт остался фильтром");
});

test("§upper-only: селектор стандарта сужается ТОЛЬКО верхними полями — серия его не режет", () => {
  // Стандарт — верхнее поле; нижняя серия не должна его сужать. У комнаты с серией Eikon Flat (IT-only)
  // селектор стандарта обязан по-прежнему предлагать и немецкий, и итальянский (критерий от ПОЛЕЙ ВЫШЕ
  // стандарта = пусто). Мутация «критерий от всех полей» оставила бы только итальянский → §красит.
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, collection: "Eikon Flat" });
  const std = options(html, "roomStandardSelect").slice(1).map(o => o.value);
  assert.ok(std.includes("DE") && std.includes("IT"),
    "оба стандарта предлагаются — нижняя серия верхнее поле не сужает");
});

test("§A-variant2: вариант 2 сужается от СВОИХ верхних полей, а не от варианта 1", () => {
  // Вариант 1 = итальянский (сам по себе все 10 серий), вариант 2 = немецкий (должно быть 6).
  const room = { id: "r1", name: "Гостиная", polygon: null, standard: "IT",
    moreVariants: [{ standard: "DE" }] };
  const v1 = options(renderPanel(room, 0), "roomCollectionSelect").slice(1).map(o => o.value);
  const v2 = options(renderPanel(room, 1), "roomCollectionSelect").slice(1).map(o => o.value);
  assert.equal(v1.length, 10, "вариант 1 (IT) — все 10 серий");
  assert.equal(v2.length, 6, "вариант 2 (DE) — 6 серий, сужение от ЕГО стандарта, а не от варианта 1");
});

test("§B-panel: под вариантом DE+Eikon Flat (0 накладок) в панели строка «нет накладок» с условиями", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, standard: "DE", collection: "Eikon Flat" });
  const m = html.match(/<small class="prop-hint room-facing-none">([\s\S]*?)<\/small>/);
  assert.ok(m, "строка room-facing-none присутствует под полями отделки");
  assert.match(m[1], /в каталоге накладок нет/, "та же формулировка frameFacingEmptyText, что у окна поста");
  assert.match(m[1], /немецкий/, "перечислены условия: стандарт");
  assert.match(m[1], /Eikon Flat/, "перечислены условия: серия");
});

test("§B-panel-none: под совместимым вариантом строки «нет накладок» НЕТ", () => {
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, standard: "DE", collection: "Plana" });
  assert.doesNotMatch(html, /room-facing-none/, "накладки есть → строки нет");
});

/* --- Селектор «Вариант отделки» окна поста: пометка « — нет накладок» (решение Б) --- */
test("§B-postselect: вариант без накладок помечен « — нет накладок», совместимый — нет", () => {
  const room = { id: "r2", name: "Гостиная", standard: "DE", collection: "Plana",
    moreVariants: [{ standard: "DE", collection: "Eikon Flat" }] };
  const dom = stand.makeDom({ selects: ["builderVariantSelect"] });
  const noFrames = v => EPCatalog.productsForRoom(activeFrames(),
    { standard: v.standard, collection: v.collection }).length === 0;
  EPRoomVariantsUi.renderBuilderVariantSelect({ $: dom.$, room, index: 0, onChange: () => {}, variantHasNoFrames: noFrames });
  const html = dom.$("builderVariantSelect").innerHTML;
  const opts = [...html.matchAll(/<option value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)].map(o => o[2]);
  assert.equal(opts.length, 2, "две опции по числу вариантов");
  assert.doesNotMatch(opts[0], /нет накладок/, "вариант 1 (Plana) совместим — пометки нет");
  assert.match(opts[1], /— нет накладок/, "вариант 2 (Eikon Flat под DE) помечен «— нет накладок»");
});
