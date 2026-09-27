/* ПОВЕДЕНЧЕСКИЙ тест вынесенной промис-модалки охвата правки типа стены (И1, шаг 2: js/wallScope.js).
   Существующие тесты (savePostBuilderWiring, frameSwapOnPlacement) ЗАГЛУШАЮТ askWallScope стабом в
   ctx — саму модалку не исполняют. Поэтому мутации внутри wallScope.js (всегда «self», кнопки не
   провязаны, ответ перепутан) до сих пор были бы зелёными. Здесь исполняем НАСТОЯЩИЙ модуль на
   минимальном DOM-шиме и держим каждый исход: self / sameType / отказ / клик по фону / повторное
   открытие. Запуск: node --test tests/wallScopeModal.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPWallScope = require("../js/wallScope.js");

/* Минимальный DOM-шим: узлы по id ровно с тем, что трогает модуль — classList, textContent, onclick,
   focus. Своя копия (а не общий appStand) — модулю большего не нужно, и его контракт виден целиком. */
function makeStand() {
  const nodes = {};
  const node = () => {
    const set = new Set();
    return {
      textContent: "", onclick: null, _focused: 0,
      focus() { this._focused++; },
      classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) }
    };
  };
  const $ = id => nodes[id] || (nodes[id] = node());
  const api = EPWallScope.create({ $, WALL_STEP_LABEL: { solid: "кирпич", hollow: "ГКЛ" } });
  return { nodes, $, api };
}

test("wallScope: кнопка «только этот пост» резолвит self и закрывает модалку", async () => {
  const { nodes, api } = makeStand();
  const p = api.askWallScope(3, "solid");
  assert.equal(nodes.wallScopeModal.classList.contains("open"), true, "askWallScope открыл модалку");
  nodes.wallScopeSelf.onclick();
  assert.equal(await p, "self", "ответ — только этот пост (мутация «перепутан ответ» краснит здесь)");
  assert.equal(nodes.wallScopeModal.classList.contains("open"), false, "после ответа модалка закрыта");
});

test("wallScope: кнопка «во всех однотипных» резолвит sameType", async () => {
  const { nodes, api } = makeStand();
  const p = api.askWallScope(4, "hollow");
  nodes.wallScopeAll.onclick();
  assert.equal(await p, "sameType",
    "ответ — все однотипные (мутации «всегда self» и «перепутан ответ» краснят здесь)");
});

test("wallScope: крестик резолвит отказ (null)", async () => {
  const { nodes, api } = makeStand();
  const p = api.askWallScope(2, "solid");
  nodes.closeWallScopeModal.onclick();
  assert.equal(await p, null, "крестик — отказ (мутация «всегда self» краснит здесь)");
});

test("wallScope: клик по фону — отказ, клик по содержимому — не закрывает", async () => {
  const { nodes, api } = makeStand();
  const p = api.askWallScope(2, "solid");
  nodes.wallScopeModal.onclick({ target: nodes.wallScopeSelf });   // клик по внутренней кнопке — мимо фона
  assert.equal(nodes.wallScopeModal.classList.contains("open"), true, "клик внутри модалку не закрывает");
  nodes.wallScopeModal.onclick({ target: nodes.wallScopeModal });  // клик по самому фону
  assert.equal(await p, null, "клик по фону — отказ");
});

test("wallScope: текст вопроса и кнопки собраны из числа и подписи типа стены", async () => {
  const { nodes, api } = makeStand();
  const p = api.askWallScope(5, "hollow");
  assert.match(nodes.wallScopeCopy.textContent, /ГКЛ/, "подпись типа стены берётся из WALL_STEP_LABEL");
  assert.match(nodes.wallScopeCopy.textContent, /5 шт/, "число однотипных в тексте вопроса");
  assert.match(nodes.wallScopeAll.textContent, /5/, "число однотипных на кнопке «во всех»");
  nodes.wallScopeSelf.onclick(); await p;   // закрываем висящий вопрос, чтобы не оставлять промис
});

test("wallScope: повторный askWallScope закрывает прежний вопрос отказом (промис не зависает)", async () => {
  const { nodes, api } = makeStand();
  const first = api.askWallScope(2, "solid");
  const second = api.askWallScope(3, "solid");   // спросили заново, не ответив на первый
  assert.equal(await first, null, "прежний вопрос закрыт отказом — иначе его промис завис бы навсегда");
  nodes.wallScopeSelf.onclick();
  assert.equal(await second, "self", "новый вопрос отвечает нормально");
});
