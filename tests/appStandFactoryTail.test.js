/* З12 — СТРАЖ ОБРЫВА ВЫРЕЗКИ НА КОНЦЕ МОДУЛЯ-ФАБРИКИ (tests/helpers/appStand.js).

   appStand.functionSource вырезает текст функции «до следующего \nfunction», а у ПОСЛЕДНЕЙ функции
   тела фабрики attach такого соседа нет: за ней в файле идут только `return {…};` фабрики, закрывающая
   `}` attach, `const api=…` и `})();`. Прежнее правило «нет соседа → до конца файла» затягивало этот
   хвост в вырезку → SyntaxError в vm при ПЕРВОМ же поведенческом тесте на такую функцию. Фолбэк
   functionBodyEnd (обрыв по балансу фигурных скобок) это лечит; appStandMultiFile.test.js держит его на
   СИНТЕТИЧЕСКОМ фикстуре, а здесь мы фиксируем это на РЕАЛЬНЫХ модулях и стережём мутацией — иначе
   регресс всплыл бы не в тесте стенда, а глухим падением первого же теста-потребителя.

   Держим два инварианта:
     · последняя функция attach КАЖДОГО модуля-фабрики вырезается валидным JS (компилируется в vm);
     · для ВСЕХ прочих функций вырезка ПОБАЙТНО совпадает с до-правочной («до соседа / до EOF») — фолбэк
       не смеет менять ни одной вырезки, у которой есть `\nfunction`-сосед: на смежных top-level const
       между функциями держатся closePostBuilderWiring (ESC_CONFIRM_MS), _wallScope, PLAN_VIS_* (см.
       шапку tests/helpers/appStand.js и отчёты И1 в HANDOFF за 27–28.09).
   Запуск: node --test tests/appStandFactoryTail.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");
const { stripComments } = require("./helpers/stripComments.js");

const JS_DIR = path.join(__dirname, "..", "js");

/* Последняя функция тела фабрики attach в каждом из пяти модулей И1 — у неё нет `\nfunction`-соседа,
   поэтому её вырезка идёт через фолбэк functionBodyEnd. Список сверен побайтным тестом ниже: это ровно
   функции, чья до-правочная вырезка тянула хвост модуля `})();`. */
const FACTORY_LAST = [
  ["postBuilder.js", "installSheetForBuilder"],
  ["rooms.js", "dragVertex"],
  ["docs.js", "generateCommercialOffer"],
  ["canvasInput.js", "onSpaceKeydown"],
  ["roomDetect.js", "buildRoomsFromLines"]
];

/* До-правочная functionSource: «до следующего \nfunction, иначе до конца файла». Дословная копия
   правила, действовавшего до фолбэка functionBodyEnd, — эталон для проверки побайтной неизменности.
   Тот же locate-регэксп, что в стенде; при ОДНОМ источнике .exec берёт первое (единственное) объявление. */
function preFixCut(src, name) {
  const m = new RegExp("\\b(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(src);
  const rest = src.slice(m.index);
  const next = /\n(?:async\s+)?function\s+/.exec(rest.slice(1));
  const nextIdx = next ? next.index + 1 : -1;
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest.slice(0);   // нет соседа → до EOF (старое поведение)
}

/* Главный инвариант З12: у КАЖДОГО модуля-фабрики последняя функция attach вырезается компилируемым JS.
   Под мутацией (functionBodyEnd → до EOF) вырезка тянет `})();`, new vm.Script падает — тест краснеет. */
for (const [file, name] of FACTORY_LAST) {
  test(`стенд-З12: последняя функция attach в ${file} (${name}) вырезается компилируемым JS`, () => {
    const cut = stand.functionSource(name);
    assert.ok(cut.startsWith("function " + name), "вырезка начинается с самой функции, без хвоста соседа");
    assert.doesNotMatch(cut, /\}\)\(\)/, "закрытие IIFE `})()` НЕ попало в вырезку");
    assert.doesNotMatch(cut, /const api\s*=/, "экспорт модуля НЕ попал в вырезку");
    assert.doesNotThrow(() => new vm.Script(cut),
      `вырезка ${name} обязана быть валидным JS — иначе SyntaxError в vm при первом поведенческом тесте`);
  });
}

/* Побайтная неизменность на РЕАЛЬНЫХ файлах: фолбэк укорачивает РОВНО последнюю функцию каждого файла,
   все прочие вырезки остаются прежними до байта. Каждый файл читаем отдельным источником (locate без
   коллизий имён между файлами), сверяем текущую functionSource с до-правочной preFixCut. */
test("стенд-З12: фолбэк меняет ТОЛЬКО последнюю функцию каждого файла; прочие вырезки побайтно прежние", () => {
  let total = 0, same = 0;
  const changed = [];
  const expectedLast = new Set();
  for (const file of stand.SOURCE_FILES) {
    const src = stripComments(fs.readFileSync(path.join(JS_DIR, file), "utf8"));
    const one = stand.forSources([{ file, src }]);
    const names = [...new Set(
      [...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(mm => mm[1])
    )];
    assert.ok(names.length > 0, file + ": не нашёл ни одной функции 0-й колонки");
    expectedLast.add(file + "::" + names[names.length - 1]);   // последняя объявленная — кандидат на фолбэк
    for (const name of names) {
      total++;
      const now = one.functionSource(name);
      const was = preFixCut(src, name);
      if (now === was) { same++; continue; }
      changed.push(file + "::" + name);
      assert.doesNotThrow(() => new vm.Script(now), `новая вырезка ${file}::${name} обязана компилироваться`);
      assert.throws(() => new vm.Script(was), `до-правочная вырезка ${file}::${name} обязана падать (тянула хвост модуля)`);
    }
  }
  assert.deepEqual(new Set(changed), expectedLast,
    "расходятся с до-правкой РОВНО последние-в-файле функции — ни одной лишней, ни одной пропущенной");
  assert.equal(same, total - changed.length, "все прочие вырезки побайтно совпали с до-правкой");
});

/* Фикстура фабрики (дубль реальной раскладки в миниатюре): последняя функция исполняется в vm и
   считает верно; непоследняя — побайтно равна до-правке и по-прежнему тянет смежный top-level const. */
test("стенд-З12: на фикстуре фабрики — последняя исполняется в vm, непоследняя побайтно = до-правке", () => {
  const src = [
    "(() => {",
    '"use strict";',
    "function attach(ctx){",
    "const {a}=ctx;",
    "function first(){ return a+1; }",
    "const GAP=7;",                                    // смежный const — обязан остаться в вырезке first (как ESC_CONFIRM_MS)
    "function last(){ const s=\"}\"; return `x${a}y`+s; }",
    "return {first,last};",
    "}",
    "const api={attach};",
    "})();",
    ""
  ].join("\n");
  const s = stand.forSources([{ file: "m.js", src }]);

  const firstCut = s.functionSource("first");
  assert.equal(firstCut, preFixCut(src, "first"), "непоследняя функция: фолбэк не изменил вырезку ни на байт");
  assert.match(firstCut, /const GAP=7;/, "смежный top-level const остаётся в вырезке непоследней функции");

  const lastCut = s.functionSource("last");
  assert.notEqual(lastCut, preFixCut(src, "last"), "последняя функция: фолбэк обязан укоротить вырезку");
  assert.throws(() => new vm.Script(preFixCut(src, "last")), "до-правочная вырезка последней функции падала в vm");
  const last = s.run("last", { a: 5 });
  assert.equal(last(), "x5y}", "последняя исполняется: строка с `}` и шаблон `${}` не сбили баланс скобок");
});
