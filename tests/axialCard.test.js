/* К14 ч.3 — свёртка осевых цельных изделий «Управления светом» в одну карточку (js/axialCard.js) и её
   встраивание в каталог окна поста (js/postBuilder.js renderBuilderCatalog). Заказчик 15.10 (0:20:47):
   «берём 19-100 осевой… 19-104 переключатель… зачем это изобилие картинок». Решение владельца 02.11:
   одна карточка-представитель на серию × цвет × ширину, роль выберет схема (resolveReplacement).

   Три слоя проверки:
     A. ЧИСТЫЙ модуль EPAxialCard.collapse на синтетике — группировка, выбор представителя, что НЕ
        сворачивается (неосевое, кнопка/датчик/диммер, другой цвет/ширина/серия, голый механизм, группа из
        одного). Осевой признак берём настоящим EPLightingPlan.isAxialItem — он же у resolveReplacement.
     B. НАСТОЯЩИЙ каталог VIMAR (functionalGroup «Управление светом»): числа Arke 36→24, Eikon 42→30,
        Plana 19→15; Linea/Neve Up не затронуты; во всех реальных группах представитель — выключатель.
     C. НАСТОЯЩИЙ renderBuilderCatalog через appStand: при пустом запросе 19104.B/19113.B свёрнуты в
        карточку 19100.B с подписью; при поиске «19104» карточка 19104.B есть, подписи нет.

   Мутации (состязательный проход — сломай код, тест обязан покраснеть):
     • убрать в collapse фильтр axialOf → свернётся неосевой «тройной» 14007, тест A «неосевое не
       сворачивается» и число Plana в B покраснеют;
     • выбрать представителем не switch, а первого в группе → тест A «представитель — выключатель» и
       B «представитель — выключатель» покраснеют;
     • включить colorKeyOf в один ключ (вернуть всегда null) → белые и чёрные осевые слипнутся, число
       Arke в B покраснеет;
     • снять в postBuilder гейт `state.builder.query ?` (сворачивать всегда) → тест C «поиск не
       сворачивает» покраснеет (19104.B исчезнет под 19100.B).
   Запуск: node --test tests/axialCard.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPAxialCard = require("../js/axialCard.js");
const EPLightingPlan = require("../js/lightingPlan.js");
const EPCatalog = require("../js/catalog.js");
const EPMechColor = require("../js/mechColor.js");
const EPCatalogSections = require("../js/catalogSections.js");
const EPKeyKind = require("../js/keyKind.js");
const stand = require("./helpers/appStand.js");

/* ─────────────────────── A. чистый модуль на синтетике ─────────────────────── */

let nid = 0;
const mk = (code, name, controlRole, over) => Object.assign(
  { id: ++nid, code, name, controlRole, kind: "mechanism", active: true }, over || {});
/* deps ровно как у оркестратора: осевой — настоящий isAxialItem, роль — controlRole. */
const DEPS = {
  partOf: i => i && i.partRole,
  roleOf: i => i && i.controlRole,
  axialOf: EPLightingPlan.isAxialItem,
  spanOf: i => (i && i.moduleSpan) || 1,
  colorKeyOf: i => (i && i.color) || null,
  seriesKeyOf: i => (i && i.series) || "",
  idOf: i => i && i.id
};
const codesOf = list => list.map(x => x.code);

test("A: осевые switch/changeover/inverter одной серии+цвета+ширины сворачиваются в выключатель", () => {
  const sw = mk("19100.B", "Выключатель осевой белый", "switch", { series: "arke", color: "бел" });
  const ch = mk("19104.B", "Переключатель осевой белый", "changeover", { series: "arke", color: "бел" });
  const inv = mk("19113.B", "Инвертор осевой белый", "inverter", { series: "arke", color: "бел" });
  const res = EPAxialCard.collapse([ch, inv, sw], DEPS);     // порядок входа «не выключатель первым»
  assert.deepEqual(codesOf(res.items), ["19100.B"], "осталась одна карточка — выключатель");
  assert.ok(res.repIds.has(sw.id), "её id помечен представителем");
  assert.equal(res.repIds.size, 1);
});

test("A: без выключателя представитель — переключатель, затем инвертор", () => {
  const ch = mk("19104.B", "Переключатель осевой белый", "changeover", { series: "arke", color: "бел" });
  const inv = mk("19113.B", "Инвертор осевой белый", "inverter", { series: "arke", color: "бел" });
  const res = EPAxialCard.collapse([inv, ch], DEPS);
  assert.deepEqual(codesOf(res.items), ["19104.B"], "переключатель главнее инвертора");
  assert.ok(res.repIds.has(ch.id));
});

test("A: НЕОСЕВОЕ не сворачивается (Plana «тройной 20AX» 14007)", () => {
  const sw = mk("14100", "Выключатель осевой белый", "switch", { series: "plana", color: "бел" });
  const triple = mk("14007", "Выключатель тройной 20AX белый", "switch", { series: "plana", color: "бел" });
  const res = EPAxialCard.collapse([sw, triple], DEPS);
  assert.deepEqual(codesOf(res.items).sort(), ["14007", "14100"], "оба остались — 14007 не осевой");
  assert.equal(res.repIds.size, 0, "группы из одного осевого нет — сворачивать нечего");
});

test("A: кнопка/датчик/диммер (другие роли) не сворачиваются с выключателем", () => {
  const sw = mk("19100.B", "Выключатель осевой белый", "switch", { series: "arke", color: "бел" });
  const btn = mk("19108.B", "Кнопка осевая белая", "button", { series: "arke", color: "бел" });
  const sensor = mk("19181.B", "ИК-датчик осевой белый", "sensor", { series: "arke", color: "бел" });
  const dim = mk("19135.1.B", "Диммер осевой белый", "dimmer", { series: "arke", color: "бел" });
  const res = EPAxialCard.collapse([sw, btn, sensor, dim], DEPS);
  assert.deepEqual(codesOf(res.items), ["19100.B", "19108.B", "19181.B", "19135.1.B"], "все остались");
  assert.equal(res.repIds.size, 0, "выключатель один в своей группе — не сворачивается");
});

test("A: разный цвет / ширина / серия — разные группы, не слипаются", () => {
  const whiteSw = mk("19100.B", "Выключатель осевой белый", "switch", { series: "arke", color: "бел" });
  const whiteCh = mk("19104.B", "Переключатель осевой белый", "changeover", { series: "arke", color: "бел" });
  const blackSw = mk("19100", "Выключатель осевой чёрный", "switch", { series: "arke", color: "черн" });
  const blackCh = mk("19104", "Переключатель осевой чёрный", "changeover", { series: "arke", color: "черн" });
  const wideSw = mk("19100.2.B", "Выключатель осевой белый 2 модуля", "switch", { series: "arke", color: "бел", moduleSpan: 2 });
  const wideCh = mk("19104.2.B", "Переключатель осевой белый 2 модуля", "changeover", { series: "arke", color: "бел", moduleSpan: 2 });
  const otherSw = mk("20101.B", "Выключатель осевой белый", "switch", { series: "eikon", color: "бел" });
  const otherCh = mk("20105.B", "Переключатель осевой белый", "changeover", { series: "eikon", color: "бел" });
  const res = EPAxialCard.collapse([whiteSw, whiteCh, blackSw, blackCh, wideSw, wideCh, otherSw, otherCh], DEPS);
  assert.deepEqual(codesOf(res.items).sort(),
    ["19100", "19100.2.B", "19100.B", "20101.B"].sort(), "по одной карточке на каждую из 4 групп");
  assert.equal(res.repIds.size, 4);
});

test("A: голый механизм и клавиша (partRole) не сворачиваются", () => {
  const bareSw = mk("19001.0", "Выключатель осевой голый", "switch", { series: "arke", color: "бел", partRole: "bare_mechanism" });
  const bareCh = mk("19005.0", "Переключатель осевой голый", "changeover", { series: "arke", color: "бел", partRole: "bare_mechanism" });
  const res = EPAxialCard.collapse([bareSw, bareCh], DEPS);
  assert.deepEqual(codesOf(res.items).sort(), ["19001.0", "19005.0"], "голые механизмы не трогаем");
  assert.equal(res.repIds.size, 0);
});

/* ─────────────────────── B. настоящий каталог VIMAR ─────────────────────── */

function loadRuntime() {
  const jsDir = path.join(__dirname, "..", "js");
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-discontinued.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(jsDir, file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;
}
const PRODUCTS = loadRuntime();
const colorKeyOf = item => EPMechColor.colorKey(item, { keyOf: EPCatalog.facingColorKey });
const seriesKeyOf = item => EPCatalog.productSeries(item).map(s => s.toLowerCase().trim()).sort().join("|");
const RUNTIME_DEPS = {
  partOf: i => i && i.partRole,
  roleOf: i => i && i.controlRole,
  axialOf: EPLightingPlan.isAxialItem,
  spanOf: EPCatalog.mechanismSpan,
  colorKeyOf, seriesKeyOf,
  idOf: i => i && i.id
};
const controlLight = series => PRODUCTS.filter(p =>
  p.kind === "mechanism" && p.active && p.functionalGroup === "Управление светом"
  && (EPCatalog.productSeries(p)[0] || "") === series);

for (const [series, before, after] of [["Arke", 36, 24], ["Eikon", 42, 30], ["Plana", 19, 15]]) {
  test(`B: ${series} «Управление светом» ${before}→${after} карточек после свёртки`, () => {
    const items = controlLight(series);
    assert.equal(items.length, before, "предпосылка: столько активных карточек в каталоге");
    const res = EPAxialCard.collapse(items, RUNTIME_DEPS);
    assert.equal(res.items.length, after, "столько карточек осталось");
  });
}

for (const series of ["Linea", "Neve Up"]) {
  test(`B: ${series} не затронут (своих осевых цельных выключателей в группе нет)`, () => {
    const items = controlLight(series);
    assert.ok(items.length > 0, "предпосылка: серия присутствует в группе");
    const res = EPAxialCard.collapse(items, RUNTIME_DEPS);
    assert.equal(res.items.length, items.length, "ни одна карточка не свёрнута");
    assert.equal(res.repIds.size, 0);
  });
}

test("B: во всех реальных свёрнутых группах представитель — ВЫКЛЮЧАТЕЛЬ", () => {
  const items = PRODUCTS.filter(p => p.kind === "mechanism" && p.active && p.functionalGroup === "Управление светом");
  const res = EPAxialCard.collapse(items, RUNTIME_DEPS);
  const byId = new Map(items.map(p => [p.id, p]));
  assert.ok(res.repIds.size > 0, "свёртка хоть что-то нашла");
  for (const id of res.repIds) {
    assert.equal(byId.get(id).controlRole, "switch", `представитель ${byId.get(id).code} — выключатель`);
  }
});

/* ─────────────────────── C. окно поста: реальный renderBuilderCatalog ─────────────────────── */

const byCode = code => PRODUCTS.find(p => String(p.code) === code);
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));

/* DOM-шим с настоящим host.querySelectorAll (стенда он не даёт — renderBuilderCatalog вешает обработчики). */
function builderDom() {
  const dom = stand.makeDom();
  const host = dom.$("builderCatalog");
  host.querySelectorAll = () => [];
  return dom;
}

function renderCatalog(query) {
  const dom = builderDom();
  const arke = controlLight("Arke");
  const state = { builder: { query, openSections: new Set(["управление светом"]), target: { mode: "add" }, slots: [] } };
  const ctx = {
    $: dom.$, state,
    builderCtx: { frameMissing: false, mechs: arke, remaining: 8, maxPostCap: 8, addMax: 8, frame: null },
    product,
    mechanismSpan: EPCatalog.mechanismSpan,
    spanForFrame: () => item => EPCatalog.mechanismSpan(item),
    frameProduct: () => null,
    productSeries: EPCatalog.productSeries,
    EPMechColor, EPCatalog, EPKeyKind, EPCatalogSections, EPAxialCard, EPLightingPlan,
    isBareMechanism: item => item && item.partRole === "bare_mechanism",
    moduleWord: n => `${n} мод.`,
    productPicture: () => "",
    productMoney: () => "<b>—</b>",
    bindProductPictureFallbacks: () => {},
    pickBuilderProduct: () => {},
    esc: s => String(s == null ? "" : s)
  };
  stand.run(["productCardHtml", "renderBuilderCatalog"], ctx)();
  return dom.$("builderCatalog").innerHTML;
}

test("C: пустой запрос — 19104.B/19113.B свёрнуты в карточку 19100.B с подписью", () => {
  const html = renderCatalog("");
  const rep = byCode("19100.B"), ch = byCode("19104.B"), inv = byCode("19113.B");
  assert.ok(html.includes(`data-pick="${rep.id}"`), "карточка-представитель 19100.B есть");
  assert.ok(html.includes(EPAxialCard.CAPTION), "у неё подпись «Осевой …»");
  assert.ok(!html.includes(`data-pick="${ch.id}"`), "отдельной карточки 19104.B нет — свёрнута");
  assert.ok(!html.includes(`data-pick="${inv.id}"`), "отдельной карточки 19113.B нет — свёрнута");
});

test("C: поиск «19104» НЕ сворачивает — карточка 19104.B есть, подписи нет", () => {
  const html = renderCatalog("19104");
  const ch = byCode("19104.B");
  assert.ok(html.includes(`data-pick="${ch.id}"`), "19104.B найден как отдельная карточка");
  assert.ok(!html.includes(EPAxialCard.CAPTION), "при поиске подпись осевой свёртки не появляется");
});
