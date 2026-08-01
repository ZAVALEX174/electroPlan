"use strict";
/* Тесты чистой геометрии лица механизма (tools/lib/faces.mjs): разбиение содержимого на связные
   компоненты (в т.ч. разрыв тонкой перемычки-косички), выбор компонента-модуля и решение
   «фото или фолбэк». Модуль — ESM (.mjs), подключаем динамическим import в before() (как для
   tools/lib/nomenclature.mjs); функции чистые, фото/сеть в тест не тащим. */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

let F;
before(async () => {
  F = await import(pathToFileURL(path.join(__dirname, "../tools/lib/faces.mjs")).href);
});

/* Простая маска w×h с прямоугольниками-предметами. */
function makeMask(w, h) {
  const data = new Uint8Array(w * h);
  return {
    w, h, data,
    rect(x0, y0, x1, y1) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[y * w + x] = 1; return this; },
  };
}
/* Компонент из габарита (right/bottom включительно), площадь = площадь bbox. */
function comp(left, top, right, bottom) {
  return { left, top, right, bottom, area: (right - left + 1) * (bottom - top + 1) };
}

test("labelComponents: два раздельных блока → два компонента, шум отброшен", () => {
  const m = makeMask(100, 100);
  m.rect(10, 20, 30, 80);   // блок A
  m.rect(60, 20, 80, 80);   // блок B
  m.rect(95, 0, 96, 1);     // точечный шум (< 0.5% площади) — должен уйти
  const comps = F.labelComponents(m.data, m.w, m.h, { dilate: 0, vopen: 0 });
  assert.equal(comps.length, 2);
  const byLeft = comps.slice().sort((a, b) => a.left - b.left);
  assert.deepEqual([byLeft[0].left, byLeft[0].right], [10, 30]);
  assert.deepEqual([byLeft[1].left, byLeft[1].right], [60, 80]);
});

test("labelComponents: тонкая горизонтальная перемычка рвётся вертикальным размыканием", () => {
  const m = makeMask(100, 100);
  m.rect(10, 20, 30, 80);   // блок-модуль
  m.rect(60, 20, 80, 80);   // блок-аксессуар
  m.rect(31, 48, 59, 52);   // косичка: тонкая (высота 5) перемычка между ними
  // без размыкания перемычка соединяет всё в один компонент
  assert.equal(F.labelComponents(m.data, m.w, m.h, { dilate: 0, vopen: 0 }).length, 1);
  // вертикальное размыкание радиуса 6 (> половины высоты перемычки) её обрывает
  const comps = F.labelComponents(m.data, m.w, m.h, { dilate: 0, vopen: 6 });
  assert.equal(comps.length, 2);
  // bbox блоков считается по ИСХОДНОЙ маске — восстанавливается точно
  const byLeft = comps.slice().sort((a, b) => a.left - b.left);
  assert.deepEqual([byLeft[0].left, byLeft[0].top, byLeft[0].right, byLeft[0].bottom], [10, 20, 30, 80]);
});

test("chooseFace: одиночный 1М в пропорции → лицо, не подозрительный", () => {
  const module = comp(10, 10, 49, 89);         // 40×80, аспект 0.5 = ожидаемому для span 1
  const dec = F.chooseFace([module], 1, 100, 100);
  assert.equal(dec.decision, "face");
  assert.equal(dec.fit, true);
  assert.equal(dec.comp, module);
});

test("chooseFace: модуль + аксессуар другой пропорции → выбран модуль", () => {
  const module = comp(5, 10, 44, 89);          // 40×80, аспект 0.5 (в допуске)
  const accessory = comp(60, 30, 109, 89);     // 50×60, аспект 0.83 (вне допуска)
  const dec = F.chooseFace([accessory, module], 1, 200, 100);
  assert.equal(dec.decision, "face");
  assert.equal(dec.fit, true);
  assert.equal(dec.comp, module);
});

test("chooseFace: крупный модуль бьёт мелкий осколок с той же пропорцией", () => {
  const module = comp(5, 10, 44, 89);          // 40×80, аспект 0.5, площадь большая
  const fragment = comp(0, 40, 9, 59);         // 10×20, аспект 0.5, но крошечный и левее
  const dec = F.chooseFace([fragment, module], 1, 100, 100);
  assert.equal(dec.decision, "face");
  assert.equal(dec.comp, module, "выбираем крупный модуль, а не осколок");
});

test("chooseFace: пара клавиш при span>1 → составная, уходит в фолбэк", () => {
  const key1 = comp(8, 10, 47, 89);            // 40×80, аспект 0.5 (похож на 1М)
  const key2 = comp(60, 10, 99, 89);           // 40×80, аспект 0.5 (похож на 1М)
  const dec = F.chooseFace([key1, key2], 2, 120, 100);  // ожидаем 2М (аспект 1.0)
  assert.equal(dec.decision, "fallback");
  assert.equal(dec.reason, "compound");
  assert.equal(dec.like1mCount, 2);
});

test("chooseFace: нет компонентов → empty", () => {
  const dec = F.chooseFace([], 1, 100, 100);
  assert.equal(dec.decision, "empty");
});

test("chooseFace: ничего не попало в пропорцию и не составная → лицо с fit=false", () => {
  const wide = comp(10, 30, 89, 69);           // 80×40, аспект 2.0 — далеко от 0.5
  const dec = F.chooseFace([wide], 1, 100, 100);
  assert.equal(dec.decision, "face");
  assert.equal(dec.fit, false);
});

test("faceRectFromComponent: высота из ширины по пропорции, центрирование, поджатие TRIM", () => {
  const c = comp(0, 0, 39, 79);                // 40×80 в кадре 100×100, span 1
  const { face, ratio, clamped } = F.faceRectFromComponent(c, 1, 100, 100);
  assert.equal(clamped, false);
  assert.equal(ratio, 1);                       // (40/80)/0.5
  // faceH = 40/0.5 = 80 = высоте bbox; TRIM 2%: [0.8, 1.6, 38.4, 76.8]
  assert.deepEqual(face, [0.8, 1.6, 38.4, 76.8]);
});

test("expectedAspect/aspectDeviation: 1М → 0.5, 2М → 1.0", () => {
  assert.equal(F.expectedAspect(1), 0.5);
  assert.equal(F.expectedAspect(2), 1);
  assert.equal(F.aspectDeviation(comp(0, 0, 39, 79), 1), 0);   // 40/80=0.5 = ожидаемому
  assert.ok(Math.abs(F.aspectDeviation(comp(0, 0, 39, 79), 2) - 0.5) < 1e-9);
});
