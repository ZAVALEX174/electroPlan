/* Хранение галки «рассчитать кратно упаковке» (К6, решение владельца 22.10: «по умолчанию снята,
   хранится в проекте»). Две плоскости:

   A. МОДУЛЬ EPPackMultiple (js/packMultipleUi.js) — живая галка на экране: отражает настройку
      (syncPackMultiple), по клику пишет её обратно и сохраняет проект (scheduleSave).
   B. КРУГОВОРОТ через НАСТОЯЩИЕ projectSnapshot/restoreProject (исходный текст app.js в vm, как
      tests/roomFieldMemoryRoundTrip.test.js): настройка переживает «перезагрузку», а старый проект
      без поля открывается со снятой галкой (false — задним числом не округляем).

   Это влияет на ДЕНЬГИ заказа (включённая галка меняет количества в листе «По артикулам»), поэтому
   мутации (таблица в отчёте):
     · restoreProject: убрать `EP_DATA.settings.packMultiple=!!p.packMultiple` → краснеет «круговорот»;
     · projectSnapshot: убрать `packMultiple:!!EP_DATA.settings.packMultiple` → краснеет «круговорот»;
     · restoreProject: `=!!p.packMultiple` → `=true` безусловно → краснеет «старый проект → false»;
     · модуль: onchange не пишет scheduleSave → краснеет «клик сохраняет»; не пишет setting → краснеет «клик меняет настройку».
   Запуск: node --test tests/packMultipleRoundTrip.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPPackMultiple = require("../js/packMultipleUi.js");

/* ---------- A. Модуль EPPackMultiple ---------- */

/* Шим галки: минимальный узел с .checked и слотом onchange, как у браузерного checkbox. */
function fakeBox() { return { checked: false, onchange: null }; }

test("A: syncPackMultiple отражает настройку проекта в галке", () => {
  const box = fakeBox();
  const EP_DATA = { settings: { packMultiple: true } };
  const { syncPackMultiple } = EPPackMultiple.attach({ $: () => box, EP_DATA, scheduleSave: () => {} });
  assert.equal(box.checked, true, "настройка true → галка стоит (sync при attach)");
  EP_DATA.settings.packMultiple = false;
  syncPackMultiple();
  assert.equal(box.checked, false, "настройка снята → галка снята");
});

test("A: клик по галке меняет настройку и сохраняет проект", () => {
  const box = fakeBox();
  let saved = 0;
  const EP_DATA = { settings: {} };          // поля ещё нет — по умолчанию снята
  EPPackMultiple.attach({ $: () => box, EP_DATA, scheduleSave: () => { saved++; } });
  assert.equal(box.checked, false, "нет поля → галка снята (по умолчанию)");
  box.checked = true; box.onchange();
  assert.equal(EP_DATA.settings.packMultiple, true, "клик записал настройку true");
  assert.equal(saved, 1, "клик пометил проект к сохранению (scheduleSave)");
  box.checked = false; box.onchange();
  assert.equal(EP_DATA.settings.packMultiple, false, "снятие записало false");
  assert.equal(saved, 2, "и снова сохранение");
});

/* ---------- B. Круговорот снимок → файл → восстановление ---------- */

function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

/* Один «сеанс браузера»: общий контекст для restoreProject и projectSnapshot (делят state/EP_DATA).
   syncPackMultiple заглушён — живую галку проверяет плоскость A; здесь важен круговорот настройки. */
function makeSession() {
  const dom = stand.makeDom();
  const state = {};
  const store = { value: null };
  const ctx = {
    $: dom.$, esc: String, state,
    EP_DATA: { settings: freshDefaults() },
    EPEstimate, EPPosts, EPOfferOptions,
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s }, EPPlanRotate: require("../js/planRotate.js"),
    ProjectStore: { load: () => store.value },
    dropOrphanKeyGroups: () => {}, renderLightingSchemeSelect: () => {},
    renderProjectWallTypeSelect: () => {}, renderProjectBacklight: () => {},
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, syncPackMultiple: () => {}, markCanvasUsed: () => {}
  };
  const src = stand.functionSource("relabelContourRooms") + "\n" + stand.functionSource("restoreProject")
    + "\n" + stand.functionSource("projectSnapshot") + "\n;({ restore: restoreProject, snapshot: projectSnapshot });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, store, restore: api.restore, snapshot: api.snapshot,
    resetDefaults: () => { ctx.EP_DATA.settings = freshDefaults(); } };
}

test("B: галка переживает сохранение и перезагрузку: snapshot → restore → та же (включена)", async () => {
  const s = makeSession();
  s.store.value = { terms: {}, packMultiple: true };
  await s.restore();
  assert.equal(s.ctx.EP_DATA.settings.packMultiple, true, "после открытия настройка восстановлена");
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  assert.equal(snap.packMultiple, true, "снимок несёт галку (projectSnapshot её не теряет)");
  s.resetDefaults();
  s.store.value = snap;
  await s.restore();
  assert.equal(s.ctx.EP_DATA.settings.packMultiple, true,
    "после перезагрузки галка ТА ЖЕ — restoreProject её читает (мутация «убрать чтение» краснит здесь)");
});

test("B: снятая галка тоже переживает перезагрузку (snapshot пишет false, не теряет поле)", async () => {
  const s = makeSession();
  s.store.value = { terms: {}, packMultiple: false };
  await s.restore();
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  assert.equal(snap.packMultiple, false, "снятая галка сохранена явным false");
  s.resetDefaults();
  s.store.value = snap;
  await s.restore();
  assert.equal(s.ctx.EP_DATA.settings.packMultiple, false, "осталась снята");
});

test("B: старый проект без поля открывается со снятой галкой (false, не округляем задним числом)", async () => {
  const s = makeSession();
  s.store.value = { terms: {} };                 // проект, сохранённый до появления галки
  await s.restore();
  assert.equal(s.ctx.EP_DATA.settings.packMultiple, false,
    "нет поля → false (мутация «=true безусловно» краснит здесь)");
});
