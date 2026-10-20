/* Подбор светодиода подсветки ПО ТИПУ КЛАВИШИ (ОЗ-1, EPBacklightPick).
   ------------------------------------------------------------------------------------
   Правило заказчика (Вадим, 20.10): класс клавиши (обычная / осевая / LINEA) × напряжение
   (12-24 В / 230 В) × цвет → конкретный артикул светодиода. Тесты гоняют правило на
   ОТГРУЖАЕМОМ каталоге (не на фикстурах — 45% совпадений фикстура-данные уже подводили,
   §7.1), поэтому артикулы и цены ниже — настоящие.

   Мутационная карта (сломай код — покраснеет тест):
     M-класс  — в classify перепутать ordinary↔axial  → «обычная клавиша → осевой LED» и наоборот;
     M-linea  — в classify убрать ветку LINEA (31000* → ordinary/none) → LINEA получит 00935/00937
                или ничего вместо 00941/00943;
     M-volt   — в pick игнорировать voltage (взять любую запись семейства) → 12-24 В клавиша
                получит 230-вольтовый LED;
     M-flat0  — classify для 22751.0 вернёт axial вместо none → клавиша без символов засветится;
     M-cross  — ослабить фильтр по коду в pick → LINEA-клавише подберётся не-LINEA LED. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const BP = require("../js/backlightPick.js");

const CATALOG = stand.loadVimarCatalog();
const PRODUCTS = CATALOG.products || [];
const ACCESSORIES = PRODUCTS.filter(p => p.kind === "accessory");
const byCode = code => PRODUCTS.find(p => String(p.code) === code);

/* Подбор на настоящем пуле аксессуаров (как делает приложение через findBacklight). */
const pick = (code, color, voltage) =>
  BP.pick({ mechanism: byCode(code), color, voltage, accessories: ACCESSORIES });

/* --- 1. Классификация клавиш (M-класс, M-linea, M-flat0) ------------------------------- */

test("classify: обычные клавиши 021/022/023/026 → ordinary (вкл. Eikon и цветные/металл)", () => {
  ["20021", "20021.B", "20021.C.N", "19021", "19021.C.B", "19021.M", "14021", "20026", "19026"]
    .forEach(code => assert.equal(BP.classify(byCode(code)), "ordinary", code));
});

test("classify: осевые клавиши → axial (Plana 14131/14132, Flat с символами, Tondo RN)", () => {
  ["14131", "14132", "14131.C", "22751.1.01", "22751.01", "22761.RN.01", "20101", "19108"]
    .forEach(code => assert.equal(BP.classify(byCode(code)), "axial", code));
});

test("classify: все клавиши LINEA → linea (31000/31000A/31000S)", () => {
  ["31000.B", "31000.2CB", "31000A.2B", "31000S.B"]
    .forEach(code => assert.equal(BP.classify(byCode(code)), "linea", code));
});

test("classify: Flat без символов 22751.0 подсветку НЕ принимает (none)", () => {
  assert.equal(BP.classify(byCode("22751.0.01")), "none");
});

test("classify: LINEA 31506 (клавиша для кнопок) не включаем (none)", () => {
  assert.equal(BP.classify(byCode("31506.B")), "none");
});

test("classify: Flat 22751.RN (KNX/автоматика) подсветку НЕ принимает — проект их не комплектует", () => {
  const rn = PRODUCTS.filter(p => p.kind === "mechanism" && /^22751\.RN\./.test(String(p.code)));
  assert.ok(rn.length >= 9, "в каталоге есть позиции 22751.RN.*");
  rn.forEach(m => {
    assert.equal(BP.classify(m), "none", m.code);
    assert.equal(BP.pick({ mechanism: m, color: "Белая", voltage: "12-24V", accessories: ACCESSORIES }), null, m.code + " 12-24V");
    assert.equal(BP.pick({ mechanism: m, color: "Белая", voltage: "110-250V", accessories: ACCESSORIES }), null, m.code + " 230V");
  });
});

test("accepts: класс none → не принимает, остальные → принимают", () => {
  assert.equal(BP.accepts(byCode("22751.0.01")), false);
  assert.equal(BP.accepts(byCode("31506.B")), false);
  assert.equal(BP.accepts(byCode("20021")), true);
  assert.equal(BP.accepts(byCode("31000.B")), true);
});

/* --- 2. Подбор артикула по классу × напряжению × цвету (M-volt, M-класс) ---------------- */

test("обычная клавиша: 12-24 В → 00935.*, 230 В → 00936.250.* нужного цвета", () => {
  assert.equal(pick("20021", "Белая", "12-24V").code, "00935.W");
  assert.equal(pick("20021", "Красная", "110-250V").code, "00936.250.R");
  assert.equal(pick("19021", "Янтарная", "12-24V").code, "00935.A");
});

test("осевая клавиша: 12-24 В → 00937.*, 230 В → 00938.* нужного цвета", () => {
  assert.equal(pick("14131", "Белая", "12-24V").code, "00937.W");
  assert.equal(pick("22761.RN.01", "Голубая", "110-250V").code, "00938.B");
  assert.equal(pick("22751.1.01", "Зелёная", "12-24V").code, "00937.G");
});

test("клавиша LINEA: 12-24 В → 00941.*, 230 В → 00943.* нужного цвета", () => {
  assert.equal(pick("31000.B", "Белая", "12-24V").code, "00941.W");
  assert.equal(pick("31000A.2B", "Красная", "110-250V").code, "00943.R");
  assert.equal(pick("31000S.B", "Янтарная", "12-24V").code, "00941.A");
});

test("напряжение разделяет артикул: та же клавиша на 12-24 В и 230 В → разные LED", () => {
  assert.equal(pick("20021", "Белая", "12-24V").code, "00935.W");
  assert.equal(pick("20021", "Белая", "110-250V").code, "00936.250.W");
});

/* --- 3. Изоляция LINEA в обе стороны (M-cross, M-linea) --------------------------------- */

test("LINEA-клавише НЕ ставится светодиод другой серии: нет 00941/00943 → null, не 00935", () => {
  const noLinea = ACCESSORIES.filter(a => !/^0094[13]/.test(String(a.code)));
  assert.equal(BP.pick({ mechanism: byCode("31000.B"), color: "Белая", voltage: "12-24V", accessories: noLinea }), null);
});

test("не-LINEA клавише НЕ ставится светодиод LINEA: обычная берёт 00935, а не 00941", () => {
  const a = pick("20021", "Белая", "12-24V");
  assert.match(a.code, /^00935/);
  assert.doesNotMatch(a.code, /^0094[13]/);
});

/* --- 4. null вместо «похожего» (честный пробел) ---------------------------------------- */

test("не заданы цвет/напряжение → null (выбор недостоверен)", () => {
  assert.equal(pick("20021", null, "12-24V"), null);
  assert.equal(pick("20021", "Белая", null), null);
});

test("клавиша без символов и 31506 → null даже при заданных цвете/напряжении", () => {
  assert.equal(pick("22751.0.01", "Белая", "12-24V"), null);
  assert.equal(pick("31506.B", "Белая", "110-250V"), null);
});

test("напряжение 120 В в правило не входит → null (легаси, заказчик не заказывал)", () => {
  assert.equal(pick("20021", "Белая", "120V"), null);
});
