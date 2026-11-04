"use strict";
/* Контракт собранного каталога по фото: заглушка сайта «нет фото» (…/no_photo.png) НЕ должна
   попадать в js/catalog-vimar.js. Признак заглушки распознаёт конвертер (tools/build-catalog.mjs,
   isPlaceholderImageUrl) — ОДНО место в источнике данных (§7.1), после которого поле фото просто
   не выводится. Тест сторожит АРТЕФАКТ, который читают ВСЕ потребители (productImage, сырой
   EPPostImage.photoReady накладки, миниатюры, КП): позиция с заглушкой обязана выглядеть как товар
   без фото.

   МУТАЦИЯ: если убрать распознавание заглушки в конвертере (вернуть безусловную запись
   image.*_url) и пересобрать каталог — в js/catalog-vimar.js вернутся 29 no_photo-URL, и первая
   проверка станет красной. Проверено вручную: с мутацией «no_photo в каталоге: 29», без неё «0». */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function loadCatalog() {
  const win = {};
  const context = vm.createContext({ window: win });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "catalog-vimar.js"), "utf8"), context, { filename: "catalog-vimar.js" });
  return win.EP_VIMAR_CATALOG;
}

const isPlaceholder = url => /no_photo/i.test(String(url || ""));

test("catalog-vimar.js: ни у одной позиции нет заглушки no_photo в полях фото", () => {
  const products = loadCatalog().products;
  const leaked = products.filter(p => isPlaceholder(p.imageUrl) || isPlaceholder(p.previewImageUrl));
  assert.equal(leaked.length, 0,
    "заглушка no_photo должна отсеиваться конвертером: " + leaked.map(p => p.code).join(", "));
});

test("позиции без единого фото выглядят как «без фото»: полей imageUrl/previewImageUrl нет вовсе", () => {
  const byCode = new Map(loadCatalog().products.map(p => [p.code, p]));
  // Представители позиций, у которых фото нет НИГДЕ: ни в индексе vimar.ru, ни своего файла
  // в img/catalog/ (04.11: свой файл первым всегда — 02972, 14642.26, 00935.A получили фото
  // с vimar.com и больше не подходят фикстурами; взяты текущие безфото mechanism + 2 frame).
  // ВНИМАНИЕ: если докачка (tools/download-catalog-images.mjs) принесёт файлы и этим кодам —
  // фикстуры надо заменить на другие безфото позиции (их список: поиск по каталогу без imageUrl).
  for (const code of ["14135.1.SL", "30642.70", "30654.70"]) {
    const p = byCode.get(code);
    assert.ok(p, `позиция ${code} должна быть в каталоге`);
    assert.ok(!("imageUrl" in p), `${code}: поля imageUrl быть не должно`);
    assert.ok(!("previewImageUrl" in p), `${code}: поля previewImageUrl быть не должно`);
  }
});

test("настоящие фото не задеты: у большинства позиций каталога фото на месте", () => {
  const products = loadCatalog().products;
  // Страховка от обратной мутации «вырезать всё подряд»: реальных URL должно оставаться много.
  const withPhoto = products.filter(p => (p.imageUrl && !isPlaceholder(p.imageUrl)) || (p.previewImageUrl && !isPlaceholder(p.previewImageUrl)));
  assert.ok(withPhoto.length > 1000, `настоящих фото ожидается >1000, получено ${withPhoto.length}`);
});
