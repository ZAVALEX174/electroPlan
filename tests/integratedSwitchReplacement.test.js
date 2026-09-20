/* ЦЕЛЬНЫЕ ВЫКЛЮЧАТЕЛИ КАК МЕСТА УПРАВЛЕНИЯ (владелец, 19.09): «почему я не могу настроить связи
   (проходной выключатель)?». Цельное изделие (клавиша+механизм в одном артикуле, напр. 09001) —
   такое же место управления, как клавиша, но в смету идёт НЕ голый механизм за ним, а ЗАМЕНА самого
   артикула изделием нужной роли той же серии и цвета: 09001 → 09005 (переключатель) → 09013 (инвертор).

   Проверяем на НАСТОЯЩЕМ рантайм-каталоге VIMAR (catalog-vimar.js + attrs + data.js — тот же путь,
   что даёт приложению DataService.getProducts): роли/серии/цвет/семья изделий настоящие. Пайплайн
   собран из настоящих чистых модулей (EPLightingPlan + EPLightingGroups + EPEstimate) теми же
   зависимостями, что подставляет app.js (lightingFor/buildEstimate) — предикат места управления
   вырезан из настоящего app.js (controlPlaceKind), второй копии определения нет. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPLightingPlan = require("../js/lightingPlan.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPEstimate = require("../js/estimate.js");
const EPCatalog = require("../js/catalog.js");

/* Рантайм-каталог: три файла в том же порядке, что index.html (см. catalogRuntimeEnrichment). */
const JS_DIR = path.join(__dirname, "..", "js");
const win = {};
const context = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), "utf8"), context, { filename: f });
}
/* EP_DATA.products — уже обогащённый атрибутами массив (data.js IIFE), тот же, что отдаёт
   DataService.getProducts; берём синхронно, чтобы тесты не зависели от порядка async-загрузки. */
const PRODUCTS = win.EP_DATA.products;
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));
const byCode = code => PRODUCTS.find(p => p.code === code);

/* НАСТОЯЩИЙ предикат места управления из app.js (§7.1: одно определение). */
const controlPlaceKind = vm.runInNewContext(stand.constSource("controlPlaceKind") + "\n;controlPlaceKind;", {});

/* findMechanism — ровно как в app.js lightingFor: клавише голый механизм, цельному изделию замена. */
function makeLighting(scheme) {
  return posts => {
    const places = EPLightingPlan.collect(posts, { product, seriesOf: EPCatalog.productSeries, controlKind: controlPlaceKind });
    const mechs = PRODUCTS.filter(p => p.kind === "mechanism" && p.active);
    const replacementDeps = {
      seriesOf: EPCatalog.productSeries, spanOf: EPCatalog.mechanismSpan,
      colorKeyOf: item => (item && item.elementColor ? EPCatalog.facingColorKey(item.elementColor) : null),
      fgOf: item => (item && item.functionalGroup) || null, fsgOf: item => (item && item.functionalSubgroup) || null
    };
    const ambiguous = [];
    const planDeps = {
      seriesOf: EPCatalog.productSeries,
      findMechanism: ({ role, series, kind, source }) => {
        if (kind === "integrated") {
          const rep = EPLightingPlan.resolveReplacement({ role, source }, mechs, replacementDeps);
          if (rep.ambiguous) ambiguous.push({ role, source, candidates: rep.candidates });
          return rep.product;
        }
        const found = EPLightingPlan.resolveMechanism({ role, series }, mechs);
        if (found.ambiguous) ambiguous.push({ role, series, candidates: found.candidates });
        return found.product;
      }
    };
    const plan = EPLightingGroups.plan({ scheme, places }, planDeps);
    return { plan, places, rows: EPLightingPlan.rowsByPost(plan, places, EPLightingGroups.GAP_TEXTS), ambiguous };
  };
}

/* Смета того же проекта — теми же зависимостями, что buildEstimate. postCost/postComposition
   упрощены до цены механизмов (frame/box/support для этих сценариев несущественны — накладки нет). */
const postCost = po => (po.mechanismIds || []).reduce((s, id) => s + (Number((product(id) || {}).price) || 0), 0);
function estimateFor(posts, light) {
  const rowMap = light.rows;
  return EPEstimate.build({
    devices: [], posts, product, frameProduct: product,
    postCost, lightingOf: po => rowMap.get(EPLightingPlan.postKey(po)) || [], settings: {}
  });
}
/* Все позиции состава всех строк сметы с учётом количества (kind → code → штук). */
function itemsByKind(est, kind) {
  const acc = {};
  est.groups.forEach(g => (g.items || []).filter(it => it.kind === kind && it.code).forEach(it => {
    acc[it.code] = (acc[it.code] || 0) + it.count * g.count;
  }));
  return acc;
}

test("разведка: 09001 — цельное место управления, голый механизм — нет", () => {
  assert.ok(PRODUCTS.length > 2000, "рантайм-каталог получен");
  assert.equal(controlPlaceKind(byCode("09001")), "integrated", "09001 — цельное изделие с ролью управления");
  assert.equal(controlPlaceKind(byCode("09008.0.250")), null, "голый механизм — не место управления");
  assert.equal(controlPlaceKind(byCode("09005")), "integrated", "09005 (переключатель) — тоже место управления");
});

/* ─────────────────────── подбор замены (resolveReplacement) ─────────────────────── */

test("замена 09001: switch→переключатель 09005, switch→инвертор 09013, switch→кнопка 09008; сама роль switch → 09001", () => {
  const mechs = PRODUCTS.filter(p => p.kind === "mechanism" && p.active);
  const deps = {
    seriesOf: EPCatalog.productSeries, spanOf: EPCatalog.mechanismSpan,
    colorKeyOf: item => (item && item.elementColor ? EPCatalog.facingColorKey(item.elementColor) : null),
    fgOf: item => (item && item.functionalGroup) || null, fsgOf: item => (item && item.functionalSubgroup) || null
  };
  const src = byCode("09001");
  assert.equal(EPLightingPlan.resolveReplacement({ role: "changeover", source: src }, mechs, deps).product.code, "09005");
  assert.equal(EPLightingPlan.resolveReplacement({ role: "inverter", source: src }, mechs, deps).product.code, "09013");
  assert.equal(EPLightingPlan.resolveReplacement({ role: "button", source: src }, mechs, deps).product.code, "09008");
  /* роль уже нужная — само изделие, замены не ищем (владелец п.4) */
  assert.equal(EPLightingPlan.resolveReplacement({ role: "switch", source: src }, mechs, deps).product.code, "09001");
});

test("данные Arke: 19101.B (осевой выключатель) → переключатель НЕ найден — честный пробел, не 19181.B (датчик) и не 19105.B", () => {
  const mechs = PRODUCTS.filter(p => p.kind === "mechanism" && p.active);
  const deps = {
    seriesOf: EPCatalog.productSeries, spanOf: EPCatalog.mechanismSpan,
    colorKeyOf: item => (item && item.elementColor ? EPCatalog.facingColorKey(item.elementColor) : null),
    fgOf: item => (item && item.functionalGroup) || null, fsgOf: item => (item && item.functionalSubgroup) || null
  };
  const src = byCode("19101.B");
  const changeover = EPLightingPlan.resolveReplacement({ role: "changeover", source: src }, mechs, deps);
  assert.equal(changeover.product, null, "переключателя в осевых механизмах Arke нет (у 19105.B в данных роль switch) — пробел");
  assert.equal(changeover.ambiguous, false, "ноль кандидатов — это пробел, а не неоднозначность");
  /* датчик движения 19181.B той же роли switch НЕ утекает в замену: другая functionalSubgroup */
  const inverter = EPLightingPlan.resolveReplacement({ role: "inverter", source: src }, mechs, deps);
  assert.equal(inverter.product.code, "19113.B", "инвертор в осевых механизмах Arke есть — 19113.B");
});

/* ─────────────────────── проходная в смете (сквозной сценарий) ─────────────────────── */

const postCross = (id, number, cross) => ({ id, number, frameId: null,
  mechanismIds: [byCode("09001").id], keyGroups: [""], keyCrossNumbers: [cross], keyMechanisms: [""] });

test("два поста 09001 с одним № проходной → в смете 2×09005, ни одного 09001, голых механизмов нет", () => {
  const posts = [postCross("a", 1, "5"), postCross("b", 2, "5")];
  const light = makeLighting("classic")(posts);
  const est = estimateFor(posts, light);
  const mechs = itemsByKind(est, "mechanism");
  const lights = itemsByKind(est, "lighting");
  assert.equal(mechs["09005"], 2, "два переключателя 09005 в составе");
  assert.equal(mechs["09001"], undefined, "исходного 09001 в смете нет — заменён");
  assert.equal(mechs["09005.0.250"], undefined, "голого механизма нет");
  assert.deepEqual(lights, {}, "цельное изделие отдельной позицией «механизм групп света» не идёт");
});

test("три поста 09001 с одним № проходной → 2×09005 + 1×09013", () => {
  const posts = [postCross("a", 1, "7"), postCross("b", 2, "7"), postCross("c", 3, "7")];
  const light = makeLighting("classic")(posts);
  const est = estimateFor(posts, light);
  const mechs = itemsByKind(est, "mechanism");
  assert.equal(mechs["09005"], 2, "два переключателя");
  assert.equal(mechs["09013"], 1, "один инвертор");
  assert.equal(mechs["09001"], undefined, "исходного 09001 в смете нет");
});

test("один пост 09001 без № проходной и без группы → остаётся 09001 (выключатель)", () => {
  const posts = [{ id: "a", number: 1, frameId: null, mechanismIds: [byCode("09001").id], keyGroups: [""], keyCrossNumbers: [""], keyMechanisms: [""] }];
  const light = makeLighting("classic")(posts);
  const est = estimateFor(posts, light);
  const mechs = itemsByKind(est, "mechanism");
  assert.equal(mechs["09001"], 1, "одиночный выключатель остаётся 09001");
  assert.equal(mechs["09005"], undefined, "переключателя нет — место одно");
});

test("ручной выбор «Выключатель» при двух местах → 09001 остаётся (вариант C главнее расчёта)", () => {
  const mk = (id, n) => ({ id, number: n, frameId: null, mechanismIds: [byCode("09001").id],
    keyGroups: ["Кухня"], keyCrossNumbers: [""], keyMechanisms: ["switch"] });
  const posts = [mk("a", 1), mk("b", 2)];
  const light = makeLighting("classic")(posts);
  const est = estimateFor(posts, light);
  const mechs = itemsByKind(est, "mechanism");
  assert.equal(mechs["09001"], 2, "оба остаются выключателями — ручной выбор главнее N=2");
  assert.equal(mechs["09005"], undefined, "переключателя нет — расчёт переопределён вручную");
});

test("схема relay/bell → цельная кнопка Neve Up 09008 того же цвета", () => {
  const posts = [{ id: "a", number: 1, frameId: null, mechanismIds: [byCode("09001").id], keyGroups: ["Свет"], keyCrossNumbers: [""], keyMechanisms: [""] }];
  ["relay", "bell"].forEach(scheme => {
    const light = makeLighting(scheme)(posts);
    const est = estimateFor(posts, light);
    const mechs = itemsByKind(est, "mechanism");
    assert.equal(mechs["09008"], 1, `${scheme}: цельная кнопка 09008`);
    assert.equal(mechs["09001"], undefined, `${scheme}: исходного 09001 нет`);
  });
});

test("цена: пост-переключатель стоит как 09005, а не как 09001+механизм (двойной цены нет)", () => {
  const posts = [postCross("a", 1, "5"), postCross("b", 2, "5")];
  const light = makeLighting("classic")(posts);
  const est = estimateFor(posts, light);
  const price09005 = Number(byCode("09005").price) || 0;
  /* обе строки поста (в одну группу схлопнулись) — сумма = 2×цена 09005, без цены 09001 сверху */
  assert.ok(Math.abs(est.equipment - 2 * price09005) < 1e-6,
    `оборудование = 2×09005 (${(2 * price09005).toFixed(2)}), факт ${est.equipment.toFixed(2)}`);
});

/* ─────────────────────── панель свойств: поля группы у цельного изделия ─────────────────────── */

test("свойства поста с цельным выключателем: есть поля группы (не «нет мест управления»)", () => {
  const shim = id => Number(id) === 1
    ? { id: 1, code: "09001", name: "Выключатель", controlRole: "switch" }   /* цельное изделие */
    : { id: 2, code: "SOCK", name: "Розетка", partRole: "socket" };
  const html = stand.runNamed(["controlPlaceKind", "isControlPlaceItem", "keySlotKind", "postGroupsPropHtml"], {
    product: shim, EPBuilderSlots: require("../js/builderSlots.js"), EPLightingGroups, esc: s => String(s)
  })({ mechanismIds: [1, 2], keyGroups: ["Кухня", ""] });
  assert.doesNotMatch(html, /нет мест управления/, "у поста с цельным выключателем поля группы есть");
  assert.match(html, /Кухня/, "имя группы цельного изделия печатается");
  assert.equal((html.match(/Место \d+/g) || []).length, 1, "ровно одно место — цельный выключатель; розетка не место");
});

/* ─────────────────────── строгий подбор на синтетике: неоднозначность и семья ─────────────────────── */

const RD = {
  seriesOf: i => i.series, spanOf: i => i.span, colorKeyOf: i => i.color,
  fgOf: i => i.fg, fsgOf: i => i.fsg
};
const synthSwitch = { code: "S", controlRole: "switch", series: ["X"], span: 1, color: "w", fg: "g", fsg: "sub" };

test("синтетика: два подходящих переключателя → неоднозначность (product=null), не первый", () => {
  const c1 = { code: "C1", controlRole: "changeover", series: ["X"], span: 1, color: "w", fg: "g", fsg: "sub" };
  const c2 = { code: "C2", controlRole: "changeover", series: ["X"], span: 1, color: "w", fg: "g", fsg: "sub" };
  const res = EPLightingPlan.resolveReplacement({ role: "changeover", source: synthSwitch }, [c1, c2], RD);
  assert.equal(res.product, null, "неоднозначность не решается монетой");
  assert.equal(res.ambiguous, true);
  assert.equal(res.candidates.length, 2);
});

test("синтетика: семья (functionalSubgroup) обязана совпасть — иначе датчик той же роли отсеян", () => {
  const wrongSub = { code: "SENS", controlRole: "changeover", series: ["X"], span: 1, color: "w", fg: "g", fsg: "sensors" };
  const right = { code: "C", controlRole: "changeover", series: ["X"], span: 1, color: "w", fg: "g", fsg: "sub" };
  assert.equal(EPLightingPlan.resolveReplacement({ role: "changeover", source: synthSwitch }, [wrongSub], RD).product, null,
    "чужая подгруппа не берётся, даже если роль/серия/цвет совпали");
  assert.equal(EPLightingPlan.resolveReplacement({ role: "changeover", source: synthSwitch }, [wrongSub, right], RD).product.code, "C",
    "берётся ровно тот, у кого совпала и семья");
});

test("синтетика: цвет обязан совпасть", () => {
  const otherColor = { code: "C", controlRole: "changeover", series: ["X"], span: 1, color: "b", fg: "g", fsg: "sub" };
  assert.equal(EPLightingPlan.resolveReplacement({ role: "changeover", source: synthSwitch }, [otherColor], RD).product, null,
    "другой цвет — не замена");
});

test("синтетика: модульность обязана совпасть", () => {
  const twoMod = { code: "C", controlRole: "changeover", series: ["X"], span: 2, color: "w", fg: "g", fsg: "sub" };
  assert.equal(EPLightingPlan.resolveReplacement({ role: "changeover", source: synthSwitch }, [twoMod], RD).product, null,
    "другая модульность — не замена");
});
