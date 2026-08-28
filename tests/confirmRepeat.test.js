/* Автотесты подтверждения повтором действия (EPConfirmRepeat).
   Запуск без зависимостей и без сборщика:  node --test tests/

   ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, — ЧТО ПОДТВЕРЖДЕНИЕ НЕЛЬЗЯ СНЯТЬ ОДНИМ ЖЕСТОМ. Пока у окна
   подтверждения была только верхняя граница, обычный двойной клик (4 мс между нажатиями) и
   автоповтор зажатой клавиши проходили оба нажатия мгновенно: предупреждение ещё висело на
   экране, а необратимое действие уже применилось. Второе условие — подтверждают ИМЕННО ТО, что
   показали: изменился проект между нажатиями — вопрос задаётся заново, с новыми числами. */
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/confirmRepeat.js");

const MAX = 6000;

test("первое нажатие взводит подтверждение и ничего не выполняет", () => {
  const r = C.press(null, { now: 1000, maxMs: MAX });
  assert.equal(r.action, "arm");
  assert.equal(r.armed.at, 1000);
});

test("ДВОЙНОЙ КЛИК не подтверждает: второе нажатие через 4 мс — это не осознанное действие", () => {
  const first = C.press(null, { now: 1000, maxMs: MAX });
  const second = C.press(first.armed, { now: 1004, maxMs: MAX });
  assert.equal(second.action, "wait");
  /* взвод остался на СВОЁМ времени: перевзвод сдвигал бы окно на каждое дребезжащее нажатие */
  assert.equal(second.armed.at, 1000);
});

test("автоповтор зажатой клавиши не подтверждает — сколько бы срабатываний ни пришло", () => {
  let armed = C.press(null, { now: 0, maxMs: MAX }).armed;
  for (let t = 30; t < C.MIN_MS; t += 30) {
    const r = C.press(armed, { now: t, maxMs: MAX });
    assert.equal(r.action, "wait", `нажатие на ${t} мс не должно подтверждать`);
    armed = r.armed;
  }
});

test("нажатие после нижней границы подтверждает и снимает взвод", () => {
  const first = C.press(null, { now: 1000, maxMs: MAX });
  const second = C.press(first.armed, { now: 1000 + C.MIN_MS, maxMs: MAX });
  assert.equal(second.action, "confirm");
  assert.equal(second.armed, null);
});

test("нижняя граница заведомо больше системного двойного клика (500 мс)", () => {
  assert.ok(C.MIN_MS > 500, `нижняя граница ${C.MIN_MS} мс не спасает от двойного клика`);
});

test("после «слишком рано» следующее осознанное нажатие подтверждает", () => {
  /* Человек кликнул дважды (дребезг), прочитал предупреждение и нажал ещё раз. */
  const first = C.press(null, { now: 0, maxMs: MAX });
  const bounce = C.press(first.armed, { now: 5, maxMs: MAX });
  const real = C.press(bounce.armed, { now: 2000, maxMs: MAX });
  assert.equal(real.action, "confirm");
});

test("истёкшее окно спрашивает заново, а не подтверждает", () => {
  const first = C.press(null, { now: 0, maxMs: MAX });
  const late = C.press(first.armed, { now: MAX + 1, maxMs: MAX });
  assert.equal(late.action, "arm");
  assert.equal(late.armed.at, MAX + 1);
});

/* ---- подтверждение привязано к тому, что показали ---------------------------------- */

test("та же подпись — подтверждаем; ДРУГАЯ подпись — спрашиваем заново с новыми числами", () => {
  const first = C.press(null, { now: 0, maxMs: MAX, subject: "77,86 € → 103,65 €" });
  const same = C.press(first.armed, { now: 1500, maxMs: MAX, subject: "77,86 € → 103,65 €" });
  assert.equal(same.action, "confirm");
  const other = C.press(first.armed, { now: 1500, maxMs: MAX, subject: "77,86 € → 51,58 €" });
  assert.equal(other.action, "arm", "проект изменился — второе нажатие обязано быть новым вопросом");
  assert.equal(other.armed.subject, "77,86 € → 51,58 €");
});

test("действие БЕЗ подписи сравнивает только время (старый контракт закрытия окна)", () => {
  const first = C.press(null, { now: 0, maxMs: 4000 });
  assert.equal(C.press(first.armed, { now: 1500, maxMs: 4000 }).action, "confirm");
});

test("часы, уехавшие назад, не подтверждают — спрашиваем заново", () => {
  const first = C.press(null, { now: 10000, maxMs: MAX });
  const back = C.press(first.armed, { now: 9000, maxMs: MAX });
  assert.equal(back.action, "arm");
});

test("битое состояние взвода не роняет команду, а начинает с вопроса", () => {
  assert.equal(C.press({}, { now: 100, maxMs: MAX }).action, "arm");
  assert.equal(C.press({ at: "не число" }, { now: 100, maxMs: MAX }).action, "arm");
});
