/* ДЕФЕКТ 23.09 (проверен владельцем в браузере): новый пост, открытый в комнате со стандартом «немецкий»,
   серией Arke и цветом «Антрацит», открывался с накладкой [09673.01] «Накладка на 3 модуля, белая» — Neve
   Up, белая, ИТАЛЬЯНСКИЙ стандарт: накладку по умолчанию брали из НАЧАЛА ВСЕГО каталога (byKind("frame")),
   комнату не спрашивали. Правка: накладка по умолчанию НОВОГО поста берётся ИЗ ПУЛА ЕГО КОМНАТЫ тем же
   EPCatalog.productsForRoom + roomCatalogFilter, что сужает список (§7.1, одна точка правила —
   defaultFrameForRoom); пул пуст → накладки нет вовсе (frameUnset), а не чужая из начала каталога.

   ПОЧЕМУ ПОВЕДЕНЧЕСКИ И НА РЕАЛЬНОМ КАТАЛОГЕ. Стандарт/серия/цвет накладок дописывает в рантайме
   DataService из номенклатуры (js/data.js) — в СЫРОМ catalog-vimar.js этих полей нет. Поэтому грузим
   каталог тем же конвейером и в том же порядке, что index.html (catalog-vimar.js → attrs → data.js), и
   исполняем НАСТОЯЩИЙ текст openPostBuilder/defaultFrameForRoom/roomCatalogFilter в vm на DOM-шиме
   (общий стенд tests/helpers/appStand.js). Годность накладки под комнату проверяем ТЕМ ЖЕ
   productsForRoom (а не сравнением строки standard): накладка-умолчание немецкой комнаты — 09661.01,
   у неё standard="BOTH" (садится и в немецкую коробку) — сравнение ===«DE» её бы отвергло.
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
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

/* Обогащённый каталог: те же три файла и тот же порядок, что index.html. window.EP_DATA.products —
   готовый массив (getProducts лишь клонирует его), берём напрямую, без промиса. */
function loadEnrichedProducts() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;
}
const PRODUCTS = loadEnrichedProducts();
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => String(p.code) === String(code));
const activeFrames = PRODUCTS.filter(p => p.kind === "frame" && p.active);
const sc = EPCatalog.frameSlotCount;

/* «Обычная» накладка — без специального principle (переходные «центрально для коробки», крышки IP):
   ровно тот признак ИЗ ДАННЫХ, что предпочитает pickDefaultFrame (п.4). */
const ordinaryFrame = f => !f.principle;
/* Ближайшая к 3 модулям (равная близость → меньшая модульность) — то же, что nearestToThreeFrame. */
const nearestTo3 = list => {
  const withN = list.filter(f => sc(f) != null);
  if (!withN.length) return list[0] || null;
  return withN.slice().sort((a, b) => Math.abs(sc(a) - 3) - Math.abs(sc(b) - 3) || sc(a) - sc(b))[0];
};
/* defaultFrameForRoom в чистом виде — то, что openPostBuilder обязан дать новому посту: из пула комнаты,
   ОБЫЧНЫЕ накладки предпочтительнее спец-изделий, ближайшая к 3 модулям (п.4). Используем ТОЛЬКО для
   вычисления ОЖИДАЕМОГО значения; сам openPostBuilder исполняется настоящий (ниже), поэтому это не
   тавтология: тест ловит, что настоящий код ходит через ЭТОТ пул и по ЭТОМУ правилу, а не через весь
   каталог и не «первую 3-модульную». */
const expectedDefault = criteria => {
  const pool = EPCatalog.productsForRoom(activeFrames, criteria);
  const ord = pool.filter(ordinaryFrame);
  return nearestTo3(ord.length ? ord : pool);
};

/* ── Разведка каталога (числа НЕ хардкодим — фиксируем как предпосылки, перезалив прайса уронит осмысленно) ── */
const WHOLE_DEFAULT = expectedDefault({});                          // новый пост ВНЕ комнат
const DE = { standard: "DE" };
const DE_DEFAULT = expectedDefault(DE);
const ARKE = { standard: "DE", collection: "Arke", frameColor: "Графит матовый" };  // непустой немецкий пул серии+цвета
const ARKE_DEFAULT = expectedDefault(ARKE);
const EMPTY = { standard: "DE", collection: "Arke", frameColor: "Антрацит" };       // Arke не имеет «Антрацит» ни в каком стандарте

assert.ok(WHOLE_DEFAULT && sc(WHOLE_DEFAULT) === 3, "предпосылка: у всего каталога дефолт нового поста — 3-модульная накладка");
assert.ok(DE_DEFAULT, "предпосылка: под немецкий стандарт накладки в каталоге есть");
assert.equal(EPCatalog.productsForRoom([WHOLE_DEFAULT], DE).length, 0,
  "предпосылка: дефолт всего каталога (09673.01, IT) под немецкий стандарт НЕ годится — на нём и виден дефект");
assert.equal(EPCatalog.productsForRoom([DE_DEFAULT], DE).length, 1,
  "предпосылка: дефолт немецкой комнаты годится под немецкий стандарт (у него standard может быть BOTH)");
assert.notEqual(DE_DEFAULT.id, WHOLE_DEFAULT.id, "предпосылка: дефолт немецкой комнаты ≠ дефолту всего каталога");
assert.ok(ARKE_DEFAULT && (ARKE_DEFAULT.series || []).includes("Arke") && ARKE_DEFAULT.frameColor === "Графит матовый",
  "предпосылка: под немецкую комнату серии Arke цвета «Графит матовый» есть накладка этой серии и цвета");
assert.equal(EPCatalog.productsForRoom(activeFrames, EMPTY).length, 0,
  "предпосылка: под немецкую комнату серии Arke цвета «Антрацит» накладок в каталоге НЕТ (пустой пул — сценарий дефекта)");
/* Цвет «Антрацит» РЕАЛЬНЫЙ (валидируется в свойствах комнаты), поэтому roomFrameFacing его не обнулит —
   пул честно пуст из-за сочетания серия+цвет, а не из-за мусора. */
assert.ok(EPCatalog.productFacingValues(activeFrames, "frameColor").includes("Антрацит"),
  "предпосылка: «Антрацит» — валидный цвет накладок каталога (иначе пустоту дал бы не отбор, а отсев мусора)");

/* ── Стенд openPostBuilder (renderBuilder заглушён — предмет здесь ВЫБОР накладки по умолчанию, не отрисовка) ── */
const CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
  "builderRoomFilter", "collectionFramePool", "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame",
  "preferOwnFrame", "ownFrameCriteria", "defaultFrameForRoom", "applyAutoDefaultFrame",
  "renderPostSlotCountSelect", "renderBuilderRoomSelect", "openPostBuilder"];
const NAMED_CUT = ["builderSignature", ...CUT];

function openPost({ rooms = [], open = {}, placedFrameId, templates = [] }) {
  const posts = [];
  if (open.placedId) posts.push({ id: open.placedId, roomId: rooms[0] ? rooms[0].id : null, frameId: placedFrameId, mechanismIds: [] });
  const state = {
    products: PRODUCTS, posts, templates,
    rooms, builder: {}, pending: null
  };
  const dom = stand.makeDom({ selects: ["postSlotCount", "postFrameSelect", "builderRoomSelect"] });
  const ctx = {
    state, $: dom.$,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product,
    frameSlotOptions: EPCatalog.frameSlotOptions,
    EPCatalog, EPRoom, EPPosts, EPBuilderSlots,
    esc: s => String(s == null ? "" : s),
    canvas: stand.makeElement({ classes: ["placing"] }), updateStatus: () => {},
    mechanismModulesTotal: () => 0, keySlotKind: () => false,
    EP_DATA: { settings: { wallType: "solid" } },
    renderLightingSchemeSelect: () => {}, renderBuilder: () => {},
    defaultPostName: EPCatalog.defaultPostName, setTimeout: () => {}
  };
  stand.runNamed(NAMED_CUT, ctx)(open);
  return { state, dom };
}
const chosenFrame = dom => dom.$("postFrameSelect").dataset.preferredFrameId;

/* ── 1. Накладка по умолчанию НОВОГО поста — из пула его комнаты ─────────────────────────────────── */

test("★ немецкая комната: дефолтная накладка нового поста ГОДНА немецкому стандарту (не белая Neve Up из начала каталога)", () => {
  const { dom } = openPost({ rooms: [{ id: "r1", name: "Немецкая", standard: "DE" }], open: {} });
  const chosen = chosenFrame(dom);
  assert.equal(chosen, String(DE_DEFAULT.id), "накладка взята из пула немецкой комнаты (defaultFrameForRoom), а не из начала каталога");
  assert.equal(EPCatalog.productsForRoom([product(chosen)], DE).length, 1,
    "проверка ЧЕРЕЗ productsForRoom: накладка годна немецкому стандарту (мутация «byKind('frame') вместо productsForRoom» дала бы 09673.01 IT — не годна)");
  assert.notEqual(chosen, String(WHOLE_DEFAULT.id), "это НЕ дефолт всего каталога — комната учтена");
});

test("★ немецкая комната серии Arke цвета «Графит матовый»: дефолт — накладка ЭТОЙ серии и цвета", () => {
  const { dom } = openPost({ rooms: [{ id: "r1", name: "Гостиная", standard: "DE", collection: "Arke", frameColor: "Графит матовый" }], open: {} });
  const chosen = chosenFrame(dom);
  assert.equal(EPCatalog.productsForRoom([product(chosen)], ARKE).length, 1,
    "накладка по умолчанию проходит productsForRoom комнаты — её серии (Arke), цвета (Графит матовый) и стандарта");
  assert.equal(chosen, String(ARKE_DEFAULT.id), "именно накладка из пула этой серии/цвета, а не первая под стандарт");
  assert.notEqual(chosen, String(WHOLE_DEFAULT.id), "и не дефолт всего каталога");
});

test("★ немецкая комната Arke/«Антрацит» (пула нет): накладки НЕТ вовсе — чужая НЕ подставлена", () => {
  /* Сценарий дефекта в чистом виде: сочетания стандарт+серия+цвет в каталоге не существует. Раньше сюда
     подставилась бы белая Neve Up из начала каталога; теперь frameId пуст — пост откроется в состоянии
     frameUnset (renderBuilder объяснит словами, см. интеграционный тест ниже и постановку). */
  const { dom, state } = openPost({ rooms: [{ id: "r1", name: "Спальня", standard: "DE", collection: "Arke", frameColor: "Антрацит" }], open: {} });
  assert.equal(chosenFrame(dom), "", "накладка по умолчанию пуста: чужую (из начала каталога) НЕ подставляем");
  assert.equal(state.posts.length, 0, "предпосылка: это новый пост, не пост на плане");
  assert.equal(product(chosenFrame(dom)), undefined, "пустая накладка не разрешается в товар — пост открыт без накладки");
});

test("комнат в проекте нет: дефолт нового поста прежний — первая 3-модульная всего каталога", () => {
  const { dom } = openPost({ rooms: [], open: {} });
  assert.equal(chosenFrame(dom), String(WHOLE_DEFAULT.id),
    "без комнат roomCatalogFilter(null) даёт пустой критерий → пул = весь каталог → поведение как раньше (мутация «пустой пул → null всегда» сломала бы этот путь)");
});

test("frameAuto: у НОВОГО поста накладка помечена автоматической, у поста на плане — нет", () => {
  const room = { id: "r1", name: "Немецкая", standard: "DE" };
  const fresh = openPost({ rooms: [room], open: {} });
  assert.equal(fresh.state.builder.frameAuto, true, "новый пост: накладка автоматическая — смена комнаты/модулей вправе её пере-подобрать");
  const placed = openPost({ rooms: [room], open: { placedId: "p1" }, placedFrameId: WHOLE_DEFAULT.id });
  assert.equal(placed.state.builder.frameAuto, false, "пост на плане: накладка своя (frameAuto=false) — applyAutoDefaultFrame её не тронет");
});

/* ── 2. Интеграция: пустой пул комнаты → renderBuilder блокирует «Сохранить» и объясняет причину ──────
   Проверяем ОБЕЩАННОЕ владельцу: «а если такой в каталоге нет, честно говорит чего не хватает». Гоняем
   НАСТОЯЩИЙ renderBuilder с РЕАЛЬНЫМ сужением под комнату (collectionFramePool/builderRoomFilter — не
   заглушки), подав накладку = "" (как её оставил openPostBuilder для пустого пула). UI-соседи, не
   влияющие на блокировку, — заглушки. */
const RB_CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
  "builderRoomFilter", "collectionFramePool", "frameFacingLabels", "frameFacingSelectionLabels", "frameFacingEmptyText", "frameFacingHintText",
  "builderCapacity", "renderBuilder"];

test("★ ИНТЕГРАЦИЯ: пустой пул комнаты — «Сохранить» заблокировано; поле, плашка и подсказка честно называют, чего не хватает (п.5)", () => {
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  const state = { products: PRODUCTS,
    rooms: [{ id: "r1", name: "Спальня", standard: "DE", collection: "Arke", frameColor: "Антрацит" }],
    posts: [], builder: { slots: [], target: { mode: "add" }, roomId: "r1", editingPlacedId: null, frameAuto: true } };
  dom.$("postFrameSelect").dataset.preferredFrameId = "";   // как оставил openPostBuilder при пустом пуле
  dom.$("postSlotCount").value = "3";
  const ctx = {
    state, $: dom.$, esc: s => String(s == null ? "" : s),
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameProduct: product, product, EPCatalog, EPRoom, EPPosts, EPBuilderSlots,
    frameSlotCount: EPCatalog.frameSlotCount, frameSlotOptions: EPCatalog.frameSlotOptions,
    compatibleMechanisms: EPCatalog.compatibleMechanisms, mechanismSpan: EPCatalog.mechanismSpan,
    productSeries: EPCatalog.productSeries, moduleWord: EPCatalog.moduleWord,
    frameOptions: (items, selId) => (items || []).map(i => `<option value="${i.id}" ${Number(i.id) === Number(selId) ? "selected" : ""}>${i.id}</option>`).join(""),
    enhancePicker: () => {}, resolveMissingFrame: () => null,
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    moduleLayout: () => [], lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    renderBuilderSlots: () => {}, renderBuilderCatalog: () => {},
    renderBuilderComposition: (frame, errorHtml) => { dom.$("builderComposition").innerHTML = frame ? "<comp>" : (errorHtml || ""); },
    builderInnardsFilter: () => ({}), frameFacingList: () => EPCatalog.productFacingValues(activeFrames, "frameColor"),
    builderCtx: {}
  };
  stand.run(RB_CUT, ctx)();
  assert.ok(dom.els.savePost.disabled, "без накладки «Сохранить» заблокировано — пост без накладки сохранить нельзя (требование п.2)");
  assert.ok(dom.els.builderInstallSheet.disabled, "лист монтажника тоже заблокирован");
  assert.equal(dom.els.postFrameSelect.value, "", "поле накладки пусто — чужая (frames[0]) молча НЕ подставлена");
  /* ПОЛЕ: не лживое «Рамки не загружены» (каталог на месте!), а «под эту комнату накладок нет» + куда идти. */
  assert.match(dom.els.postFrameSelect.innerHTML, /Под эту комнату накладок нет/, "поле: под эту комнату накладок нет");
  assert.match(dom.els.postFrameSelect.innerHTML, /свойствах комнаты/, "поле направляет в свойства комнаты");
  assert.doesNotMatch(dom.els.postFrameSelect.innerHTML, /Рамки не загружены/, "не лживое «Рамки не загружены» — каталог загружен");
  /* ПЛАШКА: не «выберите накладку в поле» (выбирать не из чего), а «под эту комнату накладок нет» + ВСЕ условия. */
  assert.match(dom.els.builderComposition.innerHTML, /Под эту комнату накладок нет/, "плашка: под эту комнату накладок нет");
  assert.doesNotMatch(dom.els.builderComposition.innerHTML, /выберите накладку в поле/i, "плашка НЕ велит выбирать накладку — её нет");
  assert.match(dom.els.builderComposition.innerHTML, /серия «Arke»/, "плашка называет серию, которой сузили");
  assert.match(dom.els.builderComposition.innerHTML, /цвет «Антрацит»/, "плашка называет цвет");
  assert.match(dom.els.builderComposition.innerHTML, /стандарт «немецкий»/, "плашка называет стандарт — а не только цвет");
  /* ПОДСКАЗКА (#builderFrameFacingHint): называет ВСЁ, чем сузили, включая стандарт и серию (п.5). */
  const hint = dom.$("builderFrameFacingHint").textContent;
  assert.match(hint, /серия «Arke»/, "подсказка называет серию");
  assert.match(hint, /цвет «Антрацит»/, "подсказка называет цвет");
  assert.match(hint, /стандарт «немецкий»/, "подсказка называет стандарт (а не только материал/форму/цвет)");
});

/* ── 3. applyAutoDefaultFrame — единая точка правила, уважает ручной выбор ───────────────────────────
   Прямой прогон функции: под немецкую комнату ставит её накладку по умолчанию, но ТОЛЬКО пока накладка
   автоматическая. Ручной выбор человека (frameAuto=false) не перетирает. */
function runApply(builderover) {
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  const state = { products: PRODUCTS, posts: [], rooms: [{ id: "r1", name: "Немецкая", standard: "DE" }],
    builder: Object.assign({ roomId: "r1", editingPlacedId: null }, builderover) };
  const ctx = {
    state, $: dom.$,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount, EPCatalog, EPRoom, esc: s => String(s == null ? "" : s)
  };
  const apply = stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom",
    "roomCatalogFilter", "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame", "preferOwnFrame",
    "ownFrameCriteria", "defaultFrameForRoom", "applyAutoDefaultFrame"], ctx);
  const returned = apply();
  return { dom, returned };
}

test("applyAutoDefaultFrame: автоматическая накладка → ставит дефолт немецкой комнаты (dataset)", () => {
  const { dom, returned } = runApply({ frameAuto: true });
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(DE_DEFAULT.id),
    "под немецкую комнату проставлена её накладка по умолчанию");
  assert.equal(returned.id, DE_DEFAULT.id, "функция вернула накладку для пересчёта ёмкости");
});

test("applyAutoDefaultFrame: ручной выбор человека (frameAuto=false) НЕ перетирается", () => {
  const { dom, returned } = runApply({ frameAuto: false });
  assert.ok(!("preferredFrameId" in dom.$("postFrameSelect").dataset),
    "накладку не трогаем — человек выбрал её руками (требование п.3: годный ручной выбор не перетирать)");
  assert.equal(returned, null, "функция сообщает «ничего не делала» (null)");
});

/* ── 4. Смена числа модулей у нового поста тоже спрашивает комнату (тот же §7.1-край) ────────────────
   Новый пост немецкой комнаты. Человек меняет число модулей на 2 → накладка обязана стать 2-модульной
   ОБЫЧНОЙ ИЗ ПУЛА КОМНАТЫ, а не остаться прежней приклеенной сверху. Ручной выбор не трогаем. Гоняем
   НАСТОЯЩИЙ changePostSlotCount (renderBuilder заглушён — предмет тут пере-подбор). currentFrameId —
   накладка, стоящая в поле сейчас (её changePostSlotCount берёт образцом для сохранения серии/цвета). */
function runChangeSlot({ frameAuto, count, name = "Пост на 1 модуль", currentFrameId = "" }) {
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  dom.$("postName").value = name;
  dom.$("postSlotCount").innerHTML = `<option value="${count}">${count}</option>`;
  dom.$("postSlotCount").value = String(count);
  if (currentFrameId) { dom.$("postFrameSelect").innerHTML = `<option value="${currentFrameId}">f</option>`; dom.$("postFrameSelect").value = String(currentFrameId); }
  const state = { products: PRODUCTS, posts: [], rooms: [{ id: "r1", name: "Немецкая", standard: "DE" }],
    builder: { roomId: "r1", editingPlacedId: null, frameAuto } };
  const ctx = {
    state, $: dom.$,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product, productSeries: p => (p && p.series) || [],
    EPCatalog, EPRoom, esc: s => String(s == null ? "" : s),
    defaultPostName: EPCatalog.defaultPostName, renderBuilder: () => {}
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
    "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame", "preferOwnFrame", "ownFrameCriteria",
    "defaultFrameForRoom", "applyAutoDefaultFrame", "isAutoPostName", "syncAutoPostName", "changePostSlotCount"], ctx)();
  return dom;
}

test("★ смена числа модулей у нового поста: накладка пере-подбирается под новый count ОБЫЧНОЙ из пула комнаты", () => {
  const dePool = EPCatalog.productsForRoom(activeFrames, DE);
  const de2 = dePool.filter(ordinaryFrame).find(f => sc(f) === 2) || dePool.find(f => sc(f) === 2);
  assert.ok(de2, "предпосылка: под немецкий стандарт есть 2-модульная накладка");
  const dom = runChangeSlot({ frameAuto: true, count: 2 });
  const chosen = dom.$("postFrameSelect").dataset.preferredFrameId;
  assert.equal(chosen, String(de2.id),
    "под «2 модуля» взята 2-модульная ОБЫЧНАЯ накладка немецкой комнаты (мутация «убрать applyAutoDefaultFrame из changePostSlotCount» оставила бы поле пустым)");
  assert.equal(sc(product(chosen)), 2, "модульность выбранной накладки совпала с числом модулей");
});

/* ★ ПУНКТ 3: смена числа модулей сохраняет серию/цвет/стандарт текущей накладки. Текущая — 09673.01
   (Neve Up, белая, ИТАЛЬЯНСКИЙ). 3→4 обязана дать 09674.01 (Neve Up белая IT), а НЕ 09664.01 (Neve Up
   белая НЕМЕЦКАЯ, 2+2), которая идёт в пуле раньше. Комната здесь общая (без сужения), стандарт держит
   ТОЛЬКО образец. */
test("★ смена числа модулей сохраняет серию/цвет/стандарт текущей накладки (3→4 Neve Up белая IT → 09674.01, не 09664.01)", () => {
  const cur = byCode("09673.01"), it4 = byCode("09674.01"), de4 = byCode("09664.01");
  assert.ok(cur && it4 && de4, "предпосылка: 09673.01/09674.01/09664.01 есть в каталоге");
  assert.equal(cur.standard, "IT"); assert.equal(it4.standard, "IT"); assert.equal(de4.standard, "DE");
  /* Комнату не сужаем (rooms без стандарта/серии) — предпочтение держит образец, не комната. */
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  dom.$("postName").value = "Пост на 3 модуля";
  dom.$("postSlotCount").innerHTML = `<option value="4">4</option>`; dom.$("postSlotCount").value = "4";
  dom.$("postFrameSelect").innerHTML = `<option value="${cur.id}">f</option>`; dom.$("postFrameSelect").value = String(cur.id);
  const state = { products: PRODUCTS, posts: [], rooms: [], builder: { roomId: null, editingPlacedId: null, frameAuto: true } };
  const ctx = {
    state, $: dom.$, byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product, productSeries: p => (p && p.series) || [],
    EPCatalog, EPRoom, esc: s => String(s == null ? "" : s), defaultPostName: EPCatalog.defaultPostName, renderBuilder: () => {}
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
    "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame", "preferOwnFrame", "ownFrameCriteria",
    "defaultFrameForRoom", "applyAutoDefaultFrame", "isAutoPostName", "syncAutoPostName", "changePostSlotCount"], ctx)();
  const chosen = dom.$("postFrameSelect").dataset.preferredFrameId;
  assert.equal(chosen, String(it4.id), "4-модульная ТОГО ЖЕ стандарта/серии/цвета (09674.01 IT), а не 09664.01 DE");
  assert.notEqual(chosen, String(de4.id), "немецкая 2+2 (09664.01), идущая в пуле раньше, НЕ выбрана — образец сохранил стандарт");
});

test("смена числа модулей: ручной выбор (frameAuto=false) НЕ пере-подбирается", () => {
  const dom = runChangeSlot({ frameAuto: false, count: 2 });
  assert.ok(!("preferredFrameId" in dom.$("postFrameSelect").dataset),
    "ручную накладку смена числа модулей не трогает");
});

test("★ смена числа модулей у нетронутого поста синхронизирует ИМЯ по числу модулей (автоимя, п.1)", () => {
  const dom = runChangeSlot({ frameAuto: true, count: 2, name: "Пост на 1 модуль" });
  assert.equal(dom.$("postName").value, "Пост на 2 модуля", "автоимя «Пост на N модуля» следует за числом модулей");
});

test("смена числа модулей: РУЧНОЕ имя не трогаем", () => {
  const dom = runChangeSlot({ frameAuto: true, count: 2, name: "Кухня — свет" });
  assert.equal(dom.$("postName").value, "Кухня — свет", "имя, которое человек задал сам, смена числа модулей не переписывает");
});

/* ── 5. ПУНКТ 1: имя и селектор модульностей — по накладке/пулу комнаты ────────────────────────────── */

test("★ п.1: немецкая комната — имя по модульности накладки (не «3 модуля»), селектор — из пула комнаты (без 3/7/14/21)", () => {
  const { dom } = openPost({ rooms: [{ id: "r1", name: "Немецкая", standard: "DE" }], open: {} });
  const chosen = product(chosenFrame(dom));
  assert.ok(chosen, "накладка по умолчанию выбрана");
  assert.equal(dom.$("postName").value, EPCatalog.defaultPostName(sc(chosen)),
    "имя нового поста — по модульности выбранной накладки (п.1), а не жёстко «3 модуля»");
  assert.notEqual(dom.$("postName").value, "Пост на 3 модуля",
    "в немецкой комнате дефолт не 3-модульный → имя не «на 3 модуля» (мутация «имя всегда (3)» краснит здесь)");
  const opts = [...dom.$("postSlotCount").innerHTML.matchAll(/<option value="(\d+)"/g)].map(m => Number(m[1]));
  const dePoolCounts = [...new Set(EPCatalog.productsForRoom(activeFrames, DE).map(sc).filter(n => n != null))];
  assert.ok(opts.includes(sc(chosen)), "селектор содержит модульность выбранной накладки");
  [3, 7, 14, 21].filter(n => !dePoolCounts.includes(n)).forEach(n =>
    assert.ok(!opts.includes(n), `селектор НЕ предлагает ${n}: этой модульности нет в пуле немецкой комнаты (renderPostSlotCountSelect до roomId — краснит здесь)`));
});

/* ── 6. ПУНКТ 2: смена комнаты у нетронутого поста = открытие сразу в этой комнате ─────────────────── */

test("★ п.2: смена комнаты у нетронутого поста даёт дефолт этой комнаты, НЕ зависящий от прошлого числа модулей", () => {
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  /* «Прошлое» число модулей — 1: в немецком пуле 1-модульная накладка ЕСТЬ (09661.01), поэтому если бы
     обработчик передавал текущий count предпочтением, вышла бы 09661.01, а не свежий дефолт (09662.01). */
  dom.$("postSlotCount").innerHTML = `<option value="1">1</option>`; dom.$("postSlotCount").value = "1";
  dom.$("postName").value = "Пост на 1 модуль";
  const state = { products: PRODUCTS, posts: [], rooms: [{ id: "r1", name: "Немецкая", standard: "DE" }],
    builder: { roomId: null, editingPlacedId: null, frameAuto: true } };
  const ctx = {
    state, $: dom.$, byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product, productSeries: p => (p && p.series) || [],
    frameSlotOptions: EPCatalog.frameSlotOptions, EPCatalog, EPRoom, esc: s => String(s == null ? "" : s),
    defaultPostName: EPCatalog.defaultPostName, renderBuilder: () => {}, builderCapacity: () => 1
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
    "builderRoomFilter", "collectionFramePool", "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame",
    "preferOwnFrame", "ownFrameCriteria", "defaultFrameForRoom", "applyAutoDefaultFrame", "renderPostSlotCountSelect",
    "isAutoPostName", "syncAutoPostName", "changeBuilderRoom"], ctx)("r1");
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(DE_DEFAULT.id),
    "смена комнаты дала дефолт немецкой комнаты (ближайшая к 3), НЕ 09661.01 от прошлого числа модулей 1 (мутация «передавать count в обработчике» краснит здесь)");
  assert.equal(dom.$("postName").value, EPCatalog.defaultPostName(sc(DE_DEFAULT)),
    "имя синхронизировано по модульности накладки новой комнаты (п.1)");
});

/* ── 7. ПУНКТ 4: дефолт нового поста — ОБЫЧНАЯ накладка, а не спец-изделие ──────────────────────────── */

test("★ п.4: дефолт — обычная накладка (principle пуст), а не крышка IP / «центрально для коробки»", () => {
  const def = room => product(chosenFrame(openPost({ rooms: [Object.assign({ id: "r1", name: "К" }, room)], open: {} }).dom));
  const arke = def({ collection: "Arke" });
  assert.ok(arke && !arke.principle, "«только Arke»: дефолт — обычная накладка (не крышка IP 14943 с principle)");
  const de = def({ standard: "DE" });
  assert.ok(de && !de.principle, "«только немецкий»: дефолт — обычная накладка (не «центрально для коробки» 09661.01)");
  const both = def({ standard: "DE", collection: "Arke" });
  assert.ok(both && !both.principle, "«немецкий+Arke»: дефолт — обычная накладка (не крышка IP 14931)");
  const et = def({ collection: "Eikon Tactil" });
  assert.ok(et && !et.principle && sc(et) === 3, "«Eikon Tactil»: обычная 3-модульная");
});

/* ── 8. «Нетронутость»: первое действие человека снимает frameAuto навсегда для этого открытия ─────── */

test("★ нетронутость: добавление механизма в рамку (pickBuilderProduct) снимает frameAuto", () => {
  const mech = PRODUCTS.find(p => p.kind === "mechanism" && p.active);
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  const state = { products: PRODUCTS, posts: [], rooms: [],
    builder: { slots: [], target: { mode: "add" }, frameAuto: true } };
  const ctx = {
    state, $: dom.$, EPBuilderSlots, EPPosts, product,
    builderCapacity: () => 3, keySlotKind: () => false, mechanismSpan: EPCatalog.mechanismSpan,
    renderBuilder: () => {}
  };
  stand.run(["pickBuilderProduct"], ctx)(mech.id);
  assert.equal(state.builder.frameAuto, false,
    "человек наполнил рамку → накладка больше не автоматическая (смена комнаты/модулей её не пере-подберёт и не срежет добавленное)");
});

test("★ нетронутость: «Переключить на N модулей» в пустом поиске (resolveMissingFrame.onAction) оставляет накладку ЧЕЛОВЕКА, снимая frameAuto", () => {
  /* Дефект из постановки: человек выбрал 19642.01 (Arke, 2М) кнопкой «Переключить», а applyAutoDefaultFrame
     внутри changePostSlotCount перетирал её авто-умолчанием (09662.01), хотя тост называл 19642.01. */
  const item = byCode("19642.01");
  assert.ok(item && sc(item) === 2, "предпосылка: 19642.01 — 2-модульная накладка");
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  dom.$("postName").value = "Пост на 3 модуля";
  const frameSelect = dom.$("postFrameSelect");
  const toasts = [];
  const state = { products: PRODUCTS, posts: [], rooms: [{ id: "r1", name: "Немецкая", standard: "DE" }],
    builder: { roomId: "r1", editingPlacedId: null, frameAuto: true } };
  const ctx = {
    state, $: dom.$, byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    productSeries: p => (p && p.series) || [], frameSlotCount: EPCatalog.frameSlotCount,
    frameProduct: product, moduleWord: EPCatalog.moduleWord, defaultPostName: EPCatalog.defaultPostName,
    esc: s => String(s == null ? "" : s), toast: m => toasts.push(m), renderBuilder: () => {}
  };
  /* currentCount=3, а 19642.01 — 2М → resolveMissingFrame даёт onAction «Переключить на 2 модуля».
     resolveMissingFrame — ПОСЛЕДНЯЯ в списке (stand.run возвращает её); остальные (в т.ч. настоящий
     changePostSlotCount, что зовёт onAction) объявлены рядом и делят лексику. */
  const resolve = stand.run(["findByExactCode", "isAutoPostName", "syncAutoPostName",
    "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame", "preferOwnFrame", "ownFrameCriteria",
    "builderFilterRoom", "roomCatalogFilter", "frameCollectionList", "frameFacingList", "frameStandardList",
    "defaultFrameForRoom", "applyAutoDefaultFrame", "changePostSlotCount", "resolveMissingFrame"], ctx);
  const res = resolve("19642.01", 3, frameSelect, null);
  assert.ok(res && typeof res.onAction === "function", "по 2-модульному артикулу при выбранных 3 есть действие «Переключить»");
  res.onAction();
  assert.equal(state.builder.frameAuto, false, "выбор накладки человеком снял frameAuto");
  assert.equal(frameSelect.dataset.preferredFrameId, String(item.id),
    "в поле осталась выбранная ЧЕЛОВЕКОМ накладка 19642.01, а не авто-умолчание комнаты (мутация «не снимать frameAuto» перетёрла бы её)");
  assert.ok(toasts.some(m => m.includes("19642.01")), "тост называет ту же накладку, что стоит в поле");
});

/* Прогнать НАСТОЯЩИЙ changeBuilderRoom (смена «Комнаты поста») на общих state/dom. */
function runChangeRoom(state, dom, roomId) {
  const ctx = {
    state, $: dom.$, byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount, frameProduct: product, productSeries: p => (p && p.series) || [],
    frameSlotOptions: EPCatalog.frameSlotOptions, EPCatalog, EPRoom, esc: s => String(s == null ? "" : s),
    defaultPostName: EPCatalog.defaultPostName, renderBuilder: () => {}, builderCapacity: () => Number(dom.$("postSlotCount").value) || 1
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter",
    "builderRoomFilter", "collectionFramePool", "ordinaryFrame", "nearestToThreeFrame", "pickDefaultFrame",
    "preferOwnFrame", "ownFrameCriteria", "defaultFrameForRoom", "applyAutoDefaultFrame", "renderPostSlotCountSelect",
    "isAutoPostName", "syncAutoPostName", "changeBuilderRoom"], ctx)(roomId);
}

/* ── 9. X1: ручной выбор накладки в ПОЛЕ (настоящий onchange) снимает frameAuto ─────────────────────
   Исполняем НАСТОЯЩИЙ обработчик $("postFrameSelect").onchange из app.js (вырезаем его текст из
   stand.SRC и запускаем в vm — не копия правила), затем НАСТОЯЩИЙ changeBuilderRoom: выбранную человеком
   накладку смена комнаты не перетирает. Мутация «onchange без frameAuto=false» краснит здесь. */
test("★ X1: настоящий onchange поля накладки снимает frameAuto; смена комнаты не перетирает накладку человека", () => {
  const m = stand.SRC.match(/\$\("postFrameSelect"\)\.onchange=(\(\)=>\{[^}]*\})/);
  assert.ok(m, "нашли обработчик onchange поля накладки в app.js");
  const chosen = byCode("19642.01");   // человек выбрал Arke 2М в поле
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount", "builderRoomSelect"] });
  dom.$("postFrameSelect").innerHTML = `<option value="${chosen.id}">f</option>`;
  dom.$("postFrameSelect").value = String(chosen.id);
  dom.$("postSlotCount").innerHTML = `<option value="2">2</option>`; dom.$("postSlotCount").value = "2";
  dom.$("postName").value = "Пост на 2 модуля";
  const state = { products: PRODUCTS, posts: [],
    rooms: [{ id: "r1", name: "Немецкая", standard: "DE" }],
    builder: { roomId: null, editingPlacedId: null, frameAuto: true } };
  /* 1) НАСТОЯЩИЙ обработчик поля (state/renderBuilder из его лексики — как в app.js). */
  vm.runInNewContext("(" + m[1] + ")()", { state, renderBuilder: () => {} });
  assert.equal(state.builder.frameAuto, false,
    "ручной выбор накладки в поле снял frameAuto (X1: мутация «onchange без frameAuto=false» краснит здесь)");
  /* 2) НАСТОЯЩАЯ смена комнаты — накладку человека НЕ трогаем. */
  runChangeRoom(state, dom, "r1");
  assert.ok(!("preferredFrameId" in dom.$("postFrameSelect").dataset),
    "смена комнаты НЕ навязала авто-накладку — applyAutoDefaultFrame no-op после ручного выбора");
  assert.equal(dom.$("postFrameSelect").value, String(chosen.id), "в поле осталась накладка, выбранная человеком");
});

/* ── 10. X2: шаблон на редактировании НЕ получает автоподбор (frameAuto=false) ──────────────────────
   Настоящий openPostBuilder с templateId: у шаблона накладка СВОЯ (frameAuto=false), поэтому смена
   комнаты её не пере-подбирает. Мутация `frameAuto=!placedId` (без `&&!templateId`) дала бы шаблону
   frameAuto=true и краснит здесь. */
test("★ X2: шаблон, открытый на редактирование, — накладка своя (frameAuto=false); смена комнаты её не трогает", () => {
  const tplFrame = byCode("09673.01");   // Neve Up, белая, ИТАЛЬЯНСКАЯ 3М
  const { state, dom } = openPost({
    rooms: [{ id: "r1", name: "Немецкая", standard: "DE" }, { id: "r2", name: "Кухня", standard: "DE", collection: "Arke" }],
    templates: [{ id: "t1", frameId: tplFrame.id, mechanismIds: [] }],
    open: { templateId: "t1" }
  });
  assert.equal(state.builder.frameAuto, false,
    "шаблон открыт со СВОЕЙ накладкой, не автоматической (X2: мутация «frameAuto=!placedId» дала бы true и краснит здесь)");
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(tplFrame.id), "в поле — накладка шаблона");
  /* Смена комнаты у шаблона накладку НЕ трогает (applyAutoDefaultFrame no-op при frameAuto=false). */
  runChangeRoom(state, dom, "r2");
  assert.ok(!("preferredFrameId" in dom.$("postFrameSelect").dataset)
    || dom.$("postFrameSelect").dataset.preferredFrameId === String(tplFrame.id),
    "смена комнаты не навязала авто-накладку шаблону — его накладка осталась (мутация X2 подменила бы её дефолтом комнаты)");
});

/* ── 11. В2: плашка пустого пула — совет ОДИН раз; «Механизмы поста сохранены» — только у поста с механизмами ──
   Тот же настоящий renderBuilder и то же сужение под комнату Arke/«Антрацит» (пустой пул), что и в §2;
   различаем лишь начинку черновика поста. Старый текст печатал совет дважды («измените отбор…» из
   frameFacingEmptyText + «Смените отбор…») и обещал «Механизмы поста сохранены» даже у нового пустого. */
function emptyRoomComposition(slots) {
  const dom = stand.makeDom({ selects: ["postFrameSelect", "postSlotCount"] });
  const state = { products: PRODUCTS,
    rooms: [{ id: "r1", name: "Спальня", standard: "DE", collection: "Arke", frameColor: "Антрацит" }],
    posts: [], builder: { slots, target: { mode: "add" }, roomId: "r1", editingPlacedId: null, frameAuto: true } };
  dom.$("postFrameSelect").dataset.preferredFrameId = "";
  dom.$("postSlotCount").value = "3";
  const ctx = {
    state, $: dom.$, esc: s => String(s == null ? "" : s),
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameProduct: product, product, EPCatalog, EPRoom, EPPosts, EPBuilderSlots,
    frameSlotCount: EPCatalog.frameSlotCount, frameSlotOptions: EPCatalog.frameSlotOptions,
    compatibleMechanisms: EPCatalog.compatibleMechanisms, mechanismSpan: EPCatalog.mechanismSpan,
    productSeries: EPCatalog.productSeries, moduleWord: EPCatalog.moduleWord,
    frameOptions: (items, selId) => (items || []).map(i => `<option value="${i.id}" ${Number(i.id) === Number(selId) ? "selected" : ""}>${i.id}</option>`).join(""),
    enhancePicker: () => {}, resolveMissingFrame: () => null,
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    moduleLayout: () => [], lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    renderBuilderSlots: () => {}, renderBuilderCatalog: () => {},
    renderBuilderComposition: (frame, errorHtml) => { dom.$("builderComposition").innerHTML = frame ? "<comp>" : (errorHtml || ""); },
    builderInnardsFilter: () => ({}), frameFacingList: () => EPCatalog.productFacingValues(activeFrames, "frameColor"),
    builderCtx: {}
  };
  stand.run(RB_CUT, ctx)();
  return dom.$("builderComposition").innerHTML;
}
const countOf = (hay, needle) => hay.split(needle).length - 1;

test("★ В2: пустой пул — совет о смене отбора звучит РОВНО один раз (не дважды)", () => {
  const html = emptyRoomComposition([]);
  assert.match(html, /в каталоге накладок нет — измените отбор в свойствах комнаты или откройте пост в другой комнате\./,
    "единая формулировка: одна причина + один совет с обоими выходами");
  assert.equal(countOf(html, "измените отбор в свойствах комнаты"), 1, "совет «измените отбор…» не повторяется");
  assert.equal(countOf(html, "откройте пост в другой комнате"), 1, "«откройте пост в другой комнате» не повторяется");
  assert.doesNotMatch(html, /Смените отбор/, "старой второй копии совета «Смените отбор…» больше нет");
  assert.match(html, /стандарт «немецкий»/, "плашка по-прежнему называет ВСЕ условия (стандарт)");
  assert.match(html, /серия «Arke»/); assert.match(html, /цвет «Антрацит»/);
});

test("★ В2: у нового ПУСТОГО поста фразы «Механизмы поста сохранены» нет", () => {
  const html = emptyRoomComposition([]);
  assert.doesNotMatch(html, /Механизмы поста сохранены/,
    "сохранять нечего — механизмов в черновике нет (mechanismIds пуст)");
});

test("★ В2: у поста С механизмами «Механизмы поста сохранены» остаётся", () => {
  const mech = PRODUCTS.find(p => p.kind === "mechanism" && p.active);
  assert.ok(mech, "предпосылка: в каталоге есть активный механизм");
  const html = emptyRoomComposition([EPBuilderSlots.slot(mech.id)]);
  assert.match(html, /Механизмы поста сохранены\.$|Механизмы поста сохранены\.<\/span>/,
    "у поста с механизмами обещание сохранности остаётся");
  assert.equal(countOf(html, "измените отбор в свойствах комнаты"), 1, "совет по-прежнему один раз");
});
