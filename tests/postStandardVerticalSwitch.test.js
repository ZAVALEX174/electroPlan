/* Б8-д Ч.3 — «отметка "Расположить вертикально" на посту с итальянской накладкой сама переводит пост
   на немецкий стандарт» (ответ заказчика, вариант «а», подтверждён владельцем 13.11): «отметка на посту
   с 30654 сама меняет накладку на 30645 (2+2 вертикально) — пост переходит на немецкий стандарт, с двумя
   коробками и двумя суппортами».

   Здесь два слоя:
   (1) ЧИСТОЕ правило EPPostStandard.frameForVerticalOn (js/postStandard.js): отметка ВКЛЮЧЕНА → вертикальная
       накладка, добытая сначала парой ориентации (30643→30645, как прежде), а при её отсутствии у
       ИТАЛЬЯНСКОЙ накладки — сменой стандарта (30654.* → 30645.*, standardChoice="DE"). Нет ни пары, ни
       DE-двойника (Reflex .40-.42, 7М 30657, не-LINEA, BOTH/без стандарта) → null: отметка — свободный
       флаг, накладка не меняется (поведение прежнее). СНЯТИЕ отметки — прежний путь pairOf (30645→30643),
       обратно на 30654 сознательно НЕ возвращаем (связь пары с 09.11).
   (2) ПРОВЯЗКА: обработчик отметки в окне поста (toggleFrameOrientation, js/postBuilder.js) зовёт именно
       это правило — НАСТОЯЩИЙ текст функции исполняем через общий стенд (vm), как frameOrientationWiring.

   Данные — НАСТОЯЩИЙ обогащённый каталог VIMAR (standard/frameColor дописывает data.js из attrs), как в
   postStandard.test.js: вход — каталог, факты из него же и фиксируем. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPPostStandard = require("../js/postStandard.js");
const EPFrameOrientation = require("../js/frameOrientation.js");

/* Обогащённый каталог — те же три файла и порядок, что index.html (у накладок цвет/серию/стандарт
   дописывает data.js из attrs; в сыром catalog-vimar.js их нет). */
function loadEnrichedProducts() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;
}
const FRAMES = loadEnrichedProducts().filter(p => p.kind === "frame" && p.active !== false);
const byCode = code => FRAMES.find(f => f.code === code);

/* ── 0. Предпосылки каталога: без них «зелёный» ничего не значит ─────────────────────────────── */
test("предпосылки: 30654.* — 15 отделок (IT), 30645.* — 12 (DE вертикально), Reflex у 30643/30645 нет", () => {
  assert.equal(FRAMES.filter(f => /^30654\./.test(f.code)).length, 15, "30654.* — 15 отделок");
  assert.equal(FRAMES.filter(f => /^30645\./.test(f.code)).length, 12, "30645.* — 12 отделок");
  assert.equal(String(byCode("30654.00").standard).toUpperCase(), "IT");
  assert.equal(String(byCode("30645.00").standard).toUpperCase(), "DE");
  assert.equal(EPFrameOrientation.pairOf(byCode("30654.00"), FRAMES), null,
    "вертикального двойника по паре у 30654 нет — только через смену стандарта");
  ["30654.40", "30654.41", "30654.42"].forEach(c =>
    assert.equal(EPPostStandard.twinOf(byCode(c), FRAMES), null, `у ${c} (Reflex) нет DE-двойника`));
});

/* ── 1. ЧИСТОЕ правило frameForVerticalOn ────────────────────────────────────────────────────── */
test("IT 30654.00 + отметка → вертикальная 30645.00 и standardChoice='DE' (пост переходит на немецкий)", () => {
  const r = EPPostStandard.frameForVerticalOn(byCode("30654.00"), FRAMES);
  assert.ok(r, "правило обязано найти вертикальную накладку через смену стандарта");
  assert.equal(r.frame.code, "30645.00", "30654.00 → 30645.00 (2+2 вертикально), а не горизонтальный 30643.00");
  assert.equal(r.standardChoice, "DE", "пост переходит на немецкий стандарт — переключатель покажет «Немецкий»");
});

test("IT 30654.70 «Золото матовое» + отметка → 30645.70.01 и standardChoice='DE'", () => {
  const r = EPPostStandard.frameForVerticalOn(byCode("30654.70"), FRAMES);
  assert.ok(r && r.frame, "двойник обязан найтись");
  assert.equal(r.frame.code, "30645.70.01", "суффикс DE-отделки отличается (70 → 70.01), цвет тот же");
  assert.equal(r.standardChoice, "DE");
});

test("Reflex 30654.40/.41/.42: ни пары, ни DE-двойника → null (отметка — свободный флаг, накладка не меняется)", () => {
  ["30654.40", "30654.41", "30654.42"].forEach(c =>
    assert.equal(EPPostStandard.frameForVerticalOn(byCode(c), FRAMES), null,
      `${c}: выдуманного двойника не подставляем — поведение ровно как прежде`));
});

test("Neve Up 09674.01: без вертикальной DE-пары отметка не меняет стандарт, состав и цену", () => {
  const it = byCode("09674.01");
  const horizontalDe = byCode("09664.01");
  assert.equal(it.standard, "IT");
  assert.equal(horizontalDe.standard, "DE");
  assert.equal(EPFrameOrientation.isVertical(horizontalDe), false);
  assert.equal(EPPostStandard.twinOf(it, FRAMES).code, horizontalDe.code,
    "горизонтальный немецкий двойник существует — тест проверяет именно отсутствие вертикального");
  assert.equal(EPPostStandard.frameForVerticalOn(it, FRAMES), null,
    "автопереход не должен менять артикул и монтажную обвязку, если нет вертикальной DE-накладки");
});

test("уже DE 30643.00 + отметка → 30645.00 тем же путём, что pairOf, БЕЗ смены standardChoice", () => {
  const r = EPPostStandard.frameForVerticalOn(byCode("30643.00"), FRAMES);
  assert.ok(r && r.frame, "вертикальный двойник пары найден");
  assert.equal(r.frame.code, "30645.00", "обычная пара ориентации, как и работало с 09.11");
  assert.equal(r.standardChoice, null, "стандарт не переопределяем — пост и так немецкий");
});

test("уже ВЕРТИКАЛЬНАЯ 30645.00 + отметка → null (менять нечего, накладка уже вертикальная)", () => {
  assert.equal(EPPostStandard.frameForVerticalOn(byCode("30645.00"), FRAMES), null);
});

test("BOTH/неопределённый стандарт и отсутствующая накладка → null (свободный флаг)", () => {
  const both = FRAMES.find(f => String(f.standard).toUpperCase() === "BOTH");
  assert.ok(both, "предпосылка: BOTH-накладки в каталоге есть");
  assert.equal(EPPostStandard.frameForVerticalOn(both, FRAMES), null, "у BOTH нет «другого стандарта»");
  assert.equal(EPPostStandard.frameForVerticalOn({ code: "X.1", kind: "frame", name: "Накладка" }, FRAMES), null,
    "накладка без поля standard → null");
  assert.equal(EPPostStandard.frameForVerticalOn(null, FRAMES), null, "накладка не выбрана → null");
});

test("СНЯТИЕ отметки — прежний путь: 30645.00 → 30643.00 через pairOf, обратно на 30654 НЕ возвращаем", () => {
  /* Контракт снятия живёт в EPFrameOrientation.oriented (связь пары с 09.11, сознательно): фиксируем,
     что ч.3 его не трогает. */
  assert.equal(EPFrameOrientation.oriented(byCode("30645.00"), FRAMES, false).code, "30643.00",
    "снятие отметки → немецкий горизонтальный 30643.00");
});

/* ── 2. ПРОВЯЗКА: toggleFrameOrientation (js/postBuilder.js) зовёт именно это правило ─────────── */
function runToggle(startFrame, checked) {
  const dom = stand.makeDom();
  dom.$("postFrameSelect").value = String(startFrame.id);
  const state = { builder: { verticalFrame: !checked, frameAuto: true, standardChoice: null } };
  const ctx = {
    state, $: dom.$, EPFrameOrientation, EPPostStandard,
    frameProduct: id => FRAMES.find(f => Number(f.id) === Number(id)),
    byKind: () => FRAMES,
    renderBuilder: () => {}
  };
  const toggle = stand.run("toggleFrameOrientation", ctx);
  toggle(checked);
  return { dom, state };
}

test("wiring: отметка на 30654.00 переписывает frameId на 30645.00 И выставляет standardChoice='DE'", () => {
  const { dom, state } = runToggle(byCode("30654.00"), true);
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(byCode("30645.00").id),
    "накладка поста — вертикальная немецкая 30645.00 (если обработчик перестанет звать frameForVerticalOn — здесь красное)");
  assert.equal(state.builder.standardChoice, "DE", "черновик стандарта — «Немецкий» (уйдёт в пост при сохранении)");
  assert.equal(state.builder.frameAuto, true, "отметка — НЕ ручной выбор накладки, frameAuto не трогаем (владелец 09.11)");
});

test("wiring: отметка на 30654.40 Reflex ничего не меняет (ни накладку, ни стандарт) — флаг просто хранится", () => {
  const { dom, state } = runToggle(byCode("30654.40"), true);
  assert.equal("preferredFrameId" in dom.$("postFrameSelect").dataset, false, "без двойника накладку не переписываем");
  assert.equal(state.builder.standardChoice, null, "стандарт не тронут");
  assert.equal(state.builder.verticalFrame, true, "отметка хранится свободным флагом, как прежде");
});

test("wiring: Neve Up без вертикальной DE-пары сохраняет IT-накладку при отметке", () => {
  const { dom, state } = runToggle(byCode("09674.01"), true);
  assert.equal("preferredFrameId" in dom.$("postFrameSelect").dataset, false,
    "горизонтальная 09664.01 не должна стать заменой");
  assert.equal(state.builder.standardChoice, null);
  assert.equal(state.builder.verticalFrame, true, "признак для поворота картинки сохраняется");
});

test("wiring: снятие отметки на 30645.00 возвращает 30643.00 (прежний путь, без возврата на 30654)", () => {
  const { dom } = runToggle(byCode("30645.00"), false);
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(byCode("30643.00").id),
    "снятие → немецкий горизонтальный двойник пары");
});

test("wiring: обработчик отметки ссылается на ОДНО чистое правило EPPostStandard.frameForVerticalOn (§7.1)", () => {
  assert.match(stand.sourceOf("postBuilder.js"), /EPPostStandard\.frameForVerticalOn\(/,
    "второй копии правила «отметка → вертикальная накладка хоть сменой стандарта» в postBuilder быть не должно");
});
