/* З-К2-1: исполняем настоящие обёртки app.js, чтобы запас снятых товаров
   не мог исчезнуть из проводки при зелёных тестах чистого EPCatalogPool. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const { stripComments } = require("./helpers/stripComments.js");
const Pool = require("../js/catalogPool.js");
const Fit = require("../js/postfit.js");
const Backlight = require("../js/backlightPick.js");
const Catalog = require("../js/catalog.js");

const win = {};
const runtime = vm.createContext({ window: win, structuredClone });
for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-discontinued.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), runtime, { filename: file });
}
const products = win.EP_DATA.products;
const byCode = code => products.find(p => p.code === code);

function wrappers(offKind) {
  const ctx = {
    EPCatalogPool: Pool, EPPostFit: Fit, EPBacklightPick: Backlight,
    frameSlotCount: Catalog.frameSlotCount, productSeries: Catalog.productSeries,
    byKind: kind => products.filter(p => p.kind === kind && p.active),
    byKindOff: kind => kind === offKind ? products.filter(p => p.kind === kind && p.active === false) : []
  };
  const names = ["supportFound", "findSupport", "resolveSupport", "findBacklight"];
  return vm.runInNewContext(names.map(stand.constBlock).join("\n") + "\n;({findSupport,resolveSupport,findBacklight});", ctx);
}

test("З-К2-1: app.js сохраняет снятый суппорт 19913 для Arke Fit, если активного нет", () => {
  const frame = byCode("19953.01");
  assert.ok(frame && frame.active === false);
  const opts = { frame, standard: frame.standard, modules: Catalog.frameSlotCount(frame) };
  assert.equal(wrappers(null).findSupport(opts), null, "без запаса суппорта нет");
  assert.equal(wrappers("support").findSupport(opts).code, "19913");
  assert.equal(wrappers("support").resolveSupport(opts).support.code, "19913");
});

test("З-К2-1: app.js сохраняет снятую подсветку 120 В", () => {
  const mechanism = products.find(p => p.kind === "mechanism" && p.active && Backlight.classify(p) === "ordinary");
  assert.ok(mechanism);
  const opts = { mechanism, color: "Белая", voltage: "120V" };
  assert.equal(wrappers(null).findBacklight(opts), null, "активной подсветки 120 В нет");
  assert.match(wrappers("accessory").findBacklight(opts).code, /^00936\.120/);
});

test("З-К2-1: lightingFor подключает снятые механизмы как запас к общему подбору", () => {
  const source = stripComments(stand.functionSource("lightingFor"));
  assert.match(source, /mechsOff\s*=\s*byKindOff\("mechanism"\)/);
  assert.match(source, /EPCatalogPool\.pick\([^;]+,mechs,mechsOff,/);
});
