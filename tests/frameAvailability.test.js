/* Единое состояние накладки (HANDOFF 2.1).
   Один и тот же пост проходит через настоящие потребители: смету, свод поставщику,
   подсказку плана, раскладку КП, лист монтажника и взрыв-схему. Проверяем не копии
   формулировок, а объект EPPosts.frameAvailability, который им передаёт postComposition. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPEstimate = require("../js/estimate.js");
const EPInstallSheet = require("../js/installSheet.js");
const EPOfferPdf = require("../js/offerPdf.js");
const EPSupplierSpec = require("../js/supplierSpec.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ACTIVE = { id: 10, kind: "frame", code: "F10", name: "Накладка 3М", price: 12.5, active: true };
const OFF = { ...ACTIVE, id: 11, code: "F11", name: "Накладка старая", active: false };
const MISSING_ID = 999;

const compOf = info => ({
  frame: info.frame,
  frameAvailability: info,
  standard: "unknown",
  model: null,
  modulesTotal: 0,
  boxCount: 0,
  postCount: null,
  support: null,
  supportCount: 0,
  supportNotRequired: false,
  supportAssumed: false,
  box: null,
  boxFallback: null
});

test("frameAvailability различает четыре состояния и отдаёт одну готовую подпись", () => {
  const active = EPPosts.frameAvailability(ACTIVE.id, ACTIVE);
  const off = EPPosts.frameAvailability(OFF.id, OFF);
  const missing = EPPosts.frameAvailability(MISSING_ID, null);
  const unset = EPPosts.frameAvailability(null, null);

  assert.deepEqual([active.state, off.state, missing.state, unset.state],
    ["available", "discontinued", "missing", "unset"]);
  assert.equal(active.displayName, "Накладка 3М");
  assert.equal(off.displayName, "Накладка старая (снята с производства)");
  assert.equal(missing.displayName, "Накладка не найдена (арт. 999)");
  assert.equal(unset.displayName, "Накладка не выбрана");
  assert.equal(off.blocksDocuments, false, "снятая накладка существует и документ не блокирует");
  assert.equal(missing.blocksDocuments, true, "исчезнувший артикул блокирует документ конструктора");
  assert.equal(unset.blocksDocuments, true, "без выбора документ конструктора тоже недостоверен");
});

test("postComposition несёт тот же объект состояния всем потребителям", () => {
  const post = { frameId: OFF.id, mechanismIds: [] };
  const comp = EPPosts.postComposition(post, {
    product: () => null,
    frameProduct: id => Number(id) === OFF.id ? OFF : null,
    mechanismSpan: () => 1
  });
  assert.equal(comp.frame, OFF);
  assert.equal(comp.frameAvailability.frame, comp.frame, "товар и состояние не разрешаются двумя путями");
  assert.equal(comp.frameAvailability.displayName, "Накладка старая (снята с производства)");
});

function estimateFor(frameId, frame) {
  const post = { id: "p1", name: "Пост", frameId, mechanismIds: [] };
  const comp = compOf(EPPosts.frameAvailability(frameId, frame));
  return EPEstimate.build({
    posts: [post],
    product: () => null,
    frameProduct: () => frame,
    postComposition: () => comp,
    postCost: () => frame ? frame.price : 0,
    settings: {}
  });
}

test("смета использует единую подпись: снятая считается, исчезнувшая названа", () => {
  const off = estimateFor(OFF.id, OFF);
  assert.match(off.groups[0].composition, /Накладка старая \(снята с производства\)/);
  assert.equal(off.equipment, OFF.price, "снятие с производства не обнуляет настоящую цену");

  const missing = estimateFor(MISSING_ID, null);
  assert.match(missing.groups[0].composition, /Накладка не найдена \(арт\. 999\)/);
  assert.deepEqual(missing.missing, [MISSING_ID]);
});

function supplierData(comp, post) {
  const build = stand.run("supplierSpecData", {
    state: { posts: [post], devices: [] },
    postComposition: () => comp,
    product: () => null,
    lightingRowsFor: () => [],
    EPLightingGroups: { isSupplyGap: () => false },
    EPSupplierSpec
  });
  return build({ plan: { relayTotal: 0 } });
}

test("свод поставщику берёт ту же подпись у снятой и исчезнувшей накладки", () => {
  const offInfo = EPPosts.frameAvailability(OFF.id, OFF);
  const offRows = EPSupplierSpec.collect(supplierData(compOf(offInfo),
    { id: "p1", frameId: OFF.id, mechanismIds: [] })).rows;
  assert.equal(offRows.find(r => r.kind === "frame").name, offInfo.displayName);

  const missingInfo = EPPosts.frameAvailability(MISSING_ID, null);
  const missingRows = EPSupplierSpec.collect(supplierData(compOf(missingInfo),
    { id: "p2", frameId: MISSING_ID, mechanismIds: [] })).rows;
  assert.equal(missingRows.find(r => r.kind === "frame").name, missingInfo.displayName);
  assert.equal(missingRows.find(r => r.kind === "frame").code, null);
});

test("подсказка на плане показывает единую подпись вместо пустого <dd>", () => {
  const hover = stand.makeElement();
  const missingInfo = EPPosts.frameAvailability(MISSING_ID, null);
  const show = stand.run("showHover", {
    hover,
    postComposition: () => compOf(missingInfo),
    assembledPostHtml: () => "<post-picture>",
    postNumberLabel: () => "Пост № 7",
    postTotalCost: () => 0,
    money: n => `${n} €`,
    esc,
    positionHover: () => {}
  });
  show("post", { frameId: MISSING_ID }, {});
  assert.match(hover.innerHTML, /Накладка не найдена \(арт\. 999\)/);
  assert.ok(!/<dt>Накладка<\/dt><dd><\/dd>/.test(hover.innerHTML), "пустой строки накладки больше нет");
});

function postLayoutFor(info) {
  const post = { id: "p1", number: 1, frameId: info.frameId, mechanismIds: [] };
  const build = stand.run("buildPostLayout", {
    state: { posts: [post] },
    postComposition: () => compOf(info),
    product: () => null,
    EPPosts,
    assembledPostHtml: () => "<post-picture>"
  });
  return build();
}

test("раскладка постов КП печатает состояние рядом с иллюстрацией", () => {
  const missingInfo = EPPosts.frameAvailability(MISSING_ID, null);
  const layout = postLayoutFor(missingInfo);
  assert.equal(layout[0].frameStatusText, missingInfo.displayName);
  const html = EPOfferPdf.buildHtml({
    groups: [], equipment: 0, discount: 0, materials: 0, work: 0, subtotal: 0, vat: 0, total: 0
  }, {
    money: n => String(n), esc, displayCurrency: () => "EUR", settings: {}, postLayout: layout
  });
  assert.match(html, /<div class="pl-frame-status">Накладка не найдена \(арт\. 999\)<\/div>/);

  const activeLayout = postLayoutFor(EPPosts.frameAvailability(ACTIVE.id, ACTIVE));
  assert.equal(activeLayout[0].frameStatusText, "", "исправную накладку под картинкой не дублируем");
});

function buildSheet(info) {
  const comp = compOf(info);
  const build = stand.run(["buildExplodedSpec", "buildPostSheet"], {
    postComposition: () => comp,
    product: () => null,
    mechanismSpan: () => 1,
    lightingRowsFor: () => [],
    EPLightingGroups: { isSupplyGap: () => false },
    EPPosts,
    EPBuilderSlots,
    keySlotKind: () => false,
    EPInstallSheet,
    state: { rooms: [] },
    assembledPostSpec: () => ({ size: "md", frame: null, rows: [] }),
    EPPostImage: { buildHtml: () => "", photoReady: () => false },
    EPExplodedView: { buildHtml: spec => JSON.stringify(spec) },
    productImage: () => "",
    esc,
    STANDARD_LABEL: { unknown: "неизвестный" }
  });
  return build({ id: "p1", number: 1, frameId: info.frameId, mechanismIds: [] }, {});
}

test("лист монтажника и его взрыв-схема не теряют исчезнувшую накладку", () => {
  const info = EPPosts.frameAvailability(MISSING_ID, null);
  const sheet = buildSheet(info);
  assert.equal(sheet.frameName, info.displayName, "состояние попало в шапку карточки");
  assert.equal(sheet.fittings.find(f => f.role === "Накладка").name, info.displayName,
    "состояние попало в обвязку");
  assert.match(sheet.explodedViewHtml, /Накладка не найдена \(арт\. 999\)/,
    "состояние попало во взрыв-схему");

  const html = EPInstallSheet.buildHtml({ posts: [sheet] }, { esc });
  assert.match(html, /Накладка не найдена \(арт\. 999\)/, "готовый документ называет пробел");
});

test("лист монтажника одинаково помечает снятую накладку во всех трёх местах", () => {
  const info = EPPosts.frameAvailability(OFF.id, OFF);
  const sheet = buildSheet(info);
  assert.equal(sheet.frameName, info.displayName);
  assert.equal(sheet.fittings.find(f => f.role === "Накладка").name, info.displayName);
  assert.match(sheet.explodedViewHtml, /Накладка старая \(снята с производства\)/);
});

test("защитный обработчик не формирует лист из конструктора без накладки", () => {
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  dom.$("postFrameSelect").innerHTML = '<option value="999">недоступна</option>';
  dom.$("postFrameSelect").value = "999";
  const messages = [];
  const open = stand.run("installSheetForBuilder", {
    $: dom.$,
    frameProduct: () => null,
    EPPosts,
    toast: text => messages.push(text)
  });
  open();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Лист монтажника недоступен: накладка недоступна/);
});
