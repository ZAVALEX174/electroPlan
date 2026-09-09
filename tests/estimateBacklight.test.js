/* Подсветка клавиш в СМЕТЕ (B1b, PLAN 7.1). Проверяем ровно денежный край, ради которого
   правился js/estimate.js:
     · аксессуары-LED попадают в состав строки поста и в её цену;
     · честный пробел («принимает, но совместимой нет») показан словами и в деньги НЕ идёт;
     · ключ группировки различает посты по подсветке — иначе два поста, отличающиеся только
       цветом/наличием подсветки, схлопнутся в одну строку и смета соврёт;
     · выключенная подсветка оставляет смету байт в байт как до правки.
   Часть тестов — на ЖИВЫХ EPPosts/EPPostFit (сумма обязана вырасти ровно на подобранные LED),
   часть — на рукотворном comp (ключ группировки не зависит от того, как приложение сейчас умеет
   задавать цвет; per-post цвет — задача B2, но ключ обязан быть готов уже сейчас). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { build } = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPPostFit = require("../js/postfit.js");

const settings = { workPercent: 0, materialsPercent: 0, discountPercent: 0, vatPercent: 0, vatEnabled: false };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: получено ${a}, ожидалось ${b}`);

/* --- Рукотворный comp: ключ группировки от подсветки не зависит от подбора --------------- */
const frameProduct = id => ({ 2: { id: 2, code: "14653", name: "Накладка", price: 3.0 } }[id]);
const product = id => ({ 1: { id: 1, code: "09021.N", name: "Клавиша", price: 4.3 } }[id]);
const led = (code, name) => ({ code, name });
const compFor = bl => ({ boxCount: 1, supportCount: 0, backlight: bl });
const post = () => ({ name: "Пост", frameId: 2, mechanismIds: [1] });
const runComp = (posts, comp) => build({ posts, product, frameProduct,
  postCost: () => 10, postComposition: comp, settings });

test("разный ЦВЕТ подсветки → две строки сметы (ключ группировки различает LED)", () => {
  const white = { enabled: true, items: [{ accessory: led("00936.250.W", "LED белый") }], gaps: [] };
  const amber = { enabled: true, items: [{ accessory: led("00936.250.A", "LED янтарный") }], gaps: [] };
  const a = Object.assign(post(), { bl: white }), b = Object.assign(post(), { bl: amber });
  const e = runComp([a, b], po => compFor(po.bl));
  assert.equal(e.groups.length, 2, "разные артикулы подсветки — две строки, не одна");
});

test("НАЛИЧИЕ подсветки → две строки (подобрана vs пробел)", () => {
  const on = { enabled: true, items: [{ accessory: led("00936.250.W", "LED белый") }], gaps: [] };
  const gap = { enabled: true, items: [], gaps: [{ mechId: 1 }] };
  const a = Object.assign(post(), { bl: on }), b = Object.assign(post(), { bl: gap });
  const e = runComp([a, b], po => compFor(po.bl));
  assert.equal(e.groups.length, 2, "подобранная и пробельная подсветка не сливаются");
});

test("одинаковая подсветка → одна строка count 2 (иначе смета раздулась бы)", () => {
  const white = { enabled: true, items: [{ accessory: led("00936.250.W", "LED белый") }], gaps: [] };
  const e = runComp([post(), post()], () => compFor(white));
  assert.equal(e.groups.length, 1, "идентичная подсветка — одна строка");
  assert.equal(e.groups[0].count, 2);
});

test("выключенная подсветка: состав и группировка байт в байт как без поля backlight", () => {
  const off = { enabled: false, items: [], gaps: [] };
  const withOff = runComp([post(), post()], () => compFor(off));
  const legacy = runComp([post(), post()], () => ({ boxCount: 1, supportCount: 0 }));
  assert.equal(withOff.groups.length, legacy.groups.length, "то же число строк");
  assert.equal(withOff.groups[0].composition, legacy.groups[0].composition, "та же печатная строка");
  assert.deepEqual(withOff.groups[0].items, legacy.groups[0].items, "тот же структурный состав");
});

test("пробел печатается словами и стоит в составе", () => {
  const gap = { enabled: true, items: [], gaps: [{ mechId: 1 }, { mechId: 1 }] };
  const e = runComp([post()], () => compFor(gap));
  assert.match(e.groups[0].composition, /2 × подсветка не подобрана/,
    "пробел показан как у не подобранной коробки — словами, со счётчиком механизмов");
  assert.ok(e.groups[0].items.some(it => it.kind === "backlight" && it.gap),
    "пробел присутствует в структурном составе");
});

test("подсветка стоит СРАЗУ ЗА механизмами, до суппорта/коробки/накладки", () => {
  const on = { enabled: true, items: [{ accessory: led("00936.250.W", "LED белый") }], gaps: [] };
  const e = build({ posts: [post()], product, frameProduct, postCost: () => 10,
    postComposition: () => ({ boxCount: 1, supportCount: 1, support: { name: "Суппорт X" }, backlight: on }),
    settings });
  const kinds = e.groups[0].items.map(it => it.kind);
  assert.ok(kinds.indexOf("backlight") < kinds.indexOf("support"), "подсветка раньше суппорта");
  assert.ok(kinds.indexOf("backlight") < kinds.indexOf("box"), "подсветка раньше коробки");
  assert.ok(kinds.indexOf("backlight") < kinds.indexOf("frame"), "подсветка раньше накладки");
});

/* --- Живая интеграция: сумма сметы растёт РОВНО на подобранные LED ------------------------ */
const CAT = {
  14653: { id: 14653, code: "14653", name: "Накладка Plana 3М", price: 3.0, standard: "IT", series: "Plana", slotCount: 3 },
  1: { id: 1, code: "09021.N", name: "Клавиша 1M", price: 4.3, moduleSpan: 1, askBacklight: true, backlightPosition: 3 },
  71001: { id: 71001, code: "V71001", name: "Коробка ø60", price: 0.85, kind: "socket_box", wallType: "solid" }
};
const ACC = [{ id: 610, code: "00936.250.W", price: 9.6, kind: "accessory", askBacklight: true, backlightPosition: 3, backlightColor: "Белая" }];
const iprod = id => CAT[id];
const blFind = opts => EPPostFit.findBacklight(Object.assign({ accessories: ACC }, opts));
const ideps = bl => ({ product: iprod, frameProduct: iprod, socketBox: () => CAT[71001],
  mechanismSpan: it => (it && it.moduleSpan) || 1, findBacklight: blFind, backlight: bl });
const ipost = { name: "Пост", frameId: 14653, mechanismIds: [1, 1, 1] };
const buildWith = bl => build({ posts: [ipost], product: iprod, frameProduct: iprod,
  postCost: po => EPPosts.postCost(po, ideps(bl)), postComposition: po => EPPosts.postComposition(po, ideps(bl)), settings });

test("живая смета: включённая подсветка растит сумму ровно на подобранные LED", () => {
  const eOff = buildWith({ enabled: false });
  const eOn = buildWith({ enabled: true, color: "Белая", voltage: "110-250V" });
  near(eOn.equipment - eOff.equipment, 3 * 9.6, "три клавиши → три LED по 9,6 €");
  assert.match(eOn.groups[0].composition, /3 × Светодиод|3 × 00936|3 ×/,
    "три одинаковых LED схлопнуты в «3 ×», а не три отдельные строки");
});

test("живая смета: пробел (нет напряжения) сумму не меняет", () => {
  const eOff = buildWith({ enabled: false });
  const eGap = buildWith({ enabled: true, color: "Белая", voltage: "120V" });   // 120V в каталоге нет
  near(eGap.equipment - eOff.equipment, 0, "пробел в деньги не идёт");
  assert.match(eGap.groups[0].composition, /подсветка не подобрана/, "пробел показан словами");
});
