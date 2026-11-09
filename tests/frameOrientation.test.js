/* ПРАВИЛО ПАРЫ НАКЛАДОК (Б8): горизонтальная ↔ вертикальная одной отделки. Проверяем на НАСТОЯЩЕМ
   каталоге VIMAR (не на фикстуре-тавтологии): реальные пары 30643↔30645, 30644↔30646, ВСЕ 24 пары,
   и что накладки без двойника (30654, другой серии) пару не получают. Фикстура-тавтология тут была бы
   негодной (§7.1): если бы тест подавал два подставных объекта «имя X» и «имя X вертикально» и ждал,
   что они спарятся, он проверял бы сам себя. Поэтому вход — каталог, факты из него же и фиксируем. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPFrameOrientation = require("../js/frameOrientation.js");

const FRAMES = stand.loadVimarCatalog().products.filter(p => p.kind === "frame");
const byCode = code => FRAMES.find(f => f.code === code);

test("пара по реальным артикулам: 30643.01 ↔ 30645.01, 30644.72 ↔ 30646.72", () => {
  const h4 = byCode("30643.01"), v4 = byCode("30645.01");
  const h6 = byCode("30644.72"), v6 = byCode("30646.72");
  assert.ok(h4 && v4 && h6 && v6, "разведка: эти артикулы есть в каталоге");
  assert.equal(EPFrameOrientation.pairOf(h4, FRAMES), v4, "горизонтальная 30643.01 → вертикальная 30645.01");
  assert.equal(EPFrameOrientation.pairOf(v4, FRAMES), h4, "вертикальная 30645.01 → горизонтальная 30643.01");
  assert.equal(EPFrameOrientation.pairOf(h6, FRAMES), v6, "горизонтальная 30644.72 → вертикальная 30646.72");
  assert.equal(EPFrameOrientation.pairOf(v6, FRAMES), h6, "вертикальная 30646.72 → горизонтальная 30644.72");
});

test("isVertical: по слову « вертикально» в имени, 24 накладки каталога", () => {
  const vertical = FRAMES.filter(EPFrameOrientation.isVertical);
  assert.equal(vertical.length, 24, "в каталоге ровно 24 вертикальных накладки (предпосылка Б8)");
  assert.equal(EPFrameOrientation.isVertical(byCode("30645.01")), true);
  assert.equal(EPFrameOrientation.isVertical(byCode("30643.01")), false);
});

test("ВСЕ 24 вертикальные накладки находят РОВНО одного горизонтального двойника (и обратно)", () => {
  const vertical = FRAMES.filter(EPFrameOrientation.isVertical);
  vertical.forEach(v => {
    const h = EPFrameOrientation.pairOf(v, FRAMES);
    assert.ok(h, `${v.code}: двойник должен найтись`);
    assert.equal(EPFrameOrientation.isVertical(h), false, `${v.code}: двойник горизонтальный`);
    assert.equal(EPFrameOrientation.pairOf(h, FRAMES), v, `${v.code}: двойник симметричен (h→v тот же)`);
  });
});

test("накладка БЕЗ пары двойника не получает: 30654.00 (другое имя), механизм", () => {
  assert.equal(EPFrameOrientation.pairOf(byCode("30654.00"), FRAMES), null, "30654.00 — не вертикальная и без двойника");
  assert.equal(EPFrameOrientation.hasPair(byCode("30654.00"), FRAMES), false);
  // kind-страховка: механизм, даже если бы имя совпало, накладкой не считается
  const mech = stand.loadVimarCatalog().products.find(p => p.kind === "mechanism");
  assert.equal(EPFrameOrientation.pairOf(mech, FRAMES), null, "механизм пару не получает (kind!==frame)");
});

test("verticalOf/horizontalOf/oriented: оба направления и фолбэк на сам frame без пары", () => {
  const h = byCode("30643.01"), v = byCode("30645.01"), lone = byCode("30654.00");
  assert.equal(EPFrameOrientation.verticalOf(h, FRAMES), v, "горизонтальная → её вертикальная");
  assert.equal(EPFrameOrientation.verticalOf(v, FRAMES), v, "вертикальная → она сама");
  assert.equal(EPFrameOrientation.horizontalOf(v, FRAMES), h, "вертикальная → её горизонтальная");
  assert.equal(EPFrameOrientation.horizontalOf(h, FRAMES), h, "горизонтальная → она сама");
  assert.equal(EPFrameOrientation.oriented(h, FRAMES, true), v, "oriented(вертикально) переключает");
  assert.equal(EPFrameOrientation.oriented(v, FRAMES, false), h, "oriented(горизонтально) переключает");
  assert.equal(EPFrameOrientation.oriented(lone, FRAMES, true), lone, "без пары oriented возвращает сам frame (ориентация не меняется)");
});

test("checkboxChecked: у накладки с парой — по её ориентации; без пары — по флагу", () => {
  const h = byCode("30643.01"), v = byCode("30645.01"), lone = byCode("30654.00");
  assert.equal(EPFrameOrientation.checkboxChecked(v, false, FRAMES), true, "вертикальная с парой → отметка горит независимо от флага");
  assert.equal(EPFrameOrientation.checkboxChecked(h, true, FRAMES), false, "горизонтальная с парой → отметка гаснет независимо от флага");
  assert.equal(EPFrameOrientation.checkboxChecked(lone, true, FRAMES), true, "без пары → отметка = свободный флаг (true)");
  assert.equal(EPFrameOrientation.checkboxChecked(lone, false, FRAMES), false, "без пары → отметка = свободный флаг (false)");
  assert.equal(EPFrameOrientation.checkboxChecked(null, true, FRAMES), true, "накладка не разрешилась → отметка = флаг");
});
