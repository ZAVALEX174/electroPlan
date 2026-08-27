/* Автотесты связки «группы света ↔ проект» (C8).
   Запуск без зависимостей и без сборщика:  node --test tests/

   Модуль js/lightingPlan.js — чистый, но он ЗНАЕТ ФОРМУ ПОСТА приложения, и именно на нём
   держится контракт EPLightingGroups: позиция клавиши обязательна, группа — строка, механизм
   подбирается только своей серии и только с артикулом. Ошибка здесь не падает, а молча меняет
   деньги в смете, поэтому проверяем контракт напрямую и вместе с настоящим расчётом. */
const test = require("node:test");
const assert = require("node:assert/strict");
const LP = require("../js/lightingPlan.js");
const LG = require("../js/lightingGroups.js");

/* ── каталог-заглушка в форме настоящего (partRole/controlRole из attrs.roles) ───────── */
const KEY_EIKON = { id: 1, code: "20021", name: "Клавиша на 1 модуль серая", price: 5.08,
  partRole: "key", series: ["Eikon Evo", "Eikon Exe"] };
const KEY_PLANA = { id: 2, code: "14021", name: "Клавиша Plana", price: 4, partRole: "key", series: ["Plana"] };
const SOCKET = { id: 3, code: "20210", name: "Розетка", price: 9, series: ["Eikon Evo"] };
const SWITCH = { id: 10, code: "20001.0", name: "Механизм-выключатель 1P 16AX серый", price: 20.26,
  partRole: "bare_mechanism", controlRole: "switch", series: ["Eikon Evo", "Eikon Exe"] };
const CHANGEOVER = { id: 11, code: "20005.0", name: "Механизм-переключатель 1P 16AX серый", price: 25.79,
  partRole: "bare_mechanism", controlRole: "changeover", series: ["Eikon Evo", "Eikon Exe"] };
const INVERTER = { id: 12, code: "20013.0", name: "Механизм переключателя с 4-мя контактами ( инвертор ) 1P 16A",
  price: 42.33, partRole: "bare_mechanism", controlRole: "inverter", series: ["Eikon Evo", "Eikon Exe"] };
const BUTTON_12 = { id: 13, code: "09008.0.12", name: "Механизм кнопки 1П 16AX 1 модуль с подсветкой 12В",
  price: 15, partRole: "bare_mechanism", controlRole: "button", series: ["Neve Up"] };
const BUTTON_250 = { id: 14, code: "09008.0.250", name: "Механизм кнопки 1П 16AX 1 модуль с подсветкой 250В",
  price: 17, partRole: "bare_mechanism", controlRole: "button", series: ["Neve Up"] };
const KEY_NEVE = { id: 4, code: "09021.N", name: "Клавиша 1M neutro, белая", price: 6, partRole: "key", series: ["Neve Up"] };
const MECHS = [SWITCH, CHANGEOVER, INVERTER, BUTTON_12, BUTTON_250];

const ALL = [KEY_EIKON, KEY_PLANA, SOCKET, KEY_NEVE].concat(MECHS);
const product = id => ALL.find(p => p.id === Number(id));
const seriesOf = item => (item && item.series) || [];
const isKey = item => !!item && item.partRole === "key";
const collect = posts => LP.collect(posts, { product, seriesOf, isKey });

/* Настоящий расчёт со строгим подбором — ровно так его подставляет приложение. */
const planOf = (posts, scheme) => {
  const places = collect(posts);
  const plan = LG.plan({ scheme: scheme || "classic", places }, {
    seriesOf,
    findMechanism: q => LP.resolveMechanism(q, MECHS).product
  });
  return { plan, places, rows: LP.rowsByPost(plan, places, LG.GAP_TEXTS) };
};

/* ── сборка мест ──────────────────────────────────────────────────────────────────── */

test("местом управления становится ТОЛЬКО клавиша, а не любой механизм поста", () => {
  const places = collect([{ id: "p1", number: 1, mechanismIds: [1, 3], keyGroups: ["Кухня", "Кухня"] }]);
  assert.equal(places.length, 1);
  assert.equal(places[0].keyId, 1);
});

test("keyIndex — ПОЗИЦИЯ в посте: две одинаковые клавиши это два места, а не дубль", () => {
  /* Соблазн взять индекс через indexOf даёт обеим клавишам адрес 0 — модуль опознал бы дубль,
     посчитал бы одно место и выдал выключатель (20.26 €) вместо двух переключателей. */
  const places = collect([{ id: "p1", number: 1, mechanismIds: [1, 1], keyGroups: ["Кухня", "Кухня"] }]);
  assert.deepEqual(places.map(p => p.keyIndex), [0, 1]);
  const { plan } = planOf([{ id: "p1", number: 1, mechanismIds: [1, 1], keyGroups: ["Кухня", "Кухня"] }]);
  assert.deepEqual(plan.duplicates, []);
  assert.equal(plan.groups[0].placeCount, 2);
  assert.deepEqual(plan.places.map(p => p.code), ["20005.0", "20005.0"]);
});

test("keyIndex всегда десятичное число — модуль читает его именно так", () => {
  const places = collect([{ id: "p1", number: 1, mechanismIds: [1, 1, 1], keyGroups: [] }]);
  places.forEach(p => assert.equal(typeof p.keyIndex, "number"));
  assert.deepEqual(places.map(p => LG.keyIndexOf(p)), [0, 1, 2]);
});

test("группа передаётся СТРОКОЙ: «4.10» и «4.1» остаются разными группами", () => {
  const posts = [{ id: "p1", number: 1, mechanismIds: [1, 1], keyGroups: ["4.10", "4.1"] }];
  const places = collect(posts);
  places.forEach(p => assert.equal(typeof p.group, "string"));
  const { plan } = planOf(posts);
  assert.equal(plan.groups.length, 2, "две разные группы по одному месту");
  assert.deepEqual(plan.places.map(p => p.code), ["20001.0", "20001.0"]);
});

test("пост без keyGroups (старый проект) даёт места с пустой группой, а не падает", () => {
  const { plan } = planOf([{ id: "p1", number: 1, mechanismIds: [1], keyGroups: undefined }]);
  assert.equal(plan.places[0].missing, true);
  assert.equal(plan.places[0].missingReason, LG.GAPS.NO_GROUP);
  assert.ok(plan.gaps.some(g => g.kind === LG.GAPS.NO_GROUP));
});

/* ── подбор механизма ─────────────────────────────────────────────────────────────── */

test("подбор строго по серии: клавише Plana механизм Eikon НЕ подставляется", () => {
  /* EPCatalog.compatibleMechanisms при отсутствии пересечения возвращает ВЕСЬ список —
     здесь так нельзя: чужая серия это неверная смета и физически несобираемый пост. */
  const found = LP.resolveMechanism({ role: "switch", series: ["Plana"] }, MECHS);
  assert.equal(found.product, null);
  const { plan } = planOf([{ id: "p1", number: 1, mechanismIds: [2], keyGroups: ["Кухня"] }]);
  assert.equal(plan.places[0].missingReason, LG.GAPS.NOT_IN_SERIES);
});

test("регистр серий не мешает: серия места приходит в СВОЁМ написании", () => {
  assert.equal(LP.resolveMechanism({ role: "switch", series: ["EIKON EVO"] }, MECHS).product, SWITCH);
  assert.equal(LP.resolveMechanism({ role: "switch", series: ["  eikon exe "] }, MECHS).product, SWITCH);
});

test("изделие без артикула не подбирается вовсе", () => {
  const noCode = Object.assign({}, SWITCH, { code: "   " });
  assert.equal(LP.resolveMechanism({ role: "switch", series: ["Eikon Evo"] }, [noCode]).product, null);
});

test("готовое изделие (не bare_mechanism) за клавишу не подставляется", () => {
  const ready = Object.assign({}, SWITCH, { partRole: "key" });
  assert.equal(LP.resolveMechanism({ role: "switch", series: ["Eikon Evo"] }, [ready]).product, null);
});

test("два кандидата 12 В и 250 В: для сетевой группы выбирается 250 В", () => {
  /* Neve Up: кнопка есть в двух исполнениях. Цепь освещения сетевая, 12-вольтовое изделие в
     ней физически не работает — низковольтный кандидат уходит, выбор становится однозначным. */
  const found = LP.resolveMechanism({ role: "button", series: ["Neve Up"] }, MECHS);
  assert.equal(found.product, BUTTON_250);
  assert.equal(found.ambiguous, false);
});

test("неоднозначность, которую нечем разобрать, НЕ решается монетой", () => {
  const twin = Object.assign({}, BUTTON_250, { id: 99, code: "09008.0.251" });
  const found = LP.resolveMechanism({ role: "button", series: ["Neve Up"] }, [BUTTON_250, twin]);
  assert.equal(found.product, null);
  assert.equal(found.ambiguous, true);
  assert.equal(found.candidates.length, 2);
});

test("isExtraLowVoltage читает напряжение, а не любые цифры названия", () => {
  assert.equal(LP.isExtraLowVoltage(BUTTON_12), true);
  assert.equal(LP.isExtraLowVoltage(BUTTON_250), false);
  assert.equal(LP.isExtraLowVoltage(SWITCH), false, "«16AX» и «1P» — не напряжение");
});

/* ── раскладка по постам ──────────────────────────────────────────────────────────── */

test("классическая схема по числу мест группы: 1 → выключатель, 2 → переключатели, 3 → +инвертор", () => {
  const posts = [
    { id: "p1", number: 1, mechanismIds: [1], keyGroups: ["Одна"] },
    { id: "p2", number: 2, mechanismIds: [1, 1], keyGroups: ["Две", "Две"] },
    { id: "p3", number: 3, mechanismIds: [1, 1, 1], keyGroups: ["Три", "Три", "Три"] }
  ];
  const { rows } = planOf(posts);
  assert.deepEqual(rows.get("p:p1").map(r => r.code), ["20001.0"]);
  assert.deepEqual(rows.get("p:p2").map(r => r.code), ["20005.0", "20005.0"]);
  const three = rows.get("p:p3").map(r => r.code).sort();
  assert.deepEqual(three, ["20005.0", "20005.0", "20013.0"]);
});

test("места одной группы из РАЗНЫХ постов считаются вместе", () => {
  const posts = [
    { id: "p1", number: 1, mechanismIds: [1], keyGroups: ["Кухня"] },
    { id: "p2", number: 2, mechanismIds: [1], keyGroups: ["кухня"] }   /* регистр — то же имя */
  ];
  const { plan, rows } = planOf(posts);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].placeCount, 2);
  assert.equal(rows.get("p:p1")[0].code, "20005.0");
  assert.equal(rows.get("p:p2")[0].code, "20005.0");
});

test("строки поста отсортированы по позиции клавиши, а не по порядку расчёта", () => {
  const posts = [{ id: "p1", number: 1, mechanismIds: [3, 1, 3, 1], keyGroups: ["", "А", "", "Б"] }];
  const { rows } = planOf(posts);
  assert.deepEqual(rows.get("p:p1").map(r => r.keyIndex), [1, 3]);
});

test("строка несёт причину пробела СЛОВАМИ РАСЧЁТА, а не своим текстом", () => {
  const { rows } = planOf([{ id: "p1", number: 1, mechanismIds: [1], keyGroups: [""] }]);
  const row = rows.get("p:p1")[0];
  assert.equal(row.missing, true);
  assert.equal(row.missingText, LG.GAP_TEXTS[LG.GAPS.NO_GROUP]);
});

test("адрес поста читается одним правилом и на стороне приложения", () => {
  assert.equal(LP.postKey({ id: "p7", number: 7 }), "p:p7");
  assert.equal(LP.postKey({ number: " 7 " }), "n:7");
  assert.equal(LP.postKey({}), "");
});

/* ── схемы «Реле» и «Звонковые кнопки» ────────────────────────────────────────────── */

test("схема «Реле»: кнопки на местах и реле БЕЗ артикула", () => {
  const posts = [{ id: "p1", number: 1, mechanismIds: [4, 4], keyGroups: ["Холл", "Холл"] }];
  const { plan, rows } = planOf(posts, "relay");
  assert.deepEqual(rows.get("p:p1").map(r => r.code), ["09008.0.250", "09008.0.250"]);
  assert.equal(plan.relayTotal, 1);
  assert.equal(plan.relays[0].articleKnown, false);
  assert.equal(plan.relays[0].article, null);
  assert.ok(plan.gaps.some(g => g.kind === LG.GAPS.RELAY_ARTICLE));
});

test("«Звонковые кнопки»: расчёта нет и правил никто не выдумывает", () => {
  const posts = [{ id: "p1", number: 1, mechanismIds: [1], keyGroups: ["Кухня"] }];
  const { plan } = planOf(posts, "bell");
  assert.equal(plan.supported, false);
  assert.equal(plan.places[0].missingReason, LG.GAPS.SCHEME_NOT_READY);
  assert.equal(plan.totals.switch, 0);
  assert.ok(plan.gaps.some(g => g.kind === LG.GAPS.SCHEME_NOT_READY));
});

/* ── печатный блок ────────────────────────────────────────────────────────────────── */

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => `${(Number(n) || 0).toFixed(2)} €`;

test("блок печатает группы, подставленные роли и причины пробелов", () => {
  const { plan } = planOf([
    { id: "p1", number: 1, mechanismIds: [1, 1], keyGroups: ["Кухня", "Кухня"] },
    { id: "p2", number: 2, mechanismIds: [1], keyGroups: [""] }
  ]);
  const html = LP.buildHtml(plan, { esc, money, total: 51.58 });
  assert.ok(html.includes("Кухня"));
  assert.ok(html.includes("Переключатель"));
  assert.ok(html.includes(LG.GAP_TEXTS[LG.GAPS.NO_GROUP]), "причина пробела — словами расчёта");
  assert.ok(html.includes("Классическая"));
});

test("блок печатает реле числом и честно говорит, что артикула нет", () => {
  const { plan } = planOf([{ id: "p1", number: 1, mechanismIds: [4], keyGroups: ["Холл"] }], "relay");
  const html = LP.buildHtml(plan, { esc, money });
  assert.ok(html.includes("Импульсное реле"));
  assert.ok(html.includes("артикул не определён"));
});

test("проекту без единой группы и без пробелов блок не нужен вовсе", () => {
  const { plan } = planOf([]);
  assert.equal(LP.buildHtml(plan, { esc, money }), "");
  assert.equal(LP.buildHtml(null, { esc, money }), "");
});

test("имя группы из ввода человека экранируется", () => {
  const { plan } = planOf([{ id: "p1", number: 1, mechanismIds: [1], keyGroups: ['<b>Кухня</b>'] }]);
  const html = LP.buildHtml(plan, { esc, money });
  assert.ok(!html.includes("<b>Кухня</b>"));
  assert.ok(html.includes("&lt;b&gt;Кухня&lt;/b&gt;"));
});

/* ---- Размещение шаблона: группа принадлежит ПОСТУ НА ПЛАНЕ, а не заготовке ---------------
   Это самая дорогая ошибка всего узла, и проверяется она сквозь настоящий расчёт: правило
   копирования полей живёт в EPPosts.placementFields, а цена ошибки видна только здесь —
   в ролях механизмов и в их сумме. */
const EPPosts = require("../js/posts.js");

/* Размещение шаблона на плане ровно так, как это делает addPending: служебные поля от
   приложения, состав — от placementFields. */
const place = (template, n) => Array.from({ length: n }, (_, i) =>
  Object.assign({ id: "post" + (i + 1), number: i + 1 }, EPPosts.placementFields(template)));

test("шаблон с заполненной группой, размещённый трижды, НЕ становится одной группой на три места", () => {
  /* Прямой сценарий заказчика: типовой пост копируется по комнатам. Пока размещение копировало
     группу шаблона, три одинаковых поста давали ОДНУ группу с тремя местами управления —
     проходную схему (переключатель + переключатель + инвертор) вместо трёх независимых
     выключателей. Это другая электрика, другой монтаж и другие деньги, и выбирал это не
     пользователь, а копирование поля. */
  const template = { id: "tpl", name: "Выключатель у двери", frameId: 100,
    mechanismIds: [1], keyGroups: ["Кухня"] };
  const posts = place(template, 3);
  assert.deepEqual(posts.map(p => p.keyGroups), [[""], [""], [""]], "группы не приехали из шаблона");

  const { plan } = planOf(posts);
  assert.equal(plan.groups.length, 0, "одной группы на три места не появилось");
  assert.deepEqual(plan.places.map(p => p.missingReason),
    [LG.GAPS.NO_GROUP, LG.GAPS.NO_GROUP, LG.GAPS.NO_GROUP],
    "каждое место — честный пробел «группа не указана», а не выдуманная группа");
  assert.equal(plan.totals.changeover, 0, "переключателей не подставлено");
  assert.equal(plan.totals.inverter, 0, "инвертора не подставлено");
});

test("те же три поста с группами, заданными НА ПЛАНЕ по одной, дают три выключателя", () => {
  /* Обратная половина правила: заполнить группы у размещённых постов — это по-прежнему
     работающий сценарий, и три разные группы дают три выключателя (3 × 20.26 €), а не
     проходную схему. Сумма проверяется числом: именно она разъезжалась. */
  const template = { id: "tpl", frameId: 100, mechanismIds: [1], keyGroups: ["Кухня"] };
  const posts = place(template, 3);
  ["Кухня", "Спальня", "Холл"].forEach((g, i) => { posts[i].keyGroups = [g]; });
  const { plan } = planOf(posts);
  assert.equal(plan.groups.length, 3, "три разные группы по одному месту");
  assert.equal(plan.totals.switch, 3);
  assert.equal(plan.totals.changeover, 0);
  assert.equal(plan.places.reduce((s, p) => s + (p.product ? p.product.price : 0), 0), 3 * SWITCH.price);
});

test("одна и та же группа в двух размещённых постах — по-прежнему проходная схема", () => {
  /* Проходную схему заказчик выражает ОСОЗНАННО: вводит то же имя группы во втором посте.
     Правило «не копировать» не должно её ломать. */
  const template = { id: "tpl", frameId: 100, mechanismIds: [1], keyGroups: [] };
  const posts = place(template, 2);
  posts.forEach(p => { p.keyGroups = ["Кухня"]; });
  const { plan } = planOf(posts);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].placeCount, 2);
  assert.equal(plan.totals.changeover, 2, "два переключателя — та самая проходная схема");
});

test("placementFields переносит состав поимённо и не тащит чужие поля шаблона", () => {
  /* Забытое поле теряется молча, лишнее — тащит в пост мусор библиотеки (координаты чужого
     поста, id шаблона как id поста). Проверяем обе стороны. */
  const fields = EPPosts.placementFields({ id: "tpl", name: "Пост", frameId: 100,
    mechanismIds: [1, 2], keyGroups: ["Кухня", "Холл"], socketBoxProductId: 30, x: 5, y: 7, number: 42 });
  assert.deepEqual(Object.keys(fields).sort(),
    ["frameId", "keyGroups", "mechanismIds", "name", "socketBoxProductId", "templateId"]);
  assert.equal(fields.templateId, "tpl", "связь с шаблоном сохраняется");
  assert.deepEqual(fields.mechanismIds, [1, 2]);
  assert.deepEqual(fields.keyGroups, ["", ""], "длина как у mechanismIds, значения пустые");
});

test("шаблон без mechanismIds размещается пустым постом, а не падает", () => {
  const fields = EPPosts.placementFields({ id: "tpl" });
  assert.deepEqual(fields.mechanismIds, []);
  assert.deepEqual(fields.keyGroups, []);
  assert.deepEqual(EPPosts.placementFields(null).mechanismIds, []);
});

test("массив механизмов шаблона не мутируется размещением", () => {
  /* Шаблон живёт в библиотеке и переживает много размещений: общий массив связал бы посты
     между собой — правка одного меняла бы остальные. */
  const template = { id: "tpl", mechanismIds: [1, 2] };
  const fields = EPPosts.placementFields(template);
  fields.mechanismIds.push(3);
  assert.deepEqual(template.mechanismIds, [1, 2]);
});
