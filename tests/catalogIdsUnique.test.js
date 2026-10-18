"use strict";
/* Защита от дефекта пересечения id (К2, 18.10): у двух товаров оказался один id, и пост на
   одном артикуле получал цену/состав другого (id 201686 делили «21653.01» и «20022.P.N»).

   Два уровня проверки:
   1) НА НАСТОЯЩЕМ js/catalog-vimar.js — число уникальных id равно числу товаров. Это ловит
      коллизию в собранном каталоге независимо от того, как её внёс конвертер.
   2) НА ФУНКЦИИ ВЫДАЧИ (tools/lib/stable-ids.mjs, ESM — через динамический import) — новый
      код не получает занятый id. Мутация в build-catalog.mjs «id = 200000 + sourceRow»
      возвращает дефект: тогда п.1 краснеет после пересборки (строки файла пересекаются с
      уже выданными сид-id). */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

test("catalog-vimar.js: число уникальных id равно числу товаров", () => {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "js", "catalog-vimar.js"), "utf8"), { window: win });
  const products = win.EP_VIMAR_CATALOG.products;
  const ids = products.map((p) => p.id);
  const unique = new Set(ids);
  // Перечислим столкнувшиеся id в сообщении — чтобы при падении сразу видеть артикулы.
  const byId = new Map();
  for (const p of products) (byId.get(p.id) || byId.set(p.id, []).get(p.id)).push(p.code);
  const collisions = [...byId.entries()].filter(([, codes]) => codes.length > 1);
  assert.equal(
    unique.size, products.length,
    `коллизия id: ${collisions.map(([id, codes]) => `${id}←${codes.join("/")}`).join("; ")}`
  );
});

let S;
before(async () => {
  S = await import(pathToFileURL(path.join(ROOT, "tools", "lib", "stable-ids.mjs")).href);
});

test("assignStableIds: новый код получает id выше максимального, без коллизий", () => {
  // Сид с «дырами» и с id в диапазоне 200000+ — как в настоящей карте. Коды нарочно поданы
  // не по порядку, чтобы проверить сортировку выдачи.
  const seed = { "A": 5, "B": 10, "Z": 202147 };
  const { idMap, assigned } = S.assignStableIds(seed, ["B", "C", "A", "Y", "X"]);
  const seedMax = Math.max(...Object.values(seed));
  // Прежние коды не тронуты
  assert.equal(idMap.A, 5);
  assert.equal(idMap.B, 10);
  assert.equal(idMap.Z, 202147);
  // Новые — C, X, Y (B и A уже были); выданы по возрастанию кода от seedMax+1
  assert.deepEqual(assigned, [
    { code: "C", id: seedMax + 1 },
    { code: "X", id: seedMax + 2 },
    { code: "Y", id: seedMax + 3 },
  ]);
  // Ни один новый id не совпал с занятым и все строго выше максимума сида
  const seedIds = new Set(Object.values(seed));
  for (const { id } of assigned) {
    assert.ok(id > seedMax, `новый id ${id} должен быть выше максимума сида ${seedMax}`);
    assert.ok(!seedIds.has(id), `новый id ${id} не должен совпадать с занятым`);
  }
  // Итоговая карта без коллизий
  const all = Object.values(idMap);
  assert.equal(new Set(all).size, all.length);
});

test("assignStableIds: детерминизм и идемпотентность", () => {
  const seed = { "B": 100 };
  const first = S.assignStableIds(seed, ["D", "C", "A"]);
  // Порядок входа не влияет на результат
  const second = S.assignStableIds(seed, ["A", "C", "D"]);
  assert.deepEqual(first.idMap, second.idMap);
  // Повторный прогон с уже полной картой ничего не выдаёт
  const repeat = S.assignStableIds(first.idMap, ["A", "C", "D", "B"]);
  assert.equal(repeat.assigned.length, 0);
  assert.deepEqual(repeat.idMap, first.idMap);
});

test("assertUniqueIds: падает при двух товарах с одним id", () => {
  assert.throws(
    () => S.assertUniqueIds([{ id: 1, code: "X" }, { id: 1, code: "Y" }, { id: 2, code: "Z" }]),
    /Коллизия id/
  );
  // Уникальные id — не бросает
  assert.doesNotThrow(() => S.assertUniqueIds([{ id: 1, code: "X" }, { id: 2, code: "Y" }]));
});
