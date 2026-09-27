/* СТРУКТУРНЫЙ страж ГРАНИЦЫ «модуль-фабрика ↔ app.js» для кусков, вынесенных из app.js по И1
   (js/postBuilder.js: EPPostBuilder.attach(ctx) → {…}). Ловит РОВНО тот класс дефекта, что оборвал
   открытие поста: функция builderRoomFilter переехала в модуль, а оставшийся в app.js общий
   frameFacingHintText продолжал её звать — в браузере ReferenceError, но 1535 юнит-тестов зелёные,
   потому что чистую логику они гоняют по vm-вырезкам, а СБОРКУ модуля с app.js — нет.

   ТРИ ПРОВЕРКИ (симметрия «туда-обратно» + провязка вызова), по смыслу разведскриптов reverse/forward:
     (a) каждое имя, объявленное в ТЕЛЕ фабрики модуля и всё ещё упомянутое в app.js, обязано и
         возвращаться из attach, и деструктурироваться в app.js (иначе app.js зовёт то, чего у него нет);
     (b) каждое top-level-имя app.js, использованное в модуле (в т.ч. ВНУТРИ ${…} шаблонных строк),
         обязано прийти из ctx или быть объявлено самим модулем (иначе модуль читает лексику app.js,
         которой в нём нет);
     (c) каждое имя из `const {…}=ctx` обязано реально передаваться в вызов attach({…}) (иначе имя в
         модуле — undefined; forward это не ловит: неиспользуемое undefined молчит).
   Комментарии не считаем — источники берём стрипнутыми (stripComments, как все *Wiring-тесты); строки
   и шаблоны НЕ трогаем, поэтому обращение внутри ${…} остаётся видимым проверке (b).

   Проверка сравнивает ТЕКСТ, а не поведение: она дёшева и включается для ЛЮБОГО будущего attach-модуля
   дописью строки в FACTORY_MODULES (плюс файл в SOURCE_FILES стенда). Самопроверка ниже гоняет анализ на
   ФИКСТУРНЫХ строках — иначе «страж», который никогда не краснеет, прошёл бы как зелёный.

   МУТАЦИОННАЯ ТАБЛИЦА (node tools/qa/mutate.cjs):
     убрать builderRoomFilter из `return {…}` (postBuilder.js)              → красит §(a);
     убрать builderRoomFilter из деструктуризации attach (app.js)          → красит §(a);
     убрать frameFacingHintText из объекта attach({…}) (app.js)            → красит §(c).
   Запуск: node --test tests/postBuilderModuleBoundary.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const { stripComments } = require("./helpers/stripComments.js");

/* Модули-фабрики, вынесенные из app.js: имя файла (обязано быть в SOURCE_FILES стенда), window-namespace
   и имя фабрики. Пока один — postBuilder; следующий attach-вынос добавляется строкой сюда. */
const FACTORY_MODULES = [
  { file: "postBuilder.js", namespace: "EPPostBuilder", factoryFn: "attach" }
];

/* Разбор списка имён из `{a, b: c, …}`: возвращает пары {key, local} (key — свойство, local — связанное
   имя). Rest (`...x`) вне модели «имя за именем» — пропускаем. Границы проекта — шорткат (key===local),
   но пары держим на случай алиаса, чтобы анализ не соврал молча. */
function parseNames(block) {
  return block.split(",").map(s => s.trim()).filter(Boolean)
    .filter(t => !t.startsWith("..."))
    .map(t => { const i = t.indexOf(":"); return i < 0 ? { key: t, local: t } : { key: t.slice(0, i).trim(), local: t.slice(i + 1).trim() }; });
}
function group1(re, src, what) { const m = re.exec(src); assert.ok(m, "не нашёл в источнике: " + what); return m[1]; }
function esc(name) { return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* Имена, ОБЪЯВЛЕННЫЕ в теле фабрики (между её сигнатурой и её `return {…}`) — только они кандидаты на
   возврат. Берём объявления С НАЧАЛА СТРОКИ (в attach-модуле функции намеренно на нулевой колонке).
   Имя самой фабрики и хвост модуля (`const api=…` ПОСЛЕ return) сюда не попадают. */
function factoryDeclared(moduleSrc, factoryFn) {
  const sig = new RegExp("^(?:async\\s+)?function\\s+" + esc(factoryFn) + "\\s*\\(", "m").exec(moduleSrc);
  assert.ok(sig, "не нашёл фабрику " + factoryFn + "( в модуле");
  const ret = /^return\s*\{/m.exec(moduleSrc.slice(sig.index));
  assert.ok(ret, "не нашёл `return {…}` фабрики " + factoryFn);
  const body = moduleSrc.slice(sig.index, sig.index + ret.index);
  const names = new Set();
  for (const m of body.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)) names.add(m[1]);
  for (const m of body.matchAll(/^(?:const|let|var)\s+(\w+)\s*=/gm)) names.add(m[1]);
  names.delete(factoryFn);
  return names;
}
function keysOf(block) { return new Set(parseNames(block).map(p => p.key)); }
function localsOf(block) { return new Set(parseNames(block).map(p => p.local)); }

function returnedKeys(moduleSrc) { return keysOf(group1(/^return\s*\{([^}]*)\};?/m, moduleSrc, "return фабрики")); }
function destructuredLocals(appSrc, ns) { return localsOf(group1(new RegExp("const\\s*\\{([^}]*)\\}\\s*=\\s*" + esc(ns) + "\\.attach\\s*\\("), appSrc, "деструктуризация attach в app.js")); }
function ctxKeys(moduleSrc) { return keysOf(group1(/const\s*\{([\s\S]*?)\}\s*=\s*ctx\s*;/, moduleSrc, "`const {…}=ctx;` в модуле")); }
function ctxLocals(moduleSrc) { return localsOf(group1(/const\s*\{([\s\S]*?)\}\s*=\s*ctx\s*;/, moduleSrc, "`const {…}=ctx;` в модуле")); }
function providedKeys(appSrc, ns) { return keysOf(group1(new RegExp(esc(ns) + "\\.attach\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)"), appSrc, "вызов " + ns + ".attach({…})")); }

/* Все объявления модуля (вложенные тоже) — их имена «свои», обращение к ним не течёт из app.js. */
function moduleOwn(moduleSrc) { const own = new Set(); for (const m of moduleSrc.matchAll(/(?:function|const|let|var)\s+(\w+)/g)) own.add(m[1]); return own; }
/* Top-level-имена app.js: function-декларации, top-level const/let/var и локали top-level деструктуризаций. */
function appTopLevel(appSrc) {
  const names = new Set();
  for (const m of appSrc.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)) names.add(m[1]);
  for (const m of appSrc.matchAll(/^(?:const|let|var)\s+(\w+)\s*=/gm)) names.add(m[1]);
  for (const m of appSrc.matchAll(/^const\s*\{([^}]*)\}\s*=/gm)) for (const p of parseNames(m[1])) names.add(p.local);
  return names;
}
/* Идентификаторы, к которым обращается текст (не как `.prop`): регэксп сканирует и содержимое ${…}. */
function usedIdentifiers(src) { const used = new Set(); for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) used.add(m[2]); return used; }
function referenced(name, src) { return new RegExp("(^|[^.\\w$])" + esc(name) + "(?![\\w$])").test(src); }

/* Ядро стража. На вход — УЖЕ стрипнутые (без комментариев) исходники app.js и модуля. Возвращает три
   списка нарушений; пустые списки = граница цела. */
function analyze(appSrc, moduleSrc, ns, factoryFn) {
  const declared = factoryDeclared(moduleSrc, factoryFn);
  const returned = returnedKeys(moduleSrc);
  const destructured = destructuredLocals(appSrc, ns);
  const expectFromCtx = ctxKeys(moduleSrc);
  const ownFromCtx = ctxLocals(moduleSrc);
  const provided = providedKeys(appSrc, ns);
  const own = moduleOwn(moduleSrc);
  const appNames = appTopLevel(appSrc);
  const used = usedIdentifiers(moduleSrc);

  const missingReturns = [];   // (a) app.js зовёт имя фабрики, но оно не возвращено/не деструктурировано
  for (const n of declared) if (referenced(n, appSrc) && !(returned.has(n) && destructured.has(n))) missingReturns.push(n);
  const leaks = [];            // (b) модуль читает top-level-имя app.js, не пришедшее из ctx и не своё
  for (const n of used) if (appNames.has(n) && !ownFromCtx.has(n) && !own.has(n)) leaks.push(n);
  const missingCtx = [];       // (c) имя из const {…}=ctx не передано в attach({…})
  for (const n of expectFromCtx) if (!provided.has(n)) missingCtx.push(n);
  return { missingReturns, leaks, missingCtx };
}

/* ── Настоящие файлы: граница цела ── */
for (const mod of FACTORY_MODULES) {
  const appSrc = stand.sourceOf("app.js");        // стрипнутый исходник app.js
  const moduleSrc = stand.sourceOf(mod.file);     // стрипнутый исходник модуля
  const r = analyze(appSrc, moduleSrc, mod.namespace, mod.factoryFn);

  test(`§(a) ${mod.file}: имена фабрики, что зовёт app.js, — возвращены и деструктурированы`, () => {
    assert.deepEqual(r.missingReturns, [],
      "app.js обращается к имени из " + mod.file + ", не пришедшему из " + mod.namespace + ".attach(): " + r.missingReturns.join(", "));
  });
  test(`§(b) ${mod.file}: лексика app.js в модуле (в т.ч. в ${'${…}'}) приходит из ctx или объявлена в модуле`, () => {
    assert.deepEqual(r.leaks, [],
      mod.file + " читает top-level-имя app.js, не проброшенное через ctx: " + r.leaks.join(", "));
  });
  test(`§(c) ${mod.file}: каждое имя из const {…}=ctx реально передано в ${mod.namespace}.attach({…})`, () => {
    assert.deepEqual(r.missingCtx, [],
      mod.file + " деструктурирует из ctx имя, которого нет в вызове attach: " + r.missingCtx.join(", "));
  });
}

/* ── Самопроверка стража на фикстурах: без неё «страж», не краснеющий никогда, был бы зелёным даром ── */
const cleanApp = "const {openThing}=EPDemo.attach({esc});\nfunction useIt(){ return openThing(); }";
const cleanMod = [
  "(() => {", "function attach(ctx){", "const {esc}=ctx;",
  "function openThing(){ return esc('x'); }", "return {openThing};", "}",
  "const api={attach};", "})();"
].join("\n");

test("самопроверка: корректная связка НЕ краснит ни одну из трёх проверок", () => {
  const r = analyze(stripComments(cleanApp), stripComments(cleanMod), "EPDemo", "attach");
  assert.deepEqual([r.missingReturns, r.leaks, r.missingCtx], [[], [], []], "чистая фикстура не должна давать нарушений");
});

test("самопроверка §(a): app.js зовёт имя модуля, НЕ возвращённое attach → краснит", () => {
  const app = "const {openThing}=EPDemo.attach({esc});\nfunction useIt(){ return helper()+1; }";
  const mod = [
    "(() => {", "function attach(ctx){", "const {esc}=ctx;",
    "function helper(){ return esc('x'); }",         // объявлена в фабрике
    "function openThing(){ return helper(); }",
    "return {openThing};",                            // helper НЕ возвращён
    "}", "const api={attach};", "})();"
  ].join("\n");
  const r = analyze(stripComments(app), stripComments(mod), "EPDemo", "attach");
  assert.ok(r.missingReturns.includes("helper"),
    "helper объявлен в фабрике и зовётся из app.js, но не возвращён — обязан попасть в missingReturns");
});

test("самопроверка §(b): модуль использует имя app.js внутри ${'${…}'}, НЕ пришедшее из ctx → краснит", () => {
  const app = "function roomLabel(){ return 'R'; }\nconst {openThing}=EPDemo.attach({esc});";
  const mod = [
    "(() => {", "function attach(ctx){", "const {esc}=ctx;",           // roomLabel из ctx НЕ пришёл
    "function openThing(){ return `<b>${roomLabel()}</b>`; }",         // обращение ИМЕННО внутри ${…}
    "return {openThing};", "}", "const api={attach};", "})();"
  ].join("\n");
  const r = analyze(stripComments(app), stripComments(mod), "EPDemo", "attach");
  assert.ok(r.leaks.includes("roomLabel"),
    "roomLabel — top-level app.js, использован в ${…} модуля и не проброшен через ctx — обязан попасть в leaks");
});

test("самопроверка §(c): имя из const {…}=ctx НЕ передано в attach({…}) → краснит", () => {
  const app = "const {openThing}=EPDemo.attach({esc});";                // money НЕ передан
  const mod = [
    "(() => {", "function attach(ctx){", "const {esc,money}=ctx;",      // money ждём из ctx
    "function openThing(){ return esc('x'); }", "return {openThing};", "}",
    "const api={attach};", "})();"
  ].join("\n");
  const r = analyze(stripComments(app), stripComments(mod), "EPDemo", "attach");
  assert.ok(r.missingCtx.includes("money"),
    "money ждётся из ctx, но не передан в attach — обязан попасть в missingCtx");
});
