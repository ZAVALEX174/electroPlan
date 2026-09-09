/* Настройка подсветки клавиш на уровне ПРОЕКТА (B1b): сохранение/восстановление и рендер
   органов управления. Исполняем НАСТОЯЩИЙ исходник app.js в vm-стенде (tests/helpers/appStand),
   а не пересказываем логику: проверяем ровно связки, которые легко сломать —
     · projectSnapshot кладёт backlight в terms (без этого настройка не сохранится);
     · restoreProject возвращает её, а старый проект без поля открывается ВЫКЛЮЧЕННЫМ;
     · renderProjectBacklight строит цвет/напряжение ИЗ КАТАЛОГА и гасит селекторы при
       выключенной галочке одной точкой синхронизации. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPPosts = require("../js/posts.js");
const EPPostFit = require("../js/postfit.js");
const EPOfferOptions = require("../js/offerOptions.js");

/* Каталог аксессуаров-подсветок: два цвета и два напряжения — селекторы обязаны предложить
   ровно их, строками из каталога (матчинг строгий, «Зелёная» с ё). */
const ACC = [
  { code: "00936.250.W", kind: "accessory", askBacklight: true, backlightPosition: 3, backlightColor: "Белая" },
  { code: "00936.250.R", kind: "accessory", askBacklight: true, backlightPosition: 3, backlightColor: "Красная" },
  { code: "00936.120.W", kind: "accessory", askBacklight: true, backlightPosition: 3, backlightColor: "Белая" },
  { code: "20001.0", kind: "mechanism" }   // не аксессуар — в опции не попадает
];
const byKind = kind => kind === "accessory" ? ACC : [];

function makeCtx(over) {
  const dom = stand.makeDom({ selects: ["backlightColorSelect", "backlightVoltageSelect", "currencySelect"] });
  const settings = { backlight: { enabled: false, color: "Белая", voltage: "110-250V" } };
  const ctx = { $: dom.$, esc: String, byKind, EPPostFit, EP_DATA: { settings } };
  return { dom, ctx: Object.assign(ctx, over || {}) };
}

test("renderProjectBacklight: цвет и напряжение строятся ИЗ КАТАЛОГА (не хардкод)", () => {
  const { dom, ctx } = makeCtx();
  stand.run(["backlightCatalogOptions", "renderProjectBacklight"], ctx)();
  assert.match(dom.$("backlightColorSelect").innerHTML, /Белая/);
  assert.match(dom.$("backlightColorSelect").innerHTML, /Красная/);
  assert.doesNotMatch(dom.$("backlightColorSelect").innerHTML, /20001/, "механизм в цвета не попал");
  assert.match(dom.$("backlightVoltageSelect").innerHTML, /110-250V/);
  assert.match(dom.$("backlightVoltageSelect").innerHTML, /120V/);
});

test("renderProjectBacklight: выключено → селекторы недоступны, включено → доступны (одна синхронизация)", () => {
  const { dom, ctx } = makeCtx();
  const render = stand.run(["backlightCatalogOptions", "renderProjectBacklight"], ctx);
  render();
  assert.equal(dom.$("backlightEnabled").checked, false);
  assert.equal(dom.$("backlightColorSelect").disabled, true, "выключено — цвет недоступен");
  assert.equal(dom.$("backlightVoltageSelect").disabled, true, "выключено — напряжение недоступно");
  ctx.EP_DATA.settings.backlight = { enabled: true, color: "Красная", voltage: "120V" };
  render();
  assert.equal(dom.$("backlightEnabled").checked, true);
  assert.equal(dom.$("backlightColorSelect").disabled, false, "включено — цвет доступен");
  assert.equal(dom.$("backlightColorSelect").value, "Красная", "выбран восстановленный цвет");
  assert.equal(dom.$("backlightVoltageSelect").value, "120V");
});

test("projectSnapshot: backlight едет в terms (иначе настройка не сохранится)", () => {
  const dom = stand.makeDom();
  dom.$("planImage").src = "";
  const state = { devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [],
    planVisibility: "show", panX: 0, panY: 0, scale: 1, orthoMode: true, snapGrid: true, gridStep: 10,
    pxPerMeter: null, scaleSegment: null, planLoaded: false, planLabel: "" };
  const settings = { workPercent: 18, materialsPercent: 7, discountPercent: 0, vatPercent: 20, vatEnabled: true,
    rateSurchargePercent: 3, wallType: "solid", lightingScheme: "classic",
    backlight: { enabled: true, color: "Красная", voltage: "120V" },
    displayCurrency: "EUR", eurRate: null, rateDate: null, rateSource: null, docHeader: {}, offerOptions: undefined };
  const ctx = { $: dom.$, state, EP_DATA: { settings }, EPOfferOptions };
  const snap = stand.run("projectSnapshot", ctx)();
  assert.deepEqual(snap.terms.backlight, { enabled: true, color: "Красная", voltage: "120V" });
});

/* Общий стенд восстановления: snapshot → restoreProject на живом app.js. plan:null пропускает
   асинхронную загрузку картинки, остальное стабим. */
function restoreStand(snapshot, startBacklight) {
  const dom = stand.makeDom({ selects: ["backlightColorSelect", "backlightVoltageSelect", "currencySelect"] });
  const state = {};
  const settings = { backlight: startBacklight };
  const noop = () => {};
  const ctx = { $: dom.$, esc: String, byKind, EPPostFit, EPPosts, EPOfferOptions, state,
    EP_DATA: { settings },
    ProjectStore: { load: () => snapshot },
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s },
    dropOrphanKeyGroups: noop, renderLightingSchemeSelect: noop, renderProjectWallTypeSelect: noop,
    fillDocHeaderInputs: noop, syncOfferOptions: noop, markCanvasUsed: noop };
  const restore = stand.run(["backlightCatalogOptions", "renderProjectBacklight", "restoreProject"], ctx);
  return { dom, ctx, restore };
}

test("restoreProject: сохранённая подсветка возвращается и показана в панели", async () => {
  const snap = { terms: { workPercent: 18, backlight: { enabled: true, color: "Красная", voltage: "120V" } } };
  const { dom, ctx, restore } = restoreStand(snap, { enabled: false, color: "Белая", voltage: "110-250V" });
  await restore();
  assert.deepEqual(ctx.EP_DATA.settings.backlight, { enabled: true, color: "Красная", voltage: "120V" });
  assert.equal(dom.$("backlightEnabled").checked, true, "галочка отражает восстановленное значение");
  assert.equal(dom.$("backlightColorSelect").disabled, false);
});

test("restoreProject: СТАРЫЙ проект без поля backlight открывается ВЫКЛЮЧЕННЫМ", async () => {
  const snap = { terms: { workPercent: 18 } };   // подсветки в terms нет вовсе
  const { dom, ctx, restore } = restoreStand(snap, { enabled: false, color: "Белая", voltage: "110-250V" });
  await restore();
  assert.equal(ctx.EP_DATA.settings.backlight.enabled, false, "задним числом подсветка не включается");
  assert.equal(dom.$("backlightEnabled").checked, false);
  assert.equal(dom.$("backlightColorSelect").disabled, true, "селекторы недоступны — считать нечего");
});
