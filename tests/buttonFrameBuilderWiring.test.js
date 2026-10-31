/* ПОВЕДЕНЧЕСКИЙ тест окна поста (js/postBuilder.js) для кнопочной накладки Flat (К12 ч.4, переделка
   по словам заказчика 15.10). Исполняем НАСТОЯЩИЕ renderBuilder/builderCapacity/pickBuilderProduct на
   НАСТОЯЩЕМ каталоге VIMAR через общий стенд appStand и шов spanForFrame (как его собирает app.js).
   Предмет — то, что владелец УВИДИТ в окне поста: одна клавиша 22751 = одна прорезь, «свободно 3/2»,
   в 22684.4 встают четыре клавиши, закрытие каталога при заполнении. Запуск: node --test tests/ */
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

test("окно поста 22684.4 + одна 22751 → «свободно 3 модуля», каталог ещё открыт", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 1), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(F4.id);
  dom.$("postSlotCount").value = "4";
  stand.run(["builderCapacity", "builderErrorHtml", "renderBuilder"], ctx)();

  assert.match(dom.els.builderCapacity.innerHTML, /Занято 1 из 4/, "занято 1 из 4 прорезей");
  assert.match(dom.els.builderCapacity.innerHTML, /свободно 3 модул/, "свободно 3 — ещё три клавиши влезут");
  assert.equal(ctx.builderCtx.remaining, 3);
  assert.equal(ctx.builderCtx.addMax, 3, "ещё можно добавить (место на три клавиши)");
});

test("окно поста 22684.4 + четыре 22751 → рамка заполнена, свободно 0, каталог закрыт, сохранять можно", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 4), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(F4.id);
  dom.$("postSlotCount").value = "4";
  stand.run(["builderCapacity", "builderErrorHtml", "renderBuilder"], ctx)();

  assert.match(dom.els.builderCapacity.innerHTML, /Занято 4 из 4/);
  assert.equal(ctx.builderCtx.remaining, 0, "свободно 0");
  assert.equal(ctx.builderCtx.addMax, 0, "addMax 0 → карточки шире 0 скрыты, каталог закрыт");
  assert.ok(!dom.els.savePost.disabled, "четыре клавиши заполняют 22684.4 целиком — сохранять можно");
});

test("окно поста 22683.3 + одна 22751 → «свободно 2 модуля»", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 1), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(F3.id);
  dom.$("postSlotCount").value = "3";
  stand.run(["builderCapacity", "builderErrorHtml", "renderBuilder"], ctx)();

  assert.match(dom.els.builderCapacity.innerHTML, /Занято 1 из 3/);
  assert.match(dom.els.builderCapacity.innerHTML, /свободно 2 модул/, "свободно 2");
  assert.equal(ctx.builderCtx.remaining, 2);
});

test("пятая 22751 НЕ добавляется прямым pickBuilderProduct — защита от переполнения заполненной 22684.4", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(KEY.id, 4), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.els.postFrameSelect = { value: String(F4.id), dataset: {} };   // накладка выбрана прошлым render
  dom.$("postSlotCount").value = "4";
  /* renderBuilder (не исполняется в этом тесте) оставляет builderCtx.remaining — свободное место. В
     заполненной 22684.4 (четыре клавиши) оно 0: add-гейт обязан отклонить пятую. */
  ctx.builderCtx = { remaining: 0, frame: F4 };
  assert.equal(state.builder.slots.length, 4, "предпосылка: в посте четыре клавиши");
  const pick = stand.run(["builderCapacity", "pickBuilderProduct"], ctx);
  pick(Number(KEY.id));   // попытка добавить пятую напрямую
  assert.equal(state.builder.slots.length, 4, "пятая клавиша не добавлена — в накладке нет места");
});

/* ИНВАРИАНТ переделки 15.10: в кнопочной накладке клавиша 22751 считается ОДНИМ модулем и для ёмкости
   (fit, mechanismSpan), и для раскладки (spanForFrame === spanIn). Именно совпадение этих двух ширин
   делает так, что четыре клавиши ровно заполняют 22684.4. Если вернуть прежнее span=2 (мутация), fit
   по-прежнему базовый (1), а раскладка даст 2 — «свободно 3» превратится в «свободно 1», и тест
   ёмкости выше покраснеет. */
test("инвариант: ширина клавиши в кнопочной накладке — 1 и для fit, и для раскладки (span=2 покраснел бы)", () => {
  assert.equal(EPCatalog.mechanismSpan(KEY), 1, "базовая ширина клавиши — 1 модуль (fit)");
  assert.equal(EPButtonFrame.spanIn(KEY, F4, 1), 1, "раскладка/ёмкость тоже 1 — клавиша не раздувается");
});
