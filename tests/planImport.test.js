/* Импорт планов (js/planImport.js) — три стража без браузера:
   1) вендорные файлы, которые модуль грузит по жёстким путям, физически на месте
      (именно их отсутствие ломало PDF/DXF/DWG: «Failed to fetch dynamically imported module»);
   2) маршрутизация по СИГНАТУРЕ первых байтов (общий EPImageFormats) — PNG/JPG(JFIF)/WEBP/GIF/BMP/
      AVIF/SVG читаются как картинка, HEIC уходит в конвертер EPHeicImport (здесь — заглушка), мусор отклоняется;
   3) вендорный dxf-parser действительно разбирает ASCII DXF (а не только «подключается»).
   PDF/DWG через PDF.js и wasm требуют DOM/модульного рантайма браузера — здесь не проверяются,
   как это сделать вручную описано в отчёте и в tests ниже коротко. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "js", "planImport.js"), "utf8");

test("вендорные ассеты, которые грузит planImport.js, лежат на диске", () => {
  // Берём пути прямо из исходника модуля, чтобы тест не отстал от кода при смене путей.
  const refs = new Set((SRC.match(/vendor\/[\w./-]+/g) || []));
  assert.ok(refs.size >= 7, `в модуле должны быть ссылки на vendor/, найдено ${refs.size}`);
  for (const ref of refs) {
    const full = path.join(ROOT, ref);
    assert.ok(fs.existsSync(full), `нет вендорного ресурса: ${ref}`);
    // Каталоги pdf.js (cmaps/iccs/...) не должны быть пустыми, иначе рантайм упадёт позже.
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      assert.ok(fs.readdirSync(full).length > 0, `вендорный каталог пуст: ${ref}`);
    } else {
      assert.ok(stat.size > 0, `вендорный файл пуст: ${ref}`);
    }
  }
});

test("wasm-конвертер DWG укомплектован glue-скриптом и бинарником", () => {
  // index.js делает import(`${wasmBase}/dwgdxf.js`) и грузит `${wasmBase}/dwgdxf_bg.wasm`.
  const glue = path.join(ROOT, "vendor", "dwgdxf", "wasm", "dwgdxf.js");
  const binary = path.join(ROOT, "vendor", "dwgdxf", "wasm", "dwgdxf_bg.wasm");
  assert.ok(fs.existsSync(glue) && fs.statSync(glue).size > 0, "нет vendor/dwgdxf/wasm/dwgdxf.js");
  assert.ok(fs.existsSync(binary) && fs.statSync(binary).size > 100000, "нет/пуст vendor/dwgdxf/wasm/dwgdxf_bg.wasm");
});

// Прогоняем IIFE модуля в песочнице с минимальными заглушками DOM: ветка картинок зависит только от
// FileReader, file.slice (чтение заголовка) и общего EPImageFormats; остальное (PDF/CAD) сюда не заходит.
const EPImageFormats = require("../js/imageFormats.js");
/* Заглушка декодера HEIC: настоящий (vendor/heic-to) требует браузера (Worker/canvas), поэтому
   маршрут HEIC в модуле проверяем с подменой — она лишь подтверждает, что importFile зовёт ОДНО
   место конверсии и возвращает его data-URL JPEG. Счётчик вызовов — чтобы мутация «не звать
   конвертер» покраснела. */
const heicStub = { calls: 0, lastFile: null,
  toJpegDataUrl(file) { this.calls++; this.lastFile = file; return Promise.resolve("data:image/jpeg;base64,HEICJPEG"); } };
function loadModule() {
  const sandbox = {
    window: {}, URL, TextDecoder, EPImageFormats, EPHeicImport: heicStub,
    DOMException: typeof DOMException !== "undefined" ? DOMException : Error,
    document: {
      baseURI: "http://localhost/",
      currentScript: { src: "http://localhost/js/planImport.js" },
      head: { appendChild() {} },
      createElement: () => ({})
    }
  };
  sandbox.FileReader = class {
    readAsDataURL() { this.result = "data:image/png;base64,AAAA"; setTimeout(() => this.onload && this.onload(), 0); }
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "planImport.js" });
  return sandbox.window.EPPlanImport;
}

// Настоящие первые байты каждого формата: модуль теперь маршрутизирует по СИГНАТУРЕ, не по расширению.
const A = s => [...s].map(c => c.charCodeAt(0));
const SIGS = {
  jpeg: [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46],
  png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0],
  gif: A("GIF89a"),
  bmp: A("BMxx"),
  webp: [...A("RIFF"), 0, 0, 0, 0, ...A("WEBP"), ...A("VP8 ")],
  avif: [0, 0, 0, 0x1C, ...A("ftyp"), ...A("avif"), 0, 0, 0, 0, ...A("avifmif1")],
  heic: [0, 0, 0, 0x18, ...A("ftyp"), ...A("heic"), 0, 0, 0, 0, ...A("mif1heic")],
  svg: A('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  junk: A("this is definitely not an image file at all")
};
// Фейк-файл: slice отдаёт байты заголовка (сигнатура), arrayBuffer — для PDF/CAD-ветки.
const fakeFile = (name, header = [], size = 16, type = "") => {
  const bytes = new Uint8Array(header);
  const blob = { async arrayBuffer() { return bytes.buffer; } };
  return { name, size, type, slice: () => blob, async arrayBuffer() { return bytes.buffer; } };
};

test("растровые картинки маршрутизируются ПО СИГНАТУРЕ: PNG, JPG, WEBP, GIF, BMP, AVIF, SVG", async () => {
  const api = loadModule();
  // Массив приходит из vm-реалма с чужим Array.prototype — копируем, чтобы deepEqual сверял содержимое.
  assert.deepEqual([...api.supportedExtensions],
    ["png", "jpg", "jpeg", "jfif", "jpe", "pjpeg", "pjp", "webp", "gif", "bmp", "avif", "svg", "heic", "heif", "pdf", "dxf", "dwg"]);
  const cases = [["png", "PNG", "image/png"], ["jpeg", "JPG", "image/jpeg"], ["webp", "WEBP", "image/webp"],
    ["gif", "GIF", "image/gif"], ["bmp", "BMP", "image/bmp"], ["avif", "AVIF", "image/avif"], ["svg", "SVG", "image/svg+xml"]];
  for (const [sig, short, mime] of cases) {
    const result = await api.importFile(fakeFile(`plan.bin`, SIGS[sig]));
    assert.equal(result.format, short, `${sig}: короткое имя формата в ответе`);
    assert.ok(result.dataUrl.startsWith("data:" + mime), `${sig}: data-URL с каноническим MIME (${mime})`);
    assert.equal(result.detail, "исходное изображение");
  }
});

test("WhatsApp .jfif (JPEG, пустой type) читается как JPG; .jpg с PNG внутри — как PNG", async () => {
  const api = loadModule();
  const jfif = await api.importFile(fakeFile("plan.jfif", SIGS.jpeg, 16, ""));
  assert.equal(jfif.format, "JPG", "jfif с мессенджера — это JPEG");
  assert.ok(jfif.dataUrl.startsWith("data:image/jpeg"), "MIME починен на image/jpeg (пустой type не помеха)");
  // Сигнатура главнее расширения: файл назвали .jpg, а внутри PNG — читаем как PNG.
  const mislabeled = await api.importFile(fakeFile("plan.jpg", SIGS.png));
  assert.equal(mislabeled.format, "PNG", "решает сигнатура, а не расширение");
});

test("HEIC уходит в конвертер EPHeicImport и возвращается data-URL JPEG", async () => {
  const api = loadModule();
  heicStub.calls = 0;
  const result = await api.importFile(fakeFile("photo.heic", SIGS.heic));
  assert.equal(heicStub.calls, 1, "importFile вызвал ОДНО место конверсии ровно раз");
  assert.equal(result.format, "HEIC", "в статусе — исходный формат HEIC");
  assert.ok(result.dataUrl.startsWith("data:image/jpeg"), "на холст уходит JPEG из конвертера");
  assert.match(result.detail, /HEIC/, "подпись отмечает, что сконвертировано из HEIC");
});

test("неизвестное расширение/мусор и слишком большой файл отклоняются внятно", async () => {
  const api = loadModule();
  await assert.rejects(() => api.importFile(fakeFile("plan.xyz", SIGS.junk)),
    /Поддерживаются PNG, JPG \(JFIF\), WEBP, GIF, BMP, AVIF, SVG, HEIC, PDF, DXF и DWG/);
  await assert.rejects(() => api.importFile(fakeFile("huge.png", SIGS.png, 200 * 1024 * 1024)), /слишком большой/);
});

test("accept, подсказка и текст ошибки собраны из ОДНОГО списка форматов (index.html не разошёлся)", () => {
  const api = loadModule();
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const accept = (html.match(/id="planUpload"[^>]*accept="([^"]*)"/) || [])[1];
  const hint = (html.match(/upload-format-row[\s\S]*?<b>([^<]*)<\/b>/) || [])[1];
  assert.equal(accept, api.acceptAttr, "accept в index.html совпадает со списком модуля");
  assert.equal(hint, api.formatsHint, "подсказка #planUploadPopover совпадает со списком модуля");
  assert.equal(api.unsupportedMessage,
    "Поддерживаются PNG, JPG (JFIF), WEBP, GIF, BMP, AVIF, SVG, HEIC, PDF, DXF и DWG",
    "текст ошибки импорта — из того же перечня");
});

test("вендорный dxf-parser разбирает ASCII DXF с линиями", () => {
  const DxfParser = require("../vendor/dxf-parser/dxf-parser.js");
  const dxf = [
    "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "0", "10", "0", "20", "0", "11", "100", "21", "0",
    "0", "LINE", "8", "0", "10", "100", "20", "0", "11", "100", "21", "80",
    "0", "ENDSEC", "0", "EOF"
  ].join("\n");
  const doc = new DxfParser().parseSync(dxf);
  assert.equal(doc.entities.length, 2, "обе линии разобраны");
  assert.deepEqual(doc.entities.map((e) => e.type), ["LINE", "LINE"]);
  assert.deepEqual(doc.entities[0].vertices, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
});
