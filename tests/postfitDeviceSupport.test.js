/* Д3 — суппорт ПОД КОНКРЕТНОЕ УСТРОЙСТВО (EnOcean/РЧ/настенный модуль) не должен выбираться как
   общая планка под накладку. В новой номенклатуре такие суппорты (09507/19507/21507.1/22507/30507/
   14507) оказались в каталоге раньше обычных и дороже, и общий шаг подбора по модульности брал их:
   снятая Arke 19682.11 получала 19507 (16.43 €) вместо 19602 (4.19 €), Plana Up 14652U.01 — 14507
   (16.17 €) вместо 14612 (7.59 €). Проверяем на НАСТОЯЩЕМ каталоге рантайма (как в index.html).

   Мутация (состязательный проход): в resolveSupport убрать строку `pool = pool.filter(s => !isDeviceSupport(s))`
   — снятая 19682.11 снова получит 19507, тест «не device-суппорт» покраснеет.
   Запуск: node --test tests/postfitDeviceSupport.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const PF = require("../js/postfit.js");

function loadRuntime() {
  const jsDir = path.join(__dirname, "..", "js");
  const win = {};
  const context = vm.createContext({ window: win, structuredClone });
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-discontinued.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(jsDir, file), "utf8"), context, { filename: file });
  }
  return win.EP_DATA.products;
}
const PRODUCTS = loadRuntime();
const byCode = code => PRODUCTS.find(p => String(p.code) === code);
const seriesOf = item => (item && item.series) || [];
const SUPPORTS = PRODUCTS.filter(p => p.kind === "support" && p.active);
const BOXES = PRODUCTS.filter(p => p.kind === "socket_box" && p.active);
const DEVICE_RE = /устройств|enocean/i;

const supportFor = (frameCode, wall) => {
  const f = byCode(frameCode);
  assert.ok(f, `накладка ${frameCode} есть в каталоге`);
  const o = { boxes: BOXES, frame: f, standard: f.standard, modules: f.slotCount, frameModules: f.slotCount, wantedWall: wall };
  const box = PF.findBox(o) || PF.fallbackBox(o);
  return PF.resolveSupport({ supports: SUPPORTS, frame: f, standard: f.standard, modules: f.slotCount, frameModules: f.slotCount, seriesOf, box }).support;
};

test("снятая Arke 19682.11 получает обычный суппорт 19602, а не EnOcean-19507", () => {
  for (const wall of ["solid", "hollow"]) {
    const s = supportFor("19682.11", wall);
    assert.ok(s, `19682.11/${wall}: суппорт подобран`);
    assert.equal(s.code, "19602", `19682.11/${wall}: обычный 19602`);
  }
});

test("Plana Up 14652U.01 получает центральный 14612, а не РЧ-14507", () => {
  const s = supportFor("14652U.01", "solid");
  assert.ok(s, "14652U.01: суппорт подобран");
  assert.equal(s.code, "14612", "14652U.01: центральный 14612, не 14507");
});

test("ни одна накладка каталога не получает суппорт под устройство", () => {
  const bad = [];
  for (const f of PRODUCTS.filter(p => p.kind === "frame")) {
    for (const wall of ["solid", "hollow"]) {
      const s = supportFor(f.code, wall);
      if (s && DEVICE_RE.test(String(s.name || ""))) bad.push(`${f.code}/${wall} -> ${s.code}`);
    }
  }
  assert.deepEqual(bad, [], "ни один frame не должен подбирать суппорт-под-устройство");
});

test("признак ловит именно суппорты-под-устройство (11 шт.) и ни одной общей планки 602/603", () => {
  const device = PRODUCTS.filter(p => p.kind === "support" && DEVICE_RE.test(String(p.name || "")));
  assert.ok(device.length >= 11, `суппортов-под-устройство не меньше 11 (нашли ${device.length})`);
  // Контроль: общая планка типа 602/603 (её тип задаёт коробка) под признак НЕ попадает — иначе
  // фильтр выгрыз бы штатный подбор. Тип — последние 3 цифры базового артикула (как supportTypeCode).
  const typeOf = code => (String(code || "").split(".")[0].match(/(\d{3})$/) || [])[1] || "";
  const generics = PRODUCTS.filter(p => p.kind === "support" && ["602", "603"].includes(typeOf(p.code)));
  assert.ok(generics.length > 0, "в каталоге есть общие планки 602/603");
  const falsePositive = generics.filter(p => DEVICE_RE.test(String(p.name || "")));
  assert.equal(falsePositive.length, 0, `признак не должен задевать общие планки 602/603: ${falsePositive.map(p => p.code).join(",")}`);
});
