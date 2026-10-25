/* Перетаскивание файла плана на холст (js/planDrop.js) — проверяем в Node без браузера.
   Правило владельца 25.10: пока файл несут над холстом — рамка; на drop файл грузится ТЕМ ЖЕ путём,
   что кнопка (одна функция importPlanFile). Здесь:
     1) hasFiles/firstFile — чистые решения «это файлы?» и «какой файл взять»;
     2) attach — drop зовёт onFile первым файлом и снимает рамку; перенос НЕ файлов ничего не делает;
     3) обе точки (кнопка и drop) в app.js зовут ОДНУ importPlanFile (структурно, по исходнику).
   У каждого блока отмечена мутация, которая его красит. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const D = require("../js/planDrop.js");

test("hasFiles: «Files» в types → true, иначе false", () => {
  /* МУТАЦИЯ «всегда true» красит отрицательные случаи; «всегда false» — положительный. */
  assert.equal(D.hasFiles({ types: ["Files"] }), true, "перенос файлов из ОС");
  assert.equal(D.hasFiles({ types: ["text/plain", "Files"] }), true, "Files среди прочих типов");
  assert.equal(D.hasFiles({ types: ["text/plain"] }), false, "перенос текста — не файлы");
  assert.equal(D.hasFiles({ types: [] }), false, "пустой types — не файлы");
  assert.equal(D.hasFiles(null), false, "нет dataTransfer — не файлы");
  assert.equal(D.hasFiles({}), false, "нет types — не файлы");
});

test("firstFile: первый файл из .files, иначе из .items, иначе null", () => {
  const a = { name: "a.jpg" }, b = { name: "b.heic" };
  /* МУТАЦИЯ «вернуть files[1]» красит первый assert; «вернуть null всегда» — все три. */
  assert.equal(D.firstFile({ files: [a, b] }), a, "берём именно первый из .files");
  const got = D.firstFile({ files: [], items: [{ kind: "string" }, { kind: "file", getAsFile: () => b }] });
  assert.equal(got, b, "если .files пуст — первый item с kind==='file'");
  assert.equal(D.firstFile({ files: [] }), null, "файлов нет — null");
  assert.equal(D.firstFile(null), null, "нет dataTransfer — null");
});

/* Фейковый элемент: копит обработчики по типу события, умеет их звать. */
function fakeEl() {
  const h = {};
  return {
    handlers: h,
    addEventListener(type, fn) { (h[type] = h[type] || []).push(fn); },
    removeEventListener(type, fn) { if (h[type]) h[type] = h[type].filter((x) => x !== fn); },
    fire(type, ev) { (h[type] || []).slice().forEach((fn) => fn(ev)); }
  };
}
function dndEvent(types, files) {
  let prevented = false;
  return {
    prevented: () => prevented,
    preventDefault() { prevented = true; },
    dataTransfer: { types, files: files || [] }
  };
}

test("attach: drop с файлом зовёт onFile первым файлом и снимает рамку", () => {
  const el = fakeEl();
  const calls = { onFile: [], show: 0, hide: 0 };
  D.attach({
    el, onFile: (f) => calls.onFile.push(f),
    show: () => calls.show++, hide: () => calls.hide++
  });
  const a = { name: "plan.jpg" };
  const ev = dndEvent(["Files"], [a, { name: "second.png" }]);
  el.fire("drop", ev);
  /* МУТАЦИЯ «drop без вызова загрузки» (убрать onFile(f) в обработчике drop) — этот assert краснеет. */
  assert.deepEqual(calls.onFile, [a], "на drop загружается ровно первый файл");
  assert.equal(ev.prevented(), true, "drop гасит дефолт — браузер не открывает файл сам");
  assert.ok(calls.hide >= 1, "рамка снята после drop");
});

test("attach: drop НЕ файлов ничего не грузит и рамку не трогает", () => {
  const el = fakeEl();
  const calls = { onFile: [], hide: 0 };
  D.attach({ el, onFile: (f) => calls.onFile.push(f), show: () => {}, hide: () => calls.hide++ });
  const ev = dndEvent(["text/plain"], []);
  el.fire("drop", ev);
  /* МУТАЦИЯ «реагировать на любой drop» (убрать проверку hasFiles) красит оба assert. */
  assert.deepEqual(calls.onFile, [], "перенос текста ничего не грузит");
  assert.equal(ev.prevented(), false, "дефолт не гасим — внутренний drag/текст работают как раньше");
});

test("attach: dragenter с файлами показывает рамку и гасит дефолт, dragover non-files — нет", () => {
  const el = fakeEl();
  let shown = 0;
  D.attach({ el, onFile: () => {}, show: () => shown++, hide: () => {} });
  const enter = dndEvent(["Files"], []);
  el.fire("dragenter", enter);
  assert.equal(shown, 1, "рамка показана, когда над холстом несут файл");
  assert.equal(enter.prevented(), true, "dragenter с файлами гасит дефолт");

  const overText = dndEvent(["text/plain"], []);
  el.fire("dragover", overText);
  /* МУТАЦИЯ «preventDefault всегда» красит: dragover текста НЕ должен гаситься. */
  assert.equal(overText.prevented(), false, "перенос текста над холстом не перехватывается");
});

test("attach: Esc снимает рамку (hide через escTarget)", () => {
  const el = fakeEl(), esc = fakeEl();
  let hidden = 0;
  D.attach({ el, escTarget: esc, onFile: () => {}, show: () => {}, hide: () => hidden++ });
  esc.fire("keydown", { key: "Escape" });
  assert.equal(hidden, 1, "Esc снимает рамку");
  esc.fire("keydown", { key: "a" });
  assert.equal(hidden, 1, "прочие клавиши рамку не трогают");
});

test("страховка: отменённый перенос (dragCancel) — рамку снимает первое mousemove на document", () => {
  const el = fakeEl(), doc = fakeEl(), win = fakeEl();
  let shown = 0, hidden = 0;
  D.attach({ el, doc, win, onFile: () => {}, show: () => shown++, hide: () => hidden++ });
  el.fire("dragenter", dndEvent(["Files"], []));
  assert.equal(shown, 1, "рамка показана, пока несут файл");
  /* dragCancel: ни dragleave, ни drop не пришли — но перенос кончился. Браузер снова шлёт mousemove. */
  doc.fire("mousemove", {});
  /* МУТАЦИЯ «убрать страховку» (не вешать mousemove/pointerdown в arm) — рамка останется, assert краснеет. */
  assert.equal(hidden, 1, "первое mousemove после показа снимает зависшую рамку");
  doc.fire("mousemove", {});
  assert.equal(hidden, 1, "слушатель снят после срабатывания — повторные mousemove рамку не трогают");
});

test("страховка: dragend на window снимает рамку (перенос кончился мимо холста)", () => {
  const el = fakeEl(), doc = fakeEl(), win = fakeEl();
  let hidden = 0;
  D.attach({ el, doc, win, onFile: () => {}, show: () => {}, hide: () => hidden++ });
  el.fire("dragenter", dndEvent(["Files"], []));
  win.fire("dragend", {});
  assert.equal(hidden, 1, "dragend на window снимает рамку");
});

test("app.js: и кнопка, и drop зовут ОДНУ importPlanFile (одно правило загрузки)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  /* МУТАЦИЯ «drop мимо общей функции» (onFile не importPlanFile) или «кнопка мимо неё» красит assert. */
  assert.match(src, /\$\("planUpload"\)\.onchange=[^\n]*importPlanFile\(/, "кнопка «Загрузить план» зовёт importPlanFile");
  assert.match(src, /EPPlanDrop\.attach\(\{[^\n]*onFile:importPlanFile/, "drop на холст зовёт ту же importPlanFile");
});
