/* ПОВЕДЕНЧЕСКИЙ тест ХРАНЕНИЯ памяти полей исчезнувших комнат (В15/В16) на НАСТОЯЩИХ
   projectSnapshot/restoreProject (исходный текст app.js исполняется в vm).

   ЗАЧЕМ. Правило памяти (что помнить/забыть) покрыто в tests/roomCarry.test.js (reconcile) и в
   tests/roomMarkupBehavior.test.js. Но ХРАНЕНИЕ памяти в проекте живёт в тяжёлых оркестраторах app.js
   (projectSnapshot кладёт её в снимок, restoreProject читает обратно), и до сих пор их стерёг только
   ТЕКСТОВЫЙ tests/roomFieldMemoryWiring.test.js. Текстовый матч негоден к смене смысла: мутация
   «restoreProject обнуляет память» — дописать `state.roomFieldMemory=[];` сразу ПОСЛЕ строки чтения —
   проходила ЗЕЛЁНОЙ (проверено лично: 0 красных). Тогда удалить стену, сохраниться и перезагрузиться
   значило бы навсегда потерять поля комнаты, которую ещё собирались вернуть (денежный дефект В15).

   Здесь память проверяется ПОВЕДЕНЧЕСКИ: кладём непустую память в проект → сохранили (snapshot) →
   «перезагрузка» (сброс состояния) → открыли (restore) → память обязана быть ТА ЖЕ. Снимок между
   открытиями прогоняем через JSON, как реальное хранилище (ProjectStore.save/load).

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     restoreProject: дописать `state.roomFieldMemory=[];` после чтения → краснеет round-trip (память пуста);
     projectSnapshot: убрать `roomFieldMemory:state.roomFieldMemory` → краснеет round-trip и §snapshot;
     restoreProject: заменить фолбэк на `state.roomFieldMemory=[]` безусловно → краснеет round-trip.
   Запуск: node --test tests/ */
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

/* Настоящие дефолты data.js, как их видит браузер при загрузке (свежие на каждое «открытие»). */
function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

/* Один «сеанс браузера»: общий контекст для restoreProject и projectSnapshot — делят state и EP_DATA.
   Соседи, не относящиеся к памяти (рендер панелей и т.п.), заглушены. Та же сборка, что в
   tests/vatMigrationChain.test.js: исполняем НАСТОЯЩИЙ текст функций из app.js. */
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
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, markCanvasUsed: () => {}
  };
  const src = stand.functionSource("relabelContourRooms") + "\n" + stand.functionSource("restoreProject")
    + "\n" + stand.functionSource("projectSnapshot") + "\n;({ restore: restoreProject, snapshot: projectSnapshot });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, dom, store, state, restore: api.restore, snapshot: api.snapshot,
    resetDefaults: () => { ctx.EP_DATA.settings = freshDefaults(); } };
}

/* Непустая память: поля «растворившейся» комнаты ждут возвращения на своё место. */
const MEMORY = [{
  polygon: [{ x: 200, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 400 }, { x: 200, y: 400 }],
  fields: { name: "Кухня", area: "15 м²", lightingScheme: "relay", standard: "IT",
    collection: "Neve Up", frameMaterial: null, frameShape: null, frameColor: null }
}];

test("память переживает сохранение и перезагрузку: snapshot → restore → та же память", async () => {
  const s = makeSession();
  // открыли проект с непустой памятью
  s.store.value = { roomFieldMemory: JSON.parse(JSON.stringify(MEMORY)) };
  await s.restore();
  assert.deepEqual(s.state.roomFieldMemory, MEMORY, "после открытия память восстановлена из проекта");
  // сохранили и «перезагрузили страницу»: снимок через JSON, как реальное хранилище
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  assert.deepEqual(snap.roomFieldMemory, MEMORY, "снимок проекта несёт память (projectSnapshot не теряет её)");
  s.resetDefaults();
  s.store.value = snap;
  await s.restore();
  assert.deepEqual(s.state.roomFieldMemory, MEMORY,
    "после перезагрузки память ТА ЖЕ — restoreProject её не обнуляет (мутация `=[]` краснит здесь)");
});

test("старый проект без поля памяти открывается с пустой памятью (обратная совместимость)", async () => {
  const s = makeSession();
  s.store.value = { terms: {} };                 // проект, сохранённый до появления памяти
  await s.restore();
  // Array.isArray/length — кросс-realm-безопасно: массив рождён в vm-контексте restoreProject
  assert.ok(Array.isArray(s.state.roomFieldMemory) && s.state.roomFieldMemory.length === 0,
    "нет поля в проекте → память пустая, без падения");
});

test("битое поле памяти в проекте не роняет открытие — память пустая", async () => {
  const s = makeSession();
  s.store.value = { roomFieldMemory: "не-массив" };
  await s.restore();
  assert.ok(Array.isArray(s.state.roomFieldMemory) && s.state.roomFieldMemory.length === 0,
    "нечисловое/битое поле → фолбэк [] (Array.isArray-проверка)");
});
