/* ПОВЕДЕНЧЕСКИЙ тест окна поста (js/postBuilder.js) для кнопочной накладки Flat (К12 ч.4, ч.1).
   Исполняем НАСТОЯЩИЕ renderBuilder/builderCapacity/pickBuilderProduct/builderErrorHtml на НАСТОЯЩЕМ
   каталоге VIMAR через общий стенд appStand и шов spanForFrame (как его собирает app.js). Предмет —
   то, что владелец УВИДИТ в окне поста: «свободно 2/1», закрытие каталога, предупреждение о
   переполнении старого поста и сохранность его позиций. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPButtonFrame = require("../js/buttonFrame.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPThermoSensor = require("../js/thermoSensor.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const byCode = c => PRODUCTS.find(p => p.code === c);
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));

const F4 = byCode("22684.4.11");   // 4 прорези
const F3 = byCode("22683.3.11");   // 3 прорези
const KEY = byCode("22751.11");    // двойная клавиша
assert.ok(F4 && F3 && KEY, "разведка каталога");
assert.ok(EPCatalog.compatibleMechanisms(F4, PRODUCTS.filter(x => x.kind === "mechanism" && x.active)).some(m => Number(m.id) === Number(KEY.id)),
  "предпосылка: клавиша 22751.11 совместима с накладкой 22684.4.11 по серии");

const spanForFrame = frame => item => EPButtonFrame.spanIn(item, frame, EPCatalog.mechanismSpan(item));

function makeDom() { return stand.makeDom({ selects: ["postFrameSelect"] }); }

/* ctx renderBuilder: доменная логика и каталог настоящие, UI-соседи — заглушки (их стерегут свои
   тесты). builderErrorHtml НЕ стаблю — он исполняется настоящим (проверяем текст предупреждения),
   поэтому в контексте EPButtonFrame/moduleWord/esc. spanForFrame — тот самый шов из app.js. */
function makeCtx(state, dom) {
  const byKind = kind => state.products.filter(x => x.kind === kind && x.active);
  const ctx = {
    state, product, byKind, frameProduct: id => product(id),
    $: dom.$,
    spanForFrame,
    EPButtonFrame, EPCatalog, EPBuilderSlots, EPPosts, EPThermoSensor,
    frameSlotCount: EPCatalog.frameSlotCount,
    frameSlotOptions: EPCatalog.frameSlotOptions,
    compatibleMechanisms: EPCatalog.compatibleMechanisms,
    mechanismSpan: EPCatalog.mechanismSpan,
    moduleWord: EPCatalog.moduleWord,
    productSeries: EPCatalog.productSeries,
    esc: s => String(s == null ? "" : s),
    frameOptions: (items, sel) => (items || []).map(i =>
      `<option value="${i.id}" ${Number(i.id) === Number(sel) ? "selected" : ""}>${i.id}</option>`).join(""),
    keySlotKind: () => false,
    enhancePicker: () => {},
    resolveMissingFrame: () => null,
    mechanismModulesTotal: ids => ids.reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    assembledPostHtml: () => "<post-preview>",
    toast: () => {},
    lightingFor: () => ({}),
    projectPostsWithBuilder: () => [],
    builderPostDraft: () => ({ mechanismIds: [] }),
    renderBuilderSlots: (layout, remaining) => {
      dom.$("builderSlots").innerHTML = remaining > 0 ? `Свободно ${remaining}` : "нет свободных модулей";
    },
    lightingRowsFor: () => [],
    retargetBuilderSlot: () => {},
    renderBuilderCatalog: () => { dom.$("builderCatalog").innerHTML = "<catalog-refreshed>"; },
    renderBuilderComposition: (frame, errorHtml) => { dom.$("builderComposition").innerHTML = frame ? "<composition>" : (errorHtml || ""); },
    renderBuilder: () => {},
    builderCtx: {},
    collectionFramePool: frames => frames, frameFacingHintText: () => "",
    builderInnardsFilter: () => ({}), builderFilterRoom: () => null, frameFacingList: () => [],
    EPRoom: { roomFrameFacing: () => null },
    EPRoomVariants: require("../js/roomVariants.js"), EPRoomVariantsUi: require("../js/roomVariantsUi.js")
  };
  return ctx;
}

const slotsOf = (mechId, n) =>
  EPBuilderSlots.fromPost({ mechanismIds: Array.from({ length: n }, () => Number(mechId)) }, () => false);

test("окно поста 22684.4 + одна 22751 → «свободно 2 модуля», каталог ещё открыт", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 1), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(F4.id);
  dom.$("postSlotCount").value = "4";
  stand.run(["builderCapacity", "builderErrorHtml", "renderBuilder"], ctx)();

  assert.match(dom.els.builderCapacity.innerHTML, /Занято 2 из 4/, "занято 2 из 4 прорезей");
  assert.match(dom.els.builderCapacity.innerHTML, /свободно 2 модул/, "свободно 2 — слова владельца");
  assert.equal(ctx.builderCtx.remaining, 2);
  assert.equal(ctx.builderCtx.addMax, 2, "ещё можно добавить (место на вторую клавишу есть)");
});

test("окно поста 22684.4 + две 22751 → рамка заполнена, свободно 0, каталог закрыт, сохранять можно", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 2), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(F4.id);
  dom.$("postSlotCount").value = "4";
  stand.run(["builderCapacity", "builderErrorHtml", "renderBuilder"], ctx)();

  assert.match(dom.els.builderCapacity.innerHTML, /Занято 4 из 4/);
  assert.equal(ctx.builderCtx.remaining, 0, "свободно 0");
  assert.equal(ctx.builderCtx.addMax, 0, "addMax 0 → карточки шире 0 скрыты, каталог закрыт");
  assert.ok(!dom.els.savePost.disabled, "две двойные клавиши заполняют 22684.4 целиком — сохранять можно");
});

test("окно поста 22683.3 + одна 22751 → «свободно 1 модуль»", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 1), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(F3.id);
  dom.$("postSlotCount").value = "3";
  stand.run(["builderCapacity", "builderErrorHtml", "renderBuilder"], ctx)();

  assert.match(dom.els.builderCapacity.innerHTML, /Занято 2 из 3/);
  assert.match(dom.els.builderCapacity.innerHTML, /свободно 1 модул/, "свободно 1");
  assert.equal(ctx.builderCtx.remaining, 1);
});

test("третья 22751 НЕ добавляется прямым pickBuilderProduct — защита от переполнения", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 2), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.els.postFrameSelect = { value: String(F4.id), dataset: {} };   // накладка выбрана прошлым render
  dom.$("postSlotCount").value = "4";
  /* renderBuilder (не исполняется в этом тесте) оставляет builderCtx.remaining — свободное место С
     УЧЁТОМ накладки. В заполненной 22684.4 (две двойные клавиши) оно 0: add-гейт обязан отклонить. */
  ctx.builderCtx = { remaining: 0, frame: F4 };
  assert.equal(state.builder.slots.length, 2, "предпосылка: в посте две клавиши");
  const pick = stand.run(["builderCapacity", "pickBuilderProduct"], ctx);
  pick(Number(KEY.id));   // попытка добавить третью напрямую
  assert.equal(state.builder.slots.length, 2, "третья клавиша не добавлена — в накладке нет места");
});

test("СТАРЫЙ пост 22684.4 с 4×22751: открытие НЕ теряет позиции, показано предупреждение о переполнении, сохранение заблокировано", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 4), target: { mode: "add" }, editingPlacedId: "p1" } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(F4.id);
  dom.$("postSlotCount").value = "4";
  stand.run(["builderCapacity", "builderErrorHtml", "renderBuilder"], ctx)();

  assert.equal(state.builder.slots.length, 4, "все 4 клавиши старого поста остались в черновике — fit их НЕ выкинул");
  assert.match(ctx.builderCtx.errorHtml, /не хватает прорезей/, "показано понятное предупреждение о переполнении");
  assert.ok(dom.els.savePost.disabled, "переполненный пост сохранять нельзя (уберите лишние/возьмите накладку больше); позиции при этом целы");
});

/* МУТАЦИЯ «защита старого поста»: если бы fit в renderBuilder считал ширину клавиши С УЧЁТОМ накладки
   (как distribute), 4×22751 в 4-прорезной накладке урезались бы до 2 — позиции старого поста
   потерялись бы. Тест выше стоит на slots.length===4 и покраснеет на такой мутации. Здесь — прямое
   доказательство, что fit-ширина клавиши базовая (1), а значит 4 клавиши проходят фильтр ёмкости. */
test("мутация-ориентир: базовая ширина клавиши 1 — поэтому 4 клавиши выживают в fit (защита старого поста)", () => {
  assert.equal(EPCatalog.mechanismSpan(KEY), 1, "fit считает ёмкость по базовой ширине (1) — 4≤4, ничего не режет");
  assert.equal(EPButtonFrame.spanIn(KEY, F4, 1), 2, "а раскладка/ёмкость — по 2: на этом расхождении и держится ч.4");
});
