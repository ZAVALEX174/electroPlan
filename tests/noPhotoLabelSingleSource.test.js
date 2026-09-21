"use strict";
/* ПОВЕДЕНЧЕСКИЙ тест-сторож: подпись «фото нет» — ОДНА формулировка на всех разметках (§7.1).
   Карточка каталога (productPicture) и плитка мастера подбора отделки (framePickThumb) обязаны
   брать фразу из общей точки NO_PHOTO_LABEL (js/app.js), а не держать литерал у себя. Раньше
   карточка писала «Нет фото», а мастер — «без фото»: владелец видел две разные фразы про одно.

   КАК ПРОВЕРЯЕМ ЕДИНСТВО ТОЧКИ. Исполняем НАСТОЯЩИЙ текст обеих функций из app.js, но подставляем
   в их лексику ЧУЖОЕ значение NO_PHOTO_LABEL (sentinel). Если разметка читает общую переменную —
   sentinel окажется в выводе; если где-то остался зашитый литерал — sentinel туда не попадёт, и
   проверка покраснеет. Отдельно сверяем реальную формулировку и то, что «без фото» не вернулась.

   МУТАЦИЯ (число в отчёте): вернуть литерал «без фото» в любую ветку framePickThumb — краснеют
   §реальная-подпись и §без-фото-не-вернулась (2 теста). Запуск: node --test tests/ */

const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

/* Нейтральные шимы: esc не участвует в проверяемой подписи (она — константа), а productImage=>""
   загоняет карточку в ветку «фото нет». */
const CTX = () => ({ esc: String, productImage: () => "" });
const SENTINEL = "⟦sentinel-нет-фото⟧";
const noPhotoItem = { name: "Накладка", icon: "□" };

test("§единая-точка: карточка и плитка мастера подхватывают подставленный NO_PHOTO_LABEL", () => {
  // Чужое значение подписи в лексике обеих функций — обе обязаны его отрисовать.
  const card = stand.run(["productPicture"], Object.assign(CTX(), { NO_PHOTO_LABEL: SENTINEL }))(noPhotoItem);
  const tile = stand.run(["framePickThumb"], Object.assign(CTX(), { NO_PHOTO_LABEL: SENTINEL }))("", "Белый");

  assert.ok(card.includes(`product-picture-nophoto">${SENTINEL}<`), "видимая подпись карточки читает NO_PHOTO_LABEL");
  assert.ok(card.includes(`title="${SENTINEL}"`), "title карточки читает NO_PHOTO_LABEL");
  assert.ok(tile.includes(SENTINEL), "фолбэк плитки мастера читает NO_PHOTO_LABEL");
});

test("§реальная-подпись: с настоящей константой обе разметки пишут «Нет фото»", () => {
  const card = stand.runNamed(["NO_PHOTO_LABEL", "productPicture"], CTX())(noPhotoItem);
  const tileEmpty = stand.runNamed(["NO_PHOTO_LABEL", "framePickThumb"], CTX())("", "Белый");
  const tilePhoto = stand.runNamed(["NO_PHOTO_LABEL", "framePickThumb"], CTX())("arke.jpg", "Белый");

  assert.match(card, /product-picture-nophoto">Нет фото</, "карточка без фото пишет «Нет фото»");
  assert.match(tileEmpty, /product-picture-fallback[^>]*>Нет фото</, "плитка без фото пишет «Нет фото»");
  assert.match(tilePhoto, /product-picture-fallback[^>]*>Нет фото</, "фолбэк плитки с фото (виден при ошибке загрузки) тоже «Нет фото»");
});

test("§без-фото-не-вернулась: старую формулировку «без фото» не пишет ни одна разметка", () => {
  const card = stand.runNamed(["NO_PHOTO_LABEL", "productPicture"], CTX())(noPhotoItem);
  const tile = stand.runNamed(["NO_PHOTO_LABEL", "framePickThumb"], CTX())("", "Белый");
  assert.doesNotMatch(card, /без фото/, "карточка не должна писать «без фото»");
  assert.doesNotMatch(tile, /без фото/, "плитка мастера не должна писать «без фото»");
});
