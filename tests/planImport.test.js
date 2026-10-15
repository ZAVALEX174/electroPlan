/* Импорт планов (js/planImport.js) — три стража без браузера:
   1) вендорные файлы, которые модуль грузит по жёстким путям, физически на месте
      (именно их отсутствие ломало PDF/DXF/DWG: «Failed to fetch dynamically imported module»);
   2) маршрутизация по расширению — PNG/JPG/JPEG/SVG/WEBP читаются как картинка, мусор отклоняется;
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

// Прогоняем IIFE модуля в песочнице с минимальными заглушками DOM: ветка картинок
// зависит только от FileReader и document.baseURI, остальное (PDF/CAD) в этот путь не заходит.
function loadModule() {
  const sandbox = {
    window: {}, URL, TextDecoder,
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

const fakeFile = (name, size = 16) => ({ name, size, async arrayBuffer() { return new Uint8Array().buffer; } });

test("растровые/векторные картинки читаются напрямую, включая JPG и WEBP", async () => {
  const api = loadModule();
  // Массив приходит из vm-реалма с чужим Array.prototype — копируем, чтобы deepEqual сверял содержимое.
  assert.deepEqual([...api.supportedExtensions], ["png", "jpg", "jpeg", "svg", "webp", "pdf", "dxf", "dwg"]);
  for (const ext of ["png", "jpg", "jpeg", "svg", "webp"]) {
    const result = await api.importFile(fakeFile(`plan.${ext}`));
    assert.equal(result.format, ext.toUpperCase(), `${ext}: формат в ответе`);
    assert.ok(result.dataUrl.startsWith("data:"), `${ext}: вернулся data URL`);
    assert.equal(result.detail, "исходное изображение");
  }
});

test("неизвестное расширение и слишком большой файл отклоняются внятно", async () => {
  const api = loadModule();
  await assert.rejects(() => api.importFile(fakeFile("plan.bmp")), /Поддерживаются PNG, JPG, SVG, WEBP, PDF, DXF и DWG/);
  await assert.rejects(() => api.importFile(fakeFile("huge.png", 200 * 1024 * 1024)), /слишком большой/);
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
