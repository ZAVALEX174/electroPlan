/* ПОВЕДЕНЧЕСКИЙ регресс E13: селектор «Коллекция накладок» в панели свойств комнаты
   (ветка комнаты в js/app.js renderProperties) — ЕДИНСТВЕННОЕ место, где человек вообще задаёт
   коллекцию помещения. До этого теста его не держало ничто (grep "roomCollectionSelect" tests/ → 0).

   ЗАЧЕМ ПОВЕДЕНЧЕСКИ, А НЕ ПО ТЕКСТУ. app.js — монолит-оркестратор (state + DOM), в node не
   грузится; связки дают почти все дефекты (§7.1 HANDOFF). Вырезаем НАСТОЯЩИЙ текст
   renderProperties ВМЕСТЕ с настоящим frameCollectionList общим стендом (tests/helpers/appStand.js)
   и исполняем в vm на НАСТОЯЩЕМ каталоге VIMAR: список коллекций, разметку опций и обработчик
   onchange строит продакшн-код, а не копия. frameCollectionList не подсовываем готовым списком —
   иначе §1 проверял бы то, что тест сам же передал (тавтология §7.1); вместо этого в ctx кладём его
   лексику: byKind (фильтр kind+active по state.products, как в app.js) и настоящий EPCatalog, из
   которых продакшн-функция сама выводит productCollections(byKind("frame")). Всё лишнее
   (getObjectsInRoom, roomAutoAreaText, polygonAreaPx, lightingScheme,
   flushRoomDraft, setTool, findSelectedEntity, persistProject, renderSummary, renderAll) —
   шпионы/заглушки: коллекция от них не зависит, а persist/summary/all нужны, чтобы проверить,
   ЧТО обработчик зовёт, а что нет.

   ЧТО ЗАФИКСИРОВАНО:
   1) опции строятся из каталога (frameCollectionList → productCollections), а не константой в
      разметке: ровно 9 коллекций каталога плюс пункт «Не задана»;
   2) selected стоит на действующей коллекции комнаты; у комнаты с МЁРТВОЙ коллекцией (значения
      нет в каталоге) selected остаётся на «Не задана», а r.collection при этом НЕ затирается —
      валидация EPRoom.roomCollection не портит данные проекта молча;
   3) обработчик пишет выбранную коллекцию в комнату, пустое значение УДАЛЯЕТ поле (delete),
      а не пишет пустую строку;
   4) выбор коллекции сохраняет проект (persistProject вызван);
   5) ⚠️ и НЕ зовёт renderSummary/renderAll — коллекция это фильтр каталога, а не денежная
      настройка; состав и цена существующих постов от неё не зависят. Этот assert удерживает
      осознанное решение в коде: кто-нибудь «на всякий случай» добавит пересчёт сметы — тест
      покраснеет.
   6) выбор коллекции ПЕРЕРИСОВЫВАЕТ панель свойств (renderProperties вызван) — именно перерисовка
      показывает человеку результат: подпись «задана/не задана» под селектором и selected.
      renderProperties при исполнении в vm ложится свойством контекста, а onchange зовёт её как
      свободное имя — переопределив свойство, перехватываем вызов, не ломая саму перерисовку.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено, см. отчёт; §3–6 — асёрты одного теста «§3–6 onchange…»):
     frameCollectionList()→[] в app.js                         → красит §1 (опций 0, не 9; попутно
                                                                  падает и «§2 selected на действующей» —
                                                                  без опций «Plana» не выбрать);
     const roomColl=r.collection (без EPRoom.roomCollection)    → красит §2 (мёртвая коллекция снимает «Не задана»);
     onchange: r.collection=val всегда (убрать else delete)     → красит §3 (пустое пишет "", поле не удалено);
     убрать renderProperties() из onchange                     → красит §6 (rerender.calls===0);
     убрать persistProject() из onchange                       → красит §4 (persistProject.calls===0);
     добавить renderSummary()/renderAll() в onchange           → красит §5 (renderSummary/all вызваны).
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPRoom = require("../js/room.js");
const EPCatalog = require("../js/catalog.js");
const EPLightingGroups = require("../js/lightingGroups.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const activeFrames = PRODUCTS.filter(x => x.kind === "frame" && x.active);
/* Разведка каталога (замерено на js/catalog-vimar.js): 9 коллекций накладок по алфавиту.
   Число НЕ хардкодим ниже в assert — берём длину CATALOG_COLLECTIONS, чтобы перезалив прайса
   заказчиком уронил тест осмысленно, а не подогнанной константой. */
const CATALOG_COLLECTIONS = EPCatalog.productCollections(activeFrames);
assert.deepEqual(
  CATALOG_COLLECTIONS,
  ["Arke", "Arke Fit", "Eikon Evo", "Eikon Exe", "Eikon Flat", "Eikon Tactil", "Eikon Vintage", "Neve Up", "Plana"],
  "предпосылка: в каталоге ровно 9 коллекций накладок по алфавиту"
);

const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };

/* Исполнить НАСТОЯЩИЙ renderProperties на комнате room и вернуть {props, dom, spies} для проверок.
   Вырезаем ВМЕСТЕ настоящий frameCollectionList — он строит список коллекций сам:
   productCollections(byKind("frame")). Поэтому в ctx кладём не готовый список, а лексику, из
   которой frameCollectionList его выводит: byKind (фильтр kind+active по state.products, как в
   app.js) и настоящий EPCatalog. Так §1 проверяет продакшн-построение опций, а не то, что тест сам
   же подсунул готовым. Порядок в CUT — по зависимостям (frameCollectionList → renderProperties),
   как в tests/builderRoomFilterCollectionWiring.test.js. */
function renderRoom(room) {
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomCollectionSelect", "roomSchemeSelect"] });
  const props = stand.makeElement();
  const spies = { persistProject: spy(), renderSummary: spy(), renderAll: spy() };
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    flushRoomDraft: spy(),
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(),
    getObjectsInRoom: () => [],
    roomAutoAreaText: () => "",
    polygonAreaPx: () => 0,
    lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog,
    setTool: spy(),
    persistProject: spies.persistProject,
    renderSummary: spies.renderSummary,
    renderAll: spies.renderAll,
    mountedRoomId: null
  };
  const render = stand.run(["frameCollectionList", "renderProperties"], ctx);
  render();
  /* ctx возвращаем, чтобы §3–5 мог обернуть renderProperties шпионом: объявление функции при
     исполнении в vm стало свойством контекста (ctx.renderProperties), а обработчик onchange зовёт
     её как свободное имя — переопределив свойство, ловим её вызов, не ломая перерисовку. */
  return { props, dom, spies, ctx };
}

/* Опции селектора коллекций из отрисованного innerHTML: value + флаг selected. */
function collectionOptions(props) {
  const m = props.innerHTML.match(/<select id="roomCollectionSelect">([\s\S]*?)<\/select>/);
  assert.ok(m, "селектор #roomCollectionSelect должен присутствовать в панели свойств комнаты");
  return [...m[1].matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(o => ({ value: o[1], selected: /selected/.test(o[2]) }));
}

test("§1 опции коллекций строятся из каталога: пункт «Не задана» + ровно 9 коллекций каталога", () => {
  const { props } = renderRoom({ id: "r1", name: "Кухня", area: "", polygon: null });
  const opts = collectionOptions(props);
  assert.equal(opts[0].value, "", "первый пункт — «Не задана» (пустое значение)");
  const named = opts.slice(1).map(o => o.value);
  assert.deepEqual(named, CATALOG_COLLECTIONS,
    "коллекции берутся из frameCollectionList (каталог), а не из константы в разметке — порядок и состав те же 9");
});

test("§2 selected на действующей коллекции комнаты", () => {
  const { props } = renderRoom({ id: "r1", name: "Кухня", area: "", polygon: null, collection: "Plana" });
  const opts = collectionOptions(props);
  const sel = opts.filter(o => o.selected);
  assert.equal(sel.length, 1, "выбрана ровно одна опция");
  assert.equal(sel[0].value, "Plana", "selected стоит на действующей коллекции комнаты");
});

test("§2 МЁРТВАЯ коллекция: selected на «Не задана», r.collection НЕ затирается валидацией", () => {
  const room = { id: "r1", name: "Кухня", area: "", polygon: null, collection: "Несуществующая" };
  const { props } = renderRoom(room);
  const opts = collectionOptions(props);
  assert.ok(opts[0].selected, "«Не задана» получает selected, когда коллекция комнаты отсутствует в каталоге");
  assert.ok(!opts.slice(1).some(o => o.selected), "ни одна коллекция каталога не выбрана — совпадения нет");
  assert.equal(room.collection, "Несуществующая",
    "⚠️ рендер НЕ трогает r.collection: валидация EPRoom.roomCollection лишь показывает «Не задана», данные проекта не портит");
});

test("§3–6 onchange: пишет коллекцию, пустое УДАЛЯЕТ поле, ПЕРЕРИСОВЫВАЕТ панель, зовёт persistProject, но не summary/all", () => {
  const room = { id: "r1", name: "Кухня", area: "", polygon: null, collection: "Arke" };
  const { dom, spies, ctx } = renderRoom(room);
  const select = dom.els.roomCollectionSelect;
  assert.equal(typeof select.onchange, "function", "на #roomCollectionSelect навешен обработчик change");

  /* §6: шпион на renderProperties. Объявление функции при исполнении в vm легло свойством ctx;
     обработчик onchange зовёт её как свободное имя, поэтому переопределение ctx.renderProperties
     перехватывает вызов (перерисовка внутри всё равно идёт — обёртка зовёт настоящую). */
  assert.equal(typeof ctx.renderProperties, "function", "renderProperties доступна как свойство vm-контекста");
  const realRenderProperties = ctx.renderProperties;
  const rerender = spy();
  ctx.renderProperties = function () { rerender(); return realRenderProperties.apply(this, arguments); };

  // §3: выбор коллекции пишет её в комнату
  select.onchange({ target: { value: "Plana" } });
  assert.equal(room.collection, "Plana", "выбранная коллекция записана в комнату");
  // §6: выбор перерисовывает панель — без этого подпись «задана/не задана» и selected остаются протухшими
  assert.equal(rerender.calls, 1, "renderProperties вызван — иначе выбор коллекции не отразится в панели свойств");
  // §4: выбор сохраняет проект
  assert.equal(spies.persistProject.calls, 1, "persistProject вызван — иначе выбор пропадёт при перезагрузке");
  // §5: коллекция не денежная — смета/холст не пересчитываются
  assert.equal(spies.renderSummary.calls, 0, "renderSummary НЕ вызван: коллекция не меняет сумму");
  assert.equal(spies.renderAll.calls, 0, "renderAll НЕ вызван: коллекция не меняет холст");

  // §3: пустое значение УДАЛЯЕТ поле (delete), а не пишет пустую строку
  select.onchange({ target: { value: "" } });
  assert.ok(!("collection" in room), "«Не задана» удаляет поле collection, а не оставляет пустую строку");
  // §6: снятие коллекции тоже перерисовывает панель
  assert.equal(rerender.calls, 2, "снятие коллекции тоже перерисовывает панель свойств");
  assert.equal(spies.persistProject.calls, 2, "снятие коллекции тоже сохраняется");
  assert.equal(spies.renderSummary.calls, 0, "снятие коллекции тоже не трогает смету");
  assert.equal(spies.renderAll.calls, 0, "снятие коллекции тоже не трогает холст");
});
