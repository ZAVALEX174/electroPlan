/* ПОВЕДЕНЧЕСКИЙ регресс E13: точка входа в конструктор — openPostBuilder — обязана связать
   ОТКРЫВАЕМЫЙ пост с его комнатой, чтобы селектор «Количество модулей» сузился коллекцией этой
   комнаты. До этого теста ни один тест НЕ ИСПОЛНЯЛ openPostBuilder: пять тестов E13 собирали
   state.builder руками, а grep openPostBuilder tests/ находил её только в комментариях. Вся связка
   «пост на плане → его комната → коллекция → селектор модульностей» держалась на словах.

   ЗАЧЕМ ПОВЕДЕНЧЕСКИ. app.js — монолит-оркестратор, в node не грузится; связки дают почти все
   дефекты (§7.1 HANDOFF). Вырезаем НАСТОЯЩИЙ текст openPostBuilder общим стендом
   (tests/helpers/appStand.js) и исполняем в vm на НАСТОЯЩЕМ каталоге VIMAR. НЕ заглушаем ровно то,
   что проверяем: присвоение editingPlacedId, builderRoomFilter, collectionFramePool и
   renderPostSlotCountSelect — настоящие. Постороннее (модалка, превью, каталог механизмов,
   renderBuilder, снимок builderSignature, focus через setTimeout) — безопасные стабы: селектор
   модульностей от них не зависит.

   ЧТО ЗАФИКСИРОВАНО (поведенчески, не текстом):
   1) openPostBuilder({placedId}) записывает editingPlacedId ИМЕННО открываемого поста;
   2) как СЛЕДСТВИЕ (1) — селектор модульностей сужен коллекцией комнаты поста: пост в
      «Eikon Tactil» → селектор ровно [2,3,4], а не полный [1,2,3,4,6,7,8,14,21]. Этот же assert
      держит и КОНТРАКТ ПОРЯДКА: присвоение editingPlacedId стоит ДО renderPostSlotCountSelect —
      сдвинь его после, и селектор строился бы по пустому editingPlacedId (весь каталог).

   МУТАЦИОННАЯ ТАБЛИЦА (проверено, см. отчёт):
     editingPlacedId=placedId → editingPlacedId=null в openPostBuilder → красит §2 (комната поста
       теряется: builderRoomFilter не находит пост → коллекции нет → селектор становится полным
       [1,2,3,4,6,7,8,14,21]); попутно падает и §1 (editingPlacedId не «p1», а null).
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
const seriesOf = p => (p && p.series) || [];
const optionValues = html => [...html.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);

/* Разведка каталога: полный список модульностей и накладка Eikon Tactil на 2 модуля.
   Числа НЕ хардкодим — фиксируем как предпосылки, чтобы перезалив прайса уронил тест осмысленно. */
const activeFrames = PRODUCTS.filter(x => x.kind === "frame" && x.active);
const ALL_OPTS = EPCatalog.frameSlotOptions(activeFrames);
const ET_POOL = activeFrames.filter(f => seriesOf(f).includes("Eikon Tactil"));
const ET_OPTS = EPCatalog.frameSlotOptions(ET_POOL);
const ET_FRAME_2 = ET_POOL.find(f => EPCatalog.frameSlotCount(f) === 2);
assert.deepEqual(ALL_OPTS, [1, 2, 3, 4, 6, 7, 8, 14, 21], "предпосылка: модульности всего каталога");
assert.deepEqual(ET_OPTS, [2, 3, 4], "предпосылка: у коллекции Eikon Tactil модульности 2/3/4");
assert.ok(ET_FRAME_2, "разведка: у Eikon Tactil есть накладка на 2 модуля — с ней и открываем пост");

/* Вырезаем ВМЕСТЕ по зависимостям: frameCollectionList → builderRoomFilter → collectionFramePool →
   renderPostSlotCountSelect → openPostBuilder (последняя и возвращается). Всё в цепочке сужения —
   настоящее; стабим только постороннее для селектора. */
const CUT = ["frameCollectionList", "builderRoomFilter", "collectionFramePool", "renderPostSlotCountSelect", "openPostBuilder"];

function openPost({ collection, frameId }) {
  const post = { id: "p1", roomId: "r1", frameId, mechanismIds: [] };
  const state = {
    products: PRODUCTS,
    posts: [post],
    templates: [],
    rooms: [{ id: "r1", name: "Комната", collection }],
    builder: {},
    pending: null
  };
  const dom = stand.makeDom({ selects: ["postSlotCount"] });
  const ctx = {
    state, $: dom.$,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount,
    frameProduct: product,
    frameSlotOptions: EPCatalog.frameSlotOptions,
    EPCatalog, EPRoom, EPPosts, EPBuilderSlots,
    // постороннее для селектора — безопасные стабы
    mechanismModulesTotal: () => 0,
    keySlotKind: () => null,
    EP_DATA: { settings: { wallType: "solid" } },
    renderLightingSchemeSelect: () => {},
    renderBuilder: () => {},
    builderSignature: () => "",
    defaultPostName: () => "пост",
    setTimeout: () => {}
  };
  const open = stand.run(CUT, ctx);
  open({ placedId: "p1" });
  return { state, dom };
}

test("E13-open-1: openPostBuilder записывает editingPlacedId открываемого поста", () => {
  const { state } = openPost({ collection: "Eikon Tactil", frameId: ET_FRAME_2.id });
  assert.equal(state.builder.editingPlacedId, "p1",
    "editingPlacedId обязан указывать на открываемый пост — от него зависит и фильтр накладок, и адресация сохранения");
});

test("E13-open-2: селектор модульностей после openPostBuilder сужен коллекцией комнаты поста", () => {
  const { dom } = openPost({ collection: "Eikon Tactil", frameId: ET_FRAME_2.id });
  const opts = optionValues(dom.$("postSlotCount").innerHTML).map(Number);
  assert.deepEqual(opts, [2, 3, 4],
    "пост в комнате Eikon Tactil открывается с селектором ровно [2,3,4] — сужение делает НАСТОЯЩИЙ openPostBuilder через editingPlacedId→комнату→коллекцию");
  assert.ok(!opts.includes(8),
    "«8» у Eikon Tactil нет: её появление означало бы, что editingPlacedId потерян и селектор строится по всему каталогу");
});
