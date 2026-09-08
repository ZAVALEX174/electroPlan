/* ПОВЕДЕНЧЕСКИЙ регресс E13: конструктор поста в комнате с закреплённой КОЛЛЕКЦИЕЙ предлагает
   накладки ТОЛЬКО этой коллекции (js/app.js renderBuilder → collectionFramePool → builderRoomFilter).

   ЗАЧЕМ. Встреча 24.08 §4.1–4.2: за помещением закрепляется коллекция, каталог отсеивает
   неподходящие рамки. Здесь фиксируем три вещи, которые легко сломать незаметно:
   1) ФИЛЬТР ЕСТЬ: в комнате коллекции Arke список накладок короче, чем без коллекции, и не
      содержит рамок чужой коллекции (Plana);
   2) СОВПАДЕНИЕ — ПЕРЕСЕЧЕНИЕ МНОЖЕСТВ, НЕ РАВЕНСТВО СТРОК: мультиколлекционная накладка (14931 —
      Arke/Arke Fit/Eikon Evo/Eikon Exe/Plana) обязана попасть в комнату Arke;
   3) МОЛЧАЛИВОГО ИЗМЕНЕНИЯ СОСТАВА НЕТ: пост, СТОЯЩИЙ в комнате Arke на накладке ЧУЖОЙ коллекции
      (Plana), при открытии держит свою накладку и цену — фильтр сужает только предлагаемое, но
      не переписывает уже собранный пост.

   Исполняем НАСТОЯЩИЕ collectionFramePool/builderRoomFilter/frameCollectionList/frameOptions/
   builderCapacity/renderBuilder из app.js на НАСТОЯЩЕМ каталоге VIMAR через общий стенд appStand
   (vm + DOM-шим). EPCatalog/EPRoom — настоящие: правило пересечения проверяется по продакшн-коду.

   ЧТО КРАСНЕЕТ (мутационная таблица — в отчёте):
   1) убрать сужение (collectionFramePool → allFrames): в комнате Arke появятся рамки Plana → §1;
   2) заменить includes на равенство строк в productsForRoom: 14931 выпадет из Arke → §2;
   3) перестать добавлять стоящую накладку в frameList / фильтровать её коллекцией: пост на
      Plana-рамке в Arke-комнате потеряет накладку и цену → §3.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => p.code === code);
const activeMech = PRODUCTS.filter(x => x.kind === "mechanism" && x.active);
const seriesOf = p => (p && p.series) || [];

/* Разведка каталога (см. tools-прогон в отчёте): count=2 несёт и Arke, и Plana-only, и
   мультиколлекционную накладку. */
const ARKE_MULTI = byCode("14931");     // Arke + Plana + ... (мультиколлекционная), 2 модуля
const PLANA_ONLY = byCode("14642.01");  // только Plana, 2 модуля
assert.ok(ARKE_MULTI && PLANA_ONLY, "разведка: 14931 и 14642.01 должны быть в каталоге");
const CNT = EPCatalog.frameSlotCount(ARKE_MULTI);
assert.equal(EPCatalog.frameSlotCount(PLANA_ONLY), CNT, "предпосылка: обе накладки одной модульности");
assert.ok(seriesOf(ARKE_MULTI).includes("Arke") && seriesOf(ARKE_MULTI).includes("Plana"),
  "предпосылка: 14931 живёт и в Arke, и в Plana");
assert.ok(seriesOf(PLANA_ONLY).includes("Plana") && !seriesOf(PLANA_ONLY).includes("Arke"),
  "предпосылка: 14642.01 — только Plana");

/* Находка 5 (3-й состязательный проход): «только своя коллекция» проверялось на модульности 2, где
   накладок ТОЛЬКО «Arke Fit» физически нет — все 2-модульные несут и «Arke». Поэтому префиксное
   сравнение (Arke Fit startsWith Arke) там неотличимо от членства в множестве. Накладки ровно серии
   ["Arke Fit"] существуют лишь на 3, 4 и 7 модулей (по 11). Проверяем на модульности 3: 14943 —
   3-модульная накладка Arke; 19953.01 — накладка серии РОВНО ["Arke Fit"], 3 модуля, чужая для
   комнаты Arke по членству, хотя «Arke» — её префикс. «Arke»/«Arke Fit» — единственная пара
   имя-префикс среди 9 коллекций каталога. */
const ARKE_3 = byCode("14943");
const ARKE_FIT_ONLY = byCode("19953.01");
assert.ok(ARKE_3 && ARKE_FIT_ONLY, "разведка: 14943 и 19953.01 должны быть в каталоге");
assert.equal(EPCatalog.frameSlotCount(ARKE_3), 3, "предпосылка: 14943 — 3 модуля");
assert.equal(EPCatalog.frameSlotCount(ARKE_FIT_ONLY), 3, "предпосылка: 19953.01 — 3 модуля");
assert.ok(seriesOf(ARKE_3).includes("Arke"), "предпосылка: 14943 — коллекции Arke");
assert.ok(seriesOf(ARKE_FIT_ONLY).length === 1 && seriesOf(ARKE_FIT_ONLY).includes("Arke Fit")
  && !seriesOf(ARKE_FIT_ONLY).includes("Arke"),
  "предпосылка: 19953.01 — ровно ['Arke Fit'], для комнаты Arke чужая по членству, но 'Arke' — её строковый префикс");

const slotsOf = (id, n) => EPBuilderSlots.fromPost({ mechanismIds: Array.from({ length: n }, () => Number(id)) }, () => false);
const optionValues = html => [...html.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);

/* Контекст vm: доменная логика и каталог настоящие. collectionFramePool/builderRoomFilter/
   frameCollectionList НЕ заглушаем — их и проверяем, поэтому пробрасываем EPCatalog/EPRoom. */
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
    EPCatalog, EPRoom,
    enhancePicker: () => {}, resolveMissingFrame: () => null,
    mechanismModulesTotal: ids => ids.reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>",
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    renderBuilderSlots: () => {}, lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    builderErrorHtml: () => "",
    renderBuilderCatalog: () => {},
    renderBuilderComposition: () => {},
    renderBuilder: () => {}, builderCtx: {}, EPBuilderSlots, EPPosts
  };
}
const CUT = ["frameCollectionList", "builderRoomFilter", "collectionFramePool", "frameOptions", "builderCapacity", "renderBuilder"];
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

test("E13: в комнате Arke на модульности 3 накладка-ПРЕФИКС «Arke Fit» НЕ предлагается — членство в множестве, не startsWith", () => {
  // Находка 5: 14943 (Arke, 3М) в комнате Arke, селектор 3 модуля. Продакшн предлагает только Arke;
  // префиксный мутант (some(s=>s.indexOf(collection)===0)) добавил бы 11 накладок серии ["Arke Fit"],
  // потому что "Arke Fit".startsWith("Arke"). На модульности 2 (прежний кейс) таких накладок нет —
  // там мутант зелёный, здесь обязан краснеть.
  const arke3Mech = EPCatalog.compatibleMechanisms(ARKE_3, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
  assert.ok(arke3Mech, "разведка: у 3-модульной Arke-накладки есть совместимый одномодульный механизм");

  const dom = makeDom();
  openForN({ id: "p1", roomId: "r1", frameId: ARKE_3.id, mechanismIds: Array.from({ length: 3 }, () => Number(arke3Mech.id)) },
    { id: "r1", name: "Гостиная", collection: "Arke" }, ARKE_3.id, arke3Mech, dom, 3);
  const vals = optionValues(dom.els.postFrameSelect.innerHTML);

  // отбор проверяем по СЕРИЯМ товара, а не по названию: ни одна предложенная накладка не должна
  // быть чужой коллекции (серии без "Arke") — под префиксным сравнением сюда просочились бы ["Arke Fit"]
  const foreign = vals.filter(id => !seriesOf(product(id)).includes("Arke"));
  assert.deepEqual(foreign, [],
    `в комнате Arke каждая предложенная накладка обязана нести серию Arke; чужие по членству: ${foreign.join(", ")}`);
  // точечно: накладки серии ровно ["Arke Fit"] (напр. 19953.01) в списке нет
  assert.ok(!vals.includes(String(ARKE_FIT_ONLY.id)),
    "накладка серии ['Arke Fit'] (19953.01) не предлагается в комнате Arke — 'Arke' лишь её префикс, а не член множества серий");
});

test("E13: в комнате Arke предлагаются ТОЛЬКО накладки Arke — Plana-рамки нет, список короче, чем без коллекции", () => {
  const arkeMech = EPCatalog.compatibleMechanisms(ARKE_MULTI, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
  assert.ok(arkeMech, "разведка: у 14931 есть совместимый одномодульный механизм");

  // тот же пост в комнате Arke и без коллекции — сравниваем списки предлагаемых накладок
  const domArke = makeDom();
  openFor({ id: "p1", roomId: "r1", frameId: ARKE_MULTI.id, mechanismIds: [Number(arkeMech.id)] },
    { id: "r1", name: "Гостиная", collection: "Arke" }, ARKE_MULTI.id, arkeMech, domArke);
  const arkeVals = optionValues(domArke.els.postFrameSelect.innerHTML);

  const domAll = makeDom();
  openFor({ id: "p1", roomId: "r1", frameId: ARKE_MULTI.id, mechanismIds: [Number(arkeMech.id)] },
    { id: "r1", name: "Гостиная" /* коллекции нет */ }, ARKE_MULTI.id, arkeMech, domAll);
  const allVals = optionValues(domAll.els.postFrameSelect.innerHTML);

  // §1 фильтр есть: с коллекцией список строго короче, каждый предложенный — из Arke, Plana-рамки нет
  assert.ok(arkeVals.length < allVals.length, "коллекция Arke должна сузить список накладок");
  assert.ok(arkeVals.every(id => seriesOf(product(id)).includes("Arke")),
    "каждая предложенная накладка обязана принадлежать коллекции Arke");
  assert.ok(!arkeVals.includes(String(PLANA_ONLY.id)), "накладка чужой коллекции (Plana) не предлагается");
  assert.ok(allVals.includes(String(PLANA_ONLY.id)), "предпосылка: без коллекции Plana-рамка той же модульности предлагалась");

  // §2 пересечение множеств: мультиколлекционная 14931 (Arke+Plana) в комнате Arke ЕСТЬ
  assert.ok(arkeVals.includes(String(ARKE_MULTI.id)),
    "мультиколлекционная накладка 14931 обязана попасть в комнату Arke — совпадение по МНОЖЕСТВУ серий");
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
  const arkeMech = EPCatalog.compatibleMechanisms(ARKE_MULTI, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
  const dom = makeDom();
  openFor({ id: "p1", roomId: null, frameId: ARKE_MULTI.id, mechanismIds: [Number(arkeMech.id)] },
    null, ARKE_MULTI.id, arkeMech, dom);
  const vals = optionValues(dom.els.postFrameSelect.innerHTML);
  assert.ok(vals.includes(String(PLANA_ONLY.id)),
    "без комнаты (пост вне помещений) фильтра нет — Plana-рамка той же модульности предлагается");
});
