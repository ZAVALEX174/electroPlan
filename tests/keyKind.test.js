"use strict";
/* К14 ч.2 — раздел «Клавиша» каталога окна поста делится на простые клавиши и «Клавиши с символами».
   Проверяем на НАСТОЯЩЕМ каталоге VIMAR:
     1) правило EPKeyKind.isSimpleKey — числа простых/с символами по сериям (мутация правила их ломает);
     2) шов EPCatalogSections.build с тем же groupOf, что и в postBuilder.renderBuilderCatalog:
        символьные клавиши уходят в раздел «Клавиши с символами» СРАЗУ после «Клавиша», простые
        остаются, фильтр по месту (hiddenBySpan) работает в обоих разделах;
     3) поведение окна поста (renderBuilderCatalog): раздел «Клавиши с символами» свёрнут по
        умолчанию и раскрыт при поиске.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPKeyKind = require("../js/keyKind.js");
const EPCatalogSections = require("../js/catalogSections.js");
/* renderBuilderCatalog с К14 ч.3 сворачивает осевые цельные изделия перед build (EPAxialCard) —
   признак «осевой» берёт у EPLightingPlan. Клавиши (partRole "key") свёртка не трогает, но объекты
   должны существовать в контексте: даём настоящие модули. */
const EPAxialCard = require("../js/axialCard.js");
const EPLightingPlan = require("../js/lightingPlan.js");

/* Обогащённые товары как в рантайме (data.js домешивает attrs.roles/attrs.groups): partRole и
   functionalGroup приезжают из js/catalog-vimar-attrs.js, в каталоге их нет. */
function enrichedProducts() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/catalog-vimar.js"), "utf8"), { window: win });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/catalog-vimar-attrs.js"), "utf8"), { window: win });
  const roles = (win.EP_VIMAR_ATTRS && win.EP_VIMAR_ATTRS.roles) || {};
  const groups = (win.EP_VIMAR_ATTRS && win.EP_VIMAR_ATTRS.groups) || {};
  return win.EP_VIMAR_CATALOG.products.map(p => {
    const out = { ...p };
    const r = roles[p.code]; if (r) { if (r.part) out.partRole = r.part; if (r.control) out.controlRole = r.control; }
    const g = groups[p.code]; if (g) { if (g.group) out.functionalGroup = g.group; if (g.subgroup) out.functionalSubgroup = g.subgroup; }
    return out;
  });
}

const PRODUCTS = enrichedProducts();
const KEY_SECTION = PRODUCTS.filter(p => p.partRole === "key" && p.functionalGroup === "Клавиша");
const serOf = k => (k.series || []).join("/") || "(нет)";

test("разведка: раздел «Клавиша» — настоящие клавиши каталога (контроль фикстуры)", () => {
  assert.equal(KEY_SECTION.length, 245, "245 клавиш в группе «Клавиша»");
  // Числа по сериям — те, на которых выведено правило (см. отчёт К14 ч.2).
  const bySer = {};
  KEY_SECTION.forEach(k => { bySer[serOf(k)] = (bySer[serOf(k)] || 0) + 1; });
  assert.equal(bySer["Arke"], 38, "Arke — 38 (факт разведки)");
  assert.equal(bySer["Eikon"], 33, "Eikon Evo — 33 (факт разведки)");
});

test("правило isSimpleKey: числа простых/с символами по сериям на реальном каталоге", () => {
  const counts = {};
  KEY_SECTION.forEach(k => {
    const s = serOf(k);
    counts[s] = counts[s] || { simple: 0, symbol: 0 };
    if (EPKeyKind.isSimpleKey(k)) counts[s].simple++; else counts[s].symbol++;
  });
  // Выверено глазами по полному списку (см. отчёт). Мутация правила меняет хоть одно число → красит.
  assert.deepEqual(counts["Arke"], { simple: 8, symbol: 30 }, "Arke: узкая/широкая/3М × (серая/белая/Metal) минус 19022.B");
  assert.deepEqual(counts["Eikon"], { simple: 9, symbol: 24 }, "Eikon Evo");
  assert.deepEqual(counts["Plana"], { simple: 8, symbol: 8 }, "Plana");
  assert.deepEqual(counts["Eikon Tondo"], { simple: 9, symbol: 0 }, "Eikon Tondo — символьных нет");
  assert.deepEqual(counts["Eikon Flat"], { simple: 12, symbol: 53 }, "Eikon Flat 22751");
  assert.deepEqual(counts["Linea"], { simple: 18, symbol: 66 }, "Linea 31000/31000A/31000S");
  const total = KEY_SECTION.filter(k => EPKeyKind.isSimpleKey(k)).length;
  assert.equal(total, 64, "всего простых 64 из 245");
});

test("правило по НАЗВАНИЮ надёжнее суффикса: 31000.C — цвет «конопляная», простая; 31000.CB — звонок, с символом", () => {
  const simple = PRODUCTS.find(p => p.code === "31000.C");
  const bell = PRODUCTS.find(p => p.code === "31000.CB");
  assert.ok(simple && bell, "позиции есть в каталоге");
  assert.equal(EPKeyKind.isSimpleKey(simple), true, "31000.C «конопляная» — простая (суффикс .C тут цвет)");
  assert.equal(EPKeyKind.isSimpleKey(bell), false, "31000.CB «символ звонок» — с символом");
});

test("ловушка «без символов» (22751.0.*) — простая, хотя слово «символ» в названии есть", () => {
  const plain = PRODUCTS.find(p => p.code === "22751.0.01");   // «без символов»
  const dots = PRODUCTS.find(p => p.code === "22751.01");      // «символ три точки»
  const diff = PRODUCTS.find(p => p.code === "19026");         // диффузор
  const scene = PRODUCTS.find(p => p.code === "22751.6.01");   // сценария «Дом» (без слова «символ»)
  assert.equal(EPKeyKind.isSimpleKey(plain), true, "«без символов» — простая");
  assert.equal(EPKeyKind.isSimpleKey(dots), false, "«символ три точки» — с символом");
  assert.equal(EPKeyKind.isSimpleKey(diff), false, "диффузор — с символом");
  assert.equal(EPKeyKind.isSimpleKey(scene), false, "сценарий — с символом");
});

/* ШОВ: тот же groupOf, что в postBuilder.renderBuilderCatalog. Второй копии не держим — повторяем
   выражение буквально, чтобы тест ловил расхождение смысла. */
function wiredGroupOf(item) {
  const keyGroupKey = EPCatalogSections.keyOf(EPKeyKind.KEY_GROUP_LABEL);
  const g = item && item.functionalGroup;
  return g && EPCatalogSections.keyOf(g) === keyGroupKey && !EPKeyKind.isSimpleKey(item)
    ? EPKeyKind.SYMBOL_GROUP_LABEL : g;
}

test("шов build: символьные клавиши → раздел «Клавиши с символами» сразу после «Клавиша»; простые остаются", () => {
  const arke = KEY_SECTION.filter(k => serOf(k) === "Arke");
  const res = EPCatalogSections.build(arke, { groupOf: wiredGroupOf });
  const plain = res.sections.find(s => s.label === "Клавиша");
  const sym = res.sections.find(s => s.label === "Клавиши с символами");
  assert.ok(plain && sym, "оба раздела присутствуют");
  assert.equal(plain.items.length, 8, "в «Клавиша» только простые (8)");
  assert.equal(sym.items.length, 30, "в «Клавиши с символами» — символьные/диффузор (30)");
  // Порядок: «Клавиша» идёт раньше «Клавиши с символами».
  const labels = res.sections.map(s => s.label);
  assert.ok(labels.indexOf("Клавиша") < labels.indexOf("Клавиши с символами"), "символьный раздел — после простого");
  // Ни одна простая не утекла в символьный и наоборот.
  assert.ok(plain.items.every(i => EPKeyKind.isSimpleKey(i)), "в «Клавиша» все простые");
  assert.ok(sym.items.every(i => !EPKeyKind.isSimpleKey(i)), "в «Клавиши с символами» ни одной простой");
});

test("шов build: фильтр по месту (hiddenBySpan) работает в ОБОИХ разделах", () => {
  const arke = KEY_SECTION.filter(k => serOf(k) === "Arke");
  // spanOf по модульности, свободен 1 модуль → двух/трёхмодульные прячутся в обоих разделах.
  const res = EPCatalogSections.build(arke, {
    groupOf: wiredGroupOf,
    spanOf: i => i.moduleSpan || 1,
    maxSpan: 1
  });
  const plain = res.sections.find(s => s.label === "Клавиша");
  const sym = res.sections.find(s => s.label === "Клавиши с символами");
  assert.ok(plain.hiddenBySpan > 0, "в «Клавиша» часть скрыта по месту (широкая/3М)");
  assert.ok(sym.hiddenBySpan > 0, "в «Клавиши с символами» тоже скрыто по месту");
  assert.ok(plain.items.every(i => (i.moduleSpan || 1) <= 1), "в «Клавиша» показаны только 1-модульные");
});

/* ПОВЕДЕНИЕ ОКНА ПОСТА: исполняем настоящий renderBuilderCatalog из js/postBuilder.js. UI-соседей
   стабим, доменная часть (EPCatalogSections.build + groupOf + EPKeyKind) — настоящая. Предмет
   проверки — что владелец видит: раздел «Клавиши с символами» свёрнут по умолчанию (caret ▸,
   aria-expanded=false) и раскрыт при поиске (▾, aria-expanded=true). */
function runCatalog(query) {
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  dom.els.builderCatalog = { innerHTML: "", querySelectorAll: () => [] };
  dom.els.builderTarget = { innerHTML: "" };
  const arke = KEY_SECTION.filter(k => serOf(k) === "Arke");
  const state = { builder: { target: { mode: "add" }, query: query || "", openSections: new Set(), slots: [] } };
  const ctx = {
    state, $: dom.$,
    EPCatalogSections, EPKeyKind, EPAxialCard, EPLightingPlan,
    EPCatalog: { facingColorKey: x => x }, productSeries: () => [],
    builderCtx: { frameMissing: false, mechs: arke, remaining: 3, frame: { code: "19653.01" }, innardsColor: null, seriesCount: arke.length },
    spanForFrame: () => () => 1, mechanismSpan: () => 1,
    product: () => null, frameProduct: () => null,
    isBareMechanism: () => false,
    moduleWord: () => "", esc: s => String(s == null ? "" : s),
    productCardHtml: () => "", emptyCatalogHtml: () => "",
    bindProductPictureFallbacks: () => {}, pickBuilderProduct: () => {},
    EPMechColor: { emptyCatalogText: () => "", colorKey: () => null }, innardsEmptyText: () => "",
    resolveMissingMechanism: () => null, moduleWordCapitalized: () => ""
  };
  stand.run(["renderBuilderCatalog"], ctx)();
  return dom.els.builderCatalog.innerHTML;
}

test("окно поста: «Клавиши с символами» свёрнут по умолчанию", () => {
  const html = runCatalog("");
  assert.match(html, /Клавиши с символами/, "раздел присутствует");
  // Голова раздела «Клавиши с символами» со свёрнутым состоянием: aria-expanded="false" и каретка ▸.
  const head = html.match(/aria-expanded="(true|false)"[^>]*>\s*<span><span class="caret"[^>]*>(▾|▸)<\/span>Клавиши с символами</);
  assert.ok(head, "нашли заголовок раздела с состоянием");
  assert.equal(head[1], "false", "по умолчанию свёрнут (aria-expanded=false)");
  assert.equal(head[2], "▸", "каретка свёрнутого раздела");
});

test("окно поста: поиск по символьной клавише раскрывает «Клавиши с символами»", () => {
  const html = runCatalog("звонок");
  const head = html.match(/aria-expanded="(true|false)"[^>]*>\s*<span><span class="caret"[^>]*>(▾|▸)<\/span>Клавиши с символами</);
  assert.ok(head, "раздел найден при поиске");
  assert.equal(head[1], "true", "при поиске раскрыт (aria-expanded=true)");
  assert.equal(head[2], "▾", "каретка раскрытого раздела");
});
