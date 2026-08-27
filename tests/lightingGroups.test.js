/* Автотесты групп света и схем электрики (EPLightingGroups, ТЗ §2 итогов встречи 24.08).
   Модуль чистый: места управления приходят массивом, каталог — функцией deps.findMechanism,
   поэтому браузер не нужен:  npm test

   Главное, что проверяем, — РАСПРЕДЕЛЕНИЕ ПО МЕСТАМ, а не только суммы: механизмы одной группы
   стоят в разных постах, и смете с листом монтажника важно, какой механизм в каком посте.
   Проверка «инверторов ровно 1» прошла бы и при инверторе, поставленном не туда. */
const test = require("node:test");
const assert = require("node:assert/strict");
const LG = require("../js/lightingGroups.js");
const { ROLES, plan, buildRegistry, classicRole, relayCount, roleFor, normalizeGroup, GAPS } = LG;

/* Фикстуры — РЕАЛЬНЫЕ артикулы, id и цены из js/catalog-vimar.js (сверено 27.08.2026), потому что
   на них построены проверки сумм и пробелов; выдуманный каталог проверял бы выдуманный мир.
   Два полных семейства голых механизмов (Eikon Evo/Exe 20…, Arke 19…) и Neve Up, устроенная
   ИНАЧЕ: голые механизмы (categoryId=500, без moduleSpan) там есть только для выключателя,
   переключателя и кнопки, причём все «с подсветкой», а голого механизма-ИНВЕРТОРА нет вовсе.
   Артикул 09013 в каталоге есть, но это готовое изделие с клавишей в комплекте (moduleSpan=1),
   а не механизм под отдельно выбираемую клавишу, — поэтому в подбор по роли он не попадает и на
   Neve Up классическая схема при N≥3 честно не собирается. Это не дефицит фикстуры, а каталог.
   У кнопки Neve Up кандидатов два (09008.0.12 на 12 В и 09008.0.250 на 250 В) — выбор
   неоднозначен и решается в deps, не в модуле; фикстура берёт 250 В. */
const MECH = {
  "20001.0": { id: 201453, code: "20001.0", price: 20.26, series: ["Eikon Evo", "Eikon Exe"] },
  "20005.0": { id: 201454, code: "20005.0", price: 25.79, series: ["Eikon Evo", "Eikon Exe"] },
  "20013.0": { id: 201456, code: "20013.0", price: 42.33, series: ["Eikon Evo", "Eikon Exe"] },
  "20008.0": { id: 201455, code: "20008.0", price: 19.99, series: ["Eikon Evo", "Eikon Exe"] },
  "19001.0": { id: 200703, code: "19001.0", price: 14.52, series: ["Arke", "Arke Fit"] },
  "19005.0": { id: 200704, code: "19005.0", price: 18.47, series: ["Arke", "Arke Fit"] },
  "19013.0": { id: 200706, code: "19013.0", price: 29.85, series: ["Arke", "Arke Fit"] },
  "19008.0": { id: 200705, code: "19008.0", price: 13.07, series: ["Arke", "Arke Fit"] },
  /* Neve Up: выключатель, переключатель и кнопка есть, ИНВЕРТОРА среди голых механизмов нет. */
  "09001.0.250": { id: 200066, code: "09001.0.250", price: 7.13, series: ["Neve Up"] },
  "09005.0.250": { id: 200071, code: "09005.0.250", price: 8.86, series: ["Neve Up"] },
  "09008.0.250": { id: 200077, code: "09008.0.250", price: 8.86, series: ["Neve Up"] }
};
const ROLE_OF = {
  "20001.0": ROLES.SWITCH, "20005.0": ROLES.CHANGEOVER, "20013.0": ROLES.INVERTER, "20008.0": ROLES.BUTTON,
  "19001.0": ROLES.SWITCH, "19005.0": ROLES.CHANGEOVER, "19013.0": ROLES.INVERTER, "19008.0": ROLES.BUTTON,
  "09001.0.250": ROLES.SWITCH, "09005.0.250": ROLES.CHANGEOVER, "09008.0.250": ROLES.BUTTON
};
const ALL_MECH = Object.values(MECH);

/* Поиск механизма по роли и серии — как это будет делать приложение: пересечение серий, а НЕ
   префикс артикула (правило «ХХ021 → ХХ001.0» ломается на Neve Up: 09021.N → 09001.0.250).
   Нет совпадения — null, подмены чужой серией нет. */
const findMechanism = ({ role, series }) => {
  const want = series.map(s => s.toLocaleLowerCase("ru-RU"));
  return ALL_MECH.find(m => ROLE_OF[m.code] === role
    && m.series.some(s => want.includes(s.toLocaleLowerCase("ru-RU")))) || null;
};
const deps = { findMechanism };

/* Клавиши: у каждой своя серия — ровно то, чем определяется серия механизма. */
const EIKON = ["Eikon Evo", "Eikon Exe"];
const ARKE = ["Arke", "Arke Fit"];
const NEVE = ["Neve Up"];
/* Место управления = одна клавиша в конкретном посте. */
const place = (postNumber, group, series = EIKON, keyIndex = 0) =>
  ({ postId: "p" + postNumber, postNumber, keyIndex, keyId: 900 + postNumber, series, group });

/* Коды механизмов по местам — компактная форма распределения для сравнения. */
const codes = res => res.places.map(p => p.code);
/* Роли по местам. */
const roles = res => res.places.map(p => p.role);
/* Место по номеру поста (у поста в этих фикстурах ровно одна клавиша). */
const atPost = (res, number) => res.places.find(p => p.postNumber === number);
/* Сумма подобранных механизмов — цена проекта по механизмам, та самая «сумма сметы». */
const sum = res => Number(res.places.reduce((s, p) => s + (p.product ? p.product.price : 0), 0).toFixed(2));

/* ─────────────────── нормализация группы и реестр ─────────────────── */

test("нормализация группы: обрезка, схлопывание пробелов, регистронезависимость", () => {
  assert.equal(normalizeGroup("  Кухня  "), "Кухня");
  assert.equal(normalizeGroup("Кухня   центр"), "Кухня центр");
  assert.equal(normalizeGroup(null), "");
  assert.equal(normalizeGroup("   "), "");
  assert.equal(normalizeGroup(71), "71");
  assert.equal(normalizeGroup(NaN), "");           /* не число — не имя группы */
  assert.equal(LG.groupKeyOf("  КУХНЯ "), LG.groupKeyOf("кухня"));
});

test("группа СТРОКОЙ сохраняет форму: «4.1» и «4.10» — РАЗНЫЕ группы, а не одна", () => {
  /* На планах дизайнера номера групп записаны именно строками («71 72», «81 82 83», «4.1 4.2»),
     и «4.10» там — десятая группа, а не первая. Пока ключ группы срезал хвостовые нули дробной
     части у любого числового имени, две РАЗНЫЕ группы по одному месту склеивались в одну с N=2:
     вместо двух выключателей (20.26 €) проект молча получал два переключателя (25.79 €) — другая
     смета и физически другой монтаж. Приводим у строки только регистр и пробелы. */
  assert.notEqual(LG.groupKeyOf("4.10"), LG.groupKeyOf("4.1"));
  assert.notEqual(LG.groupKeyOf("4.0"), LG.groupKeyOf("4"));
  assert.notEqual(LG.groupKeyOf("04.1"), LG.groupKeyOf("4.1"));   /* ведущие нули не трогаем */
  assert.notEqual(LG.groupKeyOf("01"), LG.groupKeyOf("1"));       /* «01» ≠ «1» — написание человека */
  assert.equal(LG.groupKeyOf(" Свет "), LG.groupKeyOf("свет"));   /* регистр и края — единственное, что приводим */
  assert.equal(LG.groupKeyOf("Свет   тёплый"), LG.groupKeyOf("свет тёплый"));
  const at = (n, group) => ({ postId: "p" + n, postNumber: n, keyIndex: 0, series: EIKON, group });
  const res = plan({ scheme: "classic", places: [at(1, "4.1"), at(2, "4.10"), at(3, "4.1")] }, deps);
  assert.deepEqual(res.groups.map(g => [g.label, g.placeCount]), [["4.1", 2], ["4.10", 1]]);
  /* «4.1» — два места (два переключателя), «4.10» — одно (выключатель). */
  assert.deepEqual(codes(res), ["20005.0", "20001.0", "20005.0"]);
});

test("группа ЧИСЛОМ: 4.10 в JS — это 4.1, и модуль этого не скрывает", () => {
  /* Число теряет хвостовой ноль ДО модуля (4.10 === 4.1), восстановить его невозможно — поэтому
     число 4.10 попадает в группу «4.1» и складывается с местом, где группа задана строкой «4.1».
     Различать «4.1» и «4.10» можно ТОЛЬКО строками; так они и приходят с плана. */
  assert.equal(LG.groupKeyOf(4.10), LG.groupKeyOf("4.1"));
  assert.notEqual(LG.groupKeyOf(4.10), LG.groupKeyOf("4.10"));
  assert.equal(LG.groupKeyOf(4.0), LG.groupKeyOf("4"));
  assert.equal(LG.groupKeyOf(71), LG.groupKeyOf("71"));
  const num = { postId: "p1", postNumber: 1, keyIndex: 0, series: EIKON, group: 4.10 };
  const str = { postId: "p2", postNumber: 2, keyIndex: 0, series: EIKON, group: "4.1" };
  const other = { postId: "p3", postNumber: 3, keyIndex: 0, series: EIKON, group: "4.10" };
  const res = plan({ scheme: "classic", places: [num, str, other] }, deps);
  assert.deepEqual(res.groups.map(g => [g.label, g.placeCount]), [["4.1", 2], ["4.10", 1]]);
  assert.deepEqual(codes(res), ["20005.0", "20005.0", "20001.0"]);
});

test("реестр: «Кухня», «кухня» и «Кухня  » — одна группа с тремя местами", () => {
  const reg = buildRegistry([place(1, "Кухня"), place(2, "кухня"), place(3, "Кухня  ")]);
  assert.equal(reg.groups.length, 1);
  assert.equal(reg.groups[0].placeCount, 3);
  assert.deepEqual(reg.groups[0].posts.map(p => p.number), [1, 2, 3]);
});

test("название группы печатается по первому месту ПО ПЛАНУ, а не по порядку вызова", () => {
  /* Написаний три разных, и они не совпадают — иначе тест прошёл бы при любой реализации. */
  const expected = "кухня";   /* пост 1 — первый в каноническом порядке */
  assert.equal(buildRegistry([place(3, "КУХНЯ"), place(1, "кухня"), place(2, "Кухня")]).groups[0].label, expected);
  assert.equal(buildRegistry([place(2, "Кухня"), place(3, "КУХНЯ"), place(1, "кухня")]).groups[0].label, expected);
  assert.equal(buildRegistry([place(1, "кухня"), place(2, "Кухня"), place(3, "КУХНЯ")]).groups[0].label, expected);
});

test("реестр: в каких постах группа и сколько мест в каждом", () => {
  const reg = buildRegistry([
    place(1, "Холл", EIKON, 0), place(1, "Холл", EIKON, 1), place(4, "Холл"), place(2, "Спальня")
  ]);
  const hall = reg.byKey.get("холл");
  assert.equal(hall.placeCount, 3);
  assert.deepEqual(hall.posts, [{ id: "p1", number: 1, placeCount: 2 }, { id: "p4", number: 4, placeCount: 1 }]);
  assert.deepEqual(reg.groups.map(g => g.label), ["Холл", "Спальня"]);   /* порядок — по первому месту */
});

test("реестр: пустая группа не создаёт группу, а попадает в «не назначено»", () => {
  const reg = buildRegistry([place(1, ""), place(2, "  "), place(3, null), place(4, "Кухня")]);
  assert.equal(reg.groups.length, 1);
  assert.equal(reg.unassigned.placeCount, 3);
  assert.deepEqual(reg.unassigned.places, [0, 1, 2]);
});

/* ─────────────────── классическая схема: формула ─────────────────── */

test("формула классической схемы: 1 место — выключатель, дальше два переключателя и инверторы", () => {
  assert.equal(classicRole(0, 1), ROLES.SWITCH);
  assert.deepEqual([classicRole(0, 2), classicRole(1, 2)], [ROLES.CHANGEOVER, ROLES.CHANGEOVER]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => classicRole(i, 5)),
    [ROLES.CHANGEOVER, ROLES.CHANGEOVER, ROLES.INVERTER, ROLES.INVERTER, ROLES.INVERTER]);
});

test("формулы вне контракта не выдумывают роль и не дают отрицательных реле", () => {
  /* N=0, отрицательные, дробные и «числа строкой» — это ошибка вызывающего, а не крайний случай
     расчёта. Молчаливый «Выключатель» при count=0 как раз и был бы правдоподобным враньём. */
  assert.equal(classicRole(0, 0), null);
  assert.equal(classicRole(0, -2), null);
  assert.equal(classicRole(-1, 3), null);
  assert.equal(classicRole(3, 3), null);          /* индекс за пределами группы */
  assert.equal(classicRole(0.5, 2), null);
  assert.equal(classicRole(0, 2.5), null);        /* дробное ЧИСЛО МЕСТ — тоже не крайний случай */
  assert.equal(classicRole("0", 1), null);
  assert.equal(classicRole(0, "2"), null);        /* «число строкой» роль не даёт */
  assert.equal(classicRole(NaN, 2), null);
  assert.equal(classicRole(0, NaN), null);
  assert.equal(roleFor("relay", 0, 0), null);
  assert.equal(roleFor("relay", 0, 1), ROLES.BUTTON);
  assert.equal(relayCount(-3), 0);
  assert.equal(relayCount(NaN), 0);
  assert.equal(relayCount("шесть"), 0);
  assert.equal(relayCount(null), 0);
});

test("N=1: одно место — выключатель ХХ001.0 в этом самом посте", () => {
  const res = plan({ scheme: "classic", places: [place(7, "Кухня")] }, deps);
  assert.equal(res.supported, true);
  assert.deepEqual(codes(res), ["20001.0"]);
  assert.equal(res.places[0].role, ROLES.SWITCH);
  assert.equal(res.places[0].roleLabel, "Выключатель");
  assert.equal(res.places[0].postNumber, 7);
  assert.equal(res.places[0].placeCount, 1);
  assert.equal(res.places[0].placeNo, 1);
  assert.equal(res.places[0].missing, false);
  assert.deepEqual(res.groups[0].roles, { switch: 1, changeover: 0, inverter: 0, button: 0 });
});

test("N=2: ДВА переключателя ХХ005.0 — по одному в каждом посте, выключателя нет ни одного", () => {
  const res = plan({ scheme: "classic", places: [place(1, "Холл"), place(5, "Холл")] }, deps);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
  assert.equal(atPost(res, 1).role, ROLES.CHANGEOVER);
  assert.equal(atPost(res, 5).role, ROLES.CHANGEOVER);
  assert.equal(res.totals.switch, 0);
  assert.deepEqual(res.places.map(p => p.placeNo), [1, 2]);
});

test("N=3: два переключателя + ОДИН инвертор, и инвертор стоит в третьем по порядку посту", () => {
  const res = plan({ scheme: "classic", places: [place(1, "Холл"), place(2, "Холл"), place(3, "Холл")] }, deps);
  /* Именно распределение: суммы «2 переключателя + 1 инвертор» сошлись бы и при инверторе,
     поставленном в первый пост — а это другой монтаж. */
  assert.deepEqual(codes(res), ["20005.0", "20005.0", "20013.0"]);
  assert.equal(atPost(res, 3).roleLabel, "Инвертор");
  assert.equal(atPost(res, 3).postId, "p3");
  assert.deepEqual(res.groups[0].roles, { switch: 0, changeover: 2, inverter: 1, button: 0 });
});

test("N=5: два переключателя + ТРИ инвертора, переключатели — на первых двух местах", () => {
  const places = [1, 2, 3, 4, 5].map(n => place(n, "Лестница"));
  const res = plan({ scheme: "classic", places }, deps);
  assert.deepEqual(codes(res), ["20005.0", "20005.0", "20013.0", "20013.0", "20013.0"]);
  assert.deepEqual(res.places.map(p => p.postNumber), [1, 2, 3, 4, 5]);
  assert.deepEqual(res.totals, { switch: 0, changeover: 2, inverter: 3, button: 0 });
  assert.equal(res.missingTotal, 0);
});

test("классическая схема: реле не считаются вовсе — ни секции, ни пробела про артикул", () => {
  const res = plan({ scheme: "classic", places: [1, 2, 3, 4, 5].map(n => place(n, "Холл")) }, deps);
  assert.deepEqual(res.relays, []);
  assert.equal(res.relayTotal, 0);
  assert.equal(res.totals.button, 0);
  assert.ok(!res.gaps.some(g => g.kind === GAPS.RELAY_ARTICLE));
});

/* ─────────────────── детерминированность ─────────────────── */

/* Слепок результата, НЕ ЗАВИСЯЩИЙ от порядка входа: места опознаём по посту и клавише. Входные
   индексы (index, order, group.places, unassigned.places, gaps[].places) — это ссылки на позицию
   во ВХОДНОМ списке, они по определению следуют за ним и в слепок не берутся. */
const fingerprint = res => ({
  scheme: res.scheme, supported: res.supported, sum: sum(res),
  totals: res.totals, totalsRequired: res.totalsRequired, missingTotal: res.missingTotal,
  relayTotal: res.relayTotal,
  places: res.places.map(p => [p.postNumber, p.keyIndex, p.groupKey, p.groupLabel, p.placeNo,
    p.placeCount, p.role, p.code, p.missing, p.missingReason])
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])),
  groups: res.groups.map(g => [g.key, g.label, g.placeCount, g.roles, g.rolesRequired, g.missing, g.posts]),
  relays: res.relays.map(r => [r.groupKey, r.buttonCount, r.count]),
  gaps: res.gaps.map(g => [g.kind, g.groupKey, g.text])
});

/* Проект-стенд для проверок порядка. Собран так, чтобы порядок входа МОГ изменить результат, —
   иначе тест на детерминированность прошёл бы и на сломанном модуле:
     «Холл»    — одна серия: меняется только раскладка ролей по постам;
     «Коридор» — РАЗНЫЕ серии в одной группе (пост на Arke, два на Eikon): инвертор Arke стоит
                 29.85 €, Eikon — 42.33 €, так что от того, кому достанется инвертор, зависит
                 СУММА проекта;
     «Ванная»  — пост на Neve Up и два на Eikon: у Neve Up голого инвертора нет вовсе, так что от
                 порядка зависело, появится пробел или нет;
     «Лестница» — вся на Neve Up; плюс двухклавишный пост, клавиша без группы и группа-одиночка. */
const MIXED = [
  place(2, "Холл", EIKON, 1), place(1, "Холл", EIKON, 0), place(3, "Холл", EIKON, 0),
  place(4, "Лестница", NEVE, 0), place(5, "Лестница", NEVE, 0), place(6, "Лестница", NEVE, 0),
  place(10, "Коридор", ARKE, 0), place(11, "Коридор", EIKON, 0), place(12, "Коридор", EIKON, 0),
  place(13, "Ванная", NEVE, 0), place(14, "Ванная", EIKON, 0), place(15, "Ванная", EIKON, 0),
  place(1, "Кухня", EIKON, 1), place(7, "", ARKE, 0), place(8, "Спальня", ARKE, 0)
];
/* Детерминированные перестановки: обратная, циклический сдвиг и «через одного». */
const PERMUTATIONS = {
  "обратный порядок": list => list.slice().reverse(),
  "сдвиг на 4": list => list.slice(4).concat(list.slice(0, 4)),
  "через одного": list => list.filter((_, i) => i % 2 === 0).concat(list.filter((_, i) => i % 2 === 1))
};

test("порядок мест на входе НЕ влияет на результат: перемешанный список даёт то же самое", () => {
  /* Это главный инвариант модуля: один и тот же проект обязан считаться одинаково, в каком бы
     порядке приложение ни собрало список мест. Раньше «первые два места» брались по порядку
     ВХОДА, и от него зависели и раскладка, и сумма, и сама вычислимость проекта. */
  const base = plan({ scheme: "classic", places: MIXED }, deps);
  Object.entries(PERMUTATIONS).forEach(([name, permute]) => {
    const other = plan({ scheme: "classic", places: permute(MIXED) }, deps);
    assert.deepEqual(fingerprint(other), fingerprint(base), "перестановка: " + name);
  });
});

test("СУММА СМЕТЫ не зависит от порядка входа: переключатель и инвертор стоят по-разному", () => {
  /* Группа «Коридор» собрана из постов РАЗНЫХ серий: инвертор Arke 29.85 €, инвертор Eikon
     42.33 €, переключатели 18.47 и 25.79. Пока «первые два» брались по порядку ВХОДА, от него
     зависело, какой серии достанется инвертор, — и вместе с ним итог проекта в деньгах. */
  const base = sum(plan({ scheme: "classic", places: MIXED }, deps));
  assert.equal(base, 309.98);   /* цифра приколочена: смена правила порядка обязана быть заметной */
  Object.entries(PERMUTATIONS).forEach(([name, permute]) => {
    assert.equal(sum(plan({ scheme: "classic", places: permute(MIXED) }, deps)), base, "перестановка: " + name);
  });
});

test("от порядка входа не зависит и САМА ВЫЧИСЛИМОСТЬ: пробел Neve Up не появляется и не исчезает", () => {
  /* Роль inverter есть не во всех сериях: на Neve Up голого механизма-инвертора нет вовсе
     (09013 — готовое изделие с клавишей). В группе «Ванная» пост на Neve Up и два на Eikon, и
     раньше от порядка входа зависело, достанется ли инвертор посту Neve Up, — то есть один и тот
     же проект при одном порядке считался, а при другом упирался в пробел. */
  const bath = MIXED.filter(p => p.group === "Ванная");
  [bath, bath.slice().reverse(), [bath[1], bath[2], bath[0]]].forEach(list => {
    const res = plan({ scheme: "classic", places: list }, deps);
    assert.equal(atPost(res, 13).code, "09005.0.250");   /* Neve Up тянет переключатель… */
    assert.equal(atPost(res, 14).code, "20005.0");
    assert.equal(atPost(res, 15).code, "20013.0");       /* …а инвертор уходит на Eikon */
    assert.equal(res.missingTotal, 0);
  });
  /* А там, где на Neve Up вся группа, пробел есть при любом порядке — и всегда на одном месте. */
  const stairs = MIXED.filter(p => p.group === "Лестница");
  [stairs, stairs.slice().reverse()].forEach(list => {
    const res = plan({ scheme: "classic", places: list }, deps);
    assert.deepEqual(res.places.map(p => [p.postNumber, p.code]).sort((a, b) => a[0] - b[0]),
      [[4, "09005.0.250"], [5, "09005.0.250"], [6, null]]);
    assert.equal(atPost(res, 6).missingReason, GAPS.NOT_IN_SERIES);
    assert.equal(res.missingTotal, 1);
  });
});

test("каталог видит ОДИН И ТОТ ЖЕ ДИАЛОГ: те же вопросы в том же порядке при любом входе", () => {
  /* Ответы от порядка входа не зависят с тех пор, как ключ кэша равен аргументу, но сама ОЧЕРЕДЬ
     вопросов раньше шла по входному списку — и порядок входа оставался ВИДЕН каталогу. Любая
     реализация deps с состоянием (свой кэш второго уровня, ленивая догрузка серии, счётчик, лог)
     на этом снова привязала бы смету к порядку. Подбор идёт в каноническом порядке, поэтому
     диалог с каталогом воспроизводится дословно. */
  const dialogue = places => {
    const asked = [];
    const spy = { findMechanism: args => { asked.push([args.role, args.series.join("+")]); return findMechanism(args); } };
    plan({ scheme: "classic", places }, spy);
    return asked;
  };
  const base = dialogue(MIXED);
  assert.ok(base.length >= 4, "проект-стенд спрашивает каталог не один раз");
  Object.entries(PERMUTATIONS).forEach(([name, permute]) => {
    assert.deepEqual(dialogue(permute(MIXED)), base, "перестановка: " + name);
  });
  /* И порядок этот — КАНОНИЧЕСКИЙ (res.order), а не какой-нибудь свой, лишь бы устойчивый:
     вопросы идут по местам плана, каждая пара «роль + серия» — при первом её появлении. */
  const res = plan({ scheme: "classic", places: MIXED }, deps);
  const expected = [];
  res.order.forEach(i => {
    const p = res.places[i];
    if (!p.role || !p.series) return;
    const ask = [p.role, p.series.join("+")];
    if (!expected.some(a => a[0] === ask[0] && a[1] === ask[1])) expected.push(ask);
  });
  assert.deepEqual(base, expected);
});

test("переключатели достаются первым местам ПО ПЛАНУ (пост, затем клавиша в посте)", () => {
  /* Наше решение о порядке — по номеру поста, внутри поста по индексу клавиши. Подаём список
     задом наперёд: раскладка обязана следовать плану, а не вызову. */
  const res = plan({ scheme: "classic", places: [
    place(3, "Холл", EIKON, 0), place(1, "Холл", EIKON, 1), place(1, "Холл", EIKON, 0)
  ] }, deps);
  const at = (post, key) => res.places.find(p => p.postNumber === post && p.keyIndex === key);
  assert.equal(at(1, 0).role, ROLES.CHANGEOVER);   /* пост 1, клавиша 0 — первое место */
  assert.equal(at(1, 1).role, ROLES.CHANGEOVER);   /* пост 1, клавиша 1 — второе */
  assert.equal(at(3, 0).role, ROLES.INVERTER);     /* пост 3 — третье */
  assert.deepEqual(res.places.map(p => p.placeNo), [3, 2, 1]);
  assert.deepEqual(res.totals, { switch: 0, changeover: 2, inverter: 1, button: 0 });
});

test("место без номера поста уходит в КОНЕЦ цепи: инвертор достаётся ему, а не посту с плана", () => {
  /* «Пусто — в конец» решает деньги: перевернись правило, инвертор (42.33 €) уехал бы на пост
     с номером, а безадресное место получило бы переключатель (25.79 €). */
  const at = n => ({ postId: "p" + n, postNumber: n, keyIndex: 0, series: EIKON, group: "Холл" });
  const noPost = { keyIndex: 0, series: EIKON, group: "Холл" };
  const res = plan({ scheme: "classic", places: [noPost, at(1), at(2)] }, deps);
  assert.deepEqual(codes(res), ["20013.0", "20005.0", "20005.0"]);
  assert.deepEqual(res.places.map(p => p.placeNo), [3, 1, 2]);
  assert.deepEqual(res.order, [1, 2, 0]);
});

test("порядок постов — по НОМЕРУ на плане, а не по внутреннему id поста", () => {
  /* id поста — техническая строка (в проекте это uuid), номер — то, что человек видит на плане и
     в листе монтажника. Сортируй мы по id, инвертор (42.33 €) уезжал бы на пост, которому просто
     досталась «удачная» строка id, — а на плане он обязан стоять на третьем по счёту месте. */
  const at = (id, number) => ({ postId: id, postNumber: number, keyIndex: 0, series: EIKON, group: "Холл" });
  const res = plan({ scheme: "classic", places: [at("z-9f", 1), at("a-01", 2), at("m-77", 3)] }, deps);
  assert.deepEqual(res.order, [0, 1, 2]);
  assert.deepEqual(codes(res), ["20005.0", "20005.0", "20013.0"]);
});

test("нет номеров постов — порядок задаёт id поста, и «p2» раньше «p10», как читает человек", () => {
  const byId = id => ({ postId: id, keyIndex: 0, series: EIKON, group: "Холл" });
  const res = plan({ scheme: "classic", places: [byId("p10"), byId("p2"), byId("p1")] }, deps);
  assert.deepEqual(res.order, [2, 1, 0]);
  assert.deepEqual(res.places.map(p => [p.postId, p.code]),
    [["p10", "20013.0"], ["p2", "20005.0"], ["p1", "20005.0"]]);
});

/* Полнота канонического порядка. Ключ сортировки обязан содержать ВСЁ, что модуль читает у места:
   пока он обрывался на адресе, места, неразличимые по адресу (обычное дело, когда приложение не
   передало индекс клавиши), но несущие разную группу или разную серию, раскладывались по ролям в
   порядке ВХОДА — та же болезнь, от которой канонический порядок и заведён. */
const bare = (group, series, keyId) =>
  ({ postId: "p1", postNumber: 1, series, group, key: { id: keyId, series } });

test("канонический порядок ПОЛОН: места без позиции клавиши различаются группой, потом серией", () => {
  const list = [
    bare("Холл", EIKON, 7), bare("", EIKON, 7), bare("Холл", ARKE, 7), bare("Кухня", EIKON, 7)
  ];
  const tag = i => [list[i].group || "—", list[i].series[0]].join("/");
  /* Кухня < Холл по коллации; внутри «Холла» Arke < Eikon; место без группы — в самый конец. */
  const expected = ["Кухня/Eikon Evo", "Холл/Arke", "Холл/Eikon Evo", "—/Eikon Evo"];
  assert.deepEqual(LG.canonicalOrder(list).map(tag), expected);
  Object.entries(PERMUTATIONS).forEach(([name, permute]) => {
    const other = permute(list.map((p, i) => ({ p, i })));
    assert.deepEqual(LG.canonicalOrder(other.map(r => r.p)).map(j => tag(other[j].i)),
      expected, "перестановка: " + name);
  });
  /* Реестр и plan берут ровно этот порядок — второй копии сортировки в модуле нет. */
  assert.deepEqual(LG.buildRegistry(list).order, LG.canonicalOrder(list));
  assert.deepEqual(plan({ scheme: "classic", places: list }, deps).order, LG.canonicalOrder(list));
});

test("одинаковые адрес, группа и серия — порядок доопределяет товар клавиши", () => {
  const a = bare("Холл", EIKON, 201458), b = bare("Холл", EIKON, 201457);
  assert.deepEqual(LG.canonicalOrder([a, b]), [1, 0]);
  assert.deepEqual(LG.canonicalOrder([b, a]), [0, 1]);
});

test("ПОЗИЦИЯ клавиши в ключе сортировки решает РАНЬШЕ товара клавиши", () => {
  /* Порядок членов ключа — не косметика, а «как человек читает пост»: клавиши слева направо по
     ПОЗИЦИИ, а не по тому, какой товар в них вставлен. В остальных фикстурах у клавиш одного
     поста товар совпадает, поэтому перестановка этих двух членов ничего не меняла и правило
     держалось на честном слове. Здесь товары РАЗНЫЕ и упорядочены ПРОТИВ позиций: по keyIndex
     порядок 0, 1, 2, по keyId — ровно обратный. Поменяй члены ключа местами — инвертор (42.33 €)
     уедет с третьей клавиши поста на первую, а на плане и в листе монтажника он обязан стоять
     на третьем по счёту месте. */
  const key = (keyIndex, keyId) =>
    ({ postId: "p1", postNumber: 1, keyIndex, keyId, series: EIKON, group: "Холл" });
  const list = [key(0, "k9"), key(1, "k5"), key(2, "k1")];
  assert.deepEqual(LG.canonicalOrder(list), [0, 1, 2]);              /* по keyId было бы [2, 1, 0] */
  assert.deepEqual(LG.canonicalOrder(list.slice().reverse()), [2, 1, 0]);
  const res = plan({ scheme: "classic", places: list }, deps);
  const at = i => res.places.find(p => p.keyIndex === i);
  assert.equal(at(0).code, "20005.0");
  assert.equal(at(1).code, "20005.0");
  assert.equal(at(2).code, "20013.0", "инвертор — на ТРЕТЬЕЙ клавише, а не на клавише с товаром k9");
  assert.deepEqual(res.places.map(p => p.placeNo), [1, 2, 3]);
});

test("порядок различает места ТЕМИ ЖЕ сериями, что и подбор: канон читает deps.seriesOf", () => {
  /* Если приложение читает серию по-своему, а канонический порядок — по-нашему, места,
     различимые только серией, снова раскладываются по ролям в порядке входа. */
  const seriesOf = item => (item && item.vimarSeries ? [item.vimarSeries] : []);
  const at = vimarSeries => ({ postId: "p1", postNumber: 1, group: "Холл", key: { id: 5, vimarSeries } });
  const list = [at("Neve Up"), at("Arke"), at("Eikon Evo")];
  const seriesOrder = places => LG.canonicalOrder(places, seriesOf).map(i => places[i].key.vimarSeries);
  assert.deepEqual(seriesOrder(list), ["Arke", "Eikon Evo", "Neve Up"]);
  assert.deepEqual(seriesOrder(list.slice().reverse()), ["Arke", "Eikon Evo", "Neve Up"]);
  [list, list.slice().reverse()].forEach(places => {
    const res = plan({ scheme: "classic", places }, { findMechanism, seriesOf });
    const roleOf = s => res.places[places.findIndex(p => p.key.vimarSeries === s)].role;
    assert.equal(roleOf("Arke"), ROLES.CHANGEOVER);
    assert.equal(roleOf("Eikon Evo"), ROLES.CHANGEOVER);
    assert.equal(roleOf("Neve Up"), ROLES.INVERTER);   /* инвертор всегда на Neve Up, а не на входном первом */
  });
});

test("места без позиции клавиши: раскладка ролей и СУММА не зависят от порядка входа", () => {
  /* Три клавиши в одном посту, позиции не переданы. Раньше ключ сортировки на этом обрывался, и
     роли раздавались по порядку входа: инвертор (42.33 € на Eikon, 29.85 € на Arke, а на Neve Up
     его нет вовсе) доставался тому, кого первым положили в список. */
  const list = [bare("Холл", ARKE, 1), bare("Холл", EIKON, 1), bare("Холл", NEVE, 1)];
  const check = places => {
    const res = plan({ scheme: "classic", places }, deps);
    const bySeries = s => res.places.find(p => p.series && p.series[0] === s);
    assert.equal(res.groups[0].placeCount, 3);
    assert.equal(bySeries("Arke").code, "19005.0");          /* Arke и Eikon — переключатели… */
    assert.equal(bySeries("Eikon Evo").code, "20005.0");
    assert.equal(bySeries("Neve Up").role, ROLES.INVERTER);  /* …а инвертор всегда на Neve Up, */
    assert.equal(bySeries("Neve Up").missingReason, GAPS.NOT_IN_SERIES);   /* где его нет в серии */
    assert.equal(sum(res), 44.26);
  };
  [list, list.slice().reverse(), [list[1], list[2], list[0]], [list[2], list[0], list[1]]].forEach(check);
});

test("подпись серий в ключе сортировки НЕСКЛЕИВАЕМА: [«Arke|Arke Fit»] — это не [«Arke», «Arke Fit»]", () => {
  /* Ровно тот дефект, что раньше чинили в КЛЮЧЕ КЭША, но в КЛЮЧЕ СОРТИРОВКИ: подпись серий
     склеивалась через «|», и набор [«Arke|Arke Fit»] (приложение отдало серии одной строкой, не
     разбив по разделителю) получал ту же подпись «arke|arke fit», что и честный [«Arke»,
     «Arke Fit»]. Тайбрейк по сериям на этом проваливался на замыкающую позицию во входном
     списке — и раскладка ролей снова зависела от ПОРЯДКА ВХОДА: один и тот же проект давал
     36.94 € при одном порядке и 48.32 € при другом, потому что от входа зависело, кому достанется
     инвертор 19013.0 за 29.85 €.
     Три места в одном посту без позиций клавиш: адрес, группа и товар у всех одинаковы, различает
     их ТОЛЬКО набор серий — до него ключ сортировки и обязан дойти неслипшимся. */
  const at = series => ({ postId: "p1", postNumber: 1, keyId: 7, group: "Холл", series });
  const glued = () => at(["Arke|Arke Fit"]);   /* один элемент с разделителем внутри */
  const split = () => at(ARKE);                /* два элемента — ДРУГОЙ набор, та же склейка */

  /* Кто из двух идёт первым, решают СЕРИИ, а не позиция во входном списке: на склеенной подписи
     первым шёл поданный первым. Сравниваем длиной набора — какой именно из двух наборов канон
     ставит вперёд, тесту не важно, важно что один и тот же при любом входе. */
  const firstOf = places => places[LG.canonicalOrder(places)[0]].series.length;
  assert.equal(firstOf([glued(), split()]), firstOf([split(), glued()]));

  [[glued(), split(), split()], [split(), split(), glued()], [split(), glued(), split()]]
    .forEach((places, i) => {
      const res = plan({ scheme: "classic", places }, deps);
      const note = "перестановка " + i;
      /* 18.47 + 18.47: переключатели достаются честной серии, инвертор — склеенной, а её в
         каталоге нет (правило «чужую серию не подставляем»), отсюда пробел вместо 29.85 €. */
      assert.equal(sum(res), 36.94, note);
      assert.equal(res.missingTotal, 1, note);
      const bad = res.places.find(p => p.series && p.series.length === 1);
      assert.equal(bad.role, ROLES.INVERTER, note);
      assert.equal(bad.missingReason, GAPS.NOT_IN_SERIES, note);
      assert.deepEqual(res.places.filter(p => p.series && p.series.length === 2).map(p => p.code),
        ["19005.0", "19005.0"], note);
    });
});

test("серия клавиши неизвестна — место уходит в КОНЕЦ цепи, как всякое пустое поле ключа", () => {
  /* Подпись серий — последнее содержательное поле ключа, и её пустота обязана вести себя как
     пустота, а не как значение: механизма место без серии не получит в любом случае (пробел
     NO_SERIES), но от его позиции зависят ДЕНЬГИ соседей. Стой оно в начале цепи, переключатель
     (25.79 €) достался бы ему, а настоящему месту с плана — инвертор (42.33 €): +16.54 € из
     ниоткуда. Проверяем при всех перестановках — правило про порядок, а не про вход. */
  const at = () => ({ postId: "p1", postNumber: 1, keyId: 7, group: "Холл", series: EIKON });
  const blind = () => ({ postId: "p1", postNumber: 1, keyId: 7, group: "Холл" });   /* серии нет вовсе */
  [[at(), at(), blind()], [blind(), at(), at()], [at(), blind(), at()]].forEach((places, i) => {
    const res = plan({ scheme: "classic", places }, deps);
    const note = "перестановка " + i;
    const lost = res.places.find(p => !p.series);
    assert.equal(lost.role, ROLES.INVERTER, note);          /* последний в цепи — он */
    assert.equal(lost.missingReason, GAPS.NO_SERIES, note);
    assert.deepEqual(res.places.filter(p => p.series).map(p => p.code), ["20005.0", "20005.0"], note);
    assert.equal(sum(res), 51.58, note);
  });
});

test("сравнение значений ключа ТРАНЗИТИВНО: смешанные типы не образуют цикла", () => {
  /* Пока числа сравнивались численно, а всё прочее строками, на смешанных типах получался цикл:
     9 < 10 (как числа), 10 < «5» (как строки «10» < «5»), «5» < 9 (как строки). Нетранзитивный
     компаратор нарушает контракт Array#sort — спецификация результат не определяет вовсе, он
     может отличаться между движками и между запусками, а от него зависит, кому достанется
     инвертор. Правило одно: пусто — в конец, числа раньше строк, внутри разряда — однородно. */
  const VALUES = [9, 10, "5", "10", "9", "p2", "p10", 2, "05", null];
  const one = postId => ({ postId, keyIndex: 0, series: EIKON, group: "Холл" });
  const order = list => LG.canonicalOrder(list).map(i => list[i].postId);
  const list = VALUES.map(one);
  /* Разряд решает первым: числа по возрастанию, дальше строки коллацией («p2» раньше «p10»),
     «05» и «5» равны по коллации и разводятся кодами символов, пусто — в самый конец. */
  const expected = [2, 9, 10, "05", "5", "9", "10", "p2", "p10", null];
  assert.deepEqual(order(list), expected);
  Object.entries(PERMUTATIONS).forEach(([name, permute]) => {
    assert.deepEqual(order(permute(list)), expected, "перестановка: " + name);
  });
  /* Транзитивность по определению: глобальный порядок согласован с ПОПАРНЫМ для всех пар. Цикл
     из трёх значений неизбежно даёт пару, где попарное сравнение спорит с общим порядком. */
  for (let i = 0; i < expected.length; i++) {
    for (let j = i + 1; j < expected.length; j++) {
      const pair = [one(expected[i]), one(expected[j])];
      assert.deepEqual(LG.canonicalOrder(pair), [0, 1],
        "пара " + String(expected[i]) + " / " + String(expected[j]) + " спорит с общим порядком");
      /* Та же пара, поданная задом наперёд: первым обязан встать тот же элемент (входной индекс 1). */
      assert.deepEqual(LG.canonicalOrder([pair[1], pair[0]]), [1, 0],
        "перевёрнутая пара " + String(expected[i]) + " / " + String(expected[j]));
    }
  }
});

/* ─────────────────── несколько групп и серий ─────────────────── */

test("несколько групп в проекте считаются независимо, в том числе внутри одного поста", () => {
  const res = plan({ scheme: "classic", places: [
    place(1, "Кухня", EIKON, 0),      /* двухклавишный пост: две разные группы */
    place(1, "Холл", EIKON, 1),
    place(2, "Холл"),                 /* холл — с двух мест */
    place(3, "Спальня")               /* спальня — с одного */
  ] }, deps);
  assert.deepEqual(codes(res), ["20001.0", "20005.0", "20005.0", "20001.0"]);
  assert.deepEqual(res.groups.map(g => [g.label, g.placeCount]), [["Кухня", 1], ["Холл", 2], ["Спальня", 1]]);
  /* Клавиши внутри поста различаются по keyIndex — по нему приложение вернёт механизм на место. */
  assert.equal(res.places.find(p => p.postNumber === 1 && p.keyIndex === 1).groupLabel, "Холл");
  assert.deepEqual(res.totals, { switch: 2, changeover: 2, inverter: 0, button: 0 });
});

test("разные серии клавиш в одном проекте — механизм своей серии у каждой", () => {
  const res = plan({ scheme: "classic", places: [
    place(1, "Кухня", EIKON), place(2, "Спальня", ARKE), place(3, "Холл", ARKE), place(4, "Холл", ARKE)
  ] }, deps);
  assert.deepEqual(codes(res), ["20001.0", "19001.0", "19005.0", "19005.0"]);
});

test("порядок серий внутри клавиши ничего не меняет — серии это множество", () => {
  const res = plan({ scheme: "classic", places: [place(1, "Кухня", ["Eikon Exe", " Eikon Evo ", "Eikon Exe"])] }, deps);
  assert.equal(res.places[0].code, "20001.0");
  assert.deepEqual(res.places[0].series, ["Eikon Evo", "Eikon Exe"]);   /* без повторов, по алфавиту */
});

test("набор серий — функция ОТ САМИХ СЕРИЙ, а не от их порядка: ни повтор, ни сортировка не смотрят на вход", () => {
  /* canonicalSeries — то, что уходит в deps.findMechanism, поэтому от порядка внутри клавиши он
     обязан не зависеть НИЧЕМ. Два места, где он это обещание нарушал:
       • повтор отсеивался по ПРИВЕДЁННОМУ РЕГИСТРУ, а в наборе оставалось написание ПЕРВОГО по
         входу: [«Eikon Evo», «EIKON EVO»] → [«Eikon Evo»], а обратный порядок → [«EIKON EVO»].
         Каталогу, сравнивающему серии строками, это разные вопросы — и разные деньги;
       • сортировка шла голым localeCompare, а он НЕ строгий полный порядок: две разные строки,
         равные по коллации (NFC- и NFD-запись одного имени — «É» одним символом и «E» + U+0301),
         он объявляет равными, и их взаимный порядок в наборе снова задавал вход. */
  assert.deepEqual(LG.canonicalSeries(["Eikon Exe", " Eikon  Evo ", "Eikon Exe"]), ["Eikon Evo", "Eikon Exe"]);
  assert.deepEqual(LG.canonicalSeries(["Eikon Evo", "EIKON EVO"]), LG.canonicalSeries(["EIKON EVO", "Eikon Evo"]));
  assert.equal(LG.canonicalSeries(["Eikon Evo", "EIKON EVO"]).length, 2,
    "разные написания — разные серии набора, а не одна из двух на выбор входа");
  /* Кодами, а не буквами: в исходнике теста обе строки выглядели бы совершенно одинаково. */
  const NFC = "Eikon " + String.fromCharCode(0x00C9) + "vo";              /* «É» одним символом */
  const NFD = "Eikon E" + String.fromCharCode(0x0301) + "vo";                /* «E» + комбинирующий акут */
  assert.notEqual(NFC, NFD);
  assert.equal(NFC.localeCompare(NFD, "ru-RU"), 0, "коллация их не различает — порядок задаёт добор по кодам");
  assert.deepEqual(LG.canonicalSeries([NFC, NFD]), LG.canonicalSeries([NFD, NFC]));
  /* Пустая строка серией не бывает: пусти её в набор — и «серия неизвестна» перестало бы быть
     пустотой. Место с одними пустышками получило бы вместо честного NO_SERIES вопрос к каталогу
     о серии «» (пробел NOT_IN_SERIES — чинить пользователь пошёл бы не то), а в ключе сортировки
     непустую подпись, из-за которой оно перестало бы уходить в конец цепи и отняло бы у соседа
     переключатель. */
  assert.deepEqual(LG.canonicalSeries(["", "   ", "Eikon Evo", null, undefined]), ["Eikon Evo"]);
  assert.deepEqual(LG.canonicalSeries(["", "  "]), []);
  const blind = plan({ scheme: "classic", places: [{ postId: "p1", postNumber: 1, keyIndex: 0,
    series: ["", "   "], group: "Кухня" }] }, deps);
  assert.equal(blind.places[0].missingReason, GAPS.NO_SERIES);
  assert.equal(blind.places[0].series, undefined, "пустышки в серии места не выдаются за серию");
});

/* ─────────────────── пустая группа ─────────────────── */

test("клавиша без группы: подстановки НЕТ, честный пробел с причиной", () => {
  const res = plan({ scheme: "classic", places: [place(1, ""), place(2, "Кухня")] }, deps);
  assert.equal(res.places[0].code, null);
  assert.equal(res.places[0].product, null);
  assert.equal(res.places[0].role, null);
  assert.equal(res.places[0].missing, true);
  assert.equal(res.places[0].missingReason, GAPS.NO_GROUP);
  assert.equal(res.unassigned.placeCount, 1);
  assert.deepEqual(res.unassigned.places, [0]);
  /* Соседняя клавиша с группой при этом считается как обычно. */
  assert.equal(res.places[1].code, "20001.0");
  assert.ok(res.gaps.some(g => g.kind === GAPS.NO_GROUP && g.places.includes(0)));
});

test("клавиши без группы НЕ считаются местами управления чужой группы", () => {
  /* Иначе две пустые клавиши схлопнулись бы в «группу из двух мест» и дали переключатели. */
  const res = plan({ scheme: "classic", places: [place(1, ""), place(2, ""), place(3, "Кухня")] }, deps);
  assert.deepEqual(codes(res), [null, null, "20001.0"]);
  assert.equal(res.groups.length, 1);
  assert.equal(res.missingTotal, 2);
});

test("пробелы без группы схлопываются в ОДНУ запись, а не по записи на клавишу", () => {
  /* У пробела без группы поле groupKey не задано, а в сохранённой записи оно null: пока их
     сравнивали как есть, совпадение не срабатывало никогда и интерфейс получал по строке
     «не указана группа света» на каждую клавишу. */
  const res = plan({ scheme: "classic", places: [place(1, ""), place(2, ""), place(3, ""), place(4, "Кухня")] }, deps);
  const noGroup = res.gaps.filter(g => g.kind === GAPS.NO_GROUP);
  assert.equal(noGroup.length, 1);
  assert.deepEqual(noGroup[0].places, [0, 1, 2]);
  assert.equal(noGroup[0].groupKey, null);
  assert.ok(noGroup[0].text.length > 0);
});

test("пробелы каталога схлопываются по группам: две группы — две записи, а не четыре", () => {
  const res = plan({ scheme: "classic", places: [
    place(1, "Холл", NEVE), place(2, "Холл", NEVE), place(3, "Холл", NEVE), place(4, "Холл", NEVE),
    place(5, "Лестница", NEVE), place(6, "Лестница", NEVE), place(7, "Лестница", NEVE)
  ] }, deps);
  const notInSeries = res.gaps.filter(g => g.kind === GAPS.NOT_IN_SERIES);
  assert.deepEqual(notInSeries.map(g => g.groupLabel), ["Холл", "Лестница"]);
  assert.deepEqual(notInSeries.map(g => g.places.length), [2, 1]);
});

/* ─────────────────── дубль места ─────────────────── */

test("дубль места: N не растёт, механизм не подменяется, повтор — честный пробел", () => {
  /* Одна и та же клавиша, поданная дважды, раньше молча превращала выключатель в два
     переключателя и дорожала смету на несуществующее место. */
  const one = plan({ scheme: "classic", places: [place(1, "Кухня")] }, deps);
  const dup = plan({ scheme: "classic", places: [place(1, "Кухня"), place(1, "Кухня")] }, deps);
  assert.deepEqual(codes(dup), ["20001.0", null]);
  assert.equal(dup.places[1].missingReason, GAPS.DUPLICATE_PLACE);
  assert.equal(dup.groups[0].placeCount, 1);
  assert.deepEqual(dup.totals, one.totals);
  assert.equal(sum(dup), sum(one));
  assert.deepEqual(dup.duplicates, [1]);
  assert.ok(dup.gaps.some(g => g.kind === GAPS.DUPLICATE_PLACE && g.places.includes(1)));
});

test("дубль опознаётся по посту И клавише: соседняя клавиша того же поста дублем не считается", () => {
  const res = plan({ scheme: "classic", places: [place(1, "Холл", EIKON, 0), place(1, "Холл", EIKON, 1)] }, deps);
  assert.deepEqual(res.duplicates, []);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);   /* два места одной группы */
});

test("места без адреса клавиши дублями НЕ объявляются: различить их нечем", () => {
  /* Ложный дубль страшнее пропущенного: выкинутое настоящее место — это молча заниженная смета. */
  const bare = { postId: "p1", postNumber: 1, series: EIKON, group: "Кухня" };
  const res = plan({ scheme: "classic", places: [bare, Object.assign({}, bare)] }, deps);
  assert.deepEqual(res.duplicates, []);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
});

test("две ОДИНАКОВЫЕ клавиши 20021 в одном посту — два места, а не место и «дубль»", () => {
  /* Самый обычный двухклавишный пост: обе клавиши — товар 20021, id ТОВАРА у них один и тот же.
     Пока идентичность места при отсутствии keyIndex бралась от товара, второе место объявлялось
     дублем и выбрасывалось: группа «Холл» теряла своё единственное место целиком, у «Кухни» N
     падал вдвое, механизм и цена менялись. Товар говорит «что стоит», а не «где стоит». */
  const key20021 = { id: 201457, code: "20021", name: "Клавиша на 1 модуль", series: EIKON };
  const left = { postId: "p1", postNumber: 1, key: key20021, group: "Кухня" };
  const right = { postId: "p1", postNumber: 1, key: key20021, group: "Холл" };
  assert.equal(LG.identityOf(left), null);   /* позиции нет — опознавать нечем, и мы не выдумываем */

  const res = plan({ scheme: "classic", places: [left, right] }, deps);
  assert.deepEqual(res.duplicates, []);
  assert.deepEqual(res.groups.map(g => [g.label, g.placeCount]), [["Кухня", 1], ["Холл", 1]]);
  assert.deepEqual(codes(res), ["20001.0", "20001.0"]);   /* по выключателю на каждую группу */
  assert.equal(res.missingTotal, 0);
  /* Порядок входа на реестр не влияет — группа стоит в ключе сортировки. */
  const flipped = plan({ scheme: "classic", places: [right, left] }, deps);
  assert.deepEqual(flipped.groups.map(g => [g.label, g.placeCount]), [["Кухня", 1], ["Холл", 1]]);

  /* Та же пара клавиш в ОДНОЙ группе: два места, значит два переключателя, а не один выключатель. */
  const same = plan({ scheme: "classic", places: [
    { postId: "p1", postNumber: 1, key: key20021, group: "Холл" },
    { postId: "p1", postNumber: 1, key: key20021, group: "Холл" }
  ] }, deps);
  assert.equal(same.groups[0].placeCount, 2);
  assert.deepEqual(codes(same), ["20005.0", "20005.0"]);
  assert.equal(sum(same), 51.58);
});

test("позиция клавиши задана — дубль по-прежнему ловится, товар при этом ни при чём", () => {
  /* Обратная половина того же правила: идентичность — это АДРЕС (пост + позиция), поэтому одна и
     та же позиция, поданная дважды, остаётся дублем даже с разными товарами на ней. */
  const keyA = { id: 201457, series: EIKON }, keyB = { id: 201499, series: EIKON };
  assert.equal(LG.identityOf({ postId: "p1", keyIndex: 1, key: keyA }), "p:p1|i:1");
  assert.equal(LG.identityOf({ postId: "p1", keyIndex: 1, key: keyB }),
    LG.identityOf({ postId: "p1", keyIndex: 1, key: keyA }));
  const res = plan({ scheme: "classic", places: [
    { postId: "p1", postNumber: 1, keyIndex: 1, key: keyA, group: "Кухня" },
    { postId: "p1", postNumber: 1, keyIndex: 1, key: keyB, group: "Кухня" }
  ] }, deps);
  assert.deepEqual(res.duplicates, [1]);
  assert.deepEqual(codes(res), ["20001.0", null]);
  assert.equal(res.places[1].missingReason, GAPS.DUPLICATE_PLACE);
});

test("дубль ловится и по НОМЕРУ поста, когда id поста приложение не передало", () => {
  /* Адрес поста — это id ИЛИ номер: проект, собранный без id, тоже обязан ловить повтор. */
  const byNumber = () => ({ postNumber: 3, keyIndex: 0, series: EIKON, group: "Кухня" });
  assert.equal(LG.identityOf(byNumber()), "n:3|i:0");
  const res = plan({ scheme: "classic", places: [byNumber(), byNumber()] }, deps);
  assert.deepEqual(res.duplicates, [1]);
  assert.deepEqual(codes(res), ["20001.0", null]);   /* выключатель, а не два переключателя */
});

test("пустой id поста — это НЕ адрес: два таких места не считаются одним и тем же", () => {
  /* postId «» у двух разных постов сделал бы их одним постом, и второе место ушло бы в дубли —
     тот же ложный дубль, только через пустую строку. */
  const bare = () => ({ postId: "", keyIndex: 0, series: EIKON, group: "Холл" });
  const res = plan({ scheme: "classic", places: [bare(), bare()] }, deps);
  assert.deepEqual(res.duplicates, []);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
});

/* ─────────────────── схема с реле ─────────────────── */

test("реле: на каждом месте кнопка ХХ008.0, на группу — одно реле", () => {
  const res = plan({ scheme: "relay", places: [place(1, "Холл"), place(2, "Холл"), place(3, "Кухня")] }, deps);
  assert.deepEqual(codes(res), ["20008.0", "20008.0", "20008.0"]);
  assert.deepEqual(roles(res), [ROLES.BUTTON, ROLES.BUTTON, ROLES.BUTTON]);
  assert.deepEqual(res.relays.map(r => [r.groupLabel, r.buttonCount, r.count]), [["Холл", 2, 1], ["Кухня", 1, 1]]);
  assert.equal(res.relayTotal, 2);
});

test("реле: артикул НЕ подставляется — количество есть, article = null", () => {
  const res = plan({ scheme: "relay", places: [place(1, "Кухня")] }, deps);
  assert.equal(res.relays[0].article, null);
  assert.equal(res.relays[0].articleKnown, false);
  assert.ok(res.gaps.some(g => g.kind === GAPS.RELAY_ARTICLE));
});

test("реле: до 4 кнопок на реле — 4 места это одно реле, 5 мест уже два", () => {
  assert.equal(relayCount(1), 1);
  assert.equal(relayCount(4), 1);
  assert.equal(relayCount(5), 2);
  assert.equal(relayCount(9), 3);
  assert.equal(relayCount(0), 0);
  const five = plan({ scheme: "relay", places: [1, 2, 3, 4, 5].map(n => place(n, "Холл")) }, deps);
  assert.equal(five.relays[0].buttonCount, 5);
  assert.equal(five.relays[0].count, 2);
  /* Кнопка всё равно на КАЖДОМ месте — число мест на механизм не влияет. */
  assert.deepEqual(codes(five), ["20008.0", "20008.0", "20008.0", "20008.0", "20008.0"]);
  assert.deepEqual(five.totals, { switch: 0, changeover: 0, inverter: 0, button: 5 });
});

test("реле считается от ЧИСЛА МЕСТ, а не от числа подобранных кнопок", () => {
  /* Правило модуля: реле нужно ПРОВОДКЕ. Место управления в группе есть — значит кнопку на нём
     смонтируют, даже если конкретно эту кнопку конфигуратор подобрать не смог (серия клавиши
     каталогу неизвестна). Считай мы реле по ПОДОБРАННЫМ кнопкам, каждый пробел подбора молча
     ЗАНИЖАЛ бы смету: пять мест — это два реле, а четыре подобранные кнопки — одно.
     Пробел сделан на переходе через MAX_BUTTONS_PER_RELAY намеренно: тогда подмена видна не в
     кнопках (там она очевидна), а именно в ЧИСЛЕ РЕЛЕ. */
  const at = (n, series) =>
    ({ postId: "p" + n, postNumber: n, keyIndex: 0, keyId: 900 + n, series, group: "Холл" });
  const PLANA = ["Plana"];   /* серия существует, но голых механизмов Plana в фикстуре каталога нет */
  const res = plan({ scheme: "relay",
    places: [at(1, EIKON), at(2, EIKON), at(3, EIKON), at(4, EIKON), at(5, PLANA)] }, deps);
  assert.equal(res.places[4].role, ROLES.BUTTON, "роль у места есть — не подобрано только изделие");
  assert.equal(res.places[4].code, null);
  assert.equal(res.places[4].missingReason, GAPS.NOT_IN_SERIES);
  assert.equal(res.totalsRequired.button, 5, "схема требует пять кнопок…");
  assert.equal(res.totals.button, 4, "…а подобрать удалось четыре");
  assert.equal(res.groups[0].placeCount, 5);
  assert.equal(res.relays[0].buttonCount, 5, "в реле идёт число МЕСТ, а не число подобранного");
  assert.equal(res.relays[0].count, 2, "от подобранных кнопок вышло бы одно реле — заниженная смета");
  assert.equal(res.relayTotal, 2);
});

test("реле: клавиша без группы не даёт ни кнопки, ни реле", () => {
  const res = plan({ scheme: "relay", places: [place(1, ""), place(2, "Кухня")] }, deps);
  assert.deepEqual(codes(res), [null, "20008.0"]);
  assert.equal(res.relayTotal, 1);
  assert.equal(res.places[0].missingReason, GAPS.NO_GROUP);
});

test("реле: раскладка и счёт реле тоже не зависят от порядка входа", () => {
  const base = plan({ scheme: "relay", places: MIXED }, deps);
  Object.entries(PERMUTATIONS).forEach(([name, permute]) => {
    assert.deepEqual(fingerprint(plan({ scheme: "relay", places: permute(MIXED) }, deps)),
      fingerprint(base), "перестановка: " + name);
  });
});

/* ─────────────────── звонковые кнопки и битая схема ─────────────────── */

test("звонковые кнопки: расчёта нет, правила не выдуманы", () => {
  const res = plan({ scheme: "bell", places: [place(1, "Кухня"), place(2, "Кухня")] }, deps);
  assert.equal(res.supported, false);
  assert.equal(res.schemeLabel, "Звонковые кнопки");
  assert.deepEqual(codes(res), [null, null]);
  assert.deepEqual(roles(res), [null, null]);
  assert.equal(res.places[0].missingReason, GAPS.SCHEME_NOT_READY);
  assert.equal(res.relayTotal, 0);
  assert.ok(res.gaps.some(g => g.kind === GAPS.SCHEME_NOT_READY));
  /* Реестр групп при этом собирается — интерфейсу есть что показать. */
  assert.equal(res.groups[0].placeCount, 2);
});

test("нераспознанная схема ведёт себя как неописанная, но текст пробела — СВОЙ, не про звонки", () => {
  /* Один текст на оба случая врал бы пользователю: «схема не описана заказчиком, вопрос отправлен»
     там, где на самом деле в проект попал битый идентификатор схемы. */
  const res = plan({ scheme: "чего-то новое", places: [place(1, "Кухня")] }, deps);
  assert.equal(res.supported, false);
  assert.equal(res.places[0].code, null);
  assert.equal(res.places[0].missingReason, GAPS.SCHEME_UNKNOWN);
  const gap = res.gaps.find(g => g.kind === GAPS.SCHEME_UNKNOWN);
  assert.ok(gap && gap.text.length > 0);
  assert.ok(!/звонков/i.test(gap.text), "текст пробела не должен быть про звонковые кнопки");
  assert.ok(!res.gaps.some(g => g.kind === GAPS.SCHEME_NOT_READY));
  const bell = plan({ scheme: "bell", places: [place(1, "Кухня")] }, deps);
  assert.match(bell.gaps.find(g => g.kind === GAPS.SCHEME_NOT_READY).text, /Звонковые кнопки/);
});

test("пробел схемы — один на проект, а не по одному на клавишу", () => {
  const res = plan({ scheme: "bell", places: [place(1, "Кухня"), place(2, "Холл"), place(3, "")] }, deps);
  const scheme = res.gaps.filter(g => g.kind === GAPS.SCHEME_NOT_READY);
  assert.equal(scheme.length, 1);
  assert.deepEqual(scheme[0].places, [0, 1, 2]);
});

/* ─────────────────── пробелы каталога ─────────────────── */

test("нет механизма роли в серии клавиши — честный null, а не механизм чужой серии", () => {
  /* Neve Up: среди голых механизмов инвертора нет (09013 — готовое изделие с клавишей,
     не механизм под отдельную клавишу), значит N≥3 на этой серии не считается. */
  const res = plan({ scheme: "classic", places: [1, 2, 3].map(n => place(n, "Холл", NEVE)) }, deps);
  assert.deepEqual(codes(res), ["09005.0.250", "09005.0.250", null]);
  assert.equal(res.places[2].role, ROLES.INVERTER);       /* роль известна… */
  assert.equal(res.places[2].product, null);              /* …а изделия нет */
  assert.equal(res.places[2].missingReason, GAPS.NOT_IN_SERIES);
  assert.equal(res.missingTotal, 1);
  assert.equal(res.groups[0].missing, 1);
  assert.ok(res.gaps.some(g => g.kind === GAPS.NOT_IN_SERIES && g.groupLabel === "Холл"));
});

test("итоги: «нужно по схеме» и «фактически подобрано» считаются РАЗДЕЛЬНО", () => {
  /* Иначе смета получала бы строку «Инвертор ×1» без единого артикула за ней. */
  const res = plan({ scheme: "classic", places: [1, 2, 3].map(n => place(n, "Холл", NEVE)) }, deps);
  assert.deepEqual(res.totalsRequired, { switch: 0, changeover: 2, inverter: 1, button: 0 });
  assert.deepEqual(res.totals, { switch: 0, changeover: 2, inverter: 0, button: 0 });
  assert.deepEqual(res.groups[0].rolesRequired, { switch: 0, changeover: 2, inverter: 1, button: 0 });
  assert.deepEqual(res.groups[0].roles, { switch: 0, changeover: 2, inverter: 0, button: 0 });
  /* Сумма механизмов — только по подобранным, без фантомных позиций. */
  assert.equal(sum(res), 17.72);
});

test("нет механизма в серии — соседняя группа другой серии считается как обычно", () => {
  const res = plan({ scheme: "classic", places: [
    place(1, "Холл", NEVE), place(2, "Холл", NEVE), place(3, "Холл", NEVE), place(4, "Кухня", EIKON)
  ] }, deps);
  assert.equal(res.places[3].code, "20001.0");
  assert.equal(res.places[3].missing, false);
});

test("у клавиши не определена серия — искать не в чем, пробел с отдельной причиной", () => {
  const res = plan({ scheme: "classic", places: [{ postId: "p1", postNumber: 1, group: "Кухня" }] }, deps);
  assert.equal(res.places[0].code, null);
  assert.equal(res.places[0].missingReason, GAPS.NO_SERIES);
});

test("серия берётся у товара-клавиши, если явным полем не задана", () => {
  const key = { id: 201457, code: "20021", name: "Клавиша на 1 модуль серая", series: ["Eikon Evo", "Eikon Exe"] };
  const res = plan({ scheme: "classic", places: [{ postId: "p1", postNumber: 1, key, group: "Кухня" }] }, deps);
  assert.equal(res.places[0].code, "20001.0");
  assert.equal(res.places[0].keyId, 201457);
});

test("без deps.findMechanism механизм не подставляется, а помечается пробелом поиска", () => {
  const res = plan({ scheme: "classic", places: [place(1, "Кухня")] }, {});
  assert.equal(res.places[0].code, null);
  assert.equal(res.places[0].missingReason, GAPS.NO_LOOKUP);
  assert.equal(res.places[0].role, ROLES.SWITCH);
});

test("сбой поиска по каталогу становится ПРОБЕЛОМ, а не падением расчёта", () => {
  /* Модуль весь про «честный пробел вместо неверного числа» — исключение из каталога наружу
     обрушило бы пересчёт всего проекта, включая места, к каталогу не обращавшиеся. */
  let calls = 0;
  const boom = { findMechanism: () => { calls++; throw new Error("каталог не загружен"); } };
  let res;
  assert.doesNotThrow(() => { res = plan({ scheme: "classic", places: [place(1, "Холл"), place(2, "Холл")] }, boom); });
  assert.deepEqual(codes(res), [null, null]);
  assert.equal(res.places[0].missingReason, GAPS.LOOKUP_FAILED);
  assert.equal(res.missingTotal, 2);
  assert.equal(calls, 1, "упавший поиск не повторяется на каждом месте");
  assert.deepEqual(res.totalsRequired, { switch: 0, changeover: 2, inverter: 0, button: 0 });
  assert.deepEqual(res.totals, { switch: 0, changeover: 0, inverter: 0, button: 0 });
  assert.ok(res.gaps.some(g => g.kind === GAPS.LOOKUP_FAILED));
});

/* ─────────────────── артикул подобранного изделия ─────────────────── */

test("изделие БЕЗ АРТИКУЛА — не подобранное изделие: пробел, а не строка сметы с ценой", () => {
  /* Раньше артикул читался как «code != null ? code : null», и место с таким изделием считалось
     успешным: missing=false, code=null. Ровно та «правдоподобно неверная строка», которую модуль
     запрещает себе везде, — позиция уезжает в смету С ЦЕНОЙ и БЕЗ АРТИКУЛА (ни заказать, ни
     сверить), а пробела не видит никто: ни missingTotal, ни список gaps, ни интерфейс. */
  const noCode = { findMechanism: () => ({ id: 42, price: 99.99, name: "механизм без артикула" }) };
  const res = plan({ scheme: "classic", places: [place(1, "Кухня")] }, noCode);
  const p = res.places[0];
  assert.equal(p.code, null);
  assert.equal(p.product, null, "цена без артикула в выдачу не идёт — «подобрано» считают по product");
  assert.equal(p.missing, true);
  assert.equal(p.missingReason, GAPS.NO_CODE);
  assert.equal(p.role, ROLES.SWITCH, "роль известна — не подобрано только изделие");
  assert.equal(res.missingTotal, 1);
  assert.equal(sum(res), 0, "99.99 € за позицию без артикула в смету не попадают");
  assert.deepEqual(res.totals, { switch: 0, changeover: 0, inverter: 0, button: 0 });
  assert.deepEqual(res.totalsRequired, { switch: 1, changeover: 0, inverter: 0, button: 0 });
  const gap = res.gaps.find(g => g.kind === GAPS.NO_CODE);
  assert.ok(gap && gap.text.length > 0, "у пробела есть машиночитаемая причина и текст");
  assert.equal(gap.groupKey, "кухня");
  assert.notEqual(GAPS.NO_CODE, GAPS.NOT_IN_SERIES, "«нашли без артикула» и «не нашли» — разные причины");
});

test("артикул читается как всякий идентификатор: пробелы приводятся, пустое — «артикула нет»", () => {
  const found = code => ({ findMechanism: () => ({ id: 42, price: 20.26, code }) });
  const one = code => plan({ scheme: "classic", places: [place(1, "Кухня")] }, found(code)).places[0];
  assert.equal(one(" 20001.0 ").code, "20001.0", "края обрезаются, как у номера поста и id клавиши");
  assert.equal(one("20 001.0").code, "20 001.0");
  assert.equal(one("20  001.0").code, "20 001.0", "внутренние пробелы схлопываются");
  assert.equal(one("20001.0").missing, false);
  assert.equal(one(20001).code, 20001, "числовой артикул остаётся числом — тип не теряем");
  [null, undefined, "", "   ", {}, [], true, NaN].forEach(code =>
    assert.equal(one(code).missingReason, GAPS.NO_CODE, "не артикул: " + JSON.stringify(code)));
});

/* ─────────────────── устойчивость ─────────────────── */

test("пустой проект: ничего не падает, всё нулевое", () => {
  const res = plan({ scheme: "classic", places: [] }, deps);
  assert.deepEqual(res.places, []);
  assert.deepEqual(res.groups, []);
  assert.equal(res.missingTotal, 0);
  assert.equal(res.relayTotal, 0);
  assert.deepEqual(res.totals, { switch: 0, changeover: 0, inverter: 0, button: 0 });
  assert.deepEqual(res.totalsRequired, { switch: 0, changeover: 0, inverter: 0, button: 0 });
  assert.deepEqual(res.gaps, []);
});

test("РАЗРЕЖЕННЫЙ массив мест: дыра не теряется молча и не остаётся дырой в выдаче", () => {
  /* Такой массив приложение отдаёт штатно: `delete places[i]` после удаления клавиши (индексы
     остальных мест при этом сохраняются). list.map/forEach в дыры не заходят, поэтому место с
     таким индексом не попадало НИ В ПОРЯДОК, НИ В ГРУППУ, НИ В ПРОБЕЛЫ, а выдача возвращалась
     С ДЫРКАМИ: order = [0, 2, <дыра>] и places[1] === undefined. Потребитель либо терял место
     так же молча (его собственный map/forEach дыру тоже пропустит), либо падал на places[1].code.
     Дыра — это место без данных, а значит и без группы: честный пробел, а не пропажа. */
  const list = [place(1, "Кухня"), place(2, "Кухня"), place(3, "Кухня")];
  delete list[1];
  assert.equal(list.length, 3);
  assert.equal(Object.keys(list).length, 2, "массив действительно разреженный");

  assert.deepEqual(LG.canonicalOrder(list).slice().sort((a, b) => a - b), [0, 1, 2],
    "в каноническом порядке есть КАЖДЫЙ индекс входа");
  const res = plan({ scheme: "classic", places: list }, deps);
  assert.equal(res.places.length, 3);
  assert.equal(Object.keys(res.places).length, 3, "дыр в выдаче нет");
  assert.ok(res.places[1], "место-дыра в выдаче ЕСТЬ");
  assert.equal(res.places[1].index, 1);
  assert.equal(res.places[1].missingReason, GAPS.NO_GROUP);
  assert.deepEqual(res.unassigned, { placeCount: 1, places: [1] });
  assert.ok(res.gaps.some(g => g.kind === GAPS.NO_GROUP && g.places.includes(1)));
  /* Настоящие места считаются как обычно: два места «Кухни» — два переключателя. */
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].placeCount, 2);
  assert.deepEqual(codes(res), ["20005.0", null, "20005.0"]);
});

test("каталог спрашивается один раз на пару «роль + серия» — подстановка одинакова во всех постах", () => {
  let calls = 0;
  const counting = { findMechanism: args => { calls++; return findMechanism(args); } };
  const res = plan({ scheme: "classic", places: [1, 2, 3, 4].map(n => place(n, "Холл")) }, counting);
  assert.deepEqual(codes(res), ["20005.0", "20005.0", "20013.0", "20013.0"]);
  assert.equal(calls, 2);   /* переключатель и инвертор — по одному запросу на роль */
});

test("контракт findMechanism узкий: спрашиваем ровно роль и серию", () => {
  /* Ключ кэша — эта же пара. Если бы в аргументах ехали место и группа, реализация могла бы на
     них опереться, а кэш молча отдал бы всем ответ, посчитанный для первого спросившего. */
  const seen = [];
  const spy = { findMechanism: args => { seen.push(Object.keys(args).sort()); return findMechanism(args); } };
  plan({ scheme: "classic", places: [place(1, "Кухня"), place(2, "Холл", ARKE)] }, spy);
  assert.ok(seen.length >= 2);
  seen.forEach(keys => assert.deepEqual(keys, ["role", "series"]));
});

test("схема по умолчанию — классическая: старый проект без поля считается как раньше", () => {
  const res = plan({ places: [place(1, "Кухня")] }, deps);
  assert.equal(res.scheme, "classic");
  assert.equal(res.places[0].code, "20001.0");
});

/* ─────────────────── чтение полей места: одна форма на весь модуль ─────────────────── */

/* Место с БУКВЕННЫМ номером поста и без внутреннего id — это данные заказчика, а не выдумка:
   в его расчётах посты-выключатели пронумерованы «В15», «В17» … «В24» (эталон «Расчёт розеток»). */
const letterPost = (postNumber, group, series = EIKON, keyIndex = 0) =>
  ({ postNumber, keyIndex, series, group });

test("буквенный номер поста сортируется осмысленно и не теряется", () => {
  /* Пока номер поста читался разобранным ЧИСЛОМ (Number("В15") = NaN), он молча выпадал из ключа
     сортировки, а место оставалось в выдаче: роли раздавались по порядку ВХОДА, и инвертор за
     42.33 € доставался от вызова к вызову РАЗНЫМ физическим постам. */
  assert.equal(LG.postNumberOf({ postNumber: "В15" }), "В15");
  const hall = ["В24", "В15", "В17"].map(n => letterPost(n, "Холл"));
  assert.deepEqual(LG.canonicalOrder(hall).map(i => hall[i].postNumber), ["В15", "В17", "В24"]);
  /* Цифры внутри строки разбираются: «В2» раньше «В10», как читает человек по плану. */
  const decade = ["В10", "В2", "В9"].map(n => letterPost(n, "Холл"));
  assert.deepEqual(LG.canonicalOrder(decade).map(i => decade[i].postNumber), ["В2", "В9", "В10"]);
  [hall, hall.slice().reverse(), [hall[1], hall[2], hall[0]]].forEach(places => {
    const res = plan({ scheme: "classic", places }, deps);
    assert.equal(res.places.length, 3);
    assert.equal(res.groups[0].placeCount, 3, "ни одно место не потеряно");
    const roleAt = n => res.places.find(p => p.postNumber === n).role;
    assert.equal(roleAt("В15"), ROLES.CHANGEOVER);
    assert.equal(roleAt("В17"), ROLES.CHANGEOVER);
    assert.equal(roleAt("В24"), ROLES.INVERTER);   /* инвертор всегда на одном и том же посту */
    assert.equal(sum(res), 93.91);
  });
});

test("номера постов: числовые раньше буквенных, порядок не зависит от входа", () => {
  const mixed = [letterPost("В15", "Холл"), letterPost(2, "Холл"), letterPost(1, "Холл")];
  assert.deepEqual(LG.canonicalOrder(mixed).map(i => mixed[i].postNumber), [1, 2, "В15"]);
  [mixed, mixed.slice().reverse(), [mixed[1], mixed[2], mixed[0]]].forEach(places => {
    const res = plan({ scheme: "classic", places }, deps);
    assert.equal(res.places.find(p => p.postNumber === "В15").role, ROLES.INVERTER);
    assert.equal(res.places.find(p => p.postNumber === 1).placeNo, 1);
  });
});

test("проект с буквенной нумерацией постов считается одинаково при любом порядке входа", () => {
  /* Тот самый проект заказчика: буквенные номера, внутренних id нет. Слепок берём по адресу
     места, а не по позиции во входном списке, — иначе тест проверял бы сам порядок вызова. */
  const LETTERS = [
    letterPost("В15", "Холл"), letterPost("В17", "Холл"), letterPost("В24", "Холл"),
    letterPost("В16", "Коридор", ARKE), letterPost("В18", "Коридор", EIKON),
    letterPost("В2", "Кухня"), letterPost("В10", "Кухня"), letterPost("В9", "Спальня")
  ];
  const snapshot = res => ({
    sum: sum(res), totals: res.totals, missingTotal: res.missingTotal,
    groups: res.groups.map(g => [g.key, g.placeCount, g.posts.map(p => p.number)]),
    places: res.places.map(p => [String(p.postNumber), p.groupKey, p.placeNo, p.role, p.code])
      .sort((a, b) => a[0].localeCompare(b[0], "ru-RU"))
  });
  const base = plan({ scheme: "classic", places: LETTERS }, deps);
  assert.equal(base.missingTotal, 0);
  /* «В2» — первое место «Кухни», «В10» — второе: цифры в номере разбираются, а не сравниваются
     посимвольно (иначе «В10» встал бы раньше «В2», и роли разъехались бы по другим постам). */
  assert.equal(base.places.find(p => p.postNumber === "В2").placeNo, 1);
  assert.equal(base.places.find(p => p.postNumber === "В10").placeNo, 2);
  Object.entries(PERMUTATIONS).forEach(([name, permute]) => {
    assert.deepEqual(snapshot(plan({ scheme: "classic", places: permute(LETTERS) }, deps)),
      snapshot(base), "перестановка: " + name);
  });
});

test("«1» и « 1» — ОДИН пост везде: в опознании дубля, в порядке и в реестре", () => {
  /* Опознание читало номер поста сырым, а сортировка — разобранным: одно и то же место, поданное
     дважды с лишним пробелом, проходило в расчёт как два. N=2 вместо 1 — и вместо выключателя
     (20.26 €) проект получал два переключателя (51.58 €) и другой монтаж. */
  assert.equal(LG.identityOf({ postNumber: " 1", keyIndex: 0 }), LG.identityOf({ postNumber: "1", keyIndex: 0 }));
  assert.equal(LG.identityOf({ postId: " p1 ", keyIndex: 0 }), LG.identityOf({ postId: "p1", keyIndex: 0 }));
  /* Позиция клавиши — тоже одна форма: «0» и 0 это первая клавиша, а не две разные. */
  assert.equal(LG.identityOf({ postNumber: 1, keyIndex: "0" }), LG.identityOf({ postNumber: 1, keyIndex: 0 }));
  const res = plan({ scheme: "classic", places: [
    { postNumber: "1", keyIndex: 0, series: EIKON, group: "Кухня" },
    { postNumber: " 1", keyIndex: "0", series: EIKON, group: "Кухня" }
  ] }, deps);
  assert.deepEqual(res.duplicates, [1]);
  assert.deepEqual(codes(res), ["20001.0", null]);
  assert.equal(res.places[1].missingReason, GAPS.DUPLICATE_PLACE);
  assert.equal(res.groups[0].placeCount, 1);
  assert.deepEqual(res.groups[0].posts, [{ id: null, number: "1", placeCount: 1 }]);
  assert.equal(sum(res), 20.26);
});

test("адрес поста: id СИЛЬНЕЕ номера — правило «id, если задан, иначе номер», а не наоборот", () => {
  /* Порядок этих двух полей — не вкусовщина. Номер поста человек правит на плане («В15» стало
     «В16»), а id — это тождество поста внутри проекта. Возьми модуль номер первым — и одна и та
     же клавиша одного и того же поста, поданная с разными номерами (типичный недосохранённый
     план), стала бы ДВУМЯ местами: N=2 вместо 1, два переключателя (51.58 €) вместо выключателя
     (20.26 €) и другой монтаж. И обратная беда: два РАЗНЫХ поста, которым приложение временно
     проставило один номер, склеились бы в один. */
  const at = (postId, postNumber) => ({ postId, postNumber, keyIndex: 0, series: EIKON, group: "Холл" });
  assert.equal(LG.identityOf(at("p1", 1)), LG.identityOf(at("p1", 2)), "id задан — номер не спрашивают");
  assert.notEqual(LG.identityOf(at("p1", 7)), LG.identityOf(at("p2", 7)));

  const same = plan({ scheme: "classic", places: [at("p1", 1), at("p1", 2)] }, deps);
  assert.deepEqual(same.duplicates, [1], "тот же id — тот же пост, вторая подача клавиши это дубль");
  assert.equal(same.groups[0].placeCount, 1);
  assert.deepEqual(codes(same), ["20001.0", null]);
  assert.equal(same.places[1].missingReason, GAPS.DUPLICATE_PLACE);
  assert.equal(sum(same), 20.26);
  /* В реестре у поста остаются ОБА поля адреса, id ведущим: печатать лист монтажника надо по
     номеру с плана, а опознавать пост — по id. */
  assert.deepEqual(same.groups[0].posts, [{ id: "p1", number: 1, placeCount: 1 }]);

  const twins = plan({ scheme: "classic", places: [at("p1", 7), at("p2", 7)] }, deps);
  assert.deepEqual(twins.duplicates, [], "разные id при одном номере — ДВА поста, а не дубль");
  assert.equal(twins.groups[0].placeCount, 2);
  assert.deepEqual(codes(twins), ["20005.0", "20005.0"]);
  assert.deepEqual(twins.groups[0].posts,
    [{ id: "p1", number: 7, placeCount: 1 }, { id: "p2", number: 7, placeCount: 1 }]);
});

test("внутренние пробелы в адресе схлопываются: «пост  7» и «пост 7» — один и тот же пост", () => {
  /* Края адрес приводил всегда, а внутренние пробелы — нет, и «B 15» с «B  15» (лишний пробел из
     копипасты или чужой выгрузки) были для модуля ДВУМЯ постами: повтор одной клавиши проходил в
     расчёт, N рос, выключатель превращался в два переключателя. Правило одно на все адресные
     поля — то же самое, что и у имени группы. */
  assert.equal(LG.postIdOf({ postId: "p  1" }), "p 1");
  assert.equal(LG.postNumberOf({ postNumber: "пост  7" }), "пост 7");
  assert.equal(LG.keyIdOf({ keyId: " 20  021 " }), "20 021");
  const at = postId => ({ postId, keyIndex: 0, series: EIKON, group: "Холл" });
  const res = plan({ scheme: "classic", places: [at("p 1"), at("p  1")] }, deps);
  assert.deepEqual(res.duplicates, [1]);
  assert.equal(res.groups[0].placeCount, 1);
  assert.equal(sum(res), 20.26, "один пост, одна клавиша — выключатель, а не два переключателя");
});

test("место без адреса поста НЕ заводит в группе пост-призрак", () => {
  /* Записи постов нужны листу монтажника и взрыв-схеме: «в каком посту какой механизм». Пост без
     адреса — это не пост, а неизвестность, и запись { id: null, number: null } собрала бы в себя
     все безадресные места группы, показав монтажнику пост, которого на плане нет. Само место при
     этом из расчёта не выпадает — оно законное, просто адрес его неизвестен. */
  const at = { postId: "p1", postNumber: 1, keyIndex: 0, series: EIKON, group: "Холл" };
  const noPost = { keyIndex: 0, series: EIKON, group: "Холл" };
  const res = plan({ scheme: "classic", places: [at, noPost, noPost] }, deps);
  assert.equal(res.groups[0].placeCount, 3, "безадресные места остаются местами управления");
  assert.deepEqual(res.groups[0].posts, [{ id: "p1", number: 1, placeCount: 1 }]);
});

test("пустой id поста не склеивает ДВА РАЗНЫХ поста в один", () => {
  /* Реестр проверял postId на «!= null», и пустая строка проходила: два поста с разными номерами
     становились ОДНИМ постом с двумя местами — ложный дубль, запрещённый модулем всюду. Лист
     монтажника после такого показал бы два механизма в одном посту. */
  const reg = buildRegistry([
    { postId: "", postNumber: 1, keyIndex: 0, series: EIKON, group: "Холл" },
    { postId: "   ", postNumber: 2, keyIndex: 0, series: EIKON, group: "Холл" }
  ]);
  assert.equal(reg.groups[0].placeCount, 2);
  assert.deepEqual(reg.groups[0].posts,
    [{ id: null, number: 1, placeCount: 1 }, { id: null, number: 2, placeCount: 1 }]);
  assert.deepEqual(reg.duplicates, []);
});

test("пост, переданный только номером, в реестре ЕСТЬ — адрес поста один на весь модуль", () => {
  /* Дубль опознавался по «id ИЛИ номер», а реестр требовал именно id: проект без внутренних id
     (а у заказчика посты именно такие) оставался с пустым списком постов, и лист монтажника не
     знал, в каком посту стоит механизм. */
  const reg = buildRegistry([
    letterPost("В15", "Холл"), letterPost("В15", "Холл", EIKON, 1), letterPost("В17", "Холл")
  ]);
  assert.deepEqual(reg.groups[0].posts,
    [{ id: null, number: "В15", placeCount: 2 }, { id: null, number: "В17", placeCount: 1 }]);
  /* Тот же адрес и та же клавиша, поданные дважды, по-прежнему ловятся как дубль. */
  assert.deepEqual(buildRegistry([letterPost("В15", "Холл"), letterPost("В15", "Холл")]).duplicates, [1]);
});

test("запись поста принадлежит СВОЕЙ группе: двухклавишный пост на две группы не двоится", () => {
  /* Обычный двухклавишный пост: одна клавиша «Кухня», вторая «Холл». Пост один и тот же, но у
     каждой группы он свой — со СВОИМ числом мест. Одна запись на две группы дала бы в листе
     монтажника «в посту 1 два места группы Кухня» там, где место одно, и столько же у «Холла». */
  const reg = buildRegistry([
    place(1, "Кухня", EIKON, 0), place(1, "Холл", EIKON, 1), place(2, "Холл", EIKON, 0)
  ]);
  assert.deepEqual(reg.byKey.get("кухня").posts, [{ id: "p1", number: 1, placeCount: 1 }]);
  assert.deepEqual(reg.byKey.get("холл").posts,
    [{ id: "p1", number: 1, placeCount: 1 }, { id: "p2", number: 2, placeCount: 1 }]);
  /* И в результате плана — то же самое: посты групп считаются раздельно. */
  const res = plan({ scheme: "classic", places: [
    place(1, "Кухня", EIKON, 0), place(1, "Холл", EIKON, 1), place(2, "Холл", EIKON, 0)
  ] }, deps);
  assert.deepEqual(res.groups.map(g => [g.label, g.posts.map(p => [p.id, p.placeCount])]),
    [["Кухня", [["p1", 1]]], ["Холл", [["p1", 1], ["p2", 1]]]]);
});

test("объект и массив в адресе места — это НЕ адрес: ложного дубля не будет", () => {
  /* String({}) = «[object Object]», Number([]) = 0: пока поля читались «как получится», два
     РАЗНЫХ места с битым адресом опознавались как одно, второе уходило в дубли — смета молча
     теряла место и механизм. Ложный дубль страшнее пропущенного. */
  assert.equal(LG.postIdOf({ postId: {} }), null);
  assert.equal(LG.postNumberOf({ postNumber: [] }), null);
  assert.equal(LG.postNumberOf({ postNumber: NaN }), null);
  assert.equal(LG.keyIndexOf({ keyIndex: [] }), null);
  assert.equal(LG.keyIndexOf({ keyIndex: true }), null);
  assert.equal(LG.keyIndexOf({ keyIndex: "первая" }), null);
  assert.equal(LG.keyIndexOf({ keyIndex: "2" }), 2);
  assert.equal(LG.identityOf({ postId: {}, keyIndex: 0 }), null);
  const res = plan({ scheme: "classic", places: [
    { postId: {}, keyIndex: [], series: EIKON, group: "Холл" },
    { postId: {}, keyIndex: [], series: EIKON, group: "Холл" }
  ] }, deps);
  assert.deepEqual(res.duplicates, []);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);   /* два места, а не место и «дубль» */
});

test("индекс клавиши читается ТОЛЬКО в десятичной записи: «0x10» — не позиция", () => {
  /* Модуль обещает: «не позиция» → null, место просто не опознаётся. Голый Number() обещания не
     выполнял и принимал записи, которых человек в поле «позиция клавиши» не пишет никогда:
     «0x10» → 16, «0b11» → 3, «1e1» → 10, «+3» → 3, «3.» → 3. Обещание тут важнее поведения,
     потому что keyIndex — ПОЛОВИНА ИДЕНТИЧНОСТИ места (identityOf): «0x10» молча становилось тем
     же местом, что и 16, второе объявлялось ДУБЛЕМ и выбрасывалось из расчёта — N группы падал с
     2 до 1, и два переключателя (25.79 €) превращались в один выключатель (20.26 €).
     Отказ читать экзотику при этом ничего не выбрасывает: место остаётся в расчёте, среди
     неопознанных мест просто не ищется дубль. */
  const idx = v => LG.keyIndexOf({ keyIndex: v });
  assert.equal(idx(0), 0);
  assert.equal(idx("0"), 0);
  assert.equal(idx("12"), 12);
  assert.equal(idx(" 2 "), 2);
  assert.equal(idx("01"), 1, "ведущий ноль у ПОЗИЦИИ — то же число (это не имя, а номер клавиши)");
  assert.equal(idx("-1"), -1);
  ["0x10", "0b11", "0o17", "1e1", "+3", "3.", ".5", "1 2", "первая", "", null, true, [], [1], {}]
    .forEach(v => assert.equal(idx(v), null, "не позиция: " + JSON.stringify(v)));
  /* Десятичная запись, которая не влезает в число: Number(«999…9») = Infinity. Бесконечность —
     не позиция клавиши, и пропусти её модуль внутрь, ЛЮБЫЕ два таких места одного поста стали бы
     одной и той же клавишей: второе — ложный дубль, выброшенный из расчёта вместе с деньгами. */
  const HUGE = "9".repeat(400);
  assert.equal(idx(HUGE), null, "Infinity — не позиция");
  const huge = () => ({ postId: "p1", postNumber: 1, keyIndex: HUGE, series: EIKON, group: "Холл" });
  const overflow = plan({ scheme: "classic", places: [huge(), huge()] }, deps);
  assert.deepEqual(overflow.duplicates, []);
  assert.equal(overflow.groups[0].placeCount, 2);
  assert.deepEqual(codes(overflow), ["20005.0", "20005.0"]);
  assert.deepEqual(overflow.places.map(p => p.keyIndex), [null, null], "позиция честно не определена");
  /* Место с непонятной позицией не опознаётся — и потому не может стать ложным дублем места 16. */
  const at = keyIndex => ({ postId: "p1", postNumber: 1, keyIndex, series: EIKON, group: "Холл" });
  assert.equal(LG.identityOf(at("0x10")), null);
  assert.equal(LG.identityOf(at(16)), LG.identityOf(at("16")), "«16» и 16 — одна клавиша");
  const res = plan({ scheme: "classic", places: [at(16), at("0x10")] }, deps);
  assert.deepEqual(res.duplicates, [], "ложного дубля нет — оба места в расчёте");
  assert.equal(res.groups[0].placeCount, 2);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);   /* два переключателя, а не один выключатель */
});

test("id клавиши: пустое явное поле — «не задано», тогда берём товар", () => {
  assert.equal(LG.keyIdOf({ keyId: "  ", key: { id: 7 } }), 7);
  assert.equal(LG.keyIdOf({ keyId: " k7 ", key: { id: 7 } }), "k7");
  assert.equal(LG.keyIdOf({ keyId: 0 }), 0);          /* 0 — законный id, а не «пусто» */
  assert.equal(LG.keyIdOf({ key: { id: {} } }), null);
  assert.equal(LG.keyIdOf({}), null);
});

test("выдача отдаёт поля места в той же форме, в какой модуль по ним считал", () => {
  /* Иначе вызывающий печатает одно, а расчёт вёлся по другому — и разойдутся они молча. */
  const res = plan({ scheme: "classic", places: [
    { postId: " p1 ", postNumber: " 7 ", keyIndex: "1", keyId: " 20021 ", series: EIKON, group: " Кухня " }
  ] }, deps);
  const p = res.places[0];
  assert.equal(p.postId, "p1");
  assert.equal(p.postNumber, "7");
  assert.equal(p.keyIndex, 1);
  assert.equal(p.keyId, "20021");
  assert.equal(p.groupLabel, "Кухня");
  assert.equal(p.code, "20001.0");
  assert.deepEqual(res.groups[0].posts, [{ id: "p1", number: "7", placeCount: 1 }]);
});

/* ─────────────────── кэш подбора механизма ─────────────────── */

test("ключ кэша НЕСКЛЕИВАЕМ: разные наборы серий — разные вопросы к каталогу", () => {
  /* Ключ склеивал серии через запятую, поэтому набор [«Eikon Evo,Eikon Exe»] (приложение отдало
     серии одной строкой, не разбив по запятой) и [«Eikon Evo», «Eikon Exe»] давали ОДИН ключ.
     Кто спросил первым, тот и определял ответ обоим: либо место с честной серией получало ложный
     пробел, либо место с непонятной серией получало ЧУЖОЙ механизм — прямое нарушение правила
     «чужую серию не подставляем», и что именно случится, решал порядок входа. */
  const asked = [];
  const spy = { findMechanism: args => { asked.push(args.series.slice()); return findMechanism(args); } };
  const glued = { postId: "p1", postNumber: 1, keyIndex: 0, series: ["Eikon Evo,Eikon Exe"], group: "Кухня" };
  const split = { postId: "p2", postNumber: 2, keyIndex: 0, series: ["Eikon Evo", "Eikon Exe"], group: "Холл" };
  [[glued, split], [split, glued]].forEach(places => {
    asked.length = 0;
    const res = plan({ scheme: "classic", places }, spy);
    assert.equal(asked.length, 2, "два разных набора серий — два вопроса каталогу");
    const byPost = n => res.places.find(p => p.postNumber === n);
    assert.equal(byPost(2).code, "20001.0");                      /* честная серия — свой механизм */
    assert.equal(byPost(1).code, null);                           /* непонятная серия — честный пробел… */
    assert.equal(byPost(1).missingReason, GAPS.NOT_IN_SERIES);    /* …а не чужой механизм */
  });
});

test("кэш всё ещё кэширует: тот же набор серий в другом виде — один вопрос", () => {
  /* Ключ обязан быть несклеиваемым, но не «уникальным на каждое место»: иначе каталог спрашивают
     на каждой клавише, и подстановка перестаёт быть гарантированно одинаковой во всех постах.
     «Другой вид» — это то, что модуль ДЕЙСТВИТЕЛЬНО приводит к одному виду: порядок серий внутри
     клавиши, пробелы по краям и внутри, повтор одной и той же серии. Регистр сюда НЕ входит и не
     входил бы честно: приводил его только ключ кэша, а в findMechanism уходило исходное написание
     (см. следующий тест). */
  let calls = 0;
  const counting = { findMechanism: args => { calls++; return findMechanism(args); } };
  const res = plan({ scheme: "classic", places: [
    { postId: "p1", postNumber: 1, keyIndex: 0, series: ["Eikon Evo", "Eikon Exe"], group: "Холл" },
    { postId: "p2", postNumber: 2, keyIndex: 0, series: ["Eikon Exe", " Eikon  Evo ", "Eikon Exe"],
      group: "Холл" }
  ] }, counting);
  assert.equal(calls, 1);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
});

test("РЕГИСТР СЕРИЙ: два написания одной серии дают ОДИН результат при любом порядке входа", () => {
  /* Ключ кэша приводил регистр (lowerSeries), а серии, уходящие в deps.findMechanism, — нет: в
     них сохранялось исходное написание места. Два места с сериями [«Eikon Evo»] и [«EIKON EVO»]
     были для кэша ОДНИМ вопросом, и написание в вопросе выбирал первый ПО ВХОДУ спросивший.
     Реализация deps, сравнивающая серии как строки (а такая — самая обычная: серия в каталоге
     записана одной формой), считала один и тот же проект по-разному:
       вход [аккуратное, крикливое] → каталогу ушло [«Eikon Evo»], сумма 40.52 €;
       вход [крикливое, аккуратное] → ушло [«EIKON EVO»], сумма 0 €, оба механизма null.
     Правило теперь одно: ключ кэша РАВЕН аргументу, разные написания — разные вопросы, каждое
     место получает ответ на СВОЁ написание. Ни одно место не получает механизм, подобранный по
     чужому написанию, и порядок входа на запрос к каталогу не влияет. */
  const asked = [];
  const strict = {                       /* каталог сравнивает серии ТОЧНЫМ написанием */
    findMechanism: ({ role, series }) => {
      asked.push(series.slice());
      return ALL_MECH.find(m => ROLE_OF[m.code] === role && m.series.some(s => series.includes(s))) || null;
    }
  };
  const good = { postId: "p1", postNumber: 1, keyIndex: 0, series: ["Eikon Evo"], group: "Кухня" };
  const loud = { postId: "p2", postNumber: 2, keyIndex: 0, series: ["EIKON EVO"], group: "Холл" };
  const runs = [[good, loud], [loud, good]].map(places => {
    asked.length = 0;
    const res = plan({ scheme: "classic", places }, strict);
    return { asked: asked.map(a => a.slice()), print: fingerprint(res), sum: sum(res) };
  });
  assert.deepEqual(runs[0].asked, runs[1].asked, "каталогу заданы те же вопросы в том же порядке");
  assert.deepEqual(runs[0].asked, [["Eikon Evo"], ["EIKON EVO"]], "каждое написание спрошено СВОИМ");
  assert.deepEqual(runs[0].print, runs[1].print, "и весь результат — тот же самый");
  assert.equal(runs[0].sum, 20.26, "аккуратное место считается, крикливое честно остаётся пробелом");
  /* Место с точным написанием получает механизм, место с чужим — пробел, и НИКОГДА наоборот. */
  const byPost = (res, n) => res.places.find(p => p.postNumber === n);
  [[good, loud], [loud, good]].forEach(places => {
    const res = plan({ scheme: "classic", places }, strict);
    assert.equal(byPost(res, 1).code, "20001.0");
    assert.equal(byPost(res, 2).code, null);
    assert.equal(byPost(res, 2).missingReason, GAPS.NOT_IN_SERIES);
  });
});

test("РЕГИСТР СЕРИЙ: каталогу, который регистр прощает, оба места считаются одинаково", () => {
  /* Обратная сторона того же правила: модуль не решает за каталог, различает тот регистр или нет.
     deps без учёта регистра (наша фикстура findMechanism — именно такой) отвечает обоим местам
     одинаково, просто вопросов теперь два, а не один: платить за это чужим написанием в вопросе
     (и нулевой сметой на строгом каталоге) модуль не вправе. */
  let calls = 0;
  const counting = { findMechanism: args => { calls++; return findMechanism(args); } };
  const places = [
    { postId: "p1", postNumber: 1, keyIndex: 0, series: ["Eikon Evo"], group: "Холл" },
    { postId: "p2", postNumber: 2, keyIndex: 0, series: ["EIKON EVO"], group: "Холл" }
  ];
  const res = plan({ scheme: "classic", places }, counting);
  assert.equal(calls, 2, "разные написания — разные вопросы");
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
  assert.equal(sum(res), 51.58);
  assert.deepEqual(fingerprint(plan({ scheme: "classic", places: places.slice().reverse() }, deps)),
    fingerprint(res), "порядок входа ничего не меняет и здесь");
});

test("РЕГИСТР СЕРИЙ: порядок и подбор различают места ОДНИМИ И ТЕМИ ЖЕ сериями", () => {
  /* Ключ кэша и подпись серий в ключе сортировки обязаны жить по одному правилу. Приведи регистр
     в ПОДПИСИ — и два места, отличающиеся только написанием серии, станут для порядка
     неразличимы: тайбрейк провалится на позицию во входном списке, а вместе с ним от входа снова
     начнёт зависеть, кому достанется переключатель (25.79 €), а кому инвертор (42.33 €).
     Три места в одном посту без позиций клавиш: адрес, группа и товар одинаковы, различают их
     ТОЛЬКО серии, причём два из трёх — одна серия в разном написании. */
  const at = series => ({ postId: "p1", postNumber: 1, keyId: 7, group: "Холл", series });
  const list = [at(ARKE), at(["Eikon Evo"]), at(["EIKON EVO"])];
  /* Места опознаём НАПИСАНИЕМ СЕРИИ — единственным, чем они различаются (входные индексы следуют
     за порядком входа и в слепок не годятся, см. fingerprint). */
  const print = res => res.places.map(p => [JSON.stringify(p.series), p.role, p.code, p.missingReason])
    .sort((a, b) => (a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0)));
  const orders = [list, list.slice().reverse(), [list[1], list[2], list[0]], [list[2], list[0], list[1]]];
  const runs = orders.map(places => plan({ scheme: "classic", places }, deps));
  runs.forEach((res, i) => {
    assert.deepEqual(print(res), print(runs[0]), "перестановка " + i);
    assert.equal(sum(res), sum(runs[0]), "перестановка " + i);
    /* Роли раздаются по каноническому порядку: два переключателя и один инвертор, и КАКОЙ именно
       серии достался инвертор — одно и то же при любом входе (это и проверяет слепок выше). */
    assert.deepEqual(res.totalsRequired, { switch: 0, changeover: 2, inverter: 1, button: 0 });
    assert.equal(res.missingTotal, 0);
  });
});

/* ─────────────────── сбой внешней зависимости ─────────────────── */

test("сбой deps.seriesOf — это ПРОБЕЛ, а не падение всего расчёта", () => {
  /* Тот же вызов в тайбрейке порядка был обёрнут в try/catch, а в расчёте ронял plan целиком:
     один и тот же сбой давал то пробел, то исключение — смотря откуда пришёл вызов. Сбой внешней
     зависимости — всегда пробел, ровно как у deps.findMechanism. */
  const boom = { findMechanism, seriesOf: () => { throw new Error("каталог не загружен"); } };
  const places = [
    { postId: "p1", postNumber: 1, keyIndex: 0, key: { id: 1 }, group: "Кухня" },
    { postId: "p2", postNumber: 2, keyIndex: 0, series: EIKON, group: "Холл" }   /* серия задана явно */
  ];
  let res;
  assert.doesNotThrow(() => { res = plan({ scheme: "classic", places }, boom); });
  assert.doesNotThrow(() => LG.canonicalOrder(places, boom.seriesOf));
  assert.equal(res.places[0].code, null);
  assert.equal(res.places[0].missingReason, GAPS.SERIES_FAILED);
  assert.equal(res.places[0].role, ROLES.SWITCH, "роль известна — не подобран только механизм");
  assert.equal(res.places[1].code, "20001.0", "соседнее место с явной серией считается как обычно");
  const gap = res.gaps.find(g => g.kind === GAPS.SERIES_FAILED);
  assert.ok(gap && gap.text.length > 0);
});

test("«серия не определена» и «чтение серии упало» — РАЗНЫЕ причины пробела", () => {
  /* Чинятся они разным: первое — незаполненные данные проекта, второе — сломанная зависимость
     приложения. Один код на оба случая отправил бы пользователя чинить не то. */
  const quiet = plan({ scheme: "classic",
    places: [{ postId: "p1", postNumber: 1, keyIndex: 0, key: { id: 1 }, group: "Кухня" }] }, deps);
  assert.equal(quiet.places[0].missingReason, GAPS.NO_SERIES);
  assert.notEqual(GAPS.SERIES_FAILED, GAPS.NO_SERIES);
  assert.notEqual(LG.GAP_TEXTS[GAPS.SERIES_FAILED], LG.GAP_TEXTS[GAPS.NO_SERIES]);
  assert.ok(LG.GAP_TEXTS[GAPS.SERIES_FAILED].length > 0);
});

/* ─────────────────── имя группы: невидимое и разложенное ─────────────────── */

/* Символы, которых человек в имени не видит, а строка их несёт. Собраны кодами намеренно: в
   исходнике теста они были бы невидимы ровно так же, как в имени группы у заказчика. */
const ZWSP = String.fromCharCode(0x200B);        /* нулевой ширины, приезжает из Word и PDF */
const SOFT_HYPHEN = String.fromCharCode(0x00AD); /* мягкий перенос */
const BOM = String.fromCharCode(0xFEFF);
const DIAERESIS = String.fromCharCode(0x0308);   /* «ё» = «е» + этот знак */
const BREVE = String.fromCharCode(0x0306);       /* «й» = «и» + этот знак */

test("невидимые символы в имени группы не разводят одну группу на две", () => {
  /* Имена групп заказчик вбивает руками и копирует из чужих документов — оттуда и невидимки.
     На вид «Кухня» и «Кухня», а ключи разные: две группы по одному месту вместо одной с двумя,
     и вместо двух переключателей (51.58 €) проект молча получал два выключателя (40.52 €). */
  assert.equal(normalizeGroup("Кух" + ZWSP + "ня"), "Кухня");
  assert.equal(normalizeGroup("Кух" + SOFT_HYPHEN + "ня"), "Кухня");
  assert.equal(normalizeGroup("Кухня" + BOM), "Кухня");
  assert.equal(LG.groupKeyOf("Кух" + ZWSP + "ня"), LG.groupKeyOf("кухня"));
  const res = plan({ scheme: "classic",
    places: [place(1, "Кух" + ZWSP + "ня"), place(2, "Кухня" + SOFT_HYPHEN)] }, deps);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].placeCount, 2);
  assert.equal(res.groups[0].label, "Кухня", "печатается имя без невидимок");
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
  assert.equal(sum(res), 51.58);
});

test("разложенные «ё» и «й» — та же группа: имя приводится к NFC", () => {
  /* Из чужих документов «ё» нередко приезжает как «е» + U+0308, «й» — как «и» + U+0306: на вид
     та же буква, а строка другая, и «Свёт» руками и «Свёт» копипастой были двумя группами. */
  assert.equal(normalizeGroup("Св" + "е" + DIAERESIS + "т"), "Свёт");
  assert.equal(LG.groupKeyOf("Ма" + "и" + BREVE + "ка"), LG.groupKeyOf("Майка"));
  const res = plan({ scheme: "classic",
    places: [place(1, "Св" + "е" + DIAERESIS + "т"), place(2, "Свёт")] }, deps);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].placeCount, 2);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
});

test("не-имя группы (объект, массив, boolean) даёт ПРОБЕЛ, а не общую группу «[object Object]»", () => {
  /* String(value) от любого объекта — «[object Object]», и ВСЕ такие места слипались в одну
     группу: чужие места в чужой группе, завышенный N и другой механизм (два переключателя по
     25.79 € вместо двух выключателей по 20.26 €). Место без осмысленного имени обязано давать
     честный пробел «группа не назначена». */
  assert.equal(normalizeGroup({ id: 7 }), "");
  assert.equal(normalizeGroup([1, 2]), "");
  assert.equal(normalizeGroup(["Кухня"]), "");
  assert.equal(normalizeGroup(true), "");
  assert.equal(normalizeGroup(undefined), "");
  assert.equal(normalizeGroup(Infinity), "");
  assert.equal(normalizeGroup(-0), "0");            /* число именем группы быть может */
  const res = plan({ scheme: "classic", places: [place(1, { id: 7 }), place(2, { id: 9 })] }, deps);
  assert.deepEqual(res.groups, []);
  assert.deepEqual(codes(res), [null, null]);
  assert.equal(res.unassigned.placeCount, 2);
  assert.equal(res.places[0].missingReason, GAPS.NO_GROUP);
});
