/* ПОВЕДЕНЧЕСКИЙ регресс: механизм, чей АРТИКУЛ ПРОПАЛ из перезалитого прайса (product не
   разрешается в товар вовсе), НЕ выпадает молча из состава поста при перерисовке конструктора
   (js/app.js renderBuilder / pickBuilderProduct). Слот остаётся ЯВНЫМ ПРОБЕЛОМ, названным во всех
   документах, сохранение РАЗРЕШЕНО (решение владельца, часть 1).

   ДЕФЕКТ. keepMechs удерживает только СНЯТЫЕ механизмы (product есть, active:false). У пропавшего
   артикула товара нет: его нет ни в mechs, ни в keepMechs, allowedTokens его токен не пускает, а
   mechanismSpan(null)=0 — fitMechanismIds роняет слот по ветке `!span`. Пост «худеет» на механизм,
   цена падает, а адреса СОСЕДНИХ модулей сдвигаются: был «1–2 выключатель, 3 розетка, 4 диммер»,
   выпал второй — и «3» встаёт туда, где физически 4-е место (монтажник получает неверную
   нумерацию).

   ДВА СОСТОЯНИЯ РАЗЛИЧАЮТСЯ (как у накладки, EPPosts.frameAvailability): «снят с производства»
   (товар есть, цена известна — mechanismDiscontinuedKeptWiring.test.js) и «артикул пропал» (товара
   нет, посчитать нечего — этот тест). Формулировки и пометки отличаются.

   ЧТО КРАСНЕЕТ (мутационная таблица — в отчёте):
   1) возврат выбрасывания: allowedTokens снова зовут без missingMechIds → пропавший механизм
      выпадает, состав/цена «худеют», адреса соседних модулей сдвигаются;
   2) сдвиг адресов: moduleLayout после render перестаёт давать 1,2,3;
   3) пропажа формулировки: снятие missingMechNoticeHtml / .builder-notice в составе, или
      исчезновение позиции «Механизм не найден (арт. N)» из сметы (est.missing / composition);
   4) молчаливый итог: renderSummary перестаёт называть позиции без цены (#pricelessStatus);
   5) попадание пропавшего артикула в предложение новым: builderCtx.mechs (каталог карточек).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPEstimate = require("../js/estimate.js");
const EPBuilderSlots = require("../js/builderSlots.js");

/* Настоящий каталог VIMAR. Пропавший артикул НЕ существует в каталоге вовсе (product вернёт
   undefined) — именно это состояние отличает «артикул пропал» от «снят с производства». */
const RAW = stand.loadVimarCatalog().products;
const GONE_ID = 9999999;                          // такого id в каталоге нет — артикул «пропал»
assert.equal(RAW.find(p => Number(p.id) === GONE_ID), undefined, "разведка: GONE_ID не должен существовать в каталоге");

const FRAME = RAW.find(p => p.code === "09673.01");   // Neve Up, 3 модуля
assert.ok(FRAME, "разведка: накладка 09673.01 (Neve Up, 3М) должна быть в каталоге");
const CAP = EPCatalog.frameSlotCount(FRAME);
assert.equal(CAP, 3, "предпосылка: накладка на 3 модуля");

const MECH = RAW.find(p => p.kind === "mechanism" && p.active &&
  EPCatalog.mechanismSpan(p) === 1 && EPCatalog.productSeries(p).includes("Neve Up"));
assert.ok(MECH, "разведка: есть активный одномодульный механизм Neve Up");

const slotsOf = ids => EPBuilderSlots.fromPost({ mechanismIds: ids.map(Number) }, () => false);

/* Контекст vm — как в mechanismDiscontinuedKeptWiring.test.js: доменная логика и каталог
   настоящие, renderBuilderSlots/Catalog/Composition — заглушки одного контракта (пишут в
   DOM-хост, откуда читаем). */
function makeCtx(products, dom) {
  const product = id => products.find(p => Number(p.id) === Number(id));
  const byKind = kind => products.filter(x => x.kind === kind && x.active);
  return {
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
}

const makeDom = () => stand.makeDom({ selects: ["postFrameSelect"] });

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

test("renderBuilder: пропавший артикул НЕ выброшен — слот держится пробелом, адреса модулей не сдвинулись", () => {
  const products = RAW.map(p => ({ ...p }));
  const product = id => products.find(p => Number(p.id) === Number(id));
  // пост: механизм, ПРОПАВШИЙ артикул, механизм — все одномодульные, в накладку на 3 модуля
  const { ctx } = twoRenders(products, [MECH.id, GONE_ID, MECH.id]);

  assert.equal(ctx.state.builder.slots.length, 3,
    "все три слота удержаны — пропавший артикул не выпал молча вместе с соседями");
  assert.equal(Number(ctx.state.builder.slots[1].id), GONE_ID,
    "средний слот — именно пропавший артикул, а не сдвинутый на его место сосед");
  assert.equal(product(GONE_ID), undefined, "предпосылка теста: у среднего слота товара нет (артикул пропал)");

  // адреса модулей: 1,2,3 — пробел занимает своё 2-е место, соседи не съехали
  const ids = Array.from(ctx.state.builder.slots, s => Number(s.id));   // из vm-реалма → в реалм теста
  const labels = EPPosts.moduleLayout(ids, { product, mechanismSpan: EPCatalog.mechanismSpan }).map(l => l.label);
  assert.equal(labels.join(","), "1,2,3",
    "адреса модулей 1,2,3 — пробел держит 2-е место, лист монтажника не получит сдвинутую нумерацию");

  // КОНТРОЛЬ: тот же пост, но средний артикул существует — состав и адреса те же
  const ctrl = twoRenders(products, [MECH.id, MECH.id, MECH.id]);
  assert.equal(ctrl.ctx.state.builder.slots.length, 3, "контроль: пост из трёх существующих механизмов — 3 слота");
});

test("renderBuilder: пробел назван и посчитан деньгами как ноль — нормальный пост в деньгах не задет", () => {
  const products = RAW.map(p => ({ ...p }));
  const frameProduct = id => products.find(p => Number(p.id) === Number(id));
  const product = frameProduct;
  const deps = { product, frameProduct, mechanismSpan: EPCatalog.mechanismSpan };

  const normal = EPPosts.postCost({ frameId: FRAME.id, mechanismIds: [MECH.id, MECH.id, MECH.id] }, deps);
  const gap = EPPosts.postCost({ frameId: FRAME.id, mechanismIds: [MECH.id, GONE_ID, MECH.id] }, deps);
  assert.ok(normal > 0, "нормальный пост стоит денег");
  assert.equal(Number((normal - gap).toFixed(4)), Number(MECH.price.toFixed(4)),
    "разница ровно в цену одного механизма: пробел добавляет 0, остальные позиции не переоценены");

  // пробел занимает 1 модуль в раскладке — пост заполнен целиком, сохранение не блокируется пробелом
  const dist = EPPosts.distributePosts([MECH.id, GONE_ID, MECH.id], FRAME, deps);
  assert.equal(dist.totalOccupied, 3, "пробел занимает 1 модуль — накладка на 3 модуля заполнена");
  assert.equal(dist.full, true, "пост полон: сохранение разрешено (пробел не мешает)");
});

test("renderBuilder: пометка «артикул пропал» отличается от «снят с производства» и доходит до состава", () => {
  const products = RAW.map(p => ({ ...p }));
  const { ctx } = twoRenders(products, [MECH.id, GONE_ID, MECH.id]);

  assert.equal(ctx.builderCtx.missingMechIds.length, 1, "ровно один пропавший артикул удерживается");
  assert.equal(Number(ctx.builderCtx.missingMechIds[0]), GONE_ID,
    "builderCtx.missingMechIds содержит пропавший артикул — им кормится удержание в fit/replace");
  assert.match(ctx.builderCtx.errorHtml, /builder-notice/, "пометка пробела — .builder-notice (сообщает, не блокирует)");
  assert.match(ctx.builderCtx.errorHtml, /Артикул механизма пропал из каталога/,
    "формулировка «пропал» — ОТЛИЧНАЯ от «снят с производства» (там товар есть)");
  assert.match(ctx.builderCtx.errorHtml, new RegExp(String(GONE_ID)), "пометка называет номер пропавшего артикула");
  assert.doesNotMatch(ctx.builderCtx.errorHtml, /снят с производства/,
    "у пропавшего артикула НЕ печатается формулировка снятого — состояния не путаются");
  assert.match(ctx.$("builderComposition").innerHTML, /Артикул механизма пропал/, "пометка доходит до composition-хоста");

  // сохранение РАЗРЕШЕНО (пост из 3 модулей заполнен: 2 механизма + пробел)
  assert.equal(ctx.$("savePost").disabled, false, "сохранение разрешено — пробел не блокирует (решение владельца, часть 1)");

  // пропавший артикул НЕ предлагается новым: у него нет товара, каталог карточек его не несёт
  assert.ok(!(ctx.builderCtx.mechs || []).some(m => Number(m.id) === GONE_ID),
    "builderCtx.mechs (каталог) не содержит пропавший артикул — карточкой он не предлагается");
});

test("смета: пропавший артикул НАЗВАН строкой и посчитан в missing (КП/свод не растворяют его)", () => {
  const products = RAW.map(p => ({ ...p }));
  const product = id => products.find(p => Number(p.id) === Number(id));
  const frameProduct = product;
  const deps = { product, frameProduct, mechanismSpan: EPCatalog.mechanismSpan };
  const post = { id: "p1", name: "Пост № 1", frameId: FRAME.id, mechanismIds: [MECH.id, GONE_ID, MECH.id] };

  const est = EPEstimate.build({
    posts: [post], devices: [], product, frameProduct,
    postCost: p => EPPosts.postCost(p, deps),
    postComposition: p => EPPosts.postComposition(p, deps),
    lightingOf: () => [], settings: {}
  });
  assert.ok(est.missing.includes(GONE_ID), "est.missing содержит пропавший артикул — по нему итог оговаривается");
  assert.match(est.groups[0].composition, new RegExp(`Механизм не найден \\(арт\\. ${GONE_ID}\\)`),
    "состав позиции называет пропавший артикул человеку — он не выпадает из КП/сметы");
});

test("превью: пропавший артикул рисуется ЯВНЫМ пробелом в 1 модуль, а не схлопывается в ноль", () => {
  const EPPostImage = require("../js/postImage.js");
  const esc = s => String(s == null ? "" : s);
  const html = EPPostImage.buildHtml({
    size: "lg", frame: { name: "белая накладка", standard: "IT" },
    rows: [{ posts: [{ capacity: 3, cells: [
      { span: 1, categoryId: 500, num: "1", name: "Выключатель" },
      { span: 1, missing: true, num: "2", name: `Механизм не найден (арт. ${GONE_ID})` },
      { span: 1, categoryId: 500, num: "3", name: "Выключатель" }
    ] }] }]
  }, { esc });

  assert.equal((html.match(/data-ep="cell"/g) || []).length, 3,
    "три ячейки модулей — пробел не схлопнулся, адреса соседей сохранены");
  assert.match(html, /dashed/, "пробел нарисован пунктиром — читается как потерянная позиция, не как свободный модуль");
  assert.match(html, new RegExp(`Механизм не найден \\(арт\\. ${GONE_ID}\\)`), "у ячейки-пробела есть человеческое имя (title)");
});

test("renderSummary: итог ОГОВАРИВАЕТ позиции без цены (#pricelessStatus), а не молча суммирует", () => {
  const dom = stand.makeDom();
  const ctx = {
    state: { rooms: [], devices: [], posts: [] },
    $: dom.$,
    projectLighting: () => ({}),
    buildEstimate: () => ({
      equipment: 0, materials: 0, work: 0, total: 0,
      discount: 0, discountPercent: 0, vat: 0, vatPercent: 0, groups: [],
      missing: [GONE_ID, GONE_ID + 1]   // две позиции без цены
    }),
    money: v => "money(" + v + ")",
    esc: s => String(s),
    lightingHtml: () => "[LIGHT]",
    orphanObjectsWarningText: () => "",
    updateStatus: () => {},
    EPRoomAssign: require("../js/roomAssign.js")
  };
  const render = stand.run("renderSummary", ctx);
  render();
  assert.equal(dom.$("pricelessStatus").hidden, false, "строка показана, пока в проекте есть позиции без цены");
  assert.match(dom.$("pricelessStatus").textContent, /Позиций без цены: 2/, "итог называет ЧИСЛО позиций без цены");
  assert.match(dom.$("pricelessStatus").textContent, /неполна/, "итог честно говорит, что сумма неполна");

  // нет пропавших — строка гаснет
  ctx.buildEstimate = () => ({ equipment: 0, materials: 0, work: 0, total: 0, discount: 0, discountPercent: 0, vat: 0, vatPercent: 0, groups: [], missing: [] });
  render();
  assert.equal(dom.$("pricelessStatus").hidden, true, "нет позиций без цены → строка скрыта");
  assert.equal(dom.$("pricelessStatus").textContent, "", "…и очищена");
});
