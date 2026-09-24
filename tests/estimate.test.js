/* Автотесты расчёта сметы (PLAN 7.1).
   Запуск без зависимостей и без сборщика:  node --test tests/
   Модуль js/estimate.js подключается напрямую — он не знает про DOM и state,
   поэтому браузер поднимать не нужно. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { build, postPrice, billableLighting, lightingCounts, pricelessNote, vatBreakdown, vatModeOf } = require("../js/estimate.js");
const PF = require("../js/postfit.js");
const POSTS = require("../js/posts.js");

/* Оговорка о неполноте итога — ЕДИНЫЙ источник для экрана (#pricelessStatus) и печатного КП
   (offerPdf). Тест держит формулировку и условие: если кто-то сменит текст в одном документе,
   разойдясь с другим, чинить придётся здесь — второй копии строки нет. */
test("pricelessNote: называет число позиций без цены и говорит о неполноте итога", () => {
  const note = pricelessNote({ missing: [111, 222] });
  assert.match(note, /Позиций без цены: 2/, "в тексте — число позиций из est.missing");
  assert.match(note, /нет в прайсе/, "названа причина: артикула нет в прайсе");
  assert.match(note, /нулём/, "сказано, что в «Итого» они вошли нулём");
  assert.match(note, /Сумма неполна/, "итог честно назван неполным");
});

test("pricelessNote: нет позиций без цены → пустая строка (потребитель прячет оговорку)", () => {
  assert.equal(pricelessNote({ missing: [] }), "", "пустой missing — оговорки нет");
  assert.equal(pricelessNote({}), "", "поля missing нет вовсе — оговорки нет");
  assert.equal(pricelessNote(null), "", "нет est — не падаем, оговорки нет");
});

/* Каталог-заглушка: розетка 10 € за штуку и кабель-канал 5 € за метр. */
const CATALOG = {
  1: { id: 1, name: "Розетка", code: "R-1", price: 10, unit: "шт." },
  2: { id: 2, name: "Канал", code: "K-1", price: 5, unit: "м" }
};
const product = (id) => CATALOG[id];
const settings = (over) => Object.assign(
  { workPercent: 18, materialsPercent: 7, discountPercent: 0, vatPercent: 20, vatEnabled: false },
  over || {}
);
const run = (input) => build(Object.assign(
  { devices: [], posts: [], product, frameProduct: product, postCost: () => 0, settings: settings() },
  input || {}
));
/* сравнение денег: копейки, а не биты */
const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${msg}: получено ${actual}, ожидалось ${expected}`);

test("пустой проект: нули и ни одной позиции", () => {
  const e = run();
  assert.equal(e.groups.length, 0);
  assert.equal(e.equipment, 0);
  assert.equal(e.total, 0);
  assert.deepEqual(e.missing, []);
});

test("одинаковые позиции группируются, единицы сохраняются", () => {
  const e = run({ devices: [{ productId: 1 }, { productId: 1 }, { productId: 2 }] });
  assert.equal(e.groups.length, 2, "две разные позиции");
  const socket = e.groups.find((g) => g.name === "Розетка");
  const duct = e.groups.find((g) => g.name === "Канал");
  assert.equal(socket.count, 2);
  assert.equal(socket.unit, "шт.");
  near(socket.sum, 20, "сумма по розеткам");
  assert.equal(duct.count, 1);
  assert.equal(duct.unit, "м", "единица берётся из товара, а не «шт.» по умолчанию");
  near(e.equipment, 25, "оборудование");
});

test("надбавки считаются от оборудования", () => {
  const e = run({ devices: [{ productId: 1 }], settings: settings({ workPercent: 18, materialsPercent: 7 }) });
  near(e.materials, 0.7, "материалы 7%");
  near(e.work, 1.8, "работы 18%");
  near(e.total, 12.5, "итого без НДС");
});

test("скидка уменьшает базу для работ и материалов", () => {
  /* ключевое бизнес-правило: иначе процент отыгрывался бы обратно через надбавки */
  const e = run({ devices: [{ productId: 1 }], settings: settings({ discountPercent: 10 }) });
  near(e.discount, 1, "скидка 10% с 10 €");
  near(e.equipmentNet, 9, "база после скидки");
  near(e.materials, 0.63, "материалы считаются от 9, а не от 10");
  near(e.work, 1.62, "работы считаются от 9, а не от 10");
  near(e.total, 11.25, "итого");
});

test("скидка ограничена диапазоном 0–100", () => {
  near(run({ devices: [{ productId: 1 }], settings: settings({ discountPercent: 150 }) }).equipmentNet, 0,
    "150% не уводит сумму в минус");
  near(run({ devices: [{ productId: 1 }], settings: settings({ discountPercent: -20 }) }).discount, 0,
    "отрицательная скидка не превращается в наценку");
});

test("НДС начисляется на итог с работами и материалами", () => {
  const e = run({ devices: [{ productId: 1 }], settings: settings({ vatEnabled: true, vatPercent: 20 }) });
  near(e.subtotal, 12.5, "итого без НДС");
  near(e.vat, 2.5, "НДС 20% от 12,50");
  near(e.total, 15, "итого с НДС");
});

test("выключенный НДС не начисляется", () => {
  const e = run({ devices: [{ productId: 1 }], settings: settings({ vatEnabled: false, vatPercent: 20 }) });
  assert.equal(e.vat, 0);
  assert.equal(e.vatPercent, 0, "ставка обнуляется, чтобы её не напечатали в КП");
  near(e.total, e.subtotal, "итого равно сумме без НДС");
});

/* ТРИ режима НДС (итоги встречи 24.08 §1.2). Правило «режим → суммы» живёт в ОДНОЙ чистой функции
   vatBreakdown; проверяем её напрямую на числах — все потребители берут результат отсюда. */
test("vatBreakdown: «начислить сверху» добавляет НДС к базе", () => {
  const v = vatBreakdown(12.5, "surcharge", 20);
  assert.equal(v.mode, "surcharge");
  near(v.amount, 2.5, "НДС 20% от 12,50");
  near(v.total, 15, "итог = база + НДС");
  assert.equal(v.included, false, "НДС добавлен сверху, а не сидит в итоге");
  assert.equal(v.label, "НДС", "подпись строки — «НДС»");
});

test("vatBreakdown: «выделить в стоимости» не меняет итог, а считает НДС обратно", () => {
  const v = vatBreakdown(12.5, "included", 20);
  assert.equal(v.mode, "included");
  /* цены уже с НДС: итог прежний, а выделенная сумма = база × p/(100+p) = 12,5 × 20/120 */
  near(v.total, 12.5, "итог не меняется — цены уже с НДС");
  near(v.amount, 2.0833, "в т.ч. НДС = 12,5 × 20/120");
  assert.equal(v.included, true, "НДС уже входит в итог");
  assert.equal(v.label, "в т.ч. НДС", "подпись строки — «в т.ч. НДС», не «НДС»");
});

test("vatBreakdown: «не учитывать» — ни НДС, ни ставки, итог = база", () => {
  const v = vatBreakdown(12.5, "none", 20);
  assert.equal(v.mode, "none");
  assert.equal(v.amount, 0);
  assert.equal(v.percent, 0, "ставка обнулена — строки НДС не будет");
  near(v.total, 12.5, "итог равен базе");
  assert.equal(v.label, "", "строки НДС нет — подпись пустая");
});

test("vatBreakdown: 0% не начисляет и не делит на ноль ни в одном режиме", () => {
  near(vatBreakdown(100, "surcharge", 0).amount, 0, "0% сверху — ноль");
  near(vatBreakdown(100, "surcharge", 0).total, 100, "итог = база");
  near(vatBreakdown(100, "included", 0).amount, 0, "0% выделения — ноль (100+0 в знаменателе)");
  near(vatBreakdown(100, "included", 0).total, 100, "итог = база");
});

test("vatBreakdown: неизвестный режим трактуется как «начислить сверху» (прежнее поведение)", () => {
  const v = vatBreakdown(100, "wat", 20);
  assert.equal(v.mode, "surcharge");
  near(v.total, 120, "как галочка «включать НДС»");
});

/* Миграция старых проектов — тоже одно правило (vatModeOf): галочка vatEnabled превращается в режим. */
test("vatModeOf: старый проект мигрирует по галочке vatEnabled", () => {
  assert.equal(vatModeOf({ vatEnabled: true }), "surcharge", "включённая галочка → начислить сверху");
  assert.equal(vatModeOf({ vatEnabled: false }), "none", "снятая галочка → не учитывать");
  assert.equal(vatModeOf({}), "surcharge", "нет ни режима, ни галочки → прежнее поведение");
});

test("vatModeOf: явный vatMode главнее старой галочки", () => {
  assert.equal(vatModeOf({ vatMode: "included", vatEnabled: false }), "included",
    "проект, сохранённый в новом виде, восстанавливает режим, а не мигрирует по галочке");
  assert.equal(vatModeOf({ vatMode: "мусор", vatEnabled: false }), "none",
    "негодный режим падает на миграцию по галочке");
});

test("build читает режим НДС и мигрирует старую галочку", () => {
  const inc = run({ devices: [{ productId: 1 }], settings: settings({ vatMode: "included", vatPercent: 20 }) });
  near(inc.subtotal, 12.5, "база до НДС");
  near(inc.total, 12.5, "«выделить» не меняет итог");
  near(inc.vat, 2.0833, "в т.ч. НДС считается обратно");
  assert.equal(inc.vatIncluded, true);
  assert.equal(inc.vatLabel, "в т.ч. НДС");
  const old = run({ devices: [{ productId: 1 }], settings: settings({ vatEnabled: true, vatPercent: 20 }) });
  assert.equal(old.vatMode, "surcharge", "vatEnabled:true мигрирует в «начислить сверху»");
  near(old.total, 15, "итог с НДС сверху — как раньше");
});

test("отсутствующий в каталоге товар не роняет расчёт", () => {
  /* штатная ситуация: проект восстановлен из хранилища, а прайс перезалили */
  const e = run({ devices: [{ productId: 1 }, { productId: 999 }] });
  assert.deepEqual(e.missing, [999]);
  const lost = e.groups.find((g) => /не найден/.test(g.name));
  assert.ok(lost, "позиция остаётся в смете, а не исчезает молча");
  assert.equal(lost.sum, 0, "цена нулевая");
  near(e.equipment, 10, "в сумму попал только найденный товар");
});

test("посты входят в смету комплектами", () => {
  const post = { name: "Пост 2 места", frameId: 2, mechanismIds: [1, 1] };
  const e = run({ posts: [post], postCost: () => 33 });
  assert.equal(e.groups.length, 1);
  assert.equal(e.groups[0].unit, "компл.");
  near(e.groups[0].sum, 33, "стоимость поста берётся из postCost");
  assert.match(e.groups[0].composition, /Канал/, "в составе указана рамка");
  assert.match(e.groups[0].composition, /2 подрозетн\./, "и число подрозетников");
});

test("посты группируются ПО СОСТАВУ, а не по имени/номеру", () => {
  /* два поста с одинаковым составом, но разными номерами (номер теперь идентификатор
     размещённого поста) должны сойтись в ОДНУ строку сметы — иначе она раздувается */
  const a = { number: 1, name: "Пост № 1", frameId: 2, mechanismIds: [1, 1] };
  const b = { number: 2, name: "Пост № 2", frameId: 2, mechanismIds: [1, 1] };
  const e = run({ posts: [a, b], postCost: () => 33 });
  assert.equal(e.groups.length, 1, "одинаковый состав → одна позиция");
  assert.equal(e.groups[0].count, 2, "с количеством 2");
  near(e.groups[0].sum, 66, "сумма — по обоим постам");
});

test("посты с РАЗНЫМ составом не сливаются, даже если имя одно", () => {
  const a = { name: "Пост", frameId: 2, mechanismIds: [1, 1] };
  const b = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const e = run({ posts: [a, b], postCost: () => 10 });
  assert.equal(e.groups.length, 2, "разный набор механизмов → разные позиции");
});

test("порядок состава: механизмы → суппорт → коробка → накладка", () => {
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };   // механизм «Розетка», рамка «Канал»
  const comp = { boxCount: 1, supportCount: 1, support: { name: "Суппорт X" } };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  const c = e.groups[0].composition;
  assert.ok(c.indexOf("Розетка") < c.indexOf("Суппорт X"), "механизмы раньше суппорта");
  assert.ok(c.indexOf("Суппорт X") < c.indexOf("подрозетн"), "суппорт раньше коробки");
  assert.ok(c.indexOf("подрозетн") < c.indexOf("Канал"), "коробка раньше накладки");
});

test("НЕСКОЛЬКО суппортов печатаются с количеством («2 × суппорт …»)", () => {
  /* Немецко-французская сборка: две коробки и две планки. Раньше состав (он же уходит
     в КП) печатал «суппорт X» без количества — заказчик читал его как одну штуку. */
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const comp = { boxCount: 2, supportCount: 2, support: { name: "Суппорт X" } };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  assert.match(e.groups[0].composition, /2 × суппорт Суппорт X/, "количество суппортов видно");
  assert.match(e.groups[0].composition, /2 подрозетн\./, "рядом — то же число коробок");
});

test("ОДИН суппорт печатается без «1 × » — текст КП не меняется", () => {
  /* Итальянские и универсальные накладки (1351 из 1631) — всегда одна планка. Префикс
     «1 × » на них не добавил бы ни грамма информации, зато переписал бы состав в КП
     по всему каталогу. Количество появляется только там, где оно больше одного. */
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const comp = { boxCount: 1, supportCount: 1, support: { name: "Суппорт X" } };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  assert.match(e.groups[0].composition, /(^|, )суппорт Суппорт X/, "суппорт назван, как и раньше");
  assert.ok(!/1 × суппорт/.test(e.groups[0].composition), "единицу не печатаем");
});

test("comp без supportCount (старый вызов) не печатает «undefined суппорт»", () => {
  /* postComposition — необязательная зависимость: самодельный состав из старого кода
     приходит без supportCount, и суппорт должен остаться одним, а не сломать строку. */
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const comp = { boxCount: 1, support: { name: "Суппорт X" } };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  assert.ok(!/undefined/.test(e.groups[0].composition), "в составе нет undefined");
  assert.match(e.groups[0].composition, /(^|, )суппорт Суппорт X/, "по умолчанию — один суппорт, без префикса");
});

test("суппорт с нулевым количеством в состав не попадает", () => {
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const comp = { boxCount: 0, supportCount: 0, support: { name: "Суппорт X" } };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  assert.ok(!/Суппорт X/.test(e.groups[0].composition), "нулевая обвязка не печатается");
});

test("NO_SUPPORT: в составе написано «суппорт не требуется», а не пусто", () => {
  /* Крышка IP55 монтируется в коробку без планки. Молчание в составе заказчик читает как
     забытую позицию — пишем словами; цену это не меняет, строка пояснительная. */
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const comp = { boxCount: 1, supportCount: 0, support: null, supportNotRequired: true };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  assert.match(e.groups[0].composition, /суппорт не требуется/, "признак виден в спецификации и КП");
  assert.match(e.groups[0].composition, /1 подрозетн\./, "коробка на месте");
});

test("supportAssumed: в составе рядом с суппортом стоит «(предположительно)»", () => {
  /* Решение владельца: артикул, подобранный нами (номенклатура называет только типоразмер —
     Eikon 22673.1.*, 22683.1.*), в расчёт ставим, но в КП помечаем. Без пометки заказчик
     прочтёт догадку как согласованную позицию. (Neve Up 09671.* и 09679.* заказчик подтвердил
     ответом на письмо 26.08 — они больше НЕ помечаются, см. postfit.CONFIRMED_GENERIC_SUPPORT.) */
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const comp = { boxCount: 1, supportCount: 1, support: { name: "Суппорт X" }, supportAssumed: true };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  assert.match(e.groups[0].composition, /суппорт Суппорт X \(предположительно\)/, "пометка вплотную к артикулу");
});

test("supportAssumed: пометка есть и при нескольких суппортах", () => {
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const comp = { boxCount: 2, supportCount: 2, support: { name: "Суппорт X" }, supportAssumed: true };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  assert.match(e.groups[0].composition, /2 × суппорт Суппорт X \(предположительно\)/);
});

test("подтверждённый суппорт печатается БЕЗ пометки", () => {
  /* Важнее самой пометки: если она встанет у всех, читать её перестанут. Подтверждённые
     пары — 09661.* → 09602.1/09603.1, 09672.* → 09606 и все обычные накладки. */
  const post = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const comp = { boxCount: 1, supportCount: 1, support: { name: "Суппорт X" }, supportAssumed: false };
  const e = run({ posts: [post], postCost: () => 1, postComposition: () => comp });
  assert.ok(!/предположительно/.test(e.groups[0].composition), "у подтверждённой пары пометки нет");
  const old = run({ posts: [post], postCost: () => 1, postComposition: () => ({ boxCount: 1, supportCount: 1, support: { name: "Суппорт X" } }) });
  assert.ok(!/предположительно/.test(old.groups[0].composition), "старый comp без признака — тоже без пометки");
});

test("документ (смета): пост Neve Up 09671 печатается БЕЗ «(предположительно)» — сквозной путь", () => {
  /* Сквозная проверка правки: реальный EPPostFit.resolveSupport → postComposition → build.
     Заказчик подтвердил суппорт Neve Up (ответ на письмо 26.08) — в НАПЕЧАТАННОМ составе поста
     пометки быть не должно. Eikon рядом (22673.1) её сохраняет — иначе тест был бы тавтологией. */
  const frame09671 = { id: 71, code: "09671.01", kind: "frame", name: "Накладка Neve Up 09671", standard: "IT", slotCount: 1, series: ["Neve Up"], principle: "1M_CENTRAL_3", boxModularity: 3, price: 3.12 };
  const frame22673 = { id: 73, code: "22673.1.01", kind: "frame", name: "Накладка Eikon Vintage 22673", standard: "IT", slotCount: 1, series: ["Eikon Vintage"], principle: "1M_CENTRAL_3", boxModularity: 3, price: 5.0 };
  const sup09613 = { id: 613, code: "09613", kind: "support", name: "Суппорт 09613", standard: "IT", moduleCount: 3, series: ["Neve Up"], price: 1.48 };
  const sup21613 = { id: 216, code: "21613", kind: "support", name: "Суппорт 21613", standard: "IT", moduleCount: 3, series: ["Eikon Vintage"], price: 2.50 };
  const box3 = { id: 3, code: "V71303", kind: "socket_box", name: "Коробка 3М", wallType: "solid", boxShape: "rect", boxModules: 3, boxStandards: ["IT"], price: 1.04 };
  const mech = { id: 1, code: "M1", kind: "mechanism", name: "Механизм", price: 5, moduleSpan: 1 };
  const cat = { 71: frame09671, 73: frame22673, 613: sup09613, 216: sup21613, 3: box3, 1: mech };
  const productSeries = p => (p && p.series) || [];
  const supports = [sup09613, sup21613];
  /* deps.resolveSupport оборачивает чистый EPPostFit.resolveSupport, подкладывая пул суппортов
     и seriesOf — ровно как app.js (postComposition их не передаёт). */
  const deps = {
    product: id => cat[id], frameProduct: id => cat[id], socketBox: () => box3,
    mechanismSpan: m => (m && m.moduleSpan) || 1,
    findBox: () => box3, fallbackBox: () => box3, supportRequired: () => true,
    resolveSupport: o => PF.resolveSupport(Object.assign({}, o, { supports, seriesOf: productSeries }))
  };
  const compNeve = POSTS.postComposition({ frameId: 71, mechanismIds: [1] }, deps);
  assert.equal(compNeve.support.code, "09613");
  assert.equal(compNeve.supportAssumed, false, "Neve Up подтверждён — флага нет уже в составе");
  const compEikon = POSTS.postComposition({ frameId: 73, mechanismIds: [1] }, deps);
  assert.equal(compEikon.support.code, "21613");
  assert.equal(compEikon.supportAssumed, true, "Eikon не подтверждён — флаг остаётся");

  const eNeve = run({ posts: [{ name: "Пост Neve Up", frameId: 71, mechanismIds: [1] }], postCost: () => 1, postComposition: () => compNeve });
  assert.ok(!/предположительно/.test(eNeve.groups[0].composition), "в напечатанном составе Neve Up пометки нет");
  const eEikon = run({ posts: [{ name: "Пост Eikon", frameId: 73, mechanismIds: [1] }], postCost: () => 1, postComposition: () => compEikon });
  assert.match(eEikon.groups[0].composition, /предположительно/, "у Eikon пометка на месте — тест не тавтология");
});

test("нулевые проценты дают чистое оборудование", () => {
  const e = run({
    devices: [{ productId: 1 }],
    settings: settings({ workPercent: 0, materialsPercent: 0, vatEnabled: false })
  });
  near(e.total, 10, "итого равно цене оборудования");
});

/* ── Механизмы групп света в смете (C8) ────────────────────────────────────────────────
   Механизм подставляется РАСЧЁТОМ по числу мест группы во всём проекте и физически стоит ЗА
   клавишей: модуля рамки он не занимает, в post.mechanismIds не входит и входить не может
   (там он удвоил бы modulesTotal и сменил бы коробку с суппортом). Поэтому он отдельная
   позиция состава и отдельное слагаемое цены строки — единственный путь его денег в итог. */
const lightRow = (over) => Object.assign(
  { keyIndex: 0, code: "20005.0", name: "Механизм-переключатель", price: 25.79,
    groupLabel: "Кухня", roleLabel: "Переключатель", missing: false }, over || {});

test("группы света: механизм попадает в состав позиции и в цену строки ровно один раз", () => {
  const post = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1] };
  const e = run({ posts: [post], postCost: () => 30, postComposition: () => ({ boxCount: 1 }),
    lightingOf: () => [lightRow()] });
  assert.match(e.groups[0].composition, /Механизм-переключатель · группа «Кухня»/);
  near(e.groups[0].sum, 55.79, "цена поста плюс механизм");
  near(e.equipment, 55.79, "equipment = сумма lines[].price, механизм учтён один раз");
});

test("группы света: пробел подбора позиции НЕ даёт — ни строкой состава, ни ценой", () => {
  /* Тот же выбор, что у суппорта: пустая строка «не подобран» в КП соврала бы про состав,
     а причину пробела клиент видит отдельным блоком «Группы света». */
  const post = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1] };
  const e = run({ posts: [post], postCost: () => 30, postComposition: () => ({ boxCount: 1 }),
    lightingOf: () => [lightRow({ missing: true, code: "", price: 0, name: "" })] });
  assert.ok(!/группа «Кухня»/.test(e.groups[0].composition));
  near(e.equipment, 30, "пробел не стоит денег");
});

/* ── одна формула цены поста на все экраны ────────────────────────────────────────────
   Дефект, который эти три теста держат закрытым: цену поста считали в четырёх местах, и две
   копии формулы забывали про механизмы групп света. Панель свойств и подсказка на плане
   показывали 77,86 €, конструктор и строка сметы — 103,65 €; пользователь видел две разные
   цены одного поста. Формула теперь одна — EPEstimate.postPrice, — и смета обязана считать
   строку поста ЕЮ ЖЕ, иначе копия заведётся снова. */

test("строка сметы считается ровно postPrice — той же функцией, что зовут экраны", () => {
  const post = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1] };
  const rows = [lightRow()];
  const e = run({ posts: [post], postCost: () => 30, postComposition: () => ({ boxCount: 1 }),
    lightingOf: () => rows });
  near(e.groups[0].sum, postPrice(30, rows), "цена строки = postPrice(состав поста, строки групп света)");
  near(postPrice(30, rows), 55.79, "и это состав поста плюс механизм");
});

test("postPrice берёт в деньги ровно то, что идёт в состав позиции", () => {
  /* Пробел подбора не даёт ни строки состава, ни цены — фильтр на оба случая ОДИН
     (billableLighting), иначе состав в КП и его цена разошлись бы. */
  const gap = lightRow({ missing: true, code: "", price: 99, name: "" });
  const good = lightRow();
  assert.deepEqual(billableLighting([good, gap]), [good]);
  near(postPrice(30, [good, gap]), 55.79, "пробел не стоит денег");
  near(postPrice(30, []), 30, "без групп света цена поста прежняя");
  near(postPrice(30), 30, "строк нет вовсе — тоже прежняя");
});

test("postPrice устойчив к мусору на входе — цена не становится NaN", () => {
  near(postPrice(undefined, null), 0, "нет ни состава, ни строк");
  near(postPrice("30", [lightRow({ price: "25.79" })]), 55.79, "числа из строк читаются числами");
  near(postPrice(30, [lightRow({ price: null })]), 30, "цена без числа не портит сумму");
});

test("группы света: одинаковые посты с РАЗНЫМИ механизмами не схлопываются в одну строку", () => {
  /* Два физически одинаковых поста получают разные механизмы, если их группы встречаются в
     проекте разное число раз. Схлопнуть их значило бы напечатать состав первого как состав
     обоих — артикулы в КП и своде разошлись бы с проектом. */
  const a = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1] };
  const b = { id: "p2", name: "Пост", frameId: 2, mechanismIds: [1] };
  const e = run({ posts: [a, b], postCost: () => 30, postComposition: () => ({ boxCount: 1 }),
    lightingOf: (po) => po.id === "p1"
      ? [lightRow({ code: "20001.0", name: "Механизм-выключатель", price: 20.26, roleLabel: "Выключатель", groupLabel: "Одна" })]
      : [lightRow({ groupLabel: "Две" })] });
  assert.equal(e.groups.length, 2, "разные механизмы — разные строки спецификации");
  near(e.equipment, 30 + 20.26 + 30 + 25.79, "деньги обоих постов в итоге");
});

test("группы света: одинаковые посты с ОДИНАКОВЫМИ механизмами по-прежнему одна строка", () => {
  const a = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1] };
  const b = { id: "p2", name: "Пост", frameId: 2, mechanismIds: [1] };
  const e = run({ posts: [a, b], postCost: () => 30, postComposition: () => ({ boxCount: 1 }),
    lightingOf: () => [lightRow()] });
  assert.equal(e.groups.length, 1);
  assert.equal(e.groups[0].count, 2);
});

test("проект без групп света считается БАЙТ В БАЙТ как раньше", () => {
  /* Ключ группировки получает подпись групп света только когда они есть: старые сметы не
     имеют права перегруппироваться от появления новой возможности. */
  const post = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1] };
  const before = run({ posts: [post, post], postCost: () => 30, postComposition: () => ({ boxCount: 1 }) });
  const after = run({ posts: [post, post], postCost: () => 30, postComposition: () => ({ boxCount: 1 }), lightingOf: () => [] });
  assert.deepEqual(after.groups, before.groups);
  near(after.equipment, before.equipment, "итог не изменился");
});

test("механизм группы света стоит в составе СРАЗУ ЗА клавишами, до суппорта и коробки", () => {
  const post = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1] };
  const e = run({ posts: [post], postCost: () => 30,
    postComposition: () => ({ boxCount: 1, supportCount: 1, support: { name: "Суппорт X", code: "S1" } }),
    lightingOf: () => [lightRow()] });
  assert.deepEqual(e.groups[0].items.map(it => it.kind), ["mechanism", "lighting", "support", "box", "frame"]);
});

test("ключ группировки НЕ склеивается строкой: разные наборы не могут дать один ключ", () => {
  /* Ровно тот «склеиваемый ключ», от которого отказался модуль групп света. Подпись
     собиралась как `код@группа`, а пары сшивались запятой — и обе границы полей проходили
     ВНУТРИ значения, которое вводит человек. Ниже вход намеренно вывернутый: имя группы несёт
     и запятую, и «@». Так и должно быть — доказывать надо не «на реальных данных пронесло», а
     что кодирование не может слипнуться В ПРИНЦИПЕ: имя группы это свободная строка человека
     («Кухня, рабочая зона» — уже законно), и никакой разделитель в ней не запрещён.
     Со склейкой оба поста давали ОДНУ строку сметы, и в КП уезжал состав первого как состав
     обоих: разные артикулы за одни деньги. */
  const a = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1, 1] };
  const b = { id: "p2", name: "Пост", frameId: 2, mechanismIds: [1, 1] };
  const e = run({ posts: [a, b], postCost: () => 30, postComposition: () => ({ boxCount: 1 }),
    lightingOf: (po) => po.id === "p1"
      ? [lightRow({ code: "20001.0", groupLabel: "Холл" }), lightRow({ code: "20005.0", groupLabel: "Кухня" })]
      : [lightRow({ code: "20001.0", groupLabel: "Холл,20005.0@Кухня" })] });
  assert.equal(e.groups.length, 2, "два разных состава — две строки спецификации");
});

test("ключ группировки не зависит от ПОРЯДКА клавиш в посте", () => {
  /* Один и тот же пост, собранный «слева направо» и «справа налево», — одна строка сметы:
     иначе спецификация раздувалась бы от перестановки, ничего не меняющей по существу. */
  const a = { id: "p1", name: "Пост", frameId: 2, mechanismIds: [1, 1] };
  const b = { id: "p2", name: "Пост", frameId: 2, mechanismIds: [1, 1] };
  const rows = [lightRow({ code: "20001.0", groupLabel: "Кухня" }), lightRow({ code: "20005.0", groupLabel: "Холл" })];
  const e = run({ posts: [a, b], postCost: () => 30, postComposition: () => ({ boxCount: 1 }),
    lightingOf: (po) => po.id === "p1" ? rows : [rows[1], rows[0]] });
  assert.equal(e.groups.length, 1);
  assert.equal(e.groups[0].count, 2);
});

/* --- Тип стены поста в ключе группировки (баг B5 со встречи 24.08) -------------------
   Раньше тип стены был один на проект, и в ключ его класть было незачем. Теперь у поста
   может быть свой (post.wallType), а подрозетник от него прямо зависит: та же сборка в
   бетоне и в ГКЛ — разная коробка и разная цена. */
test("посты одного состава с РАЗНЫМ типом стены — разные строки сметы", () => {
  const a = { name: "Пост", frameId: 2, mechanismIds: [1] };
  const b = { name: "Пост", frameId: 2, mechanismIds: [1], wallType: "hollow" };
  const boxOf = po => ({ boxCount: 1, supportCount: 0,
    box: { name: po.wallType === "hollow" ? "Коробка ГКЛ" : "Коробка бетон", code: po.wallType === "hollow" ? "V71703" : "V71303" } });
  const e = run({ posts: [a, b], postCost: () => 1, postComposition: boxOf, settings: settings({ wallType: "solid" }) });
  assert.equal(e.groups.length, 2, "коробки разные — схлопывать в одну строку нельзя");
  const codes = e.groups.map(g => g.items.find(it => it.kind === "box").code).sort();
  assert.deepEqual(codes, ["V71303", "V71703"], "в КП уходит своя коробка у каждой строки");
});

test("тип стены поста СОВПАДАЕТ с проектным — прежняя одна строка (старые сметы не дробятся)", () => {
  const a = { name: "Пост", frameId: 2, mechanismIds: [1] };                      // поля нет
  const b = { name: "Пост", frameId: 2, mechanismIds: [1], wallType: "solid" };   // явно как в проекте
  const comp = { boxCount: 1, supportCount: 0, box: { name: "Коробка бетон", code: "V71303" } };
  const e = run({ posts: [a, b], postCost: () => 1, postComposition: () => comp, settings: settings({ wallType: "solid" }) });
  assert.equal(e.groups.length, 1, "тип стены фактически один — одна строка с количеством 2");
  assert.equal(e.groups[0].count, 2);
});

/* ---- «нужно» и «подобрано»: экран, согласованный только по найденным, врёт ---------------

   Панель свойств поста и панель «Состав поста» печатали число ПОДОБРАННЫХ механизмов, и пост
   с тремя клавишами, у которого один механизм не подобрался (в серии нет инвертора), показывал
   рядом «3 механизма» и «2 механизма групп света» — числа спорили друг с другом, а про пробел
   экран молчал вовсе. Счёт живёт здесь, рядом с billableLighting, чтобы у экранов не было своей
   копии правила «что считается подобранным». */

const lightGood = { code: "20005.0", name: "Переключатель", price: 25.79 };
const lightGap = { code: "", name: "", price: 0, missing: true, missingReason: "no_product" };

test("lightingCounts: пробел считается в «нужно», но не в «подобрано» и не в деньгах", () => {
  const c = lightingCounts([lightGood, lightGood, lightGap]);
  assert.equal(c.need, 3, "мест управления три");
  assert.equal(c.found, 2, "механизмов подобрано два");
  assert.equal(c.gaps, 1, "пробел назван отдельно, а не растворён в числе");
  assert.equal(Number(c.sum.toFixed(2)), 51.58, "пробел стоит 0 — цена от него не меняется");
});

test("lightingCounts: всё подобрано — «нужно» и «подобрано» совпадают, пробелов нет", () => {
  const c = lightingCounts([lightGood, lightGood]);
  assert.deepEqual([c.need, c.found, c.gaps], [2, 2, 0]);
});

test("lightingCounts: мест нет вовсе — нули, и экрану нечего показывать", () => {
  assert.deepEqual(lightingCounts([]), { need: 0, found: 0, gaps: 0, sum: 0 });
  assert.deepEqual(lightingCounts(null), { need: 0, found: 0, gaps: 0, sum: 0 });
});

test("lightingCounts судит тем же фильтром, что и деньги (billableLighting)", () => {
  /* Разойдись эти два правила — состав показывал бы одно, а цена считалась бы по другому. */
  const rows = [lightGood, lightGap, { code: "", name: "", price: 7, missing: true }];
  assert.equal(lightingCounts(rows).found, billableLighting(rows).length);
  assert.equal(lightingCounts(rows).sum, postPrice(0, rows));
});
