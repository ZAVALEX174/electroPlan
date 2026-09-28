/* ОБЩИЙ СТЕНД поведенческих тестов над js/app.js — единственная копия «исполнить настоящий
   исходник app.js в vm на DOM-шиме».

   ЗАЧЕМ ОДИН НА ВСЕХ. app.js — монолит-оркестратор (state + DOM), в node не грузится; PLAN 2.1
   вынес наружу только ЧИСТУЮ логику, а слой связок остался здесь и даёт почти все дефекты
   (§7.1 HANDOFF). Структурные *Wiring-тесты сверяют ТЕКСТ и ловят удаление строки, но не смену
   смысла. Поэтому связки покрывают ПОВЕДЕНЧЕСКИ: вырезаем ИСХОДНЫЙ ТЕКСТ нужной функции из app.js
   и исполняем его в изолированном vm-контексте, куда кладём ровно те имена, что функция берёт из
   лексики app.js (state, DOM-узлы, вынесенные namespace'ы). Раньше этот стенд собирали заново в
   КАЖДОМ тесте и трижды во временных папках проверяющие — копии расходились и давали ложные
   выводы. Держим стенд в ОДНОМ месте, как stripComments.

   ПОЧЕМУ СРАЗУ stripComments. Границу вырезания тела ищем по `\nfunction ` верхнего уровня; если
   такая строка попадётся ВНУТРИ комментария-соседа, сырой исходник обрубит тело раньше времени.
   Стрип комментариев (тот же, что у структурных тестов) снимает это и заодно защищает от
   «закомментированного» кода. Комментарии на исполнение не влияют — стрип может лишь убрать
   лишнее, но не подставить ложное поведение.

   КАК НАПИСАТЬ ПОВЕДЕНЧЕСКИЙ ТЕСТ ЗА ПЯТЬ СТРОК:
     const stand = require("./helpers/appStand.js");
     const EPRoomAssign = require("../js/roomAssign.js");
     const dom = stand.makeDom();                                   // DOM-шим ($/els)
     const render = stand.run(["orphanObjectsWarningText", "renderSummary"], {
       state, EPRoomAssign, $: dom.$, money: v => "m"+v, esc: String, ... });   // vm-контекст
     render();                                                       // исполнили настоящий app.js
     assert.match(dom.els.outsideRoomsStatus.textContent, /Вне помещений/);

   МНОГОФАЙЛОВЫЙ ПОИСК. Функцию ищем не в одном app.js, а по списку SOURCE_FILES (app.js + модули,
   вынесенные из него по И1). Имя, найденное сразу в двух файлах, — громкая ошибка двусмысленности
   (с именами файлов), а не тихий выбор первого. run/runNamed собирают имена из РАЗНЫХ файлов в одну
   vm-программу. SRC остаётся стрипнутым исходником ГЛАВНОГО файла (app.js) — на него завязаны
   структурные тесты app.js.

   ИНТЕРФЕЙС.
     stand.run(names, ctx)      — вырезать функции names (строка или массив в порядке зависимостей),
                                  исполнить в vm-контексте ctx и вернуть ПОСЛЕДНЮЮ по имени.
     stand.functionSource(name) — исходный текст одной функции (если нужен сырой доступ).
     stand.destructuredNames(ns)— имена из `const {…}=<ns>;` (проверка проброшенных алиасов).
     stand.forSources(sources)  — те же помощники над ПРОИЗВОЛЬНЫМ [{file, src}] (для теста стенда).
     stand.loadVimarCatalog()   — настоящий каталог VIMAR через window-шим.
   ШИМЫ (каждый честный — соблюдает спеку в том, на чём держатся находки):
     stand.makeDom({selects})   — реестр узлов по id ($); id из selects — <select> по спеке.
     stand.makeSelect()         — <select>: присвоение .value отсутствующей опции снимает выбор ("").
     stand.makeElement(over)    — узел (innerHTML/value/dataset/style/classList/обработчики).
     stand.makeClassList(init)  — classList поверх Set с browser-семантикой toggle(cls, force).
     stand.makeCanvas(nodes)    — canvas.querySelector, ЧЕСТНО разбирающий `.cls[data-attr="v"]`.
     stand.makeDocument()       — document.createElement → свежий makeElement.

   Стенд НЕ переписывает логику app.js: он её ИСПОЛНЯЕТ. Второй копии правил не заводит. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { stripComments } = require("./stripComments.js");

const JS_DIR = path.join(__dirname, "..", "..", "js");

/* Файлы-исходники, из которых стенд вырезает НАСТОЯЩИЙ текст функций/констант app.js. Пока app.js —
   монолит; по И1 (раздел И docs/ОСТАТОК-РАБОТ) из него по одному куску выносятся модули, и стенд
   обязан находить переехавшую функцию там, куда она уехала — сюда дописывают её файл (js/wallScope.js,
   js/postBuilder.js …). Имя ищется по ВСЕМ файлам списка; найденное сразу в двух — ГРОМКАЯ ошибка
   (двусмысленность, с именами файлов), а не тихий выбор первого: тихий выбор замаскировал бы
   недоудалённый после выноса дубль в app.js. Первый файл — главный: его стрипнутый текст
   экспортируется как SRC (на него завязаны структурные тесты app.js). */
const SOURCE_FILES = ["app.js", "postBuilder.js", "rooms.js", "docs.js", "canvasInput.js", "roomDetect.js"];

/* Конец тела функции по БАЛАНСУ ФИГУРНЫХ СКОБОК — фолбэк functionSource для ПОСЛЕДНЕЙ функции файла,
   у которой нет следующего `\nfunction`-соседа. Без него у функции внутри IIFE-модуля (js/postBuilder.js —
   вынос по И1) в вырезку попадал бы хвост модуля (`return {…}; } … })();`) и падал бы в vm синтаксической
   ошибкой. Идём от `{` тела и считаем скобки, ПРОПУСКАЯ строки '…' "…" и шаблоны `…${…}…` (в них скобки
   не считаются): стек mode держит вложенные ${ `…` }. Регэкс-литералы намеренно НЕ разбираем — фолбэк
   срабатывает только на последней функции модуля, а у неё (installSheetForBuilder/reportFailure) их нет;
   появится такая — её поведенческий тест упадёт громко (см. тест стенда appStandMultiFile). src начинается
   с `function`/`async function`, список параметров без строк и без `{`. Возвращает индекс СРАЗУ ЗА `}`. */
function functionBodyEnd(src) {
  let i = src.indexOf("(");
  for (let paren = 0; i < src.length; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")" && --paren === 0) { i++; break; }
  }
  while (i < src.length && src[i] !== "{") i++;   // `{` тела
  const modes = ["code"];       // стек: code | tpl | sq | dq
  const braces = [0];           // глубина {} для каждого code-контекста (тело + каждое ${…})
  for (; i < src.length; i++) {
    const c = src[i], mode = modes[modes.length - 1];
    if (mode === "sq") { if (c === "\\") i++; else if (c === "'") modes.pop(); continue; }
    if (mode === "dq") { if (c === "\\") i++; else if (c === '"') modes.pop(); continue; }
    if (mode === "tpl") {
      if (c === "\\") { i++; continue; }
      if (c === "`") { modes.pop(); continue; }
      if (c === "$" && src[i + 1] === "{") { modes.push("code"); braces.push(0); i++; continue; }
      continue;
    }
    if (c === "'") { modes.push("sq"); continue; }
    if (c === '"') { modes.push("dq"); continue; }
    if (c === "`") { modes.push("tpl"); continue; }
    if (c === "{") { braces[braces.length - 1]++; continue; }
    if (c === "}") {
      if (braces[braces.length - 1] > 0) {
        if (--braces[braces.length - 1] === 0 && modes.length === 1) return i + 1;   // конец тела
      } else { modes.pop(); braces.pop(); }   // `}` закрыл ${…} — назад в шаблон
    }
  }
  return src.length;
}

/* Стрипаем сразу весь файл: защита от закомментированного кода И от `\nfunction ` из комментария,
   который иначе обрубил бы вырезаемое тело раньше времени. Тот же стрип, что у структурных тестов. */
function readSources(files) {
  return files.map(name => ({
    file: name,
    src: stripComments(fs.readFileSync(path.join(JS_DIR, name), "utf8"))
  }));
}

/* Все текстовые помощники строим над ПРОИЗВОЛЬНЫМ набором источников {file, src} — фабрикой, чтобы
   тест самого стенда мог проверить многофайловый поиск и ловлю двойного имени на фикстурных
   источниках, без временных файлов в js/. Продакшен-стенд ниже строится над реальными SOURCE_FILES. */
function forSources(sources) {
  assert.ok(sources.length > 0, "forSources: нужен хотя бы один источник");
  const fileNames = sources.map(s => s.file).join(", ");

  /* Единственный источник, где встречается объявление name (его ловит re). re — без флага g:
     .exec от начала строки, берём совпадение ради .index. Нет ни в одном → провал «должно
     существовать» с перечнем файлов; в двух и больше → провал двусмысленности с их именами. */
  function locate(name, re, what) {
    const hits = [];
    for (const s of sources) {
      const m = re.exec(s.src);
      if (m) hits.push({ file: s.file, src: s.src, index: m.index });
    }
    assert.ok(hits.length > 0, what + " " + name + " должно существовать в одном из файлов: " + fileNames);
    assert.ok(hits.length === 1, what + " " + name + " объявлено сразу в нескольких файлах ("
      + hits.map(h => h.file).join(", ") + ") — двусмысленность, стенд не выбирает молча");
    return hits[0];
  }

  /* Есть ли где-нибудь в источниках function-декларация name (не const-стрелка). Нужно runNamed,
     чтобы выбрать functionSource/constSource по НАСТОЯЩЕМУ виду объявления, где бы тот ни жил. */
  function isFunction(name) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\b(?:async\\s+)?function\\s+" + safe + "\\s*\\(");
    return sources.some(s => re.test(s.src));
  }

  /* Исходник одной функции: от её объявления до следующего `\nfunction ` верхнего уровня В ТОМ ЖЕ
     файле. Между соседями только `}` и пустые строки — валидный JS. */
  function functionSource(name) {
    const hit = locate(name, new RegExp("\\b(?:async\\s+)?function\\s+" + name + "\\s*\\("), "функция");
    const rest = hit.src.slice(hit.index);
    /* restoreProject асинхронная: нельзя терять async перед function и нельзя
       прихватывать следующий async-блок вместе с соседней синхронной функцией. */
    const nextMatch = /\n(?:async\s+)?function\s+/.exec(rest.slice(1));
    const nextIdx = nextMatch ? nextMatch.index + 1 : -1;
    /* Есть следующий `\nfunction` — режем до него (между соседями только `}` и пустые строки: те
       же смежные const, что раньше, — ESC_CONFIRM_MS, builderDirty, — остаются в вырезке). Нет —
       это ПОСЛЕДНЯЯ функция файла: обрезаем по реальному концу тела, а не тянем хвост модуля. */
    return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest.slice(0, functionBodyEnd(rest));
  }

  /* Исходный текст top-level `const <name>=…;`-объявления. Симметричен functionSource, но часть
     логики живёт не в function-декларациях, а в одно-строчных const-стрелках верхнего уровня (uid,
     byKind, $, esc). Их functionSource не берёт (ищет `\nfunction`), а поведенческому тесту нужен
     НАСТОЯЩИЙ текст такой функции, а не рукописная копия: копия расходится с продакшеном молча —
     ослабление esc тогда не краснит ни один тест.
     Граница — КОНЕЦ СТРОКИ объявления: эти стрелки занимают ровно одну строку и кончаются на `;`.
     name может быть спецсимволом регэкспа ($) — экранируем его перед подстановкой. Вернувшийся текст
     исполняется как есть (`stand.constSource("esc")` + `\n;esc;` в vm вернёт саму функцию). */
  function constSource(name) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = locate(name, new RegExp("(?:^|\\n)const\\s+" + safe + "\\s*="), "top-level const");
    const src = hit.src;
    const start = hit.index + (src[hit.index] === "\n" ? 1 : 0);
    const end = src.indexOf("\n", start);
    return end >= 0 ? src.slice(start, end) : src.slice(start);
  }

  /* Полный текст МНОГОСТРОЧНОГО top-level `const <name>=…;`. constSource берёт ровно одну строку
     (uid/esc/byKind однострочные), но часть связок объявлена стрелкой на несколько строк — postDeps
     раскладывает объект зависимостей поста на три строки. Читаем блок от `const name=` до закрывающей
     `;` на НУЛЕВОЙ глубине скобок, пропуская строковые литералы (в них скобки/`;` не считаются). Тот
     же принцип, что у constSource: исполняем НАСТОЯЩИЙ текст, а не рукописную копию — копия postDeps
     молча разошлась бы с продакшеном, и подмена backlight на {enabled:false} не покраснела бы. */
  function constBlock(name) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = locate(name, new RegExp("(?:^|\\n)const\\s+" + safe + "\\s*="), "top-level const");
    const src = hit.src;
    const start = hit.index + (src[hit.index] === "\n" ? 1 : 0);
    let depth = 0, quote = null;
    for (let i = src.indexOf("=", start); i < src.length; i++) {
      const ch = src[i];
      if (quote) { if (ch === quote && src[i - 1] !== "\\") quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
      else if (ch === ";" && depth === 0) return src.slice(start, i + 1);
    }
    return assert.fail("не нашёл конец const " + name + " (нет `;` на нулевой глубине скобок)");
  }

  /* Имена, которые app.js достаёт деструктуризацией `const {…}=<ns>;`. Нужно, чтобы собрать контекст
     РОВНО из проброшенных имён и воспроизвести браузерный ReferenceError при забытом алиасе. Алиасные
     строки живут в ГЛАВНОМ файле (app.js) — ищем в нём (первый источник). */
  function destructuredNames(ns) {
    const primary = sources[0];
    const m = primary.src.match(new RegExp("const\\s*\\{([^}]*)\\}\\s*=\\s*" + ns + "\\s*;"));
    assert.ok(m, "в " + primary.file + " не нашлась строка алиасов `const {...}=" + ns + ";`");
    return m[1].split(",").map(s => s.trim()).filter(Boolean);
  }

  /* Исполнить одну или несколько функций в контексте ctx и вернуть ПОСЛЕДНЮЮ по имени. names — строка
     или массив (порядок = порядок объявления зависимостей). Имена могут жить в РАЗНЫХ файлах списка —
     их тексты собираются в ОДНУ vm-программу (общий лексический контекст: state, $, namespace'ы).
     Контекст создаётся здесь; свойства, дописанные в ctx до вызова, песочница видит. */
  function run(names, ctx) {
    const list = Array.isArray(names) ? names : [names];
    assert.ok(list.length > 0, "run: нужно хотя бы одно имя функции");
    const returned = list[list.length - 1];
    const code = list.map(functionSource).join("\n") + "\n;" + returned + ";";
    vm.createContext(ctx);
    return vm.runInContext(code, ctx);
  }

  /* Как run, но список смешанный: и function-декларации, и top-level const-стрелки. Нужно, когда
     проверяемая функция зовёт ДРУГУЮ настоящую функцию, а та замыкается на const-стрелку
     (openPostBuilder → builderSignature → builderWallType): все они обязаны делить ОДИН лексический
     контекст, поэтому режем их вместе и исполняем одной программой, а не копируем руками. Для каждого
     имени автоматически выбираем functionSource (есть `function имя(` где-либо в источниках) либо
     constSource. Имена по-прежнему собираются в одну программу — даже если разъехались по файлам. */
  function runNamed(names, ctx) {
    const list = Array.isArray(names) ? names : [names];
    assert.ok(list.length > 0, "runNamed: нужно хотя бы одно имя");
    const returned = list[list.length - 1];
    const code = list.map(name => isFunction(name) ? functionSource(name) : constSource(name))
      .join("\n") + "\n;" + returned + ";";
    vm.createContext(ctx);
    return vm.runInContext(code, ctx);
  }

  return { sources, isFunction, functionSource, constSource, constBlock, destructuredNames, run, runNamed };
}

/* Продакшен-стенд: над реальными файлами списка. SRC — стрипнутый исходник ГЛАВНОГО файла (app.js),
   как и раньше: его читают структурные тесты (assert.match(stand.SRC, …)). НЕ склейка всех файлов —
   иначе матч случайно поймал бы совпадение из вынесенного модуля и перестал сторожить именно app.js. */
const core = forSources(readSources(SOURCE_FILES));
const SRC = core.sources[0].src;
const { isFunction, functionSource, constSource, constBlock, destructuredNames, run, runNamed } = core;

/* Стрипнутый исходник КОНКРЕТНОГО файла списка по имени. Нужен структурным тестам, которые сверяют
   ТЕКСТ куска, переехавшего из app.js в модуль (И1): раньше они читали stand.SRC (всегда app.js),
   теперь берут файл, где код реально лежит, — без ослабления регэкспа, только сменив источник. */
function sourceOf(file) {
  const hit = core.sources.find(s => s.file === file);
  assert.ok(hit, "sourceOf: файла " + file + " нет в SOURCE_FILES (" + SOURCE_FILES.join(", ") + ")");
  return hit.src;
}

/* Настоящий classList поверх Set — browser-семантика. toggle(cls, force): force не задан —
   переключить; истина — add; ложь — remove. На force держится СНЯТИЕ метки (syncNoRoomClass:
   объект вернулся в комнату). Набор add/remove/contains покрывает и потребителей без toggle. */
function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add: c => set.add(c),
    remove: c => set.delete(c),
    contains: c => set.has(c),
    toggle: (c, force) => {
      if (force === undefined) {
        if (set.has(c)) { set.delete(c); return false; }
        set.add(c); return true;
      }
      if (force) { set.add(c); return true; }
      set.delete(c); return false;
    }
  };
}

/* <select> по спеке: присвоение .value значения, которого нет среди <option> в innerHTML, СНИМАЕТ
   выбор — value становится "". На этом держится отличие валидного выбора накладки от молчаливой
   подмены (postSlotCount). */
function makeSelect() {
  const el = { innerHTML: "", _value: "", dataset: {} };
  Object.defineProperty(el, "value", {
    get() { return el._value; },
    set(v) {
      const opts = [...el.innerHTML.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]);
      el._value = opts.includes(String(v)) ? String(v) : "";
    }
  });
  return el;
}

/* Узел как из браузерного createElement: строковый className, dataset/style как объекты, слоты
   под обработчики, настоящий classList. over.dataset/over.classes — предзаданные поля узла (для
   plan-иконок с data-id/data-kind и классом plan-icon). Прочие поля инертны для функций, которые
   их не трогают, — лишний узнаваемый props не может скрыть запись в проверяемое поле. */
function makeElement(over) {
  over = over || {};
  const attrs = {};
  return {
    className: "", innerHTML: "", value: "", textContent: "",
    hidden: false, disabled: false,
    dataset: Object.assign({}, over.dataset),
    style: {},
    onclick: null, onmouseenter: null, onmousemove: null, onmouseleave: null, ondblclick: null,
    classList: makeClassList(over.classes),
    /* setAttribute/getAttribute поверх карты атрибутов — как в браузере. Нужен связкам, что
       ведут ARIA-состояние параллельно классу (aria-checked у кнопок-радиостатусов): без него
       вызов setAttribute падал бы TypeError, скрывая проверяемое поведение. */
    setAttribute: (name, value) => { attrs[name] = String(value); },
    getAttribute: name => (name in attrs ? attrs[name] : null)
  };
}

/* Реестр DOM по id: $ отдаёт (и запоминает) узел по id, чтобы после прогона прочитать именно тот
   узел, в который писал app.js — сменят id в app.js, и здесь узел окажется пуст. selects — id,
   которые должны быть <select> по спеке (makeSelect); остальные — generic makeElement. */
function makeDom(opts) {
  opts = opts || {};
  const selects = new Set(opts.selects || []);
  const els = {};
  const $ = id => els[id] || (els[id] = selects.has(id) ? makeSelect() : makeElement());
  return { els, $ };
}

/* canvas.querySelector, который ЧЕСТНО разбирает `.cls[data-attr="value"]`: ищет узел с этим
   классом и dataset[attr]===value. Подмена имени атрибута (data-id→data-kind) уводит поиск в поле,
   где значения нет, — узел не находится, ровно как в браузере. */
function makeCanvas(nodes) {
  return {
    querySelector(sel) {
      const clsMatch = sel.match(/\.([\w-]+)/);
      const attrMatch = sel.match(/\[data-([\w-]+)\s*=\s*"([^"]*)"\]/);
      assert.ok(attrMatch, "шим не понял селектор (нет [data-…=\"…\"]): " + sel);
      const cls = clsMatch ? clsMatch[1] : null;
      const prop = attrMatch[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // data-id → id
      const val = attrMatch[2];
      return nodes.find(n => (!cls || n.classList.contains(cls)) && n.dataset[prop] === val) || null;
    }
  };
}

/* document-шим: createElement отдаёт свежий makeElement (тег игнорируется — узлу он не нужен). */
function makeDocument() {
  return { createElement: () => makeElement() };
}

/* Настоящий каталог VIMAR: catalog-vimar.js кладёт данные в window — исполняем его в песочнице
   с window-шимом и возвращаем EP_VIMAR_CATALOG. */
function loadVimarCatalog() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(JS_DIR, "catalog-vimar.js"), "utf8"), { window: win });
  return win.EP_VIMAR_CATALOG;
}

module.exports = {
  SRC,
  SOURCE_FILES,
  sourceOf,
  forSources,
  isFunction,
  functionSource,
  constSource,
  constBlock,
  destructuredNames,
  run,
  runNamed,
  makeClassList,
  makeSelect,
  makeElement,
  makeDom,
  makeCanvas,
  makeDocument,
  loadVimarCatalog
};
