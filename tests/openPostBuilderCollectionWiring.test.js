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
   3) фактическая ЁМКОСТЬ открываемого поста вычисляется (frameSlotCount), а не берётся константой:
      пост с накладкой на 8 модулей в комнате Eikon Tactil → селектор [2,3,4,8], где 8 добавлена
      отдельным вариантом (extra renderPostSlotCountSelect), а value = "8";
   4) вход в конструктор СНИМАЕТ взведённый режим «Разместить» на ВСЕХ ТРЁХ путях открытия
      (placedId — open-4, templateId — open-5, «новый пост» — open-6): state.pending обнуляется,
      класс placing уходит с канваса, updateStatus вызывается. Снятие УСЛОВНОЕ: при pending=null
      статус и канвас не трогаются (open-7).
   5) ВТОРОЕ ПЛЕЧО capacity (open-8): у сохранённого поста накладка пропала из каталога — ёмкость
      восстанавливается из суммы модулей механизмов формулой Math.max(1,Math.min(21,total||3)).

   МУТАЦИОННАЯ ТАБЛИЦА (проверено, см. отчёт):
     editingPlacedId=placedId → editingPlacedId=null в openPostBuilder → красит §2 (комната поста
       теряется: builderRoomFilter не находит пост → коллекции нет → селектор становится полным
       [1,2,3,4,6,7,8,14,21]); попутно падает и §1 (editingPlacedId не «p1», а null).
     присвоение editingPlacedId ПОСЛЕ renderPostSlotCountSelect(capacity) → красит §2 (селектор
       строится по ещё пустому editingPlacedId → весь каталог).
     удаление вызова renderPostSlotCountSelect(capacity) → красит §2 (селектор не наполняется).
     const capacity=3 (константа вместо frameSlotCount) → красит §3 (8 не попадает в селектор:
       остаётся [2,3,4], а value обнуляется — «3» есть в опциях, но это НЕ ёмкость поста).
     строка снятия pending → «;» → красит §4 (open-4: pending не обнулён, placing остался,
       updateStatus не вызван).
     if(state.pending&&placedId) → красит open-5 и open-6 (templateId и «новый пост» не снимают
       режим: pending остаётся взведён, placing на канвасе, updateStatus не зван).
     снятие pending БЕЗУСЛОВНО (убрать if) → красит open-7 (updateStatus зван при пустом pending —
       затёр бы строку статуса — и placing снят зря).
     во втором плече capacity (open-8, значения = столбец «продакшн» из постановки):
       весь второй операнд константой (||3) → sum6 даёт «3» вместо «6» — красит (вычисление, не константа);
       без Math.min(21,…) → sum25 даёт «25» вместо «21» — красит (верхняя граница);
       без ||3 → sum0 даёт «1» вместо «3» — красит (умолчание при нулевой сумме);
       нижняя граница Math.max(1,…): при действующем ||3 значение и так ≥1, поэтому одиночное
       удаление Math.max эквивалентно (не ловится ничем) — sum1→«1» держит поведение границы,
       а её роль наблюдаема на мутанте «без ||3» (sum0 даёт именно «1», а не «0», благодаря Math.max).
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
/* Накладка на 8 модулей ЛЮБОЙ серии — её ёмкости (8) нет у Eikon Tactil [2,3,4] и она не равна
   дефолтной «3». С таким постом открываем комнату Eikon Tactil в open-3: реальная ёмкость 8 обязана
   попасть в селектор отдельным вариантом, иначе сохранённый пост показал бы чужое значение. */
const FRAME_8 = activeFrames.find(f => EPCatalog.frameSlotCount(f) === 8);
assert.deepEqual(ALL_OPTS, [1, 2, 3, 4, 6, 7, 8, 14, 21], "предпосылка: модульности всего каталога");
assert.deepEqual(ET_OPTS, [2, 3, 4], "предпосылка: у коллекции Eikon Tactil модульности 2/3/4");
assert.ok(ET_FRAME_2, "разведка: у Eikon Tactil есть накладка на 2 модуля — с ней и открываем пост");
assert.ok(FRAME_8, "разведка: в каталоге есть накладка на 8 модулей — её ёмкости у Eikon Tactil нет");
assert.ok(!ET_OPTS.includes(8), "предпосылка: «8» не входит в модульности Eikon Tactil — потому и годится для open-3");

/* Вырезаем ВМЕСТЕ по зависимостям: frameCollectionList → builderRoomFilter → collectionFramePool →
   renderPostSlotCountSelect → openPostBuilder (последняя и возвращается). Всё в цепочке сужения —
   настоящее; стабим только постороннее для селектора. */
const CUT = ["frameCollectionList", "builderRoomFilter", "collectionFramePool", "renderPostSlotCountSelect", "openPostBuilder"];

function openPost({ collection, frameId, pending = null, open, templates, mechModules = 0 }) {
  /* open — аргумент, с которым зовём openPostBuilder: по умолчанию путь «пост на плане»
     ({placedId:"p1"}), но дефекты 1/2 требуют и остальные два входа (templateId, «новый пост»).
     mechModules — сумма модулей механизмов открываемого поста (стаб mechanismModulesTotal):
     второе плечо capacity считает ёмкость из неё, когда накладка исчезла из каталога. */
  open = open || { placedId: "p1" };
  const post = { id: "p1", roomId: "r1", frameId, mechanismIds: [] };
  const state = {
    products: PRODUCTS,
    posts: [post],
    templates: templates || [],
    rooms: [{ id: "r1", name: "Комната", collection }],
    builder: {},
    pending
  };
  const dom = stand.makeDom({ selects: ["postSlotCount"] });
  /* canvas и updateStatus — НАСТОЯЩИЕ зависимости строки снятия взведённого «Разместить»
     (openPostBuilder), а не селектора. При pending=null (тесты open-1/2/3) ветка не исполняется и
     они инертны; тест open-4 взводит pending и по ним проверяет снятие режима. canvas берём с
     классом "placing" — браузерная семантика classList (makeClassList) честно снимет его remove(). */
  const canvas = stand.makeElement({ classes: ["placing"] });
  let statusCalls = 0;
  const ctx = {
    state, $: dom.$,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    frameSlotCount: EPCatalog.frameSlotCount,
    frameProduct: product,
    frameSlotOptions: EPCatalog.frameSlotOptions,
    EPCatalog, EPRoom, EPPosts, EPBuilderSlots,
    canvas,
    updateStatus: () => { statusCalls += 1; },
    // постороннее для селектора — безопасные стабы
    mechanismModulesTotal: () => mechModules,
    keySlotKind: () => null,
    EP_DATA: { settings: { wallType: "solid" } },
    renderLightingSchemeSelect: () => {},
    renderBuilder: () => {},
    builderSignature: () => "",
    defaultPostName: () => "пост",
    setTimeout: () => {}
  };
  const openBuilder = stand.run(CUT, ctx);
  openBuilder(open);
  return { state, dom, canvas, statusCalls };
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

test("E13-open-3: фактическая ёмкость открываемого поста попадает в селектор отдельным вариантом", () => {
  /* Пост с накладкой на 8 модулей в комнате Eikon Tactil (коллекция [2,3,4]). Ёмкость 8 — НАСТОЯЩАЯ,
     вычисленная из frameSlotCount открываемого поста, а не константа: селектор обязан стать
     [2,3,4,8], где 8 добавлена отдельным вариантом (extra). Подмена вычисления любой константой из
     [2,3,4] (напр. capacity=3) не добавит нового варианта — селектор остался бы [2,3,4], и тест
     краснеет; константа вне модульностей каталога дала бы иное множество и тоже краснеет. */
  const { dom } = openPost({ collection: "Eikon Tactil", frameId: FRAME_8.id });
  const opts = optionValues(dom.$("postSlotCount").innerHTML).map(Number);
  assert.deepEqual(opts, [2, 3, 4, 8],
    "селектор = модульности коллекции [2,3,4] ПЛЮС фактическая ёмкость открытого поста (8) отдельным вариантом");
  assert.ok(opts.includes(8),
    "ёмкость 8 обязана присутствовать: она вычислена из накладки поста, а не взята из модульностей коллекции");
  assert.equal(dom.$("postSlotCount").value, "8",
    "value селектора = фактической ёмкости поста: пост с исчезнувшей у коллекции модульностью не должен показать чужое значение");
});

test("E13-open-4: открытие конструктора снимает взведённый режим «Разместить»", () => {
  /* Человек нажал «Разместить», передумал и пошёл редактировать пост — openPostBuilder обязан снять
     взведённый pending В ЕДИНОЙ точке входа, иначе первый клик по плану после закрытия окна поставит
     ненужный объект. Проверяем ВСЕ три следствия строки: pending обнулён, класс placing снят с
     канваса, updateStatus вызван. Замена строки на «;» оставляет всё как было — тест краснеет. */
  const { state, canvas, statusCalls } = openPost({
    collection: "Eikon Tactil",
    frameId: ET_FRAME_2.id,
    pending: { kind: "template", templateId: "t1" }
  });
  assert.equal(state.pending, null, "взведённый режим размещения обязан сняться при входе в конструктор");
  assert.ok(!canvas.classList.contains("placing"),
    "класс «placing» обязан уйти с канваса — иначе курсор остаётся в режиме размещения");
  assert.equal(statusCalls, 1, "updateStatus обязан быть вызван, чтобы строка статуса отразила снятие режима");
});

/* Снятие взведённого «Разместить» обещано комментарием openPostBuilder для ВСЕХ ТРЁХ путей входа
   (пост на плане, «✎» у шаблона, «Новый пост»), но open-4 проверял только путь placedId. Мутация
   `if(state.pending&&placedId)` осталась бы зелёной: на входе placedId она снимает режим, а на
   templateId и «новом посте» — нет, и первый клик по плану поставит ненужный объект. Держим оба
   недостающих пути. */
test("E13-open-5: вход через «✎» шаблона (templateId) тоже снимает взведённый «Разместить»", () => {
  const { state, canvas, statusCalls } = openPost({
    collection: "Eikon Tactil",
    frameId: ET_FRAME_2.id,
    templates: [{ id: "t1", frameId: ET_FRAME_2.id, mechanismIds: [] }],
    open: { templateId: "t1" },
    pending: { kind: "template", templateId: "t9" }
  });
  assert.equal(state.pending, null, "режим размещения снят и при открытии ШАБЛОНА, не только поста на плане");
  assert.ok(!canvas.classList.contains("placing"), "класс «placing» ушёл с канваса на пути templateId");
  assert.equal(statusCalls, 1, "updateStatus вызван на пути templateId");
});

test("E13-open-6: вход «Новый пост» (ни placedId, ни templateId) тоже снимает взведённый «Разместить»", () => {
  const { state, canvas, statusCalls } = openPost({
    collection: "Eikon Tactil",
    frameId: ET_FRAME_2.id,
    open: {},
    pending: { kind: "template", templateId: "t9" }
  });
  assert.equal(state.pending, null, "режим размещения снят и при создании НОВОГО поста");
  assert.ok(!canvas.classList.contains("placing"), "класс «placing» ушёл с канваса на пути «новый пост»");
  assert.equal(statusCalls, 1, "updateStatus вызван на пути «новый пост»");
});

test("E13-open-7: без взведённого «Разместить» вход в конструктор НЕ трогает статус и канвас", () => {
  /* Снятие обязано быть УСЛОВНЫМ (только когда pending реально взведён). Мутация «снять безусловно»
     (убрать if) звала бы updateStatus() при КАЖДОМ открытии — а updateStatus() без аргумента
     затирает строку статуса дефолтом. Открываем при pending=null и требуем: updateStatus не зван,
     «placing» с канваса не снят. */
  const { state, canvas, statusCalls } = openPost({
    collection: "Eikon Tactil",
    frameId: ET_FRAME_2.id,
    pending: null
  });
  assert.equal(state.pending, null, "pending как был null");
  assert.equal(statusCalls, 0, "updateStatus НЕ вызван — снимать нечего, статус трогать нельзя (мутация «снять безусловно» краснеет здесь)");
  assert.ok(canvas.classList.contains("placing"), "класс «placing» не снят: ветка снятия при пустом pending не исполняется");
});

test("E13-open-8: ёмкость сохранённого поста восстанавливается из суммы модулей механизмов, когда накладка пропала из каталога", () => {
  /* ВТОРОЕ ПЛЕЧО capacity: frameId=999999 нет в перезалитом прайсе → frameSlotCount(undefined)
     падает на Math.max(1,Math.min(21, mechanismModulesTotal||3)). Проверяем все ЧЕТЫРЕ точки формулы
     по $("postSlotCount").value. Комната без коллекции → полный каталог модульностей, ёмкость поста
     добавляется отдельным вариантом (extra), поэтому value = самой ёмкости. */
  const cases = [
    { sum: 6, value: "6", why: "вычисление, а не константа: мутация `||3` дала бы «3»" },
    { sum: 1, value: "1", why: "нижняя граница Math.max(1,…) не режет валидную 1" },
    { sum: 25, value: "21", why: "верхняя граница Math.min(21,…) режет до 21; без неё было бы «25»" },
    { sum: 0, value: "3", why: "нулевая сумма → умолчание ||3 = «3»; без него Math.max дал бы «1»" }
  ];
  for (const c of cases) {
    const { dom } = openPost({ frameId: 999999, mechModules: c.sum });
    assert.equal(dom.$("postSlotCount").value, c.value,
      `сумма модулей ${c.sum} → ёмкость ${c.value}: ${c.why}`);
  }
});
