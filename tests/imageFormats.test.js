/* EPImageFormats (js/imageFormats.js) — ОДНО правило «какая это картинка» для плана и бланка КП
   (§7.1). Проверяем чистую часть без браузера: распознавание по НАСТОЯЩИМ первым байтам каждого
   формата, запасной путь по имени/MIME, починку MIME в data-URL и сборку перечня форматов.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     (а) сломать сигнатуру JPEG (FF D8 FF) → красит «JPEG по сигнатуре» и кейс «.jpg с PNG внутри»;
     (б) убрать "jfif" из расширений JPEG → красит «.jfif по имени → jpeg (пустой type)»;
     (в) вернуть HEIC в unsupported → красит «HEIC — принимаемый формат» и «списки форматов включают HEIC»;
     (г) убрать HEIC из FORMATS → красит те же два теста (HEIC не распознаётся / нет в accept);
     (д) ftypBrands возвращает ТОЛЬКО major-бренд (без совместимых) → красит «mif1-major + avif-совместимый → AVIF»
         (major mif1 ушёл бы в HEIC, потому что avif лежит именно в совместимых брендах).
   Запуск: node --test tests/imageFormats.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../js/imageFormats.js");

const A = s => [...s].map(c => c.charCodeAt(0));
const U = arr => new Uint8Array(arr);
// Настоящие первые байты каждого формата (магические слова/боксы).
const BYTES = {
  jpeg: U([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, ...A("JFIF")]),
  png: U([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]),
  gif87: U(A("GIF87a\0\0")),
  gif89: U(A("GIF89a\0\0")),
  bmp: U(A("BM\0\0\0\0")),
  webp: U([...A("RIFF"), 0, 0, 0, 0, ...A("WEBP"), ...A("VP8 ")]),
  avif: U([0, 0, 0, 0x1C, ...A("ftyp"), ...A("avif"), 0, 0, 0, 0, ...A("avifmif1")]),
  avis: U([0, 0, 0, 0x1C, ...A("ftyp"), ...A("avis"), 0, 0, 0, 0, ...A("avismif1")]),
  heic: U([0, 0, 0, 0x18, ...A("ftyp"), ...A("heic"), 0, 0, 0, 0, ...A("mif1heic")]),
  heicMif1: U([0, 0, 0, 0x18, ...A("ftyp"), ...A("mif1"), 0, 0, 0, 0, ...A("mif1heic")]),
  // major-бренд mif1 (общий HEIF), а «avif» лежит СРЕДИ СОВМЕСТИМЫХ — так пишут некоторые AVIF-энкодеры.
  avifMif1: U([0, 0, 0, 0x1C, ...A("ftyp"), ...A("mif1"), 0, 0, 0, 0, ...A("avifmif1")]),
  svg: U(A('<?xml version="1.0" encoding="UTF-8"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>')),
  junk: U(A("Just a plain text file, not an image."))
};

test("формат определяется по НАСТОЯЩЕЙ сигнатуре первых байтов", () => {
  assert.equal(F.detect(BYTES.jpeg, "x").format, "jpeg");
  assert.equal(F.detect(BYTES.png, "x").format, "png");
  assert.equal(F.detect(BYTES.gif87, "x").format, "gif");
  assert.equal(F.detect(BYTES.gif89, "x").format, "gif");
  assert.equal(F.detect(BYTES.bmp, "x").format, "bmp");
  assert.equal(F.detect(BYTES.webp, "x").format, "webp");
  assert.equal(F.detect(BYTES.avif, "x").format, "avif");
  assert.equal(F.detect(BYTES.avis, "x").format, "avif");
  assert.equal(F.detect(BYTES.svg, "x").format, "svg");
});

test("каждый принятый формат отдаёт канонический MIME для data-URL", () => {
  assert.equal(F.detect(BYTES.jpeg, "x").mime, "image/jpeg");
  assert.equal(F.detect(BYTES.png, "x").mime, "image/png");
  assert.equal(F.detect(BYTES.webp, "x").mime, "image/webp");
  assert.equal(F.detect(BYTES.gif89, "x").mime, "image/gif");
  assert.equal(F.detect(BYTES.bmp, "x").mime, "image/bmp");
  assert.equal(F.detect(BYTES.avif, "x").mime, "image/avif");
  assert.equal(F.detect(BYTES.svg, "x").mime, "image/svg+xml");
});

test("HEIC — принимаемый формат (не unsupported); mif1+heic — это HEIC, а не AVIF", () => {
  const h1 = F.detect(BYTES.heic, "x");
  assert.equal(h1.format, "heic");
  assert.ok(!h1.unsupported, "HEIC декодируется (EPHeicImport) — больше не unsupported");
  assert.equal(h1.mime, "image/heic", "канонический mime для data-URL");
  assert.equal(F.detect(BYTES.heicMif1, "x").format, "heic", "mif1 с брендом heic — это HEIC, а не AVIF");
});

test("AVIF с major-брендом mif1 и avif В СОВМЕСТИМЫХ распознаётся как AVIF (бренд решает не только major)", () => {
  // Разводит AVIF и HEIC по НАБОРУ брендов, а не по одному major: avif лежит среди совместимых —
  // если бы читали только major (mif1), файл ушёл бы в HEIC. AVIF проверяется первым и выигрывает.
  assert.equal(F.detect(BYTES.avifMif1, "x").format, "avif", "avif в совместимых брендах главнее major mif1");
  assert.equal(F.detect(BYTES.avifMif1, "x").mime, "image/avif", "канонический mime AVIF для data-URL");
});

test("запасной путь: image/heif и image/heic-sequence — синонимы HEIC (как image/jpg для JPEG)", () => {
  assert.equal(F.recognize("noext", "image/heif").format, "heic", "image/heif — синоним HEIC");
  assert.equal(F.recognize("noext", "image/heic-sequence").format, "heic", "image/heic-sequence — синоним HEIC");
  assert.equal(F.recognize("photo.heic", "").format, "heic", ".heic по имени");
  assert.equal(F.recognize("photo.heif", "").format, "heic", ".heif по имени");
});

test("сигнатура ГЛАВНЕЕ имени: .jpg с байтами PNG распознаётся как PNG", () => {
  assert.equal(F.detect(BYTES.png, "plan.jpg").format, "png");
});

test("запасной путь: .jfif с пустым type → jpeg по имени (байтов нет)", () => {
  assert.equal(F.detect(null, "photo.jfif", "").format, "jpeg");
  assert.equal(F.recognize("photo.jfif", "").format, "jpeg", "recognize распознаёт .jfif");
  // и остальные расширения JPEG
  for (const ext of ["jpg", "jpeg", "jpe", "pjpeg", "pjp"]) {
    assert.equal(F.recognize("a." + ext, "").format, "jpeg", ext);
  }
});

test("запасной путь: по MIME, включая нестандартные синонимы JPEG", () => {
  assert.equal(F.recognize("noext", "image/png").format, "png");
  assert.equal(F.recognize("noext", "image/jpg").format, "jpeg", "image/jpg — синоним JPEG");
  assert.equal(F.recognize("noext", "image/pjpeg").format, "jpeg", "image/pjpeg — синоним JPEG");
});

test("мусор и неизвестное имя → null (ничего не принимаем молча)", () => {
  assert.equal(F.detect(BYTES.junk, "plan.xyz", ""), null);
  assert.equal(F.detect(null, "plan.xyz", ""), null);
  assert.equal(F.recognize("", ""), null);
});

test("withMime чинит пустой/чужой MIME в data-URL, канонический не трогает", () => {
  assert.equal(F.withMime("data:;base64,AAAA", "image/jpeg"), "data:image/jpeg;base64,AAAA");
  assert.equal(F.withMime("data:application/octet-stream;base64,AAAA", "image/jpeg"), "data:image/jpeg;base64,AAAA");
  assert.equal(F.withMime("data:image/png;base64,AAAA", "image/png"), "data:image/png;base64,AAAA");
  assert.equal(F.withMime("data:image/svg+xml,<svg/>", "image/svg+xml"), "data:image/svg+xml,<svg/>");
  // Не data-URL или пустой mime — оставляем как есть.
  assert.equal(F.withMime("нечто", "image/png"), "нечто");
  assert.equal(F.withMime("data:image/png;base64,AAAA", ""), "data:image/png;base64,AAAA");
});

test("listWithAnd собирает перечень форматов через запятую и «и» перед последним", () => {
  assert.equal(F.listWithAnd(F.rasterLabels.concat(["PDF", "DXF", "DWG"])),
    "PNG, JPG (JFIF), WEBP, GIF, BMP, AVIF, SVG, HEIC, PDF, DXF и DWG");
  assert.equal(F.listWithAnd(["A"]), "A");
  assert.equal(F.listWithAnd(["A", "B"]), "A и B");
});

test("списки форматов (расширения/MIME/подписи) включают HEIC — он принимается", () => {
  assert.deepEqual(F.rasterExtensions,
    ["png", "jpg", "jpeg", "jfif", "jpe", "pjpeg", "pjp", "webp", "gif", "bmp", "avif", "svg", "heic", "heif"]);
  // В accept идёт один канонический mime HEIC (image/heif — только синоним при распознавании, как image/jpg).
  assert.deepEqual(F.rasterMimes,
    ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif", "image/svg+xml", "image/heic"]);
  assert.deepEqual(F.rasterLabels, ["PNG", "JPG (JFIF)", "WEBP", "GIF", "BMP", "AVIF", "SVG", "HEIC"]);
  assert.ok(F.rasterExtensions.includes("heic") && F.rasterExtensions.includes("heif"), "heic/heif в принимаемых");
  assert.ok(F.rasterMimes.includes("image/heic"), "image/heic попадёт в accept");
});
