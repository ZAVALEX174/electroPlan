/* Б2 — выбор вида поста в листе монтажника: «Общая сборка» / «Взрыв-схема».
   Проверяем НАСТОЯЩИЙ код: чистую installSheet.buildHtml, нормализацию EPOfferOptions и связки
   app.js (openInstallSheet — прокидывает выбор из настроек КП в документ; applyOfferOption —
   сохраняет выбор в снимок проекта) через общий стенд appStand.js. Браузер не поднимаем. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPInstallSheet = require("../js/installSheet.js");
const EPOfferOptions = require("../js/offerOptions.js");

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

test("Б2 buildHtml: «взрыв-схема» — собранная накладка И взрыв-схема", () => {
  const html = EPInstallSheet.buildHtml({ posts: [post], assemblyView: "exploded" }, { esc });
  assert.match(html, /MARK-ASM/);
  assert.match(html, /MARK-EXP/);
});

test("Б2 buildHtml: чужое значение вида читается как взрыв-схема (умолчание)", () => {
  const html = EPInstallSheet.buildHtml({ posts: [post], assemblyView: "мусор" }, { esc });
  assert.match(html, /MARK-EXP/, "неизвестный вид не должен прятать взрыв-схему");
});

test("Б2 normalize: по умолчанию взрыв-схема, «assembled» сохраняется, чужое сводится к взрыв-схеме", () => {
  assert.equal(EPOfferOptions.normalize(null).assemblyView, "exploded");
  assert.equal(EPOfferOptions.normalize({}).assemblyView, "exploded");
  assert.equal(EPOfferOptions.normalize({ assemblyView: "assembled" }).assemblyView, "assembled");
  assert.equal(EPOfferOptions.normalize({ assemblyView: "explode-me" }).assemblyView, "exploded");
  /* существующие наборы столбцов, где вид не задан, печатают лист как раньше */
  assert.equal(EPOfferOptions.preset("builder").assemblyView, "exploded");
  assert.equal(EPOfferOptions.preset("client").assemblyView, "exploded");
});

/* Прогон НАСТОЯЩЕГО openInstallSheet из app.js: настройка КП → normalize → buildHtml → документ.
   window.open подменяем перехватчиком записи, всё остальное — реальные модули. */
function openInstallSheetHtml(offerOptions) {
  let written = "";
  const win = { document: { write: s => { written += s; }, close() {} } };
  const ctx = {
    Object, Array, Number, String, RegExp, JSON,
    window: { open: () => win },
    toast: () => {},
    docHeader: () => ({ project: "П", developer: "Р", date: "Д" }),
    EPInstallSheet, EPOfferOptions,
    EP_DATA: { settings: { offerOptions } },
    esc,
    companyLogo: () => ""
  };
  stand.run("openInstallSheet", ctx)({ posts: [post] });
  return written;
}

test("Б2 связка openInstallSheet: настройка «Общая сборка» доходит до листа монтажника", () => {
  const assembled = openInstallSheetHtml({ assemblyView: "assembled" });
  assert.match(assembled, /MARK-ASM/, "собранная накладка в листе");
  assert.doesNotMatch(assembled, /MARK-EXP/, "взрыв-схемы в режиме общей сборки нет");

  const exploded = openInstallSheetHtml({ assemblyView: "exploded" });
  assert.match(exploded, /MARK-EXP/, "в режиме взрыв-схемы она печатается");

  /* существующий проект без поля вида — прежнее поведение (взрыв-схема) */
  const legacy = openInstallSheetHtml({});
  assert.match(legacy, /MARK-EXP/, "старый снимок проекта печатает лист как раньше");
});

test("Б2 связка applyOfferOption: выбор вида сохраняется в снимок проекта", () => {
  let saved = 0;
  const ctx = {
    Object, Array, Number, String,
    EPOfferOptions,
    EP_DATA: { settings: { offerOptions: {} } },
    syncOfferOptions: () => {},
    scheduleSave: () => { saved++; }
  };
  const applyOfferOption = stand.run("applyOfferOption", ctx);
  applyOfferOption({ dataset: { offerKey: "assemblyView" }, value: "assembled" });
  assert.equal(EP_DATA_of(ctx).assemblyView, "assembled", "выбор записан в offerOptions проекта");
  assert.equal(saved, 1, "изменение помечено к сохранению");
  applyOfferOption({ dataset: { offerKey: "assemblyView" }, value: "exploded" });
  assert.equal(EP_DATA_of(ctx).assemblyView, "exploded", "обратно на взрыв-схему");
});
const EP_DATA_of = ctx => EPOfferOptions.normalize(ctx.EP_DATA.settings.offerOptions);
