/* Структурный регресс-тест ПРОВОДКИ проверки «выделенная сущность ещё жива» в js/app.js.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ, А НЕ ПО ПОВЕДЕНИЮ. app.js — монолит-оркестратор (DOM, state), он не
   грузится ни одним тестом и в node не исполняется. Дефект: renderProperties() падает
   TypeError, когда объект удалён из state (например, пересчёт контуров buildRoomsFromLines
   пересоздаёт авто-комнаты с новым id), а state.selected на него ещё указывает — тогда ветка
   читает d/p/r по undefined. Чинится ОДНОЙ проверкой существования до входа в ветки. Ничем,
   кроме этого теста, позиция и наличие проверки не защищены. Регэкспы с \s* — устойчивость к
   форматированию, а не сравнение строк целиком.

   Мутационная проверка (в отчёте): удаление строки `if(!entity){...}` из renderProperties
   обязано ронять первый assert этого файла. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

test("проверка существования выделенной сущности стоит в renderProperties() ДО входа в ветки", () => {
  const rpIdx = SRC.indexOf("function renderProperties");
  assert.ok(rpIdx >= 0, "функция renderProperties должна существовать в app.js");

  const body = SRC.slice(rpIdx);

  /* Сущность ищется один раз, результат кладётся в entity. */
  const resolveCall = body.search(/const\s+entity\s*=\s*findSelectedEntity\s*\(/);
  assert.ok(resolveCall >= 0, "выделенная сущность должна разрешаться через findSelectedEntity в entity");

  /* Ранний выход при отсутствии сущности: снять выделение и показать пустое состояние. */
  const guard = body.search(/if\s*\(\s*!\s*entity\s*\)\s*\{[^}]*state\.selected\s*=\s*null/);
  assert.ok(guard >= 0, "должна быть проверка `if(!entity)` со сбросом state.selected");

  /* Проверка обязана стоять ДО первой ветки (kind==="device"). */
  const firstBranch = body.search(/if\s*\(\s*kind\s*===\s*"device"\s*\)/);
  assert.ok(firstBranch >= 0, "ветка device должна существовать");
  assert.ok(
    resolveCall < firstBranch && guard < firstBranch,
    "проверка существования сущности обязана стоять ДО входа в ветки — иначе ветка падает TypeError на удалённом объекте"
  );

  /* flushRoomDraft() остаётся ПЕРВОЙ значимой строкой — проверка не должна встать перед ним. */
  const flushCall = body.search(/flushRoomDraft\s*\(\s*\)/);
  assert.ok(flushCall >= 0 && flushCall < guard, "flushRoomDraft() обязан стоять ДО проверки существования");
});
