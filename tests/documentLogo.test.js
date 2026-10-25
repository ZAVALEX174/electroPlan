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
                                                                  «loadDocImage НЕ сохраняет негодный файл…»;
     (г) fitSize без ветки 0×0 (вернуть 1×1 вместо бокса)       → красит «fitSize: SVG без размеров…»;
     (д) в loadDocImage убран вызов EPHeicImport для HEIC       → красит «loadDocImage: HEIC-логотип…»;
     (е) validateSource судит по ИМЕНИ (detect→recognize)       → красит три теста «по СОДЕРЖИМОМУ»:
         HEIC с именем .jpg / JPEG с именем .heic / JPEG без расширения;
     (ж) в loadDocImage убран withMime (toPng без починки MIME)  → красит «loadDocImage чинит MIME через withMime»;
     (з) accept инпутов разошёлся со списком EPImageFormats      → красит «accept трёх инпутов — растровый список модуля».
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");
const EPDocImages = require("../js/docImages.js");
const EPImageFormats = require("../js/imageFormats.js");
const { buildHtml: offerHtml } = require("../js/offerPdf.js");
const { buildHtml: installHtml } = require("../js/installSheet.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* 1×1 PNG — валидный data-URL картинки; в base64 нет символов, которые esc бы изменил, поэтому
   его можно искать в разметке дословно. */
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
/* Единственный <img> логотипа в документе (постов/иллюстраций в тестовых данных нет). */
const logoImgOf = html => (html.match(/<img[^>]*alt="Логотип компании"[^>]*>/) || [null])[0];

/* НАСТОЯЩИЕ первые байты форматов — loadDocImage теперь судит по СОДЕРЖИМОМУ (detect по сигнатуре),
   а не по имени/типу, тем же правилом, что план. Фейк-файл отдаёт их через slice().arrayBuffer(). */
const A = s => [...s].map(c => c.charCodeAt(0));
const SIG = {
  jpeg: [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, ...A("JFIF")],
  heic: [0, 0, 0, 0x18, ...A("ftyp"), ...A("heic"), 0, 0, 0, 0, ...A("mif1heic")]
};
const fileWithBytes = (name, header, type = "", size = 1000) => {
  const bytes = new Uint8Array(header);
  const blob = { async arrayBuffer() { return bytes.buffer; } };
  return { name, type, size, slice: () => blob, async arrayBuffer() { return bytes.buffer; } };
};
/* Одна прокрутка микро/макро-очереди: loadDocImage сперва читает заголовок (readHeader), затем в
   .then валидирует и сохраняет — синхронно после вызова ещё ничего не произошло. */
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---- EPDocImages: чистое правило (годность файла + разметка элемента) ---- */
test("validateSource: не картинка — отказ со словами, картинка — ok", () => {
  const bad = EPDocImages.validateSource({ name: "doc.pdf", type: "application/pdf", size: 1000 });
  assert.equal(bad.ok, false, "pdf — не картинка");
  assert.match(bad.reason, /картинк/i, "человеку сказано, что нужна картинка");
  assert.equal(EPDocImages.validateSource({ name: "logo.png", type: "image/png", size: 1000 }).ok, true, "png принят");
  assert.equal(EPDocImages.validateSource({ name: "logo.svg", type: "image/svg+xml", size: 1000 }).ok, true, "svg принят");
});

test("validateSource: .jfif с ПУСТЫМ file.type принят (WhatsApp на Windows) и отдаёт MIME для data-URL", () => {
  // Файл из мессенджера: JPEG с расширением .jfif и пустым type — раньше молчаливо отвергался.
  const r = EPDocImages.validateSource({ name: "logo.jfif", type: "", size: 1000 });
  assert.equal(r.ok, true, "jfif с пустым типом — годный логотип");
  assert.equal(r.mime, "image/jpeg", "оркестратору отдан канонический MIME, чтобы Image декодировал data-URL");
});

test("validateSource: HEIC принят (айфон/мессенджер) и отдаёт mime image/heic для конверсии", () => {
  // Файл с айфона: пустой file.type и расширение .heic. Теперь принимаем — loadDocImage перегонит
  // его в JPEG через EPHeicImport, а mime image/heic говорит оркестратору, что это HEIC-ветка.
  const r = EPDocImages.validateSource({ name: "photo.heic", type: "", size: 1000 }, EPImageFormats);
  assert.equal(r.ok, true, "heic теперь принимаем — его декодирует EPHeicImport");
  assert.equal(r.mime, "image/heic", "оркестратору отдан mime HEIC — по нему он выберет конверсию");
});

/* ---- EPDocImages.fitSize: размер растра при ужатии (чистый расчёт, вынесен из app.js) ---- */
test("fitSize: крупную картинку вписывает в бокс с сохранением пропорций", () => {
  // 1000×500 в бокс 480×160 → упирается в высоту 160, ширина 320 (пропорция 2:1 сохранена).
  assert.deepEqual(EPDocImages.fitSize(1000, 500, 480, 160), { width: 320, height: 160 });
});
test("fitSize: мелкую картинку НЕ растягивает (scale ≤ 1)", () => {
  assert.deepEqual(EPDocImages.fitSize(100, 40, 480, 160), { width: 100, height: 40 });
});
test("fitSize: SVG без размеров (0×0) рисуется в целевой бокс целиком, а не в точку 1×1", () => {
  assert.deepEqual(EPDocImages.fitSize(0, 0, 480, 160), { width: 480, height: 160 });
  assert.deepEqual(EPDocImages.fitSize(300, 0, 480, 160), { width: 480, height: 160 }, "нулевая сторона → бокс");
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
    ctx: { EPDocImages, EPImageFormats, toast, EPPrefs: { set, get: () => "" }, FileReader, Image, document,
      renderDocImage: () => {}, DOC_IMAGE_PRINT_H: 160, DOC_IMAGE_MAX_W: 480,
      DOC_IMAGES: { logo: { pref: "companyLogo", subject: "логотипа", alt: "Логотип компании",
        preview: "docLogoPreview", remove: "docLogoRemove", saved: "Логотип сохранён" } } },
    toast, set, readCalls
  };
}

test("loadDocImage НЕ сохраняет негодный файл и говорит человеку словами", async () => {
  const { ctx, toast, set, readCalls } = makeLoaderCtx();
  const load = stand.run(["loadDocImage"], ctx);
  load({ type: "application/pdf", size: 1000 }, "logo");   // не картинка
  await tick();
  assert.equal(set.calls, 0, "битый файл в EPPrefs не сохранён");
  assert.equal(readCalls.length, 0, "до чтения файла дело не дошло — отказали раньше");
  assert.equal(toast.calls, 1, "человеку показано сообщение");
  assert.match(toast.msg, /картинк/i, "сообщение объясняет, что не так");
});

test("loadDocImage сохраняет годную картинку data-URL'ом в EPPrefs", async () => {
  const { ctx, set } = makeLoaderCtx();
  const load = stand.run(["loadDocImage"], ctx);
  load({ name: "logo.png", type: "image/png", size: 1000 }, "logo");
  await tick();
  assert.equal(set.calls, 1, "логотип сохранён один раз");
  assert.equal(set.last[0], "companyLogo", "ключ EPPrefs — логотип компании (общий для проектов)");
  assert.match(set.last[1], /^data:image\/png/, "сохранён ужатый растр data-URL'ом");
});

test("loadDocImage: .jfif с пустым file.type (мессенджер) доходит до сохранения, а не отвергается", async () => {
  const { ctx, set, readCalls } = makeLoaderCtx();
  const load = stand.run(["loadDocImage"], ctx);
  load({ name: "logo.jfif", type: "", size: 1000 }, "logo");
  await tick();
  assert.equal(readCalls.length, 1, "файл прочитан — пустой type больше не повод для отказа");
  assert.equal(set.calls, 1, "логотип из мессенджера сохранён");
  assert.equal(set.last[0], "companyLogo", "ключ EPPrefs — логотип компании");
});

/* ---- §7.1: формат ПО СОДЕРЖИМОМУ (как у плана) — три случая, где имя врёт ---- */
test("loadDocImage: HEIC с именем .jpg определяется по СОДЕРЖИМОМУ и идёт в конвертер (не как JPEG)", async () => {
  const { ctx, set, readCalls } = makeLoaderCtx();
  const heic = { calls: 0, toJpegDataUrl() { this.calls++; return Promise.resolve("data:image/jpeg;base64,HEICJPEG"); } };
  ctx.EPHeicImport = heic;
  const load = stand.run(["loadDocImage"], ctx);
  // Имя .jpg, но внутри HEIC: по имени ушёл бы в reader как JPEG — detect по сигнатуре находит HEIC.
  load(fileWithBytes("logo.jpg", SIG.heic), "logo");
  await tick();
  assert.equal(heic.calls, 1, "HEIC с именем .jpg отдан конвертеру (решает содержимое, а не расширение)");
  assert.equal(readCalls.length, 0, "FileReader не звали — это HEIC-ветка");
  assert.equal(set.calls, 1, "после конверсии сохранён");
});

test("loadDocImage: JPEG с именем .heic читается как JPEG (reader), не уходит в HEIC-конвертер", async () => {
  const { ctx, set, readCalls } = makeLoaderCtx();
  const heic = { calls: 0, toJpegDataUrl() { this.calls++; return Promise.resolve("data:image/jpeg;base64,X"); } };
  ctx.EPHeicImport = heic;
  const load = stand.run(["loadDocImage"], ctx);
  // Имя .heic, но внутри JPEG: по имени ушёл бы в конвертер — detect по сигнатуре находит JPEG.
  load(fileWithBytes("logo.heic", SIG.jpeg), "logo");
  await tick();
  assert.equal(heic.calls, 0, "конвертер HEIC не звали — содержимое это JPEG");
  assert.equal(readCalls.length, 1, "JPEG прочитан обычным путём");
  assert.equal(set.calls, 1, "сохранён");
});

test("loadDocImage: JPEG БЕЗ расширения принимается (по имени был бы отвергнут)", async () => {
  const { ctx, set, toast } = makeLoaderCtx();
  const load = stand.run(["loadDocImage"], ctx);
  // Имя без расширения и пустой type: recognize вернул бы null и отказ — detect берёт по сигнатуре.
  load(fileWithBytes("logo", SIG.jpeg), "logo");
  await tick();
  assert.equal(set.calls, 1, "картинка без расширения сохранена — формат взят из содержимого");
  assert.equal(toast.msg, "Логотип сохранён", "человеку сказано, что логотип сохранён, а не забракован");
});

test("loadDocImage чинит MIME через EPImageFormats.withMime перед декодированием (.jfif с пустым type)", async () => {
  const { ctx, set } = makeLoaderCtx();
  // Шпионим withMime поверх настоящего модуля: detect/прочее не трогаем (Object.assign копирует их).
  const realWithMime = EPImageFormats.withMime;
  const withMimeCalls = [];
  ctx.EPImageFormats = Object.assign({}, EPImageFormats,
    { withMime: (url, mime) => { withMimeCalls.push([url, mime]); return realWithMime(url, mime); } });
  const load = stand.run(["loadDocImage"], ctx);
  load(fileWithBytes("logo.jfif", SIG.jpeg, ""), "logo");
  await tick();
  assert.equal(withMimeCalls.length, 1, "data-URL пропущен через withMime (иначе Image не декодирует .jfif)");
  assert.equal(withMimeCalls[0][1], "image/jpeg", "MIME чиним на канонический для распознанного формата");
  assert.equal(set.calls, 1, "после починки MIME логотип сохранён");
});

test("loadDocImage: HEIC-логотип (айфон) идёт через конвертер EPHeicImport, потом сохраняется PNG'ом", async () => {
  const { ctx, set, readCalls } = makeLoaderCtx();
  // Заглушка конвертера: HEIC → JPEG data-URL. Счётчик — чтобы мутация «не звать конвертер» краснела.
  const heic = { calls: 0, toJpegDataUrl(file) { this.calls++; return Promise.resolve("data:image/jpeg;base64,HEICJPEG"); } };
  ctx.EPHeicImport = heic;
  const load = stand.run(["loadDocImage"], ctx);
  load({ name: "photo.heic", type: "", size: 1000 }, "logo");
  await new Promise(r => setTimeout(r, 0)); /* дать разрешиться промису конверсии */
  assert.equal(heic.calls, 1, "HEIC отдан ОДНОМУ месту конверсии");
  assert.equal(readCalls.length, 0, "FileReader для HEIC не нужен — байты уже в data-URL из конвертера");
  assert.equal(set.calls, 1, "после конверсии логотип сохранён");
  assert.equal(set.last[0], "companyLogo", "ключ EPPrefs — логотип компании");
  assert.match(set.last[1], /^data:image\/png/, "сохранён ужатый растр PNG'ом (общий путь)");
});

/* ---- accept инпутов бланка собран из ОДНОГО списка EPImageFormats (index.html не разошёлся) ---- */
test("accept трёх инпутов (логотип/подпись/печать) — растровый список модуля, без pdf/dxf/dwg", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  // Тот же растровый accept, что у плана, но БЕЗ pdf/dxf/dwg: бланк — только картинка (с .jfif/.heic/.heif).
  const expected = EPImageFormats.rasterExtensions.map(e => "." + e)
    .concat(EPImageFormats.rasterMimes).join(",");
  for (const id of ["docLogoInput", "docSignatureInput", "docStampInput"]) {
    const accept = (html.match(new RegExp(`id="${id}"[^>]*accept="([^"]*)"`)) || [])[1];
    assert.equal(accept, expected, `${id}: accept совпадает со списком EPImageFormats`);
    assert.ok(!/\.pdf|\.dxf|\.dwg/.test(accept), `${id}: pdf/dxf/dwg в бланк не принимаем`);
    assert.ok(/\.jfif/.test(accept) && /\.heic/.test(accept) && /\.heif/.test(accept), `${id}: .jfif/.heic/.heif присутствуют`);
  }
});
