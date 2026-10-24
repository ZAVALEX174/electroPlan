/* К8а, часть 2: доп.варианты отделки комнаты (room.moreVariants) НЕ теряются при любом действии,
   которое запоминает/сохраняет/восстанавливает состояние плана. Перенос при ПЕРЕСЧЁТЕ КОНТУРОВ и через
   ПАМЯТЬ исчезнувшей комнаты покрыт в tests/roomCarry.test.js и tests/roomCarryCollectionAppWiring.test.js
   (там moreVariants едут вместе с вариантом 1). Здесь — остальные места, где отделка комнаты «проходит
   через копирование»:
     · undo/redo (EPHistory) — снимок плана глубоко клонируется; moreVariants обязан быть в клоне;
     · экспорт→импорт файла (EPProjectFile.build/parse) — обёртка файла прогоняется через JSON;
     · сохранение→загрузка (НАСТОЯЩИЕ projectSnapshot/restoreProject из app.js в vm).

   Во всех трёх moreVariants переживает как ОБЫЧНОЕ поле объекта комнаты (отдельной строки-«переноса»
   на него нет — см. отчёт). Тесты это фиксируют: случайная правка, которая перестанет клонировать
   комнату целиком (белый список полей вместо глубокой копии), покраснит их.

   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPHistory = require("../js/history.js");
const EPProjectFile = require("../js/projectFile.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferOptions = require("../js/offerOptions.js");

/* Прямоугольная комната — как в roomCarry.test.js; полигон нужен relabelContourRooms (restoreProject). */
function room(id, extra) {
  return Object.assign({
    id,
    polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    autoPolygon: true
  }, extra || {});
}

const MORE = [{ standard: "DE", collection: "Plana" }, { frameColor: "Белый" }];

/* ---- undo/redo: доп.варианты переживают откат и возврат (EPHistory) ---- */
test("undo/redo: доп.варианты комнаты откатываются и возвращаются (не теряются в снимке истории)", () => {
  const h = EPHistory.create(50);
  /* базовая точка — комната без доп.вариантов; шаг — добавили набор */
  h.reset({ rooms: [room("r1")] });
  const live = room("r1", { moreVariants: JSON.parse(JSON.stringify(MORE)) });
  assert.equal(h.push({ rooms: [live] }), true, "добавление доп.вариантов — новый шаг (изменение плана)");
  /* правим живую комнату ПОСЛЕ фиксации: снимок обязан держать свою копию, а не ссылку */
  live.moreVariants.push({ collection: "Испортил" });
  const undone = EPHistory.planOf(h.undo());
  assert.ok(!("moreVariants" in undone.rooms[0]) || undone.rooms[0].moreVariants == null,
    "после undo комната без доп.вариантов (вернулись к базовой точке)");
  const redone = EPHistory.planOf(h.redo());
  assert.deepEqual(redone.rooms[0].moreVariants, MORE,
    "после redo доп.варианты ТЕ ЖЕ, что были зафиксированы (правка живой комнаты снимок не испортила)");
});

/* ---- экспорт→импорт файла проекта: доп.варианты сохраняются (EPProjectFile) ---- */
test("экспорт→импорт файла: доп.варианты комнаты сохраняются через JSON-обёртку", () => {
  const snapshot = { rooms: [room("r1", { name: "Кухня", collection: "Arke", moreVariants: MORE })] };
  const wrapper = EPProjectFile.build(snapshot, {}, []);
  const text = JSON.stringify(wrapper);                 // как Blob при «Скачать проект»
  const parsed = EPProjectFile.parse(text);             // как чтение при «Открыть проект»
  assert.equal(parsed.ok, true, "файл разобран");
  assert.deepEqual(parsed.project.rooms[0].moreVariants, MORE, "доп.варианты пережили запись и чтение файла");
});

/* ---- сохранение→загрузка: НАСТОЯЩИЕ projectSnapshot/restoreProject (app.js в vm) ----
   Сборка повторяет tests/roomFieldMemoryRoundTrip.test.js: исполняем исходный текст функций из app.js,
   снимок между «открытиями» прогоняем через JSON, как реальное хранилище ProjectStore. */
function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}
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
    /* relabelContourRooms (В10) пересчитывает только якорь подписи контурной комнаты — moreVariants он
       не трогает; точки заглушаем, нам важна лишь судьба доп.вариантов. */
    roomLabelPoint: () => ({ x: 0, y: 0 }), roomNamePoint: () => ({ x: 0, y: 0 }),
    dropOrphanKeyGroups: () => {}, renderLightingSchemeSelect: () => {},
    renderProjectWallTypeSelect: () => {}, renderProjectBacklight: () => {},
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, syncPackMultiple: () => {}, markCanvasUsed: () => {}
  };
  const src = stand.functionSource("relabelContourRooms") + "\n" + stand.functionSource("restoreProject")
    + "\n" + stand.functionSource("projectSnapshot") + "\n;({ restore: restoreProject, snapshot: projectSnapshot });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, store, state, restore: api.restore, snapshot: api.snapshot,
    resetDefaults: () => { ctx.EP_DATA.settings = freshDefaults(); } };
}

test("сохранение→загрузка: доп.варианты комнаты переживают snapshot → перезагрузку → restore", async () => {
  const s = makeSession();
  s.store.value = { rooms: [room("r1", { name: "Кухня", collection: "Arke", moreVariants: JSON.parse(JSON.stringify(MORE)) })] };
  await s.restore();
  assert.deepEqual(s.state.rooms[0].moreVariants, MORE, "после открытия доп.варианты на месте");
  /* сохранили и «перезагрузили страницу»: снимок через JSON, как реальное хранилище */
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  assert.deepEqual(snap.rooms[0].moreVariants, MORE, "снимок проекта несёт доп.варианты (projectSnapshot не теряет их)");
  s.resetDefaults();
  s.store.value = snap;
  await s.restore();
  assert.deepEqual(s.state.rooms[0].moreVariants, MORE,
    "после перезагрузки доп.варианты ТЕ ЖЕ — restoreProject их не теряет");
});

test("сохранение→загрузка (обратная совместимость): старая комната без moreVariants открывается как раньше", async () => {
  const s = makeSession();
  s.store.value = { rooms: [room("r1", { name: "Кухня" })] };   // проект до К8а — поля нет
  await s.restore();
  assert.ok(!("moreVariants" in s.state.rooms[0]), "поле не появляется из воздуха (одна отделка = один вариант)");
});
