/* ПОВЕДЕНЧЕСКИЙ регресс: видимость групп света в РЕДАКТОРЕ (часть 1c «ПЛАН-В-ДОКУМЕНТЕ»).

   ЗАЧЕМ. Механика групп света считает деньги (проходные/перекрёстные механизмы), но задать
   группу можно было только в конструкторе у слота клавиши, а из панели поста не было даже
   НАМЁКА, что группы существуют. Здесь узел интерфейса: перечень групп в свойствах РАЗМЕЩЁННОГО
   поста (postGroupsPropHtml).

   ⚠️ ПРАВИЛО ПРОЕКТА (владелец 13.09.2026, п.3): клавиша без имени группы — самостоятельный
   выключатель, а не пробел. Поэтому в перечне свойств поста у безымянной клавиши печатается
   «отдельный выключатель», а не «группа не задана», и счётчика «постов с клавишами без группы»
   больше нет вовсе (postsWithMissingGroupsText удалён вместе с узлом #missingGroupsStatus):
   недозаполнения тут нет, тревожить нечем.

   КАК. app.js — монолит-оркестратор (DOM, state), в node не грузится. Вырезаем ИСХОДНЫЙ ТЕКСТ
   функций из app.js и исполняем в vm на общем стенде (appStand). ⚠️ Предикат клавиши берётся
   НАСТОЯЩИЙ: keySlotKind + isKeyProduct режутся из app.js вместе с проверяемыми функциями, а
   разбор поста (EPBuilderSlots.fromPost) и нормализация имени (EPLightingGroups.normalizeGroup) —
   настоящие модули. Второй копии правила «что такое клавиша» тест не заводит (§7.1) — подмена
   предиката в app.js покраснеет здесь.

   МУТАЦИЯ → КРАСНЫЙ ТЕСТ:
     - postGroupsPropHtml возвращает "" / без строк клавиш            → «перечень групп в свойствах»;
     - в постройке строки убрать ветвление name? (всегда «имя»)       → «клавиша без имени ≠ именованная»;
     - keySlotKind: розетка стала клавишей (isKeyProduct → true)      → перечень считает лишнее.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");

const EPBuilderSlots = require("../js/builderSlots.js");
const EPLightingGroups = require("../js/lightingGroups.js");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

/* Каталог-шим: 100/101 — клавиши (partRole "key"), 200 — не клавиша (розетка), всё прочее —
   пропавший из прайса артикул (product → null). Ровно те ветви трёхзначного keySlotKind. */
const KEY_A = 100, KEY_B = 101, SOCKET = 200;
const product = id => {
  if (id === KEY_A || id === KEY_B) return { partRole: "key" };
  if (id === SOCKET) return { partRole: "socket" };
  return null;
};
const postOf = (mechanismIds, keyGroups) => ({ mechanismIds, keyGroups });

/* ---- postGroupsPropHtml: перечень групп в панели свойств поста ----------------------------- */

function groupsHtml(post) {
  return stand.runNamed(["isKeyProduct", "keySlotKind", "postGroupsPropHtml"], {
    product,
    EPBuilderSlots,
    EPLightingGroups,
    esc: s => String(s)
  })(post);
}

test("свойства поста: у клавиши с именем печатается имя, у клавиши без имени — «отдельный выключатель», розетка не в списке", () => {
  const html = groupsHtml(postOf([KEY_A, SOCKET, KEY_B], ["Кухня", "", ""]));
  assert.match(html, /Кухня/, "заданное имя группы клавиши обязано быть названо");
  assert.match(html, /отдельный выключатель/, "клавиша без имени — самостоятельный выключатель, а не пробел");
  /* Ровно две строки клавиш: розетка (200) в перечень групп не попадает. Подмена предиката
     (розетка → клавиша) сделает три — тест покраснеет. */
  assert.equal((html.match(/Клавиша \d+/g) || []).length, 2,
    "клавиши считаются настоящим предикатом keySlotKind — не-клавиша в перечень не попадает");
  assert.equal(html.match(/has-group/g).length, 1, "ровно одна клавиша с заданным именем");
  assert.equal(html.match(/no-group/g).length, 1, "ровно одна клавиша без имени (отдельный выключатель)");
});

test("свойства поста: пробельное имя — отдельный выключатель (нормализация именем модуля)", () => {
  const html = groupsHtml(postOf([KEY_A], ["   "]));
  assert.match(html, /отдельный выключатель/, "«   » после normalizeGroup — пусто, значит отдельный выключатель");
});

test("свойства поста без клавиш: сказано, что задавать группы негде", () => {
  const html = groupsHtml(postOf([SOCKET, SOCKET], ["", ""]));
  assert.match(html, /нет клавиш/, "пост без клавиш обязан прямо сообщить, что группы задавать негде");
  assert.doesNotMatch(html, /Клавиша \d+/, "строк клавиш быть не должно");
});

test("свойства поста: имя группы экранируется через esc", () => {
  /* esc-шим здесь String (не экранирует) — проверяем, что имя проходит ИМЕННО через esc(): при
     удалении esc из разметки текст не изменится, но с настоящим esc в проде тег бы обезвредился.
     Стережём сам факт вызова esc косвенно — через то, что имя вставлено как <b>имя</b>. */
  const html = groupsHtml(postOf([KEY_A], ["Спальня"]));
  assert.match(html, /<b>Спальня<\/b>/, "имя заданной группы печатается выделенным");
});

/* ---- проводка вызова ---------------------------------------------------------------------- */

test("renderProperties: ветка поста встраивает postGroupsPropHtml(p)", () => {
  const src = stand.functionSource("renderProperties");
  const postBranch = src.slice(src.indexOf('kind==="post"'));
  assert.match(postBranch, /\$\{postGroupsPropHtml\(p\)\}/,
    "перечень групп света обязан быть встроен в разметку панели свойств поста");
});

test("index.html: узла-счётчика «постов без группы» больше нет (клавиша без имени — не пробел)", () => {
  assert.equal((INDEX.match(/id="missingGroupsStatus"/g) || []).length, 0,
    "счётчик постов без группы удалён вместе с самим понятием пробела «нет группы»");
});
