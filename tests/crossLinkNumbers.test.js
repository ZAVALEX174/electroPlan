/* СВЯЗИ-ПРОХОДНЫХ (3/4): НОМЕР ПРОХОДНОЙ У КЛАВИШИ + ВЫБОР МЕХАНИЗМА РУКАМИ (владелец 13.09.2026).
   Чистые модули — браузер не нужен:  node --test tests/crossLinkNumbers.test.js

   Решения владельца, которые здесь стережём (каждое — отдельным тестом, с мутацией в комментарии):
     1. У клавиши поле НОМЕРА проходной, сквозного по проекту; ПУСТО — обычный выключатель.
     2. Одинаковый номер у РАЗНЫХ постов = одна проходная (2 поста → 2 переключателя, 3+ → +инверторы).
     3. Имя группы — отдельное поле «для документов»; СВЯЗЬ задаёт НОМЕР (при наличии номера имя не
        связывает; номер связывает вопреки разным именам). Связь по имени без номера сохранена как
        legacy (см. отчёт) — тоже под тестом, чтобы её поведение было явным.
     4. Два одинаковых номера ВНУТРИ одного поста — ошибка: механизм не подставляем.
     5. Номер, встретившийся в проекте ровно ОДИН раз, — предупреждаем (пары нет), а не считаем молча
        выключателем.
     6. ВАРИАНТ C: выбранный руками механизм ГЛАВНЕЕ расчёта; если его нет в серии клавиши — честный
        пробел, а не подстановка чужой серии. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const LG = require("../js/lightingGroups.js");
const EPPlanLabels = require("../js/planLabels.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPLightingPlan = require("../js/lightingPlan.js");
const { plan, ROLES, GAPS } = LG;

/* Реальные артикулы/цены (как в lightingGroups.test.js): проверки сумм считают настоящий мир. */
const MECH = {
  "20001.0": { id: 201453, code: "20001.0", price: 20.26, series: ["Eikon Evo", "Eikon Exe"] }, // выключатель
  "20005.0": { id: 201454, code: "20005.0", price: 25.79, series: ["Eikon Evo", "Eikon Exe"] }, // переключатель
  "20013.0": { id: 201456, code: "20013.0", price: 42.33, series: ["Eikon Evo", "Eikon Exe"] }, // инвертор
  "09001.0.250": { id: 200066, code: "09001.0.250", price: 7.13, series: ["Neve Up"] },
  "09005.0.250": { id: 200071, code: "09005.0.250", price: 8.86, series: ["Neve Up"] }
  /* У Neve Up голого инвертора НЕТ — на этом проверяем «ручной инвертор, а его в серии нет». */
};
const ROLE_OF = { "20001.0": ROLES.SWITCH, "20005.0": ROLES.CHANGEOVER, "20013.0": ROLES.INVERTER,
  "09001.0.250": ROLES.SWITCH, "09005.0.250": ROLES.CHANGEOVER };
const ALL = Object.values(MECH);
const findMechanism = ({ role, series }) => {
  const want = series.map(s => s.toLocaleLowerCase("ru-RU"));
  return ALL.find(m => ROLE_OF[m.code] === role && m.series.some(s => want.includes(s.toLocaleLowerCase("ru-RU")))) || null;
};
const deps = { findMechanism };
const EIKON = ["Eikon Evo", "Eikon Exe"];
const NEVE = ["Neve Up"];

/* Место = клавиша поста. По умолчанию — своя серия Eikon, номер проходной и имя пусты. */
const at = (postNumber, over = {}) => Object.assign(
  { postId: "p" + postNumber, postNumber, keyIndex: 0, keyId: 900 + postNumber, series: EIKON, group: "", crossNo: "" }, over);
const codes = res => res.places.map(p => p.code);
const roles = res => res.places.map(p => p.role);
const atPost = (res, number, keyIndex = 0) => res.places.find(p => p.postNumber === number && p.keyIndex === keyIndex);
const run = places => plan({ scheme: "classic", places }, deps);

/* ─────────────────── Решение 1: пусто — обычный выключатель ─────────────────── */

test("D1: клавиша без номера и без имени — обычный ВЫКЛЮЧАТЕЛЬ (20001.0)", () => {
  /* Мутация: сделать resolveGroup всегда cross:true — эта клавиша ушла бы в предупреждение CROSS_LONELY
     вместо выключателя, тест покраснеет. */
  const res = run([at(1)]);
  assert.equal(atPost(res, 1).role, ROLES.SWITCH);
  assert.equal(atPost(res, 1).code, "20001.0");
  assert.equal(atPost(res, 1).missing, false);
});

test("D1: клавиша С номером входит в проходную (не обычный выключатель)", () => {
  const res = run([at(1, { crossNo: "5" }), at(2, { crossNo: "5" })]);
  assert.deepEqual(roles(res), [ROLES.CHANGEOVER, ROLES.CHANGEOVER], "две точки одной проходной — переключатели, не выключатели");
});

/* ─────────────────── Решение 2: номер связывает посты, N по постам ─────────────────── */

test("D2: два поста с одним номером → ДВА переключателя (20005.0), по одному на посте", () => {
  /* Мутация: в plan брать роль roleFor(schemeId,pos,1) вместо group.placeCount — обе стали бы
     выключателями (20001.0), тест покраснеет. */
  const res = run([at(1, { crossNo: "7" }), at(2, { crossNo: "7" })]);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
  assert.equal(res.groups.length, 1, "один номер — одна проходная группа");
  assert.equal(res.groups[0].placeCount, 2, "мест управления два — два поста");
});

test("D2: три поста с одним номером → два переключателя + ОДИН инвертор (в третьем по порядку)", () => {
  const res = run([at(1, { crossNo: "7" }), at(2, { crossNo: "7" }), at(3, { crossNo: "7" })]);
  assert.deepEqual(codes(res), ["20005.0", "20005.0", "20013.0"]);
  assert.equal(atPost(res, 3).role, ROLES.INVERTER, "инвертор — на третьем месте");
});

test("D2: РАЗНЫЕ номера — РАЗНЫЕ проходные, не сливаются", () => {
  const res = run([at(1, { crossNo: "7" }), at(2, { crossNo: "7" }), at(3, { crossNo: "8" }), at(4, { crossNo: "8" })]);
  assert.equal(res.groups.length, 2, "две проходные — по своему номеру");
  res.groups.forEach(g => assert.equal(g.placeCount, 2));
});

/* ─────────────────── Решение 3: связь по НОМЕРУ, не по имени ─────────────────── */

test("D3: одинаковое ИМЯ, но РАЗНЫЕ номера — НЕ одна проходная (имя не связывает поверх номера)", () => {
  /* Каждый номер встречается раз → у обоих предупреждение «пары нет», а НЕ общая проходная. Мутация:
     если бы имя связывало поверх номера, это была бы одна группа N=2 с переключателями. */
  const res = run([at(1, { crossNo: "1", group: "Кухня" }), at(2, { crossNo: "2", group: "Кухня" })]);
  assert.equal(atPost(res, 1).missingReason, GAPS.CROSS_LONELY);
  assert.equal(atPost(res, 2).missingReason, GAPS.CROSS_LONELY);
  assert.equal(res.groups.length, 2, "две разные проходные, а не одна по имени");
});

test("D3: РАЗНЫЕ имена, но ОДИН номер — одна проходная (номер связал вопреки именам)", () => {
  const res = run([at(1, { crossNo: "3", group: "Кухня" }), at(2, { crossNo: "3", group: "Спальня" })]);
  assert.equal(res.groups.length, 1, "номер связал — одна проходная");
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
});

test("D3: имя — ЯРЛЫК проходной (для документов), связь всё равно по номеру", () => {
  const res = run([at(1, { crossNo: "3", group: "Холл" }), at(2, { crossNo: "3", group: "Холл" })]);
  assert.equal(res.groups[0].label, "Холл", "печатается имя, а связь по номеру");
});

test("D3 (legacy): без номеров одинаковое имя всё ещё связывает — сохранённое поведение до перехода", () => {
  /* Явно фиксируем сосуществование: пока клавиши БЕЗ номера, имя связывает, как прежде. Полное
     снятие связи по имени — отдельный шаг с согласия владельца (см. отчёт). */
  const res = run([at(1, { group: "Кухня" }), at(2, { group: "Кухня" })]);
  assert.equal(res.groups.length, 1);
  assert.deepEqual(codes(res), ["20005.0", "20005.0"]);
});

/* ─────────────────── Решение 4: дубль номера в одном посте — ошибка ─────────────────── */

test("D4: один номер на ДВУХ клавишах одного поста — ошибка, механизм не подобран", () => {
  /* Мутация: не заводить crossDuplicates (или не проверять его в plan) — обе клавиши получили бы
     механизм молча, тест покраснеет. */
  const res = run([at(1, { crossNo: "9", keyIndex: 0 }), at(1, { crossNo: "9", keyIndex: 1 })]);
  const k0 = atPost(res, 1, 0), k1 = atPost(res, 1, 1);
  assert.equal(k0.missingReason, GAPS.CROSS_DUP_IN_POST);
  assert.equal(k1.missingReason, GAPS.CROSS_DUP_IN_POST);
  assert.equal(k0.code, null);
  assert.equal(k1.code, null);
});

test("D4: дубль в одном посте не портит СОСЕДА той же проходной", () => {
  /* p1 с дублем + p2 — чистый: p2 обязан остаться переключателем (N считает посты, дубль-пост один). */
  const res = run([at(1, { crossNo: "9", keyIndex: 0 }), at(1, { crossNo: "9", keyIndex: 1 }), at(2, { crossNo: "9" })]);
  assert.equal(atPost(res, 2).role, ROLES.CHANGEOVER, "сосед считается штатно");
  assert.equal(atPost(res, 2).missing, false);
});

/* ─────────────────── Решение 5: одинокий номер — предупреждение ─────────────────── */

test("D5: номер встречается в проекте ОДИН раз — предупреждение «пары нет», а не выключатель", () => {
  /* Мутация: убрать ветку CROSS_LONELY — место получило бы выключатель 20001.0 молча, тест покраснеет. */
  const res = run([at(1, { crossNo: "42" })]);
  assert.equal(atPost(res, 1).missingReason, GAPS.CROSS_LONELY);
  assert.equal(atPost(res, 1).code, null);
  assert.equal(LG.isProjectGap(GAPS.CROSS_LONELY), true, "это недозаполненный замысел, не пробел поставки");
});

/* ─────────────────── Решение 6: ВАРИАНТ C — рука главнее расчёта ─────────────────── */

test("D6: ручной ИНВЕРТОР на одиночной клавише главнее расчёта (был бы выключатель)", () => {
  /* Мутация: игнорировать roleOverride — вернулся бы выключатель 20001.0, тест покраснеет. */
  const res = run([at(1, { roleOverride: "inverter" })]);
  assert.equal(atPost(res, 1).role, ROLES.INVERTER);
  assert.equal(atPost(res, 1).code, "20013.0");
});

test("D6: ручной выбор у ОДНОЙ точки проходной не трогает роль соседа", () => {
  const res = run([at(1, { crossNo: "7", roleOverride: "switch" }), at(2, { crossNo: "7" })]);
  assert.equal(atPost(res, 1).role, ROLES.SWITCH, "у первого — рука (выключатель)");
  assert.equal(atPost(res, 2).role, ROLES.CHANGEOVER, "у второго — расчёт (переключатель)");
});

test("D6: ручной механизм ГАСИТ предупреждение об одинокой проходной (рука главнее)", () => {
  const res = run([at(1, { crossNo: "1", roleOverride: "changeover" })]);
  assert.equal(atPost(res, 1).missingReason, null, "выбор человека снял предупреждение");
  assert.equal(atPost(res, 1).code, "20005.0");
});

test("D6: ручной механизм НЕ гасит ошибку дубля номера в посте (ошибка данных сильнее выбора)", () => {
  const res = run([at(1, { crossNo: "9", keyIndex: 0, roleOverride: "switch" }), at(1, { crossNo: "9", keyIndex: 1 })]);
  assert.equal(atPost(res, 1, 0).missingReason, GAPS.CROSS_DUP_IN_POST, "дубль важнее ручного выбора");
});

test("D6: ручной инвертор, которого в серии клавиши НЕТ (Neve Up) — честный пробел, не чужая серия", () => {
  /* Требование задачи 5: пробел с причиной, а не подстановка чужой серии. */
  const res = run([at(1, { series: NEVE, roleOverride: "inverter" })]);
  assert.equal(atPost(res, 1).role, ROLES.INVERTER, "роль назначена рукой");
  assert.equal(atPost(res, 1).code, null, "но изделия нет");
  assert.equal(atPost(res, 1).missingReason, GAPS.NOT_IN_SERIES);
});

test("D6: roleOverrideOf принимает только выключатель/переключатель/инвертор", () => {
  assert.equal(LG.roleOverrideOf({ roleOverride: "switch" }), ROLES.SWITCH);
  assert.equal(LG.roleOverrideOf({ roleOverride: "CHANGEOVER" }), ROLES.CHANGEOVER);
  ["", "button", "проходной", "как посчитано", null, 5, {}].forEach(v =>
    assert.equal(LG.roleOverrideOf({ roleOverride: v }), null, `«${String(v)}» → расчёт`));
});

/* ─────────────────── ключ проходной: одна форма на связь и на линии ─────────────────── */

test("crossGroupKey: один номер — один ключ; «4.10» и «4.1» — разные; пусто — пустой", () => {
  assert.equal(LG.crossGroupKey("5"), LG.crossGroupKey(" 5 "));
  assert.notEqual(LG.crossGroupKey("4.10"), LG.crossGroupKey("4.1"));
  assert.equal(LG.crossGroupKey(""), "");
  assert.equal(LG.crossGroupKey("   "), "");
  assert.notEqual(LG.crossGroupKey("5"), LG.groupKeyOf("5"), "проходная и имя-группа «5» — РАЗНЫЕ связи");
});

/* ─────────────────── связи-линии по номеру (planLabels.groupChains) ─────────────────── */

test("линии: одинаковый номер в РАЗНЫХ комнатах связывается (проходная сквозная по проекту)", () => {
  /* Мутация: убрать g.global в бакете groupChains — покомнатное дробление разорвало бы линию. */
  const key = LG.crossGroupKey("5");
  const links = EPPlanLabels.groupChains([
    { number: 1, x: 10, y: 10, room: "r:1", groups: [{ key, label: "5", global: true }] },
    { number: 2, x: 90, y: 90, room: "r:2", groups: [{ key, label: "5", global: true }] }
  ]);
  assert.equal(links.length, 1, "проходная связывает посты через границу комнат");
});

test("линии: связь по ИМЕНИ (без global) остаётся ПОКОМНАТНОЙ — legacy не тронут", () => {
  const links = EPPlanLabels.groupChains([
    { number: 1, x: 10, y: 10, room: "r:1", groups: [{ key: "кухня", label: "Кухня" }] },
    { number: 2, x: 90, y: 90, room: "r:2", groups: [{ key: "кухня", label: "Кухня" }] }
  ]);
  assert.equal(links.length, 0, "разные комнаты — имя их не сшивает");
});

/* ─────────────────── проводка через сбор мест (lightingPlan.collect) ─────────────────── */

test("collect: keyCrossNumbers и keyMechanisms доезжают до места управления", () => {
  const post = { id: "p1", number: 1, mechanismIds: [1, 1],
    keyGroups: ["", ""], keyCrossNumbers: ["5", ""], keyMechanisms: ["", "inverter"] };
  const places = EPLightingPlan.collect([post], {
    product: () => ({ id: 1, name: "Клавиша" }), seriesOf: () => EIKON, isKey: () => true });
  assert.equal(places[0].crossNo, "5", "номер проходной первой клавиши доехал");
  assert.equal(places[1].roleOverride, "inverter", "ручной механизм второй клавиши доехал");
});

/* ─────────────────── переживание сохранения (builderSlots.toPost/fromPost) ─────────────────── */

test("слоты: номер проходной и ручной механизм переживают круг toPost/fromPost и едут с клавишей", () => {
  const slots = EPBuilderSlots.fromPost({ mechanismIds: [1, 2],
    keyGroups: ["Кухня", ""], keyCrossNumbers: ["5", "6"], keyMechanisms: ["", "inverter"] });
  const fields = EPBuilderSlots.toPost(slots);
  assert.deepEqual(fields.keyCrossNumbers, ["5", "6"]);
  assert.deepEqual(fields.keyMechanisms, ["", "inverter"]);
  /* Перестановка (pick меняет порядок) — номер и механизм остаются на СВОЕЙ клавише. */
  const swapped = EPBuilderSlots.toPost(EPBuilderSlots.pick(slots, [1, 0]));
  assert.deepEqual(swapped.keyCrossNumbers, ["6", "5"]);
  assert.deepEqual(swapped.keyMechanisms, ["inverter", ""]);
});

test("слоты: clearGroups (шаблон) снимает и номер проходной, и ручной механизм", () => {
  /* Один шаблон в трёх комнатах — три разные проходные и три разных выбора, а не общие. */
  const slots = EPBuilderSlots.fromPost({ mechanismIds: [1],
    keyGroups: ["Кухня"], keyCrossNumbers: ["5"], keyMechanisms: ["inverter"] });
  const fields = EPBuilderSlots.toPost(EPBuilderSlots.clearGroups(slots));
  assert.deepEqual(fields.keyCrossNumbers, [""]);
  assert.deepEqual(fields.keyMechanisms, [""]);
});
