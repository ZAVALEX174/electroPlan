/* Автотесты расчёта сметы (PLAN 7.1).
   Запуск без зависимостей и без сборщика:  node --test tests/
   Модуль js/estimate.js подключается напрямую — он не знает про DOM и state,
   поэтому браузер поднимать не нужно. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { build, postPrice, billableLighting } = require("../js/estimate.js");

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
