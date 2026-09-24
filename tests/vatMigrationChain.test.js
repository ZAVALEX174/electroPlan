/* ДЕНЬГИ: режим НДС не должен «уплывать» на цикле «открыть → сохранить → открыть».
   Дефект (найден состязательным проходом): старый проект с {vatEnabled:false} открывался как
   «Не учитывать», но restoreProject не писал режим в settings, а projectSnapshot терял его
   (undefined выкидывался из JSON) и больше не писал vatEnabled — в сохранении не оставалось НИ
   одного поля НДС. Повторное открытие откатывалось на дефолт data.js (vatEnabled:true) → «Начислить
   сверху», и КП задним числом дорожал на НДС.

   Проверяем на НАСТОЯЩИХ restoreProject/projectSnapshot (исходный текст из app.js исполняется в vm)
   и НАСТОЯЩИХ дефолтах data.js (между «открытиями» settings сбрасывается на дефолт, как при
   перезагрузке страницы). Единственный источник режима — EPEstimate.vatModeOf; и снапшот, и
   восстановление обязаны давать один и тот же режим на любом пути. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferOptions = require("../js/offerOptions.js");

/* Настоящие дефолты data.js (как их видит браузер при загрузке): исполняем файл в vm с
   window-шимом и берём копию settings. Клонируем на каждое «открытие» — точно как перезагрузка
   страницы даёт свежий EP_DATA до восстановления проекта. */
function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

const CATALOG = { 1: { id: 1, name: "Розетка", code: "R", price: 100, unit: "шт." } };
/* Итог по финальным настройкам, база = 100 € (работы/материалы/скидка = 0). */
function totalFor(settings) {
  const est = EPEstimate.build({
    devices: [{ productId: 1 }], posts: [], product: id => CATALOG[id], frameProduct: id => CATALOG[id],
    postCost: () => 0, settings: Object.assign({}, settings, { workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 20 })
  });
  return est.total;
}

/* Один «сеанс браузера»: общий контекст для restoreProject и projectSnapshot, чтобы они делили
   state и EP_DATA.settings. renderProjectBacklight и прочие соседи заглушены — предмет здесь только
   проводка режима НДС через восстановление и снапшот. */
function makeSession() {
  const dom = stand.makeDom();
  const state = {};
  const store = { value: null };
  const ctx = {
    $: dom.$, esc: String, state,
    EP_DATA: { settings: freshDefaults() },
    EPEstimate, EPPosts, EPOfferOptions,
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s },
    ProjectStore: { load: () => store.value },
    dropOrphanKeyGroups: () => {}, renderLightingSchemeSelect: () => {},
    renderProjectWallTypeSelect: () => {}, renderProjectBacklight: () => {},
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, markCanvasUsed: () => {}
  };
  const src = stand.functionSource("restoreProject") + "\n" + stand.functionSource("projectSnapshot")
    + "\n;({ restore: restoreProject, snapshot: projectSnapshot });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, dom, store, restore: api.restore, snapshot: api.snapshot,
    resetDefaults: () => { ctx.EP_DATA.settings = freshDefaults(); } };
}

/* Полный цикл: открыть проект с заданными terms → сохранить → сбросить настройки на дефолт →
   открыть сохранённое. Возвращает режимы обоих открытий, снапшот и финальные настройки. */
async function roundTrip(initialTerms) {
  const s = makeSession();
  s.store.value = { terms: initialTerms };
  await s.restore();
  const mode1 = EPEstimate.vatModeOf(s.ctx.EP_DATA.settings);
  const settings1 = Object.assign({}, s.ctx.EP_DATA.settings);
  const snap = s.snapshot();
  s.resetDefaults();          // перезагрузка страницы: свежий EP_DATA из data.js
  s.store.value = snap;
  await s.restore();
  const mode2 = EPEstimate.vatModeOf(s.ctx.EP_DATA.settings);
  return { mode1, mode2, snap, settings1, settings2: Object.assign({}, s.ctx.EP_DATA.settings) };
}

test("старый проект {vatEnabled:false}: «не учитывать» переживает перезагрузку, итог не дорожает", async () => {
  const r = await roundTrip({ vatEnabled: false });
  assert.equal(r.mode1, "none", "первое открытие мигрирует галочку в «не учитывать»");
  assert.equal(r.snap.terms.vatMode, "none", "снапшот сохранил режим (не потерял в undefined)");
  assert.equal(r.mode2, "none", "после перезагрузки режим тот же — не откатился на дефолт");
  assert.equal(totalFor(r.settings2), 100, "итог остался 100, а не 120 (задним числом НДС не начислен)");
});

test("проект {vatEnabled:true}: «начислить сверху» переживает перезагрузку", async () => {
  const r = await roundTrip({ vatEnabled: true });
  assert.equal(r.mode1, "surcharge");
  assert.equal(r.snap.terms.vatMode, "surcharge", "снапшот сохранил режим");
  assert.equal(r.mode2, "surcharge", "режим стабилен между открытиями");
  assert.equal(totalFor(r.settings2), 120, "итог с НДС сверху = 120");
});

test("очень старый проект без полей НДС: режим по дефолту стабилен между открытиями", async () => {
  const r = await roundTrip({});
  assert.equal(r.mode1, "surcharge", "нет полей → дефолт data.js (vatEnabled:true) → «сверху»");
  assert.equal(r.snap.terms.vatMode, "surcharge", "снапшот пишет эффективный режим, а не пусто");
  assert.equal(r.mode2, "surcharge", "перезагрузка не меняет режим");
});

test("новый проект {vatMode:\"included\"}: режим восстанавливается и переживает перезагрузку", async () => {
  const r = await roundTrip({ vatMode: "included" });
  assert.equal(r.mode1, "included");
  assert.equal(r.snap.terms.vatMode, "included", "сохранён именно выбранный режим");
  assert.equal(r.mode2, "included", "после перезагрузки — тот же режим");
  assert.equal(totalFor(r.settings2), 100, "«выделить» не добавляет НДС к итогу");
});

/* restoreProject обязан выставить СЕЛЕКТОР по мигрированному режиму (через vatModeOf, не по сырому
   settings.vatMode, которого у старого проекта нет) и погасить «НДС, %» на «Не учитывать». */
test("restoreProject выставляет селектор режима и гасит «НДС, %» по мигрированному режиму", async () => {
  const s = makeSession();
  s.store.value = { terms: { vatEnabled: false } };
  await s.restore();
  assert.equal(s.dom.els.vatMode.value, "none",
    "селектор показывает мигрированный режим (через vatModeOf, а не сырое пустое поле)");
  assert.equal(s.dom.els.vatInput.disabled, true, "поле «НДС, %» погашено на «не учитывать»");
});

/* projectSnapshot обязан записать ЭФФЕКТИВНЫЙ режим через vatModeOf даже когда settings.vatMode ещё
   не проставлен (undefined выпал бы из JSON и режим потерялся бы — денежный дефект). */
test("projectSnapshot пишет режим через vatModeOf, а не сырое (пустое) поле", () => {
  const dom = stand.makeDom();
  dom.$("planImage").src = "";
  const state = { devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [],
    planVisibility: "show", panX: 0, panY: 0, scale: 1, orthoMode: true, snapGrid: true, gridStep: 10,
    pxPerMeter: null, scaleSegment: null, planLoaded: false, planLabel: "" };
  const settings = { vatEnabled: false, docHeader: {}, offerOptions: undefined };  // vatMode ОТСУТСТВУЕТ
  const snap = stand.run("projectSnapshot", { $: dom.$, state, EP_DATA: { settings }, EPOfferOptions, EPEstimate })();
  assert.equal(snap.terms.vatMode, "none",
    "снапшот вычислил режим (сырое поле было бы undefined и выпало бы из сохранения)");
});
