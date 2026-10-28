/* К11-3в. Окно выбора состава листа монтажника. Три плоскости:

   A. ЧИСТЫЕ ФУНКЦИИ СЛОТОВ (EPInstallSheetOptions) — нормализация своих наборов, сохранение, сравнение.
      Полнее покрыты в installSheetOptions.test.js; здесь сторожим ровно то, на чём держится окно.
   B. ГАЛОЧКИ — СВОЙСТВО ПРОЕКТА. Accessor installSheetOptions() (app.js): нет поля → migrate (лист как
      сегодня), есть поле → normalize(поле). Круговорот через НАСТОЯЩИЕ projectSnapshot/restoreProject
      (исходный текст app.js в vm, как packMultipleRoundTrip.test.js): выбор переживает «перезагрузку»,
      старый проект без поля открывается как сегодня.
   C. МОДУЛЬ ОКНА (EPInstallSheetWindow) на DOM-шиме: галочка пишет выбор в проект и сохраняет; готовый
      набор применяется; «Открыть лист» печатает и закрывает окно; в режиме одного поста «План с номерами»
      неактивна (плана у листа одного поста нет).

   Галочки гейтят ДЕНЬГИ листа (цена блока, суммы в «Группах света») и его СОСТАВ, поэтому мутации:
     · B: убрать в installSheetOptions() ветку migrate (вернуть normalize(o) всегда) → краснеет
          «нет поля → migrate (лист как сегодня)» (у нового проекта prices включились бы);
     · B: убрать в projectSnapshot строку installSheetOptions → краснеет «снимок несёт выбор»;
     · B: убрать в restoreProject строку чтения p.installSheetOptions → краснеет «выбор переживает перезагрузку»;
     · B: записать в снимке installSheetOptions всегда (не только при наличии поля) → краснеет
          «старый проект поля не несёт» (байт-в-байт печать сломалась бы — появился бы навязанный набор);
     · C: writeOptions без scheduleSave → краснеет «галочка сохраняет»; без записи — «галочка меняет выбор»;
     · G: в sync() убрать `|| key==="supplier"` → краснеет «режим поста гасит и Сводную спецификацию»;
     · A: см. installSheetOptions.test.js (нормализация слотов, saveCustomPreset).
   Запуск: node --test tests/installSheetWindow.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPInstallSheetOptions = require("../js/installSheetOptions.js");
const EPInstallSheetWindow = require("../js/installSheetWindow.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");

/* ---------- A. Чистые функции слотов (на чём держится окно) ---------- */

test("A: свои слоты листа — ровно 3, безымянные/битые отброшены; sameOptions по видимости", () => {
  const N = EPInstallSheetOptions.CUSTOM_SLOTS;
  assert.equal(N, 3);
  const list = EPInstallSheetOptions.normalizeCustomPresets([
    { name: " Монтаж ", options: { prices: false } }, { name: "" }, { foo: 1 }, { name: "лишний" }
  ]);
  assert.equal(list.length, N, "ровно 3 слота");
  assert.equal(list[0].name, "Монтаж", "имя обрезано");
  assert.equal(list[1], null, "пустое имя — пустой слот");
  assert.equal(list[2], null, "битый слот — пустой");
  /* подсветка активного набора: сравнение по нормализованному виду, порядок ключей не важен */
  assert.ok(EPInstallSheetOptions.sameOptions(
    EPInstallSheetOptions.preset("client"), EPInstallSheetOptions.preset("client")));
  assert.ok(!EPInstallSheetOptions.sameOptions(
    EPInstallSheetOptions.preset("client"), EPInstallSheetOptions.preset("builder")));
});

/* ---------- B. Accessor installSheetOptions() ---------- */

function accessor(settings) {
  return stand.run("installSheetOptions", { EP_DATA: { settings }, EPInstallSheetOptions, Object })();
}

test("B: нет поля installSheetOptions → migrate (лист печатается как сегодня)", () => {
  const got = accessor({ assemblyView: "exploded" });
  assert.deepEqual(got, EPInstallSheetOptions.migrate({ assemblyView: "exploded" }),
    "без поля accessor отдаёт миграцию старой настройки (мутация «всегда normalize» краснит здесь)");
  assert.equal(got.prices, true, "сегодняшний лист несёт цены");
  assert.equal(got.assembled, false, "крупной «Общей сборки» сегодня в листе нет");
  assert.equal(got.exploded, true, "взрыв-схема по умолчанию");
});

test("B: есть поле → normalize(поля); чужие ключи отброшены, вид листа из поля", () => {
  const got = accessor({ assemblyView: "assembled", installSheetOptions: { prices: true, junk: 1 } });
  assert.deepEqual(got, EPInstallSheetOptions.normalize({ prices: true }),
    "поле уважается, а не migrate (assemblyView при наличии поля не смотрим)");
  assert.equal(got.prices, true);
  assert.ok(!("junk" in got), "чужой ключ не просочился");
});

/* ---------- B. Круговорот снимок → файл → восстановление (настоящие projectSnapshot/restoreProject) ---------- */

function freshDefaults() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), { window: win });
  return JSON.parse(JSON.stringify(win.EP_DATA.settings));
}

/* Один «сеанс браузера»: общий контекст для restoreProject, projectSnapshot и accessor (делят EP_DATA).
   syncOfferOptions/syncPackMultiple заглушены — живой экран здесь не проверяем, важен круговорот поля. */
function makeSession() {
  const dom = stand.makeDom();
  const state = {};
  const ctx = {
    $: dom.$, esc: String, state,
    EP_DATA: { settings: freshDefaults() },
    EPEstimate, EPPosts, EPOfferOptions, EPInstallSheetOptions,
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s }, EPPlanRotate: require("../js/planRotate.js"),
    ProjectStore: { load: () => null },
    dropOrphanKeyGroups: () => {}, renderLightingSchemeSelect: () => {},
    renderProjectWallTypeSelect: () => {}, renderProjectBacklight: () => {},
    fillDocHeaderInputs: () => {}, syncOfferOptions: () => {}, syncPackMultiple: () => {}, markCanvasUsed: () => {},
    Object, Array, Number, Date, Promise, String
  };
  const src = stand.functionSource("relabelContourRooms") + "\n" + stand.functionSource("restoreProject")
    + "\n" + stand.functionSource("projectSnapshot") + "\n" + stand.functionSource("installSheetOptions")
    + "\n;({ restore: restoreProject, snapshot: projectSnapshot, options: installSheetOptions });";
  vm.createContext(ctx);
  const api = vm.runInContext(src, ctx);
  return { ctx, ...api, store: p => { ctx.ProjectStore.load = () => p; },
    resetDefaults: () => { ctx.EP_DATA.settings = freshDefaults(); } };
}

test("B: выбор «Клиенту» переживает сохранение и перезагрузку (snapshot → restore)", async () => {
  const s = makeSession();
  s.ctx.EP_DATA.settings.installSheetOptions = EPInstallSheetOptions.preset("client");
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  assert.deepEqual(snap.installSheetOptions, EPInstallSheetOptions.preset("client"),
    "снимок несёт выбор (мутация «убрать строку snapshot» краснит здесь)");
  s.resetDefaults();
  s.store({ terms: {}, installSheetOptions: snap.installSheetOptions });
  await s.restore();
  assert.deepEqual(s.options(), EPInstallSheetOptions.preset("client"),
    "после перезагрузки лист слушается сохранённого выбора (мутация «убрать чтение в restore» краснит здесь)");
});

test("B: старый проект без поля открывается как сегодня (accessor → migrate), снимок поля не навязывает", async () => {
  const s = makeSession();
  /* снимок проекта, где окно листа ни разу не открывали — поля нет */
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  assert.ok(!("installSheetOptions" in snap),
    "поле не записано, пока человек не выбирал (мутация «писать всегда» краснит здесь — иначе печать не байт-в-байт)");
  s.store({ terms: {} });                       // проект, сохранённый до появления окна
  await s.restore();
  assert.equal(s.ctx.EP_DATA.settings.installSheetOptions, undefined, "поля в настройках нет");
  assert.deepEqual(s.options(), EPInstallSheetOptions.migrate(s.ctx.EP_DATA.settings),
    "accessor отдаёт migrate — лист как сегодня");
});

/* ---------- C. Модуль окна на DOM-шиме ---------- */

/* Шим classList поверх Set (та же семантика toggle, что у appStand). */
function classList() {
  const set = new Set();
  return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
    toggle: (c, f) => { if (f === undefined) f = !set.has(c); f ? set.add(c) : set.delete(c); return f; } };
}
/* Узел-заглушка: держит нужные окну поля и методы. */
function node(extra) {
  return Object.assign({ innerHTML: "", hidden: false, disabled: false, checked: false,
    dataset: {}, classList: classList(), onclick: null, onchange: null, focus() {} }, extra);
}

/* Поднять окно на шиме. Поле installSheetOptionsFields отдаёт по data-sheet-key заранее созданные
   input-узлы (как querySelector в браузере по готовому innerHTML). document.querySelectorAll нужен
   подсветке/провязке наборов — отдаём предустановленные кнопки наборов. */
function makeWindow(initialOptions, prefsStore) {
  const inputs = {};
  EPInstallSheetOptions.fields.forEach(([k]) => { inputs[k] = node({ dataset: { sheetKey: k } }); });
  const nodes = {
    installSheetOptionsFields: node({ querySelector: sel => {
      const m = sel.match(/data-sheet-key="([^"]+)"/); return m ? inputs[m[1]] : null; } }),
    installSheetCustomPresets: node({}),
    installSheetWindowModal: node({}),
    installSheetWindowClose: node({}),
    installSheetWindowOpen: node({}),
    installSheetPlanHint: node({ hidden: true })
  };
  const presetBtns = [
    node({ dataset: { sheetPreset: "builder" } }), node({ dataset: { sheetPreset: "client" } })
  ];
  /* Окно читает подсветку/наборы через глобальный document (как КП-код app.js). В node его нет —
     ставим минимальный шим перед create: querySelectorAll отдаёт кнопки наборов этого окна. */
  global.document = { querySelectorAll: sel =>
    sel.indexOf("data-sheet-preset") >= 0 ? presetBtns : [] };
  const $ = id => nodes[id];
  let settings = { installSheetOptions: initialOptions };
  let saves = 0;
  const prefs = { store: prefsStore || [], get(k, d) { return k === "installSheetPresets" ? this.store : d; },
    set(k, v) { if (k === "installSheetPresets") this.store = v; } };
  const win = EPInstallSheetWindow.create({
    $, esc: String, EPPrefs: prefs, EPInstallSheetOptions,
    readOptions: () => EPInstallSheetOptions.normalize(settings.installSheetOptions),
    writeOptions: o => { settings.installSheetOptions = EPInstallSheetOptions.normalize(o); saves++; }
  });
  return { win, nodes, inputs, presetBtns, prefs,
    get options() { return EPInstallSheetOptions.normalize(settings.installSheetOptions); },
    get saves() { return saves; } };
}

test("C: галочка пишет выбор в проект и сохраняет (writeOptions → scheduleSave)", () => {
  const w = makeWindow(EPInstallSheetOptions.preset("builder"));
  w.win.open({ target: "project", print: () => {} });
  assert.equal(w.inputs.prices.checked, false, "у «Строителю» цены сняты");
  const before = w.saves;
  w.inputs.prices.checked = true;
  w.nodes.installSheetOptionsFields.onchange({ target: w.inputs.prices });
  assert.equal(w.options.prices, true, "галочка записала выбор (мутация «без записи» краснит здесь)");
  assert.equal(w.saves, before + 1, "выбор сохранён (мутация «без scheduleSave» краснит здесь)");
});

test("C: готовый набор применяется к проекту", () => {
  const w = makeWindow(EPInstallSheetOptions.preset("builder"));
  w.win.open({ target: "project", print: () => {} });
  w.presetBtns[1].onclick();   // «Клиенту»
  assert.deepEqual(w.options, EPInstallSheetOptions.preset("client"), "набор «Клиенту» записан в проект");
});

test("C: «Открыть лист» печатает текущий выбор и закрывает окно", () => {
  const w = makeWindow(EPInstallSheetOptions.preset("client"));
  let printed = 0;
  w.win.open({ target: "project", print: () => { printed++; } });
  assert.ok(w.nodes.installSheetWindowModal.classList.contains("open"), "окно открылось");
  w.nodes.installSheetWindowOpen.onclick();
  assert.equal(printed, 1, "печать запущена");
  assert.ok(!w.nodes.installSheetWindowModal.classList.contains("open"), "окно закрылось");
});

test("C: режим одного поста гасит «План с номерами» (у листа одного поста плана нет)", () => {
  const w = makeWindow(EPInstallSheetOptions.preset("builder"));
  w.win.open({ target: "post", print: () => {} });
  assert.equal(w.inputs.plan.disabled, true, "в режиме поста «План» неактивна");
  assert.equal(w.nodes.installSheetPlanHint.hidden, false, "подсказка про недоступный план показана");
  w.win.open({ target: "project", print: () => {} });
  assert.equal(w.inputs.plan.disabled, false, "в режиме проекта «План» снова активна");
  assert.equal(w.nodes.installSheetPlanHint.hidden, true, "подсказка скрыта");
});

/* G (владелец 28.10): у листа ОДНОГО поста нет не только плана со всеми номерами, но и свода по
   проекту — «Сводная спецификация» (supplier) обязана быть серой так же, как «План с номерами».
   Мутация «вернуть input.disabled = key==="plan" && target==="post"» (убрать || supplier) краснит здесь. */
test("G: режим одного поста гасит и «План», и «Сводную спецификацию»; режим проекта — обе активны", () => {
  const w = makeWindow(EPInstallSheetOptions.preset("builder"));
  w.win.open({ target: "post", print: () => {} });
  assert.equal(w.inputs.plan.disabled, true, "в режиме поста «План» неактивна");
  assert.equal(w.inputs.supplier.disabled, true, "в режиме поста «Сводная спецификация» тоже неактивна");
  /* Прочие галочки режим поста НЕ гасит — серыми становятся ровно два проектных пункта. */
  assert.equal(w.inputs.articles.disabled, false, "обычная галочка в режиме поста активна");
  w.win.open({ target: "project", print: () => {} });
  assert.equal(w.inputs.plan.disabled, false, "в режиме проекта «План» активна");
  assert.equal(w.inputs.supplier.disabled, false, "в режиме проекта «Сводная спецификация» активна");
});
