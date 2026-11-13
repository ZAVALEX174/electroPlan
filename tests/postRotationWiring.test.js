/* ПРОВЯЗКА ПОВОРОТА КАРТИНКИ ПОСТА (Б8-д ч.2) — сторожим НАБЛЮДАЕМОЕ, не имя функции.
   (A) НАСТОЯЩИЙ assembledPostSpec из app.js на каталоге VIMAR: spec.rotate ставится ТОЛЬКО когда
       разрешено (rotatable) И пост вертикален И накладка не вертикальная. Это гейт против мутаций
       «всегда поворачивать», «никогда», «поворачивать и вертикальную накладку».
   (B) docs.js разрешает поворот в листе монтажника (rotatable) и отдаёт тот же ответ взрыв-схеме —
       структурный гейт против «потерять флаг в документе».
   (C) EPExplodedView.buildHtml honours deps.rotate — при rotate поворачиваются ДЕТАЛИ, подписи ровно
       (решение владельца 13.11: сцену целиком больше не крутим).
   (D) builderAssembledPostHtml (обёртка окна поста в app.js) передаёт rotatable:true и флаг из
       state.builder.verticalFrame — гейт против мутации R9 «окно поста лишилось права на поворот». */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPPosts = require("../js/posts.js");
const EPEstimate = require("../js/estimate.js");
const EPCatalog = require("../js/catalog.js");
const EPPostRotation = require("../js/postRotation.js");
const EPExplodedView = require("../js/explodedView.js");

const FRAMES = stand.loadVimarCatalog().products.filter(p => p.kind === "frame");
const byCode = code => FRAMES.find(f => f.code === code);
const IT = byCode("30654.00");     // итальянская 4М без вертикального двойника
const VERT = byCode("30645.00");   // LINEA вертикальная (своё фото)

function rotateOf(frame, post, opts) {
  const buildSpec = stand.run("assembledPostSpec", {
    frameProduct: () => frame,
    product: () => null,
    EPPosts, EPEstimate,
    lightingRowsFor: () => [],
    projectLighting: () => ({}),
    mechanismSpan: EPCatalog.mechanismSpan,
    productImage: () => "", moduleFace: () => null,
    frameSlotCount: f => EPCatalog.frameSlotCount(f),
    frameOpening: () => null, frameOpenings: () => [],
    EPOfferOptions: { itemText: name => name },
    EPPostRotation
  });
  return buildSpec(post, opts).rotate;
}

test("(A) spec.rotate=true: итальянская накладка + verticalLayout + rotatable", () => {
  assert.equal(rotateOf(IT, { mechanismIds: [], frameId: 1, verticalLayout: true }, { size: "md", rotatable: true }), true);
});

test("(A) spec.rotate НЕ ставится без rotatable (значок на плане / КП / миниатюры)", () => {
  assert.equal(rotateOf(IT, { mechanismIds: [], frameId: 1, verticalLayout: true }, { size: "md" }), false,
    "по умолчанию rotatable=false — поворот запрещён");
});

test("(A) spec.rotate=false: вертикальная LINEA даже с флагом и rotatable (у неё своё фото)", () => {
  assert.equal(rotateOf(VERT, { mechanismIds: [], frameId: 1, verticalLayout: true }, { size: "md", rotatable: true }), false);
});

test("(A) spec.rotate=false: итальянская без флага verticalLayout", () => {
  assert.equal(rotateOf(IT, { mechanismIds: [], frameId: 1, verticalLayout: false }, { size: "md", rotatable: true }), false);
});

test("(B) docs.js разрешает поворот в листе и передаёт тот же ответ взрыв-схеме", () => {
  const src = stand.sourceOf("docs.js");
  // обе картинки листа монтажника идут с rotatable:true
  assert.match(src, /assembledPostSpec\(post,\{size:"md",articles,rotatable:true\}/, "md-картинка листа: rotatable:true");
  assert.match(src, /assembledPostSpec\(post,\{size:"lg",articles,rotatable:true\}/, "lg «Общая сборка»: rotatable:true");
  // взрыв-схема получает rotate из того же spec.rotate
  assert.match(src, /rotate:spec\.rotate/, "взрыв-схема листа крутится тем же ответом, что картинка");
});

test("(C) EPExplodedView.buildHtml: deps.rotate=true поворачивает ДЕТАЛИ, подписи ровно; иначе байт-в-байт", () => {
  const spec = { parts: [{ role: "Накладка", name: "Накладка на 4 модуля белая", code: "30654.00" }] };
  const deps = { esc: s => String(s == null ? "" : s), pickIcon: () => "generic", iconSvg: () => "" };
  const plain = EPExplodedView.buildHtml(spec, deps);
  const rotated = EPExplodedView.buildHtml(spec, Object.assign({ rotate: true }, deps));
  assert.doesNotMatch(plain, /rotate\(90deg\)/, "без флага поворота нет");
  assert.match(rotated, /rotate\(90deg\)/, "с флагом деталь взрыв-схемы повёрнута");
  assert.doesNotMatch(rotated, /class="assembled-rotated"/,
    "сцена ЦЕЛИКОМ больше не поворачивается (решение владельца 13.11) — иначе артикулы встали бы боком");
  assert.match(rotated, /monospace;margin-top:1px;overflow-wrap:anywhere">30654\.00<\/div>/,
    "артикул напечатан ровно, в подписи без поворота");
  assert.equal(EPExplodedView.buildHtml(spec, Object.assign({ rotate: false }, deps)), plain, "rotate:false не меняет разметку");
});

/* (D) Окно поста — единственный потребитель rotatable в окне: обёртка builderAssembledPostHtml обязана
   передавать rotatable:true (иначе превью молча перестанет крутиться — мутация R9) и подставлять флаг
   вертикальности из ЧЕРНОВИКА (state.builder.verticalFrame), пока пост не сохранён. Исполняем НАСТОЯЩИЙ
   текст обёртки из app.js (constBlock), а не рукописную копию — копия разошлась бы с продакшеном молча. */
function runBuilderWrapper(post, opts, light, verticalFrame) {
  const calls = [];
  const ctx = {
    assembledPostHtml: (p, o, l) => { calls.push({ p, o, l }); return "HTML"; },
    state: { builder: { verticalFrame } }
  };
  vm.createContext(ctx);
  const fn = vm.runInContext(stand.constBlock("builderAssembledPostHtml") + "\n;builderAssembledPostHtml;", ctx);
  const out = fn(post, opts, light);
  return { out, calls };
}

test("(D) builderAssembledPostHtml: rotatable:true + флаг из черновика state.builder.verticalFrame", () => {
  const { out, calls } = runBuilderWrapper({ frameId: 1 }, { size: "lg" }, "L", true);
  assert.equal(out, "HTML", "обёртка возвращает результат assembledPostHtml");
  assert.equal(calls.length, 1, "ровно один вызов assembledPostHtml");
  assert.equal(calls[0].o.rotatable, true, "право на поворот у окна поста есть (гейт против R9)");
  assert.equal(calls[0].o.size, "lg", "опции вызывающего не потеряны");
  assert.equal(calls[0].p.verticalLayout, true, "флаг вертикальности подставлен из черновика окна");
  assert.equal(calls[0].l, "L", "параметр подсветки проброшен");
});

test("(D) явный verticalLayout поста главнее черновика (размещённый пост не переопределяется)", () => {
  const { calls } = runBuilderWrapper({ frameId: 1, verticalLayout: false }, {}, undefined, true);
  assert.equal(calls[0].p.verticalLayout, false, "сохранённый флаг поста не затирается черновиком");
});
