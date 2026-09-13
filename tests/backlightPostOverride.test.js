/* ПОДСВЕТКА У ОТДЕЛЬНОГО ПОСТА — данные и расчёт (блок ПОДСВЕТКА-B, часть B2b-1).
   Резолвер postBacklight (проект + переопределение поста) держит posts.test. Здесь — два края,
   которые posts.test не ловит, потому что подаёт deps сам:
     · ДЕНЬГИ: два поста с ОДИНАКОВЫМИ механизмами, но РАЗНОЙ подсветкой обязаны дать РАЗНЫЕ
       строки сметы (иначе подсветка первого поста напечатается как подсветка обоих — у строки
       одна цена на все её посты). Идентичная подсветка — одна строка. Считаем на ЖИВЫХ
       EPPosts.postComposition + EPPostFit.findBacklight → estimate.build, а не на рукотворном
       comp: доказываем, что переопределение поста доходит до ключа сметы через настоящий расчёт.
     · ПЕРЕЖИВАНИЕ СОХРАНЕНИЯ: projectSnapshot обязан унести post.backlight дословно (JSON-круг),
       иначе «сохранить → загрузить» тихо теряет переопределение (тот же класс, что забытый
       keyGroups в белом списке savePostBuilder). Исполняем НАСТОЯЩИЙ projectSnapshot из app.js.
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const { build } = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPPostFit = require("../js/postfit.js");

/* Мини-каталог как в posts.test: клавиша pos 3 (принимает подсветку) + два LED разных цветов. */
const CAT = {
  501: { id: 501, code: "09021.N", name: "Клавиша 1M", price: 4.30, moduleSpan: 1, askBacklight: true, backlightPosition: 3 },
  14653: { id: 14653, code: "14653", name: "Накладка Plana 3М", price: 3.0, standard: "IT", series: "Plana", slotCount: 3 },
  610: { id: 610, code: "00936.250.A", price: 9.6, kind: "accessory", askBacklight: true, backlightPosition: 3, backlightColor: "Янтарная" },
  611: { id: 611, code: "00936.250.W", price: 9.6, kind: "accessory", askBacklight: true, backlightPosition: 3, backlightColor: "Белая" }
};
const product = id => CAT[id] || null;
const frameProduct = id => CAT[id] || null;
const accessories = Object.values(CAT).filter(p => p.kind === "accessory");
const findBacklight = opts => EPPostFit.findBacklight(Object.assign({ accessories }, opts));
/* Проект подсветку ВКЛЮЧАЕТ (янтарная): переопределения постов проверяются поверх включённого
   проекта — тогда «выключить у поста» и «сменить цвет» действительно спорят с настройкой. */
const projectBacklight = { enabled: true, color: "Янтарная", voltage: "110-250V" };
const deps = () => ({ product, frameProduct, socketBox: () => null, mechanismSpan: () => 1,
  findBox: () => null, fallbackBox: () => null, findSupport: () => null,
  resolveSupport: () => ({ support: null, assumed: false }),
  wallType: "solid", findBacklight, backlight: projectBacklight });

const settings = { workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 0, vatEnabled: false, wallType: "solid", backlight: projectBacklight };
const runEstimate = posts => build({ posts, product, frameProduct,
  postCost: p => EPPosts.postCost(p, deps()),
  postComposition: p => EPPosts.postComposition(p, deps()), settings });
const post = (over) => Object.assign({ name: "Пост", frameId: 14653, mechanismIds: [501] }, over || {});

test("СМЕТА: пост с подсветкой (проект) vs пост со снятой подсветкой → РАЗНЫЕ строки", () => {
  const inherit = post({ id: "a" });                          // следует проекту: янтарный LED
  const off = post({ id: "b", backlight: { enabled: false } }); // снята у поста: LED нет
  const e = runEstimate([inherit, off]);
  assert.equal(e.groups.length, 2, "включённая и снятая подсветка не должны схлопнуться в одну строку");
});

test("СМЕТА: разный ЦВЕТ у постов (переопределение) → РАЗНЫЕ строки", () => {
  const amber = post({ id: "a" });                                              // проект: янтарный
  const white = post({ id: "b", backlight: { enabled: true, color: "Белая", voltage: "110-250V" } });
  const e = runEstimate([amber, white]);
  assert.equal(e.groups.length, 2, "разные подобранные LED — две строки");
});

test("СМЕТА: одинаковое переопределение у обоих постов → ОДНА строка count 2", () => {
  const bl = { enabled: true, color: "Белая", voltage: "110-250V" };
  const e = runEstimate([post({ id: "a", backlight: bl }), post({ id: "b", backlight: bl })]);
  assert.equal(e.groups.length, 1, "идентичная подсветка — одна строка");
  assert.equal(e.groups[0].count, 2);
});

test("СМЕТА: подобранная подсветка vs пробел (несовместимый цвет) → РАЗНЫЕ строки", () => {
  const ok = post({ id: "a" });                                                 // янтарный есть
  const gap = post({ id: "b", backlight: { enabled: true, color: "Розовая", voltage: "110-250V" } }); // нет в каталоге → пробел
  const e = runEstimate([ok, gap]);
  assert.equal(e.groups.length, 2, "подобранная и пробельная подсветка не сливаются");
});

/* --- Переживание сохранения: НАСТОЯЩИЙ projectSnapshot из app.js -------------------------
   projectSnapshot кладёт posts:state.posts. Мутация «сериализовать посты белым списком без
   backlight» тихо потеряла бы переопределение — этот тест её краснит. */
function snapshotPosts(posts) {
  const dom = stand.makeDom();
  const state = { devices: [], posts, rooms: [], walls: [], autoWalls: [], roomLines: [],
    planVisibility: "show", panX: 0, panY: 0, scale: 1, planLoaded: false,
    orthoMode: true, snapGrid: true, gridStep: 10, pxPerMeter: 100, scaleSegment: null, planLabel: "" };
  const ctx = { state, $: dom.$,
    EP_DATA: { settings: { docHeader: {}, offerOptions: {}, backlight: projectBacklight } },
    EPOfferOptions: { normalize: () => ({}) }, Date };
  const snap = stand.run("projectSnapshot", ctx)();
  /* JSON-круг = ровно то, что уходит в ProjectStore и возвращается restoreProject. */
  return JSON.parse(JSON.stringify(snap)).posts;
}

test("projectSnapshot: переопределение подсветки поста переживает круг сохранить→загрузить (JSON)", () => {
  const posts = [
    { id: "p1", number: 1, frameId: 14653, mechanismIds: [501], keyGroups: [""], backlight: { enabled: false } },
    { id: "p2", number: 2, frameId: 14653, mechanismIds: [501], keyGroups: [""], backlight: { enabled: true, color: "Белая", voltage: "110-250V" } }
  ];
  const restored = snapshotPosts(posts);
  assert.deepEqual(restored[0].backlight, { enabled: false }, "снятие подсветки у поста дожило до загрузки");
  assert.deepEqual(restored[1].backlight, { enabled: true, color: "Белая", voltage: "110-250V" }, "цвет-переопределение дожило до загрузки");
});
