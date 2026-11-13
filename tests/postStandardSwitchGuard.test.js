/* Д2 и Д1 состязательной проверки Б8-д — ГАРДЫ в проводке окна поста (js/postBuilder.js).
   Исполняем НАСТОЯЩИЙ текст функций через общий стенд (vm), как frameOrientationWiring/
   postStandardVerticalSwitch: app.js-монолит в node не грузится, связки дают почти все дефекты (§7.1).
   Данные — обогащённый каталог VIMAR (standard/frameColor дописывает data.js из attrs).

   Д2. Повторный клик по УЖЕ АКТИВНОЙ позиции «Вертикально»/«Горизонтально» — NO-OP: старый пост
       {30654.00, verticalLayout:true} (кнопка подсвечена) не должен молча конвертироваться в 30645.00
       с standardChoice="DE" (состав и цена!) по контролу, который выглядит «уже выбран».
   Д1. BOTH-накладка (273 шт., напр. Plana 09661.01) при выставленном standardChoice: черновик
       СБРАСЫВАЕТСЯ в null в той же точке синхронизации renderPostStandard — иначе выбор залипал,
       обе позиции переключателя disabled, пул сужен criteriaForChoice — необратимый тупик. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPFrameOrientation = require("../js/frameOrientation.js");
const EPPostStandard = require("../js/postStandard.js");
const EPBuilderSlots = require("../js/builderSlots.js");

function loadEnrichedFrames() {
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products.filter(p => p.kind === "frame" && p.active !== false);
}
const FRAMES = loadEnrichedFrames();
const byCode = code => FRAMES.find(f => f.code === code);
const frameProduct = id => FRAMES.find(f => Number(f.id) === Number(id));

test("предпосылки каталога: 273 BOTH-накладки, Plana 09661.01 — BOTH", () => {
  assert.equal(FRAMES.filter(f => String(f.standard).toUpperCase() === "BOTH").length, 273);
  assert.equal(String(byCode("09661.01").standard).toUpperCase(), "BOTH");
});

/* ══ Д2: клик по уже активной позиции расположения — no-op ═══════════════════════════════════ */
function runToggle(startFrame, checked, verticalFrame) {
  const dom = stand.makeDom();
  dom.$("postFrameSelect").value = String(startFrame.id);
  const state = { builder: { verticalFrame, frameAuto: true, standardChoice: null } };
  let rendered = 0;
  const ctx = {
    state, $: dom.$, EPFrameOrientation, EPPostStandard, frameProduct,
    byKind: () => FRAMES,
    renderBuilder: () => { rendered++; }
  };
  const toggle = stand.run("toggleFrameOrientation", ctx);
  toggle(checked);
  return { dom, state, rendered };
}

test("Д2: старый пост 30654.00 + verticalLayout:true, клик по УЖЕ активной «Вертикально» — no-op (не конвертирует)", () => {
  const { dom, state, rendered } = runToggle(byCode("30654.00"), true, true);
  assert.equal("preferredFrameId" in dom.$("postFrameSelect").dataset, false,
    "накладка НЕ переписана на 30645.00 — пост не конвертируется молча (состав/цена!)");
  assert.equal(state.builder.standardChoice, null, "standardChoice не появляется");
  assert.equal(state.builder.verticalFrame, true, "флаг остаётся как был");
  assert.equal(rendered, 0, "no-op не перерисовывает окно");
});

test("Д2(б): клик «Горизонтально» при снятой отметке — тоже no-op", () => {
  const { dom, state, rendered } = runToggle(byCode("30643.00"), false, false);
  assert.equal("preferredFrameId" in dom.$("postFrameSelect").dataset, false);
  assert.equal(state.builder.verticalFrame, false);
  assert.equal(rendered, 0, "no-op не перерисовывает окно");
});

test("Д2(а): ручная вертикальная 30645.00 + flag=false, клик «Вертикально» — flag взводится, накладка та же (прежнее поведение)", () => {
  const { dom, state } = runToggle(byCode("30645.00"), true, false);
  assert.equal(state.builder.verticalFrame, true, "флаг false→true");
  assert.equal("preferredFrameId" in dom.$("postFrameSelect").dataset, false,
    "накладка та же (oriented вернул её же) — поведение не тронуто");
  assert.equal(state.builder.standardChoice, null, "standardChoice не тронут (уже DE по накладке)");
});

test("Д2-контроль: РЕАЛЬНОЕ переключение работает (30654.00, flag false→true → 30645.00 + DE) — гарда не убила перевод", () => {
  const { dom, state, rendered } = runToggle(byCode("30654.00"), true, false);
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(byCode("30645.00").id));
  assert.equal(state.builder.standardChoice, "DE");
  assert.equal(rendered, 1, "переключение перерисовывает окно");
});

test("Д2(в): no-op не «грязнит» черновик (builderDirty остаётся false), реальное переключение — грязнит", () => {
  const dom = stand.makeDom({ selects: ["postFrameSelect"] });
  dom.$("postName").value = "Пост на 4 модуля";
  const f = byCode("30654.00");
  dom.$("postFrameSelect").innerHTML = `<option value="${f.id}"></option>`;
  dom.$("postFrameSelect").value = String(f.id);
  const state = { builder: { verticalFrame: true, standardChoice: null, wallType: "solid",
    backlight: null, thermoSensor: "on", restrictInnardsColor: false, slots: [], snapshot: null } };
  /* Программу собираем вручную из functionSource/constSource стенда: builderDirty едет БЕСПЛАТНО в
     хвосте functionSource(builderSignature) (const-стрелка между соседями-функциями), поэтому просить
     её через constSource второй раз нельзя — дубль объявления. Возвращаем все три функции разом. */
  const ctx = {
    state, $: dom.$, EPFrameOrientation, EPPostStandard, EPBuilderSlots, frameProduct,
    byKind: () => FRAMES,
    renderBuilder: () => {}
  };
  const code = ["builderWallType", "builderSignature", "toggleFrameOrientation"]
    .map(n => stand.isFunction(n) ? stand.functionSource(n) : stand.constSource(n)).join("\n")
    + "\n;({ signature: builderSignature, dirty: builderDirty, toggle: toggleFrameOrientation });";
  vm.createContext(ctx);
  const api = vm.runInContext(code, ctx);
  state.builder.snapshot = api.signature();
  api.toggle(true);   // клик по уже активной позиции
  assert.equal(api.dirty(), false, "no-op: подпись черновика не изменилась — Esc не спросит «сбросить?»");
  api.toggle(false);  // контроль: реальное снятие отметки
  assert.equal(api.dirty(), true, "реальное переключение dirty видит — сам dirty-тест не тавтология");
});

/* ══ Д1: BOTH-накладка + выставленный standardChoice → сброс в null ══════════════════════════ */
function runRenderPostStandard(frame, standardChoice) {
  const dom = stand.makeDom();
  const orient = ["horizontal", "vertical"].map(o => stand.makeElement({ dataset: { orient: o } }));
  const std = ["IT", "DE"].map(s => stand.makeElement({ dataset: { standard: s } }));
  const document = { querySelectorAll: sel => sel.startsWith("#postOrientMode") ? orient : std };
  const state = { builder: { verticalFrame: false, standardChoice } };
  const ctx = {
    state, $: dom.$, document, EPPostStandard,
    STANDARD_GENITIVE_FRAME: { IT: "итальянской", DE: "немецкой" },
    standardLabel: s => s, moduleWord: n => `${n} модулей`, frameSlotCount: f => f.slotCount
  };
  const render = stand.run(["standardUnavailableText", "renderPostStandard"], ctx);
  render(frame, FRAMES);
  return { state, std, orient, hint: dom.$("postStandardHint") };
}

test("Д1: BOTH 09661.01 + standardChoice='DE' → черновик сброшен в null, пул открыт", () => {
  const { state, std, hint } = runRenderPostStandard(byCode("09661.01"), "DE");
  assert.equal(state.builder.standardChoice, null,
    "универсальной накладке выбор стандарта не нужен — залипший 'DE' сброшен");
  /* пул окна снова без фильтра стандарта: criteriaForChoice вернёт критерий комнаты как есть */
  const criteria = { standard: "DE", series: ["Plana"] };
  assert.equal(EPPostStandard.criteriaForChoice(criteria, state.builder.standardChoice), criteria,
    "criteriaForChoice(…, null) — та же ссылка, пул не сужен (итальянские накладки доступны)");
  assert.ok(std.every(b => b.disabled), "обе позиции переключателя disabled — стандарт выбирать не из чего");
  assert.match(hint.textContent, /подходит для обоих стандартов/,
    "хинт объясняет disabled: «накладка подходит под оба стандарта», а не «нет накладки в этой отделке»");
});

test("Д1: накладка с неопределённым стандартом — тоже сброс в null (не только явный BOTH)", () => {
  const custom = { code: "X.1", kind: "frame", name: "Накладка без поля standard", slotCount: 2 };
  const { state } = runRenderPostStandard(custom, "IT");
  assert.equal(state.builder.standardChoice, null, "стандарт не определён → выбор сброшен");
});

test("Д1: возврат к IT-накладке после сброса — переключатель жив, обе позиции доступны", () => {
  const { state, std } = runRenderPostStandard(byCode("30654.00"), null);
  assert.equal(state.builder.standardChoice, null, "пока человек не нажимал стандарт — поле не появляется");
  assert.equal(std[0].classList.contains("active"), true, "IT позиция активна по накладке");
  assert.equal(std[0].disabled, false, "IT доступна");
  assert.equal(std[1].disabled, false, "DE доступна (двойник есть) — тупика нет");
});

test("Д1-контроль: синхронизация IT/DE прежняя (standardChoice='IT' + накладка 30643.00 DE → 'DE')", () => {
  const { state, std } = runRenderPostStandard(byCode("30643.00"), "IT");
  assert.equal(state.builder.standardChoice, "DE", "переключатель следует стандарту выбранной накладки");
  assert.equal(std[1].classList.contains("active"), true, "DE позиция активна");
  assert.equal(std[1].disabled, false);
});

test("Д1: BOTH без standardChoice (null) — остаётся null, хинт тот же", () => {
  const { state, hint } = runRenderPostStandard(byCode("09661.01"), null);
  assert.equal(state.builder.standardChoice, null);
  assert.match(hint.textContent, /подходит для обоих стандартов/);
});
