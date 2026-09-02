/* Критерий «вне помещений» и строка-предупреждение под группами света.

   ДВА УРОВНЯ. Первый — ЧИСТЫЙ критерий EPRoomAssign.isOutsideRooms (грузится в node напрямую):
   единственный экземпляр правила «объект без комнаты» (§7.1), которым метятся иконки на плане и
   считается счётчик. Второй — ПОВЕДЕНЧЕСКИЙ прогон orphanObjectsWarningHtml из app.js: app.js —
   монолит-оркестратор (DOM, state), в node не грузится, поэтому вырезаем ИСХОДНЫЙ ТЕКСТ функции и
   исполняем в vm-контексте с state-шимом и НАСТОЯЩИМ EPRoomAssign. Критерий берётся из реального
   модуля — инверсия/игнор числа комнат в roomAssign.js покраснеют здесь же.

   ЧТО СТЕРЕЖЁМ (состязательный проход):
     - Дефект 1: счётчик не должен иметь СВОЕГО условия мимо isOutsideRooms — иначе на плане без
       единой комнаты метки нет, а строка пишет «N — отмечены на плане». Экран лжёт.
     - Дефект 2: денежная оговорка «считается по схеме проекта» верна ТОЛЬКО для постов (roomId
       устройства в деньгах не участвует). Розетки вне комнат смету не меняют — ложной денежной
       тревоги быть не должно; при этом «отмечены на плане» считает и посты, и устройства (метку
       получают оба). Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPRoomAssign = require("../js/roomAssign.js");
const { isOutsideRooms } = EPRoomAssign;

/* ---- 1. Чистый критерий isOutsideRooms ----------------------------------------------------- */
test("isOutsideRooms: без комнат (roomCount=0) — никто не «вне помещений»", () => {
  assert.equal(isOutsideRooms(null, 0), false, "без комнат метка «вне помещений» — шум у всего подряд");
  assert.equal(isOutsideRooms("R1", 0), false);
});
test("isOutsideRooms: комнаты есть, roomId пустой → true (ловит и null, и undefined)", () => {
  assert.equal(isOutsideRooms(null, 2), true);
  assert.equal(isOutsideRooms(undefined, 2), true, "«поля нет» = «нет комнаты» — loose == ловит undefined");
});
test("isOutsideRooms: комнаты есть, объект в комнате → false", () => {
  assert.equal(isOutsideRooms("R1", 2), false);
});

/* ---- 2. Поведенческий прогон orphanObjectsWarningHtml из app.js ---------------------------- */

/* Живая orphanObjectsWarningHtml на общем стенде: state и настоящий EPRoomAssign (критерий берётся
   из реального модуля — мутации в нём покраснеют здесь). Вырезание исходника и vm — в appStand. */
function buildWarning(state) {
  return stand.run("orphanObjectsWarningHtml", { state: state, EPRoomAssign: EPRoomAssign });
}
const stateOf = (rooms, devices, posts) => ({ rooms: rooms, devices: devices, posts: posts });
const dev = roomId => ({ id: "d" + Math.random(), roomId: roomId });
const post = roomId => ({ id: "p" + Math.random(), roomId: roomId });

test("Дефект 1: комнат нет, но объекты без roomId → строки НЕТ (счётчик не лжёт «отмечены на плане»)", () => {
  const html = buildWarning(stateOf([], [dev(null), dev(null)], [post(null)]))();
  assert.equal(html, "",
    "без комнат ни одна иконка не помечена — строка «Вне помещений» появиться не должна");
});

test("комнаты есть, все объекты в комнатах → строки нет", () => {
  const html = buildWarning(stateOf([{ id: "R1" }], [dev("R1")], [post("R1")]))();
  assert.equal(html, "");
});

test("Дефект 2: выпали только устройства → счётчик их считает, но денежной фразы про схему НЕТ", () => {
  const html = buildWarning(stateOf([{ id: "R1" }], [dev(null), dev(null), dev(null)], [post("R1")]))();
  assert.match(html, /Вне помещений: 3/, "три розетки вне комнат отмечены на плане — счётчик их видит");
  assert.doesNotMatch(html, /схема электрики|по проекту/,
    "roomId устройства в деньгах не участвует — ложной денежной тревоги быть не должно");
});

test("Дефект 2: 1 пост + 4 устройства вне комнат → total=5, а про схему пишем только про 1 пост", () => {
  const st = stateOf([{ id: "R1" }], [dev(null), dev(null), dev(null), dev(null)], [post(null)]);
  const html = buildWarning(st)();
  assert.match(html, /Вне помещений: 5/, "«отмечены на плане» считает и посты, и устройства");
  assert.match(html, /постов: 1/, "денежную оговорку адресуем именно постам");
  assert.match(html, /схема электрики.*считается по проекту/,
    "выпал пост — денежная оговорка обязана прозвучать");
});

test("выпали только посты → total = число постов, денежная фраза присутствует", () => {
  const html = buildWarning(stateOf([{ id: "R1" }], [dev("R1")], [post(null), post(null)]))();
  assert.match(html, /Вне помещений: 2/);
  assert.match(html, /постов: 2/);
});
