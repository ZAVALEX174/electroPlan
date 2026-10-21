/* Термодатчик терморегулятора — АВТОСОСТАВ ПОСТА (К5а, решение владельца 21.10, PLAN 7.1).
   Проверяем денежный и составной край:
     · признак «нужен датчик» доезжает ДАННЫМИ до товара (thermoSensorCode) — ровно у 9 терморегуляторов;
     · план датчиков: 02974 → 1, 2×02974 → 2, «по воздуху»/KNX → 0, LINEA/Neve Up → 1;
     · цена поста в евро растёт РОВНО на 97,02 € × N в ОБОИХ путях (EPPosts.postCost и сумма items сметы);
     · ключ группировки различает посты по датчику, пост без датчика — ключ байт в байт прежний;
     · честный пробел (нет 02965.1 в каталоге) — словами, в цену не входит;
     · 02965.1 нельзя выбрать механизмом рамки (isSensorMechanism);
     · рубли — через EPEstimate.roundShown (целый рубль вверх).
   Часть тестов — на ЖИВЫХ catalog+attrs+data.js (признак и цена обязаны пройти весь реальный путь),
   часть — на рукотворном comp (ключ группировки не зависит от того, как приложение сейчас задаёт датчик). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const EPThermoSensor = require("../js/thermoSensor.js");
const EPPosts = require("../js/posts.js");
const EPCatalog = require("../js/catalog.js");
const EPCatalogPool = require("../js/catalogPool.js");
const { build } = require("../js/estimate.js");
const estimate = require("../js/estimate.js");
const { buildAttrs } = require("../tools/lib/nomenclature.mjs");
const nomMod = require("../tools/lib/nomenclature2026.mjs");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: получено ${a}, ожидалось ${b}`);
const SENSOR_CODE = "02965.1";
const SENSOR_PRICE = 97.02;

/* ---- 1. ПРИЗНАК ИЗ ДАННЫХ: 9 терморегуляторов «с датчиком» → 02965.1 -------------------------- */
test("конвертер: ровно 9 терморегуляторов «с возможностью подключения термодатчика» → 02965.1", () => {
  const { records } = nomMod.readNomenclature2026(nomMod.DEFAULT_NOMENCLATURE_2026);
  const { sensors } = buildAttrs(records);
  const codes = Object.keys(sensors).sort();
  assert.equal(codes.length, 9, "в номенклатуре 9 терморегуляторов с датчиком");
  assert.ok(codes.every(c => sensors[c] === SENSOR_CODE), "все ссылаются на 02965.1");
  assert.deepEqual(codes,
    ["02974", "02974.B", "02974.M", "02974.N", "09474", "09474.CM", "30811.B", "30811.C", "30811.G"].sort(),
    "ровно те артикулы, что в примечаниях");
  // «По воздуху», «Умный дом»/KNX датчика НЕ требуют — ключа нет (датчик появлялся бы на пустом месте).
  ["02970", "02972", "30440.B", "30571.B"].forEach(c =>
    assert.equal(c in sensors, false, `${c} датчика не требует`));
});

/* Живой каталог: признак доезжает до товара тем же путём, что index.html (catalog → attrs → data.js). */
function liveProducts() {
  const ROOT = path.join(__dirname, "..");
  const win = {};
  const ctx = vm.createContext({ window: win, structuredClone });
  for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), ctx, { filename: f });
  }
  return win.DataService.getProducts();
}

test("data.js: thermoSensorCode доезжает до терморегуляторов и НЕ появляется у прочих", async () => {
  const products = await liveProducts();
  const byCode = c => products.find(p => p.code === c);
  ["02974", "02974.B", "09474", "09474.CM", "30811.B", "30811.G"].forEach(c =>
    assert.equal(byCode(c).thermoSensorCode, SENSOR_CODE, `${c} несёт артикул своего датчика`));
  ["02970", "02972", "02970.B"].forEach(c =>
    assert.equal(byCode(c).thermoSensorCode, undefined, `${c} без датчика — поля нет`));
  // Сам датчик — механизм каталога с группой «Термодатчик» и ценой 97,02 €.
  const sensor = byCode(SENSOR_CODE);
  assert.equal(sensor.functionalGroup, "Термодатчик");
  near(sensor.price, SENSOR_PRICE, "цена датчика 02965.1");
});

/* ---- 2. ПЛАН ДАТЧИКОВ (чистая логика) -------------------------------------------------------- */
const CAT = {
  1: { id: 1, code: "02974", name: "Термостат IoT", thermoSensorCode: SENSOR_CODE, price: 374.38 },
  2: { id: 2, code: "02970", name: "Термостат воздух", price: 237.71 },
  3: { id: 3, code: "02972", name: "Термостат KNX", price: 458.49 },
  4: { id: 4, code: "30811.B", name: "Термостат LINEA", thermoSensorCode: SENSOR_CODE, price: 374.38 },
  5: { id: 5, code: "09474.CM", name: "Термостат Neve Up", thermoSensorCode: SENSOR_CODE, price: 389.14 },
  9: { id: 9, code: SENSOR_CODE, name: "Термодатчик с проводом 3м", price: SENSOR_PRICE, functionalGroup: "Термодатчик" }
};
const cprod = id => CAT[id] || null;
const findSensor = code => Object.values(CAT).find(p => p.code === code) || null;
const sdeps = { product: cprod, findSensor };
const planOf = ids => EPThermoSensor.plan(ids, sdeps);

test("план: 02974 → 1 датчик; 2×02974 → 2; 02970/02972 → 0; 30811.B и 09474.CM → 1", () => {
  assert.equal(planOf([1]).count, 1);
  assert.equal(planOf([1, 1]).count, 2, "два одинаковых терморегулятора = два датчика");
  assert.equal(planOf([2]).count, 0, "«по воздуху» — датчика нет");
  assert.equal(planOf([3]).count, 0, "KNX — датчика нет");
  assert.equal(planOf([4]).count, 1, "LINEA 30811.B");
  assert.equal(planOf([5]).count, 1, "Neve Up 09474.CM");
  assert.equal(planOf([1, 2, 4]).count, 2, "смешанный пост: два «с датчиком», один без");
  assert.equal(planOf([1]).items[0].sensor.code, SENSOR_CODE);
});

test("план: датчика нет в каталоге → честный пробел, в цену не входит", () => {
  const plan = EPThermoSensor.plan([1], { product: cprod, findSensor: () => null });
  assert.equal(plan.count, 0, "подобранных датчиков нет");
  assert.equal(plan.gaps.length, 1, "ровно один пробел");
  assert.equal(plan.gaps[0].wantCode, SENSOR_CODE, "пробел знает, какой артикул искали");
});

test("выбор механизмов рамки: фильтр (как catalogMechs в renderBuilder) ВЫКИДЫВАЕТ 02965.1", () => {
  // Ровно тот предикат, что стоит в renderBuilder: датчик не предлагается карточкой слота.
  const mechs = [CAT[1], CAT[2], CAT[9]];   // терморегулятор, термостат, датчик
  const forSlots = mechs.filter(m => !EPThermoSensor.isSensorMechanism(m));
  assert.deepEqual(forSlots.map(m => m.code), ["02974", "02970"], "датчик 02965.1 из выбора убран, механизмы остались");
});

test("isSensorMechanism: 02965.1 — выносной датчик, терморегулятор — нет", () => {
  assert.equal(EPThermoSensor.isSensorMechanism(CAT[9]), true, "датчик нельзя ставить механизмом рамки");
  assert.equal(EPThermoSensor.isSensorMechanism(CAT[1]), false, "терморегулятор — обычный механизм");
  assert.equal(EPThermoSensor.isSensorMechanism(null), false);
  // Фолбэк по множеству кодов датчиков (если группа вдруг не проставлена).
  assert.equal(EPThermoSensor.isSensorMechanism({ code: SENSOR_CODE }, new Set([SENSOR_CODE])), true);
});

/* ---- 3. ЦЕНА ПОСТА В ЕВРО = ПРЕЖНЯЯ + 97,02 × N (ПУТЬ postCost) ------------------------------ */
const FRAME = { id: 20, code: "F1", name: "Накладка", price: 3.0, standard: "IT", slotCount: 3 };
const fullProd = id => (id === 20 ? FRAME : CAT[id]);
const postDepsBase = (sensorPlan) => ({
  product: fullProd, frameProduct: fullProd, socketBox: () => null,
  mechanismSpan: EPCatalog.mechanismSpan, findBox: () => null, fallbackBox: () => null,
  resolveSupport: () => ({ support: null, assumed: false }), backlight: { enabled: false },
  wallType: "solid", sensorPlan
});
const sensorPlanDep = ids => EPThermoSensor.plan(ids, sdeps);

test("postCost (евро): включённый датчик растит цену РОВНО на 97,02 € на каждый терморегулятор", () => {
  const post = { frameId: 20, mechanismIds: [1] };          // один 02974
  const off = EPPosts.postCost(post, postDepsBase(undefined));        // датчиков нет (старый путь)
  const on = EPPosts.postCost(post, postDepsBase(sensorPlanDep));     // датчик добавлен
  near(on - off, SENSOR_PRICE, "один терморегулятор → один датчик 97,02 €");

  const post2 = { frameId: 20, mechanismIds: [1, 1] };      // два 02974 (в накладку на 3М не влезут по модулям,
  // но postCost считает по mechanismIds как есть — проверяем именно слагаемое датчиков)
  const on2 = EPPosts.postCost(post2, postDepsBase(sensorPlanDep));
  const off2 = EPPosts.postCost(post2, postDepsBase(undefined));
  near(on2 - off2, 2 * SENSOR_PRICE, "два терморегулятора → два датчика");

  const postAir = { frameId: 20, mechanismIds: [2] };       // 02970 «по воздуху»
  near(EPPosts.postCost(postAir, postDepsBase(sensorPlanDep)) - EPPosts.postCost(postAir, postDepsBase(undefined)),
    0, "терморегулятор без датчика цену не меняет");
});

test("postComposition: датчик НЕ попадает в mechanismIds — коробка/суппорт/модули не меняются", () => {
  const post = { frameId: 20, mechanismIds: [1] };
  const compOn = EPPosts.postComposition(post, postDepsBase(sensorPlanDep));
  const compOff = EPPosts.postComposition(post, postDepsBase(undefined));
  assert.equal(compOn.boxCount, compOff.boxCount, "число коробок не изменилось");
  assert.equal(compOn.modulesTotal, compOff.modulesTotal, "занятость модулей не изменилась");
  assert.equal(compOn.sensors.count, 1, "датчик учтён отдельным планом");
});

/* ---- 4. СМЕТА: items, сумма = postCost, ключ группировки ------------------------------------- */
const settings = { workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 0, vatEnabled: false };

test("смета (путь items): сумма items поста = postCost, и датчик стоит в составе отдельной строкой", () => {
  const post = { name: "Пост", frameId: 20, mechanismIds: [1] };
  const e = build({
    posts: [post], product: fullProd, frameProduct: fullProd,
    postCost: p => EPPosts.postCost(p, postDepsBase(sensorPlanDep)),
    postComposition: p => EPPosts.postComposition(p, postDepsBase(sensorPlanDep)), settings
  });
  const g = e.groups[0];
  const sensorItems = g.items.filter(it => it.kind === "sensor" && it.code);
  assert.equal(sensorItems.length, 1, "в составе ровно одна строка датчика");
  assert.equal(sensorItems[0].code, SENSOR_CODE);
  near(sensorItems[0].price, SENSOR_PRICE, "цена строки датчика");
  // Σ(price×count) по items = цена поста (postPrice): два денежных столбца не разойдутся.
  const sumItems = g.items.reduce((s, it) => s + (Number(it.price) || 0) * it.count, 0);
  near(sumItems, g.sum, "сумма структурного состава = цена поста (474,40 € = 374,38 + 3,00 + 97,02)");
  near(g.sum, 374.38 + 3.0 + SENSOR_PRICE, "цена поста = механизм + накладка + датчик");
  assert.match(g.composition, /Термодатчик с проводом 3м/, "датчик назван в печатной строке состава");
});

test("смета: два 02974 в одном посте → «2 × Термодатчик…», цена поста +2×97,02", () => {
  const post = { name: "Пост", frameId: 20, mechanismIds: [1, 1] };
  const e = build({
    posts: [post], product: fullProd, frameProduct: fullProd,
    postCost: p => EPPosts.postCost(p, postDepsBase(sensorPlanDep)),
    postComposition: p => EPPosts.postComposition(p, postDepsBase(sensorPlanDep)), settings
  });
  assert.match(e.groups[0].composition, /2 × Термодатчик с проводом 3м/, "одинаковые датчики схлопнуты в «2 ×»");
});

/* Ключ группировки — на рукотворном comp (как estimateBacklight): build ключует на comp.sensors. */
const frameProduct = id => ({ 20: FRAME }[id]);
const kprod = id => ({ 1: { id: 1, code: "K", name: "Клавиша", price: 4 } }[id]);
const compFor = sensors => ({ boxCount: 1, supportCount: 0, sensors });
const kpost = () => ({ name: "Пост", frameId: 20, mechanismIds: [1] });
const sensorPlanObj = (items, gaps) => ({ items: items || [], gaps: gaps || [], count: (items || []).length, hasGap: (gaps || []).length > 0 });
const sItem = (code, name) => ({ sensor: { code, name, price: SENSOR_PRICE } });
const runComp = (posts, comp) => build({ posts, product: kprod, frameProduct, postCost: () => 10, postComposition: comp, settings });

test("ключ группировки: есть датчик vs нет → ДВЕ строки сметы (не схлопываются)", () => {
  const withS = Object.assign(kpost(), { s: sensorPlanObj([sItem(SENSOR_CODE, "Датчик")], []) });
  const without = Object.assign(kpost(), { s: sensorPlanObj([], []) });
  const e = runComp([withS, without], po => compFor(po.s));
  assert.equal(e.groups.length, 2, "пост с датчиком и без — разные строки");
});

test("ключ группировки: подобранный датчик vs пробел → ДВЕ строки", () => {
  const found = Object.assign(kpost(), { s: sensorPlanObj([sItem(SENSOR_CODE, "Датчик")], []) });
  const gap = Object.assign(kpost(), { s: sensorPlanObj([], [{ mechId: 1 }]) });
  assert.equal(runComp([found, gap], po => compFor(po.s)).groups.length, 2, "датчик и пробел не сливаются");
});

test("ключ группировки: одинаковый датчик → ОДНА строка count 2", () => {
  const e = runComp([kpost(), kpost()], () => compFor(sensorPlanObj([sItem(SENSOR_CODE, "Датчик")], [])));
  assert.equal(e.groups.length, 1);
  assert.equal(e.groups[0].count, 2);
});

test("без датчика: состав и ключ байт в байт как без поля sensors (старые сметы не перегруппируются)", () => {
  const withEmpty = runComp([kpost(), kpost()], () => compFor(sensorPlanObj([], [])));
  const legacy = runComp([kpost(), kpost()], () => ({ boxCount: 1, supportCount: 0 }));
  assert.equal(withEmpty.groups.length, legacy.groups.length, "то же число строк");
  assert.deepEqual(withEmpty.groups[0].items, legacy.groups[0].items, "тот же структурный состав");
  assert.equal(withEmpty.groups[0].composition, legacy.groups[0].composition, "та же печатная строка");
});

test("смета: пробел датчика печатается словами и в цену не входит", () => {
  const post = Object.assign(kpost(), { s: sensorPlanObj([], [{ mechId: 1 }, { mechId: 1 }]) });
  const e = runComp([post], po => compFor(po.s));
  assert.match(e.groups[0].composition, /2 × термодатчик не подобран/, "пробел — словами, со счётчиком");
  assert.ok(e.groups[0].items.some(it => it.kind === "sensor" && it.gap), "пробел есть в структурном составе");
});

/* ---- 5. РУБЛИ: датчик округляется целым рублём вверх (К7, EPEstimate.roundShown) -------------- */
test("рубли: строка датчика показана целым рублём вверх (roundShown)", () => {
  // 97,02 € × 92,5 = 8974,35 ₽ → вверх до рубля = 8975 ₽ (копеек в рублях нет).
  assert.equal(estimate.roundShown(SENSOR_PRICE * 92.5, "RUB", "up"), 8975);
  // в евро — копейка (ни одна евро-цифра не меняется).
  near(estimate.roundShown(SENSOR_PRICE, "EUR", "up"), SENSOR_PRICE, "евро — без округления до рубля");
});

/* ---- 6. ПОДБОР ЧЕРЕЗ EPCatalogPool: активные главнее снятых (как findBacklight) -------------- */
test("findSensor-путь (EPCatalogPool): активный датчик главнее снятого, снятый — запас", () => {
  const active = { code: SENSOR_CODE, name: "датчик активный", active: true, price: SENSOR_PRICE };
  const off = { code: SENSOR_CODE, name: "датчик снятый", active: false, price: 90 };
  const pickFrom = (act, ext) => EPCatalogPool.pick(pool => pool.find(p => p.code === SENSOR_CODE) || null, act, ext, s => !!s);
  // есть активный — снятый не смотрим
  assert.equal(pickFrom([active], [off]).name, "датчик активный");
  // активного нет — берём из запаса (снятый)
  assert.equal(pickFrom([], [off]).name, "датчик снятый");
});
