/* Подпись и печать в конце КП (итоги встречи 24.08 §1.3: «Подпись и печать в PDF — опция бланка»).
   Картинки — бланк КОМПАНИИ (EPPrefs.companySignature/companyStamp), приходят в offerPdf data-URL'ами;
   безопасный <img> рисует ОБЩИЙ EPDocImages (§7.1), КОМПоновку блока и его место в документе —
   EPOfferPdf.signatureBlockHtml (KP-only разметка, как подвал условий). Загрузку файла в app.js
   (валидация → чтение → ужатие → EPPrefs) проверяем ПОВЕДЕНЧЕСКИ на общем стенде.

   ГРАНИЦА: подпись и печать идут ТОЛЬКО в КП. В лист монтажника не идут (он не коммерческий
   документ) — застолблено ниже отдельным тестом.

   §7.1 — ОДНО правило «годен ли файл». Проверка живёт в EPDocImages.validateSource; ею пользуются
   ВСЕ три загрузчика картинок (логотип/подпись/печать) через один loadDocImage(file, kind).
   Второй копии нет — застолблено тестом «validateSource определён ровно в одном модуле» и
   поведенческим «loadDocImage(подпись, негодный файл) не сохраняет и называет причину».

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте проверяющему):
     (а) при пустых картинках в документ лезет пустой блок подписи (снят страж if(!sig && !seal)) →
         красит «signature: ничего не загружено → ''» и «без подписи/печати КП байт-в-байт прежний»;
     (б) проверка файла для подписи снята/подменена своей копией → красит «validateSource определён
         ровно в одном модуле» и/или «loadDocImage(подпись) не сохраняет негодный файл, называет причину»;
     (в) блок подписи уехал ПОСЛЕ сводной спецификации → красит «подпись НИЖЕ условий, но ВЫШЕ свода».
   Запуск: node --test tests/documentSignatureStamp.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");
const EPDocImages = require("../js/docImages.js");
const EPOfferPdf = require("../js/offerPdf.js");
const { buildHtml, signatureBlockHtml } = EPOfferPdf;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* Два РАЗНЫХ валидных data-URL картинки: imgHtml их не декодирует (проверяет только префикс
   data:image/…), поэтому base64 может быть произвольным — важно лишь, что подпись и печать
   различимы в разметке и ни один не подстрока другого. */
const SIG = "data:image/png;base64,U0lHUElD";
const STAMP = "data:image/png;base64,U1RBTVBQSUM=";

const est = {
  groups: [{ name: "Выключатель", composition: "20001", count: 2, unit: "шт", sum: 40 }],
  equipment: 40, discount: 0, materials: 5, work: 10, subtotal: 55, vat: 0, total: 55
};
/* Дату фиксируем — два прогона buildHtml сравниваются побайтно без гонки с new Date(). */
const deps = { money: n => String(n) + " €", esc, displayCurrency: () => "EUR", settings: {},
  header: { project: "Дом", developer: "Иван Петров", date: "01.01.2026" } };

/* ---- signatureBlockHtml: чистая разметка блока ---- */
test("signatureBlockHtml: обе картинки → подпись И печать, подпись раньше печати", () => {
  const out = signatureBlockHtml(SIG, STAMP, "Иван Петров", esc);
  assert.match(out, /class="signature"/, "блок подписи есть");
  assert.ok(out.includes(SIG) && out.includes(STAMP), "обе картинки в блоке");
  assert.match(out, /alt="Подпись"/, "у первой картинки alt Подпись");
  assert.match(out, /alt="Печать"/, "у второй картинки alt Печать");
  assert.ok(out.indexOf(SIG) < out.indexOf(STAMP), "подпись стоит раньше печати");
});

test("signatureBlockHtml: загружена ТОЛЬКО подпись → она одна, без ячейки под печать", () => {
  const out = signatureBlockHtml(SIG, "", "Иван Петров", esc);
  assert.match(out, /class="signature"/, "блок есть");
  assert.ok(out.includes(SIG), "подпись напечатана");
  assert.ok(!out.includes("alt=\"Печать\""), "печати нет");
  assert.equal((out.match(/class="sign-col"/g) || []).length, 1, "ровно одна ячейка — пустого места под печать нет");
});

test("signatureBlockHtml: загружена ТОЛЬКО печать → она одна (фамилия без подписи не выводится)", () => {
  const out = signatureBlockHtml("", STAMP, "Иван Петров", esc);
  assert.match(out, /class="signature"/, "блок есть");
  assert.ok(out.includes(STAMP), "печать напечатана");
  assert.ok(!out.includes("alt=\"Подпись\""), "подписи нет");
  assert.ok(!/sign-name/.test(out), "фамилия стоит под подписью — без подписи её нет");
});

test("signatureBlockHtml: ничего не загружено → '' (никакого пустого блока)", () => {
  assert.equal(signatureBlockHtml("", "", "Иван Петров", esc), "", "обе пустые → пустая строка");
  assert.equal(signatureBlockHtml(undefined, undefined, "Иван Петров", esc), "", "не строки → пустая строка");
  /* Не-data-URL (внешний путь) картинкой не считается — так же, как у логотипа. */
  assert.equal(signatureBlockHtml("http://x/y.png", "не-url", "Иван", esc), "", "не data-URL → пустая строка");
});

test("signatureBlockHtml: фамилия из «Разработчик» стоит под подписью и экранируется", () => {
  const out = signatureBlockHtml(SIG, STAMP, "<b>Иван</b> & Ко", esc);
  assert.match(out, /class="sign-name"/, "фамилия выведена");
  assert.ok(!/<b>Иван<\/b>/.test(out), "живого тега из фамилии в разметке нет");
  assert.match(out, /&lt;b&gt;Иван&lt;\/b&gt; &amp; Ко/, "фамилия экранирована как текст");
  assert.ok(out.indexOf(SIG) < out.indexOf("sign-name"), "фамилия НИЖЕ подписи");
});

test("signatureBlockHtml: пустой/пробельный «Разработчик» → блок без фамилии", () => {
  assert.ok(!/sign-name/.test(signatureBlockHtml(SIG, STAMP, "   ", esc)), "пробелы — не фамилия");
  assert.ok(!/sign-name/.test(signatureBlockHtml(SIG, STAMP, undefined, esc)), "нет поля — нет фамилии");
});

/* ---- КП (offerPdf) ---- */
test("обе картинки загружены → обе печатаются в КП", () => {
  const html = buildHtml(est, Object.assign({}, deps, { signature: SIG, stamp: STAMP }));
  assert.ok(html.includes(SIG) && html.includes(STAMP), "подпись и печать в КП");
  assert.match(html, /class="signature"/, "блок подписи в документе");
});

test("загружена только одна картинка → печатается она одна, без пустого места под вторую", () => {
  const onlySig = buildHtml(est, Object.assign({}, deps, { signature: SIG }));
  assert.ok(onlySig.includes(SIG) && !onlySig.includes(STAMP), "только подпись");
  assert.equal((onlySig.match(/class="sign-col"/g) || []).length, 1, "одна ячейка на подпись");
  const onlyStamp = buildHtml(est, Object.assign({}, deps, { stamp: STAMP }));
  assert.ok(onlyStamp.includes(STAMP) && !onlyStamp.includes(SIG), "только печать");
  assert.equal((onlyStamp.match(/class="sign-col"/g) || []).length, 1, "одна ячейка на печать");
});

test("ничего не загружено → КП байт-в-байт как без подписи/печати", () => {
  const base = buildHtml(est, deps);                       // ключей signature/stamp нет вовсе
  assert.ok(!/class="signature"/.test(base), "без картинок блока подписи в КП нет");
  const variants = [
    { signature: undefined, stamp: undefined },
    { signature: "", stamp: "" },
    { signature: "не-url", stamp: "http://x/y.png" }
  ];
  for (const v of variants) {
    assert.equal(buildHtml(est, Object.assign({}, deps, v)), base,
      `${JSON.stringify(v)} даёт документ байт-в-байт как без подписи/печати`);
  }
});

test("блок подписи стоит НИЖЕ подвала условий, но ВЫШЕ свода поставщика (не уезжает с отрывным листом)", () => {
  const marker = '<section data-test="supplier">свод</section>';
  const html = buildHtml(est, Object.assign({}, deps, {
    signature: SIG, stamp: STAMP, terms: "Условия оплаты: 50%.", supplierSpecHtml: marker }));
  const posTotals = html.indexOf("Итого");
  const posTerms = html.indexOf('class="terms"');
  const posSign = html.indexOf('class="signature"');
  const posSupplier = html.indexOf(marker);
  assert.ok(posSign > posTotals, "подпись ниже денежных итогов");
  assert.ok(posSign > posTerms, "подпись ниже подвала условий");
  assert.ok(posSupplier > -1 && posSign < posSupplier, "подпись выше свода поставщика (остаётся при КП)");
});

/* ---- Граница: подпись/печать НЕ идут в лист монтажника (не коммерческий документ) ---- */
test("app.js передаёт подпись/печать в КП, но НЕ в лист монтажника", () => {
  const offer = stand.functionSource("generateCommercialOffer");
  assert.match(offer, /signature:\s*companySignature\(\)/, "КП получает подпись");
  assert.match(offer, /stamp:\s*companyStamp\(\)/, "КП получает печать");
  const sheet = stand.functionSource("openInstallSheet");
  assert.match(sheet, /logo:\s*companyLogo\(\)/, "лист монтажника получает логотип");
  assert.ok(!/companySignature|companyStamp/.test(sheet), "подпись/печать в лист монтажника не передаются");
});

/* ---- §7.1: одно правило «годен ли файл» ---- */
test("validateSource определён РОВНО в одном модуле (docImages.js), второй копии нет", () => {
  const jsDir = path.join(__dirname, "..", "js");
  const defs = [];
  for (const f of fs.readdirSync(jsDir).filter(n => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(jsDir, f), "utf8");
    if (/function\s+validateSource\s*\(/.test(src)) defs.push(f);
  }
  assert.deepEqual(defs, ["docImages.js"], "единственное определение validateSource — в docImages.js");
});

/* ---- Загрузчик подписи (app.js loadDocImage, kind=signature) ---- */
function makeSignatureCtx() {
  const toast = (() => { const f = m => { f.msg = m; f.calls++; }; f.calls = 0; return f; })();
  const set = (() => { const f = (k, v) => { f.last = [k, v]; f.calls++; }; f.calls = 0; return f; })();
  const readCalls = [];
  function FileReader() { this.readAsDataURL = function () { readCalls.push(1); this.result = "data:image/png;base64,SRC"; if (this.onload) this.onload(); }; }
  function Image() { const self = this; Object.defineProperty(self, "src", { set() { self.width = 200; self.height = 100; if (self.onload) self.onload(); } }); }
  const document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64,OUT" }) };
  /* DOC_IMAGES отдаём сюда данными, как стенд отдаёт остальную лексику app.js: под проверкой —
     общий loadDocImage и настоящий EPDocImages.validateSource, а не эта таблица. */
  return {
    ctx: { EPDocImages, toast, EPPrefs: { set, get: () => "" }, FileReader, Image, document,
      renderDocImage: () => {}, DOC_IMAGE_PRINT_H: 160, DOC_IMAGE_MAX_W: 480,
      DOC_IMAGES: { signature: { pref: "companySignature", subject: "подписи", alt: "Подпись",
        preview: "docSignaturePreview", remove: "docSignatureRemove", saved: "Подпись сохранена" } } },
    toast, set, readCalls
  };
}

test("loadDocImage(подпись): негодный файл не сохраняется, причина названа словами", () => {
  const { ctx, toast, set, readCalls } = makeSignatureCtx();
  const load = stand.run(["loadDocImage"], ctx);
  load({ type: "application/pdf", size: 1000 }, "signature");   // не картинка
  assert.equal(set.calls, 0, "битый файл подписи в EPPrefs не сохранён");
  assert.equal(readCalls.length, 0, "до чтения дело не дошло — отказали раньше");
  assert.equal(toast.calls, 1, "человеку показано сообщение");
  assert.match(toast.msg, /картинк/i, "сообщение объясняет, что нужна картинка");
  assert.match(toast.msg, /подписи/, "названо, что забракован именно файл подписи");
});

test("loadDocImage(подпись): годная картинка сохраняется в EPPrefs.companySignature", () => {
  const { ctx, set } = makeSignatureCtx();
  const load = stand.run(["loadDocImage"], ctx);
  load({ type: "image/png", size: 1000 }, "signature");
  assert.equal(set.calls, 1, "подпись сохранена один раз");
  assert.equal(set.last[0], "companySignature", "ключ EPPrefs — подпись компании");
  assert.match(set.last[1], /^data:image\/png/, "сохранён ужатый растр data-URL'ом");
});
