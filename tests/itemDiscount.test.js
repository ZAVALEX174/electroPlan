/* А2 — СКИДКА НА ОТДЕЛЬНЫЕ ПОЗИЦИИ (итоги встречи 24.08 §1.2: «Скидки — на весь объём, с
   возможностью правки отдельных позиций»). РЕДАКЦИЯ 2: личная скидка живёт НА ОБЪЕКТЕ
   (post.discount/device.discount), не в карте по ключу строки — прежняя карта «уплывала» при
   перенумерации/смене стены/назначении группы.

   Слои:
   1) ЧИСТЫЕ discountOf / discountBreakdown — на числах (общая, личная, 0 против пусто, смесь,
      зажим, совпадение с прежней формулой по копейке).
   2) build() с discount на объектах: применение, группировка (разные скидки — разные строки),
      база работ/материалов/НДС от суммы за вычетом скидок, обратная совместимость.
   3) «Скидка держится за объектом»: перенумерация, смена стены, назначение группы, «Очистить» —
      скидка не теряется и не переезжает на чужой пост.
   4) Связки app.js: панель показывает поле; applyItemDiscount правит ВСЕ объекты строки, пусто
      снимает, нечисловой ввод игнорируется; обработчик зовёт пересчёт.
   5) КП/раскладка: пометки, десятичная запятая, пояснение при смеси, гейт по ценам.
   6) «Разместить» не копирует скидку; «Сохранить пост» её сохраняет; персистентность через снапшот.
   7) ФАЗЗ: без личных скидок смета совпадает с прежней формулой на 100%.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPOfferOptions = require("../js/offerOptions.js");
const { buildHtml } = require("../js/offerPdf.js");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: получено ${a}, ожидалось ${b}`);

/* ─────────────── 1. discountOf / discountBreakdown ─────────────── */

test("discountOf: нет своей → общая (не личная); своя, отличная от общей → личная", () => {
  assert.deepEqual(EPEstimate.discountOf(undefined, 10), { percent: 10, personal: false });
  assert.deepEqual(EPEstimate.discountOf(null, 10), { percent: 10, personal: false });
  assert.deepEqual(EPEstimate.discountOf("", 10), { percent: 10, personal: false });
  assert.deepEqual(EPEstimate.discountOf(20, 10), { percent: 20, personal: true });
});

test("discountOf: своя = общей → НЕ смесь; своя 0 при общей>0 → «без скидки» (личная)", () => {
  assert.deepEqual(EPEstimate.discountOf(10, 10), { percent: 10, personal: false }, "10 при общей 10 — не отличается");
  assert.deepEqual(EPEstimate.discountOf(0, 10), { percent: 0, personal: true }, "0 при 10 — личная «без скидки»");
  assert.deepEqual(EPEstimate.discountOf(0, 0), { percent: 0, personal: false }, "0 при общей 0 — не отличается");
});

test("discountOf: ввод вне 0..100 зажимается как общая скидка", () => {
  assert.equal(EPEstimate.discountOf(150, 0).percent, 100);
  assert.equal(EPEstimate.discountOf(-20, 0).percent, 0);
});

test("discountBreakdown: без личных — итог одним умножением = equipment×общий%/100 (совместимость по копейке)", () => {
  /* Суммы подобраны так, что построчное сложение (169.47×3%) дало бы ±1 цент против общей базы. */
  const rows = [{ sum: 169.47 }, { sum: 168.94 }, { sum: 168 }];
  const equipment = rows.reduce((s, r) => s + r.sum, 0);
  const db = EPEstimate.discountBreakdown(rows, 3);
  assert.equal(db.mixed, false, "личных скидок нет — не смесь");
  assert.equal(db.total, equipment * 3 / 100, "итог считается ОДНИМ умножением, а не суммой построчных");
});

test("discountBreakdown: смесь — своя часть по строке, общая часть от остатка", () => {
  const rows = [{ sum: 100, discount: 20 }, { sum: 50 }];
  const db = EPEstimate.discountBreakdown(rows, 10);
  assert.equal(db.mixed, true);
  near(db.total, 100 * 0.2 + 50 * 0.1, "20% с первой + 10% со второй");
  assert.equal(db.rows[0].personal, true);
  assert.equal(db.rows[1].personal, false);
});

/* ─────────────── 2. build() с discount на объектах ─────────────── */

const CATALOG = {
  1: { id: 1, name: "Механизм A", code: "M-A", price: 10, unit: "шт." },
  2: { id: 2, name: "Механизм B", code: "M-B", price: 5, unit: "шт." },
  90: { id: 90, name: "Рамка", code: "F-1", price: 8, unit: "шт." },
  7: { id: 7, name: "Розетка", code: "R-1", price: 12, unit: "шт." }
};
const product = id => CATALOG[id];
const postCost = po => (product(po.frameId)?.price || 0) + (po.mechanismIds || []).reduce((s, id) => s + (product(id)?.price || 0), 0);
const build = over => EPEstimate.build(Object.assign({
  devices: [], posts: [], product, frameProduct: product, postCost,
  settings: { workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 0, vatMode: "none" }
}, over));
const withSettings = over => ({ settings: Object.assign({ workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 0, vatMode: "none" }, over) });

test("build: post.discount задаёт личный процент строки поста", () => {
  const e = build(Object.assign({ posts: [{ number: 1, frameId: 90, mechanismIds: [1] }] }, withSettings({ discountPercent: 10 })));
  const noDisc = e.groups[0];
  assert.equal(noDisc.discountPercent, 10, "без своей — общая");
  const e2 = build(Object.assign({ posts: [{ number: 1, frameId: 90, mechanismIds: [1], discount: 25 }] }, withSettings({ discountPercent: 10 })));
  assert.equal(e2.groups[0].discountPercent, 25);
  assert.equal(e2.groups[0].discountPersonal, true);
  assert.equal(e2.discountMixed, true);
});

test("build: device.discount задаёт личный процент строки изделия", () => {
  const e = build(Object.assign({ devices: [{ productId: 7, discount: 30 }] }, withSettings({ discountPercent: 10 })));
  assert.equal(e.groups[0].discountPercent, 30);
  near(e.discount, 12 * 0.3, "12 € × 30%");
});

test("build: одинаковые объекты с РАЗНОЙ скидкой — РАЗНЫЕ строки, каждая со своей", () => {
  const e = build(Object.assign({
    devices: [{ productId: 7, discount: 20 }, { productId: 7 }, { productId: 7, discount: 20 }]
  }, withSettings({ discountPercent: 10 })));
  /* Две «Розетки со скидкой 20%» сходятся в одну строку (count 2), одна без своей — отдельная. */
  assert.equal(e.groups.length, 2, "две строки: со своей 20% и по общей");
  const own = e.groups.find(g => g.discountPersonal);
  const gen = e.groups.find(g => !g.discountPersonal);
  assert.equal(own.count, 2, "одинаковая своя скидка сводит строки вместе");
  assert.equal(gen.count, 1);
  assert.equal(own.members.length, 2, "members строки — оба объекта со скидкой");
});

test("build: своя = общей → не смесь и без разбиения по проценту (но своя строка по суффиксу)", () => {
  const e = build(Object.assign({ devices: [{ productId: 7, discount: 10 }] }, withSettings({ discountPercent: 10 })));
  assert.equal(e.groups[0].discountPersonal, false, "10% при общей 10% от общей не отличается");
  assert.equal(e.discountMixed, false);
});

test("build: база работ/материалов/НДС = оборудование − сумма скидок (личных в т.ч.)", () => {
  const e = build(Object.assign({ devices: [{ productId: 7, discount: 50 }] },
    withSettings({ discountPercent: 0, workPercent: 20, materialsPercent: 10, vatPercent: 20, vatMode: "surcharge" })));
  near(e.discount, 6, "12 € × 50% = 6 €");
  near(e.equipmentNet, 6, "оборудование за вычетом личной скидки");
  near(e.work, 1.2, "работы 20% от 6, а не от 12");
  near(e.materials, 0.6, "материалы 10% от 6");
  near(e.vat, (6 + 1.2 + 0.6) * 0.2, "НДС от базы после скидки");
});

test("build: обратная совместимость — нет discount → total = equipment×общий%/100 точно, число строк прежнее", () => {
  const posts = [{ number: 1, frameId: 90, mechanismIds: [1] }, { number: 2, frameId: 90, mechanismIds: [1] }];
  const e = build(Object.assign({ posts }, withSettings({ discountPercent: 15 })));
  assert.equal(e.groups.length, 1, "два одинаковых поста без скидки — одна строка (ключ прежний)");
  assert.equal(e.discount, e.equipment * 15 / 100, "скидка совпадает с прежней формулой точно");
});

/* ─────────────── 3. Скидка держится за объектом ─────────────── */

test("перенумерация не двигает скидку: она читается из объекта, а не из номера/позиции", () => {
  const A = { number: 1, frameId: 90, mechanismIds: [1], discount: 20 };
  const B = { number: 2, frameId: 90, mechanismIds: [1] };
  const e1 = build(Object.assign({ posts: [A, B] }, withSettings({ discountPercent: 10 })));
  A.number = 99; B.number = 1;   // перенумеровали
  const e2 = build(Object.assign({ posts: [A, B] }, withSettings({ discountPercent: 10 })));
  const own1 = e1.groups.find(g => g.discountPersonal), own2 = e2.groups.find(g => g.discountPersonal);
  assert.equal(own1.discountPercent, 20);
  assert.equal(own2.discountPercent, 20, "после перенумерации скидка на том же посте");
  assert.equal(e2.groups.find(g => !g.discountPersonal).discountPercent, 10, "второй по-прежнему по общей");
});

test("смена типа стены проекта не дарит скидку чужому посту", () => {
  const A = { number: 1, frameId: 90, mechanismIds: [1], discount: 30 };
  const B = { number: 2, frameId: 90, mechanismIds: [1] };
  const solid = build(Object.assign({ posts: [A, B] }, withSettings({ discountPercent: 0, wallType: "solid" })));
  const hollow = build(Object.assign({ posts: [A, B] }, withSettings({ discountPercent: 0, wallType: "hollow" })));
  for (const e of [solid, hollow]) {
    const own = e.groups.filter(g => g.discountPersonal);
    assert.equal(own.length, 1, "личная скидка ровно у одной строки");
    assert.equal(own[0].discountPercent, 30);
    near(e.discount, 18 * 0.3, "скидка 30% только с поста A (8+10)");
  }
});

test("назначение группы света (смена ключа |l:) не теряет скидку поста", () => {
  const A = { number: 1, frameId: 90, mechanismIds: [1], discount: 40 };
  /* lightingOf добавляет строку клавиши с группой — в ключ уходит суффикс |l:, но discount читается
     из объекта и приезжает суффиксом |d: последним. */
  const lightingOf = po => po === A ? [{ code: "M-A", name: "Выключатель", price: 0, groupLabel: "Кухня", kind: "switch" }] : [];
  const e = build(Object.assign({ posts: [A], lightingOf }, withSettings({ discountPercent: 10 })));
  assert.equal(e.groups[0].discountPercent, 40, "скидка на месте несмотря на смену состава строки");
  assert.ok(e.groups[0].key.includes("|d:40"), "суффикс скидки в ключе последним");
});

test("«Очистить»/удаление объекта уносит скидку — на новом посте того же состава её нет", () => {
  const A = { number: 1, frameId: 90, mechanismIds: [1], discount: 50 };
  near(build(Object.assign({ posts: [A] }, withSettings({ discountPercent: 0 }))).discount, 18 * 0.5, "скидка есть");
  assert.equal(build(Object.assign({ posts: [] }, withSettings({ discountPercent: 0 }))).discount, 0, "после очистки — ноль");
  const fresh = { number: 1, frameId: 90, mechanismIds: [1] };   // тот же состав, БЕЗ скидки
  assert.equal(build(Object.assign({ posts: [fresh] }, withSettings({ discountPercent: 0 }))).discount, 0,
    "осиротевшая скидка не оживает на новом посте того же состава");
});

/* ─────────────── 4. Связки app.js ─────────────── */

function renderSpecDom(over) {
  const dom = stand.makeDom();
  const est = build(over);
  stand.run("renderSummary", {
    state: { rooms: [], devices: [], posts: [] },
    EPEstimate, $: dom.$, money: v => "€" + Number(v).toFixed(2), esc: String,
    projectLighting: () => ({}), buildEstimate: () => est,
    lightingHtml: () => "", updateStatus: () => {}, orphanObjectsWarningText: () => "", _specGroups: []
  })();
  return dom.els;
}
const renderSpec = over => renderSpecDom(over).specList.innerHTML;

test("панель: у строки поле «скидка, %» с индексом строки и общим % в placeholder", () => {
  const html = renderSpec(Object.assign({ devices: [{ productId: 7 }] }, withSettings({ discountPercent: 10 })));
  assert.match(html, /data-disc-row="0"/, "поле привязано к индексу строки");
  assert.match(html, /placeholder="10"/, "в placeholder — общий процент");
  assert.match(html, /value=""/, "без своей скидки поле пустое");
});

test("панель: личная скидка показана в поле, 0 показан нулём (0 ≠ пусто)", () => {
  const own = renderSpec(Object.assign({ devices: [{ productId: 7, discount: 25 }] }, withSettings({ discountPercent: 10 })));
  assert.match(own, /data-disc-row="0" value="25"/, "своя скидка видна в поле");
  const zero = renderSpec(Object.assign({ devices: [{ productId: 7, discount: 0 }] }, withSettings({ discountPercent: 10 })));
  assert.match(zero, /data-disc-row="0" value="0"/, "своя 0% показана нулём");
});

test("панель: строка «Скидка» показывает общий процент (N%) даже при смеси", () => {
  const els = renderSpecDom(Object.assign({ devices: [{ productId: 7, discount: 20 }, { productId: 1 }] }, withSettings({ discountPercent: 10 })));
  assert.equal(els.discountRow.hidden, false, "строка скидки видна");
  assert.match(els.discountTotal.textContent, /\(10%\)/, "панель показывает общий процент, специфику несут поля строк");
});

/* applyItemDiscount правит ВСЕ объекты строки и зовёт пересчёт (applyProjectSettings). */
function applyStand() {
  let calls = 0;
  const fn = stand.run("applyItemDiscount", { applyProjectSettings: () => { calls++; } });
  return { fn, calls: () => calls };
}

test("applyItemDiscount: пишет скидку во ВСЕ объекты строки, зажимая 0..100, и зовёт пересчёт", () => {
  const s = applyStand();
  const a = {}, b = {};
  s.fn([a, b], "25");
  assert.equal(a.discount, 25); assert.equal(b.discount, 25);
  assert.equal(s.calls(), 1, "пересчёт (applyProjectSettings) вызван");
  s.fn([a], "150");
  assert.equal(a.discount, 100, "вне диапазона зажато");
});

test("applyItemDiscount: пусто снимает свою скидку у всех объектов, 0 сохраняется", () => {
  const s = applyStand();
  const a = { discount: 30 };
  s.fn([a], "0");
  assert.equal(a.discount, 0, "0 — валидная скидка");
  s.fn([a], "");
  assert.equal(Object.prototype.hasOwnProperty.call(a, "discount"), false, "пусто удаляет поле — строка по общей");
});

/* onSpecDiscountChange: нечисловой ввод (badInput) не должен снимать заданную скидку. */
function changeStand(specGroups) {
  let calls = 0;
  const fn = stand.run(["applyItemDiscount", "onSpecDiscountChange"], {
    applyProjectSettings: () => { calls++; },
    _specGroups: specGroups,
    document: { activeElement: null },
    $: () => ({ querySelector: () => null })
  });
  return { fn, calls: () => calls };
}

test("onSpecDiscountChange: нечисловой ввод (badInput) НЕ снимает заданную скидку и не пересчитывает", () => {
  const obj = { discount: 30 };
  const s = changeStand([{ members: [obj] }]);
  s.fn({ validity: { badInput: true }, dataset: { discRow: "0" }, value: "" });
  assert.equal(obj.discount, 30, "мусорный ввод оставил прежнюю скидку");
  assert.equal(s.calls(), 0, "пересчёта не было");
});

test("onSpecDiscountChange: корректный ввод правит объекты строки и пересчитывает", () => {
  const obj = {};
  const s = changeStand([{ members: [obj] }]);
  s.fn({ validity: { badInput: false }, dataset: { discRow: "0" }, value: "20" });
  assert.equal(obj.discount, 20);
  assert.equal(s.calls(), 1);
});

test("app.js: поле #specList привязано к onSpecDiscountChange по data-disc-row", () => {
  assert.match(stand.SRC, /\$\("specList"\)\.onchange\s*=/, "у #specList есть обработчик onchange");
  assert.match(stand.SRC, /data-disc-row=/, "поле несёт индекс строки");
  assert.match(stand.SRC, /onSpecDiscountChange\(input\)/, "обработчик зовёт onSpecDiscountChange");
});

/* ─────────────── 5. КП / раскладка ─────────────── */

const offerEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const offerDeps = over => Object.assign({ money: n => Number(n).toFixed(2) + " €", esc: offerEsc, displayCurrency: () => "EUR", settings: {} }, over);

test("КП: пометка «скидка N%» у строки со своей; смесь → пояснение с общим %; десятичная запятая", () => {
  const est = build(Object.assign({ devices: [{ productId: 7, discount: 12.5 }, { productId: 1 }] }, withSettings({ discountPercent: 10 })));
  const html = buildHtml(est, offerDeps({ settings: { discountPercent: 10 } }));
  assert.match(html, /скидка 12,5%/, "пометка с десятичной запятой");
  assert.match(html, /class="disc-mark"/);
  assert.match(html, /Скидка \(общая 10%, у отмеченных позиций своя\)/, "при смеси — пояснение");
});

test("КП: «без скидки» когда своя 0% при общей >0", () => {
  const est = build(Object.assign({ devices: [{ productId: 7, discount: 0 }, { productId: 1 }] }, withSettings({ discountPercent: 10 })));
  const html = buildHtml(est, offerDeps({ settings: { discountPercent: 10 } }));
  assert.match(html, /без скидки/, "своя 0% при общей 10% — «без скидки»");
});

test("КП: без личных скидок строка итога — «Скидка N%», пометок нет", () => {
  const est = build(Object.assign({ devices: [{ productId: 7 }] }, withSettings({ discountPercent: 15 })));
  const html = buildHtml(est, offerDeps({ settings: { discountPercent: 15 } }));
  assert.match(html, /<span>Скидка 15%<\/span>/);
  assert.ok(!/class="disc-mark"/.test(html), "пометок у строк нет (класс из CSS не в счёт)");
});

test("КП: пометка НЕ печатается, когда цены выключены (options.prices=false)", () => {
  const est = build(Object.assign({ devices: [{ productId: 7, discount: 20 }, { productId: 1 }] }, withSettings({ discountPercent: 10 })));
  const html = buildHtml(est, offerDeps({ settings: { discountPercent: 10 }, options: { prices: false } }));
  assert.ok(!/class="disc-mark"/.test(html), "в КП без цен скидочных пометок нет");
});

test("КП: пометка личной скидки поста печатается в раскладке (набор без спецификации)", () => {
  const est = build(Object.assign({ posts: [{ number: 1, frameId: 90, mechanismIds: [1], discount: 20 }] }, withSettings({ discountPercent: 10 })));
  const layout = [{ number: 1, modules: 1, fill: [{ word: "Механизм A", count: 1 }], discount: 20, assembledImageHtml: "", frameName: "Рамка" }];
  const html = buildHtml(est, offerDeps({ settings: { discountPercent: 10 }, options: { specification: { number: false }, sections: { specification: false, layout: true } }, postLayout: layout }));
  assert.match(html, /pl-disc/, "у поста в раскладке есть пометка скидки");
  assert.match(html, /скидка 20%/);
});

/* ─────────────── 6. Размещение / сохранение / персистентность ─────────────── */

test("placementFields: шаблон со скидкой НЕ передаёт discount новому посту", () => {
  const fields = EPPosts.placementFields({ id: "t1", name: "Пост", frameId: 90, mechanismIds: [1], discount: 20 });
  assert.equal(Object.prototype.hasOwnProperty.call(fields, "discount"), false, "«Разместить» не копирует личную скидку");
});

test("savePostBuilder не трогает post.discount (белый список base без discount → Object.assign сохраняет)", () => {
  const src = stand.functionSource("savePostBuilder");
  assert.ok(!/discount/.test(src), "в savePostBuilder нет discount — правка поста сохраняет его скидку");
});

/* Персистентность: скидка на объекте едет в снапшоте вместе с posts/devices и восстанавливается. */
function makeSession() {
  const dom = stand.makeDom();
  dom.$("planImage").src = "";
  const state = {};
  const store = { value: null };
  const ctx = {
    $: dom.$, esc: String, state,
    EP_DATA: { settings: JSON.parse(JSON.stringify(freshDefaults())) },
    EPEstimate, EPPosts, EPOfferOptions,
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s },
    ProjectStore: { load: () => store.value },
    dropOrphanKeyGroups: () => {}, renderLightingSchemeSelect: () => {},
    renderProjectWallTypeSelect: () => {}, renderProjectBacklight: () => {},
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, markCanvasUsed: () => {}
  };
  const src = stand.functionSource("relabelContourRooms") + "\n" + stand.functionSource("restoreProject") + "\n" + stand.functionSource("projectSnapshot")
    + "\n;({ restore: restoreProject, snapshot: projectSnapshot });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, store, ...api };
}
function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return win.EP_DATA.settings;
}

test("персистентность: post.discount переживает снапшот и восстановление", async () => {
  const s = makeSession();
  s.store.value = { posts: [{ number: 1, frameId: 90, mechanismIds: [1], discount: 20 }], terms: {} };
  await s.restore();
  assert.equal(s.ctx.state.posts[0].discount, 20, "скидка открыта из проекта");
  const snap = s.snapshot();
  assert.equal(snap.posts[0].discount, 20, "снапшот унёс скидку на объекте");
});

/* ─────────────── 7. Фазз: совпадение с прежней формулой без личных скидок ─────────────── */

test("фазз: без личных скидок смета совпадает с прежней формулой equipment×общий%/100 на 100%", () => {
  let rng = 123456789;
  const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ids = [1, 2, 7, 90];
  for (let iter = 0; iter < 500; iter++) {
    const devices = [];
    const n = Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) devices.push({ productId: ids[Math.floor(rand() * ids.length)] });
    const general = Math.round(rand() * 1000) / 10;   // 0..100 с десятыми
    const work = Math.round(rand() * 200) / 10, materials = Math.round(rand() * 200) / 10;
    const e = build(Object.assign({ devices }, withSettings({ discountPercent: general, workPercent: work, materialsPercent: materials })));
    const clamp = Math.max(0, Math.min(100, general));
    const expectedDiscount = e.equipment * clamp / 100;
    assert.equal(e.discount, expectedDiscount, `итер ${iter}: скидка должна совпасть с прежней формулой точно`);
    assert.equal(e.equipmentNet, e.equipment - expectedDiscount, `итер ${iter}: база после скидки`);
    assert.equal(e.discountMixed, false, `итер ${iter}: личных скидок нет`);
  }
});
