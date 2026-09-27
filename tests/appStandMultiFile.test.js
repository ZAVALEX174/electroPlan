/* Тест САМОГО СТЕНДА (И1, шаг 1): appStand ищет функции/константы не в одном app.js, а по СПИСКУ
   файлов (app.js + модули, вынесенные из него по разделу И). Ловим две мутации стенда:
     · «стенд не видит второй файл» — тогда функция, переехавшая в модуль, перестала бы вырезаться
       (краснит тест «функция из второго источника находится/исполняется»);
     · «имя в двух файлах выбирается молча» — недоудалённый после выноса дубль в app.js прошёл бы
       незамеченным (краснит тест двусмысленности).
   Работаем на ФИКСТУРНЫХ источниках (in-memory) через stand.forSources — без временных файлов в js/.
   Запуск: node --test tests/appStandMultiFile.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

test("стенд-1: функция из ВТОРОГО источника находится, вырезается и исполняется", () => {
  const s = stand.forSources([
    { file: "a.js", src: "function alpha(){return 1}\n" },
    { file: "b.js", src: "function beta(){return 2}\n" }   // beta живёт только во втором файле
  ]);
  assert.match(s.functionSource("beta"), /function beta\(\)\{return 2\}/,
    "текст функции берётся из второго источника (мутация «видим только первый файл» краснит здесь)");
  const beta = s.run("beta", {});   // run возвращает саму функцию — вызываем и сверяем результат
  assert.equal(beta(), 2, "функция из второго источника исполняется в vm");
});

test("стенд-1: run собирает имена из РАЗНЫХ файлов в одну vm-программу (общий контекст)", () => {
  const s = stand.forSources([
    { file: "a.js", src: "function alpha(){return 10}\n" },
    { file: "b.js", src: "function beta(){return alpha()+5}\n" }   // beta зовёт alpha из другого файла
  ]);
  const beta = s.run(["alpha", "beta"], {});
  assert.equal(beta(), 15, "функции из разных файлов делят один лексический контекст одной программы");
});

test("стенд-1: runNamed выбирает functionSource/constSource по НАСТОЯЩЕМУ виду объявления в любом файле", () => {
  const s = stand.forSources([
    { file: "a.js", src: "function alpha(){return two*3}\n" },
    { file: "b.js", src: "const two=2;\n" }   // top-level const-стрелка во втором файле
  ]);
  const alpha = s.runNamed(["two", "alpha"], {});
  assert.equal(alpha(), 6, "const из второго файла подхвачен constSource, функция — functionSource");
});

test("стенд-1: имя-ФУНКЦИЯ в ДВУХ файлах — громкая ошибка двусмысленности с именами файлов", () => {
  const s = stand.forSources([
    { file: "a.js", src: "function dup(){return 1}\n" },
    { file: "b.js", src: "function dup(){return 2}\n" }
  ]);
  assert.throws(() => s.functionSource("dup"), /двусмысленн/i,
    "дубль имени обязан падать, а не выбирать первый молча");
  assert.throws(() => s.functionSource("dup"), /a\.js/, "сообщение называет первый файл-источник дубля");
  assert.throws(() => s.functionSource("dup"), /b\.js/, "сообщение называет второй файл-источник дубля");
});

test("стенд-1: top-level const в ДВУХ файлах — тоже двусмысленность", () => {
  const s = stand.forSources([
    { file: "a.js", src: "const k=1;\n" },
    { file: "b.js", src: "const k=2;\n" }
  ]);
  assert.throws(() => s.constSource("k"), /двусмысленн/i, "дубль const обязан падать");
});

test("стенд-1: отсутствующее имя — провал с перечнем просмотренных файлов", () => {
  const s = stand.forSources([
    { file: "a.js", src: "function alpha(){}\n" },
    { file: "b.js", src: "function beta(){}\n" }
  ]);
  assert.throws(() => s.functionSource("missing"), /a\.js.*b\.js|b\.js.*a\.js/s,
    "сообщение об отсутствии называет файлы, где искали");
});

test("стенд-1: реальный стенд по умолчанию читает app.js (SRC — его стрипнутый исходник)", () => {
  assert.ok(stand.SOURCE_FILES.includes("app.js"), "app.js остаётся в списке источников");
  assert.match(stand.SRC, /function\s+renderProperties\s*\(/,
    "SRC — исходник app.js (обратная совместимость структурных тестов)");
});
