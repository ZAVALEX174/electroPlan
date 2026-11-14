/* К9: проверенный лист единого шаблона → товары рантайм-каталога.
   Чистый модуль: файл читает вызывающий, сервер/браузер только хранят результат. */
(() => {
"use strict";

function deps() {
  const T = typeof window !== "undefined" && window.EPPriceTemplate ||
    (typeof require !== "undefined" && require("./priceTemplate.js"));
  const S = typeof window !== "undefined" && window.EPPriceSheet ||
    (typeof require !== "undefined" && require("./priceSheet.js"));
  if (!T || !S) throw new Error("Нет правил шаблона прайса");
  return { T, S };
}
const str = value => String(value == null ? "" : value).trim();
const lower = value => str(value).toLocaleLowerCase("ru-RU");
const positiveInt = value => /^\d+$/.test(str(value)) && Number(value) > 0 ? Number(value) : null;
const standardOf = value => {
  const s = lower(value), it = s.includes("итальян"), de = s.includes("немец");
  return it && de ? "BOTH" : it ? "IT" : de ? "DE" : "UNKNOWN";
};
const wallTypeOf = value => {
  const s = lower(value), solid = s.includes("бетон") || s.includes("кирпич"), hollow = s.includes("гкл");
  return solid === hollow ? "unknown" : solid ? "solid" : "hollow";
};
const seriesOf = value => str(value).split(/[,;]/).map(s =>
  lower(s).replace(/(^|[\s-])([a-zа-яё])/g, (_, gap, letter) => gap + letter.toUpperCase())
).filter(Boolean);
const roleOf = value => ({ "в": "switch", "п": "changeover", "кн": "button",
  "и": "inverter", "д": "sensor", "bluetooth": "bluetooth" })[lower(value)] || null;
function kindOf(group, name, T, S) {
  const g = lower(group);
  if (T.FRAME_GROUPS.some(x => lower(x) === g) || S.isHermeticCover(group, name)) return "frame";
  if (T.SUPPORT_GROUPS.some(x => lower(x) === g)) return "support";
  if (T.BOX_GROUPS.some(x => lower(x) === g)) return "socket_box";
  if (T.ACCESSORY_GROUPS.some(x => lower(x) === g)) return "accessory";
  return "mechanism";
}
function partRoleOf(group, role, name) {
  if (["механизм", "механизмы"].includes(lower(group)) && ["switch", "changeover", "button", "inverter"].includes(role))
    return "bare_mechanism";
  const n = str(name);
  if (/^клавиша(?![а-яёa-z])/i.test(n) || /плоск[а-яё]*\s+клавиш/i.test(n)) return "key";
  if (/кругл[а-яё]*\s+клавиш|клавиш[а-яё]*\s+кругл/i.test(n) && !/автоматик|\bknx\b/i.test(n))
    return "key";
  return null;
}
function layoutOf(name, modules, levels) {
  const hit = str(name).match(/\(([^)]*\+[^)]*)\)/);
  const parts = hit ? (hit[1].match(/\d+/g) || []).map(Number).filter(n => n > 0) : [];
  if (parts.length >= 2) {
    if (levels >= 2 && parts.length === levels) return parts.map(n => [n]);
    if (levels <= 1 && parts.reduce((a, b) => a + b, 0) === modules) return [parts];
  }
  if (levels >= 2 && Number.isInteger(modules) && modules % levels === 0)
    return Array.from({ length: levels }, () => [modules / levels]);
  return null;
}
function assignIf(product, field, value) {
  if (value != null && value !== "") product[field] = value;
}

/* convert(rows, { existingProducts, startRow }): не меняет входы и не пишет в хранилище.
   Возвращает только товары из файла; сервер решит, когда публиковать новую версию. */
function convert(rows, options) {
  const { T, S } = deps();
  const opts = options || {};
  const validation = T.check(rows, { startRow: opts.startRow });
  if (!validation.ok) return { ...validation, products: [], changes: null };
  const grid = Array.isArray(rows) ? rows : [];
  const headerIndex = S.findHeaderRow(grid);
  const columns = new Map();
  grid[headerIndex].forEach((h, i) => { if (!columns.has(str(h))) columns.set(str(h), i); });
  const at = (row, name) => { const i = columns.get(name); return i == null ? null : row[i]; };
  const old = Array.isArray(opts.existingProducts) ? opts.existingProducts : [];
  const byCode = new Map(old.filter(p => p && p.code).map(p => [str(p.code), p]));
  let nextId = old.reduce((max, p) => Math.max(max, Number(p && p.id) || 0), 0) + 1;
  const products = [], changes = { added: 0, updated: 0, unchanged: 0 };
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!Array.isArray(row)) continue;
    const code = str(at(row, "Артикул"));
    if (!code || T.FX_CODE_RE.test(code)) continue;
    const base = byCode.get(code);
    const name = str(at(row, "Наименование"));
    const group = str(at(row, "Функциональная группа"));
    const kind = kindOf(group, name, T, S);
    const moduleSize = S.moduleCountOf(at(row, "Количество модулей"));
    const series = seriesOf(at(row, "Коллекция"));
    const price = Math.round(S.parsePrice(at(row, "Прайс розница РФ, Евро")) * 100) / 100;
    const defaults = { frame: [100, "□"], support: [200, "≡"], socket_box: [200, "○"] };
    const [categoryId, icon] = defaults[kind] || [1000, "•"];
    /* Прайс — источник полей товара: пустые необязательные ячейки снимают прежний признак.
       Сохраняем лишь данные фото/геометрии, которых в шаблоне нет. */
    const media = {};
    if (base && base.kind === kind) for (const field of ["imageUrl", "previewImageUrl", "faceRect",
      "mountRect", "mountRects", "thermoSensorCode"]) {
      if (base[field] != null) media[field] = base[field];
    }
    const product = { ...media, id: base ? base.id : nextId++, code, name, kind,
      categoryId: base && base.kind === kind ? base.categoryId : categoryId,
      icon: base && base.kind === kind ? base.icon : icon,
      price, currency: "EUR", unit: "шт.", active: true,
      series, compatibility: series.join(", ") };
    const pack = positiveInt(at(row, "Кол-во в упаковке"));
    assignIf(product, "packQty", pack);
    assignIf(product, "brand", str(at(row, "Бренд")));
    const color = str(at(row, "Цвет механизма"));
    assignIf(product, "color", color);
    assignIf(product, "elementColor", color);
    assignIf(product, "functionalGroup", group);
    assignIf(product, "functionalSubgroup", str(at(row, "Подгруппы")));
    assignIf(product, "note", str(at(row, "Примечание")));
    assignIf(product, "description", str(at(row, "Описание особенностей элемента")));
    assignIf(product, "imageCaption", str(at(row, "Подпись для картинки")));
    assignIf(product, "frameColorCode", str(at(row, "Кодировка цвета накладки")));
    const imageUrl = str(at(row, "Изображение"));
    if (imageUrl && imageUrl !== product.imageUrl) {
      product.imageUrl = imageUrl;
      delete product.previewImageUrl;
    }
    assignIf(product, "principle", str(at(row, "Принцип обработки")));
    assignIf(product, "boxModularity", positiveInt(at(row, "Модульность для коробки")));
    assignIf(product, "accessGroup", positiveInt(at(row, "Группа доступа")));
    const role = roleOf(at(row, "Тип управления"));
    if (kind === "mechanism") {
      assignIf(product, "controlRole", role);
      assignIf(product, "partRole", partRoleOf(group, role, name));
    }
    if (kind === "frame") {
      product.slotCount = moduleSize;
      product.standard = standardOf(at(row, "Монтажный стандарт"));
      product.frameColor = str(at(row, "Цвет накладки"));
      product.frameMaterial = str(at(row, "Материал накладки"));
      product.frameShape = str(at(row, "Форма накладки"));
      const rawLevels = positiveInt(at(row, "Количество уровней в рамке"));
      const levels = rawLevels || (moduleSize > 8 && str(at(row, "Количество модулей")).includes("+")
        ? (str(at(row, "Количество модулей")).match(/\d+/g) || []).length : 1);
      const layoutRows = layoutOf(name, moduleSize, levels);
      if (layoutRows) {
        product.layoutRows = layoutRows;
        product.postCount = layoutRows.reduce((n, row) => n + row.length, 0);
      }
    } else if (kind === "support") {
      assignIf(product, "moduleCount", moduleSize);
      const standard = standardOf(at(row, "Монтажный стандарт"));
      if (standard !== "UNKNOWN") product.standard = standard;
    } else if (kind === "socket_box") {
      assignIf(product, "boxModules", moduleSize);
      product.wallType = wallTypeOf(at(row, "Тип стены"));
      product.boxShape = /кругл/i.test(name) ? "round" : "rect";
      product.boxStandards = product.boxShape === "round" ? ["IT_ROUND", "DE", "FR"] : ["IT"];
    } else if (kind === "mechanism" && Number.isInteger(moduleSize) && moduleSize >= 1 && moduleSize <= 8) {
      product.moduleSpan = moduleSize;
    }
    if (str(at(row, "Спрашивать подсветку 1 - да, пусто - нет")) === "1") product.askBacklight = true;
    assignIf(product, "backlightColor", str(at(row, "Цвет подсветки")));
    assignIf(product, "backlightPosition", positiveInt(at(row, "Позиция подсветки 1 - верх, 2 - центр, 3 - низ")));
    products.push(product);
    if (!base) changes.added++;
    else if (JSON.stringify(base) === JSON.stringify(product)) changes.unchanged++;
    else changes.updated++;
  }
  if (!products.length) return { ok: false, errors: [{ key: "empty", count: 0, message: "В файле нет товаров для каталога." }],
    warnings: validation.warnings, stats: validation.stats, products: [], changes: null };
  return { ...validation, products, changes };
}

const api = { convert, standardOf, wallTypeOf, seriesOf, roleOf, kindOf, partRoleOf, layoutOf };
if (typeof window !== "undefined") window.EPPriceCatalog = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
