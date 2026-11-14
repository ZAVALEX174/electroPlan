/* К9: неизменяемая версия каталога внутри проекта.
   Записываем все товары: состав поста включает автоматически подобранные коробки,
   суппорты, подсветки и механизмы групп света, поэтому одних явных ID недостаточно.
   Индексы имён полей уменьшают JSON без потери полей и без отдельной базы данных. */
(() => {
"use strict";

function pack(products) {
  if (!Array.isArray(products)) throw new TypeError("Ожидался каталог товаров");
  const keys = [], indexes = new Map();
  const rows = products.map(product => {
    if (!product || typeof product !== "object" || Array.isArray(product))
      throw new TypeError("Некорректный товар каталога");
    const row = [];
    for (const [key, value] of Object.entries(product)) {
      if (value === undefined) continue;
      let index = indexes.get(key);
      if (index === undefined) { index = keys.length; keys.push(key); indexes.set(key, index); }
      row.push(index, value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value);
    }
    return row;
  });
  return { format: 1, keys, rows };
}

function unpack(snapshot) {
  if (!snapshot || snapshot.format !== 1 || !Array.isArray(snapshot.keys) || !Array.isArray(snapshot.rows)
    || !snapshot.keys.every(key => typeof key === "string" && key !== "__proto__" && key !== "constructor"))
    throw new TypeError("Некорректный снимок каталога");
  return snapshot.rows.map(row => {
    if (!Array.isArray(row) || row.length % 2) throw new TypeError("Некорректная строка каталога");
    const product = {};
    for (let i = 0; i < row.length; i += 2) {
      const index = row[i];
      if (!Number.isInteger(index) || index < 0 || index >= snapshot.keys.length)
        throw new TypeError("Некорректное поле каталога");
      product[snapshot.keys[index]] = row[i + 1];
    }
    if (product.id == null || !product.code) throw new TypeError("У товара нет ID или артикула");
    return product;
  });
}

const api = { pack, unpack };
if (typeof window !== "undefined") window.EPProjectCatalog = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
