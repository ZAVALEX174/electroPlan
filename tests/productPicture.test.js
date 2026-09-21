"use strict";
/* ПОВЕДЕНЧЕСКИЙ тест единой точки рисования картинки товара — productPicture (js/app.js).
   Владелец принял пустышку «голубой квадрат с крохотным значком» за сломанное изображение.
   Согласовано: у товара без фото в карточке — значок товара (item.icon) И подпись «Нет фото»,
   чтобы было видно: фото просто нет. У товара С фото ничего не меняется и подписи быть НЕ должно.

   Исполняем ИСХОДНЫЙ ТЕКСТ productPicture и esc из app.js (общий стенд, §7.1 — копий не держим),
   productImage берём настоящий из EPCatalog. Проверяем и на синтетике, и на реальном 14003.SL
   («Выключатель тройной 1P 20AX серебристый»), у которого в каталоге фото нет.

   МУТАЦИЯ (число в отчёте): убрать из productPicture ветку `<span class="product-picture-nophoto">
   Нет фото</span>` — краснеют 3 проверки (§нет-фото-синтетика, §нет-фото-каталог, а также
   §есть-фото косвенно защищает обратную мутацию «рисовать подпись всегда»). Запуск: node --test. */

const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");

/* Настоящие esc и productPicture из app.js в одном vm-контексте; productImage — из EPCatalog
   (в app.js он деструктурирован оттуда же). Подпись «Нет фото» productPicture берёт из общей точки
   NO_PHOTO_LABEL (§7.1) — вырезаем её настоящий текст рядом, иначе функция упадёт ReferenceError. */
const picture = stand.runNamed(["esc", "NO_PHOTO_LABEL", "productPicture"], { productImage: EPCatalog.productImage });

test("§нет-фото-синтетика: товар без фото → значок item.icon + подпись «Нет фото» + title", () => {
  const html = picture({ name: "Накладка", icon: "□" });
  // Целимся в ВИДИМУЮ подпись, а не в title="Нет фото": иначе удаление подписи не покраснело бы.
  assert.match(html, /product-picture-nophoto">Нет фото</, "у товара без фото должна быть видимая подпись «Нет фото»");
  assert.match(html, /product-picture-glyph">□</, "значок товара (item.icon) должен остаться");
  assert.match(html, /title="Нет фото"/, "плитка без фото получает подсказку title");
  assert.doesNotMatch(html, /has-image/, "без фото класса has-image быть не должно");
  assert.doesNotMatch(html, /<img/, "без фото <img> не выводим");
});

test("§есть-фото: товар с фото → <img>, has-image и НИКАКОЙ подписи «Нет фото»", () => {
  const html = picture({ name: "Механизм", icon: "○", previewImageUrl: "https://x/real.jpg" });
  assert.match(html, /<img[^>]+src="https:\/\/x\/real\.jpg"/, "фото выводится <img>");
  assert.match(html, /class="product-picture\s+has-image"/, "с фото ставится has-image");
  assert.doesNotMatch(html, /Нет фото/, "у товара с фото подписи «Нет фото» быть не должно");
});

test("§заглушка-no_photo: превью-заглушка выгрузки = «нет фото» → подпись «Нет фото»", () => {
  // productImage отбрасывает no_photo; для productPicture это тот же случай «фото нет».
  const html = picture({ name: "Суппорт", icon: "▭", previewImageUrl: "https://vimar.ru/no_photo.png" });
  assert.match(html, /product-picture-nophoto">Нет фото</, "заглушка no_photo трактуется как отсутствие фото");
  assert.doesNotMatch(html, /<img/, "заглушку no_photo как <img> не выводим");
});

test("§нет-фото-каталог: реальный 14003.SL (фото в каталоге нет) рисует «Нет фото»", () => {
  const catalog = stand.loadVimarCatalog();
  const item = catalog.products.find(p => p.code === "14003.SL");
  assert.ok(item, "14003.SL должен быть в каталоге VIMAR");
  const html = picture(item);
  assert.match(html, /product-picture-nophoto">Нет фото</, "у 14003.SL фото нет → в карточке подпись «Нет фото»");
  assert.doesNotMatch(html, /<img/, "у 14003.SL картинки нет — <img> не выводим");
});
