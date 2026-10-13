/* В26 ч.3а — ИНВАРИАНТ «ОДНА НАПЕЧАТАННАЯ ЦЕНА ПОСТА» НА НАСТОЯЩИХ ДАННЫХ.
   Решение владельца 13.10: цена поста во всех пяти местах показа = «Цена» строки спецификации
   этого поста, до копейки, при любом курсе. Правило вынесено в ОДНУ точку EPEstimate.postPriceShown
   (ядро pricedUnit, то же, что у specShown). Здесь проверяем САМ инвариант на НАСТОЯЩЕМ каталоге
   VIMAR и НАСТОЯЩИХ связках app.js (postCost/postComposition через real EPPosts) — а не на фикстуре:

     для каждого поста случайного проекта и каждого курса (1; 92,5; 95,5; 96,25; 95,313522)
       EPEstimate.postPriceShown(post, deps, rate) == specShown(est, rate).rows[строка поста].price
       (сравнение в целых копейках, расхождений 0);
     отдельно при курсе 1 цена поста = прежней EPEstimate.postPrice(postCost) в евро, округлённой до
       цента — евро НЕ изменилось (обратная совместимость, §7.1 п.4).

   Посты покрывают: накладки 1–4 места, подсветку клавиш, ОТДЕЛЬНЫЕ строки групп света (голые
   механизмы за клавишей) и ЦЕЛЬНЫЕ изделия групп света (kind:"integrated" — замена механизма поста),
   свой тип стены поста (solid/hollow). Если инвариант где-то нарушится — тест печатает вход и числа
   первых расхождений (не подгоняем). Тот же прогон на 4000 проектах лежит в scratchpad/v26/verify3a.js. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPPostFit = require("../js/postfit.js");
const EPCatalog = require("../js/catalog.js");

/* Настоящий runtime-каталог: data.js собирает products из прайса VIMAR ровно так, как в браузере
   (сборщика нет). Загружаем его в vm с window-шимом — не копируем данные в тест. */
const JS = path.join(__dirname, "..", "js");
const win = {};
const ctx0 = vm.createContext({ window: win, structuredClone });
for (const f of ["catalog-vimar.js", "catalog-vimar-attrs.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx0, { filename: f });
}
const PRODUCTS = win.EP_DATA.products;

/* Настоящие связки app.js (product/postCost/postComposition и их зависимости) — вырезаем ИСХОДНЫЙ
   текст const-блоков и исполняем в одном vm-контексте, как world.js разведки: цена и состав поста
   считаются тем же кодом, что в приложении, а не рукописной копией (§7.1). */
function makeApp(settings) {
  const EP_DATA = { settings };
  const state = { products: PRODUCTS };
  const ctx = vm.createContext({ state, EP_DATA, EPPostFit, EPPosts, EPCatalog, console });
  const code = [
    "const {moduleWord,mechanismSpan,productSeries,compatibleMechanisms,frameSlotCount,frameSlotOptions}=EPCatalog;",
    stand.constBlock("product"), stand.constBlock("byKind"), stand.constBlock("socketBox"),
    stand.constBlock("frameProduct"), stand.constBlock("wantedWall"), stand.constBlock("findBox"),
    stand.constBlock("fallbackBox"), stand.constBlock("findSupport"), stand.constBlock("resolveSupport"),
    stand.constBlock("findBacklight"), stand.constBlock("postDeps"), stand.constBlock("postCost"),
    stand.constBlock("postComposition"),
    ";({product,frameProduct,postCost,postComposition,productSeries,frameSlotCount,mechanismSpan});"
  ].join("\n");
  return vm.runInContext(code, ctx);
}

const frames = PRODUCTS.filter(p => p.kind === "frame" && p.active);
const mechs = PRODUCTS.filter(p => p.kind === "mechanism" && p.active);
/* Клавиши групп света (switch/переключатель/инвертор) — для цельных и отдельных строк. */
const switches = ["20001.0", "20005.0", "20013.0", "19013.0"].map(c => PRODUCTS.find(p => p.code === c)).filter(Boolean);

const RATES = [1, 92.5, 95.5, 96.25, 95.313522];
const K = v => Math.round(EPEstimate.round2(v) * 100);   // целые копейки

/* Детерминированный ГПСЧ — прогон воспроизводим (§Excel п.7: тот же вход → тот же результат). */
function makeRnd(seed) { let s = seed >>> 0; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

/* Один случайный пост: накладка 1–4 места, совместимые механизмы по серии/модульности, иногда свой
   тип стены, иногда отдельные строки групп света (голые клавиши), иногда ЦЕЛЬНОЕ изделие (замена
   механизма keyIndex на product.id через effectiveMechanismIds). */
function randPost(app, rnd, i) {
  const pick = a => a[Math.floor(rnd() * a.length)];
  for (let tries = 0; tries < 50; tries++) {
    const f = pick(frames);
    const slots = app.frameSlotCount(f);
    if (!(slots >= 1 && slots <= 4)) continue;
    const fs_ = app.productSeries(f);
    const pool = mechs.filter(m => app.productSeries(m).some(s => fs_.includes(s)) && app.mechanismSpan(m) <= slots);
    if (!pool.length) continue;
    const ids = []; let used = 0;
    while (used < slots && ids.length < slots) {
      const m = pick(pool); const sp = app.mechanismSpan(m);
      if (used + sp > slots) break;
      ids.push(m.id); used += sp;
      if (rnd() < 0.3) break;
    }
    if (!ids.length) continue;
    const post = { id: "p" + i, number: i + 1, name: "Пост " + (i + 1), frameId: f.id, mechanismIds: ids };
    if (rnd() < 0.25) post.wallType = rnd() < 0.5 ? "hollow" : "solid";   // свой тип стены поста
    const r = rnd();
    if (switches.length && r < 0.3) {
      /* ОТДЕЛЬНЫЕ строки групп света: голые механизмы за клавишей, идут доп.позициями состава. */
      post._light = Array.from({ length: pick([1, 1, 2]) }, (_, k) => {
        const m = pick(switches);
        return { keyIndex: k, kind: "key", missing: false, product: m, code: m.code, name: m.name,
          price: m.price, groupLabel: "Группа " + (i % 3), roleLabel: "Выключатель" };
      });
    } else if (switches.length && r < 0.45) {
      /* ЦЕЛЬНОЕ изделие группы света: замена механизма поста (клавиша+механизм в одном артикуле). */
      const m = pick(switches);
      post._light = [{ keyIndex: 0, kind: "integrated", missing: false, product: m, code: m.code,
        name: m.name, price: m.price, groupLabel: "Группа " + (i % 3), roleLabel: "Переключатель" }];
    }
    if (rnd() < 0.15) post.discount = pick([0, 5, 10, 15, 50]);
    return post;
  }
  return null;
}

/* Проверяем на двух настройках: подсветка выключена и включена — чтобы покрыть ветку backlight в
   составе (и цене) поста. Инвариант обязан держаться при обеих. */
const SETTINGS = [
  { wallType: "solid", backlight: { enabled: false } },
  { wallType: "solid", backlight: { enabled: true, color: "white", voltage: "230" } }
];

test("В26: цена поста (postPriceShown) == «Цена» строки спецификации, настоящий каталог, 5 курсов, 0 расхождений", () => {
  /* Объём по умолчанию держим на ~3 с (мутационная проверка гоняет весь набор десятки раз, и 15-секундный
     прогон раздувал каждый мутационный раунд). Этого N хватает на покрытие всех видов постов и пяти
     курсов — это проверяют счётчики ниже. Тяжёлый прогон (тысячи постов) — через INV_N=4000. */
  const N = Number(process.env.INV_N) || 30;
  let projects = 0, posts = 0, rateChecks = 0, mismatch = 0, wireMismatch = 0, euroMismatch = 0;
  /* Счётчики ВИДОВ постов: при малом N тест обязан доказать, что покрыл их все (а не выродился). */
  const kinds = { wall: 0, separate: 0, integrated: 0, backlight: 0 };
  const samples = [];
  for (const settings of SETTINGS) {
    const app = makeApp(settings);
    const deps = { product: app.product, frameProduct: app.frameProduct, postCost: app.postCost,
      postComposition: app.postComposition, lightingOf: po => po._light || [], settings };
    const buildEst = ps => EPEstimate.build(Object.assign({ posts: ps, devices: [] }, deps));
    const rnd = makeRnd(0x51501 ^ (settings.backlight.enabled ? 0x9e3779b1 : 0));
    for (let i = 0; i < N; i++) {
      const nP = Math.floor(rnd() * 6) + 1;
      const ps = [];
      for (let k = 0; k < nP; k++) { const p = randPost(app, rnd, i * 10 + k); if (p) ps.push(p); }
      if (!ps.length) continue;
      const est = buildEst(ps);
      projects++;
      /* Ключ строки → индекс (та же группировка build, что у specShown). */
      const idx = new Map();
      est.groups.forEach((g, j) => idx.set(g.key, j));
      /* specShown полной сметы по каждому курсу — ОДИН раз на проект (не в цикле постов). */
      const specByRate = new Map(RATES.map(rate => [rate, EPEstimate.specShown(est, rate)]));
      if (settings.backlight.enabled) kinds.backlight += ps.length;
      ps.forEach((p, pi) => {
        posts++;
        if (p.wallType) kinds.wall++;
        if ((p._light || []).some(r => r.kind === "key")) kinds.separate++;
        if ((p._light || []).some(r => r.kind === "integrated")) kinds.integrated++;
        /* Строка ИМЕННО этого поста: собираем её ОДИН раз (build тяжёлый — не в цикле курсов) и
           берём её ключ и состав. pricedUnit по этому составу — математическое ядро цены поста. */
        const one = buildEst([p]).groups[0];
        const j = one ? idx.get(one.key) : null;
        /* 5 КУРСОВ — через ядро pricedUnit (оно и у postPriceShown, и у строки спецификации): цена
           единицы строки одиночного поста обязана совпасть с «Ценой» строки того же поста в полной
           смете до копейки при любом курсе. Это мат.инвариант, build не повторяем. */
        for (const rate of RATES) {
          rateChecks++;
          const unit = one ? EPEstimate.pricedUnit(one.items, rate).price : 0;
          const specRows = specByRate.get(rate).rows;
          const rowPrice = (j != null && specRows[j]) ? specRows[j].price : null;
          if (rowPrice == null) {
            mismatch++;
            if (samples.length < 5) samples.push({ why: "нет строки", rate, key: one && one.key, post: p });
            continue;
          }
          if (K(unit) !== K(rowPrice)) {
            mismatch++;
            if (samples.length < 5) samples.push({ rate, unit, rowPrice, post: p });
          }
        }
        /* Сама ОБЁРТКА postPriceShown (build одного поста + pricedUnit) — проверяем на НАСТОЯЩЕМ
           вызове, по одному курсу на пост (ротация по индексу покрывает все пять): её результат
           обязан равняться ядру на том же составе. */
        const rate = RATES[(i + pi) % RATES.length];
        const pp = EPEstimate.postPriceShown(p, deps, rate);
        const unit = one ? EPEstimate.pricedUnit(one.items, rate).price : 0;
        if (K(pp) !== K(unit)) {
          wireMismatch++;
          if (samples.length < 5) samples.push({ wire: true, rate, postPriceShown: pp, unit, post: p });
        }
        /* Евро при курсе 1 не изменилось против HEAD-пути: postPrice от postCost по ЭФФЕКТИВНЫМ
           механизмам (замена цельных изделий), округлённого до цента. Цену в евро берём ядром по
           уже построенному составу (= postPriceShown при rate 1, что держит wire-проверка выше). */
        const eur = one ? EPEstimate.pricedUnit(one.items, 1).price : 0;
        const effIds = EPEstimate.effectiveMechanismIds(p.mechanismIds, p._light || []);
        const head = EPEstimate.round2(EPEstimate.postPrice(app.postCost(Object.assign({}, p, { mechanismIds: effIds })), p._light || []));
        if (K(eur) !== K(head)) {
          euroMismatch++;
          if (samples.length < 5) samples.push({ euro: true, postPriceShown: eur, head, post: p });
        }
      });
    }
  }
  assert.ok(posts > 150, `проверено постов: ${posts} (> 150)`);
  /* Все виды постов реально встретились — иначе малый N проверил бы не то, что обещано. */
  Object.entries(kinds).forEach(([k, n]) => assert.ok(n > 0, `вид постов «${k}» не покрыт (${n})`));
  assert.equal(mismatch, 0, `«Цена» единицы != «Цена» строки сметы: ${mismatch} (проектов ${projects}, постов ${posts}, курсо-проверок ${rateChecks}); примеры: ${JSON.stringify(samples)}`);
  assert.equal(wireMismatch, 0, `postPriceShown != ядро pricedUnit: ${wireMismatch}; примеры: ${JSON.stringify(samples)}`);
  assert.equal(euroMismatch, 0, `евро при курсе 1 разошлось с postPrice: ${euroMismatch}; примеры: ${JSON.stringify(samples)}`);
});
