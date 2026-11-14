/* ПОВОРОТ КАРТИНКИ ПОСТА НА 90° при вертикальном расположении (Б8-д, часть 2). Проверяем на НАСТОЯЩЕМ
   каталоге VIMAR (не на фикстуре-тавтологии, §7.1): итальянская 30654.00 + флаг поворачивается, уже
   вертикальная LINEA 30645.00 — нет, без флага — нет, старый пост с вертикальной накладкой без поля — нет.
   Разметку поворота стережём отдельно: с флагом в строке есть rotate(90deg) и поменянные размеры
   контейнера, без флага строка EPPostImage.buildHtml БАЙТ-В-БАЙТ как прежде. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPPostRotation = require("../js/postRotation.js");
const EPPostImage = require("../js/postImage.js");

const FRAMES = stand.loadVimarCatalog().products.filter(p => p.kind === "frame");
const byCode = code => FRAMES.find(f => f.code === code);

test("shouldRotate: итальянская 30654.00 + флаг → поворачиваем", () => {
  const it = byCode("30654.00");
  assert.ok(it, "разведка: 30654.00 есть в каталоге");
  assert.equal(EPPostRotation.shouldRotate(it, true), true,
    "пост вертикален, накладка без вертикального двойника — крутим целиком");
});

test("shouldRotate: итальянская 30654.00 БЕЗ флага → не поворачиваем", () => {
  assert.equal(EPPostRotation.shouldRotate(byCode("30654.00"), false), false);
  assert.equal(EPPostRotation.shouldRotate(byCode("30654.00"), undefined), false,
    "поля-флага нет (старый пост) → не вертикальный → не крутим");
});

test("shouldRotate: уже вертикальная LINEA 30645.00 → не поворачиваем (своё фото, окна одно под другим)", () => {
  const vert = byCode("30645.00");
  assert.ok(vert, "разведка: 30645.00 есть в каталоге");
  assert.equal(EPPostRotation.shouldRotate(vert, true), false, "с флагом вертикальную не крутим");
  assert.equal(EPPostRotation.shouldRotate(vert, false), false, "и без флага тоже (она сама вертикальна)");
});

test("shouldRotate: старый пост с вертикальной накладкой 30645.00 БЕЗ поля verticalLayout → не крутим", () => {
  // isVerticalPost вернёт true по самой накладке, но крутить вертикальную нельзя
  assert.equal(EPPostRotation.shouldRotate(byCode("30645.00"), undefined), false);
});

test("shouldRotate: нет накладки (frame=null) → не поворачиваем", () => {
  assert.equal(EPPostRotation.shouldRotate(null, true), false);
  assert.equal(EPPostRotation.shouldRotate(undefined, false), false);
});

test("wrapRotated: меняет местами ширину/высоту контейнера и вставляет поворот по часовой", () => {
  const html = EPPostRotation.wrapRotated("<i>scene</i>", 200, 80);
  assert.match(html, /rotate\(90deg\)/, "есть поворот на 90°");
  assert.match(html, /translateX\(80px\) rotate\(90deg\)/, "сдвиг на прежнюю высоту возвращает сцену вправо");
  assert.match(html, /width:80px;height:200px/, "внешний контейнер высокий: ширина = прежняя высота, высота = прежняя ширина");
  assert.match(html, /width:200px;height:80px/, "внутренний блок сохраняет натуральные w×h");
  assert.match(html, /<i>scene<\/i>/, "сцена внутри");
});

test("wrapRotated: размеры неизвестны (≤0) → возвращает сцену как есть, без обёртки", () => {
  assert.equal(EPPostRotation.wrapRotated("<i>scene</i>", 0, 80), "<i>scene</i>");
  assert.equal(EPPostRotation.wrapRotated("<i>scene</i>", 200, 0), "<i>scene</i>");
});

/* --- РАЗМЕТКА EPPostImage.buildHtml: с флагом есть поворот, без флага байт-в-байт как прежде --- */
const spec = () => ({
  size: "md",
  frame: { name: "Накладка на 4 модуля белая", code: "30654.00" },
  rows: [{ posts: [{ capacity: 2, cells: [
    { span: 1, empty: true, num: "1" }, { span: 1, empty: true, num: "2" }
  ] }] }]
});

test("buildHtml: без spec.rotate строка БАЙТ-В-БАЙТ как прежде (нет поворота)", () => {
  const plain = EPPostImage.buildHtml(spec(), { esc: s => String(s == null ? "" : s) });
  const withFlagFalse = EPPostImage.buildHtml(Object.assign(spec(), { rotate: false }), { esc: s => String(s == null ? "" : s) });
  assert.equal(withFlagFalse, plain, "rotate:false не меняет разметку");
  assert.doesNotMatch(plain, /rotate\(90deg\)/, "без флага поворота в разметке нет");
  assert.match(plain, /class="assembled-post"/, "обычная сцена на месте");
});

test("buildHtml: со spec.rotate=true сцена обёрнута поворотом, подпись не внутри поворота", () => {
  const rotated = EPPostImage.buildHtml(Object.assign(spec(), { rotate: true }), { esc: s => String(s == null ? "" : s) });
  assert.match(rotated, /rotate\(90deg\)/, "картинка повёрнута на 90°");
  assert.match(rotated, /class="assembled-rotated"/, "есть контейнер с поменянными размерами");
  assert.match(rotated, /class="assembled-post"/, "внешняя обёртка-подпись сохранена");
});

test("Reflex 30654.40: подпись помещается в видимую ширину повёрнутого фото", () => {
  const source = byCode("30654.40");
  assert.ok(source && source.imageUrl, "используем настоящую накладку Reflex с фото");
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "catalog-vimar-openings.js"), "utf8"), { window: win });
  const measured = win.EP_VIMAR_OPENINGS["30654"];
  assert.ok(measured && measured.aspect > 1 && measured.rects.length === 1,
    "берём измеренное широкое фото и его окно из каталога");
  const windows = measured.rects.map(([left, top, width, height]) =>
    ({ left, top, width, height, aspect: measured.aspect }));
  const frame = { ...source, opening: windows[0], windows };
  const post = {
    size: "lg", frame,
    rows: [{ posts: [{ capacity: 4, cells: [1, 2, 3, 4].map(num => ({ span: 1, empty: true, num })) }] }]
  };
  const deps = { esc: s => String(s == null ? "" : s) };
  const plain = EPPostImage.buildHtml(post, deps);
  const rotated = EPPostImage.buildHtml({ ...post, rotate: true }, deps);
  const captionWidth = html => Number(html.match(/text-align:center;max-width:(\d+)px/)[1]);
  const box = rotated.match(/class="assembled-rotated" style="[^"]*width:(\d+)px;height:(\d+)px/);
  assert.ok(box, "фото действительно повёрнуто в контейнере с измеримыми габаритами");
  const visibleWidth = Number(box[1]), visibleHeight = Number(box[2]);
  assert.ok(visibleWidth < visibleHeight, "широкое фото после поворота становится узким и высоким");
  assert.equal(captionWidth(rotated), visibleWidth, "подпись ограничена ВИДИМОЙ шириной фото");
  assert.equal(captionWidth(plain), visibleHeight, "без поворота подпись ограничена исходной шириной фото");
});
