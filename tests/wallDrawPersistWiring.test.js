/* Структурный регресс-тест: КАЖДЫЙ путь лёгкой перерисовки стены сохраняет проект.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ. app.js — монолит-оркестратор (DOM, state), в node не грузится и живьём
   не исполняется, поэтому связку «нарисовал стену → проект сохранён» ничем не покрыть
   поведенчески. Дефект (§7.1, состязательный проход): три пути, меняющие геометрию стен —
   addWallPoint (клик инструментом «Стены»), autoTracePlan (автообрисовка) и обработчик
   clearAutoTraceBtn (удаление автолиний) — звали контракт refreshAfterRoomAssignments БЕЗ второго
   аргумента save. Пользователь рисовал стены, localStorage оставался пуст, F5 стирал работу.
   Соседний путь линий разметки (addRoomLinePoint) второй аргумент scheduleSave передавал —
   стены и разметка вели себя по-разному, хотя двигают привязку к комнате одинаково.

   ЧТО ИМЕННО СТЕРЕЖЁМ (класс, а не три точки). Лёгкая перерисовка стены — это вызов
   refreshAfterRoomAssignments с paint-колбэком ()=>{drawWalls();renderRooms()}. Такой колбэк сам
   НЕ сохраняет (в отличие от renderAll, у которого scheduleSave внутри). Значит инвариант класса:
   у КАЖДОГО вызова контракта с этим колбэком обязан быть аргумент сохранения scheduleSave. Мы не
   пишем три отдельные проверки «здесь есть scheduleSave» (это то же размножение правила, за
   которое чинили app.js) — считаем весь класс: сколько лёгких перерисовок стены всего и сколько
   из них сохраняют. Расхождение = у кого-то сняли scheduleSave. Плюс перепись числом (сегодня 3):
   новый такой путь обязан осознанно подтвердить, что сохраняет.

   ПОЧЕМУ ВЫРЕЗАЕМ КОММЕНТАРИИ. Известная дыра проекта: регэксп матчит закомментированный рядом
   вызов, и мутация «закомментировать» оставляет тест зелёным. Сверяемся по исходнику с вырезанными
   комментариями (общий хелпер tests/helpers/stripComments.js).

   МУТАЦИОННАЯ ПРОВЕРКА (числа — в отчёте): снять ", scheduleSave" у любого из трёх путей → «с
   сохранением» станет 2 при «всего» 3 → красный. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./helpers/stripComments.js");

const SRC = stripComments(fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"));

/* Лёгкая перерисовка стены: paint-колбэк ()=>{drawWalls();renderRooms()}. \s* — терпим к
   форматированию, но не к комментариям (уже вырезаны). Первая форма — любой такой вызов;
   вторая — тот же вызов, но с обязательным вторым аргументом scheduleSave. */
const WALL_REPAINT =
  /refreshAfterRoomAssignments\(\s*\(\s*\)\s*=>\s*\{\s*drawWalls\s*\(\s*\)\s*;\s*renderRooms\s*\(\s*\)\s*\}/g;
const WALL_REPAINT_PERSISTED =
  /refreshAfterRoomAssignments\(\s*\(\s*\)\s*=>\s*\{\s*drawWalls\s*\(\s*\)\s*;\s*renderRooms\s*\(\s*\)\s*\}\s*,\s*scheduleSave\s*\)/g;

const WALL_REPAINT_SITES = 3; // перепись лёгких перерисовок стены в js/app.js на сегодня

test("каждая лёгкая перерисовка стены сохраняет проект через scheduleSave", () => {
  const total = (SRC.match(WALL_REPAINT) || []).length;
  const persisted = (SRC.match(WALL_REPAINT_PERSISTED) || []).length;

  assert.equal(total, WALL_REPAINT_SITES,
    "число путей лёгкой перерисовки стены изменилось: стало " + total + ", ожидалось " +
    WALL_REPAINT_SITES + ". Появился новый — подтвердите перепись здесь, убедившись, что он тоже " +
    "передаёт scheduleSave, иначе нарисованная стена пропадёт от F5.");
  assert.equal(persisted, total,
    "не все пути перерисовки стены сохраняют проект: с scheduleSave — " + persisted + " из " + total +
    ". У кого-то сняли второй аргумент save — стена живёт только в памяти и исчезает от перезагрузки " +
    "(исходный дефект: пустой localStorage после рисования стен).");
});
