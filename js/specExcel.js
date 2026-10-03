/* Выгрузка спецификации в Excel (.xlsx) — A6, решение владельца 24.08 §1.2 «спецификацию можно в
   Excel». Один файл, ДВА листа:
     «Спецификация»  — раздел КП «Спецификация и комплектация»: позиции/посты с ценами, скидкой и
                       итогами (НДС по режиму проекта);
     «По артикулам»  — свод поставщику (как «Сводная спецификация по артикулам»): артикул,
                       наименование, количество; при включённых ценах — цена и сумма.

   ⚠️ ГЛАВНОЕ ПРАВИЛО (§7.1). Деньги НЕ пересчитываются заново: суммы берём из того же est
   (EPEstimate.build), что печатает КП, а строки свода — из того же EPSupplierSpec.collect. Excel и
   КП считают по одним и тем же числам, поэтому разойтись на копейку физически не могут. Валюта и курс
   — как в КП: число в ячейке = базовая цена × rate (тот же displayRate, что множит money() в КП), а
   денежный формат ячейки (₽/€, 2 знака) округляет на экране так же, как money(). В ячейке лежит ЧИСЛО
   (тип n), а не строка: его можно складывать формулами. Итог «Оборудование» — формула SUM по столбцу
   «Сумма» (когда он есть), остальные итоги — значения из est (их КП тоже печатает готовыми числами).

   ПОЧЕМУ СВОЙ ПИСАТЕЛЬ xlsx. Во фронтенде нет и не будет npm-рантайм-зависимостей и сборщика
   (PLAN 2.2), внешние CDN не подключаем. .xlsx — это ZIP (храним без сжатия, метод STORE + CRC32) с
   минимальным OOXML SpreadsheetML внутри. Строки кладём инлайн (t="inlineStr"), чтобы не вести таблицу
   sharedStrings. Кириллица — через UTF-8 (TextEncoder), имена частей ASCII.

   ЧИСТЫЙ МОДУЛЬ как docRequisites.js/supplierSpec.js: ни DOM, ни state, ни window. На вход — готовая
   смета, готовый свод и настройки показа; на выход — Uint8Array с байтами книги. Скачивание (Blob +
   a[download]) и сбор est/свода из state — в оркестраторе (js/docs.js).

   build(est, supplier, deps) -> Uint8Array
     est       — результат EPEstimate.build (groups[], equipment, discount, materials, work, subtotal,
                 vat, vatLabel, vatPercent, vatIncluded, total, discountMixed, discountPercent);
     supplier  — результат EPSupplierSpec.collect: { rows[], totalNames, totalUnits, missing };
     deps      — { options (схема EPOfferOptions: какие разделы/столбцы и «показывать цены»),
                   currency ("RUB"|"EUR"), rate (base × rate = показанное число) }.
   fileName(number, project) -> безопасное имя файла с расширением .xlsx. */
(() => {
"use strict";

/* EPOfferOptions и EPEstimate — window-глобалы в браузере (сборщика нет), в Node приходят через
   require: тот же приём разрешения зависимостей, что в offerPdf.js. itemText/normalize/fields и
   renderItem/discountLabel — ЕДИНСТВЕННЫЕ копии правил «как чистить имя без артикулов», «какие
   столбцы бывают» и «как называть скидку»; второй копии здесь не заводим (§7.1). */
function offerOptionsApi() {
  if (typeof window !== "undefined" && window.EPOfferOptions) return window.EPOfferOptions;
  if (typeof require !== "undefined") return require("./offerOptions.js");
  return null;
}
function estimateApi() {
  if (typeof window !== "undefined" && window.EPEstimate) return window.EPEstimate;
  if (typeof require !== "undefined") return require("./estimate.js");
  return null;
}

const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const utf8 = s => enc ? enc.encode(String(s)) : Buffer.from(String(s), "utf8");

/* Экранирование для XML: & < > обязательны в тексте, " и ' — ещё и в значениях атрибутов (имена
   листов, формат денег). Этого набора достаточно для OOXML. */
function xmlEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

/* Номер столбца (1-based) → буквенный адрес Excel: 1→A, 27→AA. */
function colLetter(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
/* Число в текст для <v>: конечное — кратчайшим round-trip представлением JS (точность денег не
   теряем), мусор (NaN/∞) — нулём, а не пустой ячейкой. */
function numStr(n) { n = Number(n); return Number.isFinite(n) ? String(n) : "0"; }

/* Индексы стилей из styles.xml ниже. 0 — обычный; дальше — то, что реально используем. */
const S_MONEY = 1;       // денежный формат, обычный шрифт
const S_BOLD = 2;        // жирный текст (подписи итогов)
const S_BOLDMONEY = 3;   // жирный + денежный формат (значения итогов)
const S_HEADER = 4;      // жирный на заливке — шапка таблицы

/* Конструкторы ячеек: s — строка (inlineStr), n — число, f — формула с заранее вычисленным
   значением (чтобы книга открывалась с готовым итогом, не требуя пересчёта). */
const txt = (v, s) => ({ t: "s", v, s });
const num = (v, s) => ({ t: "n", v, s });
const formula = (f, v, s) => ({ t: "f", f, v, s });

function cellXml(col, rowNum, cell) {
  const ref = colLetter(col) + rowNum;
  const s = cell.s ? ` s="${cell.s}"` : "";
  if (cell.t === "s") return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
  if (cell.t === "f") return `<c r="${ref}"${s}><f>${xmlEsc(cell.f)}</f><v>${numStr(cell.v)}</v></c>`;
  return `<c r="${ref}"${s}><v>${numStr(cell.v)}</v></c>`;
}

const XMLHEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/* Лист из матрицы ячеек: rows — массив строк, строка — массив ячеек либо null (пустая клетка).
   widths — ширины столбцов (символы Excel), по желанию. */
function sheetXml(rows, widths) {
  const cols = widths && widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  let body = "";
  rows.forEach((cells, ri) => {
    const rowNum = ri + 1;
    const cx = cells.map((cell, ci) => (cell ? cellXml(ci + 1, rowNum, cell) : "")).join("");
    body += `<row r="${rowNum}">${cx}</row>`;
  });
  return `${XMLHEAD}<worksheet xmlns="${NS}">${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/* styles.xml: один пользовательский денежный формат (id 164) с символом валюты, два шрифта
   (обычный/жирный) и заливка шапки. Порядок элементов в styleSheet строгий — Excel придирчив. */
function stylesXml(currency) {
  const sym = currency === "RUB" ? "₽" : "€";
  /* Формат: разделитель тысяч, 2 знака, пробел и символ валюты. В атрибуте кавычки — &quot;,
     обратный слэш перед пробелом делает пробел литеральным. */
  const fmt = `#,##0.00\\ &quot;${sym}&quot;`;
  return `${XMLHEAD}<styleSheet xmlns="${NS}">`
    + `<numFmts count="1"><numFmt numFmtId="164" formatCode="${fmt}"/></numFmts>`
    + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>`
    + `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
    + `<fills count="3"><fill><patternFill patternType="none"/></fill>`
    + `<fill><patternFill patternType="gray125"/></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FFE8F4FF"/></patternFill></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="5">`
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
    + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
    + `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>`
    + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`
    + `</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `</styleSheet>`;
}

/* --- Лист «Спецификация»: строим ровно те столбцы и те числа, что КП (offerPdf). --- */
function buildSpecSheet(est, options, config, estimate, rate) {
  const itemText = (value, code) => config.itemText(value, options.articles, code);
  const pctStr = n => String(n).replace(".", ",");
  /* Пометка личной скидки — та же формулировка и то же условие, что в КП (offerPdf.discMark):
     печатаем, только когда у строки свой процент и цены включены. */
  const discMark = (personal, percent) => (!options.prices || !personal) ? ""
    : (Number(percent) === 0 ? "без скидки" : "скидка " + pctStr(percent) + "%");

  /* Строки — производные от est.groups ровно как в offerPdf: количество, сумма и цена
     (sum/count) читаются из той же сметы, второй раз деньги не считаем. */
  const rows = (est.groups || []).map(g => ({
    name: itemText(g.name, g.items && g.items.length === 1 ? g.items[0].code : null),
    composition: options.articles ? g.composition : (Array.isArray(g.items)
      ? g.items.map(it => estimate.renderItem({ ...it, name: itemText(it.name, it.code) })).filter(Boolean).join(", ")
      : "Состав без артикулов недоступен"),
    article: (g.items || []).filter(it => !it.notRequired && it.count > 0)
      .map(it => `${it.code || "артикул не определён"}${it.count > 1 ? " × " + it.count : ""}${it.assumed ? " (предположительно)" : ""}`).join(", "),
    quantity: g.count, unit: g.unit,
    price: g.count ? g.sum / g.count : 0, sum: g.sum,
    discountMark: discMark(g.discountPersonal, g.discountPercent)
  }));

  /* Набор столбцов — из той же схемы EPOfferOptions.fields, с теми же гейтами (артикулы/цены),
     что offerPdf.specColumns: Excel показывает ровно то, что показал бы КП при этих настройках. */
  const specColumns = [
    ...(options.specification.number ? [["number", "№"]] : []), ["name", "Наименование"],
    ...config.fields.specification.filter(([key]) => key !== "number" && options.specification[key]
      && (key !== "article" || options.articles) && (!["price", "sum"].includes(key) || options.prices))
      .map(([key, label]) => [key, key === "composition" && options.articles ? "Состав / артикул" : label])
  ];

  const moneyKeys = new Set(["price", "sum"]);
  const sheet = [];
  /* Шапка */
  sheet.push(specColumns.map(([, label]) => txt(label, S_HEADER)));
  /* Тело: денежные столбцы — число × rate с денежным стилем; № — число; остальное — текст. */
  rows.forEach((r, i) => {
    sheet.push(specColumns.map(([key]) => {
      if (moneyKeys.has(key)) return num((Number(r[key]) || 0) * rate, S_MONEY);
      if (key === "number") return num(i + 1);
      if (key === "name") return txt(r.name + (r.discountMark ? "  (" + r.discountMark + ")" : ""));
      if (key === "quantity") return num(Number(r.quantity) || 0);
      return txt(r[key] == null ? "" : r[key]);
    }));
  });

  /* Итоги — только при включённых ценах (как и в КП). Печатаем те же строки и в том же порядке,
     что блок totals в offerPdf; значения — из est, со знаком минуса у скидки. */
  if (options.prices) {
    sheet.push([]);   // пустая строка-разделитель
    const sumIdx = specColumns.findIndex(c => c[0] === "sum");
    const firstData = 2, lastData = 1 + rows.length;
    const totalRow = (label, value, moneyStyle, valueCell) => {
      const row = [txt(label, S_BOLD)];
      row[1] = valueCell || num(value, moneyStyle ? S_BOLDMONEY : S_BOLD);
      sheet.push(row);
    };
    /* «Оборудование» = Σ столбца «Сумма». Когда столбец «Сумма» показан — делаем это настоящей
       формулой SUM (её значение равно est.equipment × rate: «можно считать формулами»). Нет
       столбца «Сумма» (его скрыли) — печатаем готовое значение. */
    if (sumIdx >= 0 && rows.length) {
      const col = colLetter(sumIdx + 1);
      totalRow("Оборудование", 0, true, formula(`SUM(${col}${firstData}:${col}${lastData})`, est.equipment * rate, S_BOLDMONEY));
    } else {
      totalRow("Оборудование", est.equipment * rate, true);
    }
    if (est.discount) totalRow(estimate.discountLabel(est.discountMixed, est.discountPercent), -est.discount * rate, true);
    totalRow("Монтажные материалы", est.materials * rate, true);
    totalRow("Работы", est.work * rate, true);
    if (est.vat && !est.vatIncluded) {
      totalRow("Итого без НДС", est.subtotal * rate, true);
      totalRow(`${est.vatLabel || "НДС"} ${est.vatPercent}%`, est.vat * rate, true);
    }
    totalRow(`Итого${est.vat && !est.vatIncluded ? " с НДС" : ""}`, est.total * rate, true);
    if (est.vat && est.vatIncluded) totalRow(`${est.vatLabel || "в т.ч. НДС"} ${est.vatPercent}%`, est.vat * rate, true);
  }

  /* Ширины: наименование и состав — широкие, числовые/служебные — узкие. */
  const widthOf = key => key === "name" ? 38 : key === "composition" ? 46 : key === "article" ? 26
    : key === "price" || key === "sum" ? 16 : key === "unit" || key === "number" ? 8 : 12;
  return sheetXml(sheet, specColumns.map(([key]) => widthOf(key)));
}

/* Ключ артикула — как в supplierSpec.codeKey: регистр и пробелы это оформление, а не разные
   товары, и цена из est должна находиться по коду свода независимо от их написания. */
const codeKey = c => String(c == null ? "" : c).replace(/\s+/g, "").toUpperCase();

/* --- Лист «По артикулам»: плоский свод (как КП, но без подзаголовков-групп — в таблице Excel они
   ломали бы сортировку/фильтр/СУММ). При включённых ценах добавляем цену и сумму. --- */
function buildSupplierSheet(est, supplier, options, config, rate) {
  const rows = (supplier && supplier.rows) || [];
  const showArticles = options.articles !== false;
  const showPrices = !!options.prices;

  /* Цена артикула — та же каталожная цена за штуку, что взяла смета (est.groups[].items[].price):
     берём из est, чтобы цена в Excel не разошлась с деньгами КП (§7.1). Свод и смета строятся
     разными проходами, поэтому у отдельных строк цены может не быть — тогда клетку оставляем
     пустой, а не ставим ложный ноль. Итог по этому листу намеренно НЕ выводим: по составу он не
     обязан совпадать с «Итого» КП (нет скидки, работ, материалов, НДС), и ложное равенство
     вводило бы в заблуждение. */
  const priceByCode = new Map();
  (est.groups || []).forEach(g => (g.items || []).forEach(it => {
    if (it && it.code && it.price != null) {
      const k = codeKey(it.code);
      if (!priceByCode.has(k)) priceByCode.set(k, Number(it.price) || 0);
    }
  }));

  const columns = [["n", "№"], ["name", showArticles ? "Товар" : "Наименование"]];
  if (showArticles) columns.push(["code", "Артикул"]);
  columns.push(["count", "Кол-во"], ["unit", "Ед."]);
  if (showPrices) columns.push(["price", "Цена"], ["sum", "Сумма"]);

  const NO_CODE = "артикул не определён";
  const ASSUMED = " (предположительно)";
  const sheet = [];
  sheet.push(columns.map(([, label]) => txt(label, S_HEADER)));

  rows.forEach((r, i) => {
    const unitPrice = r.code ? priceByCode.get(codeKey(r.code)) : undefined;
    const hasPrice = unitPrice != null;
    /* Имя: при скрытых артикулах чистим его через itemText (как КП) и дописываем пометку
       «предположительно» либо «· артикул не определён» — чтобы пробел и догадка не терялись. */
    const name = showArticles ? r.name : config.itemText(r.name, false, r.code)
      + (r.assumed ? ASSUMED : (!r.code ? " · " + NO_CODE : ""));
    sheet.push(columns.map(([key]) => {
      if (key === "n") return num(i + 1);
      if (key === "name") return txt(name);
      if (key === "code") return txt(r.code ? r.code + (r.assumed ? ASSUMED : "") : NO_CODE);
      if (key === "count") return num(Number(r.count) || 0);
      if (key === "unit") return txt(r.unit || "шт.");
      if (key === "price") return hasPrice ? num(unitPrice * rate, S_MONEY) : txt("");
      if (key === "sum") return hasPrice ? num(unitPrice * (Number(r.count) || 0) * rate, S_MONEY) : txt("");
      return txt("");
    }));
  });

  /* Итоги как в КП-своде: «Всего наименований» и «Общее количество». */
  if (rows.length) {
    sheet.push([]);
    sheet.push([txt("Всего наименований:", S_BOLD), num(supplier.totalNames != null ? supplier.totalNames : rows.length, S_BOLD)]);
    sheet.push([txt("Общее количество, шт.:", S_BOLD), num(supplier.totalUnits != null ? supplier.totalUnits
      : rows.reduce((a, r) => a + (Number(r.count) || 0), 0), S_BOLD)]);
    if (supplier.missing) sheet.push([txt("Позиций без артикула:", S_BOLD), num(supplier.missing, S_BOLD)]);
  }

  const widthOf = key => key === "name" ? 44 : key === "code" ? 20
    : key === "price" || key === "sum" ? 16 : key === "n" ? 6 : 10;
  return sheetXml(sheet, columns.map(([key]) => widthOf(key)));
}

/* ---- Минимальный писатель ZIP (STORE, без сжатия) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* Собрать .xlsx из набора {имя части: UTF-8 байты}. Порядок частей фиксирован (воспроизводимость:
   тот же вход → тот же байт-результат). Храним методом 0 (без сжатия) — распаковывается без inflate,
   а книга из нескольких килобайт в сжатии не нуждается. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = arr => { const u = Uint8Array.from(arr); chunks.push(u); offset += u.length; };
  const u16 = v => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

  files.forEach(f => {
    const nameBytes = utf8(f.name);
    const data = f.data;
    const crc = crc32(data);
    const localOffset = offset;
    /* Локальный заголовок. Флаг 0x0800 — имена частей в UTF-8 (у нас ASCII, но признак честный). */
    const header = [].concat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0),
      u16(0), u16(0),                       // время/дата — нули (воспроизводимость)
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0)
    );
    push(header);
    push(Array.from(nameBytes));
    chunks.push(data); offset += data.length;
    central.push({ nameBytes, crc, size: data.length, localOffset });
  });

  const cdStart = offset;
  central.forEach(c => {
    const rec = [].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
      u16(0), u16(0), u32(c.crc), u32(c.size), u32(c.size),
      u16(c.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(c.localOffset)
    );
    push(rec);
    push(Array.from(c.nameBytes));
  });
  const cdSize = offset - cdStart;
  push([].concat(
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(cdSize), u32(cdStart), u16(0)
  ));

  const total = chunks.reduce((a, u) => a + u.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  chunks.forEach(u => { out.set(u, p); p += u.length; });
  return out;
}

function build(est, supplier, deps) {
  const d = deps || {};
  const config = offerOptionsApi();
  const estimate = estimateApi();
  if (!config || !estimate) throw new Error("EPSpecExcel: нет EPOfferOptions/EPEstimate");
  const options = config.normalize(d.options);
  const currency = d.currency === "RUB" ? "RUB" : "EUR";
  const rate = Number(d.rate) > 0 ? Number(d.rate) : 1;
  const e = est || { groups: [] };
  const sup = supplier || { rows: [] };

  const sheet1 = buildSpecSheet(e, options, config, estimate, rate);
  const sheet2 = buildSupplierSheet(e, sup, options, config, rate);

  const contentTypes = `${XMLHEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `</Types>`;
  const rootRels = `${XMLHEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`;
  const workbook = `${XMLHEAD}<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets><sheet name="Спецификация" sheetId="1" r:id="rId1"/>`
    + `<sheet name="По артикулам" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const workbookRels = `${XMLHEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>`
    + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `</Relationships>`;

  const files = [
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rootRels) },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
    { name: "xl/styles.xml", data: utf8(stylesXml(currency)) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheet1) },
    { name: "xl/worksheets/sheet2.xml", data: utf8(sheet2) }
  ];
  return zip(files);
}

/* Имя файла выгрузки: номер КП (EPG-ГГГГ-NNNN), иначе название проекта, иначе «Спецификация».
   Запрещённые в именах файлов символы (\ / : * ? " < > |) и управляющие — на подчёркивание;
   длину режем, чтобы не упереться в лимит пути. Выгрузка номер КП не выдаёт и не сдвигает —
   использует уже присвоенный (его передаёт оркестратор). */
function fileName(number, project) {
  const base = (String(number || "").trim() || String(project || "").trim());
  const clean = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  /* Нет ни номера, ни названия — просто «Спецификация.xlsx», без удвоения слова. */
  return clean ? "Спецификация " + clean + ".xlsx" : "Спецификация.xlsx";
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для
   автотестов (PLAN 7.1). crc32 отдан наружу не для продакшена, а чтобы его можно было отдельно
   покрыть и сверить с независимым источником (zlib.crc32). */
const api = { build, fileName, crc32 };
if (typeof window !== "undefined") window.EPSpecExcel = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
