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
     facingUpperPool без productsForRoom (values от полного каталога)   → §DE-list, §A-notfit, §A-variant2, §material-narrows;
     facingUpperPool: критерий от ВСЕХ полей (k<fields.length, не верхних) → §upper-only (нижнее поле сузило бы верхнее);
     facingUpperPool: k<Math.min(i,2) (отделка ниже серии не сужает)    → §material-narrows (цвет не сузится материалом);
     панель/предикат от варианта 1 вместо выбранного (facingEntity[0])   → §A-variant2;
     facingFieldOptionsHtml без ветки «(не подходит)»                    → §A-notfit;
     variantHasNoFrames: FIELDS.slice(0,2) (пустоту судят лишь по верхним) → §B-lower;
     builderVariantLabel без « — нет накладок»                          → §B-postselect;
     предикат variantHasNoFrames в postBuilder:renderBuilder → v=>false   → §B-postwire (настоящий renderBuilder);
     applyBuilderVariantChange: confirm(true)→restore / без ветки confirm → §switch-ok/§switch-cancel.
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
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPPostVariant = require("../js/postVariant.js");

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

test("§material-narrows: цвет сужается МАТЕРИАЛОМ (поле ниже серии) — не все цвета коллекции", () => {
  // Eikon Evo: 33 цвета всего, с материалом «Камень» — 4. Поле цвета (индекс 4) обязано сузиться
  // материалом (индекс 2). Мутация k<Math.min(i,2) взяла бы критерий лишь из стандарт+серия → 33.
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, collection: "Eikon Evo", frameMaterial: "Камень" });
  const colors = options(html, "room_frameColorSelect").slice(1).filter(o => !/не подходит/.test(o.text)).map(o => o.value);
  assert.equal(colors.length, 4, "цветов ровно 4 (сужены материалом «Камень»), а не 33 всей серии");
  assert.ok(colors.includes("Сланец") && !colors.includes("Аква"),
    "в списке каменные цвета, «Аква» (не каменный) отсутствует");
});

test("§B-lower: пустоту под вариант судим по ВСЕМ полям — комбинация с нижним полём (0 накладок)", () => {
  // Eikon Evo + Камень + Аква = 0 (Аква — не каменный цвет), но Eikon Evo + Камень = 4 > 0.
  // Мутация FIELDS.slice(0,2) судила бы лишь по серии (Eikon Evo > 0) и строку «нет накладок» не показала бы.
  const html = renderPanel({ id: "r1", name: "Гостиная", polygon: null, collection: "Eikon Evo", frameMaterial: "Камень", frameColor: "Аква" });
  const m = html.match(/<small class="prop-hint room-facing-none">([\s\S]*?)<\/small>/);
  assert.ok(m, "строка «нет накладок» показана: под серию+материал+цвет накладок нет");
  assert.match(m[1], /Аква/, "в условиях назван цвет, которым добили пул до нуля");
});

/* --- §B-postwire: предикат «нет накладок» в НАСТОЯЩЕМ renderBuilder (постройка из postBuilder.js) --- */
const RB_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
  "builderRoomFilter", "collectionFramePool", "frameFacingLabels", "frameFacingSelectionLabels", "frameFacingEmptyText",
  "frameFacingHintText", "builderCapacity", "renderBuilder"];
test("§B-postwire: renderBuilder помечает « — нет накладок» у варианта с 0 накладок (предикат из postBuilder:556 подключён)", () => {
  // НАСТОЯЩИЙ renderBuilder зовёт renderBuilderVariantSelect с предикатом variantHasNoFrames; мутация
  // «v=>false» в постройке убрала бы пометку — этот тест через настоящий код её ловит.
  const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount", "builderVariantSelect"] });
  dom.$("postFrameSelect").dataset.preferredFrameId = "";   // frameUnset: ранний путь, но вариант-селектор уже отрисован
  dom.$("postSlotCount").value = "2";
  const state = { products: PRODUCTS,
    rooms: [{ id: "r1", name: "Гостиная", standard: "DE", collection: "Plana", moreVariants: [{ standard: "DE", collection: "Eikon Flat" }] }],
    posts: [{ id: "p1", roomId: "r1", mechanismIds: [] }],
    builder: { slots: [], target: { mode: "add" }, roomId: "r1", variantIndex: 0, editingPlacedId: "p1" } };
  const ctx = {
    state, $: dom.$, esc: s => String(s == null ? "" : s),
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameProduct: product, product, EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPPosts, EPBuilderSlots,
    frameSlotCount: EPCatalog.frameSlotCount, frameSlotOptions: EPCatalog.frameSlotOptions,
    compatibleMechanisms: EPCatalog.compatibleMechanisms, mechanismSpan: EPCatalog.mechanismSpan,
    productSeries: EPCatalog.productSeries, moduleWord: EPCatalog.moduleWord,
    frameOptions: (items, selId) => (items || []).map(i => `<option value="${i.id}">${i.id}</option>`).join(""),
    enhancePicker: () => {}, resolveMissingFrame: () => null,
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    moduleLayout: () => [], lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    renderBuilderSlots: () => {}, renderBuilderCatalog: () => {}, renderBuilderComposition: () => {},
    builderInnardsFilter: () => ({}), builderCtx: {}
  };
  stand.run(RB_CUT, ctx)();
  const opts = [...dom.$("builderVariantSelect").innerHTML.matchAll(/<option value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)].map(o => o[2]);
  assert.equal(opts.length, 2, "селектор варианта показал обе вкладки");
  assert.doesNotMatch(opts[0], /нет накладок/, "вариант 1 (Plana) — накладки есть");
  assert.match(opts[1], /— нет накладок/, "вариант 2 (Eikon Flat под DE) помечен — предикат postBuilder подключён");
});

/* --- Развилка смены варианта/комнаты у нового поста (п.2): applyBuilderVariantChange + текст --- */
const spy = (ret) => { const f = (...a) => { f.calls.push(a); return ret; }; f.calls = []; return f; };
function switchCase(over) {
  const apply = spy(), reset = spy(), restore = spy();
  const d = Object.assign({ applicable: true, fits: false, message: "MSG", confirm: () => true, reset, apply, restore }, over);
  EPRoomVariantsUi.applyBuilderVariantChange(d);
  return { apply, reset, restore, confirmArg: d.confirm.calls && d.confirm.calls[0] };
}
test("§switch-ok: несовместимо + ОК → reset + apply (механизмы сброшены, накладка применена)", () => {
  const r = switchCase({ confirm: spy(true) });
  assert.equal(r.reset.calls.length, 1, "механизмы сброшены");
  assert.equal(r.apply.calls.length, 1, "новый вариант применён");
  assert.equal(r.restore.calls.length, 0, "селектор не возвращён — продолжили");
});
test("§switch-cancel: несовместимо + Отмена → restore, НИЧЕГО не менять", () => {
  const r = switchCase({ confirm: spy(false) });
  assert.equal(r.reset.calls.length, 0, "механизмы НЕ сброшены");
  assert.equal(r.apply.calls.length, 0, "вариант НЕ применён");
  assert.equal(r.restore.calls.length, 1, "селектор возвращён на прежнее значение");
});
test("§switch-fits: накладка подходит → молча apply, без подтверждения", () => {
  const confirm = spy(true);
  const r = switchCase({ fits: true, confirm });
  assert.equal(confirm.calls.length, 0, "подтверждение не спрашивали");
  assert.equal(r.apply.calls.length, 1, "вариант применён молча");
  assert.equal(r.reset.calls.length, 0, "ничего не сброшено");
});
test("§switch-na: правило неприменимо (пост на плане / авто-накладка) → молча apply", () => {
  const confirm = spy(true);
  const r = switchCase({ applicable: false, confirm });
  assert.equal(confirm.calls.length, 0, "подтверждение не спрашивали");
  assert.equal(r.apply.calls.length, 1, "применён молча");
  assert.equal(r.reset.calls.length, 0);
});
test("§switch-msg: текст подтверждения называет условия и предупреждает о сбросе механизмов", () => {
  const msg = EPRoomVariantsUi.builderVariantResetMessage(["стандарт «немецкий»", "серия «Arke»"]);
  assert.match(msg, /не подходит этому варианту/, "назвал несовместимость");
  assert.match(msg, /стандарт «немецкий».*серия «Arke»/, "перечислил условия");
  assert.match(msg, /механизмы поста будут сброшены/, "предупредил о сбросе механизмов");
});

/* --- §switch-wire: НАСТОЯЩАЯ builderVariantSwitch из postBuilder.js ------------------------------
   Выше §switch-* бьют ЧИСТУЮ applyBuilderVariantChange с рукодельным d. Но applicable/fits/reset для
   неё СОБИРАЕТ builderVariantSwitch из состояния окна поста, и этот сбор не держал ни один тест
   (регэксп В4/В5 сторожит лишь проводку onChange, не вычисление applicable). Мутация «applicable:true»
   проходила зелёной — §7.1, край правки. Здесь режем и исполняем НАСТОЯЩУЮ builderVariantSwitch вместе
   с её зависимостями (roomCatalogFilter/frameFacingSelectionLabels) на реальном каталоге VIMAR.
   МУТАЦИОННАЯ ТАБЛИЦА (прогнана, см. отчёт):
     applicable:…→true (убрать editingPlacedId/editingTemplateId/frameAuto/!!frame) → §switch-wire-placed;
     fits:placementFits(frame,crit)→true (не судить совместимость)                   → §switch-wire-ok;
     reset без frameAuto=true / без сброса slots                                     → §switch-wire-ok;
     nv=list(room)[builderIndex(room,index)] → list(room)[0] (игнор выбранного index) → §switch-wire-index-ask/§switch-wire-index-fits
       (прежние §switch-wire-* все на index=0 и одновариантной комнате — мутацию list[0] не ловят). */
const SWITCH_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "roomCatalogFilter",
  "frameFacingLabels", "frameFacingSelectionLabels", "builderVariantSwitch"];
function runSwitch({ builder, frameCode, room, index = 0 }) {
  const frame = frameCode ? PRODUCTS.find(p => p.code === frameCode) : null;
  const state = { products: PRODUCTS, builder };
  const apply = spy(), restore = spy();
  const confirm = (() => { const f = m => { f.calls.push(m); return f.ret; }; f.calls = []; f.ret = true; return f; })();
  const ctx = {
    state, byKind: byKindOf, EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPBuilderSlots,
    frameProduct: id => (frame && String(frame.id) === String(id) ? frame : null),
    $: () => ({ value: frame ? String(frame.id) : "" }),
    keySlotKind: () => null, confirm, apply, restore
  };
  stand.run(SWITCH_CUT, ctx)(room, index, apply, restore);
  return { apply, restore, confirm, builder };
}
test("§switch-wire-ok: новый пост, накладка чужой серии (Plana в варианте Arke), ОК → спросили, сброс frameAuto+slots, apply", () => {
  const builder = { editingPlacedId: null, editingTemplateId: null, frameAuto: false, slots: [{ k: "x" }] };
  const r = runSwitch({ builder, frameCode: "14642.01", room: { id: "r1", collection: "Arke" } });
  assert.equal(r.confirm.calls.length, 1, "несовместимость собрана из состояния → подтверждение спрошено");
  assert.match(r.confirm.calls[0], /серия «Arke»/, "в тексте условия варианта (crit через roomCatalogFilter)");
  assert.equal(builder.frameAuto, true, "ОК → reset вернул накладку к авто-умолчанию (frameAuto=true)");
  assert.equal(builder.slots.length, 0, "ОК → механизмы поста сброшены");
  assert.equal(r.apply.calls.length, 1, "новый вариант применён");
  assert.equal(r.restore.calls.length, 0);
});
test("§switch-wire-fits: новый пост, накладка своей серии (Arke в варианте Arke) → молча apply, без подтверждения", () => {
  const builder = { editingPlacedId: null, editingTemplateId: null, frameAuto: false, slots: [{ k: "x" }] };
  const r = runSwitch({ builder, frameCode: "19642.01", room: { id: "r1", collection: "Arke" } });
  assert.equal(r.confirm.calls.length, 0, "совместимая накладка (fits) → не спрашиваем");
  assert.equal(r.apply.calls.length, 1, "применено молча");
  assert.equal(builder.frameAuto, false, "ничего не сброшено");
  assert.equal(builder.slots.length, 1, "механизмы на месте");
});
test("§switch-wire-placed: редактируется пост НА ПЛАНЕ (editingPlacedId) → правило неприменимо, молча apply даже при чужой накладке", () => {
  // Ровно край мутации applicable:true — несовместимая накладка, но пост уже на плане: спрашивать НЕЛЬЗЯ.
  const builder = { editingPlacedId: "p1", editingTemplateId: null, frameAuto: false, slots: [{ k: "x" }] };
  const r = runSwitch({ builder, frameCode: "14642.01", room: { id: "r1", collection: "Arke" } });
  assert.equal(r.confirm.calls.length, 0, "пост на плане → подтверждение не спрашивали");
  assert.equal(r.apply.calls.length, 1, "применено молча (как было)");
  assert.equal(builder.frameAuto, false, "ничего не сброшено");
  assert.equal(builder.slots.length, 1, "механизмы не тронуты");
});
test("§switch-wire-auto: новый пост, накладка АВТО (frameAuto=true) → правило неприменимо, молча apply", () => {
  // frameAuto=true значит накладку человек руками не выбирал — сбрасывать нечего, вопроса нет.
  const builder = { editingPlacedId: null, editingTemplateId: null, frameAuto: true, slots: [{ k: "x" }] };
  const r = runSwitch({ builder, frameCode: "14642.01", room: { id: "r1", collection: "Arke" } });
  assert.equal(r.confirm.calls.length, 0, "авто-накладка → не спрашиваем");
  assert.equal(r.apply.calls.length, 1, "применено молча");
  assert.equal(builder.slots.length, 1, "механизмы не тронуты");
});
/* --- §switch-wire-index: смена варианта судит ВЫБРАННЫЙ index, а не всегда вариант 0 ---------------
   Состязательный проход (К8г): мутация nv=list(room)[builderIndex(room,index)] → list(room)[0] проходит
   весь npm test зелёной — все прежние §switch-wire-* зовут builderVariantSwitch с index=0 и одновариантной
   комнатой, где [0] и [index] совпадают. Нужны ДВА варианта и переход НА ВТОРОЙ. 19653.02 — Arke, стандарт
   IT (замерено): подходит варианту Arke IT и НЕ подходит Arke DE. */
test("§switch-wire-index-ask: переход на вариант 1 (Arke DE, несовместим) → спросили ИМЕННО по варианту 1, не по 0 (Arke IT)", () => {
  // Вариант 0 = Arke IT (накладке подходит), вариант 1 = Arke DE (не подходит). index=1 обязан спросить;
  // мутация list[0] взяла бы вариант 0 (подходит) → fits=true → молча apply, вопрос бы пропал (денежный
  // дефект: несовместимый вариант применился бы без сброса механизмов).
  const builder = { editingPlacedId: null, editingTemplateId: null, frameAuto: false, slots: [{ k: "x" }] };
  const room = { id: "r1", standard: "IT", collection: "Arke", moreVariants: [{ standard: "DE", collection: "Arke" }] };
  const r = runSwitch({ builder, frameCode: "19653.02", room, index: 1 });
  assert.equal(r.confirm.calls.length, 1, "вариант 1 (Arke DE) несовместим накладке Arke IT → подтверждение спрошено");
  assert.match(r.confirm.calls[0], /немецкий/, "в тексте стандарт именно варианта 1");
  assert.equal(builder.slots.length, 0, "ОК → механизмы сброшены");
  assert.equal(r.apply.calls.length, 1, "новый вариант применён");
});
test("§switch-wire-index-fits: переход на вариант 1 (Arke IT, совместим) → молча apply, не берём вариант 0 (Arke DE)", () => {
  // Обратный край: вариант 0 = Arke DE (не подходит), вариант 1 = Arke IT (подходит). index=1 обязан НЕ
  // спрашивать; мутация list[0] взяла бы вариант 0 (не подходит) → спросила бы зря и сбросила механизмы.
  const builder = { editingPlacedId: null, editingTemplateId: null, frameAuto: false, slots: [{ k: "x" }] };
  const room = { id: "r1", standard: "DE", collection: "Arke", moreVariants: [{ standard: "IT", collection: "Arke" }] };
  const r = runSwitch({ builder, frameCode: "19653.02", room, index: 1 });
  assert.equal(r.confirm.calls.length, 0, "вариант 1 (Arke IT) подходит накладке Arke IT → не спрашиваем");
  assert.equal(r.apply.calls.length, 1, "применено молча");
  assert.equal(builder.slots.length, 1, "механизмы не тронуты");
});

/* --- §rm-wire: resolveMissingFrame получает ПОЛНЫЙ фильтр ВЫБРАННОГО варианта из НАСТОЯЩЕГО renderBuilder
   (postBuilder.js, точка вызова resolveMissing) -----------------------------------------------------
   Состязательный проход (К8г): в точке вызова передать {collection:builderRoomFilter().collection} вместо
   всего фильтра — проходит зелёной. tests/resolveMissingFrameCollection.test.js её НЕ ловит: он бьёт Plana
   против Arke, т.е. различие по СЕРИИ, а мутация серию сохраняет (ловится и старым правилом «по серии»).
   Нужен артикул, совпадающий по СЕРИИ, но НЕ по СТАНДАРТУ: 19652.01 — Arke, стандарт IT, 2 модуля
   (замерено на обогащённом каталоге). В комнате Arke DE полный фильтр {standard:DE,collection:Arke} его
   отсекает → «не подходит этой комнате» без действия; мутация {collection:Arke} → placementFits=true →
   ветка модулей с «Переключить на 2 модуля» (денежный/составной дефект: предложили бы поставить
   несовместимую накладку). Режем и исполняем НАСТОЯЩИЙ renderBuilder, перехватывая resolveMissing из
   enhancePicker — как §B-postwire, но с захватом options.
   МУТАЦИОННАЯ ТАБЛИЦА (прогнана, см. отчёт):
     resolveMissing: builderRoomFilter() → {collection:builderRoomFilter().collection} → §rm-standard, §rm-variant;
     builderFilterRoom: list(room)[builderIndex(room,variantIndex)] → list(room)[0] (игнор variantIndex) → §rm-variant. */
const RM_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
  "builderRoomFilter", "collectionFramePool", "frameFacingLabels", "frameFacingSelectionLabels", "frameFacingEmptyText",
  "frameFacingHintText", "builderCapacity", "findByExactCode", "resolveMissingFrame", "renderBuilder"];
function resolveMissingWired({ room, variantIndex, count }) {
  const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
  // postSlotCount — обычный узел (не <select>): его value держит count детерминированно (у makeSelect
  // присвоение не входящего в options значения снимается в ""). Накладка пустая (frameUnset): renderBuilder
  // доходит до enhancePicker и выходит ранним путём, успев отдать resolveMissing.
  const dom = stand.makeDom({ selects: ["postFrameSelect", "builderVariantSelect"] });
  dom.$("postFrameSelect").dataset.preferredFrameId = "";
  dom.$("postSlotCount").value = String(count);
  const state = { products: PRODUCTS, rooms: [room],
    posts: [{ id: "p1", roomId: room.id, mechanismIds: [] }],
    builder: { slots: [], target: { mode: "add" }, roomId: room.id, variantIndex, editingPlacedId: "p1" } };
  const captured = {};
  const ctx = {
    state, $: dom.$, esc: s => String(s == null ? "" : s),
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameProduct: product, product, EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPPosts, EPBuilderSlots,
    frameSlotCount: EPCatalog.frameSlotCount, frameSlotOptions: EPCatalog.frameSlotOptions,
    compatibleMechanisms: EPCatalog.compatibleMechanisms, mechanismSpan: EPCatalog.mechanismSpan,
    productSeries: EPCatalog.productSeries, moduleWord: EPCatalog.moduleWord,
    frameOptions: (items) => (items || []).map(i => `<option value="${i.id}">${i.id}</option>`).join(""),
    enhancePicker: (sel, options) => { captured.options = options; },
    changePostSlotCount: () => {}, toast: () => {},
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    moduleLayout: () => [], lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    renderBuilderSlots: () => {}, renderBuilderCatalog: () => {}, renderBuilderComposition: () => {},
    builderInnardsFilter: () => ({}), builderCtx: {} };
  stand.run(RM_CUT, ctx)();
  assert.equal(typeof captured.options, "object", "enhancePicker вызван renderBuilder");
  assert.equal(typeof captured.options.resolveMissing, "function", "resolveMissing — функция");
  return captured.options.resolveMissing;
}
test("§rm-standard: resolveMissing отсекает артикул, совпавший по СЕРИИ, но не по СТАНДАРТУ (Arke IT в комнате Arke DE)", () => {
  // Комната немецкая Arke (один вариант), count=3. 19652.01 — Arke, стандарт IT, 2 модуля.
  const rm = resolveMissingWired({ room: { id: "r1", name: "Гостиная", standard: "DE", collection: "Arke" }, variantIndex: 0, count: 3 });
  const res = rm("19652.01");
  assert.ok(res, "артикул есть в каталоге — подсказка обязана быть");
  assert.equal(res.lead, "Артикул есть в каталоге, но не подходит этой комнате.",
    "несовместимость по стандарту судится ПЕРВОЙ — renderBuilder передал ПОЛНЫЙ фильтр, не только серию");
  assert.match(res.reason, /немецкий/, "в причине назван стандарт комнаты (frameFacingSelectionLabels)");
  assert.ok(!("actionLabel" in res), "несовместимой по стандарту накладке «Переключить» НЕ предлагаем");
});
test("§rm-variant: resolveMissing берёт фильтр ВЫБРАННОГО варианта (variantIndex=1 = Arke DE), а не первого (Arke IT)", () => {
  // Вариант 0 = Arke IT (19652.01 ему подошёл бы), вариант 1 = Arke DE (не подходит). variantIndex=1.
  // Ловит И потерю стандарта (мутация точки вызова), И потерю variantIndex (мутация builderFilterRoom).
  const room = { id: "r1", name: "Гостиная", standard: "IT", collection: "Arke", moreVariants: [{ standard: "DE", collection: "Arke" }] };
  const rm = resolveMissingWired({ room, variantIndex: 1, count: 3 });
  const res = rm("19652.01");
  assert.ok(res);
  assert.equal(res.lead, "Артикул есть в каталоге, но не подходит этой комнате.",
    "фильтр варианта 1 (DE) отсёк артикул — выбранный вариант и его стандарт дошли до resolveMissing");
  assert.match(res.reason, /немецкий/, "условия варианта 1 (стандарт немецкий)");
  assert.ok(!("actionLabel" in res), "действия нет: накладка несовместима выбранному варианту");
});
