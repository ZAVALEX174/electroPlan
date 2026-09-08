/* ПОВЕДЕНЧЕСКИЙ регресс E13 (находка 6): «каждое открытие с чистого выбора» починено в state и НЕ
   починено в DOM. Поиск конструктора живёт в ДВУХ местах: state.builder.query И значение
   <input id="builderSearch"> (его пишет обработчик oninput). open-14 сбрасывает только query и
   ассертит только его; строка $("builderSearch").value="" в openPostBuilder не покрыта ничем.
   Вход дефекта: человек искал «выключатель», закрыл окно, открыл пост заново — в поле висит
   «выключатель», а каталог показан целиком. Рассинхрон, которого open-14 не видит.
   Попутно не покрыт и показ модалки: $("postModal").classList.add("open") можно удалить, окно не
   откроется, и все тесты пройдут. Держим обе строки ПОВЕДЕНЧЕСКИ, своим файлом (open-14 не трогаем).

   ЗАЧЕМ ПОВЕДЕНЧЕСКИ. app.js — монолит-оркестратор, в node не грузится; связки дают почти все
   дефекты (§7.1 HANDOFF). Вырезаем НАСТОЯЩИЙ текст openPostBuilder общим стендом
   (tests/helpers/appStand.js) и исполняем в vm на НАСТОЯЩЕМ каталоге VIMAR — тем же способом, что и
   openPostBuilderCollectionWiring. Проверяемые строки (очистка DOM-поля, показ модалки) — настоящие;
   постороннее (селектор модульностей, снимок, focus) — безопасные стабы либо настоящие зависимости.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено, см. отчёт):
     удаление $("builderSearch").value="" → красит open-searchclear (DOM-поле поиска сохраняет
       «выключатель» прошлого сеанса, хотя каталог показан целиком — рассинхрон query и поля).
     удаление $("postModal").classList.add("open") → красит open-modalshow (окно не открывается).
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPRoom = require("../js/room.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));

/* НАСТОЯЩИЕ mechanismModulesTotal и keySlotKind из app.js (const-стрелки, functionSource их не берёт).
   openPostBuilder замыкается на них при вычислении ёмкости и миграции групп — стаб исказил бы прогон.
   Исполняем исходный текст, а не рукописную копию. */
const mechanismModulesTotal = vm.runInNewContext(
  stand.constSource("mechanismModulesTotal") + "\n;mechanismModulesTotal;",
  { mechanismSpan: EPCatalog.mechanismSpan, product }
);
const isKeyProduct = vm.runInNewContext(stand.constSource("isKeyProduct") + "\n;isKeyProduct;", {});
const keySlotKind = vm.runInNewContext(
  stand.constSource("keySlotKind") + "\n;keySlotKind;",
  { product, isKeyProduct }
);

const activeFrames = PRODUCTS.filter(x => x.kind === "frame" && x.active);
const ET_POOL = activeFrames.filter(f => (f.series || []).includes("Eikon Tactil"));
const ET_FRAME_2 = ET_POOL.find(f => EPCatalog.frameSlotCount(f) === 2);
assert.ok(ET_FRAME_2, "разведка: у Eikon Tactil есть накладка на 2 модуля — с ней открываем пост");

/* Тот же срез, что у openPostBuilderCollectionWiring: builderSignature режем настоящим ВМЕСТЕ с
   openPostBuilder (снимок «как было» обязан быть настоящим), остальное по цепочке зависимостей. */
const NAMED_CUT = ["builderSignature", "frameCollectionList", "builderRoomFilter", "collectionFramePool", "renderPostSlotCountSelect", "openPostBuilder"];

function openPost({ builderPre, searchFieldPre } = {}) {
  const post = { id: "p1", roomId: "r1", frameId: ET_FRAME_2.id, mechanismIds: [] };
  const state = {
    products: PRODUCTS,
    posts: [post],
    templates: [],
    rooms: [{ id: "r1", name: "Комната", collection: "Eikon Tactil" }],
    builder: Object.assign({}, builderPre),
    pending: null
  };
  const dom = stand.makeDom({ selects: ["postSlotCount"] });
  /* DOM-поле поиска ДО открытия: то, что обработчик oninput записал в прошлом сеансе. openPostBuilder
     обязан его очистить — иначе поле и query разойдутся. */
  if (searchFieldPre !== undefined) dom.$("builderSearch").value = searchFieldPre;
  const canvas = stand.makeElement({ classes: [] });
  const ctx = {
    state, $: dom.$,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount,
    frameProduct: product,
    frameSlotOptions: EPCatalog.frameSlotOptions,
    EPCatalog, EPRoom, EPPosts, EPBuilderSlots,
    canvas,
    updateStatus: () => {},
    mechanismModulesTotal,
    keySlotKind,
    EP_DATA: { settings: { wallType: "solid" } },
    renderLightingSchemeSelect: () => {},
    renderBuilder: () => {},
    defaultPostName: EPCatalog.defaultPostName,
    setTimeout: () => {}
  };
  const openBuilder = stand.runNamed(NAMED_CUT, ctx);
  openBuilder({ placedId: "p1" });
  return { state, dom };
}

test("E13-open-searchclear: открытие ОЧИЩАЕТ DOM-поле поиска, а не только state.builder.query", () => {
  /* Прошлый сеанс: человек искал «выключатель» (query и поле <input> синхронны). Открываем пост
     заново — обе половины поиска обязаны обнулиться. open-14 держит только query; здесь держим
     САМО ПОЛЕ. Мутация «удалить $("builderSearch").value=""» оставила бы «выключатель» в поле при
     пустом query и полном каталоге — рассинхрон. */
  const { state, dom } = openPost({
    builderPre: { query: "выключатель" },
    searchFieldPre: "выключатель"
  });
  assert.equal(dom.$("builderSearch").value, "",
    "DOM-поле поиска обязано очиститься при открытии — иначе в нём висит запрос прошлого сеанса, а каталог показан целиком");
  assert.equal(state.builder.query, "",
    "state.builder.query тоже пуст — обе половины поиска должны быть согласованы");
});

test("E13-open-modalshow: открытие ПОКАЗЫВАЕТ модалку (класс «open» на #postModal)", () => {
  /* Без этой строки окно конструктора не появляется на экране, хотя state собран. Мутация «удалить
     $("postModal").classList.add("open")» оставила бы модалку скрытой — здесь она краснеет. */
  const { dom } = openPost({ builderPre: {} });
  assert.ok(dom.$("postModal").classList.contains("open"),
    "после открытия на #postModal обязан появиться класс «open» — иначе окно не показано");
});
