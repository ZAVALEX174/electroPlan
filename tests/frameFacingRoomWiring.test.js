/* ПОВЕДЕНЧЕСКИЙ тест E14: отделка накладки комнаты (материал/форма/цвет) сужает каталог конструктора
   ТЕМ ЖЕ путём, что коллекция (§7.1: builderRoomFilter → collectionFramePool → EPCatalog.productsForRoom),
   и от того же суженного пула считаются селектор модульностей и хинт «показано из скольких».

   Исполняем НАСТОЯЩИЙ текст app.js в vm на НАСТОЯЩЕМ каталоге VIMAR, ОБОГАЩЁННОМ data.js (тот же
   путь и порядок, что index.html: catalog-vimar.js → catalog-vimar-attrs.js → data.js), — отделка
   доезжает до товара ровно так, как в браузере. EPCatalog/EPRoom настоящие.

   ЯКОРИ (замерено продакшн-функциями, числа НЕ хардкодим вслепую):
     A) комната Eikon Evo + материал «Влагозащищенный технополимер»: пул 12 из 237 (коллекция),
        модульности [2,3,4] вместо [2,3,4,6,7,8] — 6/7/8 уходят вместе с материалом;
     B) НЕВОЗМОЖНОЕ сочетание Eikon Tactil + «Металл»: пул 0 — collectionFramePool больше НЕ
        подменяет пусто всем каталогом (1631), а селектор показывает только фактическую ёмкость.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     builderRoomFilter без ключей frameMaterial/… (только collection) → красит §A-filter, §A-pool, §A-hint;
     productsForRoom без предиката frameMaterial                       → красит §A-pool, §A-slots, §A-hint;
     collectionFramePool вернул фолбэк `pool.length?pool:allFrames`    → красит §B-pool (0→1631), §B-slots;
     frameFacingHintText без ветки пустого сочетания (`shown?…:…`)     → красит §B-hint;
     roomFrameFacing(room,prop,vals) → roomFrameFacing(room,prop)      → красит §A-dead (мёртвый материал стал бы фильтром).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");

/* Обогащённый каталог — как в браузере: три файла в том же порядке, что index.html. Отделка
   (frameMaterial/frameShape/frameColor) подмешивается data.js, а не руками — второй копии merge нет. */
const JS_DIR = path.join(__dirname, "..", "js");
const win = {};
const ctx0 = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), "utf8"), ctx0, { filename: f });
}
let PRODUCTS;
test("подготовка: обогащённый каталог получен через DataService (как в браузере)", async () => {
  PRODUCTS = await win.DataService.getProducts();
  assert.ok(PRODUCTS.length > 2000, "каталог загружен");
});

const activeFrames = () => PRODUCTS.filter(p => p.kind === "frame" && p.active);
const optionValues = html => [...html.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);

/* Разведочные предпосылки — числа считаем продакшн-функциями по обогащённому каталогу, чтобы
   перезалив прайса уронил тест осмысленно, а не молча. */
test("предпосылки якорей A/B держатся на текущем каталоге", () => {
  const frames = activeFrames();
  const evoBase = EPCatalog.productsForRoom(frames, { collection: "Eikon Evo" });
  const evoWet = EPCatalog.productsForRoom(frames, { collection: "Eikon Evo", frameMaterial: "Влагозащищенный технополимер" });
  assert.equal(evoBase.length, 237, "Eikon Evo: 237 накладок (база до отделки)");
  assert.equal(evoWet.length, 12, "Eikon Evo + влагозащищённый технополимер: 12 накладок");
  assert.deepEqual(EPCatalog.frameSlotOptions(evoBase), [2, 3, 4, 6, 7, 8], "модульности коллекции");
  assert.deepEqual(EPCatalog.frameSlotOptions(evoWet), [2, 3, 4], "материал убирает 6/7/8");
  assert.equal(EPCatalog.productsForRoom(frames, { collection: "Eikon Tactil", frameMaterial: "Металл" }).length, 0,
    "Eikon Tactil + Металл — сочетания нет (у Eikon Tactil металла не бывает)");
});

/* --- §A/§B-filter: builderRoomFilter собирает отделку комнаты редактируемого поста --- */
const FILTER_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter", "builderRoomFilter"];
function filterFor(room) {
  const state = {
    products: PRODUCTS,
    rooms: [Object.assign({ id: "r1", name: "Комната" }, room)],
    posts: [{ id: "p1", roomId: "r1" }],
    builder: { editingPlacedId: "p1" }
  };
  return stand.run(FILTER_CUT, { state, byKind: k => PRODUCTS.filter(x => x.kind === k && x.active), EPCatalog, EPRoom })();
}

test("§A-filter: критерий несёт коллекцию И отделку комнаты", () => {
  const f = filterFor({ collection: "Eikon Evo", frameMaterial: "Влагозащищенный технополимер" });
  assert.equal(f.collection, "Eikon Evo");
  assert.equal(f.frameMaterial, "Влагозащищенный технополимер");
  assert.equal(f.frameShape, null, "форма не задана → null");
  assert.equal(f.frameColor, null, "цвет не задан → null");
});

test("§A-dead: мёртвый (не из каталога) материал комнаты валидируется в точке вызова → null", () => {
  // «Пластмасса» в каталоге материалов нет: frameFacingList приходит вторым аргументом roomFrameFacing,
  // и мёртвое написание гасится в null — иначе фильтр сузил бы каталог по несуществующему материалу
  const f = filterFor({ frameMaterial: "Пластмасса" });
  assert.equal(f.frameMaterial, null, "мёртвый материал → null (фильтра нет)");
});

/* --- §A-pool / §B-pool: collectionFramePool сужает по отделке и НЕ подменяет пусто каталогом --- */
const POOL_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter", "builderRoomFilter", "collectionFramePool"];
function poolFor(room) {
  const state = {
    products: PRODUCTS,
    rooms: [Object.assign({ id: "r1", name: "Комната" }, room)],
    posts: [{ id: "p1", roomId: "r1" }],
    builder: { editingPlacedId: "p1" }
  };
  const pool = stand.run(POOL_CUT, { state, byKind: k => PRODUCTS.filter(x => x.kind === k && x.active), EPCatalog, EPRoom });
  return pool(activeFrames());
}

test("§A-pool: отделка сужает пул до 12 (материал), а не оставляет 237 коллекции", () => {
  assert.equal(poolFor({ collection: "Eikon Evo", frameMaterial: "Влагозащищенный технополимер" }).length, 12);
});

test("§B-pool: невозможное сочетание → ПУСТОЙ пул (0), а не весь каталог 1631", () => {
  const pool = poolFor({ collection: "Eikon Tactil", frameMaterial: "Металл" });
  assert.equal(pool.length, 0, "фолбэк «пусто→всё» снят: под несуществующее сочетание пул пуст, а не 1631");
});

/* --- §A-slots / §B-slots: селектор модульностей считается от того же суженного пула --- */
const SLOT_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter", "builderRoomFilter", "collectionFramePool", "renderPostSlotCountSelect"];
function slotOptions(room, extra) {
  const state = {
    products: PRODUCTS,
    rooms: [Object.assign({ id: "r1", name: "Комната" }, room)],
    posts: [{ id: "p1", roomId: "r1" }],
    builder: { editingPlacedId: "p1" }
  };
  const dom = stand.makeDom();
  const render = stand.run(SLOT_CUT, {
    state, $: dom.$, byKind: k => PRODUCTS.filter(x => x.kind === k && x.active),
    frameSlotOptions: EPCatalog.frameSlotOptions, EPCatalog, EPRoom
  });
  render(extra);
  return optionValues(dom.$("postSlotCount").innerHTML).map(Number);
}

test("§A-slots: селектор в комнате Eikon Evo + материал = [2,3,4]; 6/7/8 ушли вместе с материалом", () => {
  const opts = slotOptions({ collection: "Eikon Evo", frameMaterial: "Влагозащищенный технополимер" }, 3);
  assert.deepEqual(opts, [2, 3, 4]);
  assert.ok(!opts.includes(8), "«8» у этого материала нет — предлагать её значило бы вернуть дефект пустого matchingFrames");
});

test("§B-slots: невозможное сочетание — селектор показывает только фактическую ёмкость поста (extra)", () => {
  const opts = slotOptions({ collection: "Eikon Tactil", frameMaterial: "Металл" }, 3);
  assert.deepEqual(opts, [3], "пул пуст → в селекторе только ёмкость открытого поста, а не модульности всего каталога");
});

/* --- §A-hint / §B-hint: frameFacingHintText — «показано из скольких» и словами про пустое --- */
const HINT_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter", "builderRoomFilter", "frameFacingLabels", "frameFacingEmptyText", "frameFacingHintText"];
function hintFor(room) {
  const state = {
    products: PRODUCTS,
    rooms: [Object.assign({ id: "r1", name: "Комната" }, room)],
    posts: [{ id: "p1", roomId: "r1" }],
    builder: { editingPlacedId: "p1" }
  };
  const hint = stand.run(HINT_CUT, { state, byKind: k => PRODUCTS.filter(x => x.kind === k && x.active), EPCatalog, EPRoom });
  return hint(activeFrames());
}

test("§A-hint: «Показано 12 из 237 накладок · сузили: материал …»", () => {
  const t = hintFor({ collection: "Eikon Evo", frameMaterial: "Влагозащищенный технополимер" });
  assert.equal(t, "Показано 12 из 237 накладок · сузили: материал «Влагозащищенный технополимер»");
});

test("§B-hint: невозможное сочетание объяснено СЛОВАМИ, а не пустым списком", () => {
  const t = hintFor({ collection: "Eikon Tactil", frameMaterial: "Металл" });
  assert.match(t, /^Под выбранную отделку \(материал «Металл»\) в каталоге накладок нет/);
});

test("§hint-none: отделка не задана → хинт пуст (пустая настройка = не сужаем)", () => {
  assert.equal(hintFor({ collection: "Eikon Evo" }), "", "без признаков отделки хинта нет");
  assert.equal(hintFor({}), "");
});
