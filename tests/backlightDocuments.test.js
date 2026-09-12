/* Подсветка клавиш в ДОКУМЕНТАХ, уходящих наружу (B2a-1, PLAN 7.1). Дефект был денежно-
   составной: подсветка уже в цене поста и в смете КП (B1), но документы, собирающие СОСТАВ,
   о ней не знали — свод поставщику заказывал 0 LED из 2, лист монтажника и взрыв-схема молчали.
   Один документ брал с клиента деньги за LED, а заказ поставщику их не содержал.

   Проверяем ТРИ исходящих потребителя состава:
     · сводная спецификация поставщику (js/supplierSpec.js + supplierSpecData в app.js);
     · обвязка листа монтажника (js/installSheet.js buildFittings);
     · взрыв-схема (buildExplodedSpec в app.js).
   КП (offerPdf) получает подсветку через смету (estimate.js, B1) — её денежный край держит
   estimateBacklight.test.js, здесь он не дублируется.

   Часть тестов — на чистых модулях с рукотворным составом (быстро, детерминированно, краснеют
   на мутации самого модуля), часть — ЖИВАЯ: настоящий пост дефекта (механизмы 19021+19101,
   накладка 14931, подсветка 110-250V «Белая») собирается настоящими EPPosts/EPPostFit на
   отгружаемом каталоге и прогоняется через НАСТОЯЩИЕ app.js-функции (стенд). Сверка денег —
   количество LED в своде поставщику == количеству LED в смете КП для одного проекта. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");
const EPSupplierSpec = require("../js/supplierSpec.js");
const EPInstallSheet = require("../js/installSheet.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPPostFit = require("../js/postfit.js");
const EPBuilderSlots = require("../js/builderSlots.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

/* --- 1. Сводная спецификация поставщику (чистый EPSupplierSpec.collect) -------------------- */

const led = (code, name) => ({ code, name, unit: "шт." });
/* Пост для свода: минимальный набор полей контракта + подсветка. */
const specPost = over => Object.assign({
  mechanisms: [{ code: "19021", name: "Клавиша осевая", unit: "шт." }],
  frame: { code: "14931", name: "Накладка Eikon", unit: "шт." },
  support: null, supportCount: 0, box: null, boxCount: 0,
  backlight: [], backlightGaps: 0
}, over);

test("свод: подобранные LED — строки в группе «Подсветка клавиш» с количеством", () => {
  const data = EPSupplierSpec.collect({ posts: [specPost({
    backlight: [led("00936.250.W", "Светодиод белый"), led("00938.W", "Светодиод белый осевой")] })] });
  const w936 = data.rows.find(r => r.code === "00936.250.W");
  const w938 = data.rows.find(r => r.code === "00938.W");
  assert.ok(w936 && w938, "оба LED дошли до свода");
  assert.equal(w936.count, 1);
  assert.equal(w938.count, 1);
  assert.equal(w936.kind, "backlight", "LED — в своей группе, а не в «Прочих»");
});

test("свод: одинаковые LED из разных постов складываются в одну строку", () => {
  const p = () => specPost({ backlight: [led("00936.250.W", "Светодиод белый")] });
  const data = EPSupplierSpec.collect({ posts: [p(), p(), p()] });
  const row = data.rows.filter(r => r.code === "00936.250.W");
  assert.equal(row.length, 1, "один артикул — одна строка");
  assert.equal(row[0].count, 3, "количество сложилось по трём постам");
});

test("свод: пробел подсветки — строка БЕЗ артикула, в «Позициях без артикула», не в заказе", () => {
  const data = EPSupplierSpec.collect({ posts: [specPost({ backlight: [], backlightGaps: 2 })] });
  const gap = data.rows.find(r => r.kind === "backlight");
  assert.ok(gap, "строка пробела в своде есть");
  assert.equal(gap.code, null, "артикула нет — в заказ (по коду) она не идёт");
  assert.equal(gap.count, 2, "видно, сколько механизмов без подсветки");
  assert.equal(data.missing, 1, "свод считает её позицией без артикула");
});

test("свод: группа «Подсветка клавиш» стоит между механизмами и суппортами", () => {
  const data = EPSupplierSpec.collect({ posts: [specPost({
    backlight: [led("00936.250.W", "Светодиод")],
    support: { code: "09613", name: "Суппорт", unit: "шт." }, supportCount: 1,
    box: { code: "V71303", name: "Коробка", unit: "шт." }, boxCount: 1 })] });
  const kinds = [...new Set(data.rows.map(r => r.kind))];
  assert.deepEqual(kinds, ["frame", "mechanism", "backlight", "support", "box"],
    "порядок групп: накладки → механизмы → подсветка → суппорты → коробки");
});

test("свод: выключенная подсветка (нет поля/пусто) — документ байт в байт как раньше", () => {
  const withField = { posts: [specPost({ backlight: [], backlightGaps: 0 })] };
  const legacy = { posts: [{
    mechanisms: [{ code: "19021", name: "Клавиша осевая", unit: "шт." }],
    frame: { code: "14931", name: "Накладка Eikon", unit: "шт." },
    support: null, supportCount: 0, box: null, boxCount: 0 }] };   /* вовсе без полей подсветки */
  assert.equal(EPSupplierSpec.buildHtml(withField, deps), EPSupplierSpec.buildHtml(legacy, deps),
    "пустая подсветка и отсутствие полей дают одинаковый документ");
  assert.equal(EPSupplierSpec.collect(withField).rows.filter(r => r.kind === "backlight").length, 0,
    "и ни одной строки подсветки");
});

/* --- 2. Обвязка листа монтажника (чистый EPInstallSheet.buildFittings) --------------------- */

const acc = (code, name) => ({ code, name });
/* Состав поста для обвязки: накладка на месте, подсветка задаётся отдельно. */
const compFittings = over => Object.assign({
  support: null, supportCount: 0, supportNotRequired: false,
  boxCount: 0, frameAvailability: { unset: true },
  backlight: { enabled: false, items: [], gaps: [] }
}, over);

test("обвязка: подобранные LED — строки «Подсветка» с артикулом и количеством", () => {
  const comp = compFittings({ backlight: { enabled: true,
    items: [{ mechId: 1, accessory: acc("00936.250.W", "Светодиод белый") },
            { mechId: 2, accessory: acc("00938.W", "Светодиод осевой") }], gaps: [] } });
  const rows = EPInstallSheet.buildFittings(comp, null, []);
  const led936 = rows.find(f => f.code === "00936.250.W");
  const led938 = rows.find(f => f.code === "00938.W");
  assert.ok(led936 && led938, "оба LED в обвязке");
  assert.equal(led936.role, "Подсветка");
  assert.equal(led936.count, 1);
});

test("обвязка: одинаковые LED сводятся в count, а не в две строки", () => {
  const comp = compFittings({ backlight: { enabled: true,
    items: [{ mechId: 1, accessory: acc("00936.250.W", "Светодиод") },
            { mechId: 2, accessory: acc("00936.250.W", "Светодиод") }], gaps: [] } });
  const rows = EPInstallSheet.buildFittings(comp, null, []).filter(f => f.role === "Подсветка");
  assert.equal(rows.length, 1, "один артикул — одна строка");
  assert.equal(rows[0].count, 2, "две одинаковых клавиши — количество 2");
});

test("обвязка: пробел печатается словами со счётчиком и НУЛЁМ в количестве", () => {
  const comp = compFittings({ backlight: { enabled: true, items: [],
    gaps: [{ mechId: 1 }, { mechId: 2 }] } });
  const row = EPInstallSheet.buildFittings(comp, null, []).find(f => f.role === "Подсветка");
  assert.ok(row, "строка пробела есть");
  assert.match(row.name, /2 × подсветка не подобрана/, "словами и со счётчиком механизмов");
  assert.equal(row.count, 0, "в заказ не идёт — buildHtml напечатает прочерк");
});

test("обвязка: подсветка стоит за клавишами и до суппорта/коробки/накладки", () => {
  const comp = compFittings({
    support: { name: "Суппорт X", code: "09613" }, supportCount: 1,
    boxCount: 1, frameAvailability: { unset: false, displayName: "Накладка", code: "14931", state: "available" },
    backlight: { enabled: true, items: [{ mechId: 1, accessory: acc("00936.250.W", "Светодиод") }], gaps: [] } });
  const box = { name: "Коробка", code: "V71303" };
  const roles = EPInstallSheet.buildFittings(comp, box, []).map(f => f.role);
  const back = roles.indexOf("Подсветка");
  assert.ok(back > -1, "подсветка в обвязке есть");
  assert.ok(back < roles.indexOf("Суппорт"), "раньше суппорта");
  assert.ok(back < roles.indexOf("Монтажная коробка"), "раньше коробки");
  assert.ok(back < roles.indexOf("Накладка"), "раньше накладки");
});

test("обвязка: выключенная подсветка — строки те же, что без поля backlight", () => {
  const base = { support: { name: "Суппорт", code: "09613" }, supportCount: 1, boxCount: 1,
    frameAvailability: { unset: false, displayName: "Накладка", code: "14931", state: "available" } };
  const off = EPInstallSheet.buildFittings(Object.assign({}, base,
    { backlight: { enabled: false, items: [], gaps: [] } }), { name: "Коробка", code: "V71303" }, []);
  const legacy = EPInstallSheet.buildFittings(base, { name: "Коробка", code: "V71303" }, []);
  assert.deepEqual(off, legacy, "ни одной новой строки при выключенной подсветке");
});

/* --- 3. Живой пост дефекта: настоящий каталог + настоящие app.js-функции ------------------- */

/* Каталог и его атрибуты — теми же файлами, что грузит браузер (сборщика нет). Накладке
   подмешиваем стандарт/число постов ровно как js/data.js. */
const realProducts = (() => {
  const box = {};
  ["../js/catalog-vimar.js", "../js/catalog-vimar-attrs.js"].forEach(f =>
    new Function("window", "\"use strict\";" + fs.readFileSync(path.join(__dirname, f), "utf8"))(box));
  const standards = (box.EP_VIMAR_ATTRS && box.EP_VIMAR_ATTRS.standards) || {};
  return (box.EP_VIMAR_CATALOG.products || []).map(p => p.kind === "frame" && standards[p.code]
    ? Object.assign({}, p, { standard: standards[p.code].standard, postCount: standards[p.code].postCount })
    : p);
})();
const realById = new Map(realProducts.map(p => [p.id, p]));
const idByCode = code => (realProducts.find(p => p.code === code) || {}).id;
const ACCESSORIES = realProducts.filter(p => p.kind === "accessory" && p.askBacklight);
const findBacklight = opts => EPPostFit.findBacklight(Object.assign({ accessories: ACCESSORIES }, opts));
/* Коробку/суппорт намеренно не подбираем: на количество LED они не влияют, а тест держит именно
   подсветку. Тип стены задан, чтобы postComposition не спотыкался. */
const realDeps = bl => ({
  product: id => realById.get(id), frameProduct: id => realById.get(id),
  mechanismSpan: it => (it && it.moduleSpan) || 1,
  findBox: () => null, fallbackBox: () => null,
  supportRequired: () => true, resolveSupport: () => ({ support: null, assumed: false }),
  findBacklight, backlight: bl, wallType: "solid"
});
/* Пост дефекта: механизмы 19021 (осевой, pos 3) + 19101 (pos 2), накладка 14931. */
const defectPost = () => ({ id: "p1", number: 1, name: "Пост дефекта",
  frameId: idByCode("14931"), mechanismIds: [idByCode("19021"), idByCode("19101")] });
const WHITE = { enabled: true, color: "Белая", voltage: "110-250V" };
const V120 = { enabled: true, color: "Белая", voltage: "120V" };   // pos 2 (осевые) на 120V в каталоге нет → пробел
/* Пост с ДВУМЯ ОДИНАКОВЫМИ механизмами (обе клавиши принимают подсветку) — дубль ВНУТРИ поста,
   а не дубль поста. На нём ловится схлопывание одинаковых артикулов подсветки в своде: обе
   клавиши дают 00936.250.W, и заказ обязан содержать ×2. */
const dupPost = () => ({ id: "pd", number: 9, name: "Две одинаковые клавиши",
  frameId: idByCode("14931"), mechanismIds: [idByCode("14021"), idByCode("14021")] });
/* Осевой (pos 2) + клавиша (pos 3) — штатный «осевой + клавиша». На 110-250V оба LED подобраны
   (пробелов нет), на 120V осевому пары в каталоге нет (ровно один пробел). */
const mixedPost = () => ({ id: "pm", number: 7, name: "Осевой + клавиша",
  frameId: idByCode("14931"), mechanismIds: [idByCode("14021"), idByCode("19101")] });
/* 09001 подсветку НЕ принимает, 14021 принимает — на нём проверяется привязка LED к своей клавише
   во взрыв-схеме (LED не должен уехать к соседу по порядку слота). */
const nonAcceptPost = () => ({ id: "pna", number: 5, name: "Глухой + принимающий",
  frameId: idByCode("14931"), mechanismIds: [idByCode("09001"), idByCode("14021")] });

/* Настоящий supplierSpecData из app.js — исполняем его текст в стенде поверх настоящего
   postComposition. Мутация backlight-строк в app.js покраснит эти тесты. */
const supplierDataFor = (posts, bl) => {
  const build = stand.run("supplierSpecData", {
    state: { posts, devices: [] },
    product: id => realById.get(id),
    postComposition: p => EPPosts.postComposition(p, realDeps(bl)),
    lightingRowsFor: () => [],
    EPLightingGroups: { isSupplyGap: () => false },
    EPSupplierSpec
  });
  return EPSupplierSpec.collect(build({ plan: { relayTotal: 0 } }));
};
/* Смета того же проекта — как её собирает buildEstimate в app.js (тот же postComposition). */
const estimateFor = (posts, bl) => EPEstimate.build({
  devices: [], posts,
  product: id => realById.get(id), frameProduct: id => realById.get(id),
  postCost: p => EPPosts.postCost(p, realDeps(bl)),
  postComposition: p => EPPosts.postComposition(p, realDeps(bl)),
  lightingOf: () => [], settings: {}
});
const ledCountSupplier = data => data.rows.filter(r => r.kind === "backlight" && r.code)
  .reduce((s, r) => s + r.count, 0);
const ledCountEstimate = est => est.groups.reduce((s, g) => s +
  (g.items || []).filter(it => it.kind === "backlight" && it.code).reduce((a, it) => a + it.count * g.count, 0), 0);
/* Пробелы подсветки (строки БЕЗ артикула): в своде — строка kind backlight без code, в смете —
   позиция kind backlight без code (gap). Число пробелов документов обязано совпадать: иначе один
   документ печатает «подсветка не подобрана», а другой молчит об одном и том же проекте. */
const gapCountSupplier = data => data.rows.filter(r => r.kind === "backlight" && !r.code)
  .reduce((s, r) => s + r.count, 0);
const gapCountEstimate = est => est.groups.reduce((s, g) => s +
  (g.items || []).filter(it => it.kind === "backlight" && !it.code).reduce((a, it) => a + it.count * g.count, 0), 0);

test("ЖИВОЙ дефект: свод поставщику содержит 00936.250.W ×1 и 00938.W ×1", () => {
  const data = supplierDataFor([defectPost()], WHITE);
  assert.equal((data.rows.find(r => r.code === "00936.250.W") || {}).count, 1,
    "LED осевой клавиши (pos 3, 110-250V) заказан");
  assert.equal((data.rows.find(r => r.code === "00938.W") || {}).count, 1,
    "LED осевого выключателя (pos 2, 110-250V) заказан");
});

test("СВЕРКА ДЕНЕГ: LED в своде поставщику == LED в смете КП для одного проекта", () => {
  /* Дефект денежно-составной: один документ берёт с клиента деньги за LED, другой их не
     заказывает. Проект нарочно с ПОВТОРОМ поста (смета сольёт его в строку с количеством) —
     чтобы количество LED считалось обоими путями, а не совпадало случайно на единице. */
  const posts = [defectPost(), Object.assign(defectPost(), { id: "p2", number: 2 })];
  const data = supplierDataFor(posts, WHITE);
  const est = estimateFor(posts, WHITE);
  assert.equal(ledCountSupplier(data), 4, "два поста × два LED = четыре в своде");
  assert.equal(ledCountEstimate(est), 4, "и столько же в смете");
  assert.equal(ledCountSupplier(data), ledCountEstimate(est),
    "документы не расходятся по количеству оплаченного товара");
});

test("СВЕРКА ДЕНЕГ: два ОДИНАКОВЫХ механизма в посте — свод не недозаказывает LED", () => {
  /* Прежняя сверка дублировала ПОСТ, где каждый артикул встречается по разу; схлопывание
     одинаковых артикулов ВНУТРИ поста (обе клавиши 14021 → один и тот же 00936.250.W) она не
     ловила. Здесь дубль внутри поста: смета даёт ×2, и свод обязан заказать столько же. */
  const posts = [dupPost()];
  const data = supplierDataFor(posts, WHITE);
  const est = estimateFor(posts, WHITE);
  assert.equal(ledCountEstimate(est), 2, "14021+14021 — два LED 00936.250.W в смете");
  assert.equal(ledCountSupplier(data), 2, "столько же в заказе поставщику");
  assert.equal(ledCountSupplier(data), ledCountEstimate(est),
    "схлопывание одинаковых артикулов в посте не должно ронять количество заказа");
});

test("СВЕРКА СОСТАВА: пробелов подсветки в своде == смете, когда пробелов НЕТ", () => {
  /* 14021 (pos 3) + 19101 (осевой pos 2) на 110-250V — обоим LED подобран, пробелов ноль.
     Свод не должен выдумывать «подсветка не подобрана»: число пробелов сверяем со сметой того
     же проекта, а не с нулём вслепую. */
  const posts = [mixedPost()];
  const data = supplierDataFor(posts, WHITE);
  const est = estimateFor(posts, WHITE);
  assert.equal(gapCountEstimate(est), 0, "оба LED подобраны — в смете пробелов нет");
  assert.equal(gapCountSupplier(data), 0, "и в своде поставщику ни одной строки «не подобрана»");
  assert.equal(gapCountSupplier(data), gapCountEstimate(est), "число пробелов документов сходится");
});

test("СВЕРКА СОСТАВА: пробелов подсветки в своде == смете, когда пробел ЕСТЬ", () => {
  /* Тот же пост на 120V: клавише LED есть, осевому (pos 2) на 120V пары в каталоге нет — ровно
     один честный пробел. Свод обязан показать его РОВНО столько же раз, сколько смета. */
  const posts = [mixedPost()];
  const data = supplierDataFor(posts, V120);
  const est = estimateFor(posts, V120);
  assert.equal(gapCountEstimate(est), 1, "осевому на 120V подсветки нет — один пробел в смете");
  assert.equal(gapCountSupplier(data), 1, "свод обязан показать ровно один пробел");
  assert.equal(gapCountSupplier(data), gapCountEstimate(est), "число пробелов документов сходится");
});

test("ЖИВОЙ дефект: выключенная подсветка — в своде ни одной строки LED", () => {
  const data = supplierDataFor([defectPost()], { enabled: false });
  assert.equal(data.rows.filter(r => r.kind === "backlight").length, 0, "подсветки в заказе нет");
});

/* Взрыв-схема: исполняем настоящие buildExplodedSpec+buildPostSheet, EPExplodedView подменён
   на сериализацию spec — так видно, какие детали ушли в схему. */
const explodedPartsFor = (bl, post) => {
  const build = stand.run(["buildExplodedSpec", "buildPostSheet"], {
    postComposition: p => EPPosts.postComposition(p, realDeps(bl)),
    product: id => realById.get(id),
    mechanismSpan: it => (it && it.moduleSpan) || 1,
    lightingRowsFor: () => [],
    EPLightingGroups: { isSupplyGap: () => false },
    EPPosts, EPBuilderSlots,
    keySlotKind: () => false,
    EPInstallSheet,
    state: { rooms: [] },
    assembledPostSpec: () => ({ size: "md", frame: null, rows: [] }),
    EPPostImage: { buildHtml: () => "", photoReady: () => false, pickIcon: () => "generic", iconSvg: () => "" },
    EPExplodedView: { buildHtml: spec => JSON.stringify(spec) },
    productImage: () => "",
    esc,
    STANDARD_LABEL: { unknown: "неизвестный", BOTH: "универсальный" }
  });
  const sheet = build(post || defectPost(), { plan: {} });
  return JSON.parse(sheet.explodedViewHtml).parts;
};

test("ЖИВОЙ дефект: взрыв-схема показывает LED при своих механизмах", () => {
  const parts = explodedPartsFor(WHITE);
  const led936 = parts.find(p => p.code === "00936.250.W");
  const led938 = parts.find(p => p.code === "00938.W");
  assert.ok(led936 && led938, "оба LED — детали взрыв-схемы");
  assert.match(led936.pos || "", /подсветка/, "LED подписан как подсветка своей клавиши");
  assert.equal(led936.role, "Модуль", "и свёрнут в колонку своей клавиши, а не в отдельный столбец");
});

test("ЖИВОЙ дефект: выключенная подсветка — во взрыв-схеме LED нет", () => {
  const parts = explodedPartsFor({ enabled: false });
  assert.equal(parts.filter(p => /подсветка/.test(p.pos || "")).length, 0, "деталей подсветки нет");
});

test("ЖИВОЙ дефект: LED привязан к СВОЕЙ клавише, а не к соседней по порядку слота", () => {
  /* 09001 подсветку не принимает, 14021 принимает. LED обязан оказаться при 14021: если брать
     LED по порядку слота, а не по mechId, он уедет под 09001 — монтажник вставит его в механизм,
     который его физически не принимает. Адрес детали в схеме — «<модуль клавиши> · подсветка». */
  const parts = explodedPartsFor(WHITE, nonAcceptPost());
  const mod09001 = parts.find(p => p.code === "09001");
  const mod14021 = parts.find(p => p.code === "14021");
  const ledPart = parts.find(p => p.code === "00936.250.W");
  assert.ok(mod09001 && mod14021 && ledPart, "оба механизма и LED — детали схемы");
  assert.notEqual(mod09001.pos, mod14021.pos, "у клавиш разные адреса модулей — проверка различает их");
  assert.equal(ledPart.pos, mod14021.pos + " · подсветка",
    "LED подписан адресом клавиши 14021, которая его принимает");
  assert.notEqual(ledPart.pos, mod09001.pos + " · подсветка",
    "и не адресом 09001, который подсветку не принимает");
});
