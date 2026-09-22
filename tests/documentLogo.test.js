/* Логотип компании в шапке КП и листа монтажника (запрос заказчика: свой логотип в документах).
   Проверяем ОДНО правило разметки логотипа на оба документа (§7.1): элемент рисует общий
   EPDocImages, а КП и лист монтажника только ставят готовую строку в свою (разную) шапку.
   Модули чистые — браузер не поднимаем. Call-site загрузки (валидация файла) проверяем
   ПОВЕДЕНЧЕСКИ: исполняем настоящий loadDocImage из app.js на DOM-шиме (общий стенд).

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     (а) логотип НЕ вставлен в лист монтажника (только в КП)   → красит «лист монтажника печатает логотип…»
                                                                  и «оба документа рисуют ОДИН и тот же <img>…»;
     (б) при пустом логотипе в шапку лезет пустой <img>        → красит «без логотипа шапка КП…» и
                                                                  «…шапка листа монтажника не меняется» (identical + нет alt);
     (в) снята проверка типа/размера файла                     → красит unit-тесты validateSource и
                                                                  «loadDocImage НЕ сохраняет негодный файл…».
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPDocImages = require("../js/docImages.js");
const { buildHtml: offerHtml } = require("../js/offerPdf.js");
const { buildHtml: installHtml } = require("../js/installSheet.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* 1×1 PNG — валидный data-URL картинки; в base64 нет символов, которые esc бы изменил, поэтому
   его можно искать в разметке дословно. */
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
/* Единственный <img> логотипа в документе (постов/иллюстраций в тестовых данных нет). */
const logoImgOf = html => (html.match(/<img[^>]*alt="Логотип компании"[^>]*>/) || [null])[0];

/* ---- EPDocImages: чистое правило (годность файла + разметка элемента) ---- */
test("validateSource: не картинка — отказ со словами, картинка — ok", () => {
  const bad = EPDocImages.validateSource({ type: "application/pdf", size: 1000 });
  assert.equal(bad.ok, false, "pdf — не картинка");
  assert.match(bad.reason, /картинк/i, "человеку сказано, что нужна картинка");
  assert.equal(EPDocImages.validateSource({ type: "image/png", size: 1000 }).ok, true, "png принят");
  assert.equal(EPDocImages.validateSource({ type: "image/svg+xml", size: 1000 }).ok, true, "svg принят");
});

test("validateSource: файл крупнее предела — отказ со словами", () => {
  const big = EPDocImages.validateSource({ type: "image/png", size: EPDocImages.MAX_SOURCE_BYTES + 1 });
  assert.equal(big.ok, false, "за пределом размера — отказ");
  assert.match(big.reason, /большой|МБ/, "причина названа словами");
  assert.equal(EPDocImages.validateSource({ type: "image/png", size: EPDocImages.MAX_SOURCE_BYTES }).ok, true, "ровно на пределе — ok");
});

test("imgHtml: пусто/не data-URL картинки → '' (никакого пустого <img>)", () => {
  assert.equal(EPDocImages.imgHtml("", esc), "", "пусто → пустая строка");
  assert.equal(EPDocImages.imgHtml(undefined, esc), "", "не строка → пустая строка");
  assert.equal(EPDocImages.imgHtml("http://site/logo.png", esc), "", "внешний путь не принимаем");
  assert.equal(EPDocImages.imgHtml("data:text/html,<b>", esc), "", "не картинка не принимается");
});

test("imgHtml: data-URL картинки → <img> с этим src и инлайн-размером", () => {
  const img = EPDocImages.imgHtml(LOGO, esc);
  assert.match(img, /^<img /, "это тег img");
  assert.ok(img.includes(LOGO), "src — переданный data-URL");
  assert.match(img, /max-height:\d+px/, "печатный размер задан ИНЛАЙН (в окне печати JS/классов чужого <style> нет)");
});

/* ---- КП (offerPdf) ---- */
const est = {
  groups: [{ name: "Выключатель", composition: "20001", count: 2, unit: "шт", sum: 40 }],
  equipment: 40, discount: 0, materials: 5, work: 10, subtotal: 55, vat: 0, total: 55
};
/* Дату фиксируем в шапке, чтобы два прогона buildHtml сравнивались побайтно без гонки с new Date(). */
const kpDeps = { money: n => String(n) + " €", esc, displayCurrency: () => "EUR", settings: {},
  header: { project: "Дом", date: "01.01.2026" } };

test("логотип печатается в шапке КП", () => {
  const html = offerHtml(est, Object.assign({}, kpDeps, { logo: LOGO }));
  assert.ok(html.includes(LOGO), "data-URL логотипа попал в КП");
  assert.ok(logoImgOf(html), "в КП есть <img> логотипа");
  /* Логотип стоит в шапке — внутри блока реквизитов (.box), а не где-то в теле документа. */
  assert.ok(html.indexOf('<div class="box">') < html.indexOf(LOGO), "логотип внутри блока реквизитов");
  assert.ok(html.indexOf(LOGO) < html.indexOf("Дом"), "логотип над реквизитами");
});

test("без логотипа шапка КП не меняется — ни дыры, ни пустого <img>", () => {
  const base = offerHtml(est, kpDeps);                                    // ключа logo нет вовсе
  assert.equal(logoImgOf(base), null, "без логотипа <img> логотипа нет");
  /* Пусто, не-data-URL и внешний путь дают РОВНО тот же документ, что и отсутствие ключа. */
  for (const v of ["", "не-url", "http://x/y.png"]) {
    assert.equal(offerHtml(est, Object.assign({}, kpDeps, { logo: v })), base,
      `logo=${JSON.stringify(v)} не меняет документ`);
  }
});

/* ---- Лист монтажника (installSheet) ---- */
const post = {
  number: 3, room: "Кухня",
  modules: [{ label: "1", name: "Выключатель", code: "20001", note: "" }],
  fittings: [{ role: "Накладка", name: "Накладка", code: "09663", count: 1 }],
  german: null
};
const sheetData = { posts: [post], header: { project: "Дом", developer: "Иванов", date: "01.01.2026" } };

test("логотип печатается в шапке листа монтажника", () => {
  const html = installHtml(sheetData, { esc, logo: LOGO });
  assert.ok(html.includes(LOGO), "data-URL логотипа попал в лист монтажника");
  assert.ok(logoImgOf(html), "в листе монтажника есть <img> логотипа");
  /* Логотип в блоке заголовка — над <h1>, а не в теле карточек. */
  assert.ok(html.indexOf(LOGO) < html.indexOf("<h1"), "логотип над заголовком листа");
});

test("без логотипа шапка листа монтажника не меняется — ни дыры, ни пустого <img>", () => {
  const base = installHtml(sheetData, { esc });
  assert.equal(logoImgOf(base), null, "без логотипа <img> логотипа нет");
  for (const v of ["", "не-url", "http://x/y.png"]) {
    assert.equal(installHtml(sheetData, { esc, logo: v }), base, `logo=${JSON.stringify(v)} не меняет документ`);
  }
});

/* ---- §7.1: ОДНО правило на оба документа ---- */
test("оба документа рисуют ОДИН и тот же <img> логотипа (правило не раздвоено)", () => {
  const kp = logoImgOf(offerHtml(est, Object.assign({}, kpDeps, { logo: LOGO })));
  const sheet = logoImgOf(installHtml(sheetData, { esc, logo: LOGO }));
  assert.ok(kp && sheet, "логотип есть в обоих документах");
  assert.equal(kp, sheet, "разметка логотипа в КП и листе монтажника побайтно одна — общий EPDocImages");
});

/* ---- Call-site загрузки (app.js loadDocImage): негодный файл не сохраняется ---- */
function makeLoaderCtx() {
  const toast = (() => { const f = m => { f.msg = m; f.calls++; }; f.calls = 0; return f; })();
  const set = (() => { const f = (k, v) => { f.last = [k, v]; f.calls++; }; f.calls = 0; return f; })();
  const readCalls = [];
  /* FileReader/Image/canvas-шимы синхронные: читают исходник, «загружают» картинку 200×100 и
     отдают data-URL — так проверяем и то, что негодный файл до них не доходит, и что годный
     доходит до EPPrefs.set. */
  function FileReader() { this.readAsDataURL = function () { readCalls.push(1); this.result = "data:image/png;base64,SRC"; if (this.onload) this.onload(); }; }
  function Image() { const self = this; Object.defineProperty(self, "src", { set() { self.width = 200; self.height = 100; if (self.onload) self.onload(); } }); }
  const document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64,OUT" }) };
  return {
    ctx: { EPDocImages, toast, EPPrefs: { set, get: () => "" }, FileReader, Image, document,
      renderDocImage: () => {}, DOC_IMAGE_PRINT_H: 160, DOC_IMAGE_MAX_W: 480,
      DOC_IMAGES: { logo: { pref: "companyLogo", subject: "логотипа", alt: "Логотип компании",
        preview: "docLogoPreview", remove: "docLogoRemove", saved: "Логотип сохранён" } } },
    toast, set, readCalls
  };
}

test("loadDocImage НЕ сохраняет негодный файл и говорит человеку словами", () => {
  const { ctx, toast, set, readCalls } = makeLoaderCtx();
  const load = stand.run(["loadDocImage"], ctx);
  load({ type: "application/pdf", size: 1000 }, "logo");   // не картинка
  assert.equal(set.calls, 0, "битый файл в EPPrefs не сохранён");
  assert.equal(readCalls.length, 0, "до чтения файла дело не дошло — отказали раньше");
  assert.equal(toast.calls, 1, "человеку показано сообщение");
  assert.match(toast.msg, /картинк/i, "сообщение объясняет, что не так");
});

test("loadDocImage сохраняет годную картинку data-URL'ом в EPPrefs", () => {
  const { ctx, set } = makeLoaderCtx();
  const load = stand.run(["loadDocImage"], ctx);
  load({ type: "image/png", size: 1000 }, "logo");
  assert.equal(set.calls, 1, "логотип сохранён один раз");
  assert.equal(set.last[0], "companyLogo", "ключ EPPrefs — логотип компании (общий для проектов)");
  assert.match(set.last[1], /^data:image\/png/, "сохранён ужатый растр data-URL'ом");
});
