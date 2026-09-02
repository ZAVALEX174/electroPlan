/* ПОВЕДЕНЧЕСКИЙ регресс: механизм, СНЯТЫЙ С ПРОИЗВОДСТВА (active:false) и УЖЕ СТОЯЩИЙ В ПОСТЕ, не
   выбрасывается молча при перерисовке конструктора (js/app.js renderBuilder / pickBuilderProduct).

   ДЕФЕКТ. mechs = compatibleMechanisms(frame, byKind("mechanism")); byKind фильтрует active,
   поэтому снятый механизм в mechs не попадает. allowedTokens(slots, mechs) не пускает его токен,
   и EPPosts.fitMechanismIds выбрасывает слот вместе со стоимостью — тот же класс дефекта, что
   молчаливая подмена накладки на frames[0] (коммит 4456bd0), только для механизма.

   РЕШЕНИЕ ВЛАДЕЛЬЦА (то же, что для накладки): механизм, стоящий в посте, УДЕРЖИВАЕМ на любом
   render (keepMechs = mechs + снятые механизмы поста, пропущенные через ТОТ ЖЕ фильтр серии),
   помечаем «снят с производства», сохранение РАЗРЕШАЕМ. Каталог (builderCtx.mechs) остаётся из
   активных — снятый механизм новым постам НЕ предлагается.

   ДВЕ ПРИЧИНЫ ОТСЕВА НЕ СМЕШИВАЮТСЯ. compatibleMechanisms фильтрует по СЕРИИ: снятый механизм
   СВОЕЙ серии удерживается, механизм ЧУЖОЙ серии (человек сменил накладку на другую серию) законно
   выпадает — это правило не трогали (тест «чужая серия всё равно выпадает»).

   КАК ПРОВЕРЯЕМ. Исполняем НАСТОЯЩИЕ frameOptions/builderCapacity/renderBuilder(/renderBuilderSlots)
   из app.js на НАСТОЯЩЕМ каталоге VIMAR через общий стенд appStand (vm + DOM-шим). В текущем
   каталоге неактивных механизмов нет — сценарий синтетический: помечаем 09001 active:false
   (номенклатура так помечает снятые позиции).

   ЧТО КРАСНЕЕТ (мутационная таблица — в отчёте):
   1) возврат выбрасывания: allowedTokens снова кормится mechs (без снятых) → 2-й render роняет
      снятый механизм, состав и цена «худеют»;
   2) пропажа пометки: снятие mechNoticeHtml / баннера .builder-notice в составе;
   3) пропажа пометки в слоте: снятие .slot-off;
   4) появление снятого механизма в предложении новым: keepMechs уходит в builderCtx.mechs
      (каталог) — снятый механизм предлагается карточкой.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

/* Настоящий каталог VIMAR; 09001 (4,30 EUR, Neve Up, 1 модуль) помечаем снятым с производства —
   в реальных данных неактивных механизмов пока нет, состояние приходит из номенклатуры. */
const RAW = stand.loadVimarCatalog().products;
const OFF_CODE = "09001";
const withState = active => RAW.map(p => (p.code === OFF_CODE ? { ...p, active } : { ...p }));

const FRAME = RAW.find(p => p.code === "09673.01");   // Neve Up, 3 модуля, 3.12 EUR
assert.ok(FRAME, "разведка: накладка 09673.01 (Neve Up, 3М) должна быть в каталоге");
const CAP = EPCatalog.frameSlotCount(FRAME);
assert.equal(CAP, 3, "предпосылка: накладка на 3 модуля");

const MECH_OFF_ID = RAW.find(p => p.code === OFF_CODE).id;
const MECH_PRICE = RAW.find(p => p.code === OFF_CODE).price;
assert.ok(MECH_PRICE > 0, "разведка: у снимаемого механизма есть цена");
assert.equal(EPCatalog.mechanismSpan(RAW.find(p => p.code === OFF_CODE)), 1, "предпосылка: механизм одномодульный");

/* Механизм ЧУЖОЙ серии (Arke/Eikon…, не Neve Up) — для проверки, что смена серии по-прежнему
   выбрасывает несовместимый механизм и правило compatibleMechanisms не задето. */
const OTHER = RAW.find(p => p.code === "03925");
assert.ok(OTHER && !EPCatalog.productSeries(OTHER).includes("Neve Up"),
  "разведка: 03925 — механизм другой серии (не Neve Up)");

const slotsOf = ids => EPBuilderSlots.fromPost({ mechanismIds: ids.map(Number) }, () => false);

/* Контекст vm: доменная логика и каталог настоящие; frameOptions НАСТОЯЩИЙ, поэтому пробрасываем
   его зависимости. renderBuilderSlots/renderBuilderCatalog/renderBuilderComposition — заглушки,
   повторяющие ОДИН контракт настоящих (куда пишут результат), чтобы читать по DOM-хосту. */
function makeCtx(products, dom) {
  const product = id => products.find(p => Number(p.id) === Number(id));
  const byKind = kind => products.filter(x => x.kind === kind && x.active);
  const ctx = {
    state: null, products, product, byKind, frameProduct: id => product(id), $: dom.$,
    frameSlotCount: EPCatalog.frameSlotCount,
    compatibleMechanisms: EPCatalog.compatibleMechanisms,
    mechanismSpan: EPCatalog.mechanismSpan,
    moduleWord: EPCatalog.moduleWord,
    productSeries: i => EPCatalog.productSeries(i),
    productOptionLabel: i => `[${i.code}] ${i.name}`,
    esc: s => String(s == null ? "" : s),
    enhancePicker: () => {}, resolveMissingFrame: () => null,
    mechanismModulesTotal: ids => ids.reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>",
    lightingFor: () => ({}), projectPostsWithBuilder: () => [], builderPostDraft: () => ({ mechanismIds: [] }),
    renderBuilderSlots: () => {}, lightingRowsFor: () => [], retargetBuilderSlot: () => {},
    builderErrorHtml: () => "",
    renderBuilderCatalog: () => {},
    renderBuilderComposition: (frame, errorHtml) => { dom.$("builderComposition").innerHTML = frame ? ("<composition>" + (errorHtml || "")) : (errorHtml || ""); },
    renderBuilder: () => {}, builderCtx: {}, EPBuilderSlots, EPPosts
  };
  return ctx;
}

const makeDom = () => stand.makeDom({ selects: ["postFrameSelect"] });

/* Открыть конструктор поста на FRAME со слотами ids и отработать два render (второй — имитация
   клика по карточке, где dataset уже снят: там и была молчаливая подмена). */
function twoRenders(products, ids) {
  const dom = makeDom();
  const ctx = makeCtx(products, dom);
  ctx.state = { products, builder: { slots: slotsOf(ids), target: { mode: "add" }, editingPlacedId: null } };
  dom.$("postFrameSelect").dataset.preferredFrameId = String(FRAME.id);
  dom.$("postSlotCount").value = String(CAP);
  const render = stand.run(["frameOptions", "builderCapacity", "renderBuilder"], ctx);
  render(); render();
  return { dom, ctx };
}

test("renderBuilder: снятый с производства механизм НЕ выбрасывается на 2-м render — состав и деньги целы", () => {
  const products = withState(false);   // 09001 снят с производства
  const ids = [MECH_OFF_ID, MECH_OFF_ID, MECH_OFF_ID];   // пост из трёх снятых механизмов
  const { ctx } = twoRenders(products, ids);
  const product = id => products.find(p => Number(p.id) === Number(id));

  assert.equal(ctx.state.builder.slots.length, 3,
    "все три снятых механизма удержаны на повторном render — fit не выбросил их молча");
  ctx.state.builder.slots.forEach(s => assert.equal(Number(s.id), MECH_OFF_ID,
    "слот держит именно снятый механизм поста, а не пусто/подмену"));
  const priceOff = ctx.state.builder.slots.reduce((sum, s) => sum + product(s.id).price, 0);

  // КОНТРОЛЬ: тот же пост, но механизм активен — состав и деньги обязаны совпасть
  const ctrl = twoRenders(withState(true), ids);
  const priceOn = ctrl.ctx.state.builder.slots.reduce((sum, s) => sum + product(s.id).price, 0);
  assert.equal(ctrl.ctx.state.builder.slots.length, 3, "контроль: активный механизм тоже держится (3 слота)");
  assert.equal(priceOff, priceOn, "деньги: пост со снятым и с активным механизмом считается ОДИНАКОВО");
  assert.equal(priceOff, MECH_PRICE * 3, `деньги: цена поста = 3 × ${MECH_PRICE} EUR (снятый механизм посчитан по своей цене)`);

  assert.ok(!ctx.state.builder.slots.some(s => product(s.id) == null), "ни один слот не потерял товар");
});

test("renderBuilder: keepMechs удерживает снятый механизм, но каталог (builderCtx.mechs) его НЕ предлагает новым", () => {
  const products = withState(false);
  const { ctx } = twoRenders(products, [MECH_OFF_ID, MECH_OFF_ID, MECH_OFF_ID]);
  const inList = (list, id) => (list || []).some(m => Number(m.id) === Number(id));

  assert.ok(inList(ctx.builderCtx.keepMechs, MECH_OFF_ID),
    "keepMechs (список для fit/упаковки) содержит снятый механизм поста — иначе fit его выбросит");
  assert.ok(!inList(ctx.builderCtx.mechs, MECH_OFF_ID),
    "builderCtx.mechs (каталог карточек) НЕ содержит снятый механизм — новым постам он не предлагается");
  // сохранение РАЗРЕШЕНО (пост из 3×1М собирается в накладке на 3М): снятый механизм не блокирует
  assert.equal(ctx.$("savePost").disabled, false,
    "сохранение разрешено (решение владельца) — снятый механизм не блокирует, в отличие от «недоступна»");

  // пометка-баннер в составе — приглушённая .builder-notice, а не красная .builder-error
  assert.match(ctx.builderCtx.errorHtml, /builder-notice/, "баннер снятого механизма — .builder-notice (пометка, не блокировка)");
  assert.match(ctx.builderCtx.errorHtml, /Механизм снят с производства/, "баннер называет причину человеческим текстом");
  assert.match(ctx.builderCtx.errorHtml, new RegExp(OFF_CODE), "баннер называет артикул снятого механизма");
  assert.match(ctx.$("builderComposition").innerHTML, /Механизм снят с производства/, "баннер доходит до composition-хоста");
});

test("renderBuilder: снятый механизм ЧУЖОЙ серии выпадает законно — правило compatibleMechanisms не задето", () => {
  // Neve Up накладка + снятый механизм ДРУГОЙ серии (03925): смена серии — это отдельная причина,
  // её мы намеренно НЕ удерживаем, иначе смешали бы два правила отсева.
  const products = RAW.map(p => (p.code === "03925" ? { ...p, active: false } : { ...p }));
  const dom = makeDom();
  const ctx = makeCtx(products, dom);
  const OTHER_ID = products.find(p => p.code === "03925").id;
  ctx.state = { products, builder: { slots: slotsOf([OTHER_ID]), target: { mode: "add" }, editingPlacedId: null } };
  dom.$("postFrameSelect").dataset.preferredFrameId = String(FRAME.id);
  dom.$("postSlotCount").value = String(CAP);
  const render = stand.run(["frameOptions", "builderCapacity", "renderBuilder"], ctx);
  render(); render();

  assert.equal(ctx.state.builder.slots.length, 0,
    "снятый механизм ЧУЖОЙ серии выброшен fit'ом — как и активный чужой серии; серия важнее статуса");
  assert.ok(!(ctx.builderCtx.keepMechs || []).some(m => Number(m.id) === Number(OTHER_ID)),
    "keepMechs не тащит механизм чужой серии — иначе смешались бы «снят» и «чужая серия»");
});

test("pickBuilderProduct: замена одного модуля НЕ роняет соседний снятый механизм (fit-preserving берёт keepMechs)", () => {
  // Второй потребитель фильтра по каталогу: при выборе карточки в режиме «Заменить» состав
  // прогоняется через fitMechanismIdsPreserving(allowedTokens(slots, keepMechs)). Если тут
  // подсунуть builderCtx.mechs (без снятых), соседний снятый механизм выпадет молча — как и в
  // renderBuilder. Пост: два снятых 09001; заменяем слот 0 активным механизмом.
  const products = withState(false);
  const product = id => products.find(p => Number(p.id) === Number(id));
  const activeMech = products.find(p => p.kind === "mechanism" && p.active &&
    EPCatalog.mechanismSpan(p) === 1 && EPCatalog.productSeries(p).includes("Neve Up"));
  assert.ok(activeMech, "разведка: есть активный одномодульный механизм Neve Up для замены");

  const dom = makeDom();
  const ctx = makeCtx(products, dom);
  ctx.state = { products, builder: { slots: slotsOf([MECH_OFF_ID, MECH_OFF_ID]), target: { mode: "replace", index: 0 } } };
  dom.$("postSlotCount").value = String(CAP);   // builderCapacity: накладки в value нет → фолбэк на 3
  ctx.keySlotKind = () => false;
  ctx.builderCapacity = () => CAP;
  ctx.renderBuilder = () => {};
  // builderCtx как после render: keepMechs удерживает снятый механизм, mechs (каталог) — нет
  const allMech = products.filter(x => x.kind === "mechanism" && x.active);
  ctx.builderCtx = {
    mechs: EPCatalog.compatibleMechanisms(FRAME, allMech),
    keepMechs: EPCatalog.compatibleMechanisms(FRAME, allMech.concat([product(MECH_OFF_ID)]))
  };
  const pick = stand.run("pickBuilderProduct", ctx);
  pick(activeMech.id);   // заменить слот 0 активным механизмом

  assert.equal(ctx.state.builder.slots.length, 2, "два слота остались: замена не выбросила соседний снятый механизм");
  assert.equal(Number(ctx.state.builder.slots[0].id), Number(activeMech.id), "слот 0 стал выбранным активным механизмом");
  assert.equal(Number(ctx.state.builder.slots[1].id), MECH_OFF_ID, "слот 1 — снятый механизм — удержан fit-preserving");
});

/* Слотовая пометка .slot-off — на РЕАЛЬНОМ renderBuilderSlots (а не на заглушке): снятый механизм
   помечен, активный — нет. Layout строим руками (renderBuilderSlots читает slot.item/span/label). */
test("renderBuilderSlots: снятый механизм помечен .slot-off, активный — нет", () => {
  const products = withState(false);
  const product = id => products.find(p => Number(p.id) === Number(id));
  const dom = makeDom();
  // хост слотов должен уметь querySelectorAll (renderBuilderSlots навешивает обработчики)
  dom.els.builderSlots = Object.assign(stand.makeElement(), { querySelectorAll: () => [] });
  const MECH_ON = RAW.find(p => p.kind === "mechanism" && p.active && p.code !== OFF_CODE);
  const layout = [
    { item: product(MECH_OFF_ID), span: 1, label: "1" },
    { item: MECH_ON, span: 1, label: "2" }
  ];
  const ctx = {
    state: { builder: { target: { mode: "add" }, editingPlacedId: null, slots: layout.map(l => ({ id: l.item.id, group: "" })) } },
    $: dom.$, esc: s => String(s == null ? "" : s), moduleWord: EPCatalog.moduleWord,
    isBareMechanism: () => false, isKeyProduct: () => false,
    productPicture: () => "", productMoney: () => "0", lightSlotHtml: () => "",
    GROUP_NAME_MAX: 40, bindProductPictureFallbacks: () => {},
    EPBuilderSlots, renderBuilder: () => {}, refreshBuilderLighting: () => {}
  };
  const renderSlots = stand.run("renderBuilderSlots", ctx);
  renderSlots(layout, 0, []);

  const html = dom.els.builderSlots.innerHTML;
  const offMarks = (html.match(/slot-off/g) || []).length;
  assert.equal(offMarks, 1, "ровно один .slot-off — на снятом механизме, не на активном");
  assert.match(html, /снят с производства/, "текст пометки в слоте присутствует");
});
