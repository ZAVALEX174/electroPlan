/* Картинки бланка компании в документах — ОДНО правило «годен ли файл» на все три (§7.1).
   Логотип идёт в шапку КП и листа монтажника; подпись и печать — в конец КП (в лист монтажника
   не идут: он не коммерческий документ). Что у них общего и живёт ЗДЕСЬ, в одном месте:
   - validateSource — годен ли ВЫБРАННЫЙ файл (картинка ли, в пределах размера). Второй копии этой
     проверки быть не должно: логотип, подпись и печать проверяются ТЕМ ЖЕ правилом, различается
     лишь слово в сообщении (какая это картинка);
   - imgHtml — безопасный <img> из data-URL (пустой/не-картинка → "", src экранируется). Логотип в
     шапке и картинки подписного блока рисуются им же, только с разной геометрией (аргумент opts) —
     иначе «пустая рамка» или чужой src прокрались бы в один документ и не в другой.
   Разметку подписного блока в КОНЦЕ КП верстает EPOfferPdf (это KP-only разметка, как подвал
   условий), а не этот модуль: здесь общее для всех документов, там — специфика КП.

   Загрузку/ужатие картинки делает оркестратор (app.js) — там нужен DOM (FileReader/Image/canvas),
   а этот модуль без state и DOM, как offerPdf.js/installSheet.js: чистые функции проверяются
   автотестом, браузер не поднимая (PLAN 7.1).

   Интерфейс приложению — window.EPDocImages.{ validateSource, imgHtml, MAX_SOURCE_BYTES }. */
(() => {
"use strict";

/* Честный предел исходного файла. Картинка бланка (логотип/подпись/печать) — это герб/иконка/скан
   подписи, а не фотоальбом: 5 МБ с огромным запасом покрывают любой разумный PNG/JPG/SVG, а всё
   крупнее почти наверняка не то (фото с телефона) — незачем это ни декодировать, ни держать в
   LocalStorage. Проверяем ИСХОДНЫЙ файл до чтения: ужатие всё равно приведёт растр к печатной
   высоте, но отказать великану надо словами и сразу, а не молча упереться в квоту хранилища. */
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/* Первые байты файла для определения формата по СИГНАТУРЕ — тем же путём, что у плана (planImport
   readHeader, §7.1): мессенджер меняет имя и теряет MIME, а первые байты не врут. Читаем только
   заголовок (file.slice), на большом файле это копейки. Нет slice/arrayBuffer (узкий фейк в тесте
   или не-File) → null: detect тогда решит по имени/типу, как раньше. Промис — arrayBuffer асинхронный;
   оркестратор дочитывает файл, уже зная формат. Функция трогает только переданный file (без DOM/state). */
const HEADER_BYTES = 4096;
function readHeader(file) {
  const blob = file && typeof file.slice === "function" ? file.slice(0, HEADER_BYTES) : file;
  if (!blob || typeof blob.arrayBuffer !== "function") return Promise.resolve(null);
  return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
}

/* Годен ли ВЫБРАННЫЙ файл: это знакомая картинка и он в пределах размера. Возвращаем причину словами —
   оркестратор покажет её человеку и НЕ сохранит молча битое (решение владельца п.3). Какой формат —
   решает ОБЩИЙ EPImageFormats по СОДЕРЖИМОМУ (detect: сигнатура первых байтов, при промахе имя/MIME) —
   ТО ЖЕ правило, что у плана (§7.1). Раньше бланк судил только по имени/типу (recognize) и расходился с
   планом: HEIC с именем .jpg, JPEG с именем .heic, JPEG без расширения — план брал, логотип отвергал.
   bytes — заголовок из readHeader; нет байтов → detect падает на имя/MIME, как прежде. Функция остаётся
   чистой (байты приходят аргументом) и проверяется без браузера. Передаётся аргументом (в браузере app.js
   подставит глобал) — модуль не лезет к чужому состоянию сам.
   Пустой file.type больше НЕ причина отказа: WhatsApp на Windows кладёт JPEG с расширением .jfif и
   пустым типом, и такой логотип раньше молча отвергался (решение владельца: грузить как JPG).
   При удаче возвращаем mime распознанного формата — оркестратору он нужен, чтобы починить data-URL
   (иначе Image не декодирует .jfif с пустым типом).
   subject — родительный падеж названия картинки («логотипа»/«подписи»/«печати»): один и тот же текст,
   но человек видит, какой именно файл забракован. Подлежащее всегда «Файл» (мужской род), чтобы
   согласование глагола не зависело от рода названия. */
function validateSource(file, subject, formats, bytes) {
  const what = typeof subject === "string" && subject.trim() ? subject.trim() : "изображения";
  const F = formats
    || (typeof window !== "undefined" && window.EPImageFormats)
    || (typeof require === "function" ? require("./imageFormats.js") : null);
  const labels = F ? F.rasterLabels.join(", ") : "PNG, JPG, SVG";
  const info = file && F ? F.detect(bytes, file.name, file.type) : null;
  if (!info) {
    return { ok: false, reason: `Файл ${what} должен быть картинкой — ${labels}` };
  }
  if (info.unsupported) {
    return { ok: false, reason: `Файл ${what}: формат ${info.label} браузер пока не открывает — сохраните как JPG или PNG` };
  }
  if (Number(file.size) > MAX_SOURCE_BYTES) {
    return { ok: false, reason: `Файл ${what} слишком большой — допустимо до 5 МБ` };
  }
  return { ok: true, mime: info.mime };
}

/* Размер растра при ужатии картинки бланка на canvas. Вписываем исходник iw×ih в печатный бокс
   maxW×maxH с сохранением пропорций и БЕЗ растяжения (scale ≤ 1): логотип/подпись мельче бокса
   остаётся как есть, крупнее — ужимается под печать. Нулевые iw/ih (SVG без собственных width/height
   даёт 0×0 — иначе canvas вышел бы точкой 1×1) → рисуем в целевой бокс целиком, чтобы картинка была
   видна. Чистый расчёт вынесен сюда из оркестратора и покрыт автотестом (§7.1): в app.js остаётся вызов. */
function fitSize(iw, ih, maxW, maxH) {
  const w0 = Number(iw) || 0;
  const h0 = Number(ih) || 0;
  if (w0 > 0 && h0 > 0) {
    const scale = Math.min(maxH / h0, maxW / w0, 1);
    return { width: Math.max(1, Math.round(w0 * scale)), height: Math.max(1, Math.round(h0 * scale)) };
  }
  return { width: maxW, height: maxH };
}

/* Безопасный <img> из data-URL для документа. Пусто или не data-URL картинки → "" (никакого
   пустого <img>: без картинки документ обязан выглядеть ровно как раньше). Принимаем ТОЛЬКО
   data:image/… — документы открываются через window.open, внешний путь туда всё равно не доедет,
   а чужой src — лишний риск в уходящем клиенту документе.
   Геометрия — ИНЛАЙН-стилем, а не классом: строка идёт в окно печати с ЧУЖИМ <style>, опереться на
   наш CSS-класс там не на что. Размеры/подпись настраиваются через opts (у логотипа шапки и картинок
   подписного блока они разные), по умолчанию — прежняя геометрия логотипа, чтобы старые двухаргументные
   вызовы дали БАЙТ-В-БАЙТ прежний <img>. max-height держим заметно ниже растровой высоты, которую
   задаёт оркестратор при ужатии, — так в PDF (печать плотнее экрана) картинка остаётся чёткой.
   src и alt экранируем (конвенция 4): валидный data-URL кавычек не содержит, но подстановка в
   разметку без esc недопустима по правилу. */
function imgHtml(src, esc, opts) {
  const url = typeof src === "string" ? src.trim() : "";
  if (!/^data:image\//i.test(url)) return "";
  const e = typeof esc === "function" ? esc : (s => String(s));
  const o = opts || {};
  const alt = o.alt != null ? o.alt : "Логотип компании";
  const maxH = o.maxHeight != null ? o.maxHeight : 64;
  const maxW = o.maxWidth != null ? o.maxWidth : 240;
  const margin = o.margin != null ? o.margin : "0 0 10px";
  return `<img src="${e(url)}" alt="${e(alt)}" style="max-height:${maxH}px;max-width:${maxW}px;`
    + `object-fit:contain;display:block;margin:${margin}">`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { validateSource, readHeader, imgHtml, fitSize, MAX_SOURCE_BYTES };
if (typeof window !== "undefined") window.EPDocImages = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
