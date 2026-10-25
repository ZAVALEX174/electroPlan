/* Растровые/векторные картинки, которые браузер РИСУЕТ САМ — ОДНО место правила «какую картинку
   принимаем» (§7.1). До этого правило жило в двух местах и расходилось: план маршрутизировался по
   расширению (js/planImport.js), а бланк КП — по file.type (js/docImages.js). Из-за второго .jfif
   с WhatsApp (JPEG, который Windows кладёт с пустым file.type) логотип отвергал, а план принимал.
   Теперь обе подсистемы спрашивают ЗДЕСЬ: «это картинка, какого формата и какой у неё MIME».

   Почему по СИГНАТУРЕ, а не по расширению: мессенджеры переименовывают файлы (.jfif вместо .jpg),
   а file.type на Windows часто пустой — расширение и MIME ненадёжны. Первые байты не врут. Расширение
   и MIME оставлены ЗАПАСНЫМ путём: когда заголовок не читали (валидация бланка смотрит только имя)
   или сигнатура не распозналась, но имя говорит о знакомом формате.

   HEIC (айфон/мессенджеры) модуль РАСПОЗНАЁТ и считает принимаемым форматом: браузер его сам не
   рисует, но приложение перегоняет HEIC в JPEG одним местом (EPHeicImport над vendor/heic-to) ещё до
   показа — и план, и бланк КП идут дальше тем же путём, что обычная картинка. Здесь HEIC лишь даёт
   канонический mime image/heic; само декодирование — не дело этого чистого модуля.

   Чистый модуль: ни DOM, ни state. Сигнатуру читает по переданным байтам, data-URL правит строкой —
   всё проверяется в Node без браузера (PLAN 7.1). Интерфейс — window.EPImageFormats. */
(() => {
"use strict";

/* Порядок формата здесь = порядок в списках accept/подсказки/ошибки (их собирают из него).
   label — для перечня принимаемых форматов (у JPEG помечаем JFIF: это и есть «джифив» из мессенджеров),
   short — короткое имя для статуса «План загружен (JPG)», exts — все расширения, mime — КАНОНИЧЕСКИЙ
   тип для data-URL (им мы чиним пустой/чужой file.type). unsupported — распознаём, но пока не рисуем. */
const FORMATS = [
  { format: "png",  label: "PNG",        short: "PNG",  exts: ["png"],                                      mime: "image/png" },
  { format: "jpeg", label: "JPG (JFIF)", short: "JPG",  exts: ["jpg", "jpeg", "jfif", "jpe", "pjpeg", "pjp"], mime: "image/jpeg" },
  { format: "webp", label: "WEBP",       short: "WEBP", exts: ["webp"],                                     mime: "image/webp" },
  { format: "gif",  label: "GIF",        short: "GIF",  exts: ["gif"],                                      mime: "image/gif" },
  { format: "bmp",  label: "BMP",        short: "BMP",  exts: ["bmp"],                                      mime: "image/bmp" },
  { format: "avif", label: "AVIF",       short: "AVIF", exts: ["avif"],                                     mime: "image/avif" },
  { format: "svg",  label: "SVG",        short: "SVG",  exts: ["svg"],                                      mime: "image/svg+xml" },
  { format: "heic", label: "HEIC",       short: "HEIC", exts: ["heic", "heif"],                             mime: "image/heic" }
];

const BY_FORMAT = {};
const BY_EXT = {};
FORMATS.forEach((f) => {
  BY_FORMAT[f.format] = f;
  f.exts.forEach((ext) => { BY_EXT[ext] = f; });
});

/* Бренды ISO-BMFF (box ftyp) — по ним отличаем AVIF от HEIC: контейнер один, решает набор брендов.
   HEIC_BRANDS включает mif1/msf1 (общий HEIF) и hevc-варианты: у айфонных HEIC major-бренд бывает
   mif1, а heic — в совместимых. AVIF проверяем первым: avif-файл не должен уехать в HEIC. */
const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"]);

function extOf(name) {
  const s = String(name == null ? "" : name);
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1).toLowerCase() : "";
}

/* ASCII-срез байтов (для магических слов RIFF/WEBP/ftyp/бренды) — вне диапазона возвращаем "". */
function ascii(bytes, offset, length) {
  if (!bytes || offset + length > bytes.length) return "";
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

/* Бренды из box ftyp: major (байты 8..11) + совместимые (с 16-го по 4 байта до размера box).
   Размер box — big-endian в первых 4 байтах; ограничиваем длиной переданного заголовка. */
function ftypBrands(bytes) {
  const brands = [];
  const major = ascii(bytes, 8, 4);
  if (major) brands.push(major.toLowerCase());
  const boxSize = (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0;
  const limit = Math.min(bytes.length, boxSize > 0 ? boxSize : bytes.length);
  for (let offset = 16; offset + 4 <= limit; offset += 4) {
    const brand = ascii(bytes, offset, 4).toLowerCase().trim();
    if (brand) brands.push(brand);
  }
  return brands;
}

/* SVG — текстовый XML: ищем корневой <svg в начале файла (после BOM/декларации/комментариев/DOCTYPE).
   Берём только переданный заголовок — в планах/логотипах корень стоит у верха файла. */
function looksLikeSvg(bytes) {
  if (!bytes || !bytes.length) return false;
  let text;
  try { text = new TextDecoder("utf-8").decode(bytes.subarray(0, Math.min(bytes.length, 4096))); }
  catch { text = ascii(bytes, 0, Math.min(bytes.length, 4096)); }
  return /<svg[\s/>]/i.test(text);
}

/* Формат по СИГНАТУРЕ первых байтов. null — ни одна магия не подошла (решать будет расширение/MIME). */
function detectSignature(bytes) {
  if (!bytes || bytes.length < 3) return null;
  const b = bytes;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
    && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return "png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
    && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4D) return "bmp";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 4, 4) === "ftyp") {
    const brands = ftypBrands(b);
    if (brands.some((x) => AVIF_BRANDS.has(x))) return "avif";
    if (brands.some((x) => HEIC_BRANDS.has(x))) return "heic";
  }
  if (looksLikeSvg(b)) return "svg";
  return null;
}

/* Формат по имени/типу БЕЗ байтов — запасной путь (валидация бланка смотрит только имя файла).
   Сначала расширение (мессенджеры имя меняют реже, чем теряют MIME), затем file.type. */
function recognize(name, type) {
  const byExt = BY_EXT[extOf(name)];
  if (byExt) return byExt;
  const mime = String(type == null ? "" : type).toLowerCase().split(";")[0].trim();
  if (mime) {
    const byMime = FORMATS.find((f) => f.mime === mime);
    if (byMime) return byMime;
    // image/jpg и image/pjpeg — нестандартные синонимы JPEG, которые встречаются в дикой природе.
    if (mime === "image/jpg" || mime === "image/pjpeg") return BY_FORMAT.jpeg;
    // image/heif и image/heic-sequence — синонимы HEIC (как jpg для JPEG): канонический mime у нас
    // image/heic, поэтому в accept он один, но распознаём файл и по этим типам.
    if (mime === "image/heif" || mime === "image/heic-sequence") return BY_FORMAT.heic;
  }
  return null;
}

/* Главная функция: сигнатура первых байтов → при промахе имя/MIME. Возвращает дескриптор формата
   (тот же объект из FORMATS, приложение читает short/mime/unsupported) или null. */
function detect(bytes, name, type) {
  const bySig = detectSignature(bytes);
  if (bySig) return BY_FORMAT[bySig];
  return recognize(name, type);
}

/* Починка MIME в уже готовом data-URL: FileReader берёт тип из file.type, а он у .jfif пустой/чужой,
   и Image такой data-URL не декодирует. Подставляем КАНОНИЧЕСКИЙ mime распознанного формата, не трогая
   сами байты (повторная кодировка не нужна — дорого на 100-МБ плане). Если тип уже верный — не трогаем. */
function withMime(dataUrl, mime) {
  if (typeof dataUrl !== "string" || !mime) return dataUrl;
  const m = /^data:([^;,]*)([;,])/.exec(dataUrl);
  if (!m) return dataUrl;
  if (m[1].toLowerCase() === mime.toLowerCase()) return dataUrl;
  return "data:" + mime + dataUrl.slice(("data:" + m[1]).length);
}

/* Перечень через запятую с «и» перед последним: «PNG, JPG (JFIF) … и DWG». Одно место для текстов
   принимаемых форматов — ошибка импорта и сообщение бланка собираются им же. */
function listWithAnd(items) {
  const list = (items || []).filter(Boolean);
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " и " + list[list.length - 1];
}

/* Растровые форматы, которые ПРИНИМАЕМ: их расширения/типы/подписи идут в accept, подсказку и
   сообщения. HEIC теперь здесь (его декодирует EPHeicImport до показа); флаг unsupported оставлен в
   механике на случай будущих форматов, которые распознаём, но ещё не умеем открывать. */
const supported = FORMATS.filter((f) => !f.unsupported);
const rasterExtensions = supported.reduce((acc, f) => acc.concat(f.exts), []);
const rasterMimes = supported.map((f) => f.mime);
const rasterLabels = supported.map((f) => f.label);
const rasterShortLabels = supported.map((f) => f.short);

const api = {
  FORMATS,
  detect,
  detectSignature,
  recognize,
  withMime,
  listWithAnd,
  extOf,
  rasterExtensions,
  rasterMimes,
  rasterLabels,
  rasterShortLabels
};
if (typeof window !== "undefined") window.EPImageFormats = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
