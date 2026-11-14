/* Б8-д, часть 1б: ВЫБРАННЫЙ РУКАМИ монтажный стандарт (post.standardChoice "IT"/"DE") НЕ теряется там,
   где программа сама перевыбирает накладку поста под комнату — при РАЗМЕЩЕНИИ готового поста и при
   КОПИРОВАНИИ. Утверждённое владельцем правило: стандарт, выбранный на посту руками, ГЛАВНЕЕ стандарта
   комнаты; стандарт комнаты — лишь умолчание для постов без выбора.

   Что проверяем (на НАСТОЯЩЕМ обогащённом каталоге VIMAR, а не на фикстуре-тавтологии, §7.1):
   1) EPPosts.placementFields переносит standardChoice из шаблона в пост (как verticalLayout);
   2) EPPostStandard.criteriaForChoice — чистое правило «выбранный стандарт замещает стандарт комнаты»;
   3) НАСТОЯЩИЙ addPending (frameForRoomPlacement): пост standardChoice "DE" в IT-комнату получает
      DE-накладку в ЦВЕТЕ комнаты (а не IT-накладку), вертикальность по Б8 сохраняется; пост "IT" в
      DE-комнату — IT-накладку цвета комнаты; пост БЕЗ standardChoice — строго как прежде (стандарт
      комнаты). ДО/ПОСЛЕ правки — в отчёте;
   4) EPPostCopy.buildCopies сохраняет standardChoice у копии (поле просто едет).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPPosts = require("../js/posts.js");
const EPRoomVariants = require("../js/roomVariants.js");
const EPPostStandard = require("../js/postStandard.js");
const EPPostCopy = require("../js/postCopy.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPRoomVariantsUi = require("../js/roomVariantsUi.js");
const EPPostVariant = require("../js/postVariant.js");
const EPBuilderSlots = require("../js/builderSlots.js");

/* ============ 0. ЧИСТОЕ ПРАВИЛО: criteriaForChoice ============ */

test("criteriaForChoice: выбор IT/DE перебивает стандарт комнаты; без выбора критерий как есть", () => {
  const roomCrit = { collection: "Linea", frameColor: "Конопляная", standard: "IT" };
  assert.deepEqual(EPPostStandard.criteriaForChoice(roomCrit, "DE"),
    { collection: "Linea", frameColor: "Конопляная", standard: "DE" }, "DE перебивает IT комнаты");
  assert.deepEqual(EPPostStandard.criteriaForChoice(roomCrit, "IT"),
    { collection: "Linea", frameColor: "Конопляная", standard: "IT" }, "IT остаётся IT");
  assert.equal(EPPostStandard.criteriaForChoice(roomCrit, null), roomCrit,
    "нет выбора → ТА ЖЕ ссылка (мутация «null→IT» вернула бы новый объект с standard:IT и краснит здесь)");
  assert.equal(EPPostStandard.criteriaForChoice(roomCrit, "BOTH"), roomCrit, "мусорный выбор → без изменений");
});

/* ============ 1. placementFields переносит standardChoice (как verticalLayout) ============ */

test("placementFields: standardChoice IT/DE переносится из шаблона в пост; иначе поля нет", () => {
  const base = { id: "t", name: "Пост", frameId: 1, mechanismIds: [10, 11] };
  assert.equal(EPPosts.placementFields({ ...base, standardChoice: "DE" }).standardChoice, "DE",
    "явный DE едет в пост — мутация «не переносить standardChoice» оставит поле undefined");
  assert.equal(EPPosts.placementFields({ ...base, standardChoice: "IT" }).standardChoice, "IT");
  assert.ok(!("standardChoice" in EPPosts.placementFields(base)),
    "шаблон без выбора → поля НЕТ (мутация «null→IT: ставить всегда» добавила бы его и краснит здесь)");
  assert.ok(!("standardChoice" in EPPosts.placementFields({ ...base, standardChoice: "BOTH" })),
    "мусорное значение не переносим");
});

/* ============ 2. РЕАЛЬНЫЙ КАТАЛОГ VIMAR: размещение через настоящий addPending ============ */
const fsN = require("node:fs"), pathN = require("node:path"), vmN = require("node:vm");
function loadRuntimeProducts() {
  const jsDir = pathN.join(__dirname, "..", "js");
  const win = {};
  const context = vmN.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vmN.runInContext(fsN.readFileSync(pathN.join(jsDir, file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;   /* синхронно, как в postStandard.test.js (getProducts() вернул бы Promise) */
}
const PRODUCTS = loadRuntimeProducts();
const byCode = code => PRODUCTS.find(p => String(p.code) === code);

/* Начинка — 4 однодюймовых выключателя LINEA, заполняющих 4-модульную накладку (и IT-ряд, и DE 2+2). */
const SWITCH1 = byCode("30000");   /* LINEA, 1 модуль, совместим со всеми LINEA-накладками */
const FILL4 = [SWITCH1.id, SWITCH1.id, SWITCH1.id, SWITCH1.id];

const SWAP_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingLabels", "frameFacingSelectionLabels",
  "templateMechSeries", "frameSwapEmptyText", "roomCatalogFilter", "frameFitsTemplateMechs", "placementFits", "preferOwnFrame", "frameForRoomPlacement", "addPending"];

function placeTemplate({ template, room }) {
  const prod = id => PRODUCTS.find(p => Number(p.id) === Number(id));
  const byKindL = kind => PRODUCTS.filter(p => p.kind === kind && p.active);
  const state = { pending: { type: "post", templateId: template.id }, posts: [], devices: [], templates: [template], rooms: room ? [room] : [], products: PRODUCTS };
  const toasts = [];
  const ctx = {
    state,
    _placeOnPostIcon: null, _lastIconPlacement: null,
    EPCatalog, EPRoom, EPPosts, EPRoomVariants, EPPostStandard,
    /* EPFrameOrientation нужен ветке Б8 (вертикальный двойник подменной накладки). */
    EPFrameOrientation: require("../js/frameOrientation.js"),
    byKind: byKindL, frameProduct: prod, product: prod, compatibleMechanisms: EPCatalog.compatibleMechanisms,
    productSeries: EPCatalog.productSeries,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord, mechanismSpan: EPCatalog.mechanismSpan,
    markCanvasUsed: () => {}, uid: p => p + "GEN",
    getRoomForPoint: () => room || null,
    updateObjectRoom: created => { created.roomId = room ? room.id : null; },
    setTool: () => {}, renderAll: () => {}, renderSummary: () => {},
    toast: m => toasts.push(m),
    EPRoomAssign: { isOutsideRooms: () => false }
  };
  stand.run(SWAP_CUT, ctx)(40, 50);
  return { state, toasts };
}

/* Контрольные артикулы — LINEA 4М, пара IT 30654 ↔ DE 30643, вертикаль DE 30645. */
test("предпосылки каталога: 30654/30643/30645 .00/.01/.02 на месте, стандарты и цвета", () => {
  for (const c of ["30654.00", "30654.01", "30654.02", "30643.00", "30643.01", "30643.02", "30645.00", "30645.01"]) {
    assert.ok(byCode(c), `накладка ${c} есть`);
  }
  assert.equal(byCode("30643.00").standard.toUpperCase(), "DE");
  assert.equal(byCode("30654.00").standard.toUpperCase(), "IT");
  assert.equal(byCode("30645.00").frameColor, "Белая");
  assert.equal(byCode("30645.01").frameColor, "Конопляная");
});

test("★ пример 1: пост 30645.00 (DE, вертикальный) в комнату LINEA «Конопляная» IT → 30645.01 (DE, вертикаль, цвет комнаты)", () => {
  const template = { id: "t1", name: "Пост", frameId: byCode("30645.00").id, frameColor: "Белая",
    mechanismIds: [...FILL4], standardChoice: "DE", verticalLayout: true };
  const room = { id: "rK", name: "Гостиная", collection: "Linea", frameColor: "Конопляная", standard: "IT" };
  const { state, toasts } = placeTemplate({ template, room });
  assert.equal(state.posts.length, 1, "пост размещён: " + JSON.stringify(toasts));
  const got = PRODUCTS.find(p => p.id === state.posts[0].frameId);
  assert.equal(got.code, "30645.01",
    "DE-накладка выбранного стандарта в цвете комнаты, вертикаль по Б8; мутация «убрать criteriaForChoice в подборе» дала бы IT 30654.01");
  assert.equal(got.standard.toUpperCase(), "DE", "стандарт DE сохранён, не стал IT комнаты");
  assert.equal(state.posts[0].standardChoice, "DE",
    "standardChoice уехал в размещённый пост (placementFields) — переживёт правку/перенос; мутация «не переносить standardChoice» оставит поле undefined");
});

test("★ пример 2: пост 30643.00 (DE, горизонтальный) в комнату LINEA «Чёрная» IT → 30643.02 (DE, цвет комнаты)", () => {
  const template = { id: "t2", name: "Пост", frameId: byCode("30643.00").id, frameColor: "Белая",
    mechanismIds: [...FILL4], standardChoice: "DE" };
  const room = { id: "rB", name: "Спальня", collection: "Linea", frameColor: "Чёрная", standard: "IT" };
  const { state, toasts } = placeTemplate({ template, room });
  assert.equal(state.posts.length, 1, "пост размещён: " + JSON.stringify(toasts));
  const got = PRODUCTS.find(p => p.id === state.posts[0].frameId);
  assert.equal(got.code, "30643.02", "DE-накладка Чёрная (цвет комнаты); без правки вышла бы IT 30654.02");
  assert.equal(got.standard.toUpperCase(), "DE");
});

test("★ пример 3: пост 30654.00 (IT) standardChoice IT в комнату LINEA «Конопляная» DE → 30654.01 (IT, цвет комнаты)", () => {
  const template = { id: "t3", name: "Пост", frameId: byCode("30654.00").id, frameColor: "Белая",
    mechanismIds: [...FILL4], standardChoice: "IT" };
  const room = { id: "rKd", name: "Кухня", collection: "Linea", frameColor: "Конопляная", standard: "DE" };
  const { state, toasts } = placeTemplate({ template, room });
  assert.equal(state.posts.length, 1, "пост размещён: " + JSON.stringify(toasts));
  const got = PRODUCTS.find(p => p.id === state.posts[0].frameId);
  assert.equal(got.code, "30654.01", "IT-накладка Конопляная (цвет комнаты), стандарт IT удержан против DE комнаты");
  assert.equal(got.standard.toUpperCase(), "IT");
});

test("Б8-з: 30654.00 без ручного стандарта в комнате «Конопляная» сохраняет 4М в ряд и цену", () => {
  const original = byCode("30654.00"), expected = byCode("30654.01"), wrong = byCode("30643.01");
  assert.ok(original && expected && wrong);
  assert.notEqual(expected.price, wrong.price, "предпосылка: неверная раскладка меняет цену");
  const template = { id: "b8z", name: "LINEA 4М", frameId: original.id,
    frameColor: "Белая", mechanismIds: [...FILL4] };
  const room = { id: "b8zRoom", name: "Кухня", collection: "Linea",
    frameColor: "Конопляная" };
  const { state, toasts } = placeTemplate({ template, room });
  assert.equal(state.posts.length, 1, "пост размещён: " + JSON.stringify(toasts));
  const got = PRODUCTS.find(p => p.id === state.posts[0].frameId);
  assert.equal(got.code, "30654.01", "тот же артикул модели в цвете комнаты, а не DE 2+2");
  assert.equal(got.price, expected.price, "цена соответствует 4М в ряд выбранной отделки");
});

test("Б8-з контроль: явный DE комнаты ограничивает пул, поэтому 30654.00 переходит в 30643.01", () => {
  const template = { id: "b8zDe", name: "LINEA 4М", frameId: byCode("30654.00").id,
    frameColor: "Белая", mechanismIds: [...FILL4] };
  const room = { id: "b8zDeRoom", name: "Кухня", collection: "Linea",
    frameColor: "Конопляная", standard: "DE" };
  const { state, toasts } = placeTemplate({ template, room });
  assert.equal(state.posts.length, 1, "пост размещён: " + JSON.stringify(toasts));
  assert.equal(PRODUCTS.find(p => p.id === state.posts[0].frameId).code, "30643.01",
    "стандарт комнаты соблюдён; правило модели действует только внутри допустимого пула");
});

/* КОНТРОЛЬ: пост БЕЗ standardChoice — поведение строго как прежде (стандарт комнаты). Та же накладка,
   что и до правки: DE-пост в IT-комнату того же цвета теряет стандарт под комнату (IT-двойник). */
test("★ контроль: пост 30643.01 (DE) БЕЗ standardChoice в IT-комнату «Конопляная» → IT 30654.01 (стандарт комнаты, как раньше)", () => {
  const template = { id: "t4", name: "Пост", frameId: byCode("30643.01").id, frameColor: "Конопляная", mechanismIds: [...FILL4] };
  const room = { id: "rK2", name: "Холл", collection: "Linea", frameColor: "Конопляная", standard: "IT" };
  const { state } = placeTemplate({ template, room });
  assert.equal(state.posts.length, 1);
  const got = PRODUCTS.find(p => p.id === state.posts[0].frameId);
  assert.equal(got.code, "30654.01",
    "без выбора стандарт комнаты (IT) делается, как прежде; мутация «null→IT всегда override» дала бы DE 30643.01 и краснит здесь");
});

/* КОНТРОЛЬ «null не трогает стандарт»: пост БЕЗ standardChoice с DE-накладкой в DE-комнату другого цвета
   остаётся DE (стандарт комнаты). Ловит мутацию «null→IT» в criteriaForChoice: та навязала бы IT-пул и
   дала бы IT 30654.01 вместо DE 30643.01. (Предыдущий контроль — IT-комната — эту мутацию НЕ ловит: там
   навязанный IT совпал бы со стандартом комнаты.) */
test("★ контроль (null не навязывает стандарт): DE-пост БЕЗ standardChoice в DE-комнату «Конопляная» → DE 30643.01", () => {
  const template = { id: "t6", name: "Пост", frameId: byCode("30643.00").id, frameColor: "Белая", mechanismIds: [...FILL4] };
  const room = { id: "rKde", name: "Детская", collection: "Linea", frameColor: "Конопляная", standard: "DE" };
  const { state } = placeTemplate({ template, room });
  assert.equal(state.posts.length, 1);
  const got = PRODUCTS.find(p => p.id === state.posts[0].frameId);
  assert.equal(got.code, "30643.01",
    "без выбора стандарт комнаты (DE) сохранён; мутация «null→IT в criteriaForChoice» дала бы IT 30654.01 и краснит здесь");
});

/* КОНТРОЛЬ: в выбранном стандарте накладки этой отделки нет — ведём себя как обычная подмена без неё.
   Пост 30654.40 (Reflex, IT, DE-двойника нет) со standardChoice "DE" в IT-комнату Reflex: пул по DE
   пуст → собираемого кандидата нет → пост НЕ размещён прежним текстом (ничего нового не придумываем). */
test("★ край: standardChoice DE, но DE-накладки отделки нет (Reflex) → пул пуст, пост НЕ размещён прежним текстом", () => {
  const reflex = byCode("30654.40");
  assert.ok(reflex && reflex.standard.toUpperCase() === "IT", "предпосылка: 30654.40 Reflex IT, DE-двойника нет");
  assert.equal(EPPostStandard.twinOf(reflex, PRODUCTS.filter(p => p.kind === "frame" && p.active !== false)), null,
    "у Reflex DE-двойника нет");
  const template = { id: "t5", name: "Пост", frameId: reflex.id, frameColor: reflex.frameColor, mechanismIds: [...FILL4], standardChoice: "DE" };
  const room = { id: "rRf", name: "Reflex", collection: "Linea", frameColor: reflex.frameColor, standard: "IT" };
  const { state, toasts } = placeTemplate({ template, room });
  assert.equal(state.posts.length, 0, "DE-пула в этой отделке нет → пост не ставим с чужой накладкой");
  assert.match(toasts.join(" | "), /не размещён/, "прежний текст блокировки, нового сообщения не вводим");
});

/* ============ 3. КОПИРОВАНИЕ: standardChoice едет в копию (deepClone, не в SERVING_FIELDS) ============ */

test("★ buildCopies сохраняет standardChoice у копии (поле просто едет; подмену накладки делает тот же frameForRoomPlacement)", () => {
  const src = { id: "p1", number: 3, x: 100, y: 100, frameId: byCode("30643.00").id,
    mechanismIds: [], keyGroups: [], keyCrossNumbers: [], keyMechanisms: [], standardChoice: "DE", verticalLayout: true };
  const buf = EPPostCopy.snapshot([src]);
  const copies = EPPostCopy.buildCopies(buf, {
    existingPosts: [src], genId: () => "p2", nextPostNumber: () => 4,
    crossKey: EPLightingGroups.crossGroupKey
  });
  assert.equal(copies.length, 1, "одна копия");
  assert.equal(copies[0].standardChoice, "DE", "standardChoice скопирован (deepClone) — не потерян при копировании");
  assert.equal(copies[0].verticalLayout, true, "verticalLayout тоже на месте (контроль)");
  assert.ok(!("id" in copies[0] && copies[0].id === "p1"), "служебные поля перевыданы");
});

/* ============ 4. ОКНО ПОСТА: смена варианта у поста с выбранным стандартом НЕ даёт лишнего сброса ======
   Дефект (находка части 1б): builderVariantSwitch судил «подходит ли накладка новому варианту» по голому
   roomCatalogFilter — по стандарту КОМНАТЫ. Для нового поста с выбранным руками DE и DE-накладкой это
   давало ЛОЖНОЕ подтверждение «накладка не подходит — сбросить механизмы?» при переходе на IT-вариант
   ТОГО ЖЕ цвета, хотя по утверждённому правилу выбранный стандарт главнее стандарта комнаты. Правка:
   критерий через EPPostStandard.criteriaForChoice(roomCatalogFilter(nv), standardChoice) — тем же, что пул
   окна и подмена при размещении (§7.1). Исполняем НАСТОЯЩУЮ builderVariantSwitch на реальном каталоге. */
const byKindAll = kind => PRODUCTS.filter(p => p.kind === kind && p.active);
const VSWITCH_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "roomCatalogFilter",
  "frameFacingLabels", "frameFacingSelectionLabels", "builderVariantSwitch"];
function runVariantSwitch({ builder, frameCode, room, index }) {
  const frame = frameCode ? byCode(frameCode) : null;
  const state = { products: PRODUCTS, rooms: [room], builder };
  const calls = { confirm: [], apply: 0, restore: 0 };
  const apply = () => { calls.apply++; };
  const restore = () => { calls.restore++; };
  const confirm = m => { calls.confirm.push(m); return true; };
  const ctx = {
    state, byKind: byKindAll, EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi, EPPostVariant, EPBuilderSlots, EPPostStandard,
    frameProduct: id => (frame && String(frame.id) === String(id) ? frame : null),
    $: () => ({ value: frame ? String(frame.id) : "" }),
    keySlotKind: () => null, confirm, apply, restore
  };
  stand.run(VSWITCH_CUT, ctx)(room, index, apply, restore);
  return { calls, builder };
}

/* Комната с двумя вариантами ОДНОГО (итальянского) стандарта: Белая и Чёрная. Вариант 0 — Белая IT. */
const ROOM_IT_2V = { id: "r2v", collection: "Linea", frameColor: "Белая", standard: "IT",
  moreVariants: [{ collection: "Linea", frameColor: "Чёрная", standard: "IT" }] };

test("★ builderVariantSwitch: новый пост 30643.00 (DE) standardChoice DE, переход на IT-вариант Белая (тот же цвет) → подтверждения НЕТ, механизмы целы", () => {
  const builder = { editingPlacedId: null, editingTemplateId: null, frameAuto: false, slots: [{ k: "x" }],
    standardChoice: "DE", roomId: ROOM_IT_2V.id, variantIndex: 1 };
  const r = runVariantSwitch({ builder, frameCode: "30643.00", room: ROOM_IT_2V, index: 0 });
  assert.equal(r.calls.confirm.length, 0,
    "выбранный стандарт DE судит накладку → DE-накладка подходит DE-критерию Белой; лишнего сброса нет (мутация «голый roomCatalogFilter» спросила бы по стандарту IT и краснит здесь)");
  assert.equal(r.calls.apply, 1, "вариант применён молча");
  assert.equal(builder.frameAuto, false, "накладка не сброшена к авто");
  assert.equal(builder.slots.length, 1, "механизмы поста целы (сброса не было)");
});

test("★ builderVariantSwitch (контроль, пост БЕЗ standardChoice): тот же DE-пост в IT-вариант → подтверждение КАК ПРЕЖДЕ", () => {
  const builder = { editingPlacedId: null, editingTemplateId: null, frameAuto: false, slots: [{ k: "x" }],
    roomId: ROOM_IT_2V.id, variantIndex: 1 };   /* standardChoice не задан → стандарт комнаты, прежнее поведение */
  const r = runVariantSwitch({ builder, frameCode: "30643.00", room: ROOM_IT_2V, index: 0 });
  assert.equal(r.calls.confirm.length, 1,
    "без выбора DE-накладка не годится IT-варианту — подтверждение спрошено, байт-в-байт как до правки");
});

test("★ builderVariantSwitch: standardChoice DE, переход на вариант ДРУГОГО цвета (Чёрная) → подтверждение остаётся (цвет честно не совпал, не стандарт)", () => {
  const builder = { editingPlacedId: null, editingTemplateId: null, frameAuto: false, slots: [{ k: "x" }],
    standardChoice: "DE", roomId: ROOM_IT_2V.id, variantIndex: 0 };
  const r = runVariantSwitch({ builder, frameCode: "30643.00", room: ROOM_IT_2V, index: 1 });
  assert.equal(r.calls.confirm.length, 1,
    "накладка Белая, вариант Чёрная — цвет не совпал, подтверждение законно (override стандарта не прячет цветовое несоответствие)");
});
