/* EPNotices (js/notices.js, Б9/2б) — всплывающие сообщения с крестиком, не гаснущие сами.
   Две части:
   · ЧИСТАЯ buildGroupNameText — текст сообщения Б (имя группы снято у копий) со всеми грамматическими
     вариантами (владелец 10.10). Ожидания ЖЁСТКИЕ — полные строки: §7.1, зелёный тест обязан держать текст.
   · DOM-механика фабрики attach на маленьком DOM-шиме: замена сообщения того же вида, две стопкой, крестик
     закрывает только своё, prune снимает по pruneWhen. Эти связки ловят мутации модуля (см. notices.json).
   Мутации: tools/qa/mutations/notices.json, glob "tests/notices*.test.js".
   Запуск: node --test tests/notices.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPNotices = require("../js/notices.js");

/* ───────────────────────── Текст Б: все грамматические варианты ───────────────────────── */

test("Б, одна копия, одно имя", () => {
  assert.equal(
    EPNotices.buildGroupNameText([{ number: 3, keyIndex: 0, name: "Свет у кровати" }]),
    "У копии № 3 убрано имя группы света «Свет у кровати»: она стоит там же, где исходный пост, и с одинаковым именем программа посчитала бы их одним светом с двух мест. Нужна проходная — поставьте у клавиш одинаковый номер проходной.");
});

test("Б, две копии, одно имя", () => {
  assert.equal(
    EPNotices.buildGroupNameText([{ number: 3, keyIndex: 0, name: "Свет у кровати" }, { number: 4, keyIndex: 0, name: "Свет у кровати" }]),
    "У копий № 3 и № 4 убрано имя группы света «Свет у кровати»: они стоят там же, где исходные посты, и с одинаковым именем программа посчитала бы их одним светом с двух мест. Нужна проходная — поставьте у клавиш одинаковый номер проходной.");
});

test("Б, три копии, одно имя — номера перечислением «№ 3, № 4 и № 5»", () => {
  assert.equal(
    EPNotices.buildGroupNameText([{ number: 3, keyIndex: 0, name: "Свет" }, { number: 4, keyIndex: 0, name: "Свет" }, { number: 5, keyIndex: 0, name: "Свет" }]),
    "У копий № 3, № 4 и № 5 убрано имя группы света «Свет»: они стоят там же, где исходные посты, и с одинаковым именем программа посчитала бы их одним светом с двух мест. Нужна проходная — поставьте у клавиш одинаковый номер проходной.");
});

test("Б, несколько РАЗНЫХ имён — «убраны имена групп света «А» и «Б»»", () => {
  assert.equal(
    EPNotices.buildGroupNameText([{ number: 3, keyIndex: 0, name: "А" }, { number: 4, keyIndex: 1, name: "Б" }]),
    "У копий № 3 и № 4 убраны имена групп света «А» и «Б»: они стоят там же, где исходные посты, и с одинаковым именем программа посчитала бы их одним светом с двух мест. Нужна проходная — поставьте у клавиш одинаковый номер проходной.");
});

test("Б, одна копия с ДВУМЯ снятыми именами — копия упомянута один раз", () => {
  assert.equal(
    EPNotices.buildGroupNameText([{ number: 3, keyIndex: 0, name: "А" }, { number: 3, keyIndex: 1, name: "Б" }]),
    "У копии № 3 убраны имена групп света «А» и «Б»: она стоит там же, где исходный пост, и с одинаковым именем программа посчитала бы их одним светом с двух мест. Нужна проходная — поставьте у клавиш одинаковый номер проходной.");
});

test("Б, номера копий ВСЕГДА по возрастанию (вход в любом порядке)", () => {
  const txt = EPNotices.buildGroupNameText([{ number: 5, keyIndex: 0, name: "С" }, { number: 3, keyIndex: 0, name: "С" }, { number: 4, keyIndex: 0, name: "С" }]);
  assert.match(txt, /^У копий № 3, № 4 и № 5 /, "номера отсортированы по возрастанию независимо от порядка входа");
});

/* ───────────────────────── DOM-механика attach ─────────────────────────
   Маленький честный DOM-шим: createElement → узел с appendChild/removeChild/parentNode, setAttribute,
   onclick, textContent. host — контейнер #notices. */
function makeNode(tag) {
  const node = {
    tag, className: "", attrs: {}, onclick: null, parentNode: null, children: [], _text: "",
    setAttribute(n, v) { this.attrs[n] = String(v); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; },
    get textContent() { return this._text || this.children.map(c => c.textContent).join(""); },
    set textContent(v) { this._text = String(v); this.children = []; }
  };
  return node;
}
function setup() {
  const host = makeNode("div");
  const doc = { createElement: tag => makeNode(tag) };
  return { host, api: EPNotices.attach({ host, doc }) };
}
const kindsOf = host => host.children.length;
const textOf = el => el.children.find(c => c.className === "notice__text").textContent;
const closeBtn = el => el.children.find(c => c.className === "notice__close");

test("show кладёт в контейнер узел с текстом и крестиком-кнопкой с подписью для чтеца", () => {
  const { host, api } = setup();
  api.show("unplaced", "Пост № 2 не вставлен.");
  assert.equal(kindsOf(host), 1, "один узел сообщения");
  assert.equal(textOf(host.children[0]), "Пост № 2 не вставлен.", "текст сообщения");
  const btn = closeBtn(host.children[0]);
  assert.equal(btn.textContent, "×", "крестик виден");
  assert.equal(btn.attrs["aria-label"], "Закрыть сообщение", "у крестика подпись для экранного чтеца");
});

test("повторный show того же вида ЗАМЕНЯЕТ прежний — их не два", () => {
  const { host, api } = setup();
  api.show("unplaced", "первое");
  api.show("unplaced", "второе");
  assert.equal(kindsOf(host), 1, "сообщение того же вида заменилось, а не добавилось вторым");
  assert.equal(textOf(host.children[0]), "второе", "на экране — последнее");
});

test("два РАЗНЫХ вида стоят одновременно (одно над другим)", () => {
  const { host, api } = setup();
  api.show("unplaced", "A");
  api.show("groupName", "B");
  assert.equal(kindsOf(host), 2, "оба вида на экране");
  assert.deepEqual(host.children.map(textOf).sort(), ["A", "B"]);
});

test("крестик закрывает ТОЛЬКО своё сообщение, второе остаётся", () => {
  const { host, api } = setup();
  api.show("unplaced", "A");
  api.show("groupName", "B");
  closeBtn(host.children.find(el => textOf(el) === "A")).onclick();
  assert.equal(kindsOf(host), 1, "осталось одно");
  assert.equal(textOf(host.children[0]), "B", "закрыли A — осталось B");
});

test("prune снимает сообщение, чей pruneWhen вернул true, и не трогает прочие", () => {
  const { host, api } = setup();
  let gone = false;
  api.show("unplaced", "привязано", () => gone);     /* привязано к постам вставки */
  api.show("groupName", "вечное");                    /* без pruneWhen — отмену переживает */
  api.prune();
  assert.equal(kindsOf(host), 2, "пока pruneWhen=false — ничего не снято");
  gone = true;                                        /* посты вставки ушли (Ctrl+Z) */
  api.prune();
  assert.equal(kindsOf(host), 1, "снято только привязанное сообщение");
  assert.equal(textOf(host.children[0]), "вечное", "сообщение без pruneWhen осталось");
});
