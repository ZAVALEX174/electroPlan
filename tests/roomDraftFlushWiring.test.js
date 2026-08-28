/* Структурный регресс-тест ПРОВОДКИ flushRoomDraft в js/app.js.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ, А НЕ ПО ПОВЕДЕНИЮ. app.js — монолит-оркестратор (DOM, state, ~63 КБ),
   он не грузится ни одним тестом и в node не исполняется. Значит позиция вызова flushRoomDraft()
   ничем не защищена: если его переставить НИЖЕ раннего `return` при !state.selected или удалить
   совсем, черновик комнаты будет молча теряться при перерисовке — а все остальные тесты останутся
   зелёными (сам EPRoomDraft.commit чист и проходит независимо от того, зовут ли его). Поэтому
   держим здесь инвариант проводки: разбором исходного текста, устойчивым к форматированию
   (регэкспы с \s*, а не сравнение строк целиком).

   Мутационная проверка (в отчёте): удаление строки `flushRoomDraft();` из renderProperties
   обязано ронять первый assert этого файла. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

test("flushRoomDraft() вызывается в теле renderProperties() и ДО раннего return по !state.selected", () => {
  const rpIdx = SRC.indexOf("function renderProperties");
  assert.ok(rpIdx >= 0, "функция renderProperties должна существовать в app.js");

  /* Смотрим только тело renderProperties (всё, что после её объявления). Определение самой
     flushRoomDraft лежит ВЫШЕ по файлу, поэтому первое совпадение здесь — именно вызов. */
  const body = SRC.slice(rpIdx);
  const flushCall = body.search(/flushRoomDraft\s*\(\s*\)/);
  const earlyReturn = body.search(/if\s*\(\s*!\s*state\.selected\s*\)/);

  assert.ok(flushCall >= 0, "flushRoomDraft() должна вызываться в renderProperties");
  assert.ok(earlyReturn >= 0, "ранний выход по !state.selected должен существовать");
  assert.ok(
    flushCall < earlyReturn,
    "flushRoomDraft() обязан стоять ДО раннего return — иначе черновик не коммитится при пустом выделении"
  );
});

test("mountedRoomId присваивается в ветке комнаты (mountedRoomId = r.id)", () => {
  /* r — объект выбранной комнаты в ветке `else` панели свойств; присваивание привязывает
     смонтированные поля #roomName/#roomArea к конкретной комнате, в которую коммитит flushRoomDraft. */
  assert.match(
    SRC,
    /mountedRoomId\s*=\s*r\.id/,
    "mountedRoomId должен присваиваться из r.id в ветке комнаты renderProperties"
  );
});
