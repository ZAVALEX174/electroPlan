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
   5) ВТОРОЕ ПЛЕЧО capacity (open-8/9/10): у сохранённого поста накладка пропала из каталога — ёмкость
      восстанавливается из суммы модулей механизмов ЭТОГО поста формулой
      Math.max(1,Math.min(21, mechanismModulesTotal(sourceMechanismIds)||3)). mechanismModulesTotal —
      НАСТОЯЩИЙ (constSource из app.js), пост несёт РЕАЛЬНЫЕ mechanismIds: держим СВЯЗЬ «ёмкость ←
      механизмы этого поста», а не форму формулы (open-9), плюс обратную совместимость старого поста
      без поля mechanismIds — guard Array.isArray подставляет [] вместо reduce(undefined) (open-10).
   6) editingTemplateId открываемого ШАБЛОНА записывается ИМЕННО его id (open-5, симметрично
      editingPlacedId у open-1): по нему «Сохранить» адресует ОБНОВЛЕНИЕ, а не создаёт дубль.

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
     editingTemplateId=templateId → editingTemplateId=null (путь templateId) → красит open-5
       (после открытия шаблона в state лежит null вместо «t1» — «Сохранить» создаст дубль).
     во втором плече capacity (open-8, значения = столбец «продакшн» из постановки):
       весь второй операнд константой (||3) → sum6 даёт «3» вместо «6» — красит (вычисление, не константа);
       без Math.min(21,…) → sum25 даёт «25» вместо «21» — красит (верхняя граница);
       без ||3 → sum0 даёт «1» вместо «3» — красит (умолчание при нулевой сумме);
       нижняя граница Math.max(1,…): при действующем ||3 значение и так ≥1, поэтому одиночное
       удаление Math.max эквивалентно (не ловится ничем) — sum1→«1» держит поведение границы,
       а её роль наблюдаема на мутанте «без ||3» (sum0 даёт именно «1», а не «0», благодаря Math.max).
     mechanismModulesTotal(sourceMechanismIds) → mechanismModulesTotal([]) → красит open-9
       (стаб больше не глушит аргумент: пустой список даёт 0→||3→«3» вместо «6»).
     const sourceMechanismIds=…?…:[] → const sourceMechanismIds=src.mechanismIds (без guard) → красит
       open-10 (старый пост без поля → undefined.reduce → TypeError, конструктор не открывается).
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

/* НАСТОЯЩИЙ mechanismModulesTotal из app.js (top-level const-стрелка, functionSource её не берёт) —
   исполняем его исходный текст, а не рукописную копию: копия молча разошлась бы с продакшеном, и
   мутация во втором плече capacity перестала бы краснеть. Он замыкается на mechanismSpan+product,
   поэтому кладём их в контекст исполнения. */
const mechanismModulesTotal = vm.runInNewContext(
  stand.constSource("mechanismModulesTotal") + "\n;mechanismModulesTotal;",
  { mechanismSpan: EPCatalog.mechanismSpan, product }
);
/* Механизмы разной модульности для сборки поста с ЗАДАННОЙ суммой модулей (разведка каталога:
   span 1/2/3). Пост несёт РЕАЛЬНЫЕ mechanismIds — второе плечо capacity обязано считать ёмкость
   именно из НИХ, а не из формы формулы. */
const MECH_SPAN_1 = 200048, MECH_SPAN_2 = 200040, MECH_SPAN_3 = 200274;
const repeatMech = (id, n) => Array.from({ length: n }, () => id);
assert.equal(mechanismModulesTotal([MECH_SPAN_1]), 1, "разведка: механизм 200048 — 1 модуль");
assert.equal(mechanismModulesTotal([MECH_SPAN_2]), 2, "разведка: механизм 200040 (02970) — 2 модуля");
assert.equal(mechanismModulesTotal([MECH_SPAN_3]), 3, "разведка: механизм 200274 — 3 модуля");
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
/* Дефолт нового поста — 3-модульная накладка, а НЕ первая в каталоге. Первая активная накладка
   каталога сейчас 1-модульная — на ней и видно, что openPostBuilder берёт именно 3-модульную. */
const FRAME_FIRST = activeFrames[0];
const FRAME_3 = activeFrames.find(f => EPCatalog.frameSlotCount(f) === 3);
assert.deepEqual(ALL_OPTS, [1, 2, 3, 4, 6, 7, 8, 14, 21], "предпосылка: модульности всего каталога");
assert.deepEqual(ET_OPTS, [2, 3, 4], "предпосылка: у коллекции Eikon Tactil модульности 2/3/4");
assert.ok(ET_FRAME_2, "разведка: у Eikon Tactil есть накладка на 2 модуля — с ней и открываем пост");
assert.ok(FRAME_8, "разведка: в каталоге есть накладка на 8 модулей — её ёмкости у Eikon Tactil нет");
assert.ok(!ET_OPTS.includes(8), "предпосылка: «8» не входит в модульности Eikon Tactil — потому и годится для open-3");
assert.ok(FRAME_3, "разведка: в каталоге есть 3-модульная накладка — дефолт нового поста");
assert.notEqual(FRAME_3.id, FRAME_FIRST.id, "предпосылка: 3-модульная накладка НЕ первая в каталоге — иначе мутация byKind[0] была бы неотличима");

/* Вырезаем ВМЕСТЕ по зависимостям: frameCollectionList → builderRoomFilter → collectionFramePool →
   renderPostSlotCountSelect → openPostBuilder (последняя и возвращается). Всё в цепочке сужения —
   настоящее; стабим только постороннее для селектора. */
const CUT = ["frameCollectionList", "builderRoomFilter", "collectionFramePool", "renderPostSlotCountSelect", "openPostBuilder"];

function openPost({ collection, frameId, pending = null, open, templates, mechanismIds, omitMechanismIds = false, postExtra, builderPre }) {
  /* open — аргумент, с которым зовём openPostBuilder: по умолчанию путь «пост на плане»
     ({placedId:"p1"}), но дефекты 1/2 требуют и остальные два входа (templateId, «новый пост»).
     mechanismIds — РЕАЛЬНЫЕ механизмы открываемого поста: второе плечо capacity считает ёмкость
     из их суммы модулей (НАСТОЯЩИЙ mechanismModulesTotal), когда накладка исчезла из каталога.
     omitMechanismIds — старый пост БЕЗ поля mechanismIds (обратная совместимость): guard
     Array.isArray обязан подставить [], иначе reduce упадёт на undefined. */
  open = open || { placedId: "p1" };
  const post = { id: "p1", roomId: "r1", frameId };
  if (!omitMechanismIds) post.mechanismIds = mechanismIds || [];
  /* postExtra — свои поля открываемого поста (wallType, keyGroups): часть правил openPostBuilder
     (тип стены объекта, снятие групп у шаблона) наблюдаема только когда у источника эти поля есть.
     builderPre — «грязное» состояние builder ДО открытия: правило «каждое открытие с чистого
     выбора» видно лишь если было что сбрасывать. */
  if (postExtra) Object.assign(post, postExtra);
  const state = {
    products: PRODUCTS,
    posts: [post],
    templates: templates || [],
    rooms: [{ id: "r1", name: "Комната", collection }],
    builder: Object.assign({}, builderPre),
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
    // НАСТОЯЩИЙ mechanismModulesTotal — второе плечо capacity обязано зависеть от механизмов ЭТОГО поста
    mechanismModulesTotal,
    keySlotKind: () => null,
    EP_DATA: { settings: { wallType: "solid" } },
    renderLightingSchemeSelect: () => {},
    renderBuilder: () => {},
    builderSignature: () => "",
    // НАСТОЯЩИЙ defaultPostName — имя нового поста обязано зависеть от аргумента (3), а не быть константой
    defaultPostName: EPCatalog.defaultPostName,
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
  assert.equal(state.builder.editingTemplateId, "t1",
    "editingTemplateId обязан указывать на открываемый ШАБЛОН (симметрично editingPlacedId у open-1): по нему «Сохранить» находит existing и ОБНОВЛЯЕТ шаблон; при null вместо обновления родится дубль с новым uid, тост «Пост сохранён» вместо «Шаблон обновлён», затрётся собственный wallType шаблона");
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
     падает на Math.max(1,Math.min(21, mechanismModulesTotal(sourceMechanismIds)||3)). Пост несёт
     РЕАЛЬНЫЕ mechanismIds — mechanismModulesTotal НАСТОЯЩИЙ, суммирует их модули, а не берёт стаб.
     Проверяем все ЧЕТЫРЕ точки формулы по $("postSlotCount").value. Комната без коллекции → полный
     каталог модульностей, ёмкость поста добавляется отдельным вариантом (extra), value = самой ёмкости. */
  const cases = [
    { ids: repeatMech(MECH_SPAN_2, 3), sum: 6, value: "6", why: "вычисление из механизмов, не константа: `||3` дало бы «3», а `mechanismModulesTotal([])` — тоже «3»" },
    { ids: [MECH_SPAN_1], sum: 1, value: "1", why: "нижняя граница Math.max(1,…) не режет валидную 1" },
    { ids: repeatMech(MECH_SPAN_1, 25), sum: 25, value: "21", why: "верхняя граница Math.min(21,…) режет до 21; без неё было бы «25»" },
    { ids: [], sum: 0, value: "3", why: "нулевая сумма → умолчание ||3 = «3»; без него Math.max дал бы «1»" }
  ];
  for (const c of cases) {
    const { dom } = openPost({ frameId: 999999, mechanismIds: c.ids });
    assert.equal(dom.$("postSlotCount").value, c.value,
      `механизмы на ${c.sum} модулей → ёмкость ${c.value}: ${c.why}`);
  }
});

/* СВЯЗЬ, а не форма: второе плечо capacity обязано читать mechanismIds ИМЕННО открываемого поста.
   open-8 подавал пост с фиксированным mechanismIds:[] и стаб mechanismModulesTotal, игнорировавший
   аргумент, — обе мутации строки capacity оставались зелёными (стаб возвращал константу при любом
   входе). Теперь mechanismIds настоящие, mechanismModulesTotal настоящий: подмена аргумента на []
   даёт «3» вместо «6», guard Array.isArray на undefined роняет конструктор. */
test("E13-open-9: capacity считается из mechanismIds ЭТОГО поста (аргумент, а не []) при пропавшей накладке", () => {
  /* Три механизма 02970 по 2 модуля = 6. Мутация `mechanismModulesTotal(sourceMechanismIds)` →
     `mechanismModulesTotal([])` дала бы 0→||3→«3»: селектор её ловит value≠«6». */
  const { dom } = openPost({ frameId: 999999, mechanismIds: repeatMech(MECH_SPAN_2, 3) });
  assert.equal(dom.$("postSlotCount").value, "6",
    "ёмкость восстановлена из суммы модулей механизмов ЭТОГО поста (3×2), а не из пустого списка");
});

test("E13-open-10: старый пост БЕЗ поля mechanismIds открывается (guard Array.isArray подставляет [])", () => {
  /* Обратная совместимость: пост, сохранённый до появления mechanismIds, приходит без поля.
     Продакшн: sourceMechanismIds=[] → сумма 0 → ||3 → ёмкость «3», конструктор открывается.
     Мутация `const sourceMechanismIds=src.mechanismIds` (без guard) передала бы undefined в
     mechanismModulesTotal → TypeError `Cannot read properties of undefined (reading 'reduce')` —
     конструктор не открылся бы вовсе. Проверяем, что открытие НЕ бросает и даёт умолчание «3». */
  let dom;
  assert.doesNotThrow(() => {
    ({ dom } = openPost({ frameId: 999999, omitMechanismIds: true }));
  }, "старый пост без mechanismIds обязан открываться, а не падать на reduce(undefined)");
  assert.equal(dom.$("postSlotCount").value, "3",
    "у поста без механизмов сумма 0 → умолчание ||3 = «3»");
});

/* ↓↓↓ Правила openPostBuilder, которые её собственные комментарии обещают, но раньше не держал ни
   один assert (E13-РАУНД-4, пункт 6). Каждый тест бьёт по одной неэквивалентной зелёной мутации. */

test("E13-open-11: у ШАБЛОНА группы света снимаются при открытии, у поста на плане — сохраняются", () => {
  /* Группа света — свойство поста НА ПЛАНЕ, не шаблона (EPPosts.placementFields). Шаблон,
     сохранённый до этого правила, несёт свои keyGroups; openPostBuilder обязан снять их через
     clearGroups, иначе они уедут обратно в шаблон при следующем «Сохранить». Мутация «убрать
     clearGroups» оставила бы группу «Кухня» в слотах шаблона — красит этот тест.
     Контраст: тот же состав, открытый как ПОСТ НА ПЛАНЕ, группу сохраняет — clearGroups стоит
     только на ветке шаблона, а не глушит группы всем подряд. */
  const withGroups = { mechanismIds: [MECH_SPAN_2], keyGroups: ["Кухня"] };
  const tpl = openPost({
    collection: "Eikon Tactil", frameId: ET_FRAME_2.id,
    templates: [{ id: "t1", frameId: ET_FRAME_2.id, ...withGroups }],
    open: { templateId: "t1" }
  });
  assert.equal(tpl.state.builder.slots[0].group, "",
    "группа света шаблона обязана сняться при открытии — иначе вернётся в шаблон при сохранении");
  const placed = openPost({
    collection: "Eikon Tactil", frameId: ET_FRAME_2.id,
    postExtra: withGroups
  });
  assert.equal(placed.state.builder.slots[0].group, "Кухня",
    "у поста НА ПЛАНЕ группа сохраняется: clearGroups снимает группы только у шаблона");
});

test("E13-open-12: тип стены открываемого объекта — СВОЙ, если задан, а не всегда проектный", () => {
  /* postWallType(src, проект): у поста/шаблона со своим wallType берём его, иначе проектный.
     Мутация «всегда EP_DATA.settings.wallType» подставила бы проектный «solid» вместо «hollow»
     поста — подбор коробки ушёл бы не в ту стену. Проект здесь solid, у поста hollow. */
  const { state } = openPost({
    collection: "Eikon Tactil", frameId: ET_FRAME_2.id,
    postExtra: { wallType: "hollow" }
  });
  assert.equal(state.builder.wallType, "hollow",
    "у поста со своим типом стены (hollow) конструктор открывается в НЁМ, а не в проектном solid");
});

test("E13-open-13: новый пост берёт 3-модульную накладку и имя «на 3 модуля», а не первую в каталоге", () => {
  /* Путь «Новый пост»: дефолтная накладка — 3-модульная (byKind(frame).find(===3)||[0]), имя —
     defaultPostName(3). Мутация byKind[0] взяла бы первую (1-модульную) накладку каталога; мутация
     defaultPostName(3)→(1) дала бы «на 1 модуль». Оба — отдельными assert'ами. */
  const { dom } = openPost({ collection: "Eikon Tactil", frameId: ET_FRAME_2.id, open: {} });
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(FRAME_3.id),
    "дефолтная накладка нового поста — 3-модульная, а не первая в каталоге (byKind[0])");
  assert.equal(dom.$("postName").value, "Пост на 3 модуля",
    "имя нового поста — defaultPostName(3), а не (1) и не константа");
});

test("E13-open-14: каждое открытие начинается с чистого выбора — target/query/openSections сброшены", () => {
  /* Требование заказчика 24.08: «разделы могут быть изначально не раскрыты», поиск пуст, цель —
     «добавить». Мутация, снявшая строку сброса, оставила бы грязное состояние прошлого сеанса. */
  const { state } = openPost({
    collection: "Eikon Tactil", frameId: ET_FRAME_2.id,
    builderPre: { target: { mode: "edit", index: 4 }, query: "выключатель", openSections: new Set(["A"]) }
  });
  /* target — свежий объект из vm-realm (другой Object.prototype), поэтому сверяем поля, а не
     deepEqual: цель стала «add», прежний index сброса не пережил. */
  assert.equal(state.builder.target.mode, "add", "цель сбрасывается в «добавить»");
  assert.equal(state.builder.target.index, undefined, "прежняя цель редактирования не переживает открытие");
  assert.equal(state.builder.query, "", "поиск очищается при каждом открытии");
  assert.equal(state.builder.openSections.size, 0, "разделы каталога свёрнуты при открытии");
});

test("E13-open-15: взведённый Esc сбрасывается при открытии конструктора", () => {
  /* escArmed=null в конце openPostBuilder: без сброса «взвод Esc» прошлого сеанса пережил бы
     открытие и первый Esc закрыл бы окно без предупреждения. */
  const { state } = openPost({
    collection: "Eikon Tactil", frameId: ET_FRAME_2.id,
    builderPre: { escArmed: true }
  });
  assert.equal(state.builder.escArmed, null, "escArmed обязан обнулиться при входе в конструктор");
});

test("E13-open-16: заголовок окна соответствует пути открытия (пост / шаблон / новый)", () => {
  /* Заголовки трёх путей не должны быть переставлены местами: пост на плане, шаблон, новый пост. */
  const placed = openPost({ collection: "Eikon Tactil", frameId: ET_FRAME_2.id });
  assert.equal(placed.dom.$("postModalTitle").textContent, "Редактирование поста на плане",
    "путь placedId — заголовок про пост на плане");
  const tpl = openPost({
    collection: "Eikon Tactil", frameId: ET_FRAME_2.id,
    templates: [{ id: "t1", frameId: ET_FRAME_2.id, mechanismIds: [] }],
    open: { templateId: "t1" }
  });
  assert.equal(tpl.dom.$("postModalTitle").textContent, "Редактирование шаблона поста",
    "путь templateId — заголовок про шаблон");
  const fresh = openPost({ collection: "Eikon Tactil", frameId: ET_FRAME_2.id, open: {} });
  assert.equal(fresh.dom.$("postModalTitle").textContent, "Новый электрический пост",
    "путь «новый пост» — заголовок про новый пост");
});
