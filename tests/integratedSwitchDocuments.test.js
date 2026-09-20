/* ЦЕЛЬНОЕ ИЗДЕЛИЕ В ДОКУМЕНТАХ МОНТАЖНИКА (сторожим НАБЛЮДАЕМОЕ содержимое, не имя функции).
   Владелец: «монтажник ставит то, что пойдёт в смету». Для цельного изделия смета берёт ЗАМЕНУ
   (09001→09005), значит и лист монтажника (таблица модулей), и взрыв-схема ОБЯЗАНЫ печатать 09005,
   а не исходный 09001 — иначе монтажник ставит одно, а оплачено другое.

   Исполняем НАСТОЯЩИЕ buildExplodedSpec + buildPostSheet из app.js на рантайм-каталоге VIMAR через
   общий стенд. Строки групп света поста подаём готовыми (как их отдаёт lightingRowsFor): цельное
   место с подобранной заменой 09005. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const EPInstallSheet = require("../js/installSheet.js");
const EPEstimate = require("../js/estimate.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPCatalog = require("../js/catalog.js");

const JS_DIR = path.join(__dirname, "..", "js");
const win = {};
const ctx = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), "utf8"), ctx, { filename: f });
}
const PRODUCTS = win.EP_DATA.products;
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => p.code === code);

const SW = byCode("09001");   // цельный выключатель Neve Up
const CH = byCode("09005");   // переключатель той же серии и цвета — подобранная замена при N=2

/* Одна строка групп света поста: цельное место, роль «Переключатель», подобрана замена 09005
   (kind="integrated" — по нему документ решает, что артикул уже подменён). */
const integratedRow = () => [{
  keyIndex: 0, kind: "integrated", missing: false,
  product: CH, code: CH.code, name: CH.name, roleLabel: "Переключатель",
  groupLabel: "Кухня", placeNo: 1, placeCount: 2, keyName: SW.name, keyCode: SW.code
}];

/* Пост из одного цельного выключателя. Накладки/коробки для этой проверки не нужны — comp минимальный
   (frameAvailability.unset → без накладки), buildExplodedSpec тогда рисует только модули. */
const post = { number: 1, roomId: null, mechanismIds: [SW.id], height: "", purpose: "" };
const comp = {
  frame: null,
  frameAvailability: { unset: true, frame: null, missing: false, displayName: "", code: null, state: "ok" },
  box: null, boxFallback: null, boxCount: 1,
  support: null, supportCount: 0, supportAssumed: false, supportNotRequired: false,
  backlight: { items: [], gaps: [] },
  standard: "IT"
};

function buildSheet() {
  return stand.run(["buildExplodedSpec", "buildPostSheet"], {
    postComposition: () => comp,
    product,
    mechanismSpan: EPCatalog.mechanismSpan,
    lightingRowsFor: () => integratedRow(),
    EPLightingGroups,
    EPPosts, EPBuilderSlots, EPEstimate,
    keySlotKind: () => true,   // 09001 — место управления
    EPInstallSheet,
    state: { rooms: [] },
    assembledPostSpec: () => ({ size: "md", frame: null, rows: [] }),
    EPPostImage: { buildHtml: () => "", photoReady: () => false, pickIcon: () => "generic", iconSvg: () => "" },
    EPExplodedView: { buildHtml: spec => JSON.stringify(spec) },
    productImage: () => "",
    esc: s => String(s == null ? "" : s),
    STANDARD_LABEL: { IT: "итальянский", BOTH: "универсальный", unknown: "неизвестный" }
  })(post, { plan: {} });
}

test("лист монтажника: в строке модуля цельного выключателя стоит замена 09005, а не 09001", () => {
  const sheet = buildSheet();
  const mod = sheet.modules[0];
  assert.equal(mod.code, "09005", "таблица модулей печатает подобранный расчётом артикул (замену)");
  assert.equal(mod.name, CH.name, "и его название");
  assert.equal(sheet.modules.filter(m => m.code === "09001").length, 0, "исходного 09001 в таблице модулей нет");
});

test("взрыв-схема: цельный выключатель показан заменой 09005 один раз, без дубля и без 09001", () => {
  const sheet = buildSheet();
  const parts = JSON.parse(sheet.explodedViewHtml).parts;
  const codes = parts.map(p => p.code);
  assert.ok(codes.includes("09005"), "взрыв-схема содержит подобранную замену 09005");
  assert.equal(codes.filter(c => c === "09005").length, 1, "ровно ОДНА деталь 09005 — цельное изделие не задваивается (модуль + «механизм»)");
  assert.equal(codes.filter(c => c === "09001").length, 0, "исходного 09001 во взрыв-схеме нет");
  /* и подпись модуля не разнесена на «клавишу» + «· механизм»: у цельного изделия механизм внутри */
  assert.equal(parts.filter(p => /· механизм/.test(p.pos || "")).length, 0,
    "у цельного изделия отдельной позиции «· механизм» во взрыв-схеме нет");
});
