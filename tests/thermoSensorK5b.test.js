/* К5б/К5в — РЕШЕНИЕ ПОСТА «термодатчик: с датчиком / без датчика» (вариант C, владелец 21.10).
   ------------------------------------------------------------------------------------------------
   К5а добавлял датчик 02965.1 автоматически к каждому терморегулятору «с датчиком». К5б даёт посту
   право его ОТКЛЮЧИТЬ: по умолчанию датчик есть, но у поста можно выбрать «Без датчика»; выбранное
   руками главнее расчёта. Хранится ТОЛЬКО явное post.thermoSensor==="off"; отсутствие поля = «с
   датчиком» (старые проекты и копии датчик НЕ теряют). К5в выводит датчик строкой «Термодатчик
   02965.1 × N» в обвязке листа монтажника (рядом с подсветкой), но НЕ во взрыв-схему.

   ОДНА ТОЧКА ПРАВИЛА (§7.1): действует ли датчик у поста, решает EPThermoSensor.sensorsEnabled; при
   «off» EPThermoSensor.plan отдаёт пустой набор (enabled:false), и датчик гаснет во ВСЕХ потребителях
   через одно comp.sensors — цена, состав, смета, лист монтажника, экраны. Проверяем денежный и
   составной край этого решения, а также проводку окна (черновик/сохранение/орган).

   МУТАЦИЯ → КРАСНЫЙ ТЕСТ (проверено прогоном, см. отчёт):
     1. EPThermoSensor.sensorsEnabled → `return true` (всегда «с датчиком»): краснит
        «postCost: пост «без датчика» → цена МЕНЬШЕ на 97,02 × N» и «composition: off → sensors пуст».
     2. EPThermoSensor.plan: убрать `if(d.enabled===false) return {...}` : краснит
        «plan: enabled===false → пустой набор» и денежные тесты off.
     3. posts.js: `deps.sensorPlan(mechIds, post)` → `deps.sensorPlan(mechIds)` (пост не передаётся):
        решение «off» теряется — краснит денежные/составные тесты off.
     4. postBuilder.savePostBuilder: убрать `post.thermoSensor="off"` : краснит
        «save: «без датчика» записывает off у поста на плане».
     5. installSheet.buildFittings: убрать блок `const sens=comp.sensors; if(sens){…}` : краснит
        «буфик: строка «Термодатчик» × N в обвязке».
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPThermoSensor = require("../js/thermoSensor.js");
const EPPosts = require("../js/posts.js");
const EPCatalog = require("../js/catalog.js");
const EPBuilderSlots = require("../js/builderSlots.js");
const { build } = require("../js/estimate.js");
const { buildFittings } = require("../js/installSheet.js");

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: получено ${a}, ожидалось ${b}`);
const SENSOR_CODE = "02965.1";
const SENSOR_PRICE = 97.02;

/* ---- 1. РЕЗОЛВЕР sensorsEnabled: только "off" гасит датчик ------------------------------------ */
test("sensorsEnabled: нет поля / null / undefined / 'on' → датчик есть; только 'off' гасит", () => {
  assert.equal(EPThermoSensor.sensorsEnabled(undefined), true, "поста нет вовсе — считаем сам (датчик есть)");
  assert.equal(EPThermoSensor.sensorsEnabled(null), true);
  assert.equal(EPThermoSensor.sensorsEnabled({}), true, "СТАРЫЙ пост без поля — датчик есть (проекты не теряют его)");
  assert.equal(EPThermoSensor.sensorsEnabled({ thermoSensor: undefined }), true);
  assert.equal(EPThermoSensor.sensorsEnabled({ thermoSensor: null }), true);
  assert.equal(EPThermoSensor.sensorsEnabled({ thermoSensor: "on" }), true, "явное «с датчиком»");
  assert.equal(EPThermoSensor.sensorsEnabled({ thermoSensor: "off" }), false, "ТОЛЬКО 'off' отключает датчик");
  // Falsy, но не "off" — датчик остаётся: иначе пустое/мусорное поле молча убрало бы датчик.
  assert.equal(EPThermoSensor.sensorsEnabled({ thermoSensor: "" }), true, "пустая строка — не 'off', датчик есть");
  assert.equal(EPThermoSensor.sensorsEnabled({ thermoSensor: 0 }), true, "0 — не 'off', датчик есть");
});

/* ---- 2. plan с флагом enabled: решение поста главнее расчёта ---------------------------------- */
const CAT = {
  1: { id: 1, code: "02974", name: "Термостат IoT", thermoSensorCode: SENSOR_CODE, price: 374.38 },
  2: { id: 2, code: "02970", name: "Термостат воздух", price: 237.71 },
  9: { id: 9, code: SENSOR_CODE, name: "Термодатчик с проводом 3м", price: SENSOR_PRICE, functionalGroup: "Термодатчик" }
};
const cprod = id => CAT[id] || null;
const findSensor = code => Object.values(CAT).find(p => p.code === code) || null;

test("plan: enabled===false → пустой набор при ЛЮБЫХ механизмах («без датчика» главнее расчёта)", () => {
  const off = EPThermoSensor.plan([1, 1], { product: cprod, findSensor, enabled: false });
  assert.deepEqual(off, { items: [], gaps: [], count: 0, hasGap: false }, "два 02974, но пост «без датчика» → датчиков нет");
});

test("plan: enabled===true или не передан → датчик по расчёту (К5а, старые вызовы как прежде)", () => {
  assert.equal(EPThermoSensor.plan([1], { product: cprod, findSensor, enabled: true }).count, 1, "enabled:true — датчик считается");
  assert.equal(EPThermoSensor.plan([1], { product: cprod, findSensor }).count, 1, "флаг не передан — как К5а (датчик есть)");
});

/* ---- 3. ЦЕНА/СОСТАВ/СМЕТА: «без датчика» дешевле ровно на 97,02 × N (путь приложения) --------- */
/* ВОСПРОИЗВОДИМ sensorPlan РОВНО как postDeps в app.js (К5б): пост передаётся целиком, enabled берётся
   из sensorsEnabled(post). posts.js зовёт deps.sensorPlan(mechIds, post) — проверяем весь путь. */
const FRAME = { id: 20, code: "F1", name: "Накладка", price: 3.0, standard: "IT", slotCount: 3 };
const fullProd = id => (id === 20 ? FRAME : CAT[id]);
const appDeps = {
  product: fullProd, frameProduct: fullProd, socketBox: () => null,
  mechanismSpan: EPCatalog.mechanismSpan, findBox: () => null, fallbackBox: () => null,
  resolveSupport: () => ({ support: null, assumed: false }), backlight: { enabled: false }, wallType: "solid",
  sensorPlan: (mechIds, post) => EPThermoSensor.plan(mechIds, { product: fullProd, findSensor, enabled: EPThermoSensor.sensorsEnabled(post) })
};

test("postCost: пост «без датчика» → цена МЕНЬШЕ на 97,02 € × N, чем «с датчиком»", () => {
  const on = { frameId: 20, mechanismIds: [1] };                       // поля нет → датчик есть (К5а)
  const off = { frameId: 20, mechanismIds: [1], thermoSensor: "off" }; // «без датчика»
  near(EPPosts.postCost(on, appDeps) - EPPosts.postCost(off, appDeps), SENSOR_PRICE,
    "один терморегулятор: «без датчика» дешевле ровно на 97,02 €");
  // Числа: on = 374,38 + 3,00 + 97,02 = 474,40; off = 377,38.
  near(EPPosts.postCost(on, appDeps), 374.38 + 3.0 + SENSOR_PRICE, "цена «с датчиком» = механизм + накладка + датчик");
  near(EPPosts.postCost(off, appDeps), 374.38 + 3.0, "цена «без датчика» = механизм + накладка, датчика нет");

  const on2 = { frameId: 20, mechanismIds: [1, 1] };
  const off2 = { frameId: 20, mechanismIds: [1, 1], thermoSensor: "off" };
  near(EPPosts.postCost(on2, appDeps) - EPPosts.postCost(off2, appDeps), 2 * SENSOR_PRICE,
    "два терморегулятора: «без датчика» дешевле на 2 × 97,02 €");
});

test("postComposition: «без датчика» → comp.sensors пуст; старый пост (нет поля) → датчик есть", () => {
  const off = EPPosts.postComposition({ frameId: 20, mechanismIds: [1], thermoSensor: "off" }, appDeps);
  assert.equal(off.sensors.count, 0, "решение «без датчика» гасит датчик в составе");
  assert.deepEqual(off.sensors.items, [], "в составе датчика нет вовсе");
  const legacy = EPPosts.postComposition({ frameId: 20, mechanismIds: [1] }, appDeps);
  assert.equal(legacy.sensors.count, 1, "СТАРЫЙ пост без поля — датчик по-прежнему есть (обратная совместимость)");
  const onExplicit = EPPosts.postComposition({ frameId: 20, mechanismIds: [1], thermoSensor: "on" }, appDeps);
  assert.equal(onExplicit.sensors.count, 1, "явное 'on' — датчик есть");
});

const settings = { workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 0, vatEnabled: false };

test("смета: цена поста «без датчика» меньше ровно на 97,02 €, строки датчика в составе нет", () => {
  const mkEstimate = post => build({
    posts: [post], product: fullProd, frameProduct: fullProd,
    postCost: p => EPPosts.postCost(p, appDeps),
    postComposition: p => EPPosts.postComposition(p, appDeps), settings
  });
  const eOn = mkEstimate({ name: "Пост", frameId: 20, mechanismIds: [1] });
  const eOff = mkEstimate({ name: "Пост", frameId: 20, mechanismIds: [1], thermoSensor: "off" });
  near(eOn.groups[0].sum - eOff.groups[0].sum, SENSOR_PRICE, "смета «без датчика» дешевле на 97,02 €");
  near(eOff.groups[0].sum, 374.38 + 3.0, "смета «без датчика» = 377,38 €");
  assert.match(eOn.groups[0].composition, /Термодатчик/, "«с датчиком» — датчик назван в составе");
  assert.doesNotMatch(eOff.groups[0].composition, /Термодатчик/, "«без датчика» — строки датчика в составе нет");
});

/* ---- 4. ЛИСТ МОНТАЖНИКА (К5в): строка «Термодатчик» в обвязке; взрыв-схема без датчика --------- */
const sensorPlanObj = (items, gaps) => ({ items: items || [], gaps: gaps || [], count: (items || []).length, hasGap: (gaps || []).length > 0 });
const sItem = () => ({ sensor: { code: SENSOR_CODE, name: "Термодатчик с проводом 3м", price: SENSOR_PRICE } });
const compWith = sensors => ({
  support: { name: "Суппорт", code: "S1" }, supportCount: 1,
  box: { name: "Коробка", code: "B1" }, boxCount: 1,
  frame: { name: "Накладка", code: "F1" }, sensors
});
const BOX = { name: "Коробка", code: "B1" };

test("buildFittings (К5в): строка «Термодатчик» × N в обвязке — count = числу терморегуляторов", () => {
  // Два 02974 «с датчиком» → два 02965.1 → ОДНА строка count 2 (одинаковые артикулы сводятся).
  const rows = buildFittings(compWith(sensorPlanObj([sItem(), sItem()], [])), BOX);
  const sens = rows.find(r => r.role === "Термодатчик");
  assert.ok(sens, "строка термодатчика присутствует в обвязке листа монтажника");
  assert.equal(sens.code, SENSOR_CODE, "артикул датчика 02965.1");
  assert.equal(sens.count, 2, "два терморегулятора → count 2 (одной строкой, а не двумя)");
  // Порядок: датчик идёт рядом с подсветкой, ДО суппорта/коробки/накладки.
  assert.deepEqual(rows.map(r => r.role), ["Термодатчик", "Суппорт", "Монтажная коробка", "Накладка"],
    "датчик стоит перед суппортом (он относится к механизму-терморегулятору)");
});

test("buildFittings (К5в): один терморегулятор → count 1", () => {
  const rows = buildFittings(compWith(sensorPlanObj([sItem()], [])), BOX);
  assert.equal(rows.find(r => r.role === "Термодатчик").count, 1, "один терморегулятор → один датчик");
});

test("buildFittings (К5в): «без датчика» (sensors пуст) → строки «Термодатчик» нет", () => {
  const rows = buildFittings(compWith(sensorPlanObj([], [])), BOX);
  assert.ok(!rows.some(r => r.role === "Термодатчик"), "пост «без датчика» — строки термодатчика в обвязке нет");
  assert.deepEqual(rows.map(r => r.role), ["Суппорт", "Монтажная коробка", "Накладка"], "обвязка как раньше");
});

test("buildFittings (К5в): пробел датчика — словами с нулём, в заказ не идёт", () => {
  const rows = buildFittings(compWith(sensorPlanObj([], [{ mechId: 1 }, { mechId: 1 }])), BOX);
  const gap = rows.find(r => r.role === "Термодатчик");
  assert.match(gap.name, /2 × термодатчик не подобран/, "пробел назван словами со счётчиком");
  assert.equal(gap.count, 0, "пробел в количество к заказу не идёт");
  assert.equal(gap.code, null, "у пробела артикула нет");
});

test("взрыв-схема (К5в): датчик НЕ попадает во взрыв-схему (она строится по mechanismIds, не по sensors)", () => {
  // buildExplodedSpec собирает детали из layout (механизмы рамки), подсветки и света — comp.sensors не читает.
  // Даём comp с датчиком и проверяем, что в parts его нет.
  const comp = Object.assign(compWith(sensorPlanObj([sItem(), sItem()], [])), {
    frameAvailability: { unset: false, displayName: "Накладка", code: "F1", state: "active" }
  });
  const layout = [{ id: 1, keyIndex: 0, item: { name: "Термостат IoT", code: "02974" } }];
  const ctx = {
    productImage: () => "", EPPostImage: { photoReady: () => false },
    EPExplodedView: {}, productImageDetail: () => ""
  };
  const parts = stand.run("buildExplodedSpec", ctx)(comp, BOX, layout, { imageUrl: "" }, [], null).parts;
  assert.ok(!parts.some(p => p.code === SENSOR_CODE || /Термодатчик/.test(p.name || "")),
    "выносной датчик во взрыв-схеме не рисуется (он не механизм рамки)");
  assert.ok(parts.some(p => p.code === "02974"), "контроль: механизм-терморегулятор во взрыв-схеме есть");
});

/* ---- 5. ОРГАН ОКНА (К5б): renderPostThermoSensor прячет кнопки без терморегулятора ------------- */
/* Терморегулятор «с датчиком» в слоте делает кнопки видимыми; без него fieldset спрятан. Активная
   кнопка — по черновику окна (state.builder.thermoSensor). Образец — backlightPostBuilderUi. */
function runRenderThermo({ mechIds, thermoSensor = "on", modeButtons = [] }) {
  const dom = stand.makeDom();
  const slots = mechIds.map(id => EPBuilderSlots.slot(id, ""));
  const product = id => CAT[id] || null;
  const ctx = {
    state: { builder: { slots, thermoSensor } },
    $: dom.$, esc: String,
    document: { querySelectorAll: () => modeButtons },
    EPBuilderSlots, EPThermoSensor, product
  };
  stand.run("renderPostThermoSensor", ctx)();
  return dom;
}

test("renderPostThermoSensor: в посту есть терморегулятор → fieldset ВИДЕН", () => {
  const dom = runRenderThermo({ mechIds: [1] });   // 02974 — с датчиком
  assert.equal(dom.$("postThermoStep").hidden, false, "кнопки видны: есть что включать/выключать");
});

test("renderPostThermoSensor: в посту НЕТ терморегулятора с датчиком → fieldset СКРЫТ", () => {
  const dom = runRenderThermo({ mechIds: [2] });   // 02970 — без датчика
  assert.equal(dom.$("postThermoStep").hidden, true, "кнопки бессмысленны — fieldset спрятан целиком");
  const empty = runRenderThermo({ mechIds: [] });
  assert.equal(empty.$("postThermoStep").hidden, true, "пустой пост — тоже скрыт");
});

test("renderPostThermoSensor: активная кнопка соответствует черновику ('on' по умолчанию, 'off' — выбор)", () => {
  const buttons = () => [
    stand.makeElement({ dataset: { thermo: "on" } }),
    stand.makeElement({ dataset: { thermo: "off" } })
  ];
  const activeOf = thermoSensor => {
    const btns = buttons();
    const dom = runRenderThermo({ mechIds: [1], thermoSensor, modeButtons: btns });
    const active = btns.filter(b => b.classList.contains("active")).map(b => b.dataset.thermo);
    return { active, hint: dom.$("postThermoHint").textContent };
  };
  const on = activeOf("on");
  assert.deepEqual(on.active, ["on"], "по умолчанию активна «С датчиком»");
  assert.match(on.hint, /02965\.1/, "подсказка «с датчиком» называет артикул датчика");
  const off = activeOf("off");
  assert.deepEqual(off.active, ["off"], "выбор «Без датчика» подсвечен");
  assert.match(off.hint, /отключён/, "подсказка «без датчика» объясняет, что датчика нет в цене");
});

/* ---- 6. СОХРАНЕНИЕ (К5б): «off» пишется у поста, «с датчиком» — поле удаляется ----------------- */
/* Исполняем НАСТОЯЩИЙ savePostBuilder на реальном каталоге (как savePostBuilderWiring): терморегулятор
   02974 (2 модуля) целиком заполняет 2-модульную накладку Plana → distributePosts valid&&full, запись
   доходит. Проверяем ровно строку thermoSensor — остальное посторонне, безопасные стабы. */
const PRODUCTS = stand.loadVimarCatalog().products;
const prodById = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const THERM = PRODUCTS.find(p => p.code === "02974");
const allMech = PRODUCTS.filter(p => p.kind === "mechanism" && p.active);
const THERM_SPAN = EPCatalog.mechanismSpan(THERM);
const THERM_FRAME = PRODUCTS.find(p => p.kind === "frame" && p.active &&
  EPCatalog.frameSlotCount(p) === THERM_SPAN && EPCatalog.compatibleMechanisms(p, allMech).includes(THERM));
assert.ok(THERM_FRAME, "разведка: у 02974 есть накладка, которую он заполняет целиком — с ней собираем валидный пост");

function runSaveThermo({ thermoSensor, post }) {
  const dom = stand.makeDom();
  dom.$("postName").value = "Термопост";
  dom.$("postFrameSelect").value = String(THERM_FRAME.id);
  const state = {
    products: PRODUCTS, posts: [post], templates: [],
    builder: { slots: [EPBuilderSlots.slot(THERM.id, "")], wallType: null, backlight: null,
      thermoSensor, editingPlacedId: post.id, editingTemplateId: null, restrictInnardsColor: false }
  };
  const ctx = {
    state, $: dom.$, EPCatalog, EPPosts, EPBuilderSlots,
    frameProduct: prodById, product: prodById, mechanismSpan: EPCatalog.mechanismSpan,
    socketBox: () => null, uid: p => p + "GEN", toast: () => {},
    builderWallType: () => "solid", EP_DATA: { settings: { wallType: "solid" } },
    askWallScope: () => Promise.resolve("self"),
    DataService: { savePost: () => Promise.resolve(), getSavedPosts: () => Promise.resolve([]) },
    renderAll: () => {}, renderProperties: () => {}, renderSummary: () => {},
    renderTemplates: () => {}, closePostBuilder: () => {}
  };
  return stand.run("savePostBuilder", ctx)().then(() => state.posts[0]);
}

test("savePostBuilder (К5б): «без датчика» записывает post.thermoSensor='off' у поста на плане", async () => {
  const saved = await runSaveThermo({ thermoSensor: "off", post: { id: "p1", roomId: "r1", frameId: THERM_FRAME.id } });
  assert.equal(saved.thermoSensor, "off", "решение «без датчика» обязано доехать до поста — иначе теряется молча");
});

test("savePostBuilder (К5б): «с датчиком» (режим по умолчанию) УДАЛЯЕТ поле — не застревает старое 'off'", async () => {
  // Пост раньше был «без датчика»; человек вернул «с датчиком» → поля быть не должно (нет поля = считать сам).
  const saved = await runSaveThermo({ thermoSensor: "on", post: { id: "p1", roomId: "r1", frameId: THERM_FRAME.id, thermoSensor: "off" } });
  assert.equal("thermoSensor" in saved, false, "режим «с датчиком» удаляет поле — отсутствие = датчик по расчёту");
});
