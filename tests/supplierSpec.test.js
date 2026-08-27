/* Автотесты сводной спецификации по артикулам (js/supplierSpec.js, D11) — документа для
   ПОСТАВЩИКА. Модуль чистый: на вход состав проекта, на выход данные свода и строка HTML,
   поэтому браузер поднимать не нужно.
   Главное здесь — КОЛИЧЕСТВА и СКЛЕЙКА: поставщик получает по строке на артикул, и ошибка в
   единице стоит недопоставленной коробки на объекте. Поэтому большая часть проверок — числа
   из collect(), а не поиск подстрок в вёрстке; вёрстку проверяем только там, где она сама
   несёт смысл (пометки и итоговая строка).
   Отдельным блоком — КОНТРАКТ ВСТАВКИ в документы: секция обязана печататься в листе
   монтажника и в КП и стоять там, где задумано. Без этих тестов вставку можно было бы
   случайно удалить или переставить, и ни один тест бы не покраснел. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { collect, buildHtml, kindFromCatalog } = require("../js/supplierSpec.js");
const installSheet = require("../js/installSheet.js");
const offerPdf = require("../js/offerPdf.js");
const EPPosts = require("../js/posts.js");
const EPEstimate = require("../js/estimate.js");
const EPLightingPlan = require("../js/lightingPlan.js");
const EPLightingGroups = require("../js/lightingGroups.js");

/* esc как в приложении (из app.js наружу не экспортируется). */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

/* Итальянская сборка: одна коробка на накладку, один суппорт. */
const italian = () => ({
  mechanisms: [
    { code: "20001.0", name: "Выключатель 1П 16AX", unit: "шт." },
    { code: "20208", name: "Розетка 2P+T 16A", unit: "шт." }
  ],
  frame: { code: "09663", name: "Накладка Neve Up 3М", unit: "шт." },
  support: { code: "09613", name: "Суппорт Neve Up 3М", unit: "шт." }, supportCount: 1,
  box: { code: "V71303", name: "Коробка 3М", unit: "шт." }, boxCount: 1
});
/* Немецко-французская: накладка одна, а коробок и суппортов по числу постов. */
const german = () => ({
  mechanisms: [{ code: "20001.0", name: "Выключатель 1П 16AX", unit: "шт." }],
  frame: { code: "09664", name: "Накладка 2+2", unit: "шт." },
  support: { code: "09602.1", name: "Суппорт 2М", unit: "шт." }, supportCount: 2, supportAssumed: true,
  box: { code: "V71701", name: "Коробка круглая", unit: "шт." }, boxCount: 2
});

const rowOf = (data, code) => data.rows.find(r => r.code === code);
const indexOf = (data, code) => data.rows.findIndex(r => r.code === code);

test("одинаковые артикулы из РАЗНЫХ постов складываются в одну строку", () => {
  /* Выключатель 20001.0 стоит и в итальянском, и в немецком посте: поставщику нужна одна
     строка на 2 шт., а не два заказа по одному. */
  const data = collect({ posts: [italian(), german()] });
  const sw = data.rows.filter(r => r.code === "20001.0");
  assert.equal(sw.length, 1, "артикул встречается в своде ровно один раз");
  assert.equal(sw[0].count, 2, "количества из разных постов сложились");
});

test("артикул с другим регистром и пробелами не раздваивает строку", () => {
  /* Оформление артикула («v71303 », «V 71303») — не разные товары. Раздвоение здесь
     означало бы двойной заказ одной и той же коробки. */
  const a = italian();
  const b = italian();
  b.box = { code: "v71303 ", name: "Коробка 3М", unit: "шт." };
  const c = italian();
  c.box = { code: "V 71303", name: "Коробка 3М", unit: "шт." };
  const data = collect({ posts: [a, b, c] });
  const boxes = data.rows.filter(r => r.kind === "box");
  assert.equal(boxes.length, 1, "все три написания — одна строка");
  assert.equal(boxes[0].count, 3, "количество сложилось по всем трём постам");
  assert.equal(boxes[0].code, "V71303", "печатаем написание из первого вхождения");
});

test("суппорты считаются по supportCount, а не по одному на пост", () => {
  /* Недавняя ошибка проекта: суппорт стоял литералом «1» — на немецко-французскую сборку
     из двух постов заказывалась одна планка вместо двух. */
  const data = collect({ posts: [german()] });
  assert.equal(rowOf(data, "09602.1").count, 2, "планок столько же, сколько коробок");
  assert.equal(rowOf(data, "V71701").count, 2, "коробок по boxCount");
  assert.equal(rowOf(data, "09664").count, 1, "накладка на сборку одна при любом числе коробок");
});

test("повторённый пост даёт кратное количество", () => {
  /* Один шаблон, размещённый на плане 3 раза, лежит в проекте тремя постами и обязан дать
     три комплекта: и коробки, и суппорты, и накладки, и механизмы. */
  const one = collect({ posts: [german()] });
  const three = collect({ posts: [german(), german(), german()] });
  assert.equal(three.totalNames, one.totalNames, "набор наименований тот же");
  three.rows.forEach(r => {
    assert.equal(r.count, rowOf(one, r.code).count * 3, `${r.code}: количество утроилось`);
  });
  assert.equal(three.totalUnits, one.totalUnits * 3, "общее количество штук утроилось");
});

test("суппорт не подобран — строка в своде есть, с количеством по коробкам", () => {
  /* Пробел подбора нельзя выбрасывать молча: поставщик должен видеть, что позиция в проекте
     есть, а артикула у неё нет. Количество берём от коробок — планка садится в каждую. */
  const p = german();
  p.support = null; p.supportCount = 0;     /* posts.js обнуляет количество вместе с артикулом */
  const data = collect({ posts: [p] });
  const gap = data.rows.find(r => r.kind === "support");
  assert.ok(gap, "строка суппорта осталась в своде");
  assert.equal(gap.code, null, "артикула нет");
  assert.equal(gap.count, 2, "не подобрано столько планок, сколько коробок");
  assert.equal(data.missing, 1, "свод считает позиции без артикула");
});

test("механизм и накладка без артикула попадают в свод отдельными строками", () => {
  /* Товара нет в каталоге (проект открыт после перезаливки прайса) — оркестратор передаёт
     позицию с пустым артикулом и честным именем. Она обязана дойти до документа. */
  const p = italian();
  p.mechanisms = [{ code: "", name: "Механизм не найден (арт. 4242)" }];
  p.frame = { code: "", name: "Накладка не найдена (арт. 77)" };
  const data = collect({ posts: [p] });
  const noCode = data.rows.filter(r => !r.code);
  assert.equal(noCode.length, 2, "обе позиции без артикула в своде");
  assert.ok(noCode.every(r => r.count === 1), "количество посчитано как у обычной позиции");
  const html = buildHtml({ posts: [p] }, deps);
  assert.match(html, /артикул не определён/, "в документе пробел назван словами, а не прочерком");
  assert.match(html, /Механизм не найден \(арт\. 4242\)/, "имя позиции сохранено");
});

test("одинаковые пробелы подбора складываются, разные — остаются разными", () => {
  const a = german(); a.support = null; a.supportCount = 0;
  const b = german(); b.support = null; b.supportCount = 0;
  const c = italian(); c.box = null;
  const data = collect({ posts: [a, b, c] });
  const gaps = data.rows.filter(r => !r.code);
  assert.equal(gaps.length, 2, "«суппорт не подобран» — одна строка, «коробка» — другая");
  assert.equal(gaps.find(r => r.kind === "support").count, 4, "две сборки по два суппорта");
  assert.equal(gaps.find(r => r.kind === "box").count, 1, "коробка одна");
});

test("«суппорт не требуется» строки не создаёт — это не пробел подбора", () => {
  /* Крышки IP55 по номенклатуре монтируются в коробку без планки. Строка «не подобран»
     здесь соврала бы, а заказ раздулся бы на несуществующую позицию. */
  const p = italian();
  p.support = null; p.supportCount = 0; p.supportNotRequired = true;
  const data = collect({ posts: [p] });
  assert.equal(data.rows.filter(r => r.kind === "support").length, 0, "суппорта в своде нет");
  assert.equal(data.missing, 0, "и это НЕ считается пробелом подбора");
});

test("пустой проект даёт пустой свод и не печатает секцию", () => {
  const data = collect({ posts: [] });
  assert.deepEqual(data.rows, []);
  assert.equal(data.totalNames, 0);
  assert.equal(data.totalUnits, 0);
  assert.equal(buildHtml({ posts: [] }, deps), "", "секции в документе не будет");
  assert.equal(buildHtml({}, deps), "", "и без поля posts тоже");
  assert.equal(buildHtml(null, deps), "", "и на пустом spec не падаем");
});

test("пост без механизмов: накладка есть, нулевых строк нет", () => {
  /* Пустой пост — коробки и суппорта в нём нет (boxCount 0), и «0 шт.» в заказе не место. */
  const data = collect({ posts: [{ mechanisms: [], frame: { code: "09663", name: "Накладка" }, support: null, supportCount: 0, box: null, boxCount: 0 }] });
  assert.equal(data.rows.length, 1, "только накладка");
  assert.equal(data.rows[0].code, "09663");
});

test("порядок строк: по типу изделия, внутри типа по артикулу", () => {
  /* Так набирают на складе: сначала всё со стеллажа накладок, потом механизмы и так далее.
     Порядок типов — как во взрыв-схеме листа монтажника: от лица сборки вглубь стены. */
  const data = collect({ posts: [italian(), german()] });
  const kinds = [...new Set(data.rows.map(r => r.kind))];
  assert.deepEqual(kinds, ["frame", "mechanism", "support", "box"], "накладки → механизмы → суппорты → коробки");
  assert.ok(indexOf(data, "09663") < indexOf(data, "09664"), "внутри накладок — по возрастанию артикула");
  assert.ok(indexOf(data, "09602.1") < indexOf(data, "09613"), "внутри суппортов — по возрастанию артикула");
});

test("позиция без артикула — в конце своей группы, а не в конце документа", () => {
  /* Пробел виден рядом с однотипными позициями: понятно, чего именно не хватает. */
  const p = german(); p.support = null; p.supportCount = 0;
  const data = collect({ posts: [italian(), p] });
  const gapAt = data.rows.findIndex(r => !r.code);
  assert.ok(gapAt > indexOf(data, "09613"), "после подобранного суппорта");
  assert.ok(gapAt < indexOf(data, "V71303"), "но до коробок — группа не разорвана");
});

test("пометка «(предположительно)» сохраняется в своде", () => {
  /* Формулировка ОДНА во всех документах (смета, лист монтажника, взрыв-схема, панель
     состава): неподтверждённый артикул не должен читаться как согласованный факт. */
  const data = collect({ posts: [german()] });
  assert.equal(rowOf(data, "09602.1").assumed, true, "признак дошёл до строки свода");
  const html = buildHtml({ posts: [german()] }, deps);
  assert.match(html, /09602\.1<\/span> \(предположительно\)/, "пометка стоит вплотную к артикулу");
});

test("достаточно одного неподтверждённого вхождения, чтобы пометить строку", () => {
  /* Суппорт подбирается от накладки: один и тот же артикул бывает подтверждённым в одном
     посте и нашей догадкой в другом. Снять пометку из-за подтверждённого соседа — выдать
     догадку за факт. */
  const confirmed = german(); confirmed.supportAssumed = false;
  const data = collect({ posts: [confirmed, german()] });
  assert.equal(rowOf(data, "09602.1").assumed, true);
  assert.equal(rowOf(data, "09602.1").count, 4, "количества всё равно сложились");
});

test("одиночные изделия плана (extras) попадают в свод", () => {
  /* Заказчик просил убрать одиночные элементы из инструмента, но в сохранённых проектах
     они есть — из заказа выпасть не должны. */
  const data = collect({ posts: [italian()], extras: [{ code: "14513", name: "Датчик", unit: "шт." }, { code: "14513", name: "Датчик" }] });
  const row = rowOf(data, "14513");
  assert.equal(row.count, 2, "одиночные тоже складываются");
  assert.equal(row.kind, "other", "своя группа, в конце документа");
  assert.equal(data.rows[data.rows.length - 1].code, "14513", "прочие изделия — последними");
});

test("колонка «Ед.»: единица берётся с товара, без неё — «шт.»", () => {
  /* Колонка из накладной заказчика («№ / Товар / Артикул / Кол-во / Ед.») до сих пор не была
     покрыта ничем: проверялось только, что заголовок напечатан. А единица — не украшение:
     не всё в прайсе меряется штуками (кабель — метрами, комплект — комплектами), и молча
     подставленное «шт.» превратило бы 40 метров в 40 штук. Отсутствие единицы (товара нет
     в каталоге, проект из старого хранилища) — всё-таки «шт.», а не пустая ячейка: пустое
     место в накладной набирающий на складе читает как недоработку. */
  const spec = { posts: [{ mechanisms: [
    { code: "X1", name: "Кабельный канал", unit: "м" },
    { code: "X2", name: "Механизм без единицы" }
  ], boxCount: 0 }] };
  const data = collect(spec);
  assert.equal(rowOf(data, "X1").unit, "м", "единица товара сохранена");
  assert.equal(rowOf(data, "X2").unit, "шт.", "единицы нет — штуки");
  const html = buildHtml(spec, deps);
  assert.match(html, /width:52px">м</, "единица дошла до документа, а не потерялась в вёрстке");
  assert.match(html, /width:52px">шт\.</, "и подстановка по умолчанию — тоже");
});

test("«Ед.» у склеенных строк — из первого вхождения, как и написание артикула", () => {
  /* Один артикул — одна строка: единица не может быть двумя разными сразу. Берём ту же,
     что и написание кода, — из первого вхождения, иначе строка меняла бы вид от порядка
     постов в проекте. */
  const data = collect({ posts: [
    { mechanisms: [{ code: "X1", name: "Кабельный канал", unit: "м" }], boxCount: 0 },
    { mechanisms: [{ code: "X1", name: "Кабельный канал", unit: "шт." }], boxCount: 0 }
  ] });
  assert.equal(data.rows.length, 1, "строка одна");
  assert.equal(data.rows[0].count, 2);
  assert.equal(data.rows[0].unit, "м", "единица из первого вхождения");
});

test("итоги: всего наименований и общее количество штук", () => {
  const spec = { posts: [italian(), german()] };
  const data = collect(spec);
  /* 09663, 09664, 20001.0(×2), 20208, 09613, 09602.1(×2), V71303, V71701(×2) */
  assert.equal(data.totalNames, 8, "восемь наименований");
  assert.equal(data.totalUnits, 11, "одиннадцать изделий");
  const html = buildHtml(spec, deps);
  assert.match(html, /Всего наименований:<\/b> 8/, "итоговая строка как в накладной заказчика");
  assert.match(html, /Общее количество:<\/b> 11 шт\./, "и общее количество штук");
});

test("документ: заголовок, колонки образца и сквозная нумерация строк", () => {
  const html = buildHtml({ posts: [italian(), german()] }, deps);
  assert.match(html, /Сводная спецификация по артикулам/, "заголовок секции");
  ["№", "Товар", "Артикул", "Кол-во", "Ед."].forEach(col =>
    assert.ok(html.includes(">" + col + "<"), `колонка «${col}» как в накладной заказчика`));
  assert.match(html, /Накладки/, "подзаголовок группы");
  assert.match(html, /Монтажные коробки/, "и последней группы");
  assert.match(html, /break-before:page/, "свод печатается своей страницей");
  /* Нумерация — СКВОЗНАЯ по всему своду (как в накладной заказчика), подзаголовки групп
     её не сбрасывают: по номеру строки на складе отмечают набранное. */
  const nums = [...html.matchAll(/width:34px;color:#687f94">(\d+)<\/td>/g)].map(m => Number(m[1]));
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8], "строки пронумерованы подряд через все группы");
});

test("одна группа — подзаголовков нет (не сообщают ничего)", () => {
  const html = buildHtml({ posts: [{ mechanisms: [], frame: { code: "09663", name: "Накладка" }, boxCount: 0 }] }, deps);
  assert.ok(!/>Накладки</.test(html), "подзаголовок группы не печатается");
  assert.match(html, /09663/, "а сама позиция на месте");
});

test("имя товара экранируется", () => {
  const html = buildHtml({ posts: [{ mechanisms: [{ code: "X1", name: "Розетка <b>&\"" }], boxCount: 0 }] }, deps);
  assert.match(html, /Розетка &lt;b&gt;&amp;&quot;/, "разметка из названия не уезжает в документ");
});

/* ---- Контракт вставки в документы ------------------------------------------------------
   Секцию собирает ЭТОТ модуль, а документы получают готовую строку (как planBlockHtml).
   Проверяем, что оба документа её печатают и ставят на задуманное место. */

test("свод печатается в листе монтажника ПОСЛЕ карточек постов", () => {
  const marker = '<section data-test="supplier-spec">свод</section>';
  const post = {
    number: 1, modules: [{ label: "1", name: "Выключатель", code: "20001" }],
    fittings: [{ role: "Накладка", name: "Накладка", code: "09663", count: 1 }]
  };
  const html = installSheet.buildHtml({ posts: [post], supplierSpecHtml: marker }, deps);
  assert.ok(html.includes(marker), "секция свода напечатана");
  const posCard = html.indexOf('<section class="post-card">');
  assert.ok(posCard > -1, "карточка поста на месте");
  assert.ok(html.indexOf(marker) > posCard, "свод идёт ПОСЛЕ постов: монтажник сначала читает свои посты");
});

test("лист монтажника без свода собирается ровно как раньше", () => {
  const post = { number: 1, modules: [], fittings: [] };
  const withOut = installSheet.buildHtml({ posts: [post], supplierSpecHtml: "" }, deps);
  const undef = installSheet.buildHtml({ posts: [post] }, deps);
  assert.equal(withOut, undef, "пустая строка и отсутствие поля дают одинаковый документ");
});

test("свод печатается в КП ПОСЛЕ спецификации и денежных итогов", () => {
  const marker = '<section data-test="supplier-spec">свод</section>';
  const est = { groups: [{ name: "Пост", composition: "09663", count: 1, unit: "компл.", sum: 40 }],
    equipment: 40, discount: 0, materials: 5, work: 10, subtotal: 55, vat: 0, total: 55 };
  const d = { money: n => String(n) + " €", esc, displayCurrency: () => "EUR", settings: {}, supplierSpecHtml: marker };
  const html = offerPdf.buildHtml(est, d);
  assert.ok(html.includes(marker), "секция свода напечатана");
  assert.ok(html.indexOf(marker) > html.indexOf("Спецификация и комплектация"), "после позиционной таблицы");
  /* Именно ПОСЛЕ блока итогов, а не просто после его CSS-класса в <style> наверху документа:
     ищем последнее вхождение — сам блок «Итого». */
  assert.ok(html.indexOf(marker) > html.lastIndexOf('class="grand"'), "и после денежных итогов — КП читают ради цены");
});

test("КП без свода собирается ровно как раньше", () => {
  const est = { groups: [], equipment: 0, discount: 0, materials: 0, work: 0, subtotal: 0, vat: 0, total: 0 };
  const d = { money: n => String(n) + " €", esc, displayCurrency: () => "EUR", settings: {} };
  const withOut = offerPdf.buildHtml(est, Object.assign({}, d, { supplierSpecHtml: "" }));
  assert.equal(withOut, offerPdf.buildHtml(est, d), "пустая строка и отсутствие поля дают одинаковый документ");
});

test("на отрывной странице свода нет денежных формулировок КП", () => {
  /* Свод получает СВОЮ страницу (break-before:page), её отрывают и отдают поставщику:
     «этот лист отправляется поставщику», «артикулы мне не нужно отправлять, я просто хочу
     картинку» (встреча 24.08). Подвал КП стоял ПОСЛЕ свода и печатался на его же странице —
     поставщик читал «Цены являются ориентировочными…» на листе, где цен нет по замыслу.
     Оба подвала (курс и оговорка о ценах) обязаны остаться на страницах КП. */
  const marker = '<section data-test="supplier-spec">свод</section>';
  const est = { groups: [{ name: "Пост", composition: "09663", count: 1, unit: "компл.", sum: 40 }],
    equipment: 40, discountPercent: 0, discount: 0, materials: 5, work: 10, subtotal: 55, vatPercent: 0, vat: 0, total: 55 };
  const html = offerPdf.buildHtml(est, { money: n => String(n) + " €", esc,
    displayCurrency: () => "RUB", effectiveRate: () => 95.275, supplierSpecHtml: marker,
    settings: { eurRate: 92.5, rateSource: "ЦБ РФ", rateSurchargePercent: 3 } });
  const at = html.indexOf(marker);
  assert.ok(at > -1, "секция свода напечатана");
  assert.ok(html.indexOf("Цены являются ориентировочными") < at, "оговорка о ценах осталась на страницах КП");
  assert.ok(html.indexOf("Пересчёт из евро") < at, "и подвал с курсом — тоже");
  /* После свода в документе остаётся только скрипт автопечати: ни цен, ни курса, ни итогов. */
  const tail = html.slice(at + marker.length).replace(/<script[\s\S]*$/, "");
  assert.ok(!/цен|курс|итого|₽|€/i.test(tail), `после свода не должно быть денег, а есть: «${tail.trim()}»`);
});

test("на отрывной странице свода нет подвала листа монтажника", () => {
  /* Та же ошибка, что была в КП, и то же лечение — симметрия важнее, чем текст подвала.
     Свод получает СВОЮ страницу (break-before:page), её отрывают и отдают поставщику;
     подвал «Документ для монтажа. Позиции модулей указаны слева направо…» стоял ПОСЛЕ
     свода и печатался на его же листе — поставщик читал приписку, адресованную монтажнику
     и к накладной отношения не имеющую. Денежных формулировок здесь нет, но правило одно
     для обоих документов: что адресовано читателю документа, остаётся на его страницах. */
  const marker = '<section data-test="supplier-spec">свод</section>';
  const post = { number: 1, modules: [{ label: "1", name: "Выключатель", code: "20001" }], fittings: [] };
  const html = installSheet.buildHtml({ posts: [post], supplierSpecHtml: marker }, deps);
  const at = html.indexOf(marker);
  assert.ok(at > -1, "секция свода напечатана");
  assert.ok(html.indexOf("Документ для монтажа") < at, "подвал остался на страницах монтажника");
  /* После свода — только скрипт автопечати, как и в КП. */
  const tail = html.slice(at + marker.length).replace(/<script[\s\S]*$/, "");
  assert.equal(tail.trim(), "", `после свода в документе ничего быть не должно, а есть: «${tail.trim()}»`);
});

/* ---- Связка с приложением: настоящий состав поста и согласие со сметой --------------------
   Выше свод проверяется на фикстурах, где supportCount/boxCount заданы ЛИТЕРАЛАМИ. Этого мало:
   в приложении эти числа приходят из EPPosts.postComposition, и ошибка в связке («суппорт
   всегда один», «коробка на каждый механизм») на литералах невидима — фикстура просто повторит
   неверное число вслед за кодом. Ниже свод собирается ровно так, как это делает оркестратор
   supplierSpecData() в app.js, но поверх НАСТОЯЩЕГО postComposition. Сам app.js подключить
   нельзя (он завязан на DOM и state), поэтому сборка spec повторена здесь один в один — и она
   же служит вторым документом для теста-инварианта. */

/* Каталог-заглушка с настоящими полями прайса: kind (вид изделия) задаёт группу свода,
   standard и postCount накладки — по ним postComposition считает коробки и суппорты. */
const CATALOG = {
  1:  { id: 1,  kind: "mechanism",  code: "20001.0", name: "Выключатель 1П 16AX",  unit: "шт.", price: 12 },
  2:  { id: 2,  kind: "mechanism",  code: "20208",   name: "Розетка 2P+T 16A",     unit: "шт.", price: 9 },
  10: { id: 10, kind: "frame",      code: "09663",   name: "Накладка Neve Up 3М",  unit: "шт.", price: 20, standard: "IT" },
  11: { id: 11, kind: "frame",      code: "09664",   name: "Накладка Neve Up 2+2", unit: "шт.", price: 26, standard: "DE", postCount: 2 },
  20: { id: 20, kind: "support",    code: "09613",   name: "Суппорт 3М",           unit: "шт.", price: 4 },
  21: { id: 21, kind: "support",    code: "09602.1", name: "Суппорт 2М",           unit: "шт.", price: 3 },
  30: { id: 30, kind: "socket_box", code: "V71303",  name: "Коробка 3М",           unit: "шт.", price: 2 },
  31: { id: 31, kind: "socket_box", code: "V71701",  name: "Коробка круглая",      unit: "шт.", price: 2 },
  /* Клавиша и голые механизмы за ней — без них половину состава поста (позиции групп света)
     инвариант не видит вовсе. Роли и серии в форме настоящего каталога (partRole/controlRole
     из attrs.roles). Инвертора в серии намеренно нет: три места одной группы дают пробел
     ПОСТАВКИ, и он тоже обязан пройти сверку. */
  3:  { id: 3,  kind: "mechanism", code: "09021.N",     name: "Клавиша 1M neutro",   unit: "шт.", price: 4,
        partRole: "key", series: ["Neve Up"] },
  40: { id: 40, kind: "mechanism", code: "09001.0.250", name: "Механизм выключателя 1П 16AX", unit: "шт.", price: 7,
        partRole: "bare_mechanism", controlRole: "switch", series: ["Neve Up"] },
  41: { id: 41, kind: "mechanism", code: "09005.0.250", name: "Механизм переключателя 1П 16AX", unit: "шт.", price: 9,
        partRole: "bare_mechanism", controlRole: "changeover", series: ["Neve Up"] }
};
/* Расчёт групп света ровно так, как его подставляет приложение (app.js lightingFor):
   места из постов → правила схемы → строгий подбор по серии → строки по постам.
   Второй копии правил здесь нет: работают настоящие EPLightingPlan и EPLightingGroups. */
const seriesOf = item => (item && item.series) || [];
const BARE = [CATALOG[40], CATALOG[41]];
function lightingFromProject(posts) {
  const places = EPLightingPlan.collect(posts || [],
    { product: id => CATALOG[id], seriesOf, isKey: item => !!item && item.partRole === "key" });
  const plan = EPLightingGroups.plan({ scheme: "classic", places },
    { seriesOf, findMechanism: q => EPLightingPlan.resolveMechanism(q, BARE).product });
  return EPLightingPlan.rowsByPost(plan, places, EPLightingGroups.GAP_TEXTS);
}
const lightRowsOf = (light, post) => (light ? (light.get(EPLightingPlan.postKey(post)) || []) : []);
/* Зависимости состава поста — как их подставляет приложение (app.js postDeps): каталог,
   подбор коробки и суппорта. Немецко-французской накладке — круглая коробка и планка 2М,
   причём подобранная НАМИ (assumed), остальным — итальянский комплект. */
const catalogDeps = {
  product: id => CATALOG[id],
  frameProduct: id => CATALOG[id],
  mechanismSpan: () => 1,
  findBox: ({ standard }) => standard === "DE" ? CATALOG[31] : CATALOG[30],
  resolveSupport: ({ standard }) => ({ support: standard === "DE" ? CATALOG[21] : CATALOG[20], assumed: standard === "DE" }),
  supportRequired: () => true,
  wallType: "solid"
};
/* Позиция свода из товара каталога — как её собирает item() в app.js. Перевод вида изделия
   берём НАСТОЯЩИЙ (EPSupplierSpec.kindFromCatalog), а не копию словаря: копия разошлась бы
   с модулем, и тест продолжил бы зеленеть на сломанной группировке. */
const specItem = p => p ? { code: p.code, name: p.name, unit: p.unit, kind: kindFromCatalog(p.kind) } : null;

/* Точная копия supplierSpecData() из app.js — включая формулировки ненайденных товаров.
   Каталог читаем через те же deps.product/frameProduct, что и postComposition: так одну и ту
   же сборку можно прогнать и на фикстуре, и на НАСТОЯЩЕМ каталоге (тест в конце файла). */
const specFromProject = (posts, devices, deps0, light) => {
  const d = deps0 || catalogDeps;
  return {
    posts: (posts || []).map(p => {
      const comp = EPPosts.postComposition(p, d);
      /* Механизмы групп света — такие же позиции заказа, как клавиши (app.js supplierSpecData).
         Пробел ПОСТАВКИ идёт строкой без артикула, пробел ПРОЕКТА («группа не указана») не идёт
         вовсе — род пробела решает один общий EPLightingGroups.isSupplyGap, а не литерал здесь. */
      const lightItems = lightRowsOf(light, p)
        .filter(r => !r.missing || EPLightingGroups.isSupplyGap(r.missingReason))
        .map(r => r.missing
          ? { code: "", name: `Механизм группы «${r.groupLabel || "—"}» не подобран`, kind: "mechanism" }
          : { code: r.code, name: r.name, unit: r.product && r.product.unit, kind: "mechanism" });
      return {
        mechanisms: (p.mechanismIds || []).map(id => specItem(d.product(id)) || { code: "", name: `Механизм не найден (арт. ${id})` }).concat(lightItems),
        frame: specItem(comp.frame) || (p.frameId ? { code: "", name: `Накладка не найдена (арт. ${p.frameId})` } : null),
        support: specItem(comp.support), supportCount: comp.supportCount,
        supportAssumed: comp.supportAssumed, supportNotRequired: comp.supportNotRequired,
        box: specItem(comp.box || comp.boxFallback), boxCount: comp.boxCount
      };
    }),
    extras: (devices || []).map(dev => specItem(d.product(dev.productId)) || { code: "", name: `Товар не найден (арт. ${dev.productId})` })
  };
};
/* Смета по тому же проекту — как её собирает buildEstimate() в app.js. */
const estimateFromProject = (posts, devices, deps0, light) => {
  const d = deps0 || catalogDeps;
  return EPEstimate.build({
    devices: devices || [], posts: posts || [],
    product: d.product, frameProduct: d.frameProduct,
    postCost: p => EPPosts.postCost(p, d),
    postComposition: p => EPPosts.postComposition(p, d),
    lightingOf: p => lightRowsOf(light, p),
    settings: {}
  });
};

test("kindFromCatalog переводит вокабуляр прайса в группы свода", () => {
  /* Прайс называет монтажную коробку «socket_box», а «accessory»/«standalone» своей группы
     в накладной поставщика не заслуживают. Оркестратор берёт перевод отсюда, а не держит
     свою копию словаря. */
  assert.equal(kindFromCatalog("socket_box"), "box", "коробка — к коробкам, а не в «Прочие»");
  assert.equal(kindFromCatalog("frame"), "frame");
  assert.equal(kindFromCatalog("mechanism"), "mechanism");
  assert.equal(kindFromCatalog("support"), "support");
  assert.equal(kindFromCatalog("accessory"), "other", "аксессуар — «Прочие изделия»");
  assert.equal(kindFromCatalog(undefined), "other", "товар без вида не роняет свод");
  assert.equal(kindFromCatalog("constructor"), "other", "и не тащит функцию из прототипа");
  /* Перевод ИДЕМПОТЕНТЕН: уже переведённое значение переводится само в себя. Три вида из
     четырёх в обоих вокабулярах пишутся одинаково, и только коробка называется по-разному —
     kindFromCatalog("box") === "other" тихо увёл бы уже переведённую коробку в «Прочие»
     у любого, кто применит перевод дважды (а имя функции этого не запрещает). */
  ["frame", "mechanism", "support", "box", "other"].forEach(k =>
    assert.equal(kindFromCatalog(kindFromCatalog(k)), kindFromCatalog(k), `${k}: повторный перевод ничего не меняет`));
  assert.equal(kindFromCatalog("box"), "box", "вокабуляр свода функция понимает наравне с вокабуляром прайса");
});

test("одиночное изделие плана попадает в группу СВОЕГО типа, а не в «Прочие»", () => {
  /* Группа строки — это ЧТО за изделие, а не то, использовано ли оно в посте. Оркестратор
     обязан прокинуть вид товара из каталога; пока он его терял, одиночный механизм или
     накладка с плана уезжали в «Прочие изделия», и набирающий на складе искал их не на том
     стеллаже. */
  const data = collect(specFromProject([], [{ productId: 1 }, { productId: 10 }, { productId: 30 }]));
  assert.equal(rowOf(data, "20001.0").kind, "mechanism", "механизм — к механизмам");
  assert.equal(rowOf(data, "09663").kind, "frame", "накладка — к накладкам");
  assert.equal(rowOf(data, "V71303").kind, "box", "коробка (каталожный вид socket_box) — к коробкам");
  assert.deepEqual(data.rows.map(r => r.kind), ["frame", "mechanism", "box"],
    "и порядок групп тот же, что у позиций постов");
});

test("одиночное изделие и такой же товар из поста сходятся в одну строку", () => {
  /* Розетка стоит в посте и лежит на плане отдельно: поставщику нужна одна строка на 2 шт.
     Без вида изделия у extras эти две позиции разошлись бы по разным группам. */
  const data = collect(specFromProject([{ frameId: 10, mechanismIds: [2] }], [{ productId: 2 }]));
  const socket = data.rows.filter(r => r.code === "20208");
  assert.equal(socket.length, 1, "строка одна");
  assert.equal(socket[0].count, 2, "количество сложилось");
  assert.equal(socket[0].kind, "mechanism");
});

test("незнакомый вид изделия уходит в «Прочие», а не тащит мусор из прототипа", () => {
  /* kind — документированное поле публичного контракта, то есть вход не доверенный.
     На обычном объектном литерале KIND_LABEL["constructor"] вернул бы функцию из
     Object.prototype, и вместо подписи группы в документ уехал бы её исходный код. */
  const extras = ["accessory", "constructor", "toString", "__proto__"].map((kind, i) =>
    ({ code: "A" + i, name: "Изделие " + i, kind }));
  const data = collect({ posts: [], extras });
  assert.deepEqual(data.rows.map(r => r.kind), ["other", "other", "other", "other"],
    "все незнакомые виды — одна группа «Прочие изделия»");
  const html = buildHtml({ posts: [italian()], extras }, deps);
  assert.equal((html.match(/Прочие изделия/g) || []).length, 1,
    "в документе ровно один подзаголовок «Прочие изделия», а не по одному на каждый вид");
  assert.ok(!/native code|function \(|\[object /.test(html), "код из прототипа в документ не уехал");
});

test("подзаголовок группы не отрывается от своих строк при разрыве страницы", () => {
  /* На длинном своде движок иначе оставляет «Монтажные коробки» последней строкой листа,
     а сами коробки уносит на следующий — на складе видят заголовок без позиций. */
  const html = buildHtml({ posts: [italian(), german()] }, deps);
  const heads = [...html.matchAll(/<tr style="([^"]*)"><td colspan="5"/g)].map(m => m[1]);
  assert.ok(heads.length >= 2, "подзаголовки групп в документе есть");
  heads.forEach(style => assert.match(style, /page-break-after:avoid/, "строка-подзаголовок держит следующую при себе"));
});

test("ИНТЕГРАЦИЯ: количества свода приходят из настоящего EPPosts.postComposition", () => {
  /* Ни один тест выше не соединял свод с настоящим составом поста — supportCount и boxCount
     задавались литералами. Здесь числа считает тот же код, что и в приложении. */
  const de = { frameId: 11, mechanismIds: [1, 1, 1] };   /* немецко-французская: накладка на 2 коробки */
  const it = { frameId: 10, mechanismIds: [1, 2] };      /* итальянская: одна коробка на сборку */
  const comp = EPPosts.postComposition(de, catalogDeps);
  assert.equal(comp.boxCount, 2, "предпосылка: настоящий состав насчитал две коробки");
  assert.equal(comp.supportCount, 2, "и две планки — столько же, сколько коробок");

  const data = collect(specFromProject([de, it]));
  assert.equal(rowOf(data, "V71701").count, comp.boxCount, "коробок в своде столько, сколько насчитал состав");
  assert.equal(rowOf(data, "09602.1").count, comp.supportCount, "и планок — тоже, а не «одна на пост»");
  assert.equal(rowOf(data, "09664").count, 1, "накладка на сборку одна при двух коробках");
  assert.equal(rowOf(data, "09602.1").assumed, true, "признак «подобрано предположительно» дошёл из состава в свод");
  assert.equal(rowOf(data, "20001.0").count, 4, "механизмы: три из немецкого поста плюс один из итальянского");
  assert.equal(rowOf(data, "V71303").count, 1, "итальянская сборка — одна коробка");
  assert.equal(rowOf(data, "09613").count, 1, "и одна планка");
  assert.equal(rowOf(data, "09613").assumed, false, "подтверждённая пара пометки не несёт");
});

test("ИНТЕГРАЦИЯ: пустой пост не даёт ни коробки, ни планки", () => {
  /* boxCount у поста без механизмов — ноль, и свод обязан промолчать, а не заказать «0 шт.». */
  const data = collect(specFromProject([{ frameId: 10, mechanismIds: [] }]));
  assert.deepEqual(data.rows.map(r => r.code), ["09663"], "в заказе только накладка");
});

/* Сверка свода со сметой — ПО ПОЛЯМ, а не разбором печатной строки.
   Раньше здесь стоял парсер состава из КП: строка «Состав / артикул» делилась по «, » и
   собиралась обратно в позиции. На фикстурах этого файла он работал, потому что имена в
   них подобраны без запятых, — а в настоящем каталоге «, » содержат 966 имён из 2146 (45%:
   «Розетка 2P+T 16A немецкий стандарт, карбон матовый»). То есть главное свойство свода
   проверялось на данных, на которых сам способ проверки развалился бы. Разбор больше не
   нужен: смета отдаёт СТРУКТУРНЫЙ состав каждой позиции (estimate.groups[].items), а её
   печатная строка из него же и собирается (estimate.renderItem) — сверяя items, мы сверяем
   ровно то, что напечатано в КП, но не через текст. Что печать не разошлась со структурой,
   держит отдельный тест ниже.

   Ключ сверки — АРТИКУЛ, а у позиции без артикула (пробел подбора) — её имя: документы
   обязаны сходиться по ТОВАРУ. Вид изделия в ключ не входит намеренно: одна и та же
   коробка, стоящая в посте и лежащая на плане отдельно, — один товар и одна строка заказа.
   Прежнее сравнение считало коробки отдельным скаляром по признаку kind === "box", и
   одиночная коробка с плана красила инвариант ложно: свод складывал её к подрозетникам
   постов, а смета — к обычным позициям. */
const itemKey = r => r.code
  ? "арт. " + String(r.code).replace(/\s+/g, "").toUpperCase()
  : "без артикула: " + String(r.name || "").trim().replace(/\s+/g, " ").toLowerCase();
/* Позиции документа в сравнимом виде: товар → количество на весь проект. Нули пропускаем:
   и свод, и смета держат «нулевые» позиции (пустой пост без коробок, пояснительное
   «суппорт не требуется»), но в заказ они не идут ни у одного из документов. */
const tally = (rows) => {
  const by = new Map();
  rows.forEach(r => {
    const n = Number(r.count);
    if (!(n > 0)) return;
    const k = itemKey(r);
    by.set(k, (by.get(k) || 0) + n);
  });
  return Object.fromEntries([...by.keys()].sort().map(k => [k, by.get(k)]));
};
const specTally = (data) => tally(data.rows);
/* items — состав ОДНОЙ единицы позиции, а в группе сметы их g.count (одинаковые посты
   слиты в строку с количеством), поэтому количество умножаем. */
const estimateTally = (est) => tally(est.groups.flatMap(g =>
  (g.items || []).map(it => ({ code: it.code, name: it.name, count: Number(it.count) * g.count }))));

test("ИНВАРИАНТ: свод и смета не противоречат друг другу по количествам", () => {
  /* Главное свойство свода: это ТОТ ЖЕ проект, пересобранный по артикулам. Если два
     документа об одном проекте расходятся, ошибётся либо поставщик, либо заказчик — и
     заметят это уже на объекте. Набор нарочно недобрый: немецко-французская сборка с двумя
     планками и двумя коробками, ПОВТОРЁННЫЙ пост (смета сольёт его в одну строку с Кол. 2),
     механизм и накладка, которых нет в каталоге, и одиночные элементы плана. */
  const posts = [
    { name: "Пост 1", frameId: 10, mechanismIds: [1, 2] },
    { name: "Пост 2", frameId: 11, mechanismIds: [1, 1, 1] },
    { name: "Пост 3", frameId: 11, mechanismIds: [1, 1, 1] },   /* тот же состав — одна строка сметы */
    { name: "Пост 4", frameId: 10, mechanismIds: [1, 999] },    /* механизма нет в каталоге */
    { name: "Пост 5", frameId: 888, mechanismIds: [2] }         /* и накладки тоже нет */
  ];
  const devices = [{ productId: 2 }, { productId: 777 }];
  const data = collect(specFromProject(posts, devices));
  const est = estimateFromProject(posts, devices);

  assert.deepEqual(estimateTally(est), specTally(data),
    "документы называют одни и те же позиции в одних и тех же количествах");
  /* Пробел подбора обязан быть виден в ОБОИХ документах, а не только в своде: раньше смета
     молча выбрасывала товар поста, которого нет в каталоге (одиночный элемент плана с тем же
     пробелом она печатала честно — противоречила сама себе). */
  assert.deepEqual([...est.missing].sort(), [777, 888, 999],
    "смета считает пробелом и товар внутри поста, а не только одиночный элемент плана");
  assert.equal(data.missing, 3, "и свод насчитал столько же строк без артикула");
});

test("ИНВАРИАНТ держится и когда суппорт не требуется (крышки IP55)", () => {
  /* Изделие монтируется в коробку без планки: свод строки не печатает, смета пишет словами
     «суппорт не требуется». Ноль планок с обеих сторон — расхождения нет. */
  const noSupport = Object.assign({}, catalogDeps, { supportRequired: () => false });
  const posts = [{ name: "Пост", frameId: 11, mechanismIds: [1, 1] }];
  const data = collect(specFromProject(posts, [], noSupport));
  const est = estimateFromProject(posts, [], noSupport);
  assert.equal(data.rows.filter(r => r.kind === "support").length, 0, "суппорта в своде нет");
  assert.match(est.groups[0].composition, /суппорт не требуется/, "а в смете он назван словами");
  assert.deepEqual(estimateTally(est), specTally(data), "и на количествах документы сходятся");
});

test("пробел подбора суппорта — намеренное расхождение документов, а не забытый случай", () => {
  /* Единственное место, где свод говорит, а смета и лист монтажника молчат. Это решение по
     АДРЕСАТУ, а не недосмотр: поставщику нужно видеть, что планка в проекте есть, а артикула
     у неё нет (иначе на объект приедет недокомплект), а в КП и в обвязке монтажника пустая
     строка «не подобран» соврала бы про состав — см. installSheet.buildFittings, где тот же
     выбор описан явно. Тест держит обе стороны: изменить одну, не тронув другую, не выйдет. */
  const unresolved = Object.assign({}, catalogDeps, { resolveSupport: () => ({ support: null, assumed: false }) });
  const posts = [{ name: "Пост", frameId: 11, mechanismIds: [1, 1] }];
  const data = collect(specFromProject(posts, [], unresolved));
  const est = estimateFromProject(posts, [], unresolved);
  const gap = data.rows.find(r => r.kind === "support");
  assert.ok(gap && !gap.code, "свод печатает пробел строкой без артикула");
  assert.equal(gap.count, 2, "и в количестве коробок — столько планок не подобрано");
  assert.ok(!/суппорт/i.test(est.groups[0].composition), "а состав в КП о нём молчит");
  assert.equal(est.missing.length, 0, "это пробел ПОДБОРА, а не отсутствующий в каталоге артикул");
});

test("одиночная коробка с плана не ломает сверку документов", () => {
  /* Свод складывает такую коробку в ТУ ЖЕ строку заказа, что и подрозетники постов (один
     артикул — одна строка на весь проект), а смета печатает её отдельной позицией «шт.».
     Пока сравнение документов считало коробки отдельным скаляром по признаку kind === "box",
     эти две коробки попадали в разные корзины: свод клал обе к подрозетникам, смета — одну
     к подрозетникам, другую к обычным позициям, и инвариант краснел на здоровом проекте.
     Сверка идёт по АРТИКУЛУ, а не по группе документа: коробка — это коробка, где бы она
     ни стояла. */
  const posts = [{ name: "Пост", frameId: 10, mechanismIds: [1] }];
  const devices = [{ productId: 30 }];   /* та же V71303, что подбирается в итальянский пост */
  const data = collect(specFromProject(posts, devices));
  const est = estimateFromProject(posts, devices);
  assert.equal(rowOf(data, "V71303").count, 2, "свод: коробка поста плюс коробка с плана — одна строка на 2 шт.");
  assert.equal(data.rows.filter(r => r.kind === "box").length, 1, "и группа «Монтажные коробки» не раздвоилась");
  assert.deepEqual(estimateTally(est), specTally(data), "документы на этом не расходятся");
});

test("comp без supportCount: свод и смета делают ОДНО допущение — планка в каждую коробку", () => {
  /* supportCount — необязательное поле состава (postComposition — необязательная зависимость,
     самодельный comp из старого кода приходит без него). Свод в этом случае брал число
     коробок, а смета — единицу: два документа об одном проекте по-разному трактовали одно
     поле и на немецко-французской сборке разошлись бы молча — КП обещало заказчику одну
     планку, накладная поставщика требовала две. Верное допущение — правило проекта «планка
     садится в каждую коробку» (posts.js supportCount), и теперь оно общее. */
  const comp = { boxCount: 2, support: CATALOG[21], box: CATALOG[31] };   /* supportCount ОТСУТСТВУЕТ */
  const specSide = collect({ posts: [{
    mechanisms: [specItem(CATALOG[1])], frame: specItem(CATALOG[10]),
    support: specItem(comp.support), box: specItem(comp.box), boxCount: comp.boxCount
  }] });                                                                  /* и здесь его тоже нет */
  const est = EPEstimate.build({
    devices: [], posts: [{ name: "Пост", frameId: 10, mechanismIds: [1] }],
    product: id => CATALOG[id], frameProduct: id => CATALOG[id],
    postCost: () => 0, postComposition: () => comp, settings: {}
  });
  assert.equal(rowOf(specSide, "09602.1").count, 2, "свод: планок столько же, сколько коробок");
  assert.match(est.groups[0].composition, /2 × суппорт/, "и смета печатает в КП то же число");
  assert.deepEqual(estimateTally(est), specTally(specSide), "допущение одно — расхождения нет");
});

/* ---- Инвариант на НАСТОЯЩИХ данных каталога ---------------------------------------------
   Фикстуры выше собраны из коротких выдуманных имён («Коробка 3М»), и это не мелочь: пока
   свод и смету сверяли РАЗБОРОМ печатной строки состава по «, », такая фикстура была
   единственным набором, на котором разбор вообще работал. В настоящем каталоге «, » содержат
   966 имён из 2146 — 45% номенклатуры. Ниже тот же инвариант гоняется на реальных товарах:
   имена, артикулы, стандарты и модульность — из отгружаемых js/catalog-vimar*.js. */
const fs = require("node:fs");
const path = require("node:path");
/* Каталог и его атрибуты читаем теми же файлами, что грузит браузер (сборщика в проекте нет,
   оба кладут данные в window). Накладке подмешиваем стандарт и число постов ровно как
   js/data.js: от них зависят boxCount и supportCount, то есть обе половины инварианта. */
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
const realByCode = code => realProducts.find(p => p.code === code);
/* Имена с «, » — те самые, на которых разбор состава по разделителю разваливался. */
const commaNamed = kind => realProducts.filter(p => p.kind === kind && p.name.includes(", "));
const realSupports = commaNamed("support");
/* Подбор коробки и суппорта — простыми стабильными правилами, а не EPPostFit: инвариант
   проверяет СОГЛАСИЕ ДВУХ ДОКУМЕНТОВ, а не качество подбора, и краснеть от перенастройки
   подбора не должен. Круглая коробка — немецко-французской сборке, прямоугольная — прочим;
   суппорт свой на каждый стандарт, чтобы в проект попали все три планки с «, » в имени. */
const realDeps = {
  product: id => realById.get(id),
  frameProduct: id => realById.get(id),
  mechanismSpan: () => 1,
  findBox: ({ standard }) => realByCode(standard === "DE" ? "V71701" : "V71303"),
  resolveSupport: ({ standard }) => ({
    support: realSupports[standard === "DE" ? 0 : standard === "IT" ? 1 : 2],
    assumed: standard === "DE"
  }),
  supportRequired: () => true,
  wallType: "solid"
};

test("ИНВАРИАНТ на НАСТОЯЩЕМ каталоге: имена с «, » документы не расходят", () => {
  const mechs = commaNamed("mechanism"), frames = commaNamed("frame");
  const allComma = realProducts.filter(p => p.name.includes(", "));
  assert.equal(realProducts.length, 2146, "предпосылка: каталог отгружен целиком");
  assert.equal(allComma.length, 966, "предпосылка: 966 имён каталога из 2146 содержат «, » — 45%");
  assert.equal(mechs.length + frames.length + realSupports.length, allComma.length,
    "все имена с «, » — это механизмы, накладки и суппорты; коробок и аксессуаров среди них нет");

  /* По посту на КАЖДУЮ накладку с «, », механизмы берём по кругу: в проект попадают все
     такие имена каталога до единого, а не удобная выборка. */
  const posts = frames.map((f, i) => ({
    name: `Пост ${i + 1}`, frameId: f.id,
    mechanismIds: [0, 1, 2].map(k => mechs[(i * 3 + k) % mechs.length].id)
  }));
  /* Одиночные изделия плана: коробка (случай, на котором прежнее сравнение красило инвариант
     ложно), механизм с «, » в имени и артикул, которого в каталоге нет вовсе. */
  const devices = [{ productId: realByCode("V71303").id }, { productId: mechs[0].id }, { productId: -1 }];
  const data = collect(specFromProject(posts, devices, realDeps));
  const est = estimateFromProject(posts, devices, realDeps);

  assert.deepEqual(estimateTally(est), specTally(data), "документы сходятся по каждому артикулу");

  /* Сколько имён реально прошло через инвариант — без этого «проверено на настоящих
     данных» остаётся словами. */
  const withComma = data.rows.filter(r => r.name.includes(", "));
  assert.equal(withComma.length, allComma.length,
    "инвариант прогнан на ВСЕХ 966 товарах каталога, чьи имена содержат «, »");
  assert.equal(new Set(withComma.map(r => r.name)).size, 919,
    "919 различных имён: одно имя носят до четырёх артикулов, и в своде они остаются разными строками");
  assert.ok(data.rows.some(r => r.kind === "support" && r.assumed), "немецко-французские планки помечены");
});

test("печатный состав КП собран ИЗ ТЕХ ЖЕ items, что сверяет инвариант", () => {
  /* Инвариант сверяет структуру, а заказчик читает текст. Если бы текст собирался отдельной
     веткой кода, согласие структур ничего не говорило бы о документе — поэтому composition
     в estimate.js рендерится из items, и связь держится этим тестом.
     Заодно здесь видно, почему разбор текста обратно был негодной проверкой: настоящее имя
     («Розетка 2P+T 16A немецкий стандарт, карбон матовый») само содержит разделитель, и
     печатная строка делится по «, » на большее число кусков, чем позиций в составе. */
  const withComma = commaNamed("mechanism")[0];
  const frame = commaNamed("frame").find(f => f.standard === "DE" && f.postCount >= 2);
  assert.ok(withComma && frame, "предпосылка: в каталоге есть имя с «, » и немецкая накладка");
  const est = estimateFromProject([{ name: "Пост", frameId: frame.id, mechanismIds: [withComma.id] }], [], realDeps);
  const g = est.groups[0];
  g.items.filter(it => it.count > 0 && it.name && it.kind !== "box").forEach(it =>
    assert.ok(g.composition.includes(it.name), `позиция «${it.name}» напечатана в составе КП`));
  assert.match(g.composition, /\d+ подрозетн\./, "коробка в КП посчитана, а не названа");
  assert.ok(g.composition.split(", ").length > g.items.length,
    "печатная строка на настоящих именах делится по «, » на большее число кусков, чем позиций в составе");
});

/* ---- Инвариант «свод = смета» на позициях ГРУПП СВЕТА ------------------------------------
   Механизм за клавишей подставляет расчёт по числу мест группы во всём проекте: его нет в
   post.mechanismIds, он не занимает модуля рамки и приходит в оба документа отдельным путём —
   через lightingOf в смете и через lightItems в своде. Пока инвариант не был расширен, этот
   путь не был закрыт ничем: свод мог заказать переключатель там, где КП обещало выключатель,
   и заметили бы это на объекте. */

test("ИНВАРИАНТ: механизмы групп света совпадают в своде и в смете по количествам", () => {
  /* Набор недобрый нарочно: группа «Кухня» на ДВУХ постах (два переключателя вместо двух
     выключателей — роль зависит от всего проекта), группа «Холл» на одном (выключатель),
     повторяющиеся посты одинакового состава (смета сольёт их в строку с количеством) и
     клавиша с той же группой во втором посте. */
  const posts = [
    { id: "p1", number: 1, name: "Пост 1", frameId: 10, mechanismIds: [3, 3], keyGroups: ["Кухня", "Холл"] },
    { id: "p2", number: 2, name: "Пост 2", frameId: 10, mechanismIds: [3], keyGroups: ["Кухня"] }
  ];
  const light = lightingFromProject(posts);
  const data = collect(specFromProject(posts, [], undefined, light));
  const est = estimateFromProject(posts, [], undefined, light);
  assert.equal(rowOf(data, "09005.0.250").count, 2, "два места «Кухни» — два переключателя в заказе");
  assert.equal(rowOf(data, "09001.0.250").count, 1, "одно место «Холла» — один выключатель");
  assert.deepEqual(estimateTally(est), specTally(data),
    "документы называют одни и те же механизмы в одних и тех же количествах");
});

test("ИНВАРИАНТ держится, когда одинаковые посты различаются ТОЛЬКО группами света", () => {
  /* Два физически одинаковых поста (та же накладка, та же клавиша) получают разные механизмы,
     если их группы встречаются в проекте разное число раз. Смета обязана развести их на две
     строки, иначе состав первого напечатается как состав обоих — и разойдётся со сводом. */
  const posts = [
    { id: "p1", number: 1, name: "Пост", frameId: 10, mechanismIds: [3], keyGroups: ["Кухня"] },
    { id: "p2", number: 2, name: "Пост", frameId: 10, mechanismIds: [3], keyGroups: ["Кухня"] },
    { id: "p3", number: 3, name: "Пост", frameId: 10, mechanismIds: [3], keyGroups: ["Холл"] }
  ];
  const light = lightingFromProject(posts);
  const data = collect(specFromProject(posts, [], undefined, light));
  const est = estimateFromProject(posts, [], undefined, light);
  assert.equal(est.groups.length, 2, "переключатели и выключатель — разные строки спецификации");
  assert.deepEqual(estimateTally(est), specTally(data));
});

test("пробел ПРОЕКТА («группа не указана») не идёт ни в свод, ни в смету", () => {
  /* Незаполненный проект — не дыра поставки. Иначе накладная ЛЮБОГО старого проекта состояла
     бы из «Не указана группа света»: групп там нет ни у одной клавиши. Оба документа молчат
     одинаково — расхождения нет, а причину человек видит в блоке «Группы света». */
  const posts = [{ id: "p1", number: 1, name: "Пост", frameId: 10, mechanismIds: [3], keyGroups: [""] }];
  const light = lightingFromProject(posts);
  const data = collect(specFromProject(posts, [], undefined, light));
  const est = estimateFromProject(posts, [], undefined, light);
  assert.equal(data.rows.filter(r => /не подобран/i.test(r.name)).length, 0, "в своде такой строки нет");
  assert.ok(!/группа/i.test(est.groups[0].composition), "и состав в КП о ней молчит");
  assert.deepEqual(estimateTally(est), specTally(data));
});

test("пробел ПОСТАВКИ группы света: свод его называет, смета молчит — как у суппорта", () => {
  /* Три места одной группы требуют инвертор, а в серии клавиши его нет (Neve Up). Это тот же
     выбор по АДРЕСАТУ, что у пробела суппорта: поставщик обязан видеть недокомплект, а пустая
     строка «не подобран» в КП соврала бы про состав. Расхождение намеренное и держится
     тестом с обеих сторон. */
  const posts = [1, 2, 3].map(n => ({ id: "p" + n, number: n, name: "Пост", frameId: 10,
    mechanismIds: [3], keyGroups: ["Кухня"] }));
  const light = lightingFromProject(posts);
  const data = collect(specFromProject(posts, [], undefined, light));
  const est = estimateFromProject(posts, [], undefined, light);
  const gap = data.rows.find(r => !r.code && /Механизм группы/.test(r.name));
  assert.ok(gap, "свод печатает пробел строкой без артикула");
  assert.equal(gap.count, 1, "инвертор не подобран ровно на одном месте из трёх");
  assert.equal(rowOf(data, "09005.0.250").count, 2, "а два переключателя заказаны");
  assert.ok(!/не подобран/i.test(est.groups.map(g => g.composition).join(" ")), "смета о пробеле молчит");
});
