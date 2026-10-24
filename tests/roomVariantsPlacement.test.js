/* К8а, часть 3 — РАЗМЕЩЕНИЕ/КОПИРОВАНИЕ готового поста (А) и «ГОТОВЫЕ ПОСТЫ» (Б) под НЕСКОЛЬКО вариантов
   отделки комнаты (EPRoomVariants, решения владельца 24.10).

   Что владелец увидит на экране: собрал комнату с двумя вариантами («немецкий Plana белый» и
   «итальянский Neve Up белый»); ставит готовый пост — если его накладка годится ХОТЯ БЫ одному варианту,
   она остаётся; не годится ни одному — меняется под ПЕРВЫЙ вариант. В «Готовых постах» комнаты видны
   посты цвета ЛЮБОГО её варианта.

   Уровни:
     А1 чистый   — EPRoomVariants.fitIndex/placementIndex (без каталога, предикат снаружи);
     А2 связка   — НАСТОЯЩИЙ frameForRoomPlacement (вырезка из postVariant.js) на синтетическом каталоге;
     Б1 чистый   — EPPosts.templateFitsRoomColors;
     Б2 связка   — НАСТОЯЩИЙ renderTemplates сужает библиотеку по цветам ВСЕХ вариантов.
   Одновариантная комната — отдельным тестом: результат тот же, что у плоской комнаты (байт-в-байт).

   МУТАЦИИ (прогнаны руками, см. отчёт): placementFits «вариант всегда подходит» → А2(2) краснеет;
   fitIndex по одному variants[0] → А2(1) краснеет; подмена под variants[last] → А2(2) краснеет;
   templateFitsRoomColors .some→.every → Б1 краснеет.
   Запуск: node --test tests/roomVariantsPlacement.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPPosts = require("../js/posts.js");
const EPRoomVariants = require("../js/roomVariants.js");

/* --- Синтетический каталог: три серии A/B/C, белые 2М, механизм-универсал под все три серии. --- */
const FA2 = { id: 100, kind: "frame", active: true, series: ["A"], frameColor: "Белая", slotCount: 2, price: 10, code: "A2", name: "A рамка белая 2М" };
const FB2 = { id: 200, kind: "frame", active: true, series: ["B"], frameColor: "Белая", slotCount: 2, price: 25, code: "B2", name: "B рамка белая 2М" };
const FC2 = { id: 300, kind: "frame", active: true, series: ["C"], frameColor: "Белая", slotCount: 2, price: 40, code: "C2", name: "C рамка белая 2М" };
/* Чёрная и зелёная накладки — чтобы эти цвета были В КАТАЛОГЕ (frameFacingList): иначе EPRoom.roomFrameFacing
   считает цвет варианта «мёртвым» (нет в прайсе) и обнуляет его. На подбор серии A/B/C белых они не влияют. */
const FK2 = { id: 210, kind: "frame", active: true, series: ["B"], frameColor: "Чёрная", slotCount: 2, price: 30, code: "B2K", name: "B рамка чёрная 2М" };
const FG2 = { id: 310, kind: "frame", active: true, series: ["C"], frameColor: "Зелёная", slotCount: 2, price: 35, code: "C2G", name: "C рамка зелёная 2М" };
/* Механизм совместим со всеми тремя сериями — чтобы подбор упирался в СЕРИЮ НАКЛАДКИ, а не клавиш. */
const MU = { id: 900, kind: "mechanism", active: true, series: ["A", "B", "C"], moduleSpan: 1, price: 5, code: "MU", name: "клавиша универсал 1М" };
/* Клавиша ТОЛЬКО серии B — встаёт лишь в накладку B (для проверки перебора вариантов по порядку). */
const MB = { id: 901, kind: "mechanism", active: true, series: ["B"], moduleSpan: 1, price: 5, code: "MB", name: "клавиша B 1М" };
const PRODUCTS = [FA2, FB2, FC2, FK2, FG2, MU, MB];
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byKind = kind => PRODUCTS.filter(p => p.kind === kind && p.active);

/* Комната с вариантами: variant1 = плоские поля, variant2+ = moreVariants (модель хранения К8а). */
const ROOM_A_THEN_B = { id: "rAB", name: "Гостиная", collection: "A", frameColor: "Белая",
  moreVariants: [{ collection: "B", frameColor: "Белая" }] };

/* ============================ А1. ЧИСТЫЙ УРОВЕНЬ (EPRoomVariants) ============================ */

test("А1 fitIndex/placementIndex: накладка подходит ВТОРОМУ варианту → индекс 2-го; placementIndex не 0", () => {
  const variants = EPRoomVariants.list(ROOM_A_THEN_B);
  assert.equal(variants.length, 2, "комната несёт два варианта (плоский + moreVariants)");
  /* fits(variant, frame) — предикат снаружи: вариант подходит, если его collection равна серии накладки. */
  const fits = (v, f) => v.collection === f.series[0];
  assert.equal(EPRoomVariants.fitIndex(variants, FB2, fits), 1, "FB2 (серия B) подходит варианту №2");
  assert.equal(EPRoomVariants.placementIndex(variants, FB2, fits), 1, "placementIndex отдаёт индекс подошедшего");
  assert.equal(EPRoomVariants.fitIndex(variants, FC2, fits), -1, "FC2 (серия C) не подходит ни одному");
  assert.equal(EPRoomVariants.placementIndex(variants, FC2, fits), 0, "ни одному → ПЕРВЫЙ вариант (0)");
});

/* ============================ А2. СВЯЗКА: frameForRoomPlacement ============================ */

const CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingLabels",
  "frameFacingSelectionLabels", "templateMechSeries", "frameSwapEmptyText", "roomCatalogFilter",
  "frameFitsTemplateMechs", "placementFits", "preferOwnFrame", "frameForRoomPlacement"];

function placeFrame(template, room, products = PRODUCTS) {
  const prod = id => products.find(p => Number(p.id) === Number(id));
  const byKindL = kind => products.filter(p => p.kind === kind && p.active);
  const ctx = {
    EPCatalog, EPRoom, EPPosts, EPRoomVariants,
    byKind: byKindL, frameProduct: prod, product: prod,
    compatibleMechanisms: EPCatalog.compatibleMechanisms, productSeries: EPCatalog.productSeries,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord, mechanismSpan: EPCatalog.mechanismSpan
  };
  return stand.run(CUT, ctx)(template, room);
}

test("★ А2(1): накладка поста подходит ВТОРОМУ варианту комнаты → НЕ трогаем (frameId:null)", () => {
  const template = { id: "t", name: "Пост B", frameId: FB2.id, frameColor: "Белая", mechanismIds: [MU.id, MU.id] };
  const res = placeFrame(template, ROOM_A_THEN_B);
  assert.equal(res.frameId, null, "FB2 годится варианту №2 (B белая) → накладку не меняем; мутация «смотреть только variants[0]» подменила бы её и краснит здесь");
  assert.ok(!res.blocked, "не блокировка");
});

test("★ А2(2): накладка не подходит НИ ОДНОМУ варианту → подмена под ПЕРВЫЙ вариант (серия A)", () => {
  const template = { id: "t", name: "Пост C", frameId: FC2.id, frameColor: "Белая", mechanismIds: [MU.id, MU.id] };
  const res = placeFrame(template, ROOM_A_THEN_B);
  assert.equal(res.frameId, FA2.id,
    "ни A, ни B не подошли C → берём накладку ПЕРВОГО варианта (A белая FA2); мутация «под последний вариант» вернула бы FB2, «вариант всегда подходит» — null — обе краснят здесь");
  assert.notEqual(res.frameId, FB2.id, "не под второй вариант");
});

test("★ А2(3): пустой вариант в комнате = весь каталог → накладка подходит всегда, подмены нет", () => {
  /* Второй вариант пуст ({}) — «любая отделка». Любая накладка годится ему → решение 2 оставляет её. */
  const room = { id: "rE", name: "Кладовка", collection: "A", frameColor: "Белая", moreVariants: [{}] };
  const template = { id: "t", name: "Пост C", frameId: FC2.id, frameColor: "Белая", mechanismIds: [MU.id, MU.id] };
  const res = placeFrame(template, room);
  assert.equal(res.frameId, null, "пустой вариант принимает любую накладку → не трогаем");
  assert.ok(!res.blocked, "не блокировка");
});

test("★ А2 одновариантная комната — БАЙТ-В-БАЙТ как плоская (moreVariants отсутствует/пуст — не влияет)", () => {
  /* Один вариант: пост чужой серии C → подмена под единственный вариант (A). Добавление пустого
     moreVariants:[] не должно менять результат (модель хранения: нет доп.вариантов = одна отделка). */
  const flat = { id: "r1", name: "Комната", collection: "A", frameColor: "Белая" };
  const withEmptyArr = { id: "r1", name: "Комната", collection: "A", frameColor: "Белая", moreVariants: [] };
  const tpl = { id: "t", name: "Пост C", frameId: FC2.id, frameColor: "Белая", mechanismIds: [MU.id, MU.id] };
  assert.equal(placeFrame(tpl, flat).frameId, FA2.id, "плоская комната: подмена под свою единственную отделку (A)");
  assert.equal(placeFrame(tpl, withEmptyArr).frameId, placeFrame(tpl, flat).frameId, "moreVariants:[] = то же, что без поля");
  /* Своя серия A → не трогаем, тоже как раньше. */
  const tplA = { id: "t", name: "Пост A", frameId: FA2.id, frameColor: "Белая", mechanismIds: [MU.id, MU.id] };
  const resA = placeFrame(tplA, flat);
  assert.equal(resA.frameId, null, "накладка своей серии в одновариантной комнате — не трогаем");
  assert.ok(!resA.blocked, "не блокировка");
});

test("★ А2(4): накладка не подошла ни одному → перебор вариантов ПО ПОРЯДКУ, первый СОБИРАЕМЫЙ (решение 24.10)", () => {
  /* Комната: В1 {серия A}, В2 {серия B}. Пост — накладка C (не подходит ни одному) с клавишами серии B.
     Под В1 (A) подмены нет (клавиши B в накладку A не встают); под В2 (B) собирается → берём FB2. */
  const room = { id: "rord", name: "Гостиная", collection: "A", frameColor: "Белая", moreVariants: [{ collection: "B", frameColor: "Белая" }] };
  const template = { id: "t", name: "Пост B-клавиши", frameId: FC2.id, frameColor: "Белая", mechanismIds: [MB.id, MB.id] };
  const res = placeFrame(template, room);
  assert.equal(res.frameId, FB2.id,
    "взята накладка ВТОРОГО варианта (B), под который состав собирается; мутация «только variants[0]» дала бы blocked и краснит здесь");
  assert.ok(!res.blocked, "пост не заблокирован — есть собираемый вариант");
});

test("★ А2(5): не встаёт НИ В ОДИН вариант → blocked (текст от первого варианта)", () => {
  /* Клавиши серии B, но оба варианта — серии A (в накладку A клавиши B не встают нигде). */
  const room = { id: "rblk", name: "Кладовка", collection: "A", frameColor: "Белая", moreVariants: [{ collection: "A", frameColor: "Чёрная" }] };
  const template = { id: "t", name: "Пост B", frameId: FC2.id, frameColor: "Белая", mechanismIds: [MB.id, MB.id] };
  const res = placeFrame(template, room);
  assert.equal(res.frameId, undefined, "не подменён");
  assert.equal(res.blocked, true, "заблокирован — ни в один вариант не встаёт");
  assert.match(res.message, /Кладовка/, "текст называет комнату (от первого варианта)");
});

/* ============================ Б1. ЧИСТЫЙ: templateFitsRoomColors ============================ */

const colorDeps = { frameProduct: product, facingColorKey: EPCatalog.facingColorKey };
const T_WHITE = { frameColor: "Белая" };
const T_BLACK = { frameColor: "Чёрная" };
const T_GREEN = { frameColor: "Зелёная" };

test("Б1 templateFitsRoomColors: null → всё; один цвет; ЛЮБОЙ из нескольких", () => {
  assert.equal(EPPosts.templateFitsRoomColors(T_WHITE, null, colorDeps), true, "roomColors null → показываем всё");
  assert.equal(EPPosts.templateFitsRoomColors(T_WHITE, ["Белая"], colorDeps), true, "цвет совпал");
  assert.equal(EPPosts.templateFitsRoomColors(T_BLACK, ["Белая"], colorDeps), false, "чёрный под белую комнату не идёт");
  // ЯКОРЬ на .some: белый пост годится комнате, у которой БЕЛЫЙ есть хотя бы в одном варианте
  assert.equal(EPPosts.templateFitsRoomColors(T_WHITE, ["Чёрная", "Белая"], colorDeps), true,
    "белый подходит варианту «Белая»; мутация .some→.every дала бы false (не совпал с «Чёрная») и краснит здесь");
  assert.equal(EPPosts.templateFitsRoomColors(T_BLACK, ["Чёрная", "Белая"], colorDeps), true, "чёрный подходит варианту «Чёрная»");
  assert.equal(EPPosts.templateFitsRoomColors(T_GREEN, ["Чёрная", "Белая"], colorDeps), false, "зелёного нет ни в одном варианте");
});

/* ============================ Б2. СВЯЗКА: renderTemplates по вариантам ============================ */

const LT_WHITE = { id: "tW", name: "Пост белый", frameId: FA2.id, frameColor: "Белая", mechanismIds: [MU.id] };
const LT_BLACK = { id: "tK", name: "Пост чёрный", frameId: 999, frameColor: "Чёрная", mechanismIds: [MU.id] };
const LT_GREEN = { id: "tG", name: "Пост зелёный", frameId: 998, frameColor: "Зелёная", mechanismIds: [MU.id] };

function renderLibrary(room, selected) {
  const dom = stand.makeDom();
  const state = { templates: [LT_WHITE, LT_BLACK, LT_GREEN], rooms: room ? [room] : [], products: PRODUCTS, selected };
  const ctx = {
    state, $: dom.$, esc: s => String(s == null ? "" : s),
    frameProduct: product, byKind, EPCatalog, EPRoom, EPPosts, EPRoomVariants,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord,
    mechanismModulesTotal: ids => (ids || []).reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>", document: { querySelectorAll: () => [] }
  };
  stand.run(["frameFacingList", "renderTemplates"], ctx)();
  return dom.$("postLibrary").innerHTML;
}

test("★ Б2: комната с вариантами «Белая» и «Чёрная» → видны ОБА поста (белый и чёрный), зелёный скрыт", () => {
  const room = { id: "rWK", name: "Спальня", frameColor: "Белая", moreVariants: [{ frameColor: "Чёрная" }] };
  const html = renderLibrary(room, { kind: "room", id: room.id });
  assert.match(html, /Пост белый/, "цвет варианта №1");
  assert.match(html, /Пост чёрный/, "цвет варианта №2 — тоже виден (ХОТЯ БЫ один вариант)");
  assert.doesNotMatch(html, /Пост зелёный/, "зелёного нет ни в одном варианте — скрыт");
});

test("★ Б2: один из вариантов БЕЗ цвета → показываем ВСЁ (вариант без цвета принимает любой пост)", () => {
  const room = { id: "rAny", name: "Прихожая", frameColor: "Белая", moreVariants: [{ collection: "A" }] };
  const html = renderLibrary(room, { kind: "room", id: room.id });
  assert.match(html, /Пост белый/);
  assert.match(html, /Пост чёрный/);
  assert.match(html, /Пост зелёный/, "вариант без цвета → библиотека не сужается");
});

test("Б2: одновариантная белая комната → только белый (байт-в-байт прежнего одноцветного поведения)", () => {
  const room = { id: "rW", name: "Кухня", frameColor: "Белая" };
  const html = renderLibrary(room, { kind: "room", id: room.id });
  assert.match(html, /Пост белый/);
  assert.doesNotMatch(html, /Пост чёрный/);
  assert.doesNotMatch(html, /Пост зелёный/);
});

test("Б2: белых/чёрных постов нет под цвета вариантов → честное сообщение с ОБОИМИ цветами", () => {
  const dom = stand.makeDom();
  const room = { id: "rWK", name: "Спальня", frameColor: "Белая", moreVariants: [{ frameColor: "Чёрная" }] };
  const state = { templates: [LT_GREEN], rooms: [room], products: PRODUCTS, selected: { kind: "room", id: room.id } };
  const ctx = {
    state, $: dom.$, esc: s => String(s == null ? "" : s),
    frameProduct: product, byKind, EPCatalog, EPRoom, EPPosts, EPRoomVariants,
    frameSlotCount: EPCatalog.frameSlotCount, moduleWord: EPCatalog.moduleWord,
    mechanismModulesTotal: () => 1, assembledPostHtml: () => "", document: { querySelectorAll: () => [] }
  };
  stand.run(["frameFacingList", "renderTemplates"], ctx)();
  const html = dom.$("postLibrary").innerHTML;
  assert.match(html, /Белая/, "назван цвет варианта №1");
  assert.match(html, /Чёрная/, "назван цвет варианта №2");
  assert.doesNotMatch(html, /пока нет/, "посты есть, просто другого цвета — не «пока нет»");
});
