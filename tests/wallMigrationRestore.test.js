/* ПОВЕДЕНЧЕСКИЙ тест ПОДКЛЮЧЕНИЯ миграции типа стены (К4б) в НАСТОЯЩЕМ restoreProject
   (исходный текст app.js исполняется в vm).

   ЗАЧЕМ. Чистая функция EPPosts.applyProjectWallToPosts покрыта в tests/posts.test.js, но её
   ВЫЗОВ живёт в оркестраторе restoreProject (app.js). Без этого теста строку вызова можно
   удалить/закомментировать, и весь набор останется зелёным — а старый ГКЛ-проект при открытии
   молча пересчитался бы на новый дефолт «бетон» (денежный дефект): пост без своей стены раньше
   читал стену проекта, теперь — общий дефолт solid.

   Здесь проверяем ПОВЕДЕНЧЕСКИ: кладём в хранилище проект с terms.wallType и постами
   [без своей стены, с явной "solid"] → открываем (restore) → посты должны получить стену
   проекта (без своей) и сохранить свою (явную). Та же сборка стенда, что в
   tests/roomFieldMemoryRoundTrip.test.js / vatMigrationChain.test.js.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте, k4b.json):
     M4: вызов applyProjectWallToPosts в restoreProject удалён → краснеет здесь (пост без стены
         остаётся без wallType вместо "hollow"/"solid").
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

/* Свежие дефолты data.js, как их видит браузер на каждое «открытие» (settings.wallType здесь
   уже нет — К4б; дефолт для поста без своей стены = solid). */
function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

/* Один «сеанс браузера»: исполняем НАСТОЯЩИЙ текст restoreProject из app.js. Соседей, не
   относящихся к типу стены (рендер панелей и т.п.), заглушаем; EPPosts — настоящий (в нём и
   миграция applyProjectWallToPosts, которую проверяем). */
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
    renderProjectBacklight: () => {}, fillDocHeaderInputs: () => {},
    syncOfferOptions: () => {}, syncPackMultiple: () => {}, markCanvasUsed: () => {}
  };
  const src = stand.functionSource("relabelContourRooms") + "\n" + stand.functionSource("restoreProject")
    + "\n;({ restore: restoreProject });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, dom, store, state, restore: api.restore };
}

test("restoreProject проставляет стену проекта (ГКЛ) постам без своей, свою не трогает", async () => {
  const s = makeSession();
  s.store.value = {
    terms: { wallType: "hollow" },
    posts: [
      { id: "a", frameId: 90, mechanismIds: [1] },                    // без своей стены → наследует проект
      { id: "b", frameId: 90, mechanismIds: [1], wallType: "solid" }  // свой выбор — не перезаписываем
    ]
  };
  await s.restore();
  const byId = Object.fromEntries(s.state.posts.map(p => [p.id, p]));
  assert.equal(byId.a.wallType, "hollow", "пост без своей стены получил стену проекта из terms");
  assert.equal(byId.b.wallType, "solid", "пост со своей стеной остался solid (миграция его не трогает)");
});

test("restoreProject: проект без terms.wallType → пост без своей стены получает дефолт «бетон»", async () => {
  const s = makeSession();
  s.store.value = {
    terms: { workPercent: 18 },                       // очень старый проект, поля стены нет
    posts: [{ id: "a", frameId: 90, mechanismIds: [1] }]
  };
  await s.restore();
  assert.equal(s.state.posts[0].wallType, "solid", "нет стены проекта → дефолт solid");
});

test("restoreProject: проект вообще без terms → пост без своей стены получает «бетон»", async () => {
  const s = makeSession();
  s.store.value = { posts: [{ id: "a", frameId: 90, mechanismIds: [1] }] };
  await s.restore();
  assert.equal(s.state.posts[0].wallType, "solid", "нет terms → дефолт solid, без падения");
});
