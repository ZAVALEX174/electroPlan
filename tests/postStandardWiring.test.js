/* ПРОВЯЗКА Б8-д (переключатели расположения/стандарта в окне поста) + СТРАЖ ПОВТОРНОГО ОБЪЯВЛЕНИЯ.

   ЗАЧЕМ СТРАЖ. app.js и каждый attach-модуль — своя IIFE, поэтому одноимённые top-level-объявления в
   РАЗНЫХ файлах друг другу не мешают (разные области). Но ВНУТРИ attach-модуля имя, взятое из ctx
   деструктуризацией (`const {STANDARD_GENITIVE,…}=ctx;`), и top-level `const STANDARD_GENITIVE=…` в теле
   того же attach — это ДВА const в ОДНОЙ области → SyntaxError «Identifier has already been declared», и
   файл не грузится вовсе. Ровно это и случилось в Б8-д (постройщик объявил локальную STANDARD_GENITIVE
   рядом с пришедшей из ctx). Юнит-тесты это не ловят: appStand режет ОТДЕЛЬНЫЕ функции в vm, а не грузит
   файл целиком; `node --check` ловит, но его прогон не входит в `npm test`. Поэтому держим страж в тестах:
   каждый затронутый Б8-д файл обязан КОМПИЛИРОВАТЬСЯ как единое целое (new vm.Script парсит без исполнения
   — для SyntaxError исполнять не нужно), а внутри postBuilder.js множество ctx-имён обязано не пересекаться
   с top-level-именами тела attach.

   ПРОВЯЗКА. Нажатия на видимые переключатели (#postOrientMode/#postStandardMode) и условная запись
   standardChoice при сохранении — текстовые *Wiring-проверки (как frameOrientationWiring): ловят удаление
   строки связки, из-за которой кнопка молча перестаёт что-либо делать. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripComments } = require("./helpers/stripComments.js");

const JS_DIR = path.join(__dirname, "..", "js");
const rawOf = file => fs.readFileSync(path.join(JS_DIR, file), "utf8");
const strippedOf = file => stripComments(rawOf(file));

/* ── СТРАЖ ПОВТОРНОГО ОБЪЯВЛЕНИЯ: файлы Б8-д компилируются целиком ────────────────────────────── */
for (const file of ["app.js", "postBuilder.js", "postStandard.js"]) {
  test(`${file} компилируется целиком (нет повторного объявления/иной SyntaxError при загрузке)`, () => {
    assert.doesNotThrow(() => new vm.Script(rawOf(file), { filename: file }),
      `${file} не парсится — браузер не загрузит файл, окно поста не откроется`);
  });
}

/* Самопроверка механизма: new vm.Script ДЕЙСТВИТЕЛЬНО краснеет на коллизии, которую мы ловим, — иначе
   зелёный выше ничего не значит (повтор того же const в одной области, как ctx-имя + локальный const). */
test("самопроверка стража: повторный const в одной области даёт SyntaxError", () => {
  assert.throws(() => new vm.Script("(function(){ const X=ctx; const X=1; })"),
    /already been declared|has already/i,
    "new vm.Script обязан краснеть на повторном объявлении — иначе страж бесполезен");
});

/* В postBuilder.js имена из `const {…}=ctx;` не должны пересекаться с top-level-объявлениями тела attach:
   именно пересечение и даёт SyntaxError выше. Точечная проверка поверх общего компилятора — называет
   виновника по имени, когда он снова появится. */
test("postBuilder.js: ни одно ctx-имя не переобъявлено top-level в теле attach", () => {
  const src = strippedOf("postBuilder.js");
  const ctxBlock = /const\s*\{([\s\S]*?)\}\s*=\s*ctx\s*;/.exec(src);
  assert.ok(ctxBlock, "не нашёл `const {…}=ctx;` в postBuilder.js");
  const ctxNames = new Set(ctxBlock[1].split(",").map(s => s.trim()).filter(Boolean)
    .map(t => { const i = t.indexOf(":"); return (i < 0 ? t : t.slice(i + 1)).trim(); }));
  /* Тело attach: от сигнатуры до `return {…}` фабрики (хвост модуля `const api=…` после return — вне). */
  const sig = /^function\s+attach\s*\(/m.exec(src);
  assert.ok(sig, "не нашёл attach( в postBuilder.js");
  const ret = /^return\s*\{/m.exec(src.slice(sig.index));
  const body = src.slice(sig.index, sig.index + ret.index);
  const topLevel = new Set();
  for (const m of body.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)) topLevel.add(m[1]);
  for (const m of body.matchAll(/^(?:const|let|var)\s+(\w+)\s*=/gm)) topLevel.add(m[1]);
  const clash = [...topLevel].filter(n => ctxNames.has(n));
  assert.deepEqual(clash, [],
    "top-level в теле attach переобъявляет ctx-имя (SyntaxError при загрузке): " + clash.join(", "));
});

/* ── ПРОВЯЗКА ПЕРЕКЛЮЧАТЕЛЕЙ И СОХРАНЕНИЯ (текст postBuilder.js, без комментариев) ─────────────── */
const PB = strippedOf("postBuilder.js");

test("нажатие по #postOrientMode зовёт toggleFrameOrientation (вертикально = data-orient 'vertical')", () => {
  assert.match(PB, /#postOrientMode[^]*?toggleFrameOrientation\(\s*b\.dataset\.orient\s*===\s*"vertical"\s*\)/,
    "кнопки расположения должны звать ту же toggleFrameOrientation (логика Б8 не дублируется)");
});

test("нажатие по #postStandardMode зовёт toggleStandard(data-standard)", () => {
  assert.match(PB, /#postStandardMode[^]*?toggleStandard\(\s*b\.dataset\.standard\s*\)/,
    "кнопки стандарта должны звать toggleStandard");
});

test("savePostBuilder пишет standardChoice в белый список УСЛОВНО (только IT/DE)", () => {
  assert.match(PB, /state\.builder\.standardChoice\s*===\s*"IT"\s*\|\|\s*state\.builder\.standardChoice\s*===\s*"DE"\s*\)\s*base\.standardChoice\s*=\s*state\.builder\.standardChoice/,
    "у старого/нетронутого поля не должно появляться — запись только при явном выборе");
});

test("openPostBuilder читает src.standardChoice в черновик (иначе выбор терялся бы при открытии)", () => {
  assert.match(PB, /state\.builder\.standardChoice\s*=\s*\(src\.standardChoice\s*===\s*"IT"\s*\|\|\s*src\.standardChoice\s*===\s*"DE"\)\s*\?\s*src\.standardChoice\s*:\s*null/,
    "черновик обязан поднимать сохранённый standardChoice, иначе пул окна разойдётся с накладкой");
});

test("builderRoomFilter переопределяет пул стандартом только при явном выборе (IT/DE), иначе прежний", () => {
  assert.match(PB, /const\s+sc\s*=\s*state\.builder\.standardChoice;\s*return\s*\(sc\s*===\s*"IT"\s*\|\|\s*sc\s*===\s*"DE"\)\s*\?\s*\{\s*\.\.\.base\s*,\s*standard\s*:\s*sc\s*\}\s*:\s*base/,
    "без выбора стандарта пул строится по комнате, как прежде");
});
