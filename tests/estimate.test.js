/* Автотесты расчёта сметы (PLAN 7.1).
   Запуск без зависимостей и без сборщика:  node --test tests/
   Модуль js/estimate.js подключается напрямую — он не знает про DOM и state,
   поэтому браузер поднимать не нужно. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { build } = require("../js/estimate.js");

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
     09671.*, 22673.1.*, 09679.*), в расчёт ставим, но в КП помечаем. Без пометки заказчик
     прочтёт догадку как согласованную позицию. */
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

test("нулевые проценты дают чистое оборудование", () => {
  const e = run({
    devices: [{ productId: 1 }],
    settings: settings({ workPercent: 0, materialsPercent: 0, vatEnabled: false })
  });
  near(e.total, 10, "итого равно цене оборудования");
});
