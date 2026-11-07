/* В29: снятая с производства позиция помечена «снята с производства» в поле «Накладка» —
   и на свёрнутой кнопке EPPicker, и в строке раскрытого списка. Пометку несёт ОДНО правило
   EPPosts.frameAvailability (posts.js:36–40): pickerMeta кладёт готовый текст в meta, а виджет
   его только рисует (виджет про каталог не знает).

   Тремя проверками закрываем обе экранные точки и источник данных:
     1. ЧИСТАЯ discontinuedMark — текст пометки и экранирование (мутация: не вернёт текст → красный).
     2. ПРОВОДКА обеих точек виджета — и кнопка (epk-btn-label), и строка (epk-oname) зовут
        discontinuedMark (мутация: убрать вызов в любой из двух → красный).
     3. pickerMeta (настоящий текст из app.js на DOM-шиме) отдаёт discontinued/statusText из
        НАСТОЯЩЕЙ EPPosts.frameAvailability (мутация: убрать поля → красный). Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { discontinuedMark } = require("../js/picker.js");
const stand = require("./helpers/appStand.js");
const EPPosts = require("../js/posts.js");

test("discontinuedMark: снятая позиция даёт « — <текст>», активная — пусто", () => {
  assert.equal(discontinuedMark({ discontinued: true, statusText: "снята с производства" }, String),
    " — снята с производства");
  assert.equal(discontinuedMark({ discontinued: false, statusText: "снята с производства" }, String), "");
  assert.equal(discontinuedMark(null, String), "");
  /* текст пометки — пользовательские данные meta, обязан идти через esc */
  assert.equal(discontinuedMark({ discontinued: true, statusText: "<b>" }, s => s.replace("<", "&lt;")),
    " — &lt;b>");
  /* без текста (meta не дала statusText) пометки нет — пустую строку не рисуем */
  assert.equal(discontinuedMark({ discontinued: true, statusText: "" }, String), "");
});

test("виджет зовёт discontinuedMark и на кнопке, и в строке списка (обе точки)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "picker.js"), "utf8");
  const btn = src.match(/epk-btn-label"[^]*?<\/span>/);
  assert.ok(btn && /discontinuedMark\(m/.test(btn[0]),
    "свёрнутая кнопка (epk-btn-label) должна показывать пометку через discontinuedMark");
  const row = src.match(/epk-oname"[^]*?<\/span>/);
  assert.ok(row && /discontinuedMark\(m/.test(row[0]),
    "строка списка (epk-oname) должна показывать пометку через discontinuedMark");
});

/* pickerMeta — настоящий текст из app.js. Зависимости-соседи заглушены, а EPPosts — НАСТОЯЩИЙ:
   источник пометки (frameAvailability) в проверке реальный. */
function metaFor(item) {
  return stand.run(["pickerMeta"], {
    product: () => item,
    productPicture: () => "PIC",
    productMoney: () => "1 €",
    moduleWord: n => n + "м",
    mechanismSpan: () => 1,
    EPPosts
  })(item ? item.id : null);
}

test("pickerMeta: снятый товар несёт discontinued+statusText из frameAvailability", () => {
  const m = metaFor({ id: 7, code: "14651", name: "Накладка Plana", active: false });
  assert.equal(m.discontinued, true);
  assert.equal(m.statusText, "снята с производства");
});

test("pickerMeta: активный товар — discontinued=false, пометки нет", () => {
  const m = metaFor({ id: 8, code: "14653", name: "Накладка Plana", active: true });
  assert.equal(m.discontinued, false);
  assert.equal(m.statusText, "");
});
