/* ПРАВИЛО ДВОЙНИКА СТАНДАРТА (Б8-д): итальянская накладка ↔ немецкая накладка той же отделки,
   той же серии и того же числа модулей. Проверяем на НАСТОЯЩЕМ обогащённом каталоге VIMAR (standard
   и frameColor дописывает data.js из attrs — в сыром catalog-vimar.js их нет), а не на фикстуре-
   тавтологии (§7.1): вход — каталог, факты из него же и фиксируем. Перезалив прайса уронит тест
   осмысленно, числа «вслепую» не хардкодим.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено прогоном, см. отчёт): какие ассерты краснеют на какую поломку —
   без сверки серии / числа модулей / цвета / без шага суффикса / BOTH как кандидат / hits[0] вместо
   «ровно один» / без oriented. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPPostStandard = require("../js/postStandard.js");
const EPFrameOrientation = require("../js/frameOrientation.js");

/* Обогащённый каталог — те же три файла и порядок, что index.html (у накладок цвет/серию/стандарт
   дописывает data.js из attrs; в сыром catalog-vimar.js их нет). */
function loadEnrichedProducts() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;
}
const PRODUCTS = loadEnrichedProducts();
const FRAMES = PRODUCTS.filter(p => p.kind === "frame" && p.active !== false);
const byCode = code => FRAMES.find(f => f.code === code);
const twinCode = code => { const t = EPPostStandard.twinOf(byCode(code), FRAMES); return t ? t.code : null; };

/* Предпосылки каталога: без них «зелёный» ничего не значит. */
test("предпосылки каталога: 1627 активных накладок, 30654/30643/30645 на месте", () => {
  assert.equal(FRAMES.length, 1627, "активных накладок в каталоге");
  assert.ok(byCode("30654.00") && byCode("30643.00") && byCode("30645.00"), "LINEA 30654/30643/30645 .00 есть");
  assert.equal(String(byCode("30654.00").standard).toUpperCase(), "IT");
  assert.equal(String(byCode("30643.00").standard).toUpperCase(), "DE");
  assert.equal(EPFrameOrientation.isVertical(byCode("30645.00")), true, "30645.00 — вертикальная");
});

/* --- 1. ВСЕ 15 ОТДЕЛОК LINEA 4М: IT 30654 → DE 30643 (12 двойников, 3 Reflex без двойника) ------- */
test("LINEA 4М: 12 отделок 30654 → 30643, включая .70 → 30643.70.01 (суффикс отличается, цвет тот же)", () => {
  const map = {
    "30654.00": "30643.00", "30654.01": "30643.01", "30654.02": "30643.02",
    "30654.20": "30643.20", "30654.21": "30643.21", "30654.22": "30643.22",
    "30654.60": "30643.60", "30654.61": "30643.61", "30654.62": "30643.62",
    "30654.70": "30643.70.01",   // суффикс артикула РАЗНЫЙ (70 vs 70.01), цвет «Золото матовое» совпадает
    "30654.71": "30643.71", "30654.72": "30643.72"
  };
  for (const [it, de] of Object.entries(map)) {
    assert.equal(twinCode(it), de, `${it} → ${de}`);
  }
});

test("LINEA 4М Reflex (.40/.41/.42): немецкого двойника НЕТ → null (выдуманного не подставляем)", () => {
  assert.equal(twinCode("30654.40"), null, "30654.40 Reflex белая — DE-двойника нет");
  assert.equal(twinCode("30654.41"), null, "30654.41 Reflex конопляная — DE-двойника нет");
  assert.equal(twinCode("30654.42"), null, "30654.42 Reflex чёрная — DE-двойника нет");
});

test("Arke Reflex слоновая кость не подменяется обычной накладкой того же цвета", () => {
  const reflex4 = byCode("19654.67"), ordinary4 = byCode("19643.73");
  const reflex8 = byCode("19668.67"), ordinary8 = byCode("19669.73");
  assert.match(reflex4.name, /рефлекс/i);
  assert.doesNotMatch(ordinary4.name, /рефлекс/i);
  assert.equal(reflex4.frameColor, ordinary4.frameColor, "цветовая метка совпадает, отделка — нет");
  assert.equal(reflex4.price, 23.33);
  assert.equal(ordinary4.price, 11.9);
  assert.equal(twinCode("19654.67"), null, "4М Reflex не становится обычной DE за другую цену");
  assert.equal(twinCode("19668.67"), null, "8М Reflex тоже не становится обычной DE");
  assert.equal(twinCode("19643.73"), "19654.73", "обычная DE находит обычную IT, а не Reflex");
  assert.equal(reflex8.frameColor, ordinary8.frameColor);
});

test("Plana и Plana Up белые: немецкая 14643 выбирает обычную IT, Up не подменяется", () => {
  const ordinary = byCode("14654.01"), up = byCode("14654U.01"), de = byCode("14643.01");
  assert.match(up.name, /Plana Up/i, "отдельная модель отмечена в номенклатуре");
  assert.doesNotMatch(ordinary.name, /Plana Up/i);
  assert.equal(up.frameColor, ordinary.frameColor);
  assert.equal(up.frameMaterial, ordinary.frameMaterial);
  assert.equal(twinCode(ordinary.code), de.code);
  assert.equal(twinCode(de.code), ordinary.code, "обратный щелчок возвращает исходную модель");
  assert.equal(twinCode(up.code), null, "у Plana Up нет немецкой пары в каталоге");
  assert.equal(EPPostStandard.frameForStandard(up, "DE", FRAMES, false), null);
  assert.equal(EPPostStandard.frameForStandard(de, "IT", FRAMES, false).code, ordinary.code);
  assert.equal(twinCode("14654.AB.01"), "14643.AB.01");
  assert.equal(twinCode("14643.AB.01"), "14654.AB.01");
  assert.equal(twinCode("14654U.AB.01"), null);
});

test("Plana: металлическая .71 не подменяется технополимерной .27 при том же цвете", () => {
  for (const [metal, de, plastic] of [
    ["14654.71", "14643.27", "14654.27"],
    ["14668.71", "14669.27", "14668.27"]
  ]) {
    const m = byCode(metal), d = byCode(de), p = byCode(plastic);
    assert.equal(m.frameColor, d.frameColor);
    assert.equal(m.frameMaterial, "Металл");
    assert.equal(d.frameMaterial, "Технополимер");
    assert.equal(p.frameMaterial, "Технополимер");
    assert.equal(twinCode(metal), null, `${metal}: немецкой металлической пары нет`);
    assert.equal(EPPostStandard.frameForStandard(m, "DE", FRAMES, false), null,
      `${metal}: кнопка немецкого стандарта недоступна`);
    assert.equal(twinCode(de), plastic, `${de}: обратный выбор ведёт к технополимерной .27`);
    assert.equal(twinCode(plastic), de, `${plastic}: двусторонняя пара .27`);
  }
  assert.equal(twinCode("14654.70"), null, "металлическая бронза не становится технополимерной .26");
  assert.equal(twinCode("14668.70"), null, "8М металлическая бронза не становится технополимерной .26");
  assert.equal(twinCode("30654.70"), "30643.70.01", "законная пара с разным суффиксом и тем же материалом сохраняется");
});

test("весь каталог: каждая найденная IT/DE-пара обратима, чужая модель и материал не подменяются", () => {
  const horizontal = FRAMES.filter(f => (f.standard === "IT" || f.standard === "DE") &&
    !EPFrameOrientation.isVertical(f));
  const pairs = horizontal.map(f => [f, EPPostStandard.twinOf(f, FRAMES)]).filter(([, twin]) => twin);
  assert.equal(pairs.length, 380, "190 пар считаются в обе стороны");
  for (const [frame, twin] of pairs) {
    assert.equal(EPPostStandard.twinOf(twin, FRAMES), frame, `${frame.code} ↔ ${twin.code}`);
    assert.equal(/Plana Up/i.test(frame.name), /Plana Up/i.test(twin.name), `${frame.code}: модель`);
    assert.equal(/рефлекс|reflex/i.test(frame.name), /рефлекс|reflex/i.test(twin.name), `${frame.code}: фактура`);
    const suffix = code => code.slice(code.indexOf(".") + 1);
    if (suffix(frame.code) !== suffix(twin.code)) {
      assert.equal(frame.frameMaterial, twin.frameMaterial, `${frame.code}: материал при разных суффиксах`);
    }
  }
});

/* --- 2. ОБРАТНОЕ НАПРАВЛЕНИЕ: DE 30643 → IT 30654 ---------------------------------------------- */
test("обратно: 30643 → 30654, симметрично (включая 30643.70.01 → 30654.70)", () => {
  assert.equal(twinCode("30643.00"), "30654.00");
  assert.equal(twinCode("30643.70.01"), "30654.70", "суффикс 70.01 (DE) находит цвет «Золото матовое» в IT 30654.70");
  assert.equal(twinCode("30643.72"), "30654.72");
});

/* --- 3. ARKE: цвет одинаков у B06 и B26 → различает СУФФИКС артикула ---------------------------- */
test("Arke 19654.B06/.B26: оба цвета «Полярная Total Look», двойника различает суффикс", () => {
  assert.equal(byCode("19654.B06").frameColor, byCode("19654.B26").frameColor,
    "предпосылка: у B06 и B26 ОДИН цвет — одного цвета мало, нужен суффикс");
  assert.equal(twinCode("19654.B06"), "19643.B06", "суффикс B06 выбирает 19643.B06 из двух одноцветных кандидатов");
  assert.equal(twinCode("19654.B26"), "19643.B26", "суффикс B26 выбирает 19643.B26");
});

/* --- 4. BOTH (универсальная) двойника не получает -------------------------------------------- */
test("BOTH-накладка (1–2 модуля) двойника не получает: она годна обоим стандартам", () => {
  const both = FRAMES.find(f => String(f.standard).toUpperCase() === "BOTH");
  assert.ok(both, "предпосылка: BOTH-накладки в каталоге есть");
  assert.equal(EPPostStandard.twinOf(both, FRAMES), null, "у BOTH нет «другого стандарта» — twinOf null");
  assert.equal(EPPostStandard.currentStandard(both, FRAMES), "BOTH", "currentStandard показывает BOTH");
});

/* --- 5. ВЕРТИКАЛЬНАЯ исходная: сначала горизонтальный двойник, потом смена стандарта ----------- */
test("вертикальная 30645.00 (DE): currentStandard=DE, twin по горизонтальному базису → 30654.00 (IT)", () => {
  const v = byCode("30645.00");
  assert.equal(EPPostStandard.currentStandard(v, FRAMES), "DE", "вертикальная DE показывает стандарт DE");
  assert.equal(twinCode("30645.00"), "30654.00",
    "twin берётся от горизонтального базиса 30643.00 → IT 30654.00 (а не от самой вертикальной)");
});

/* --- 6. frameForStandard: применяет ТЕКУЩЕЕ расположение после смены стандарта ----------------- */
test("frameForStandard: «Немецкий» при «Вертикально» на 30654.00 → 30645.00 (oriented применён)", () => {
  const it = byCode("30654.00");
  assert.equal(EPPostStandard.frameForStandard(it, "DE", FRAMES, true).code, "30645.00",
    "DE-двойник 30643.00, затем oriented(вертикально) → вертикальный 30645.00");
  assert.equal(EPPostStandard.frameForStandard(it, "DE", FRAMES, false).code, "30643.00",
    "тот же выбор горизонтально → 30643.00");
});

test("frameForStandard: «Итальянский» на вертикальной 30645.00 → 30654.00, расположение остаётся вертикальным", () => {
  const v = byCode("30645.00");
  // у 30654 вертикальной пары нет → oriented(…,true) возвращает сам 30654.00, флаг «вертикально» свободен
  assert.equal(EPPostStandard.frameForStandard(v, "IT", FRAMES, true).code, "30654.00",
    "IT-двойник горизонтального базиса = 30654.00; вертикального двойника у него нет → он сам");
});

/* --- 7. ИНВАРИАНТ «РОВНО ОДИН → ОН, ИНАЧЕ null» ------------------------------------------------
   Реальный каталог сейчас не даёт двух неразличимых кандидатов (серия+модули+цвет+суффикс), поэтому
   мутацию «hits[0] вместо ровно-один» на нём не поймать. Держим инвариант КРАФТОВЫМ входом: ДВА
   DE-кандидата, неотличимых по всем сверяемым признакам (та же серия/модули/цвет/суффикс). Это НЕ
   тавтология (функции НЕ скармливают её же вывод) — тест держит ровно правило «неоднозначность → не
   подставляем выдуманного двойника» (§7.1), чтобы будущий прайс с коллизией не выдал случайную пару. */
test("неоднозначность: два неотличимых DE-кандидата → null (а не первый попавшийся)", () => {
  const base = { code: "AA.1", kind: "frame", standard: "IT", series: ["s"], slotCount: 4, frameColor: "c" };
  const twinA = { code: "BB.1", kind: "frame", standard: "DE", series: ["s"], slotCount: 4, frameColor: "c" };
  const twinB = { code: "CC.1", kind: "frame", standard: "DE", series: ["s"], slotCount: 4, frameColor: "c" };
  assert.equal(EPPostStandard.twinOf(base, [base, twinA, twinB]), null,
    "два кандидата с одним суффиксом неразличимы → null (мутация «hits[0]» вернула бы BB.1)");
  // контроль: убери одного — остаётся ровно один, двойник находится (значит null выше — от неоднозначности)
  assert.equal(EPPostStandard.twinOf(base, [base, twinA]), twinA, "ровно один кандидат → он");
});

/* BOTH-накладка НЕ кандидат в двойники. На реальном каталоге это не проверить: BOTH бывает только на
   1–2 модуля, а двойников ищем на 4/6/8 — slotCount не совпадёт, и неверная «BOTH как кандидат» прошла бы
   зелёной. Держим КРАФТОВЫМ входом, где BOTH-декой совпадает с базисом по ВСЕМ сверяемым признакам (серия/
   модули/цвет/суффикс): правильное правило берёт только «другой стандарт» (IT↔DE), BOTH универсальна и
   двойником быть не может — иначе переключатель подменил бы накладку на универсальную и состав/цена уехали. */
test("BOTH-декой совпадает по всем признакам, но двойником НЕ становится (только IT↔DE)", () => {
  const base = { code: "AA.1", kind: "frame", standard: "IT", series: ["s"], slotCount: 4, frameColor: "c" };
  const both = { code: "ZZ.1", kind: "frame", standard: "BOTH", series: ["s"], slotCount: 4, frameColor: "c" };
  assert.equal(EPPostStandard.twinOf(base, [base, both]), null,
    "BOTH как единственный кандидат → null (мутация «BOTH как кандидат» вернула бы ZZ.1)");
  const twinDE = { code: "BB.1", kind: "frame", standard: "DE", series: ["s"], slotCount: 4, frameColor: "c" };
  assert.equal(EPPostStandard.twinOf(base, [base, both, twinDE]), twinDE,
    "при живом DE-двойнике BOTH-декой не создаёт неоднозначности и не перебивает его");
});

test("frameForStandard: позиция недоступна (нет двойника) → null; текущий стандарт → сам (oriented)", () => {
  const reflex = byCode("30654.40");   // IT, DE-двойника нет
  assert.equal(EPPostStandard.frameForStandard(reflex, "DE", FRAMES, false), null, "немецкой накладки нет → null");
  assert.equal(EPPostStandard.frameForStandard(reflex, "IT", FRAMES, false).code, "30654.40", "текущий IT → сам");
  const both = FRAMES.find(f => String(f.standard).toUpperCase() === "BOTH");
  assert.equal(EPPostStandard.frameForStandard(both, "IT", FRAMES, false), null, "BOTH → ни IT");
  assert.equal(EPPostStandard.frameForStandard(both, "DE", FRAMES, false), null, "BOTH → ни DE");
  assert.equal(EPPostStandard.frameForStandard(null, "IT", FRAMES, false), null, "накладка не выбрана → null");
});
