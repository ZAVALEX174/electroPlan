/* К9: подготовка выпуска общего каталога. Ввод проверен шаблоном; сохранённые
   проекты используют собственные снимки. Эта сборка не обращается к диску. */
(() => {
"use strict";
const kinds = new Set(["frame", "mechanism", "support", "socket_box", "accessory"]);
/* Поля, которыми управляет шаблон: пустая ячейка удаляет прежний признак.
   Остальные вычисленные/проверенные признаки сохраняются по артикулу и виду. */
const managed = new Set(("id code name kind categoryId icon price currency unit active series compatibility packQty brand color elementColor functionalGroup functionalSubgroup note description imageCaption frameColorCode principle boxModularity accessGroup controlRole partRole slotCount standard frameColor frameMaterial frameShape layoutRows postCount moduleCount boxModules wallType boxShape boxStandards moduleSpan askBacklight backlightColor backlightPosition").split(" "));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function validate(products) {
  const remote = typeof require === "function" ? require("./catalogRemote.js") : window.EPCatalogRemote;
  remote.validateProducts(products);
  if (!Array.isArray(products) || !products.length) throw new Error("Каталог пуст");
  const ids = new Set(), codes = new Set();
  for (const p of products) {
    if (!p || typeof p !== "object" || Array.isArray(p) || !Number.isSafeInteger(p.id) || p.id < 1
      || typeof p.code !== "string" || !p.code.trim() || typeof p.name !== "string" || !p.name.trim()
      || !kinds.has(p.kind) || !Number.isFinite(p.price) || p.price < 0 || p.currency !== "EUR")
      throw new Error("Некорректный товар: " + String(p && p.code));
    const code = p.code.trim().toUpperCase();
    if (ids.has(p.id) || codes.has(code)) throw new Error("Повтор ID или артикула: " + code);
    ids.add(p.id); codes.add(code);
    for (const field of ["imageUrl", "previewImageUrl"]) {
      const url = p[field];
      if (url != null && (typeof url !== "string" || !/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]+|(?:\.\/)?img\/[^\s]+)$/i.test(url)))
        throw new Error("Небезопасный адрес изображения: " + code);
    }
  }
  return products;
}
function build(existing, incoming, options = {}) {
  validate(existing); validate(incoming);
  const old = new Map(existing.map(p => [p.code.toUpperCase(), p]));
  const seen = new Set();
  const report = { added: [], updated: [], unchanged: [], retired: [], missing: [], prices: [] };
  const products = incoming.map(p => {
    const key = p.code.toUpperCase(), prev = old.get(key); seen.add(key);
    let next = { ...p };
    if (prev) {
      if (prev.id !== p.id) throw new Error("Изменился ID артикула: " + p.code);
      if (prev.kind === p.kind) {
        const curated = Object.fromEntries(Object.entries(prev).filter(([key]) => !managed.has(key)));
        next = { ...curated, ...p };
        // Новая фотография не должна наследовать кадрирование старой.
        if (p.imageUrl !== prev.imageUrl) for (const field of ["previewImageUrl", "faceRect", "mountRect", "mountRects"])
          delete next[field];
      }
      if (prev.price !== next.price) report.prices.push({ code: p.code, before: prev.price, after: next.price });
      report[JSON.stringify(stable(prev)) === JSON.stringify(stable(next)) ? "unchanged" : "updated"].push(p.code);
    } else report.added.push(p.code);
    return next;
  });
  for (const p of existing) if (!seen.has(p.code.toUpperCase())) {
    report.missing.push(p.code);
    if (options.retireMissing && p.active !== false) {
      products.push({ ...p, active: false }); report.retired.push(p.code);
    } else products.push({ ...p });
  }
  if (!products.some(p => p.active !== false)) throw new Error("В каталоге не осталось действующих товаров");
  validate(products);
  return { products, report };
}
const api = { validate, build };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.EPCatalogRelease = api;
})();
