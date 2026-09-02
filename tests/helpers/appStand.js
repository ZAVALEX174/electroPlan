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
     const render = stand.run(["orphanObjectsWarningHtml", "renderSummary"], {
       state, EPRoomAssign, $: dom.$, money: v => "m"+v, esc: String, ... });   // vm-контекст
     render();                                                       // исполнили настоящий app.js
     assert.match(dom.els.lightingSummary.innerHTML, /Вне помещений/);

   ИНТЕРФЕЙС.
     stand.run(names, ctx)      — вырезать функции names (строка или массив в порядке зависимостей),
                                  исполнить в vm-контексте ctx и вернуть ПОСЛЕДНЮЮ по имени.
     stand.functionSource(name) — исходный текст одной функции (если нужен сырой доступ).
     stand.destructuredNames(ns)— имена из `const {…}=<ns>;` (проверка проброшенных алиасов).
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
/* Стрипаем сразу весь файл: защита от закомментированного кода И от `\nfunction ` из комментария,
   который иначе обрубил бы вырезаемое тело раньше времени. */
const SRC = stripComments(fs.readFileSync(path.join(JS_DIR, "app.js"), "utf8"));

/* Исходник одной функции: от её объявления до следующего `\nfunction ` верхнего уровня. Между
   соседями только `}` и пустые строки — валидный JS. */
function functionSource(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start);
  const nextIdx = rest.indexOf("\nfunction ", 1);
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

/* Имена, которые app.js достаёт деструктуризацией `const {…}=<ns>;`. Нужно, чтобы собрать контекст
   РОВНО из проброшенных имён и воспроизвести браузерный ReferenceError при забытом алиасе. */
function destructuredNames(ns) {
  const m = SRC.match(new RegExp("const\\s*\\{([^}]*)\\}\\s*=\\s*" + ns + "\\s*;"));
  assert.ok(m, "в app.js не нашлась строка алиасов `const {...}=" + ns + ";`");
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}

/* Исполнить одну или несколько функций app.js в контексте ctx и вернуть ПОСЛЕДНЮЮ по имени.
   names — строка или массив (порядок = порядок объявления зависимостей). Контекст создаётся
   здесь; свойства, дописанные в ctx до вызова, песочница видит. */
function run(names, ctx) {
  const list = Array.isArray(names) ? names : [names];
  assert.ok(list.length > 0, "run: нужно хотя бы одно имя функции");
  const returned = list[list.length - 1];
  const code = list.map(functionSource).join("\n") + "\n;" + returned + ";";
  vm.createContext(ctx);
  return vm.runInContext(code, ctx);
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
  return {
    className: "", innerHTML: "", value: "", textContent: "",
    hidden: false, disabled: false,
    dataset: Object.assign({}, over.dataset),
    style: {},
    onclick: null, onmouseenter: null, onmousemove: null, onmouseleave: null, ondblclick: null,
    classList: makeClassList(over.classes)
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
  functionSource,
  destructuredNames,
  run,
  makeClassList,
  makeSelect,
  makeElement,
  makeDom,
  makeCanvas,
  makeDocument,
  loadVimarCatalog
};
