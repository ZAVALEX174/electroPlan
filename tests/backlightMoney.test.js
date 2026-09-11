/* ДЕНЕЖНАЯ СВЯЗКА ПОДСВЕТКИ на уровне app.js (блок ПОДСВЕТКА-B).
   Чистую логику (backlightPlan/postCost/findBacklight) держат posts.test / postfit.test — но они
   подают deps сами, поэтому НЕ ловят разрыв в самом приложении: postDeps может подсунуть
   {enabled:false} вместо настройки проекта, выкинуть findBacklight или взять не тот пул — и все
   те тесты останутся зелёными. Здесь исполняем НАСТОЯЩИЙ текст postDeps/findBacklight и
   обработчиков из app.js (стенд helpers/appStand), доказывая ровно связки:
     · при включённой настройке проекта подсветка доходит до ЦЕНЫ поста, при выключенной — нет;
     · пул подбора — аксессуары, а не механизмы;
     · галочка/цвет/напряжение пишут в EP_DATA.settings.backlight и зовут пересчёт;
     · умолчание в data.js — ВЫКЛЮЧЕНО (старые проекты без поля не дорожают задним числом). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPPosts = require("../js/posts.js");
const EPPostFit = require("../js/postfit.js");

/* Механизм принимает подсветку (askBacklight, позиция 3 — обычная клавиша), цена 10.
   Аксессуар-подсветка «Белая / 110-250V» (напряжение читается из семейства кода 00936.250), цена 5. */
const MECH = { id: 1, code: "20001.0", kind: "mechanism", active: true, askBacklight: true, backlightPosition: 3, price: 10 };
const ACC = { id: 9, code: "00936.250.W", kind: "accessory", active: true, askBacklight: true, backlightPosition: 3, backlightColor: "Белая", price: 5 };
const BY_ID = { 1: MECH, 9: ACC };
const POST = { id: "p1", frameId: null, mechanismIds: [1] };

/* Собираем deps ИЗ настоящего postDeps app.js (findBacklight ему нужен по имени — режем вместе).
   byKind — шпион: findBacklight единственный в этом пути зовёт byKind, поэтому poolCalls отражает
   ровно из какого пула он тянул аксессуары (accessory против mechanism — мутация M3).
   Каталожные подборы коробки/суппорта заглушены null: изолируем слагаемое подсветки в цене. */
function costWith(backlight) {
  const poolCalls = [];
  const settings = { wallType: "solid", backlight };
  const ctx = {
    product: id => BY_ID[id] || null,
    frameProduct: () => null,
    socketBox: () => null,
    mechanismSpan: () => 1,
    findBox: () => null,
    fallbackBox: () => null,
    findSupport: () => null,
    resolveSupport: () => ({ support: null, assumed: false }),
    EPPostFit,
    EP_DATA: { settings },
    byKind: kind => { poolCalls.push(kind); return kind === "accessory" ? [ACC] : []; }
  };
  const code = stand.constSource("findBacklight") + "\n" + stand.constBlock("postDeps") + "\n;postDeps;";
  vm.createContext(ctx);
  const postDeps = vm.runInContext(code, ctx);
  return { cost: EPPosts.postCost(POST, postDeps()), poolCalls };
}

test("postDeps: включённая настройка проекта доводит подсветку до цены поста (M1/M2)", () => {
  /* M1 — postDeps подсовывает {enabled:false} вместо EP_DATA.settings.backlight;
     M2 — findBacklight выкинут из postDeps. Обе оставляют цену на голом механизме (10). */
  const { cost } = costWith({ enabled: true, color: "Белая", voltage: "110-250V" });
  assert.equal(cost, 15, "цена = механизм(10) + подобранная подсветка(5)");
});

test("postDeps: выключенная настройка → подсветка в цену НЕ входит", () => {
  const { cost } = costWith({ enabled: false, color: "Белая", voltage: "110-250V" });
  assert.equal(cost, 10, "выключено — только механизм, ни цента подсветки");
});

test("findBacklight: пул подбора — аксессуары, а не механизмы (M3)", () => {
  /* M3 — findBacklight берёт byKind("mechanism") вместо byKind("accessory"): пул уезжает,
     совместимого нет, цена падает до 10. Проверяем И цену, И сам запрошенный пул. */
  const { cost, poolCalls } = costWith({ enabled: true, color: "Белая", voltage: "110-250V" });
  assert.equal(cost, 15, "подсветка найдена именно в пуле аксессуаров");
  assert.ok(poolCalls.includes("accessory"), "findBacklight запросил пул аксессуаров");
  assert.ok(!poolCalls.includes("mechanism"), "механизмы за подсветкой не берутся");
});

/* Обработчики панели проекта (галочка/цвет/напряжение) навешаны на верхнем уровне app.js —
   исполняем блок «ensureBacklightSetting + три onchange» как есть и дёргаем обработчики. */
function bindHandlers(settings) {
  const SRC = stand.SRC;
  const start = SRC.indexOf("function ensureBacklightSetting");
  assert.ok(start >= 0, "ensureBacklightSetting должен существовать в app.js");
  const volt = /\$\("backlightVoltageSelect"\)\.onchange=e=>\{[\s\S]*?\};/.exec(SRC);
  assert.ok(volt, "обработчик #backlightVoltageSelect должен быть в app.js");
  const block = SRC.slice(start, volt.index + volt[0].length);
  const dom = stand.makeDom();
  const applied = { count: 0 };
  const ctx = { $: dom.$, EP_DATA: { settings }, applyProjectSettings: () => { applied.count++; } };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return { dom, applied, settings };
}

test("обработчик галочки: пишет enabled в настройку и зовёт пересчёт (M7)", () => {
  const settings = { backlight: { enabled: false, color: "Белая", voltage: "110-250V" } };
  const { dom, applied } = bindHandlers(settings);
  dom.$("backlightEnabled").onchange({ target: { checked: true } });
  assert.equal(settings.backlight.enabled, true, "галочка включила подсветку в настройке проекта");
  assert.equal(applied.count, 1, "пересчёт вызван — иначе смета не поменяется");
});

test("обработчик цвета: пишет color в настройку и зовёт пересчёт (M11)", () => {
  const settings = { backlight: { enabled: true, color: "Белая", voltage: "110-250V" } };
  const { dom, applied } = bindHandlers(settings);
  dom.$("backlightColorSelect").onchange({ target: { value: "Красная" } });
  assert.equal(settings.backlight.color, "Красная", "выбранный цвет записан в настройку");
  assert.equal(applied.count, 1, "пересчёт вызван");
});

test("обработчик напряжения: пишет voltage в настройку и зовёт пересчёт (аналог M11)", () => {
  const settings = { backlight: { enabled: true, color: "Белая", voltage: "110-250V" } };
  const { dom, applied } = bindHandlers(settings);
  dom.$("backlightVoltageSelect").onchange({ target: { value: "120V" } });
  assert.equal(settings.backlight.voltage, "120V", "выбранное напряжение записано в настройку");
  assert.equal(applied.count, 1, "пересчёт вызван");
});

test("data.js: подсветка проекта по умолчанию ВЫКЛЮЧЕНА (M8 — старые проекты не дорожают)", () => {
  /* Читаем НАСТОЯЩИЙ data.js (как catalogRuntimeEnrichment): именно это умолчание держит правило
     «задним числом ничего не дорожает». M8 — data.js → enabled:true — разом включил бы LED всем
     старым проектам без поля. */
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"),
    { window: win, structuredClone });
  assert.equal(win.EP_DATA.settings.backlight.enabled, false, "по умолчанию подсветка выключена");
});
