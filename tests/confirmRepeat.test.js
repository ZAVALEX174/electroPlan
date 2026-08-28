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

/* ---- ПОТОК НЕ ДОКЛИКИВАЕТСЯ ДО ПОДТВЕРЖДЕНИЯ -------------------------------------------

   Нижняя граница, отсчитанная ОТ ВЗВОДА, поток не останавливала, а лишь ЗАДЕРЖИВАЛА: зажатая
   клавиша и нетерпеливые клики сыплют нажатиями бесконечно, и то из них, что случайно упало за
   800 мс от первого, применяло необратимую команду. Решение — считать паузу ОТ ПРЕДЫДУЩЕГО
   НАЖАТИЯ: пока команду дёргают, подтверждения нет вовсе, а человеку, который прочитал
   предупреждение и нажал ещё раз, ждать не приходится. */

test("НЕТЕРПЕЛИВЫЕ КЛИКИ не подтверждают НИКОГДА — сколько бы их ни было и как бы долго ни шли", () => {
  /* Раньше второй же клик на 850-й мс применял перенумерацию: окно от взвода истекло, и всё. */
  let armed = C.press(null, { now: 0, maxMs: MAX }).armed;
  for (let t = 300; t <= 30000; t += 300) {
    const r = C.press(armed, { now: t, maxMs: MAX });
    assert.notEqual(r.action, "confirm", `клик на ${t} мс подтвердил команду потоком`);
    armed = r.armed;
  }
});

test("ПАУЗА СЧИТАЕТСЯ ОТ ПРЕДЫДУЩЕГО НАЖАТИЯ, а не от взвода", () => {
  /* 900 мс от взвода, но всего 200 мс от предыдущего нажатия — это ещё поток. */
  const first = C.press(null, { now: 0, maxMs: MAX });
  const mid = C.press(first.armed, { now: 700, maxMs: MAX });
  const late = C.press(mid.armed, { now: 900, maxMs: MAX });
  assert.equal(late.action, "wait");
});

test("первое же нажатие ПОСЛЕ ПАУЗЫ подтверждает — быстрой работе поток не мешает", () => {
  let armed = C.press(null, { now: 0, maxMs: MAX }).armed;
  [100, 200, 300, 400].forEach(t => { armed = C.press(armed, { now: t, maxMs: MAX }).armed; });
  assert.equal(C.press(armed, { now: 400 + C.MIN_MS, maxMs: MAX }).action, "confirm");
});

test("поток не перевзводит вопрос новыми числами — иначе его можно было бы додёргать до конца окна", () => {
  /* Если бы истёкшее окно обрабатывалось раньше паузы, поток каждые MAX мс начинал бы всё
     заново и всё равно однажды подтвердил. Взвод обязан оставаться тем же вопросом. */
  let armed = C.press(null, { now: 0, maxMs: MAX, subject: "A" }).armed;
  for (let t = 100; t <= MAX * 3; t += 100) {
    const r = C.press(armed, { now: t, maxMs: MAX, subject: "A" });
    assert.equal(r.action, "wait", `нажатие на ${t} мс вышло из потока`);
    assert.equal(r.armed.at, 0, "время взвода не сдвигается");
    armed = r.armed;
  }
});

test("осознанная пауза в истёкшем окне спрашивает заново, а не подтверждает", () => {
  const first = C.press(null, { now: 0, maxMs: MAX });
  const late = C.press(first.armed, { now: MAX + 1000, maxMs: MAX });
  assert.equal(late.action, "arm");
});

test("взвод из прошлой версии модуля (без last) читается по времени взвода", () => {
  /* Совместимость: состояние взвода хранит вызывающий, и в момент обновления кода оно может
     быть старой формы. Падать или молча подтверждать здесь нельзя. */
  assert.equal(C.press({ at: 0, subject: undefined }, { now: 1500, maxMs: MAX }).action, "confirm");
  assert.equal(C.press({ at: 0, subject: undefined }, { now: 100, maxMs: MAX }).action, "wait");
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

/* ---- ДВА ОРГАНА УПРАВЛЕНИЯ: подтверждает ДРУГОЙ ЖЕСТ, а не другое время ------------------

   Главный вывод приёмки: любая граница по времени поток срабатываний лишь ЗАДЕРЖИВАЕТ. Клики
   раз в 850 мс — уже не «двойной клик», но и не решение: человек просто стучит по кнопке, и
   рано или поздно одно нажатие попадает в разрешённое окно. Поэтому у необратимой команды с
   местом на экране (перенумерация постов) подтверждение вынесено на ОТДЕЛЬНУЮ кнопку: нажатия
   на саму команду не подтверждают НИКОГДА, а в новую кнопку поток по старой не попадает. */

test("нажатия на САМУ КОМАНДУ не подтверждают никогда — ни через 850 мс, ни через час", () => {
  let armed = C.press(null, { now: 0, maxMs: MAX, subject: "A", via: "arm" }).armed;
  [850, 1700, 5000, 100000].forEach(t => {
    const r = C.press(armed, { now: t, maxMs: MAX, subject: "A", via: "arm" });
    assert.equal(r.action, "arm", `нажатие на ${t} мс применило команду`);
    armed = r.armed;
  });
});

test("кнопка подтверждения применяет команду сразу — ждать не нужно ни секунды", () => {
  const armed = C.press(null, { now: 0, maxMs: MAX, subject: "A", via: "arm" }).armed;
  const done = C.press(armed, { now: C.ARM_MS, maxMs: MAX, subject: "A", via: "confirm" });
  assert.equal(done.action, "confirm", "жест уже другой — паузы «на подумать» он не требует");
  assert.equal(done.armed, null);
  assert.ok(C.ARM_MS < 400, `защита от промаха ${C.ARM_MS} мс не должна ощущаться задержкой`);
});

test("нажатие В МОМЕНТ ПОЯВЛЕНИЯ кнопки — промах по соседней команде, а не подтверждение", () => {
  /* Кнопка появляется рядом с командой и слегка сдвигает разметку: клик, нацеленный в саму
     команду, не должен из-за сдвига попасть в подтверждение. И вопрос он не снимает. */
  const armed = C.press(null, { now: 0, maxMs: MAX, subject: "A", via: "arm" }).armed;
  const slip = C.press(armed, { now: 10, maxMs: MAX, subject: "A", via: "confirm" });
  assert.equal(slip.action, "wait");
  assert.equal(slip.armed.at, 0, "вопрос остался тем же — промах его не отменяет");
  assert.equal(C.press(slip.armed, { now: 1000, maxMs: MAX, subject: "A", via: "confirm" }).action, "confirm");
});

test("кнопка подтверждения после истечения окна ничего не применяет", () => {
  const armed = C.press(null, { now: 0, maxMs: MAX, subject: "A", via: "arm" }).armed;
  const late = C.press(armed, { now: MAX + 1, maxMs: MAX, subject: "A", via: "confirm" });
  assert.equal(late.action, "cancel");
  assert.equal(late.armed, null);
});

test("проект изменился между вопросом и подтверждением — команда НЕ применяется", () => {
  /* Подтверждают именно то, что показали: другие числа — другой вопрос. */
  const armed = C.press(null, { now: 0, maxMs: MAX, subject: "77,86 € → 103,65 €", via: "arm" }).armed;
  const other = C.press(armed, { now: 1000, maxMs: MAX, subject: "77,86 € → 51,58 €", via: "confirm" });
  assert.equal(other.action, "cancel");
});

test("кнопка подтверждения без вопроса (взвода нет) ничего не применяет и не задаёт вопрос сама", () => {
  assert.deepEqual(C.press(null, { now: 100, maxMs: MAX, via: "confirm" }), { action: "cancel", armed: null });
  assert.equal(C.press({ at: "битое" }, { now: 100, maxMs: MAX, via: "confirm" }).action, "cancel");
});

test("режим повтора (via не задан) остался прежним — им живёт закрытие конструктора по Esc", () => {
  const first = C.press(null, { now: 0, maxMs: 4000 });
  assert.equal(C.press(first.armed, { now: 100, maxMs: 4000 }).action, "wait");
  assert.equal(C.press(first.armed, { now: 1500, maxMs: 4000 }).action, "confirm");
});
