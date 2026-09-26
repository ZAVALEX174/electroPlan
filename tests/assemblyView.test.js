/* Б2 — выбор вида поста в листе монтажника: «Общая сборка» / «Взрыв-схема».
   Вид поста — ОТДЕЛЬНАЯ настройка проекта (EP_DATA.settings.assemblyView), а НЕ часть набора столбцов
   КП: наборы (готовые и свои) его не читают, не пишут и не сравнивают. Проверяем НАСТОЯЩИЙ код:
   чистую installSheet.buildHtml, функцию EPOfferOptions.assemblyView и связки app.js через общий
   стенд appStand.js. Браузер не поднимаем. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPInstallSheet = require("../js/installSheet.js");
const EPOfferOptions = require("../js/offerOptions.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Пост с обеими иллюстрациями: маркеры MARK-ASM (собранная накладка) и MARK-EXP (взрыв-схема)
   позволяют увидеть, что именно попало в документ. */
const post = {
  number: 3, room: "Кухня", modules: [{ label: "1", name: "Выключатель", code: "20001", note: "" }],
  fittings: [{ role: "Накладка", name: "Накладка", code: "09663", count: 1 }],
  assembledImageHtml: "<div>MARK-ASM</div>",
  explodedViewHtml: "<div>MARK-EXP</div>",
  german: null
};

test("Б2 buildHtml: умолчание (без поля) — взрыв-схема, как раньше", () => {
  const html = EPInstallSheet.buildHtml({ posts: [post] }, { esc });
  assert.match(html, /MARK-ASM/, "собранная накладка есть всегда");
  assert.match(html, /MARK-EXP/, "взрыв-схема печатается по умолчанию");
  assert.match(html, /Взрыв-схема поста/, "заголовок взрыв-схемы на месте");
});

test("Б2 buildHtml: «общая сборка» — только собранная накладка, без взрыв-схемы", () => {
  const html = EPInstallSheet.buildHtml({ posts: [post], assemblyView: "assembled" }, { esc });
  assert.match(html, /MARK-ASM/, "собранная накладка с клавишами остаётся");
  assert.doesNotMatch(html, /MARK-EXP/, "взрыв-схема не печатается");
  assert.doesNotMatch(html, /Взрыв-схема поста/, "заголовка взрыв-схемы тоже нет");
});

test("Б2 buildHtml: чужое значение вида читается как взрыв-схема (умолчание)", () => {
  const html = EPInstallSheet.buildHtml({ posts: [post], assemblyView: "мусор" }, { esc });
  assert.match(html, /MARK-EXP/, "неизвестный вид не должен прятать взрыв-схему");
});

test("Б2 assemblyView(): умолчание «exploded», «assembled» сохраняется, чужое сводится к «exploded»", () => {
  assert.equal(EPOfferOptions.assemblyView(undefined), "exploded");
  assert.equal(EPOfferOptions.assemblyView(null), "exploded");
  assert.equal(EPOfferOptions.assemblyView("assembled"), "assembled");
  assert.equal(EPOfferOptions.assemblyView("explode-me"), "exploded");
});

test("Б2: вид НЕ живёт внутри набора столбцов (normalize/preset/saveCustomPreset его не носят)", () => {
  assert.ok(!("assemblyView" in EPOfferOptions.normalize({ assemblyView: "assembled" })),
    "normalize отбрасывает вид — он не часть набора столбцов");
  assert.ok(!("assemblyView" in EPOfferOptions.preset("builder")), "готовый набор вид не задаёт");
  const saved = EPOfferOptions.saveCustomPreset([], 0, "мой", { articles: false, assemblyView: "assembled" });
  assert.equal(saved[0].options.articles, false, "свой набор хранит столбцы");
  assert.ok(!("assemblyView" in saved[0].options), "но не хранит вид поста");
});

test("Б2: sameOptions сравнивает только столбцы — вид на подсветку набора не влияет", () => {
  /* Наборы столбцов с одинаковыми столбцами совпадают; поле вида в offerOptions отсутствует, поэтому
     подсветка активного набора не может погаснуть из-за выбранного вида. */
  assert.ok(EPOfferOptions.sameOptions({ articles: true }, { articles: true }));
  assert.ok(EPOfferOptions.sameOptions(EPOfferOptions.preset("builder"), EPOfferOptions.preset("builder")));
});

/* --- связки app.js через стенд --- */

/* Прогон НАСТОЯЩЕГО openInstallSheet: настройка проекта → assemblyView() → buildHtml → документ. */
function openInstallSheetHtml(assemblyView) {
  let written = "";
  const win = { document: { write: s => { written += s; }, close() {} } };
  const ctx = {
    Object, Array, Number, String, RegExp, JSON,
    window: { open: () => win },
    toast: () => {},
    docHeader: () => ({ project: "П", developer: "Р", date: "Д" }),
    EPInstallSheet, EPOfferOptions,
    EP_DATA: { settings: { assemblyView } },
    esc,
    companyLogo: () => ""
  };
  stand.run("openInstallSheet", ctx)({ posts: [post] });
  return written;
}

test("Б2 связка openInstallSheet: настройка проекта доходит до листа монтажника (оба пути листа)", () => {
  const assembled = openInstallSheetHtml("assembled");
  assert.match(assembled, /MARK-ASM/, "собранная накладка в листе");
  assert.doesNotMatch(assembled, /MARK-EXP/, "взрыв-схемы в режиме общей сборки нет");
  assert.match(openInstallSheetHtml("exploded"), /MARK-EXP/, "в режиме взрыв-схемы она печатается");
  /* старый проект без поля вида — прежнее поведение (взрыв-схема) */
  assert.match(openInstallSheetHtml(undefined), /MARK-EXP/, "старый снимок проекта печатает лист как раньше");
});

test("Б2 связка applyOfferOption: выбор вида пишется в настройку проекта, не в набор столбцов", () => {
  let saved = 0;
  const ctx = {
    Object, Array, Number, String,
    EPOfferOptions,
    EP_DATA: { settings: { offerOptions: {}, assemblyView: "exploded" } },
    syncOfferOptions: () => {},
    scheduleSave: () => { saved++; }
  };
  const applyOfferOption = stand.run("applyOfferOption", ctx);
  applyOfferOption({ dataset: { offerKey: "assemblyView" }, value: "assembled" });
  assert.equal(ctx.EP_DATA.settings.assemblyView, "assembled", "вид записан в settings.assemblyView");
  assert.ok(!("assemblyView" in ctx.EP_DATA.settings.offerOptions), "в набор столбцов вид не попал");
  assert.equal(saved, 1, "изменение помечено к сохранению");
  applyOfferOption({ dataset: { offerKey: "assemblyView" }, value: "exploded" });
  assert.equal(ctx.EP_DATA.settings.assemblyView, "exploded", "обратно на взрыв-схему");
});

test("Б2 связка applyOfferPreset: готовый набор столбцов НЕ сбрасывает выбранный вид", () => {
  const ctx = {
    Object, Array, Number, String,
    EPOfferOptions,
    EP_DATA: { settings: { offerOptions: {}, assemblyView: "assembled" } },
    syncOfferOptions: () => {},
    scheduleSave: () => {}
  };
  const applyOfferPreset = stand.run("applyOfferPreset", ctx);
  applyOfferPreset("builder");
  assert.equal(ctx.EP_DATA.settings.assemblyView, "assembled", "вид поста пережил смену набора столбцов");
  assert.ok(EPOfferOptions.sameOptions(ctx.EP_DATA.settings.offerOptions, EPOfferOptions.preset("builder")),
    "сам набор при этом применился");
});

test("Б2 связка applyCustomOfferPreset: свой набор НЕ переносит и НЕ сбрасывает вид", () => {
  const ctx = {
    Object, Array, Number, String,
    EPOfferOptions,
    /* свой набор сохранён, когда был выбран другой вид, — но вид в нём не живёт */
    EPPrefs: { get: () => [{ name: "мой", options: { articles: false, assemblyView: "assembled" } }] },
    EP_DATA: { settings: { offerOptions: {}, assemblyView: "exploded" } },
    syncOfferOptions: () => {},
    scheduleSave: () => {}
  };
  const applyCustomOfferPreset = stand.run(["customOfferPresets", "applyCustomOfferPreset"], ctx);
  applyCustomOfferPreset(0);
  assert.equal(ctx.EP_DATA.settings.assemblyView, "exploded", "применение своего набора не тронуло вид проекта");
  assert.equal(ctx.EP_DATA.settings.offerOptions.articles, false, "столбцы своего набора применились");
});

test("Б2 связка syncOfferOptions: select вида выставляется из настройки проекта при открытии", () => {
  const dom = stand.makeDom({ selects: ["offer-assemblyView"] });
  /* select должен знать свои опции — иначе шим makeSelect отклонит присвоение value */
  dom.$("offer-assemblyView").innerHTML = '<option value="exploded"></option><option value="assembled"></option>';
  const ctx = {
    Object,
    EPOfferOptions,
    EP_DATA: { settings: { offerOptions: {}, assemblyView: "assembled" } },
    $: dom.$,
    highlightActiveOfferPreset: () => {}
  };
  stand.run("syncOfferOptions", ctx)();
  assert.equal(dom.els["offer-assemblyView"].value, "assembled", "экран отражает вид, сохранённый в проекте");
});

/* --- ПЕРЕЖИВАНИЕ СОХРАНЕНИЯ: настоящие projectSnapshot и restoreProject из app.js -------------
   Вид поста — поле проекта, значит обязан пережить круг «сохранить → открыть». Структурный тест
   этого не ловит: удалить строку записи в projectSnapshot ИЛИ строку чтения в restoreProject — и
   1440/1440 всё равно зелёные, а экран разошёлся бы с документом. Исполняем НАСТОЯЩИЙ текст обеих
   функций в vm. */

/* Настоящий projectSnapshot над минимальным проектом: что уходит в ProjectStore (после JSON-круга). */
function realSnapshot(assemblyView) {
  const dom = stand.makeDom();
  const state = { devices: [], posts: [], rooms: [], walls: [], autoWalls: [], roomLines: [],
    planVisibility: "show", panX: 0, panY: 0, scale: 1, planLoaded: false,
    orthoMode: true, snapGrid: true, gridStep: 10, pxPerMeter: 100, scaleSegment: null, planLabel: "" };
  const ctx = { state, $: dom.$,
    EP_DATA: { settings: { docHeader: {}, offerOptions: {}, assemblyView } },
    EPOfferOptions, EPEstimate: require("../js/estimate.js"), Date };
  return JSON.parse(JSON.stringify(stand.run("projectSnapshot", ctx)()));
}

/* Настоящий restoreProject над переданным проектом. realSync=true — исполнить и настоящий
   syncOfferOptions, чтобы наблюдать выставленный select (иначе select не нужен и стаб). Возвращает
   {settings, select}. Посты пустые — миграция групп света (dropOrphanKeyGroups) не срабатывает,
   каталог/подбор не нужны. */
async function realRestore(project, opts) {
  const realSync = !!(opts && opts.realSync);
  const dom = stand.makeDom({ selects: ["offer-assemblyView"] });
  dom.$("offer-assemblyView").innerHTML = '<option value="exploded"></option><option value="assembled"></option>';
  const ctx = {
    ProjectStore: { load: () => project },
    state: {}, EPPosts, EPBuilderSlots, product: () => null,
    EPConfig: { gridSteps: [10], gridDefault: 10, viewMinScale: 0.1, viewMaxScale: 10 },
    EPViewport: { clampScale: s => s },
    EPOfferOptions,
    EP_DATA: { settings: {} },
    $: dom.$,
    fillDocHeaderInputs() {}, markCanvasUsed() {}, highlightActiveOfferPreset() {},
    console: { info() {} },
    Object, Number, Array, Date, Promise, String
  };
  const names = ["controlPlaceKind", "isControlPlaceItem", "keySlotKind", "dropOrphanKeyGroups"];
  if (realSync) names.push("syncOfferOptions"); else ctx.syncOfferOptions = () => {};
  names.push("relabelContourRooms", "restoreProject");
  await stand.runNamed(names, ctx)();
  return { settings: ctx.EP_DATA.settings, select: dom.els["offer-assemblyView"].value };
}

test("Б2 круг сохранить→открыть: «Общая сборка» доживает до настройки проекта и до select", async () => {
  const snap = realSnapshot("assembled");
  assert.equal(snap.assemblyView, "assembled", "projectSnapshot записал вид отдельным полем проекта");
  /* значение из настоящего снимка отдаём настоящему restoreProject — та же дорога, что через ProjectStore */
  const out = await realRestore({ posts: [], assemblyView: snap.assemblyView }, { realSync: true });
  assert.equal(out.settings.assemblyView, "assembled", "restoreProject поднял вид из проекта");
  assert.equal(out.select, "assembled", "select показал восстановленный вид (экран сошёлся с документом)");
});

test("Б2 restoreProject: миграция из раннего черновика (вид лежал внутри offerOptions)", async () => {
  const out = await realRestore({ posts: [], offerOptions: { assemblyView: "assembled" } });
  assert.equal(out.settings.assemblyView, "assembled", "вид поднят из offerOptions.assemblyView старого снимка");
});

test("Б2 restoreProject: проект без поля вида открывается со взрыв-схемой", async () => {
  const out = await realRestore({ posts: [] });
  assert.equal(out.settings.assemblyView, "exploded", "старый проект — прежнее поведение");
});
