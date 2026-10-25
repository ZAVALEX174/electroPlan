/* Конвертация HEIC → JPEG (js/heicImport.js) — ОДНО место на план и бланк КП (§7.1).
   Декодер (vendor/heic-to) требует браузера (Worker/canvas), поэтому здесь без браузера проверяем:
   1) вендорный файл декодера, который модуль грузит по жёсткому пути, физически на диске и не пуст
      (его отсутствие ломало бы HEIC так же, как отсутствие pdf.js ломало PDF);
   2) модуль экспортируется в Node (двойной экспорт) и даёт обе функции конверсии + качество/путь;
   3) загрузка декодера ЛЕНИВАЯ: на require ни одного обращения к сети/document нет — реальный
      маршрут HEIC и качество JPEG покрыты в planImport.test.js (заглушка) и браузерном сценарии.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     (а) сменить/опечатать VENDOR_SCRIPT на несуществующий путь → красит «вендорный декодер на диске»;
     (б) убрать module.exports → красит «модуль требуется в Node и даёт обе функции».
   Запуск: node --test tests/heicImport.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js", "heicImport.js"), "utf8");
const EPHeicImport = require("../js/heicImport.js");

test("вендорный декодер HEIC, который грузит heicImport.js, лежит на диске и не пуст", () => {
  // Путь берём прямо из исходника (все ссылки vendor/…), чтобы тест не отстал при переименовании.
  const refs = new Set(SRC.match(/vendor\/[\w./-]+/g) || []);
  assert.ok(refs.size >= 1, "в модуле должна быть ссылка на vendor/ с декодером");
  for (const ref of refs) {
    const full = path.join(ROOT, ref);
    assert.ok(fs.existsSync(full), `нет вендорного ресурса: ${ref}`);
    assert.ok(fs.statSync(full).size > 100000, `вендорный декодер подозрительно мал: ${ref}`);
  }
  // Лицензия рядом с кодом (как у xlsx) — обязательна для LGPL-библиотеки в репозитории.
  assert.ok(fs.existsSync(path.join(ROOT, "vendor", "heic-to", "LICENSE")), "рядом с декодером нет LICENSE");
});

test("модуль требуется в Node и даёт обе функции конверсии + качество/путь", () => {
  assert.equal(typeof EPHeicImport.toJpegBlob, "function", "есть HEIC→JPEG Blob");
  assert.equal(typeof EPHeicImport.toJpegDataUrl, "function", "есть HEIC→JPEG data-URL");
  assert.equal(EPHeicImport.JPEG_QUALITY, 0.92, "качество JPEG — полное, ужатие делает следующий шаг");
  assert.ok(/vendor\/heic-to\//.test(EPHeicImport.VENDOR_SCRIPT), "путь к декодеру указывает в vendor/heic-to");
});
