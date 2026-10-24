/* ПОВЕДЕНЧЕСКИЙ регресс E13: конструктор поста в комнате с закреплённой КОЛЛЕКЦИЕЙ предлагает
   накладки ТОЛЬКО этой коллекции (js/app.js renderBuilder → collectionFramePool → builderRoomFilter).

   ЗАЧЕМ. Встреча 24.08 §4.1–4.2: за помещением закрепляется коллекция, каталог отсеивает
   неподходящие рамки. Здесь фиксируем три вещи, которые легко сломать незаметно:
   1) ФИЛЬТР ЕСТЬ: в комнате коллекции Arke список накладок короче, чем без коллекции, и не
      содержит рамок чужой коллекции (Plana);
   2) СОВПАДЕНИЕ ПО ЧЛЕНСТВУ В МНОЖЕСТВЕ СЕРИЙ: Arke-накладка обязана попасть в комнату Arke
      (в новой номенклатуре К2 все накладки одноколлекционные — мультиколлекционных больше нет);
   3) МОЛЧАЛИВОГО ИЗМЕНЕНИЯ СОСТАВА НЕТ: пост, СТОЯЩИЙ в комнате Arke на накладке ЧУЖОЙ коллекции
      (Plana), при открытии держит свою накладку и цену — фильтр сужает только предлагаемое, но
      не переписывает уже собранный пост.

   Исполняем НАСТОЯЩИЕ collectionFramePool/builderRoomFilter/frameCollectionList/frameOptions/
   builderCapacity/renderBuilder из app.js на НАСТОЯЩЕМ каталоге VIMAR через общий стенд appStand
   (vm + DOM-шим). EPCatalog/EPRoom, EPRoomVariants, EPRoomVariantsUi — настоящие: правило пересечения проверяется по продакшн-коду.

   ЧТО КРАСНЕЕТ (мутационная таблица — в отчёте):
   1) убрать сужение (collectionFramePool → allFrames): в комнате Arke появятся рамки Plana → §1;
   2) заменить includes на равенство строк в productsForRoom: Arke-накладка выпадет из Arke → §2;
   3) перестать добавлять стоящую накладку в frameList / фильтровать её коллекцией: пост на
      Plana-рамке в Arke-комнате потеряет накладку и цену → §3.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPRoomVariants = require("../js/roomVariants.js");
const EPRoomVariantsUi = require("../js/roomVariantsUi.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => p.code === code);
const activeMech = PRODUCTS.filter(x => x.kind === "mechanism" && x.active);
const seriesOf = p => (p && p.series) || [];

/* Разведка каталога. ВАЖНО (К2, новая номенклатура 2026-10-10): в файле заказчика у каждой
   НАКЛАДКИ ровно одна коллекция — мультиколлекционных накладок больше нет (прежняя 14931 несла
   Arke+Arke Fit+Eikon Evo+Eikon Exe+Plana, теперь только Plana), а коллекция «Arke Fit» из каталога
   ушла вовсе. Поэтому прежние мутационные края (пересечение-vs-равенство на мультиколлекционной
   накладке; префикс-vs-членство на паре Arke/Arke Fit) на РЕАЛЬНЫХ данных больше не воспроизводятся
   — см. отчёт. Здесь остаётся проверка самого ФИЛЬТРА: в комнате Arke предлагаются только Arke-
   накладки, Plana-рамок нет, а уже собранный пост на чужой накладке не переписывается. */
const ARKE_2 = byCode("19642.01");      // Arke, 2 модуля
const PLANA_ONLY = byCode("14642.01");  // только Plana, 2 модуля
assert.ok(ARKE_2 && PLANA_ONLY, "разведка: 19642.01 и 14642.01 должны быть в каталоге");
const CNT = EPCatalog.frameSlotCount(ARKE_2);
assert.equal(EPCatalog.frameSlotCount(PLANA_ONLY), CNT, "предпосылка: обе накладки одной модульности");
assert.ok(seriesOf(ARKE_2).includes("Arke"), "предпосылка: 19642.01 — коллекции Arke");
assert.ok(seriesOf(PLANA_ONLY).includes("Plana") && !seriesOf(PLANA_ONLY).includes("Arke"),
  "предпосылка: 14642.01 — только Plana");

/* На модульности 3 проверяем тот же фильтр по МНОЖЕСТВУ серий: 19653.01 — Arke-накладка комнаты,
   14653.01 — Plana-накладка той же модульности, чужая комнате Arke по членству. */
const ARKE_3 = byCode("19653.01");
const PLANA_3 = byCode("14653.01");
assert.ok(ARKE_3 && PLANA_3, "разведка: 19653.01 и 14653.01 должны быть в каталоге");
assert.equal(EPCatalog.frameSlotCount(ARKE_3), 3, "предпосылка: 19653.01 — 3 модуля");
assert.equal(EPCatalog.frameSlotCount(PLANA_3), 3, "предпосылка: 14653.01 — 3 модуля");
assert.ok(seriesOf(ARKE_3).includes("Arke"), "предпосылка: 19653.01 — коллекции Arke");
assert.ok(seriesOf(PLANA_3).includes("Plana") && !seriesOf(PLANA_3).includes("Arke"),
  "предпосылка: 14653.01 — только Plana, для комнаты Arke чужая по членству");

const slotsOf = (id, n) => EPBuilderSlots.fromPost({ mechanismIds: Array.from({ length: n }, () => Number(id)) }, () => false);
const optionValues = html => [...html.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);

/* Контекст vm: доменная логика и каталог настоящие. collectionFramePool/builderRoomFilter/
   frameCollectionList НЕ заглушаем — их и проверяем, поэтому пробрасываем EPCatalog/EPRoom, EPRoomVariants, EPRoomVariantsUi. */
function makeCtx(state, dom) {
  const byKind = kind => state.products.filter(x => x.kind === kind && x.active);
  return {
    state, product, byKind, frameProduct: id => product(id), $: dom.$,
    frameSlotCount: EPCatalog.frameSlotCount,
    compatibleMechanisms: EPCatalog.compatibleMechanisms,
    mechanismSpan: EPCatalog.mechanismSpan,
    moduleWord: EPCatalog.moduleWord,
    productSeries: seriesOf,
    productOptionLabel: i => `[${i.code}] ${i.name}`,
    esc: s => String(s == null ? "" : s),
    EPCatalog, EPRoom, EPRoomVariants, EPRoomVariantsUi,
    enhancePicker: () => {}, resolveMissingFrame: () => null,
    mechanismModulesTotal: ids => ids.reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>",
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    renderBuilderSlots: () => {}, lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    builderErrorHtml: () => "",
    renderBuilderCatalog: () => {},
    renderBuilderComposition: () => {},
    renderBuilder: () => {}, builderCtx: {}, EPBuilderSlots, EPPosts, EPThermoSensor: require("../js/thermoSensor.js")
  };
}
const CUT = ["frameCollectionList", "frameFacingList", "frameStandardList", "builderFilterRoom", "roomCatalogFilter", "builderRoomFilter", "builderInnardsFilter", "collectionFramePool", "frameFacingLabels", "frameFacingHintText", "frameOptions", "builderCapacity", "renderBuilder"];
const makeDom = () => stand.makeDom({ selects: ["postFrameSelect"] });

/* Открыть конструктор для поста, стоящего в комнате: как openPostBuilder — накладка поста явно
   через dataset, слоты из его механизмов, editingPlacedId указывает на пост. */
function openFor(post, room, frameId, mech, dom) {
  const state = {
    products: PRODUCTS,
    posts: [post], rooms: room ? [room] : [],
    builder: { slots: slotsOf(mech.id, CNT), target: { mode: "add" }, editingPlacedId: post.id }
  };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(frameId);
  dom.$("postSlotCount").value = String(CNT);
  const render = stand.run(CUT, ctx);
  render();
  return { state, ctx };
}

/* То же открытие, но под ПРОИЗВОЛЬНУЮ модульность n (openFor завязан на глобальный CNT=2).
   Слоты — n одномодульных механизмов, селектор модулей = n. */
function openForN(post, room, frameId, mech, dom, n) {
  const slots = EPBuilderSlots.fromPost({ mechanismIds: Array.from({ length: n }, () => Number(mech.id)) }, () => false);
  const state = {
    products: PRODUCTS,
    posts: [post], rooms: room ? [room] : [],
    builder: { slots, target: { mode: "add" }, editingPlacedId: post.id }
  };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(frameId);
  dom.$("postSlotCount").value = String(n);
  const render = stand.run(CUT, ctx);
  render();
  return { state, ctx };
}

test("E13: в комнате Arke на модульности 3 предлагаются ТОЛЬКО накладки Arke — чужая Plana-накладка той же модульности не просачивается", () => {
  // 19653.01 (Arke, 3М) в комнате Arke, селектор 3 модуля. Продакшн предлагает только накладки с
  // серией «Arke» в множестве; 14653.01 (Plana, 3М) — чужая по членству, её в списке быть не должно.
  // ПРИМЕЧАНИЕ (К2): прежде этот кейс ловил ещё и префиксный мутант (some(s=>s.indexOf(collection)===0))
  // на паре «Arke»/«Arke Fit» — но «Arke Fit» из каталога ушла, пары имя-префикс среди 10 коллекций
  // не осталось, и именно этот мутационный край на реальных данных больше не воспроизвести (отчёт).
  const arke3Mech = EPCatalog.compatibleMechanisms(ARKE_3, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
  assert.ok(arke3Mech, "разведка: у 3-модульной Arke-накладки есть совместимый одномодульный механизм");

  const dom = makeDom();
  openForN({ id: "p1", roomId: "r1", frameId: ARKE_3.id, mechanismIds: Array.from({ length: 3 }, () => Number(arke3Mech.id)) },
    { id: "r1", name: "Гостиная", collection: "Arke" }, ARKE_3.id, arke3Mech, dom, 3);
  const vals = optionValues(dom.els.postFrameSelect.innerHTML);

  // отбор по СЕРИЯМ товара: ни одна предложенная накладка не должна быть чужой коллекции (без "Arke")
  const foreign = vals.filter(id => !seriesOf(product(id)).includes("Arke"));
  assert.deepEqual(foreign, [],
    `в комнате Arke каждая предложенная накладка обязана нести серию Arke; чужие по членству: ${foreign.join(", ")}`);
  // точечно: Plana-накладка той же модульности (14653.01) в списке Arke-комнаты отсутствует
  assert.ok(!vals.includes(String(PLANA_3.id)),
    "Plana-накладка 14653.01 не предлагается в комнате Arke — она не член множества серий комнаты");
});

test("E13: в комнате Arke предлагаются ТОЛЬКО накладки Arke — Plana-рамки нет, список короче, чем без коллекции", () => {
  const arkeMech = EPCatalog.compatibleMechanisms(ARKE_2, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
  assert.ok(arkeMech, "разведка: у 14931 есть совместимый одномодульный механизм");

  // тот же пост в комнате Arke и без коллекции — сравниваем списки предлагаемых накладок
  const domArke = makeDom();
  openFor({ id: "p1", roomId: "r1", frameId: ARKE_2.id, mechanismIds: [Number(arkeMech.id)] },
    { id: "r1", name: "Гостиная", collection: "Arke" }, ARKE_2.id, arkeMech, domArke);
  const arkeVals = optionValues(domArke.els.postFrameSelect.innerHTML);

  const domAll = makeDom();
  openFor({ id: "p1", roomId: "r1", frameId: ARKE_2.id, mechanismIds: [Number(arkeMech.id)] },
    { id: "r1", name: "Гостиная" /* коллекции нет */ }, ARKE_2.id, arkeMech, domAll);
  const allVals = optionValues(domAll.els.postFrameSelect.innerHTML);

  // §1 фильтр есть: с коллекцией список строго короче, каждый предложенный — из Arke, Plana-рамки нет
  assert.ok(arkeVals.length < allVals.length, "коллекция Arke должна сузить список накладок");
  assert.ok(arkeVals.every(id => seriesOf(product(id)).includes("Arke")),
    "каждая предложенная накладка обязана принадлежать коллекции Arke");
  assert.ok(!arkeVals.includes(String(PLANA_ONLY.id)), "накладка чужой коллекции (Plana) не предлагается");
  assert.ok(allVals.includes(String(PLANA_ONLY.id)), "предпосылка: без коллекции Plana-рамка той же модульности предлагалась");

  // §2 отбор по членству в множестве серий: Arke-накладка 19642.01 в комнате Arke ЕСТЬ
  assert.ok(arkeVals.includes(String(ARKE_2.id)),
    "накладка 19642.01 (серия Arke) обязана попасть в комнату Arke — совпадение по МНОЖЕСТВУ серий");
});

test("E13: пост в комнате Arke на накладке ЧУЖОЙ коллекции (Plana) — накладка и цена держатся, состав не меняется молча", () => {
  // механизм совместим с ПОСТ-накладкой (Plana) — как было бы у реального собранного поста
  const planaMech = EPCatalog.compatibleMechanisms(PLANA_ONLY, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
  assert.ok(planaMech, "разведка: у 14642.01 (Plana) есть совместимый одномодульный механизм");

  const dom = makeDom();
  const post = { id: "p1", roomId: "r1", frameId: PLANA_ONLY.id, mechanismIds: [Number(planaMech.id), Number(planaMech.id)] };
  const { state } = openFor(post, { id: "r1", name: "Гостиная", collection: "Arke" }, PLANA_ONLY.id, planaMech, dom);

  // накладка поста (Plana) держится значением, хотя комната — Arke: сужение не переписывает пост
  assert.equal(dom.els.postFrameSelect.value, String(PLANA_ONLY.id),
    "накладка поста (14642.01, Plana) остаётся выбранной в Arke-комнате — не подменяется на Arke-рамку");
  assert.equal(product(dom.els.postFrameSelect.value).price, PLANA_ONLY.price,
    "цена считается по НАСТОЯЩЕЙ накладке поста — молчаливого изменения суммы нет");
  // накладка присутствует в списке как уже стоящая (человек может её сменить сам)
  assert.ok(optionValues(dom.els.postFrameSelect.innerHTML).includes(String(PLANA_ONLY.id)),
    "чужая коллекции накладка поста остаётся в списке — выбор смены за человеком");
  // состав не поредел: оба механизма целы
  assert.equal(state.builder.slots.length, 2, "механизмы поста целы — фильтр коллекции их не режет");
  assert.ok(!dom.els.savePost.disabled, "сохранение доступно — пост валиден, просто из другой коллекции");
});

test("E13: пост вне комнат (roomId null) — фильтра нет, предлагается весь каталог", () => {
  const arkeMech = EPCatalog.compatibleMechanisms(ARKE_2, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
  const dom = makeDom();
  openFor({ id: "p1", roomId: null, frameId: ARKE_2.id, mechanismIds: [Number(arkeMech.id)] },
    null, ARKE_2.id, arkeMech, dom);
  const vals = optionValues(dom.els.postFrameSelect.innerHTML);
  assert.ok(vals.includes(String(PLANA_ONLY.id)),
    "без комнаты (пост вне помещений) фильтра нет — Plana-рамка той же модульности предлагается");
});
