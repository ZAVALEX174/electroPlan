/* Чистая функция EPRightPanel.kpLine — текст «КП № …» для тёмного блока «Итого по проекту» в правой
   панели (Редизайн 2). Правило: номер есть → «КП № <номер>»; номера нет (пусто/пробелы/undefined) →
   "" (строки в блоке не будет). ОДНО место правила текста (§7.1) — второй копии в index.html/app.js нет.

   МУТАЦИЯ → КРАСНЫЙ: убрать .trim() (пробельный номер даст строку), снять условие (пустой номер даст
   «КП № »), сменить префикс — любой из тестов ниже краснеет. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const EPRightPanel = require("../js/rightPanel.js");

test("kpLine: номер есть → «КП № <номер>»", () => {
  assert.equal(EPRightPanel.kpLine("0147"), "КП № 0147");
  assert.equal(EPRightPanel.kpLine("EPG-2026-0001"), "КП № EPG-2026-0001");
});

test("kpLine: номер числом (автонумерация) приводится к строке", () => {
  assert.equal(EPRightPanel.kpLine(123), "КП № 123");
});

test("kpLine: номера нет → пустая строка (строки в блоке не будет)", () => {
  assert.equal(EPRightPanel.kpLine(""), "");
  assert.equal(EPRightPanel.kpLine(null), "");
  assert.equal(EPRightPanel.kpLine(undefined), "");
});

test("kpLine: пробельный номер считается пустым (trim), не «КП № »", () => {
  assert.equal(EPRightPanel.kpLine("   "), "");
  assert.equal(EPRightPanel.kpLine("  7  "), "КП № 7", "крайние пробелы срезаются, значимый номер остаётся");
});
