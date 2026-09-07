/* ПОВЕДЕНЧЕСКИЙ регресс E13 (доводка 3b80997): селектор «Количество модулей рамки» и пустой
   контекст поиска накладок обязаны считаться ОТ ТОГО ЖЕ пула, что renderBuilder ФИЛЬТРУЕТ по
   коллекции комнаты, а не от всего каталога.

   ЗАЧЕМ. Коллекция комнаты (E13) сужает список накладок первым шагом
   (collectionFramePool→builderRoomFilter→EPCatalog.productsForRoom). Селектор модульностей раньше
   строился от всего каталога и предлагал модульность, которой у коллекции нет: в комнате
   «Eikon Tactil» (пул 33 накладки, реальные модульности 2/3/4) он показывал ещё и 1/6/7/8/14/21.
   Выбор «мёртвой» «8» давал пустой matchingFrames, renderBuilder проваливался в фолбэк
   `matchingFrames.length?…:poolFrames` и показывал ВЕСЬ пул коллекции (33 накладки на 2/3/4) под
   видом фильтра «8». Чинилось двумя правками app.js:
     1) renderPostSlotCountSelect: frameSlotOptions(collectionFramePool(byKind("frame")),extra);
     2) renderBuilder → enhancePicker.emptyContext стал ФУНКЦИЕЙ и называет коллекцию.

   ЧТО ПРОВЕРЯЕМ ПОВЕДЕНЧЕСКИ (исполняем НАСТОЯЩИЙ текст app.js в vm на НАСТОЯЩЕМ каталоге VIMAR):
   A) селектор поста в комнате «Eikon Tactil» = ровно [2,3,4]; того же поста без коллекции =
      [1,2,3,4,6,7,8,14,21]; «8» в первом случае НЕТ (это и есть починенный дефект);
   B) фактическая ёмкость открытого поста (extra) всё равно попадает в селектор, даже если у
      коллекции такой модульности нет — старый пост не покажет чужое значение;
   C) без комнаты / шаблон (нет editingPlacedId) → селектор от полного каталога (совместимость
      со старым проектом без коллекции);
   D) emptyContext в renderBuilder называет реально искомое множество: (1) коллекция+модульность →
      «накладок на 2 модуля коллекции «Eikon Tactil»»; (2) коллекция, matchingFrames пуст →
      «накладок коллекции «Eikon Tactil»»; (3) без коллекции → «загруженных накладок».
   E) СОСТАВ списка накладок в фолбэке renderBuilder (`frames=matchingFrames.length?…:poolFrames`).
      Когда у коллекции комнаты нет накладок под выбранную модульность (matchingFrames пуст), список
      обязан остаться ПУЛОМ КОЛЛЕКЦИИ, а не всем каталогом: в комнате «Eikon Tactil» с «8 модулей»
      предлагаются ровно 33 накладки коллекции, ни одной чужой. D2 проверял в этой же ветке только
      ТЕКСТ emptyContext, но не то, какие накладки реально попали в <select> — фолбэк на весь каталог
      (1631 накладка, 1598 чужих) прошёл бы мимо. Пост открыт БЕЗ накладки (frameUnset), поэтому
      requestedFrame в список не подмешивается — проверяем чистый результат фолбэка.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено, см. отчёт):
     collectionFramePool(byKind) → byKind в renderPostSlotCountSelect  → красит A;
     убрать extra из frameSlotOptions                                  → красит B;
     builderRoomFilter → {collection:null}                             → красит A и D (C остаётся зелёным — так и надо);
     убрать суффикс « коллекции «…»» из emptyContext                   → красит D;
     вернуть emptyContext строкой (`…:"загруженных накладок"`)         → красит D;
     фолбэк `…?matchingFrames:poolFrames` → `…:allFrames`              → красит E (в список утекают 1598 чужих накладок).
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
const activeFrames = PRODUCTS.filter(x => x.kind === "frame" && x.active);
const seriesOf = p => (p && p.series) || [];
const optionValues = html => [...html.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);

/* Разведка каталога (замерено на js/catalog-vimar.js): полный список модульностей накладок и
   пул одной коллекции строятся продакшн-функциями — числа НЕ хардкодим, а фиксируем как
   предпосылки, чтобы правка данных заказчика (перезалив прайса) уронила тест осмысленно. */
const ALL_OPTS = EPCatalog.frameSlotOptions(activeFrames);
const ET_POOL = activeFrames.filter(f => seriesOf(f).includes("Eikon Tactil"));
const ET_OPTS = EPCatalog.frameSlotOptions(ET_POOL);
assert.deepEqual(ALL_OPTS, [1, 2, 3, 4, 6, 7, 8, 14, 21], "предпосылка: модульности всего каталога");
assert.deepEqual(ET_OPTS, [2, 3, 4], "предпосылка: пул коллекции «Eikon Tactil» несёт модульности 2/3/4");
assert.ok(ALL_OPTS.includes(8) && !ET_OPTS.includes(8),
  "предпосылка: «8» есть у каталога, но НЕТ у Eikon Tactil — на этой паре и держится доказательство");
const ET_FRAME_2 = ET_POOL.find(f => EPCatalog.frameSlotCount(f) === 2);
assert.ok(ET_FRAME_2, "разведка: у Eikon Tactil есть накладка на 2 модуля");

/* --- A/B/C: renderPostSlotCountSelect ------------------------------------------------------ */
/* Контекст vm для селектора модульностей: доменная логика и каталог НАСТОЯЩИЕ. collectionFramePool/
   builderRoomFilter/frameCollectionList НЕ заглушаем — их и проверяем. */
function slotCtx(state, dom) {
  return {
    state, $: dom.$,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotOptions: EPCatalog.frameSlotOptions,
    EPCatalog, EPRoom
  };
}
const SLOT_CUT = ["frameCollectionList", "builderRoomFilter", "collectionFramePool", "renderPostSlotCountSelect"];

/* Отрисовать селектор модульностей так, как это делает openPostBuilder: пост стоит в комнате
   (editingPlacedId→roomId→комната), extra — фактическая ёмкость открываемого поста. */
function renderSlotSelect({ room, extra }) {
  const post = { id: "p1", roomId: room ? "r1" : null };
  const state = {
    products: PRODUCTS,
    posts: [post],
    rooms: room ? [Object.assign({ id: "r1", name: "Комната" }, room)] : [],
    builder: { editingPlacedId: room ? "p1" : null }
  };
  const dom = stand.makeDom();
  const ctx = slotCtx(state, dom);
  const render = stand.run(SLOT_CUT, ctx);
  render(extra);
  return optionValues(dom.$("postSlotCount").innerHTML).map(Number);
}

test("E13-A: селектор поста в комнате «Eikon Tactil» = ровно [2,3,4]; «8» нет; без коллекции = весь каталог", () => {
  // extra=2 — реальная ёмкость поста в этой комнате, добавка ничего не меняет: множество уже несёт 2
  const inCollection = renderSlotSelect({ room: { collection: "Eikon Tactil" }, extra: 2 });
  assert.deepEqual(inCollection, [2, 3, 4],
    "коллекция комнаты обязана сузить селектор до реально существующих у неё модульностей");
  assert.ok(!inCollection.includes(8),
    "«8» у Eikon Tactil нет — предлагать её значило бы вернуть починенный дефект (33 накладки на 2/3/4 под видом фильтра «8»)");

  // тот же пост, но комната без коллекции — селектор от всего каталога (сравнение множеств)
  const noCollection = renderSlotSelect({ room: {}, extra: 2 });
  assert.deepEqual(noCollection, [1, 2, 3, 4, 6, 7, 8, 14, 21],
    "без коллекции селектор строится от всего каталога — старое поведение сохранено");
  assert.ok(noCollection.includes(8), "предпосылка: без сужения «8» в селекторе есть");
});

test("E13-B: фактическая ёмкость поста (extra) попадает в селектор, даже если у коллекции такой модульности нет", () => {
  // старый пост открыт с ёмкостью 8, а у Eikon Tactil только 2/3/4 — «8» обязана остаться опцией,
  // иначе <select>.value=8 не сработает и поле молча покажет чужую первую модульность
  const opts = renderSlotSelect({ room: { collection: "Eikon Tactil" }, extra: 8 });
  assert.deepEqual(opts, [2, 3, 4, 8],
    "extra=8 добавляется отдельным вариантом к модульностям коллекции — пост не потеряет своё значение");
  assert.ok(opts.includes(8), "модульность открытого поста присутствует, хотя коллекция её не содержит");
});

test("E13-C: без комнаты / шаблон (нет editingPlacedId) — селектор от полного каталога", () => {
  const opts = renderSlotSelect({ room: null, extra: 3 });
  assert.deepEqual(opts, [1, 2, 3, 4, 6, 7, 8, 14, 21],
    "шаблон/новый пост комнаты не имеют → коллекции нет → весь каталог (обратная совместимость)");
});

/* --- D: renderBuilder → enhancePicker.emptyContext ---------------------------------------- */
/* Контекст vm для renderBuilder. Всё, что не относится к вычислению emptyContext, заглушено
   безопасными стабами (как в roomCollectionBuilderWiring); enhancePicker перехватываем, чтобы
   забрать ПЕРЕДАННУЮ функцию emptyContext и вызвать её — проверяем НАСТОЯЩИЙ её текст, а не наш.
   Пост открываем БЕЗ накладки (frameUnset): renderBuilder успевает вызвать enhancePicker и
   выходит ранним return, не гоняя тяжёлый нормальный путь. */
function builderCtx(state, dom, captured) {
  const byKind = kind => state.products.filter(x => x.kind === kind && x.active);
  return {
    state, product, byKind, frameProduct: id => product(id), $: dom.$,
    frameSlotCount: EPCatalog.frameSlotCount,
    mechanismSpan: EPCatalog.mechanismSpan,
    moduleWord: EPCatalog.moduleWord,
    esc: s => String(s == null ? "" : s),
    EPCatalog, EPRoom, EPPosts, EPBuilderSlots,
    productSeries: seriesOf,
    productOptionLabel: i => `[${i.code}] ${i.name}`,
    // перехват: забираем options.emptyContext, отрисовку списка не трогаем
    enhancePicker: (sel, options) => { captured.options = options; },
    resolveMissingFrame: () => null,
    mechanismModulesTotal: () => 0,
    assembledPostHtml: () => "",
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    renderBuilderSlots: () => {}, lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    builderErrorHtml: () => "", renderBuilderCatalog: () => {}, renderBuilderComposition: () => {},
    builderCtx: {}
  };
}
const BUILDER_CUT = ["frameCollectionList", "builderRoomFilter", "collectionFramePool", "frameOptions", "builderCapacity", "renderBuilder"];

/* Вызвать renderBuilder для поста БЕЗ накладки (frameUnset) в заданной комнате при заданном числе
   модулей в селекторе, вернуть результат ВЫЗОВА перехваченного emptyContext(). */
function emptyContextFor({ room, count }) {
  const post = { id: "p1", roomId: room ? "r1" : null, mechanismIds: [] };
  const state = {
    products: PRODUCTS,
    posts: [post],
    rooms: room ? [Object.assign({ id: "r1", name: "Комната" }, room)] : [],
    builder: { slots: [], target: { mode: "add" }, editingPlacedId: room ? "p1" : null }
  };
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  dom.$("postFrameSelect").dataset.preferredFrameId = ""; // пустая накладка → frameUnset → ранний выход после enhancePicker
  dom.$("postSlotCount").value = String(count);
  const captured = {};
  const ctx = builderCtx(state, dom, captured);
  const render = stand.run(BUILDER_CUT, ctx);
  render();
  assert.equal(typeof captured.options, "object", "enhancePicker должен быть вызван renderBuilder");
  assert.equal(typeof captured.options.emptyContext, "function",
    "emptyContext обязан быть ФУНКЦИЕЙ — коллекция вычисляется лениво в момент показа пустого поиска");
  return captured.options.emptyContext();
}

test("E13-D1: emptyContext в комнате коллекции при существующей модульности называет и число, и коллекцию", () => {
  const text = emptyContextFor({ room: { collection: "Eikon Tactil" }, count: 2 });
  assert.equal(text, "накладок на 2 модуля коллекции «Eikon Tactil»",
    "пустой поиск обязан назвать РЕАЛЬНО искомое: накладки на 2 модуля именно коллекции Eikon Tactil");
});

test("E13-D2: emptyContext в комнате коллекции, когда модульности у неё нет (matchingFrames пуст), называет коллекцию", () => {
  // count=8: у Eikon Tactil накладок на 8 модулей нет → matchingFrames пуст → ветка без числа, но с коллекцией
  const text = emptyContextFor({ room: { collection: "Eikon Tactil" }, count: 8 });
  assert.equal(text, "накладок коллекции «Eikon Tactil»",
    "когда под число модулей у коллекции нет накладок, поиск шёл по всему пулу коллекции — так и надо это назвать");
  assert.ok(!/на \d+ модул/.test(text), "числа модулей в этой ветке быть не должно — искали по всей коллекции");
});

test("E13-D3: emptyContext без коллекции не поминает коллекцию — «загруженных накладок»", () => {
  // шаблон (editingPlacedId нет), count=5 — модульности «5» в каталоге нет → matchingFrames пуст
  const text = emptyContextFor({ room: null, count: 5 });
  assert.equal(text, "загруженных накладок",
    "вне коллекции пустой поиск говорит про весь каталог, слова «коллекци» быть не должно");
  assert.ok(!/коллекци/.test(text), "без коллекции комнаты её имя в контексте появиться не может");
});

/* --- E: СОСТАВ списка накладок в фолбэке renderBuilder ------------------------------------- */
/* Тот же стенд renderBuilder, что у D, но перехваченный enhancePicker не нужен — читаем НАСТОЯЩИЙ
   #postFrameSelect.innerHTML, куда renderBuilder положил frameOptions(frameList,…). Пост без
   накладки (frameUnset) → requestedFrame нет → frameList === frames, то есть чистый результат
   фолбэка `matchingFrames.length?…:poolFrames` без подмешанной накладки поста. */
function frameOptionProductsFor({ room, count }) {
  const post = { id: "p1", roomId: room ? "r1" : null, mechanismIds: [] };
  const state = {
    products: PRODUCTS,
    posts: [post],
    rooms: room ? [Object.assign({ id: "r1", name: "Комната" }, room)] : [],
    builder: { slots: [], target: { mode: "add" }, editingPlacedId: room ? "p1" : null }
  };
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  dom.$("postFrameSelect").dataset.preferredFrameId = ""; // пустая накладка → frameUnset → frameList=frames
  dom.$("postSlotCount").value = String(count);
  const ctx = builderCtx(state, dom, {});
  const render = stand.run(BUILDER_CUT, ctx);
  render();
  return optionValues(dom.$("postFrameSelect").innerHTML).map(v => product(v)).filter(Boolean);
}

test("E13-E: фолбэк списка накладок при пустом matchingFrames остаётся пулом коллекции — ни одной чужой", () => {
  // count=8: у Eikon Tactil накладок на 8 модулей нет → matchingFrames пуст → срабатывает фолбэк.
  // Продакшн отдаёт пул коллекции (33 накладки на 2/3/4); фолбэк на весь каталог показал бы 1631.
  assert.ok(!ET_OPTS.includes(8), "предпосылка: у Eikon Tactil нет накладок на 8 модулей — фолбэк точно сработает");
  const shown = frameOptionProductsFor({ room: { collection: "Eikon Tactil" }, count: 8 });
  const foreign = shown.filter(p => !seriesOf(p).includes("Eikon Tactil"));
  assert.deepEqual(foreign, [],
    "в списке накладок не должно быть ни одной ЧУЖОЙ коллекции: фолбэк обязан остаться пулом Eikon Tactil, а не всем каталогом");
  assert.equal(shown.length, ET_POOL.length,
    "в фолбэк попадает ровно пул коллекции (все её накладки), а не каталог целиком");
});
