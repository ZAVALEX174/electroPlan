/* ПОВЕДЕНЧЕСКИЙ регресс: накладка, СНЯТАЯ С ПРОИЗВОДСТВА (active:false), не подменяется молча
   на повторной перерисовке конструктора (js/app.js renderBuilder).

   ДЕФЕКТ (замер проверяющего). Пост открыт на 09666.21 (27,48 EUR, active:false). На ПЕРВОМ
   render накладка приходит явно через dataset.preferredFrameId и попадает в frameList отдельной
   веткой — всё верно. dataset снимается. На ВТОРОМ render (любой клик по карточке перерисовывает
   конструктор) dataset уже нет, список frameList — это byKind("frame") БЕЗ неактивных, накладки
   09666.21 в нём нет, и selectedFrameId молча падает на frames[0] — первую накладку каталога
   09666.01 (9,35 EUR). Защита frameMissing не срабатывает: товар-то находится (product/frameProduct
   не фильтруют active). Класс тот же, что у пропавшего артикула и пустого frameId, только для
   ЧЕТВЁРТОГО входа.

   РЕШЕНИЕ ВЛАДЕЛЬЦА 02.09 (отличается от frameMissing/frameUnset — там сохранение блокируется):
   накладку ОСТАВИТЬ выбранной на любом render, пометить «снята с производства», сохранение
   РАЗРЕШИТЬ. Проект мог быть сделан до снятия позиции, изделие физически существует. Смета
   считается по НАСТОЯЩЕЙ накладке поста.

   КАК ПРОВЕРЯЕМ. Исполняем НАСТОЯЩИЕ frameOptions/builderCapacity/renderBuilder из app.js на
   НАСТОЯЩЕМ каталоге VIMAR через общий стенд appStand (vm + DOM-шим). frameOptions настоящий,
   поэтому пометка «снята с производства» проверяется по продакшн-коду, а не по заглушке. В
   текущем каталоге неактивных накладок нет — сценарий синтетический: помечаем 09666.21
   active:false (номенклатура так помечает снятые позиции).

   ЧТО КРАСНЕЕТ (мутационная таблица — в отчёте):
   1) возврат подмены: frameList перестаёт добавлять уже стоящую накладку → 2-й render роняет
      09666.21 на frames[0] (09666.01), цена 27,48 → 9,35;
   2) пропажа пометки «снята с производства» в опции поля;
   3) пропажа приглушённого баннера «Накладка снята с производства» в составе;
   4) появление неактивной накладки в списке выбора для НОВОГО поста (byKind перестаёт фильтровать
      active).
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

/* Настоящий каталог VIMAR; 09666.21 (27,48 EUR) помечаем снятым с производства — в реальных
   данных неактивных накладок пока нет, состояние приходит из номенклатуры. */
const RAW = stand.loadVimarCatalog().products;
const PRODUCTS = RAW.map(p => (p.code === "09666.21" ? { ...p, active: false } : { ...p }));

const FRAME_OFF = PRODUCTS.find(p => p.code === "09666.21");   // снята с производства, 27,48 EUR
const FRAME_FIRST = PRODUCTS.find(p => p.code === "09666.01"); // frames[0] той же модульности, 9,35 EUR
assert.ok(FRAME_OFF && FRAME_FIRST, "разведка: 09666.21 и 09666.01 должны быть в каталоге");
assert.equal(FRAME_OFF.active, false, "предпосылка сценария: 09666.21 помечена снятой с производства");
assert.equal(EPCatalog.frameSlotCount(FRAME_OFF), EPCatalog.frameSlotCount(FRAME_FIRST),
  "предпосылка: обе накладки одной модульности — иначе подмены на frames[0] той же модульности не было бы");

const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const activeMech = PRODUCTS.filter(x => x.kind === "mechanism" && x.active);
const CAP = EPCatalog.frameSlotCount(FRAME_OFF);
const MECH1 = EPCatalog.compatibleMechanisms(FRAME_OFF, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
assert.ok(MECH1, "разведка: у 09666.21 (Neve Up) есть совместимый одномодульный механизм");

const slotsOf = (id, n) => EPBuilderSlots.fromPost({ mechanismIds: Array.from({ length: n }, () => Number(id)) }, () => false);

/* Контекст vm: доменная логика и каталог настоящие; frameOptions НАСТОЯЩИЙ (его пометку и
   проверяем), поэтому пробрасываем его зависимости (productSeries/productOptionLabel/esc), а не
   заглушку списка. renderBuilderComposition повторяет один контракт настоящей: при накладке хост
   получает errorHtml — так баннер проверяется по DOM-хосту, а не по объекту контекста. */
function makeCtx(state, dom) {
  const byKind = kind => state.products.filter(x => x.kind === kind && x.active);
  return {
    state, product, byKind, frameProduct: id => product(id), $: dom.$,
    frameSlotCount: EPCatalog.frameSlotCount,
    compatibleMechanisms: EPCatalog.compatibleMechanisms,
    mechanismSpan: EPCatalog.mechanismSpan,
    moduleWord: EPCatalog.moduleWord,
    productSeries: i => i.series || [],
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
}

const makeDom = () => stand.makeDom({ selects: ["postFrameSelect"] });

test("renderBuilder: снятая с производства накладка НЕ подменяется на 2-м render — держится значением, цена не меняется", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(MECH1.id, CAP), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  // openPostBuilder задаёт накладку поста явно через dataset
  dom.$("postFrameSelect").dataset.preferredFrameId = String(FRAME_OFF.id);
  dom.$("postSlotCount").value = String(CAP);
  const render = stand.run(["frameOptions", "builderCapacity", "renderBuilder"], ctx);

  render();   // первый render: накладка приходит через dataset
  assert.equal(dom.els.postFrameSelect.value, String(FRAME_OFF.id), "на первом render накладка поста выбрана");
  assert.ok(!("preferredFrameId" in dom.els.postFrameSelect.dataset), "предпосылка: dataset снят после первого render");

  render();   // ВТОРОЙ render (имитация клика по карточке) — здесь была молчаливая подмена
  assert.equal(dom.els.postFrameSelect.value, String(FRAME_OFF.id),
    "снятая с производства накладка держится значением и на повторном render, а НЕ подменяется frames[0]");
  assert.notEqual(dom.els.postFrameSelect.value, String(FRAME_FIRST.id),
    "накладка не должна упасть на 09666.01 (9,35 EUR) — это и есть денежный дефект");
  // деньги: поле держит НАСТОЯЩУЮ накладку поста (27,48), а не подставленную (9,35)
  assert.equal(product(dom.els.postFrameSelect.value).price, FRAME_OFF.price, "смета считается по 27,48 EUR — цене накладки поста");
  assert.equal(state.builder.slots.length, CAP, "механизмы поста целы — от чужой накладки ничего не режется");
  assert.ok(!dom.els.savePost.disabled, "сохранение РАЗРЕШЕНО (решение владельца) — в отличие от «недоступна»/«не выбрана»");
});

test("renderBuilder: снятая с производства накладка помечена «снята с производства» в опции поля и баннером в составе", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(MECH1.id, CAP), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(FRAME_OFF.id);
  dom.$("postSlotCount").value = String(CAP);
  const render = stand.run(["frameOptions", "builderCapacity", "renderBuilder"], ctx);
  render(); render();

  // пометка в опции поля (продакшн-frameOptions)
  const offOption = dom.els.postFrameSelect.innerHTML.match(new RegExp(`<option value="${FRAME_OFF.id}"[^>]*>([^<]*)</option>`));
  assert.ok(offOption, "опция снятой накладки должна быть в списке");
  assert.match(offOption[1], /снята с производства/, "опция поля обязана нести пометку «снята с производства»");
  // активные накладки пометку НЕ несут
  const okOption = dom.els.postFrameSelect.innerHTML.match(new RegExp(`<option value="${FRAME_FIRST.id}"[^>]*>([^<]*)</option>`));
  assert.ok(okOption && !/снята с производства/.test(okOption[1]), "активная накладка пометку не несёт");
  // баннер в составе — приглушённый (не красная ошибка), сохранение при нём разрешено
  assert.match(ctx.builderCtx.errorHtml, /builder-notice/, "баннер — .builder-notice (пометка, не блокирующая .builder-error)");
  assert.match(ctx.builderCtx.errorHtml, /Накладка снята с производства/, "баннер называет причину человеческим текстом");
  assert.match(dom.els.builderComposition.innerHTML, /Накладка снята с производства/, "баннер доходит до composition-хоста, а не остаётся в объекте контекста");
});

test("renderBuilder: снятая с производства накладка НЕ предлагается новому посту", () => {
  const dom = makeDom();
  const allActiveFrames = PRODUCTS.filter(x => x.kind === "frame" && x.active);
  const defFrame = allActiveFrames.find(f => EPCatalog.frameSlotCount(f) === CAP) || allActiveFrames[0];
  const cap = EPCatalog.frameSlotCount(defFrame);
  const mech = EPCatalog.compatibleMechanisms(defFrame, activeMech).find(m => EPCatalog.mechanismSpan(m) === 1);
  const state = { products: PRODUCTS, builder: { slots: slotsOf(mech.id, cap), target: { mode: "add" }, editingTemplateId: null, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  // новый пост: openPostBuilder даёт накладку по умолчанию из byKind (active)
  dom.$("postFrameSelect").dataset.preferredFrameId = String(defFrame.id);
  dom.$("postSlotCount").value = String(cap);
  const render = stand.run(["frameOptions", "builderCapacity", "renderBuilder"], ctx);
  render(); render();

  assert.ok(!dom.els.postFrameSelect.innerHTML.includes(`value="${FRAME_OFF.id}"`),
    "снятой с производства накладки НЕТ в списке выбора нового поста — она попадает в список только как УЖЕ стоящая в посте");
  assert.doesNotMatch(dom.els.postFrameSelect.innerHTML, /снята с производства/,
    "у нового поста в списке нет ни одной пометки «снята с производства»");
  assert.equal(dom.els.postFrameSelect.value, String(defFrame.id), "новый пост держит накладку по умолчанию");
});
