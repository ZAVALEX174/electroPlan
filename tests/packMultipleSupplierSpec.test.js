/* Округление свода «Сводная спецификация по артикулам» в КП по галке «рассчитать кратно упаковке»
   (К6б ч.3, решения владельца 23–24.10). Проверяем НА РЕАЛЬНЫХ ВЫХОДАХ двух функций:

     1. при включённой галке количество каждого артикула в своде КП (EPSupplierSpec.buildHtml) =
        количеству того же артикула в листе Excel «По артикулам» (EPSpecExcel.build, sheet2) —
        сравниваем ВЫХОДЫ, а не копию формулы: оба округляют одним правилом EPPackRound.packRound;
     2. столбец «В упаковке» есть с галкой, нет без неё; пустой у артикула без данных об упаковке;
     3. «Общее количество» в подвале свода КП = сумме показанных (округлённых) количеств;
     4. лист монтажника (buildHtml без packMultiple) — по факту, без столбца, при любой галке данных;
     5. без галки свод КП не меняется (прежнее поведение байт в байт);
     6. docs.js: КП передаёт галку проекта, лист монтажника — нет (проводка).

   Это ДЕНЬГИ заказа (количество × цена поставщика), поэтому к ключевым числам — мутации (таблица
   в отчёте). Запуск: node --test tests/packMultipleSupplierSpec.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EPSupplierSpec = require("../js/supplierSpec.js");
const EPSpecExcel = require("../js/specExcel.js");
const stand = require("./helpers/appStand.js");

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* --- Сценарий tools/qa/shoot.mjs: пост на 4 модуля в немецкой кухне, галка вкл (факты из задачи).
   Фактические количества свода и размеры упаковок — ровно те, что выдаёт приложение; округление
   обязано дать 5 / 50 / 20 / 50 / 10, всего 135. Строки задаём как одиночные изделия плана (extras):
   collect() сведёт их в строки свода с этими количествами — тот же путь, что и позиции постов. --- */
const SCENARIO = [
  { code: "09664.01", name: "Накладка",   qty: 1, pack: 5,  want: 5 },
  { code: "09001",    name: "Механизм A", qty: 2, pack: 50, want: 50 },
  { code: "09001.2",  name: "Механизм B", qty: 1, pack: 20, want: 20 },
  { code: "09602.1",  name: "Суппорт",    qty: 2, pack: 50, want: 50 },
  { code: "V71001",   name: "Коробка",    qty: 2, pack: 10, want: 10 }
];
const specOf = () => ({ posts: [], extras: SCENARIO.map(s => ({ code: s.code, name: s.name, kind: "mechanism", count: s.qty })) });
const packsOf = () => Object.fromEntries(SCENARIO.map(s => [s.code, s.pack]));

/* --- Разбор листа Excel «По артикулам» (sheet2) тем же способом, что tests/packMultipleExcel.test.js --- */
function unzipStore(bytes) {
  const buf = Buffer.from(bytes);
  const files = {};
  for (let i = 0; i + 4 <= buf.length;) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const size = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26), elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString("utf8");
    const start = i + 30 + nlen + elen;
    files[name] = buf.slice(start, start + size);
    i = start + size;
  }
  return files;
}
function parseSheet(xml) {
  const cells = {};
  const re = /<c r="([A-Z]+\d+)"(?:\s+t="([^"]*)")?(?:\s+s="\d+")?>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, ref, t, inner] = m;
    if (t === "inlineStr") cells[ref] = { type: "s", text: (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [, ""])[1] };
    else { const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; cells[ref] = { type: "n", num: v == null ? null : Number(v) }; }
  }
  return cells;
}
const col = ref => ref.match(/^[A-Z]+/)[0];
const rowNo = ref => Number(ref.match(/\d+$/)[0]);
/* Колонки листа без цен: A № B Товар C Артикул D Кол-во E Ед. F В упаковке. Код→кол-во по строкам
   данных (строка 1 — шапка, ниже после пустой строки идёт подвал «Всего…»). */
function excelCounts(bytes, packMultiple) {
  const cells = parseSheet(unzipStore(bytes)["xl/worksheets/sheet2.xml"].toString("utf8"));
  const out = {};
  Object.keys(cells).forEach(ref => {
    if (col(ref) === "C" && rowNo(ref) >= 2 && cells[ref].type === "s" && cells[ref].text && cells[ref].text !== "Артикул") {
      const d = cells["D" + rowNo(ref)];
      if (d && d.type === "n" && d.num != null) out[cells[ref].text] = d.num;
    }
  });
  return out;
}
const buildExcel = packMultiple => EPSpecExcel.build({ groups: [] }, EPSupplierSpec.collect(specOf()),
  { options: {}, currency: "EUR", rate: 1, packByCode: packsOf(), packMultiple });

/* --- Разбор свода КП (HTML): код артикула (моноширинный) → показанное количество (жирная ячейка) --- */
function kpCounts(html) {
  const out = {};
  const re = /monospace">([^<]+)<\/span>[\s\S]*?width:64px">(\d+)</g;
  let m;
  while ((m = re.exec(html))) out[m[1]] = Number(m[2]);
  return out;
}
const buildKp = (packMultiple, packs) => EPSupplierSpec.buildHtml(specOf(),
  { esc, packs: packs === undefined ? packsOf() : packs, packMultiple });

test("К6б ч.3: количества свода КП с галкой = листу Excel «По артикулам» (сравнение ВЫХОДОВ)", () => {
  const want = Object.fromEntries(SCENARIO.map(s => [s.code, s.want]));
  const kp = kpCounts(buildKp(true));
  const xl = excelCounts(buildExcel(true), true);
  assert.deepEqual(kp, want, "свод КП округлил до 5/50/20/50/10 (мутация «не округлять» дала бы 1/2/1/2/2)");
  assert.deepEqual(kp, xl, "свод КП и лист Excel выдают одно и то же по каждому артикулу");
  /* Явные числа сценария из задачи — чтобы отчёт мог их процитировать. */
  assert.equal(kp["09664.01"], 5);
  assert.equal(kp["V71001"], 10);
});

test("К6б ч.3: «Общее количество» в своде КП с галкой = 135 (по округлённым), без галки = 8", () => {
  assert.match(buildKp(true), /Общее количество:<\/b> 135 шт\./, "итог по показанным количествам (5+50+20+50+10)");
  assert.match(buildKp(false), /Общее количество:<\/b> 8 шт\./, "без галки — по факту (1+2+1+2+2)");
});

test("К6б ч.3: столбец «В упаковке» есть с галкой, нет без неё", () => {
  const on = buildKp(true), off = buildKp(false);
  assert.match(on, /<th[^>]*>В упаковке<\/th>/, "с галкой столбец в шапке есть");
  assert.ok(!/В упаковке/.test(off), "без галки столбца нет (мутация «рисовать всегда» краснит здесь)");
  /* Размер упаковки показан числом в строке артикула. */
  assert.match(on, /monospace">09664\.01<\/span>[\s\S]*?width:72px">5</, "у 09664.01 упаковка 5");
  assert.match(on, /monospace">V71001<\/span>[\s\S]*?width:72px">10</, "у V71001 упаковка 10");
});

test("К6б ч.3: нет данных об упаковке — количество без округления, ячейка «В упаковке» пустая", () => {
  /* Убираем упаковку у одного артикула: по тому же правилу, что в Excel (К6а), его количество не
     округляется, а клетка остаётся пустой — столбец при этом всё равно показан (галка включена). */
  const packs = packsOf(); delete packs["V71001"];
  const html = EPSupplierSpec.buildHtml(specOf(), { esc, packs, packMultiple: true });
  const kp = kpCounts(html);
  assert.equal(kp["V71001"], 2, "без упаковки количество фактическое (2), а не округлённое");
  assert.equal(kp["09001"], 50, "у остальных округление работает");
  assert.match(html, /monospace">V71001<\/span>[\s\S]*?width:72px"><\/td>/, "ячейка «В упаковке» у V71001 пустая");
  /* И числа совпадают с Excel при той же неполной карте упаковок. */
  const xl = excelCounts(EPSpecExcel.build({ groups: [] }, EPSupplierSpec.collect(specOf()),
    { options: {}, currency: "EUR", rate: 1, packByCode: packs, packMultiple: true }), true);
  assert.deepEqual(kp, xl, "свод КП и Excel сходятся и при неизвестной упаковке");
});

test("К6б ч.3: лист монтажника (buildHtml без packMultiple) — по факту, без столбца при любых данных", () => {
  /* Лист монтажника зовёт buildHtml БЕЗ packMultiple, даже если карта упаковок есть: он всегда по
     факту. Мутация «округлять и в листе монтажника» (packMultiple:true) здесь покраснеет. */
  const html = EPSupplierSpec.buildHtml(specOf(), { esc, packs: packsOf() });   /* packMultiple не передан */
  const kp = kpCounts(html);
  assert.equal(kp["09664.01"], 1, "по факту, без округления");
  assert.equal(kp["V71001"], 2, "по факту");
  assert.ok(!/В упаковке/.test(html), "столбца «В упаковке» в листе монтажника нет");
  assert.match(html, /Общее количество:<\/b> 8 шт\./, "итог по факту");
});

test("К6б ч.3: без галки свод КП не изменился (поведение байт в байт)", () => {
  /* С галкой false при той же карте упаковок выход обязан совпасть со сводом вообще без pack-полей
     (как было до ч.3): флаг — единственный переключатель. */
  const noFlag = EPSupplierSpec.buildHtml(specOf(), { esc, packs: packsOf(), packMultiple: false });
  const legacy = EPSupplierSpec.buildHtml(specOf(), { esc });
  assert.equal(noFlag, legacy, "галка снята → свод точно как без pack-полей (до ч.3)");
});

test("К6б ч.3: потребность больше одной упаковки округляется ВВЕРХ (73 при упаковке 50 → 100), свод КП = Excel", () => {
  /* Дыра обеих проверок: прежний сценарий весь в пределах одной упаковки (qty 1–2 при pack ≥5),
     поэтому мутация «не меньше одной упаковки, дальше вниз» (max(pack, floor(q/p)*p)) на нём не
     краснела — и correct, и mutant давали одну упаковку. Здесь потребность 73 при упаковке 50:
     верное округление ВВЕРХ = 100 (две упаковки), мутация-вниз дала бы 50. */
  const spec = { posts: [], extras: [{ code: "73PACK", name: "Механизм", kind: "mechanism", count: 73 }] };
  const packs = { "73PACK": 50 };
  const kp = kpCounts(EPSupplierSpec.buildHtml(spec, { esc, packs, packMultiple: true }));
  assert.equal(kp["73PACK"], 100, "73 → две упаковки по 50 = 100 (мутация «вниз после первой упаковки» дала бы 50)");
  const xl = excelCounts(EPSpecExcel.build({ groups: [] }, EPSupplierSpec.collect(spec),
    { options: {}, currency: "EUR", rate: 1, packByCode: packs, packMultiple: true }), true);
  assert.equal(xl["73PACK"], 100, "лист Excel «По артикулам» тоже 100");
  assert.deepEqual(kp, xl, "свод КП и Excel совпадают на многопачечной потребности");
});

test("К6б ч.3: пометка об округлении в своде КП — есть с галкой, нет без неё, нет в листе монтажника", () => {
  const MARK = "Количества — до целых упаковок (см. столбец «В упаковке»).";
  const BASE = "Все одинаковые позиции проекта сведены по артикулам. Документ для поставщика — без цен.";
  /* КП с галкой: примечание по умолчанию + пометка после него (решение владельца 24.10). */
  const on = buildKp(true);
  assert.ok(on.includes(MARK), "с галкой пометка есть (мутация «удалить пометку» краснит здесь)");
  assert.ok(on.includes(BASE + " " + MARK), "пометка дописана ПОСЛЕ прежнего текста примечания одним пробелом");
  /* КП без галки: примечание байт в байт прежнее, без пометки. */
  const off = buildKp(false);
  assert.ok(!off.includes(MARK), "без галки пометки нет (поведение примечания прежнее)");
  assert.ok(off.includes(BASE), "без галки примечание прежнее");
  /* Лист монтажника: своё примечание, packMultiple не передаётся → roundOn ложь → пометки нет
     даже при наличии карты упаковок (пометка привязана к тому же признаку, что столбец). */
  const install = EPSupplierSpec.buildHtml(
    Object.assign(specOf(), { note: "Все одинаковые позиции проекта сведены по артикулам — этот лист отправляется поставщику." }),
    { esc, packs: packsOf() });   /* packMultiple не передан — как в docs.js installSheetForProject */
  assert.ok(!install.includes(MARK), "в листе монтажника пометки нет (packMultiple не передан)");
  assert.ok(install.includes("этот лист отправляется поставщику"), "подпись листа монтажника на месте");
});

/* ---- Проводка docs.js (К6б ч.3): КП передаёт галку проекта, лист монтажника — нет ---- */
test("docs.js: supplierSpecHtml проводит карту упаковок и галку в EPSupplierSpec.buildHtml (поведенчески)", () => {
  /* Исполняем НАСТОЯЩИЙ текст supplierSpecHtml/supplierSpecData из docs.js в vm (stand.run), подменив
     EPSupplierSpec.buildHtml шпионом: так мутации `packs:…buildPackMap(...)`→`null`/`{}` и
     `packMultiple:!!packMultiple`→`false` ловятся ПОВЕДЕНЧЕСКИ, а не сверкой текста. state пустой —
     supplierSpecData не ходит в каталог (posts/devices пусты), нам важны только проброшенные deps. */
  const seenDeps = [];
  const products = { P1: { packQty: 7 } };   /* маркерный объект — EP_DATA.products */
  const ctx = {
    state: { posts: [], devices: [] },
    esc: String,
    EP_DATA: { products },
    EPSupplierSpec: {
      buildHtml: (spec, deps) => { seenDeps.push(deps); return "<section></section>"; },
      kindFromCatalog: () => "other"
    },
    EPOfferOptions: { itemText: name => name },
    EPPackTopUp: { buildPackMap: p => ({ _fromProducts: p }) }   /* карта, узнаваемая по входу */
  };
  const supplierSpecHtml = stand.run(["supplierSpecData", "supplierSpecHtml"], ctx);
  const light = { plan: { relayTotal: 0 } };

  /* Галка включена: packMultiple=true уходит в deps, packs — ровно карта buildPackMap(EP_DATA.products). */
  supplierSpecHtml({}, light, { articles: true }, true);
  assert.equal(seenDeps[0].packMultiple, true, "packMultiple проводится как есть (мутация →false краснит)");
  assert.deepEqual(seenDeps[0].packs, { _fromProducts: products },
    "packs = buildPackMap(EP_DATA.products) (мутации packs:null и packs:{} краснят здесь)");

  /* Галка снята: packMultiple=false, карту упаковок не строим (packs=null) — EPPackTopUp не трогаем. */
  supplierSpecHtml({}, light, { articles: true }, false);
  assert.equal(seenDeps[1].packMultiple, false, "без галки packMultiple=false");
  assert.equal(seenDeps[1].packs, null, "без галки карту упаковок не строим (packs=null)");
});

/* Структурная проверка проводки (оставлена из ч.3): КП передаёт галку проекта, лист монтажника — нет. */
test("docs.js: КП передаёт packMultiple проекта в свод, лист монтажника — нет", () => {
  const offer = stand.functionSource("generateCommercialOffer");
  const install = stand.functionSource("installSheetForProject");
  /* КП: вызов supplierSpecHtml получает галку проекта (EP_DATA.settings.packMultiple). */
  assert.match(offer, /supplierSpecHtml\([^)]*EP_DATA\.settings\.packMultiple[^)]*\)/,
    "КП передаёт галку проекта (мутация «не передавать» краснит здесь)");
  /* Лист монтажника: вызов supplierSpecHtml БЕЗ галки — свод всегда по факту. */
  assert.ok(!/packMultiple/.test(install), "installSheetForProject галку не передаёт — свод по факту");
});
