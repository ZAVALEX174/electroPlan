/* ОБВЯЗКА отметки «Расположить вертикально» (Б8). Три связки, каждая — РЕАЛЬНЫМ исполнением:
   1) placementFields (posts.js) переносит флаг из шаблона в пост при размещении;
   2) renderFrameOrientation — отметка загорается по ВЫБРАННОЙ вертикальной накладке (связь поле→отметка);
   3) toggleFrameOrientation — отметка переписывает frameId на двойник нужной ориентации (связь отметка→поле).
   Связки 2–3 исполняем НАСТОЯЩИМ текстом из js/postBuilder.js через общий стенд (vm): app.js-монолит
   в node не грузится, связки дают почти все дефекты (§7.1). Данные — настоящий каталог VIMAR. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPPosts = require("../js/posts.js");
const EPFrameOrientation = require("../js/frameOrientation.js");
const EPPostStandard = require("../js/postStandard.js");

const FRAMES = stand.loadVimarCatalog().products.filter(p => p.kind === "frame");
const byCode = c => FRAMES.find(f => f.code === c);
const frameProduct = id => FRAMES.find(f => Number(f.id) === Number(id));

/* Обогащённый каталог (standard/frameColor дописывает data.js из attrs) — для связки №3: с Б8-д ч.3
   обработчик отметки спрашивает ещё и EPPostStandard.frameForVerticalOn (отметка на итальянской
   накладке переводит пост на немецкий стандарт), а правилу стандарта нужны поля standard/frameColor,
   которых нет в сыром catalog-vimar.js. Тот же загрузчик, что в postStandard.test.js. */
function loadEnrichedFrames() {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products.filter(p => p.kind === "frame" && p.active !== false);
}
const FRAMES_E = loadEnrichedFrames();
const byCodeE = c => FRAMES_E.find(f => f.code === c);
const frameProductE = id => FRAMES_E.find(f => Number(f.id) === Number(id));

/* --- 1. placementFields: шаблон → пост ------------------------------------------------------- */
test("placementFields переносит verticalLayout=true из шаблона в пост", () => {
  const f = EPPosts.placementFields({ id: "t1", name: "Вертикальный", frameId: 1, mechanismIds: [], verticalLayout: true });
  assert.equal(f.verticalLayout, true, "флаг вертикальности доезжает до размещённого поста (для ЧАСТИ 2)");
});
test("placementFields НЕ переносит флаг, если его нет или он false (нет поля = не отмечено)", () => {
  const no = EPPosts.placementFields({ id: "t1", name: "Обычный", frameId: 1, mechanismIds: [] });
  assert.equal("verticalLayout" in no, false, "шаблон без флага → у поста поля нет");
  const falseFlag = EPPosts.placementFields({ id: "t1", name: "Обычный", frameId: 1, mechanismIds: [], verticalLayout: false });
  assert.equal("verticalLayout" in falseFlag, false, "verticalLayout:false не переносим — нет поля = не отмечено");
});

/* --- 2. renderFrameOrientation: поле «Накладка» → отметка ------------------------------------- */
function runRender(frame, flag) {
  const dom = stand.makeDom();
  const state = { builder: { verticalFrame: flag } };
  const render = stand.run("renderFrameOrientation", { state, $: dom.$, EPFrameOrientation });
  render(frame, FRAMES);
  return { box: dom.$("verticalFrameCheck"), state };
}
test("renderFrameOrientation: выбранная ВЕРТИКАЛЬНАЯ накладка зажигает отметку (даже если флаг был снят)", () => {
  const { box, state } = runRender(byCode("30645.01"), false);
  assert.equal(box.checked, true, "30645.01 вертикальная → отметка горит");
  assert.equal(state.builder.verticalFrame, true, "черновик приведён к ориентации накладки (сохранится верно)");
});
test("renderFrameOrientation: выбранная ГОРИЗОНТАЛЬНАЯ накладка гасит отметку (даже если флаг был взведён)", () => {
  const { box, state } = runRender(byCode("30643.01"), true);
  assert.equal(box.checked, false, "30643.01 горизонтальная → отметка гаснет");
  assert.equal(state.builder.verticalFrame, false, "черновик приведён к ориентации накладки");
});
test("renderFrameOrientation: у накладки БЕЗ пары отметка держит сохранённый флаг (просто хранится)", () => {
  assert.equal(runRender(byCode("30654.00"), true).box.checked, true, "без пары флаг true сохраняется");
  assert.equal(runRender(byCode("30654.00"), false).box.checked, false, "без пары флаг false сохраняется");
});

/* --- 3. toggleFrameOrientation: отметка → поле «Накладка» -------------------------------------
   С Б8-д ч.3 обработчик зовёт ещё EPPostStandard.frameForVerticalOn — поэтому ctx дополнен
   EPPostStandard и кадры ОБОГАЩЁННЫЕ (standard/frameColor), как в приложении. Само правило ч.3
   (30654.* → 30645.* + standardChoice="DE") покрыто в postStandardVerticalSwitch.test.js; здесь —
   прежний контракт пары и свободного флага. */
function runToggle(startFrame, checked) {
  const dom = stand.makeDom();
  dom.$("postFrameSelect").value = String(startFrame.id);
  const state = { builder: { verticalFrame: !checked, frameAuto: true, standardChoice: null } };
  let rendered = 0;
  const ctx = {
    state, $: dom.$, EPFrameOrientation, EPPostStandard, frameProduct: frameProductE,
    byKind: () => FRAMES_E,
    renderBuilder: () => { rendered++; }
  };
  const toggle = stand.run("toggleFrameOrientation", ctx);
  toggle(checked);
  return { dom, state, rendered };
}
test("toggleFrameOrientation: отметка на LINEA 30643.01 переписывает frameId на вертикальный 30645.01", () => {
  const { dom, state, rendered } = runToggle(byCodeE("30643.01"), true);
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(byCodeE("30645.01").id),
    "renderBuilder получит вертикальный двойник через preferredFrameId — это ПЕРЕЗАПИСЬ frameId, а не вычисление на лету");
  assert.equal(state.builder.standardChoice, null, "немецкая пара — тот же стандарт, standardChoice не трогаем");
  assert.equal(state.builder.frameAuto, true, "отметка меняет ТОЛЬКО ориентацию той же накладки — НЕ ручной выбор, frameAuto не трогаем (владелец 09.11: иначе смена комнаты у нового поста теряла бы вертикальный двойник нового цвета)");
  assert.equal(rendered, 1, "renderBuilder перерисован");
});
test("toggleFrameOrientation: снятие отметки на 30645.01 возвращает горизонтальный 30643.01", () => {
  const { dom } = runToggle(byCodeE("30645.01"), false);
  assert.equal(dom.$("postFrameSelect").dataset.preferredFrameId, String(byCodeE("30643.01").id),
    "снятие отметки переписывает frameId на горизонтальный двойник");
});
test("toggleFrameOrientation: без пары И без немецкого двойника (Reflex) frameId не трогаем — флаг просто хранится", () => {
  /* Б8-д ч.3: у 30654.00 появился немецкий вертикальный двойник через смену стандарта, поэтому
     «свободный флаг» проверяем на Reflex 30654.40 — у неё ни пары, ни DE-двойника. */
  const { dom, state } = runToggle(byCodeE("30654.40"), true);
  assert.equal("preferredFrameId" in dom.$("postFrameSelect").dataset, false, "без пары и без DE-двойника накладку не переписываем");
  assert.equal(state.builder.standardChoice, null, "стандарт не тронут");
  assert.equal(state.builder.verticalFrame, true, "флаг сохранён у поста (на состав не влияет)");
  assert.equal(state.builder.frameAuto, true, "без смены накладки frameAuto не трогаем");
});
