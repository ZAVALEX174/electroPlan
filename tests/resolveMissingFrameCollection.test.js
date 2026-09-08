/* ПОВЕДЕНЧЕСКИЙ регресс E13: подсказка пустого поиска «артикул есть в каталоге, но ДРУГОЙ
   коллекции» (js/app.js resolveMissingFrame) и её ПРОВОДКА из renderBuilder.

   ЗАЧЕМ. Помещение закреплено за коллекцией (E13); если человек вбивает в поиск точный артикул
   накладки ЧУЖОЙ коллекции, список пуст — resolveMissingFrame объясняет причину («как
   resolveMissingMechanism про другую серию»). Две независимые вещи проходили мутации ЗЕЛЁНЫМИ,
   потому что во всех пяти прежних поведенческих стендах функция заглушена
   `resolveMissingFrame: () => null` и её не звал ни один тест:
   (а) сама ветка `if(collection&&!productSeries(item).includes(collection))` в resolveMissingFrame;
   (б) точка вызова — renderBuilder обязан передать четвёртым аргументом
       `builderRoomFilter().collection`, а не null.

   ЧАСТЬ А — САМА ФУНКЦИЯ. Исполняем НАСТОЯЩИЙ текст findByExactCode/resolveMissingFrame из app.js
   в vm на НАСТОЯЩЕМ каталоге VIMAR:
     - артикул ЧУЖОЙ коллекции (14642.01 Plana в комнате Arke) → ветка коллекции с ДОСЛОВНЫМИ
       полями lead/code/name/note/reason из кода;
     - артикул СВОЕЙ коллекции (14931 живёт и в Arke) в комнате Arke → ветка коллекции НЕ
       срабатывает, разбор идёт дальше на число модулей: под свой размер даёт null, под чужой —
       подсказку про модули. Это же ловит подмену includes→равенство строк: 14931
       мультиколлекционна (Arke/Arke Fit/Eikon Evo/Eikon Exe/Plana), при равенстве строк её бы
       посчитали «чужой» коллекции.

   ЧАСТЬ Б — ПРОВОДКА. Исполняем НАСТОЯЩИЙ renderBuilder (пост без накладки → ранний выход после
   enhancePicker), перехватываем options.resolveMissing и зовём её артикулом чужой коллекции:
   вернуться обязана ветка коллекции, а не ветка модулей — значит renderBuilder передал реальную
   коллекцию комнаты, а не null.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     удалить ветку `if(collection&&!productSeries(item)...)` целиком        → краснеет А (чужой артикул) и Б;
     заменить includes(collection) на равенство строк в этой ветке          → краснеет А (14931 в Arke);
     в точке вызова передать null вместо builderRoomFilter().collection      → краснеет Б;
     проверять коллекцию только при совпавшей модульности                    → краснеет А (расходящиеся коллекция
       (frameSlotCount(item)===currentCount && collection && !...includes)      и модульность: 14642.01 Plana 2М при селекторе 3).
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
const seriesOf = p => (p && p.series) || [];

/* Разведка (числа заказчика): 14642.01 — накладка ТОЛЬКО коллекции Plana (чужая для комнаты Arke);
   14931 — накладка сразу в пяти коллекциях, среди них Arke (проверка «членство в множестве, а не
   равенство строк»). Обе на 2 модуля. */
const PLANA_ONLY = byCode("14642.01");
const ARKE_MULTI = byCode("14931");
/* 19953.01 — накладка коллекции РОВНО «Arke Fit» (одна серия, 3 модуля). «Arke Fit» — единственная
   в каталоге коллекция, чьё имя начинается с имени другой коллекции («Arke»): на этой паре
   членство-в-множестве отличимо от префиксного сравнения. Для комнаты «Arke» она ЧУЖАЯ, потому что
   «Arke» ≠ «Arke Fit», хотя «Arke Fit».indexOf("Arke")===0. */
const ARKE_FIT_ONLY = byCode("19953.01");
assert.ok(PLANA_ONLY && ARKE_MULTI, "предпосылка: 14642.01 и 14931 есть в каталоге");
assert.ok(ARKE_FIT_ONLY, "предпосылка: 19953.01 есть в каталоге");
assert.ok(seriesOf(PLANA_ONLY).includes("Plana") && !seriesOf(PLANA_ONLY).includes("Arke"),
  "предпосылка: 14642.01 — только Plana, для комнаты Arke чужая");
assert.ok(seriesOf(ARKE_MULTI).includes("Arke") && seriesOf(ARKE_MULTI).length > 1,
  "предпосылка: 14931 мультиколлекционна и включает Arke — на этом держится проверка includes vs ===");
/* Сравниваем по элементам, а не deepEqual: каталог исполняется в vm-песочнице (loadVimarCatalog),
   его массивы из другого realm — deepStrictEqual валит на несовпадении прототипа. Соседний код тоже
   работает с series через .join/индекс, а не deepEqual. */
assert.equal(seriesOf(ARKE_FIT_ONLY).length, 1, "предпосылка: 19953.01 — ровно одна коллекция");
assert.equal(seriesOf(ARKE_FIT_ONLY)[0], "Arke Fit", "предпосылка: эта коллекция — «Arke Fit»");
assert.ok(!seriesOf(ARKE_FIT_ONLY).includes("Arke"),
  "предпосылка: «Arke» — лишь ПРЕФИКС имени «Arke Fit», но НЕ его коллекция → для комнаты «Arke» накладка чужая");
assert.equal(EPCatalog.frameSlotCount(PLANA_ONLY), 2, "предпосылка: 14642.01 — 2 модуля");
assert.equal(EPCatalog.frameSlotCount(ARKE_MULTI), 2, "предпосылка: 14931 — 2 модуля");
assert.equal(EPCatalog.frameSlotCount(ARKE_FIT_ONLY), 3, "предпосылка: 19953.01 — 3 модуля");

/* --- ЧАСТЬ А: сама resolveMissingFrame ------------------------------------------------------- */
/* Контекст vm: findByExactCode/resolveMissingFrame настоящие; byKind даёт активные накладки,
   доменные хелперы настоящие. $/changePostSlotCount/toast нужны только внутри onAction (её здесь
   не вызываем) — ставим безопасные стабы, чтобы отсутствие имени не пряталось за ReferenceError. */
function makeFn() {
  const ctx = {
    byKind: kind => PRODUCTS.filter(x => x.kind === kind && x.active),
    productSeries: seriesOf,
    frameSlotCount: EPCatalog.frameSlotCount,
    moduleWord: EPCatalog.moduleWord,
    $: () => ({ value: "", dataset: {} }),
    changePostSlotCount: () => {},
    toast: () => {}
  };
  return stand.run(["findByExactCode", "resolveMissingFrame"], ctx);
}
const frameSelect = { dataset: {} };   // используется только в onAction (не исполняется)

test("E13-А: артикул ЧУЖОЙ коллекции (Plana в комнате Arke) — ветка коллекции с дословными полями", () => {
  const res = makeFn()(PLANA_ONLY.code, 2, frameSelect, "Arke");
  assert.ok(res, "чужой артикул обязан дать подсказку, а не null");
  // формулировки взяты ДОСЛОВНО из resolveMissingFrame — подмена текста в коде уронит тест
  assert.equal(res.lead, "Артикул есть в каталоге, но другой коллекции.");
  assert.equal(res.code, "14642.01");
  assert.equal(res.name, "Накладка для 2 модулей белая");
  assert.equal(res.note, "коллекция Plana");
  assert.equal(res.reason,
    "помещение закреплено за коллекцией «Arke», а эта накладка — коллекции «Plana». Сменить коллекцию можно в свойствах комнаты.");
  // именно ветка коллекции: у неё нет action «переключить размер» (в отличие от ветки модулей)
  assert.ok(!("actionLabel" in res), "ветка коллекции действия не даёт — это отличает её от ветки числа модулей");
});

test("E13-А: артикул СВОЕЙ коллекции (14931 в Arke) ветку коллекции НЕ включает — разбор идёт на число модулей", () => {
  const fn = makeFn();
  // свой размер (2) → подсказки нет вовсе: список и так показал бы эту накладку
  assert.equal(fn(ARKE_MULTI.code, 2, frameSelect, "Arke"), null,
    "накладка своей коллекции и своего размера скрытой не считается — null (при === её сочли бы чужой и вернули ветку коллекции)");
  // чужой размер (3) → подсказка ПРО МОДУЛИ, не про коллекцию: доказывает, что ветку коллекции проскочили
  const res = fn(ARKE_MULTI.code, 3, frameSelect, "Arke");
  assert.ok(res, "под чужой размер подсказка есть");
  assert.equal(res.lead, "Артикул есть в каталоге, но скрыт фильтром по числу модулей.",
    "коллекция своя → разбор дошёл до числа модулей, а не остановился на коллекции");
  assert.equal(res.note, EPCatalog.moduleWord(2), "подсказка называет реальную модульность накладки (2)");
});

test("E13-А: МУЛЬТИКОЛЛЕКЦИОННАЯ накладка (14931, 5 коллекций) — note/reason перечисляют ВСЕ её коллекции, не первую", () => {
  // Находка 3 (3-й состязательный проход): note/reason печатают productSeries(item).join(", ").
  // Прежний кейс части А брал 14642.01 (PLANA_ONLY) — РОВНО одна коллекция, срез, где join(", ") и
  // [0] неразличимы. 14931 живёт в пяти коллекциях; комната «Eikon Tactil» — реальная коллекция
  // каталога, но НЕ входит в эти пять, поэтому ветка коллекции срабатывает, а текст обязан назвать
  // все пять серий: усечение до первой («коллекция Arke») повело бы человека менять комнату на Arke,
  // хотя накладка подошла бы и Arke Fit / Eikon Evo / Eikon Exe / Plana. Мутант productSeries(item)[0]
  // здесь краснеет, срез с одной коллекцией — не ловил.
  assert.ok(!seriesOf(ARKE_MULTI).includes("Eikon Tactil"),
    "предпосылка: «Eikon Tactil» — чужая для 14931 коллекция (её нет в пяти сериях), ветка коллекции сработает");
  const allSeries = "Arke, Arke Fit, Eikon Evo, Eikon Exe, Plana";
  assert.equal(seriesOf(ARKE_MULTI).join(", "), allSeries,
    "предпосылка: у 14931 ровно эти пять коллекций в этом порядке — на них держится дословный текст");
  const res = makeFn()(ARKE_MULTI.code, 2, frameSelect, "Eikon Tactil");
  assert.ok(res, "накладка чужой для комнаты коллекции обязана дать подсказку");
  assert.equal(res.lead, "Артикул есть в каталоге, но другой коллекции.");
  assert.equal(res.code, "14931");
  // note/reason — дословно из resolveMissingFrame: перечислены ВСЕ пять коллекций, а не первая
  assert.equal(res.note, `коллекция ${allSeries}`,
    "note называет ВСЕ коллекции накладки (join), а не первую ([0]) — иначе совет «сменить коллекцию» ведёт не туда");
  assert.equal(res.reason,
    `помещение закреплено за коллекцией «Eikon Tactil», а эта накладка — коллекции «${allSeries}». Сменить коллекцию можно в свойствах комнаты.`,
    "reason перечисляет все пять коллекций — усечённый список (мутант [0]) уронит эту проверку");
});

test("E13-А: РАСХОДЯЩИЕСЯ коллекция и модульность (Plana 2М, селектор 3) — коллекция побеждает число модулей", () => {
  // 14642.01 в комнате Arke при выбранных 3 модулях: причин отсева ДВЕ сразу — чужая коллекция (Plana)
  // И чужая модульность (2 при выбранных 3). Правило app.js:153-155: коллекцию проверяем РАНЬШЕ числа
  // модулей, поэтому подсказка обязана быть про коллекцию. Прежние кейсы части А брали count=2 (свой
  // размер), где порядок двух проверок не наблюдаем. Мутант «проверять коллекцию только при совпавшей
  // модульности» здесь проскочил бы ветку коллекции (2≠3) и вернул ветку модулей с кнопкой «Переключить
  // на 2 модуля», ведущей на накладку ЧУЖОЙ коллекции — ровно то, что правило запрещает.
  assert.notEqual(EPCatalog.frameSlotCount(PLANA_ONLY), 3,
    "предпосылка: модульность 14642.01 НЕ 3 — расходится с выбранной, обе причины отсева налицо");
  const res = makeFn()(PLANA_ONLY.code, 3, frameSelect, "Arke");
  assert.ok(res, "чужой артикул обязан дать подсказку, а не null");
  assert.equal(res.lead, "Артикул есть в каталоге, но другой коллекции.",
    "коллекция проверяется РАНЬШЕ числа модулей — подсказка про коллекцию, хотя и размер не совпал");
  assert.equal(res.note, "коллекция Plana", "названа коллекция накладки, а не её число модулей");
  assert.ok(!("actionLabel" in res),
    "ветка коллекции действия не даёт — кнопки «Переключить на 2 модуля» на чужую коллекцию быть не должно");
});

test("E13-А: ПРЕФИКСНЫЙ СОСЕД (Arke Fit в комнате Arke) — членство в множестве, а не префикс", () => {
  // Пункт 1 (раунд 4): resolveMissingFrame сравнивает коллекцию через productSeries(item).includes(collection).
  // Прежние кейсы части А брали 14642.01/14931, где имя коллекции комнаты не является ПРЕФИКСОМ имени серии
  // накладки, поэтому мутация includes→some(x=>x.indexOf(collection)===0) оставалась зелёной. «Arke Fit» —
  // единственная коллекция каталога, чьё имя начинается с имени другой («Arke»). 19953.01 живёт РОВНО в
  // «Arke Fit»; для комнаты «Arke» она чужая, и подсказка про коллекцию ОБЯЗАНА появиться. Мутант-префикс
  // счёл бы «Arke Fit» начинающейся с «Arke» → «своя» → ветку коллекции проскочил бы, а по числу модулей
  // (3===3, выбран как раз 3) вернул бы null: список молча пуст, ни слова человеку — хуже смещения отбора.
  const res = makeFn()(ARKE_FIT_ONLY.code, 3, frameSelect, "Arke");
  assert.ok(res, "накладка «Arke Fit» для комнаты «Arke» чужая — подсказка обязана быть, а не null (мутант-префикс даёт null)");
  assert.equal(res.lead, "Артикул есть в каталоге, но другой коллекции.",
    "сработала ветка коллекции: «Arke» ≠ «Arke Fit», хотя одно префикс другого");
  assert.equal(res.code, "19953.01");
  assert.equal(res.note, "коллекция Arke Fit",
    "подсказка называет ИМЕННО «Arke Fit» — при префиксном сравнении её сочли бы своей и не назвали бы");
  assert.ok(!("actionLabel" in res), "ветка коллекции действия не даёт — это отличает её от ветки числа модулей");
});

test("E13-А: коллекция комнаты НЕ ЗАДАНА (проект до E13, collection=null) — работает разбор по числу модулей", () => {
  // Пункт 4 (раунд 4): у ветки коллекции есть нижняя граница — guard `collection&&`. Проект, сохранённый до
  // E13, не имеет поля collection у комнаты → сюда приходит collection===null. Прежние кейсы части А всегда
  // передавали реальную коллекцию, а нижнюю границу никто не проверял (§7.1: граница есть сверху, нет снизу).
  // Снятие guard (`if(!productSeries(item).includes(null))`) включило бы ветку коллекции всегда: человеку из
  // старого проекта показали бы «помещение закреплено за коллекцией «null»» и отняли бы кнопку «Переключить».
  const res = makeFn()(PLANA_ONLY.code, 3, frameSelect, null);
  assert.ok(res, "артикул отсеян по числу модулей (2 при выбранных 3) — подсказка есть");
  assert.equal(res.lead, "Артикул есть в каталоге, но скрыт фильтром по числу модулей.",
    "коллекции нет (null) → ветка коллекции НЕ срабатывает, разбор доходит до числа модулей (мутант без guard дал бы ветку коллекции с «null»)");
  assert.equal(res.note, EPCatalog.moduleWord(2), "названа реальная модульность накладки (2), а не «коллекция «null»»");
  assert.equal(res.actionLabel, `Переключить на ${EPCatalog.moduleWord(2)}`,
    "ветка модулей даёт кнопку «Переключить» — при снятии guard она бы исчезла");
});

test("E13-А: несуществующего артикула нет — null (findByExactCode ничего не нашёл)", () => {
  assert.equal(makeFn()("нет-такого-артикула", 2, frameSelect, "Arke"), null,
    "по несуществующему артикулу подсказки быть не может");
});

/* --- ЧАСТЬ Б: проводка resolveMissing из renderBuilder --------------------------------------- */
/* Контекст vm для renderBuilder (по образцу roomCollectionSlotCountWiring): всё, кроме нужного
   пути, — безопасные стабы; resolveMissingFrame/findByExactCode НЕ заглушаем — их и проверяем
   (даём настоящими через CUT). enhancePicker перехватываем, чтобы забрать ПЕРЕДАННУЮ функцию
   resolveMissing и вызвать её артикулом чужой коллекции. Пост открываем БЕЗ накладки
   (preferredFrameId="") → renderBuilder зовёт enhancePicker и выходит ранним return. */
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
    // перехват: забираем options.resolveMissing, отрисовку списка не трогаем
    enhancePicker: (sel, options) => { captured.options = options; },
    changePostSlotCount: () => {}, toast: () => {},
    mechanismModulesTotal: () => 0,
    assembledPostHtml: () => "",
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    renderBuilderSlots: () => {}, lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    builderErrorHtml: () => "", renderBuilderCatalog: () => {}, renderBuilderComposition: () => {},
    builderCtx: {}
  };
}
/* resolveMissingFrame/findByExactCode идут ПЕРВЫМИ в CUT — настоящими, а не стабом: именно их
   проводку проверяем. Остальные — как в соседних builder-стендах. */
const BUILDER_CUT = ["findByExactCode", "resolveMissingFrame", "frameCollectionList", "builderRoomFilter",
  "collectionFramePool", "frameOptions", "builderCapacity", "renderBuilder"];

/* Открыть renderBuilder для поста БЕЗ накладки в комнате коллекции; вернуть перехваченную
   resolveMissing и число модулей в селекторе. */
function resolveMissingFrom({ collection, count }) {
  const post = { id: "p1", roomId: "r1", mechanismIds: [] };
  const state = {
    products: PRODUCTS,
    posts: [post],
    rooms: [{ id: "r1", name: "Комната", collection }],
    builder: { slots: [], target: { mode: "add" }, editingPlacedId: "p1" }
  };
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  dom.$("postFrameSelect").dataset.preferredFrameId = "";   // пустая накладка → ранний выход после enhancePicker
  dom.$("postSlotCount").value = String(count);
  const captured = {};
  const ctx = builderCtx(state, dom, captured);
  const render = stand.run(BUILDER_CUT, ctx);
  render();
  assert.equal(typeof captured.options, "object", "enhancePicker должен быть вызван renderBuilder");
  assert.equal(typeof captured.options.resolveMissing, "function", "resolveMissing обязан быть функцией");
  return captured.options.resolveMissing;
}

test("E13-Б: renderBuilder передаёт resolveMissing коллекцию комнаты — чужой артикул даёт ветку коллекции", () => {
  // комната Arke, count=2 (свой размер 14642.01): если бы передавали null, ветка коллекции не сработала бы,
  // а по числу модулей 2===2 вернулся бы null — значит результат ветки коллекции доказывает передачу коллекции
  const resolveMissing = resolveMissingFrom({ collection: "Arke", count: 2 });
  const res = resolveMissing(PLANA_ONLY.code);
  assert.ok(res, "resolveMissing по чужому артикулу обязан дать подсказку, а не null");
  assert.equal(res.lead, "Артикул есть в каталоге, но другой коллекции.",
    "renderBuilder передал реальную коллекцию комнаты (Arke), а не null — иначе ветка коллекции не сработала бы");
  assert.equal(res.note, "коллекция Plana", "подсказка называет коллекцию найденной накладки");
});
