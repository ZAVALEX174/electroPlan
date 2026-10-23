/* ДЕНЬГИ (В28): курс проекта не должен «уплывать» при открытии страницы.
   Дефект (замер агента съёмки 14.10, настоящий браузер): проект с ручным курсом 92,5 после F5
   открывался с курсом ЦБ 93,7723 из кэша и «Итого» 51 499,86 ₽ вместо 49 321,56 ₽. Причина —
   init() звал loadCachedRate() ПОСЛЕ restoreProject(), безусловно кладя кэшированный курс ЦБ
   поверх курса, который проект только что восстановил из terms.

   Решение владельца 15.10 (вариант «а», не менять): проект хранит курс того дня, когда его
   поставили (и ручной, и ЦБ — с надбавкой и датой); курс обновляется ТОЛЬКО по кнопке «Курс ЦБ».
   Значит на старте кэш применяется лишь к проекту, у которого СВОЕГО курса ещё нет.

   Решение-правило вынесено в чистую EPRates.startupRate (одна точка, §7.1). Здесь проверяем:
   (A) саму функцию на числах; (B) НАСТОЯЩИЙ путь init'а — restoreProject → loadCachedRate —
   исполнением исходного текста app.js в vm (стенд appStand), и что кнопка «Курс ЦБ» (refreshRate)
   обновляет курс всегда. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPRates = require("../js/rates.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferOptions = require("../js/offerOptions.js");

/* ---- (A) чистая startupRate ---- */
test("startupRate: у проекта СВОЙ курс (eurRate>0) — кэш не применяется (возвращаем null)", () => {
  assert.equal(EPRates.startupRate({ eurRate: 92.5, rateSource: "вручную" }, { rate: 93.7723, date: "2026-10-14", source: "ЦБ РФ" }), null);
  assert.equal(EPRates.startupRate({ eurRate: 92.5374, rateSource: "ЦБ РФ", rateSurchargePercent: 3 }, { rate: 95.1, date: "2026-10-15", source: "ЦБ РФ" }), null);
});

test("startupRate: курса у проекта нет — отдаём последний известный из кэша", () => {
  const cached = { rate: 90.0, date: "2026-10-10", source: "ЦБ РФ" };
  assert.equal(EPRates.startupRate({}, cached), cached, "пустые настройки");
  assert.equal(EPRates.startupRate({ eurRate: 0 }, cached), cached, "eurRate=0");
  assert.equal(EPRates.startupRate({ eurRate: null }, cached), cached, "eurRate=null");
});

test("startupRate: ни курса, ни кэша — возвращаем null (применять нечего)", () => {
  assert.equal(EPRates.startupRate({}, null), null);
  assert.equal(EPRates.startupRate({ eurRate: 0 }, undefined), null);
});

/* ---- (B) настоящий путь init: restoreProject → loadCachedRate ----
   Сессия исполняет исходный текст restoreProject/projectSnapshot/applyRateEntry/loadCachedRate из
   app.js в общем vm-контексте (как в vatMigrationChain). EP_DATA сбрасывается на дефолты data.js
   между «открытиями» — ровно как перезагрузка страницы даёт свежий EP_DATA до восстановления. */
function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

function makeSession() {
  const dom = stand.makeDom();
  const state = {};
  const store = { value: null };
  const cache = { value: null };   /* то, что вернёт EPRates.loadCached (кэш курса ЦБ в LocalStorage) */
  const ctx = {
    $: dom.$, esc: String, state,
    EP_DATA: { settings: freshDefaults() },
    EPEstimate, EPPosts, EPOfferOptions,
    /* startupRate берём НАСТОЯЩУЮ из модуля; loadCached — управляемая заглушка кэша */
    EPRates: Object.assign({}, EPRates, { loadCached: () => cache.value }),
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s }, EPPlanRotate: require("../js/planRotate.js"),
    ProjectStore: { load: () => store.value },
    dropOrphanKeyGroups: () => {}, relabelContourRooms: () => {}, renderLightingSchemeSelect: () => {},
    renderProjectWallTypeSelect: () => {}, renderProjectBacklight: () => {},
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, syncPackMultiple: () => {}, markCanvasUsed: () => {}
  };
  const src = stand.functionSource("relabelContourRooms") + "\n" + stand.functionSource("restoreProject")
    + "\n" + stand.functionSource("projectSnapshot")
    + "\n" + stand.functionSource("applyRateEntry") + "\n" + stand.functionSource("loadCachedRate")
    + "\n;({ restore: restoreProject, snapshot: projectSnapshot, loadCachedRate });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, dom, store, cache, restore: api.restore, snapshot: api.snapshot, loadCachedRate: api.loadCachedRate,
    resetDefaults: () => { ctx.EP_DATA.settings = freshDefaults(); } };
}

/* Полный цикл «перезагрузки»: открыть проект с заданными terms → снять снимок → сбросить настройки
   (свежий data.js) → задать кэш ЦБ → восстановить → применить кэш. Возвращает финальные настройки. */
async function reopen(terms, cachedEntry) {
  const s = makeSession();
  s.store.value = { terms };
  await s.restore();
  const snap = s.snapshot();          /* то, что реально уходит в LocalStorage */
  s.resetDefaults();
  s.store.value = snap;
  s.cache.value = cachedEntry;        /* в кэше — свежий курс ЦБ (мог обновиться у другого проекта) */
  await s.restore();
  s.loadCachedRate();                 /* порядок init(): restore → loadCachedRate */
  return { settings: Object.assign({}, s.ctx.EP_DATA.settings), snap };
}

test("ручной курс 92,5 переживает перезагрузку: курс и сумма те же, кэш ЦБ 93,7723 не перетирает", async () => {
  const before = { eurRate: 92.5, rateDate: "2026-10-14", rateSource: "вручную", rateSurchargePercent: 3 };
  const rateBefore = EPRates.effectiveRate(before);
  const r = await reopen(before, { rate: 93.7723, date: "2026-10-15", source: "ЦБ РФ" });
  assert.equal(r.settings.eurRate, 92.5, "курс остался ручной 92,5, а не кэш ЦБ 93,7723");
  assert.equal(r.settings.rateSource, "вручную", "источник остался «вручную»");
  assert.equal(EPRates.effectiveRate(r.settings), rateBefore, "эффективный курс (значит и суммы) не изменился");
});

test("курс ЦБ 92,5374 + надбавка 3% от вчера переживает перезагрузку: курс, дата, надбавка прежние", async () => {
  const before = { eurRate: 92.5374, rateDate: "2026-10-14", rateSource: "ЦБ РФ", rateSurchargePercent: 3 };
  const rateBefore = EPRates.effectiveRate(before);
  const r = await reopen(before, { rate: 95.1, date: "2026-10-15", source: "ЦБ РФ" });
  assert.equal(r.settings.eurRate, 92.5374, "курс ЦБ прежний, свежий 95,1 из кэша не применён");
  assert.equal(r.settings.rateDate, "2026-10-14", "дата курса прежняя (вчерашняя)");
  assert.equal(r.settings.rateSource, "ЦБ РФ", "источник ЦБ РФ сохранён");
  assert.equal(r.settings.rateSurchargePercent, 3, "надбавка 3% сохранена");
  assert.equal(EPRates.effectiveRate(r.settings), rateBefore, "эффективный курс с надбавкой не изменился");
});

test("новый/старый проект БЕЗ своего курса: на старте применяется кэш ЦБ (иначе открылся бы без курса)", async () => {
  /* terms без курса (старый проект, сохранённый до появления курса в terms). resetDefaults даёт
     settings без eurRate — в кэше последний известный ЦБ. Фолбэк документируем тестом. */
  const s = makeSession();
  s.store.value = { terms: { workPercent: 10 } };
  await s.restore();
  assert.ok(!(s.ctx.EP_DATA.settings.eurRate > 0), "предусловие: у проекта своего курса нет");
  s.cache.value = { rate: 90.0, date: "2026-10-10", source: "ЦБ РФ" };
  s.loadCachedRate();
  assert.equal(s.ctx.EP_DATA.settings.eurRate, 90.0, "курса не было — применили кэш ЦБ");
  assert.equal(s.ctx.EP_DATA.settings.rateDate, "2026-10-10", "дата кэша применена");
});

/* ---- Кнопка «Курс ЦБ»: обновляет курс ВСЕГДА, даже если у проекта уже есть курс ---- */
test("refreshRate (кнопка «Курс ЦБ») обновляет курс поверх уже заданного ручного", async () => {
  const dom = stand.makeDom();
  const settings = { eurRate: 92.5, rateDate: "2026-10-14", rateSource: "вручную", rateSurchargePercent: 3 };
  const fresh = { rate: 95.1, date: "2026-10-15", source: "ЦБ РФ" };
  const ctx = {
    $: dom.$, EP_DATA: { settings },
    EPRates: Object.assign({}, EPRates, { fetchFresh: async () => fresh }),
    applyProjectSettings: () => {}, toast: () => {}, rubRate: v => String(v), console
  };
  const refresh = stand.run(["applyRateEntry", "refreshRate"], ctx);
  await refresh();
  assert.equal(settings.eurRate, 95.1, "кнопка поставила свежий курс ЦБ 95,1");
  assert.equal(settings.rateDate, "2026-10-15", "дата курса обновлена");
  assert.equal(settings.rateSource, "ЦБ РФ", "источник стал ЦБ РФ");
});
