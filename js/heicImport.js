/* Конвертация HEIC/HEIF (айфон, мессенджеры) в JPEG — ОДНО место на всё приложение (§7.1).
   Chrome/Edge/Firefox на Windows HEIC сами НЕ рисуют (его декодирует только Safari), поэтому до
   показа на холсте или в КП файл надо перегнать в формат, который умеет <img>. И план, и бланк КП
   (логотип/подпись/печать) зовут ОДНУ функцию отсюда — чтобы качество, применение поворота и выбор
   кодека не разъехались между двумя подсистемами.

   Декодер — vendor/heic-to/heic-to.js (обёртка heic-to над свежим libheif, собрана в один IIFE-файл,
   глобал HeicTo). Подключаем ЛЕНИВО, как PDF.js/DXF в planImport.js: тег <script> добавляется только
   когда реально пришёл HEIC. На старте страницы 3-мегабайтный декодер не грузится — обычные JPG/PNG
   его не касаются. libheif применяет irot/imir из HEIF-контейнера, поэтому фото с айфона выходит
   повёрнутым как на телефоне (проверено: кадр 300×600 с флагом поворота декодируется 600×300).

   Доступ к document (вычисление пути к vendor) — ЛЕНИВЫЙ, внутри loadDecoder: так модуль грузится и
   в Node (двойной экспорт для автотестов), где document нет, — там его просто не вызывают, а маршрут
   HEIC в planImport/loadDocImage проверяют с подменённым декодером-заглушкой. Интерфейс — window.EPHeicImport. */
(function () {
  "use strict";

  /* Качество JPEG при конверсии. Высокое (0.92): план/фото нужны чёткими, а ужимает размер уже
     следующий шаг (растеризация плана / пережатие логотипа в PNG). Уменьшение больших фото —
     отдельная задача после К10, здесь отдаём ПОЛНОЕ разрешение. */
  var JPEG_QUALITY = 0.92;
  var VENDOR_SCRIPT = "vendor/heic-to/heic-to.js";
  var decoderPromise = null;

  /* Глобал декодера, если уже подключён (повторный HEIC за сессию script заново не грузит). */
  function existingDecoder() {
    if (typeof HeicTo !== "undefined" && HeicTo) return HeicTo;
    if (typeof window !== "undefined" && window.HeicTo) return window.HeicTo;
    return null;
  }

  /* Ленивая загрузка декодера тегом <script> от корня сайта (путь — относительно этого модуля, как у
     planImport.js: с диска и из подпапки Pages одинаково). Повторные вызовы ждут тот же промис. */
  function loadDecoder() {
    var ready = existingDecoder();
    if (ready) return Promise.resolve(ready);
    if (!decoderPromise) {
      decoderPromise = new Promise(function (resolve, reject) {
        var scriptSrc = (typeof document !== "undefined" && document.currentScript && document.currentScript.src)
          || "js/heicImport.js";
        var rootUrl = new URL("../", new URL(scriptSrc, document.baseURI));
        var el = document.createElement("script");
        el.src = new URL(VENDOR_SCRIPT, rootUrl).href;
        el.onload = function () {
          var api = existingDecoder();
          api ? resolve(api) : reject(new Error("HEIC-декодер не инициализирован"));
        };
        el.onerror = function () {
          decoderPromise = null; /* дать повторную попытку при следующем HEIC */
          reject(new Error("Не удалось загрузить HEIC-декодер"));
        };
        document.head.appendChild(el);
      });
    }
    return decoderPromise;
  }

  /* HEIC-файл (File/Blob) → JPEG Blob в полном разрешении. Поворот уже применён libheif. */
  function toJpegBlob(file, quality) {
    return loadDecoder().then(function (heicTo) {
      return heicTo({ blob: file, type: "image/jpeg", quality: quality == null ? JPEG_QUALITY : quality });
    });
  }

  /* HEIC-файл → data:image/jpeg;base64 — удобно отдать туда же, куда уходит растр обычной картинки
     (img.src у плана и у логотипа). Тот же один путь показа, что и для JPG/PNG. */
  function toJpegDataUrl(file, quality) {
    return toJpegBlob(file, quality).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error("Не удалось прочитать результат HEIC-конверсии")); };
        reader.readAsDataURL(blob);
      });
    });
  }

  /* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports (автотесты). */
  var api = { toJpegBlob: toJpegBlob, toJpegDataUrl: toJpegDataUrl, JPEG_QUALITY: JPEG_QUALITY, VENDOR_SCRIPT: VENDOR_SCRIPT };
  if (typeof window !== "undefined") window.EPHeicImport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
