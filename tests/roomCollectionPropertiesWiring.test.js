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
     подпись всегда «Коллекция не задана…» (текст не ветвится)  → красит «§1-подпись КОЛЛЕКЦИЯ ЗАДАНА» (текст);
     класс own не ставится никогда (roomColl?" own":"" → "")   → красит «§1-подпись КОЛЛЕКЦИЯ ЗАДАНА» (own);
     frameCollectionList()→[] в app.js                         → красит §1 (опций 0, не 9; попутно
                                                                  падает и «§2 selected на действующей» —
                                                                  без опций «Plana» не выбрать);
     const roomColl=r.collection (без EPRoom.roomCollection)    → красит §2 (мёртвая коллекция снимает «Не задана»);
     onchange: r.collection=val всегда (убрать else delete)     → красит §3 (пустое пишет "", поле не удалено);
     убрать renderProperties() из onchange                     → красит §6 (rerender.calls===0);
     убрать persistProject() из onchange                       → красит §4 (persistProject.calls===0);
     добавить renderSummary()/renderAll() в onchange           → красит §5 (renderSummary/all вызваны);
     onchange пишет в state.rooms[0] вместо r (и delete rooms[0]) → красит §7-комната (запись/снятие
                                                                  ушли в первую комнату, выделенная пуста);
     текст пункта «Не задана…» заменён (value тот же)          → красит §7-текст-пункта (opts[0].text);
     подпись поля «Коллекция накладок» заменена на «Серия»     → красит §7-подпись-поля (label поля);
     убрать esc() в опциях коллекций                           → красит §7-esc (сырое <b> в разметке).
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
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

/* НАСТОЯЩИЙ esc из js/app.js — вырезаем его ИСХОДНЫЙ ТЕКСТ общим стендом (constSource) и исполняем,
   а НЕ держим рукописную копию. Копия расходилась с продакшеном молча: любое ослабление настоящего
   esc в app.js не краснило ни один тест, потому что §7-esc сверялся с копией, а не с кодом. esc
   самодостаточен (внешних имён не берёт), поэтому исполняем его в пустом vm-контексте. Нужен там,
   где тест доказывает ЭКРАНИРОВАНИЕ имени коллекции; в остальных тестах esc=String достаточно —
   их тексты спецсимволов не несут, и String находку не маскирует. */
const escHtml = vm.runInNewContext(stand.constSource("esc") + "\n;esc;", {});

/* Исполнить НАСТОЯЩИЙ renderProperties на комнате room и вернуть {props, dom, spies} для проверок.
   Вырезаем ВМЕСТЕ настоящий frameCollectionList — он строит список коллекций сам:
   productCollections(byKind("frame")). Поэтому в ctx кладём не готовый список, а лексику, из
   которой frameCollectionList его выводит: byKind (фильтр kind+active по state.products, как в
   app.js) и настоящий EPCatalog. Так §1 проверяет продакшн-построение опций, а не то, что тест сам
   же подсунул готовым. Порядок в CUT — по зависимостям (frameCollectionList → renderProperties),
   как в tests/builderRoomFilterCollectionWiring.test.js. */
function renderRoom(room, opts) {
  opts = opts || {};
  /* ДВЕ комнаты, выделена ВТОРАЯ (room). Первая — приманка decoy, по умолчанию БЕЗ коллекции.
     Так «пишем в выделенную» и «пишем в первую» становятся различимы: мутация onchange
     (r.collection → state.rooms[0].collection) уводит запись в decoy — §7 это ловит с обеих
     сторон. opts.firstRoom позволяет §7-снятие дать приманке свою коллекцию и доказать, что
     delete НЕ бьёт по первой. opts.products/opts.esc — для теста экранирования (свой каталог с
     опасным именем и настоящий esc). */
  const products = opts.products || PRODUCTS;
  const decoy = opts.firstRoom || { id: "r0", name: "Кухня", area: "", polygon: null };
  const state = { selected: { kind: "room", id: room.id }, rooms: [decoy, room], posts: [], products, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomCollectionSelect", "roomSchemeSelect"] });
  const props = stand.makeElement();
  const spies = { persistProject: spy(), renderSummary: spy(), renderAll: spy() };
  const ctx = {
    state, props, $: dom.$, esc: opts.esc || String,
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
  return { props, dom, spies, ctx, state, decoy };
}

/* Опции селектора коллекций из отрисованного innerHTML: value + флаг selected + видимый текст.
   text нужен для §7-текст-пункта (подмена «Не задана…» не меняет value, только надпись) и для
   §7-esc (доказать, что опасное имя в теле опции экранировано). */
function collectionOptions(props) {
  const m = props.innerHTML.match(/<select id="roomCollectionSelect">([\s\S]*?)<\/select>/);
  assert.ok(m, "селектор #roomCollectionSelect должен присутствовать в панели свойств комнаты");
  return [...m[1].matchAll(/<option value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/g)]
    .map(o => ({ value: o[1], selected: /selected/.test(o[2]), text: o[3] }));
}

/* Подпись поля-обёртки <label class="room-collection-field">…<select…>: текст, который заказчик
   читает над селектором. Подмена «Коллекция накладок»→«Серия» value не трогает — держим текстом. */
function collectionFieldLabel(props) {
  const m = props.innerHTML.match(/<label class="room-collection-field">([^<]*)<select/);
  assert.ok(m, "поле «Коллекция накладок» (label.room-collection-field) должно присутствовать");
  return m[1];
}

/* Подпись <small class="prop-hint prop-collection-source [own]">…</small> под селектором: {own, text}.
   own — стоит ли класс-модификатор own (визуально помечает «коллекция задана»); text — что читает
   заказчик. Разбираем оба поля отдельно: мутации метят и класс, и текст независимо. */
function collectionHint(props) {
  const m = props.innerHTML.match(/<small class="prop-hint prop-collection-source([^"]*)">([^<]*)<\/small>/);
  assert.ok(m, "подпись .prop-collection-source должна присутствовать под селектором коллекции");
  return { own: /\bown\b/.test(m[1]), text: m[2] };
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

test("§1-подпись КОЛЛЕКЦИЯ ЗАДАНА: текст «предлагает накладки только этой коллекции» + класс own", () => {
  /* Подпись под селектором — единственное, что объясняет заказчику, работает ли фильтр. До этого
     теста её не держало ничто (grep prop-collection-source tests/ → 0): текст можно было замкнуть на
     «не задана», а класс own убрать — оба варианта проходили зелёными. */
  const { props } = renderRoom({ id: "r1", name: "Кухня", area: "", polygon: null, collection: "Plana" });
  const hint = collectionHint(props);
  assert.equal(hint.text, "Конструктор поста в этой комнате предлагает накладки только этой коллекции",
    "при заданной коллекции подпись сообщает о сужении списка — иначе заказчик не поймёт, что фильтр включён");
  assert.ok(hint.own, "класс own стоит — визуальная пометка «коллекция задана» (мутация «own никогда» краснеет здесь)");
});

test("§1-подпись КОЛЛЕКЦИЯ НЕ ЗАДАНА: текст «предлагаются все накладки каталога», без класса own", () => {
  const { props } = renderRoom({ id: "r1", name: "Кухня", area: "", polygon: null });
  const hint = collectionHint(props);
  assert.equal(hint.text, "Коллекция не задана — предлагаются все накладки каталога",
    "без коллекции подпись честно говорит, что фильтра нет");
  assert.ok(!hint.own, "класс own НЕ стоит — коллекция не задана");
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

test("§7-текст-пункта: первый пункт селектора читается «Не задана — предлагать все накладки»", () => {
  /* §1 держит только ЗНАЧЕНИЕ первого пункта (value===""), а надпись — нет: её можно было
     замкнуть на «Коллекция», и заказчик перестал бы понимать, что пустой выбор = фильтра нет.
     Текст, который читает заказчик, покрываем явно (тот же довод, что для prop-collection-source). */
  const { props } = renderRoom({ id: "r1", name: "Кухня", area: "", polygon: null });
  const opts = collectionOptions(props);
  assert.equal(opts[0].text, "Не задана — предлагать все накладки",
    "первый пункт объясняет, что без коллекции предлагаются все накладки, — не безликая надпись");
});

test("§7-подпись-поля: поле над селектором подписано «Коллекция накладок»", () => {
  /* Подпись поля отличает «коллекцию накладок» от «серии»/«цвета» (E14 ляжет рядом). Её можно было
     переименовать молча — §1–§6 держат опции и обработчик, но не заголовок поля. Покрываем текстом. */
  const { props } = renderRoom({ id: "r1", name: "Кухня", area: "", polygon: null });
  assert.equal(collectionFieldLabel(props), "Коллекция накладок",
    "поле подписано «Коллекция накладок» — заказчик видит, что задаёт именно накладки");
});

test("§7-esc: имя коллекции из каталога ЭКРАНИРУЕТСЯ в опциях, а не вставляется сырым", () => {
  /* Название коллекции приходит из каталога (productSeries → productCollections), а прайс
     перезаливает заказчик — опасные символы в серии не должны пролезть в разметку сырыми.
     Подаём каталог из одной накладки с series=['A"><b>&'] и НАСТОЯЩИЙ esc; опция обязана нести
     экранированное имя и в value, и в теле. С esc=String (как в прочих тестах) находку не поймать —
     поэтому здесь esc реальный. */
  const danger = 'A"><b>&';
  const frame = { id: "fx", kind: "frame", active: true, series: [danger] };
  const { props } = renderRoom(
    { id: "r1", name: "Кухня", area: "", polygon: null },
    { products: [frame], esc: escHtml }
  );
  const opts = collectionOptions(props);
  const opt = opts.find(o => o.value.indexOf("&amp;") !== -1);
  assert.ok(opt, "опция опасной коллекции присутствует (value распарсился — значит кавычка экранирована)");
  assert.equal(opt.value, "A&quot;&gt;&lt;b&gt;&amp;", "value опции экранирован полностью");
  assert.equal(opt.text, "A&quot;&gt;&lt;b&gt;&amp;", "видимый текст опции экранирован полностью");
  /* Проверяем по САМОЙ опасной строке, а не по «<b>»: тег <b> легитимно есть в блоке оборудования
     (<b>0</b>), а вот сырое имя коллекции A"><b>& в разметке появиться не должно. */
  assert.ok(props.innerHTML.indexOf(danger) === -1,
    "сырого имени коллекции A\"><b>& в разметке нет — оно не вставлено как HTML (мутация «убрать esc» краснеет здесь)");
});

test("§7-комната: запись и снятие коллекции бьют по ВЫДЕЛЕННОЙ комнате, не по первой", () => {
  /* Обработчик пишет в r (выделенная комната), а не в state.rooms[0]. С одной комнатой эти две
     мишени неразличимы; берём ДВЕ, выделяем ВТОРУЮ («Кабинет»), первой («Кухня») даём свою
     коллекцию — и проверяем ОБЕ стороны: выбор оседает в выделенной, а соседнюю не трогает; снятие
     тоже бьёт по выделенной, а первую не обнуляет. */
  const kitchen = { id: "r0", name: "Кухня", area: "", polygon: null, collection: "Eikon Evo" };
  const cabinet = { id: "r2", name: "Кабинет", area: "", polygon: null };
  const { dom, state } = renderRoom(cabinet, { firstRoom: kitchen });
  const select = dom.els.roomCollectionSelect;

  // запись: «Plana» уходит в выделенный «Кабинет», «Кухня» не тронута
  select.onchange({ target: { value: "Plana" } });
  assert.equal(cabinet.collection, "Plana", "коллекция записана в ВЫДЕЛЕННУЮ комнату (Кабинет)");
  assert.equal(state.rooms[0].collection, "Eikon Evo",
    "коллекция первой комнаты (Кухня) НЕ изменилась — запись не ушла в чужую комнату");

  // снятие: delete бьёт по «Кабинету», «Кухня» сохраняет свою коллекцию
  select.onchange({ target: { value: "" } });
  assert.ok(!("collection" in cabinet), "«Не задана» сняла коллекцию у ВЫДЕЛЕННОЙ комнаты (Кабинет)");
  assert.equal(state.rooms[0].collection, "Eikon Evo",
    "коллекция первой комнаты (Кухня) уцелела — delete не ушёл в чужую комнату");
});
