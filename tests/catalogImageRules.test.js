"use strict";
/* Правила картинок каталога — ОДНО место для обоих конвертеров (tools/lib/catalog-images.mjs),
   §7.1: правка без краёв. Проверяем два правила и их применение в собранных каталогах.

   ПРАВИЛО 2 (localImagePaths): свой файл первым ВСЕГДА. Если .jpg нет, а .webp есть — товар
   получает свой .webp (а не ссылку на сайт). У части позиций на vimar.com есть только webp
   (09026.DND.CM), а vimar.ru лёг 03.11.
   ПРАВИЛО 3 (isDeadImageUrl): мёртвая ссылка = «фото нет». Любой URL на vimar.ru (сайт лёг) и
   заглушка no_photo — поле не выводим, рантайм показывает свою заглушку. Живой vimar.com — не трогаем.

   КРАСНЫЙ ДО ПРАВКИ: до пересборки каталогов §нет-vimar.ru падает (в js/catalog-vimar.js было
   10 ссылок на vimar.ru у 5 позиций, в снятых — 1). МУТАЦИЯ: убрать webp-фолбэк в localImagePaths →
   краснеет §правило-2-webp; убрать vimar.ru из isDeadImageUrl → краснеют §правило-3 и §нет-vimar.ru. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const LIB = pathToFileURL(path.join(ROOT, "tools", "lib", "catalog-images.mjs")).href;

function loadGlobal(file, name) {
  const win = {};
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", file), "utf8"),
    vm.createContext({ window: win }), { filename: file });
  return win[name];
}

test("§правило-2-webp: .jpg нет, а .webp есть → свой .webp, а не ссылка на сайт", async () => {
  const { localImagePaths } = await import(LIB);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epimg-"));
  fs.writeFileSync(path.join(dir, "09026.DND.CM.webp"), "x");
  const r = localImagePaths(dir, "09026.DND.CM");
  assert.equal(r.full, "img/catalog/09026.DND.CM.webp", "full берёт .webp, когда .jpg нет");
  assert.equal(r.preview, "img/catalog/09026.DND.CM.webp", "preview тоже .webp");
});

test("§правило-2-jpg: есть .jpg(+.webp) → full=.jpg, preview=.webp (прежнее поведение)", async () => {
  const { localImagePaths } = await import(LIB);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epimg-"));
  fs.writeFileSync(path.join(dir, "21642.08.jpg"), "x");
  fs.writeFileSync(path.join(dir, "21642.08.webp"), "x");
  const r = localImagePaths(dir, "21642.08");
  assert.equal(r.full, "img/catalog/21642.08.jpg");
  assert.equal(r.preview, "img/catalog/21642.08.webp");
});

test("§правило-2-нет-файла: своего файла нет → full пусто (решает ссылка)", async () => {
  const { localImagePaths } = await import(LIB);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epimg-"));
  const r = localImagePaths(dir, "14642.33");
  assert.equal(r.full, "", "без файла full пустой");
});

test("§правило-3: vimar.ru и no_photo — мёртвые; vimar.com и локальный путь — живые", async () => {
  const { isDeadImageUrl } = await import(LIB);
  assert.equal(isDeadImageUrl("https://vimar.ru/upload/iblock/98d/x.jpg"), true, "vimar.ru = мёртвая");
  assert.equal(isDeadImageUrl("https://vimar.ru/upload/resize_cache/.../no_photo.png"), true, "no_photo = мёртвая");
  assert.equal(isDeadImageUrl("https://www.vimar.com/irj/go/km/docs/.../x.jpg"), false, "vimar.com живой");
  assert.equal(isDeadImageUrl("img/catalog/21642.08.jpg"), false, "локальный путь не мёртвый");
  assert.equal(isDeadImageUrl(""), false);
  assert.equal(isDeadImageUrl(null), false);
});

test("§нет-vimar.ru: в собранных каталогах не осталось ни одной ссылки на vimar.ru", () => {
  const dead = u => /vimar\.ru/i.test(String(u || ""));
  const main = loadGlobal("catalog-vimar.js", "EP_VIMAR_CATALOG").products;
  const disc = loadGlobal("catalog-vimar-discontinued.js", "EP_VIMAR_DISCONTINUED").products;
  const bad = [...main, ...disc].filter(p => dead(p.imageUrl) || dead(p.previewImageUrl));
  assert.equal(bad.length, 0, "ссылки на мёртвый vimar.ru: " + bad.map(p => p.code).join(", "));
});

test("§webp-в-каталоге: 09026.DND.CM получил свой .webp (правило 2 на реальных данных)", () => {
  const p = loadGlobal("catalog-vimar.js", "EP_VIMAR_CATALOG").products.find(x => x.code === "09026.DND.CM");
  assert.ok(p, "позиция 09026.DND.CM должна быть в каталоге");
  assert.equal(p.imageUrl, "img/catalog/09026.DND.CM.webp", "imageUrl = свой .webp");
});

test("§настоящие-фото-целы: реальных картинок в каталоге по-прежнему много (от обратной мутации)", () => {
  const main = loadGlobal("catalog-vimar.js", "EP_VIMAR_CATALOG").products;
  const withPhoto = main.filter(p => p.imageUrl || p.previewImageUrl);
  assert.ok(withPhoto.length > 1000, "ожидается >1000 позиций с фото, получено " + withPhoto.length);
});
