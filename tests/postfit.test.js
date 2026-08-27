/* Автотесты подбора коробки и суппорта (EPPostFit) на фикстурах реальных артикулов
   VIMAR (PLAN 7.1). Модуль чистый: каталог приходит массивами, браузер не нужен.
   Главное, что проверяем — требование владельца: подобранное/фолбэк изделие НИКОГДА
   не противоречит монтажному стандарту накладки, а при отсутствии совместимого —
   честный null, а не подмена ценой чужого изделия. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { findBox, fallbackBox, findSupport, resolveSupport, socketBox, boxFitsStandard, supportRequired } = require("../js/postfit.js");

/* Коробки — как их обогащает js/data.js из EP_VIMAR_ATTRS. */
const BOX = {
  V71303: { code: "V71303", price: 1.04, kind: "socket_box", wallType: "solid", boxShape: "rect", boxModules: 3, boxStandards: ["IT"] },
  V71304: { code: "V71304", price: 4.37, kind: "socket_box", wallType: "solid", boxShape: "rect", boxModules: 4, boxStandards: ["IT"] },
  V71703: { code: "V71703", price: 6.04, kind: "socket_box", wallType: "hollow", boxShape: "rect", boxModules: 3, boxStandards: ["IT"] },
  V71704: { code: "V71704", price: 8.97, kind: "socket_box", wallType: "hollow", boxShape: "rect", boxModules: 4, boxStandards: ["IT"] },
  V71001: { code: "V71001", price: 0.85, kind: "socket_box", wallType: "solid", boxShape: "round", boxModules: 2, boxStandards: ["IT_ROUND", "DE", "FR"] },
  V71701: { code: "V71701", price: 7.94, kind: "socket_box", wallType: "hollow", boxShape: "round", boxModules: 2, boxStandards: ["IT_ROUND", "DE", "FR"] },
};
const ALL_BOXES = Object.values(BOX);
/* Суппорты Neve Up / Idea. */
const SUP = {
  "09613": { code: "09613", price: 1.48, kind: "support", standard: "IT", moduleCount: 3, series: ["Neve Up"] },
  "09614": { code: "09614", price: 3.75, kind: "support", standard: "IT", moduleCount: 4, series: ["Neve Up"] },
  "09602.1": { code: "09602.1", price: 2.58, kind: "support", standard: "DE", moduleCount: 2, series: ["Neve Up"] },
  "16713": { code: "16713", price: 3.74, kind: "support", standard: "IT", moduleCount: 3, series: ["Idea"] },
};
const ALL_SUP = Object.values(SUP);
const idea3 = { code: "16743", standard: "IT", slotCount: 3, series: ["Idea"] };
const neve3 = { code: "09673", standard: "IT", slotCount: 3, series: ["Neve Up"] };
const neveDE = { code: "09664", standard: "DE", slotCount: 2, series: ["Neve Up"] };

/* --- boxFitsStandard: стандарт коробки как жёсткий признак --- */
test("boxFitsStandard: круглая коробка НЕ годится под итальянскую сборку", () => {
  assert.equal(boxFitsStandard(BOX.V71001, "IT"), false);
  assert.equal(boxFitsStandard(BOX.V71001, "DE"), true);
});
test("boxFitsStandard: прямоугольная коробка НЕ годится под немецкий пост", () => {
  assert.equal(boxFitsStandard(BOX.V71303, "DE"), false);
  assert.equal(boxFitsStandard(BOX.V71303, "IT"), true);
});
test("boxFitsStandard: неизвестный стандарт накладки или коробка без списка — не блокируем", () => {
  assert.equal(boxFitsStandard(BOX.V71303, "UNKNOWN"), true);
  assert.equal(boxFitsStandard({ code: "X" }, "IT"), true);
});

/* --- findBox: точная коробка под стандарт + тип стены + типоразмер --- */
test("итальянская 3М накладка, сплошная стена → прямоугольная V71303", () => {
  const box = findBox({ boxes: ALL_BOXES, frame: idea3, standard: "IT", frameModules: 3, wantedWall: "solid" });
  assert.equal(box.code, "V71303");
});
test("итальянская 3М накладка, полая стена → прямоугольная для ГКЛ V71703", () => {
  const box = findBox({ boxes: ALL_BOXES, frame: idea3, standard: "IT", frameModules: 3, wantedWall: "hollow" });
  assert.equal(box.code, "V71703");
});
test("немецкая накладка → круглая коробка на пост (V71001 solid / V71701 hollow)", () => {
  assert.equal(findBox({ boxes: ALL_BOXES, frame: neveDE, standard: "DE", frameModules: 2, wantedWall: "solid" }).code, "V71001");
  assert.equal(findBox({ boxes: ALL_BOXES, frame: neveDE, standard: "DE", frameModules: 2, wantedWall: "hollow" }).code, "V71701");
});
test("итальянская 3М → наименьшая вмещающая: если нет 3М, берётся 4М", () => {
  const boxes = [BOX.V71304, BOX.V71704];   // только 4-модульные
  assert.equal(findBox({ boxes, frame: idea3, standard: "IT", frameModules: 3, wantedWall: "solid" }).code, "V71304");
});

/* --- УНИВЕРСАЛЬНЫЙ СТАНДАРТ (BOTH): подбор коробки ПО ЁМКОСТИ, как у итальянской ---
   Правило заказчика 01.08: одна накладка = одна коробка по её ёмкости. Раньше ветка
   BOTH/UNKNOWN брала «самую дешёвую по стене» без учёта ёмкости — для 2М-накладки
   09662.02 выбиралась 3М-коробка V71703 (6,04 €) вместо 2М V71701 (7,94 €) просто
   потому, что дешевле. Фикстуры — реальные V71701/V71703/V71001. */
const univ2 = { code: "09662.02", standard: "BOTH", slotCount: 2, series: ["Neve Up"] };
test("BOTH 2М (09662.02), полая стена → круглая 2М V71701, а не более дешёвая 3М V71703", () => {
  const box = findBox({ boxes: ALL_BOXES, frame: univ2, standard: "BOTH", frameModules: 2, wantedWall: "hollow" });
  assert.equal(box.code, "V71701");   // 2 модуля, 7,94 € — по ёмкости, не по цене
});
test("BOTH 2М (09662.02), сплошная стена → V71001 (0,85 €)", () => {
  const box = findBox({ boxes: ALL_BOXES, frame: univ2, standard: "BOTH", frameModules: 2, wantedWall: "solid" });
  assert.equal(box.code, "V71001");
});
test("UNKNOWN-стандарт тоже подбирает коробку по ёмкости (наименьшая вмещающая)", () => {
  const box = findBox({ boxes: ALL_BOXES, frame: { standard: "UNKNOWN", slotCount: 2 }, standard: "UNKNOWN", frameModules: 2, wantedWall: "hollow" });
  assert.equal(box.code, "V71701");
});

/* --- ЗАЩИТА ОТ ДЕФЕКТА 1: фолбэк не противоречит стандарту --- */
test("ДЕФЕКТ-1: под IT-накладку при наличии ТОЛЬКО круглых коробок — null, а не круглая", () => {
  const roundOnly = [BOX.V71001, BOX.V71701];
  assert.equal(findBox({ boxes: roundOnly, frame: idea3, standard: "IT", frameModules: 3, wantedWall: "solid" }), null);
  // фолбэк тоже не подставит круглую под итальянскую сборку
  assert.equal(fallbackBox({ boxes: roundOnly, frame: idea3, standard: "IT", frameModules: 3, wantedWall: "solid" }), null);
});
test("фолбэк релаксит ТИП СТЕНЫ, но не стандарт: IT+hollow, есть только solid-прямоуг → solid-прямоуг", () => {
  const solidRect = [BOX.V71303, BOX.V71304, BOX.V71001];   // + круглая (не должна выбраться)
  // точной под hollow нет
  assert.equal(findBox({ boxes: solidRect, frame: idea3, standard: "IT", frameModules: 3, wantedWall: "hollow" }), null);
  // фолбэк: прямоугольная solid (стандарт IT сохранён), НЕ круглая V71001
  assert.equal(fallbackBox({ boxes: solidRect, frame: idea3, standard: "IT", frameModules: 3, wantedWall: "hollow" }).code, "V71303");
});

/* --- ГАРД: накладной корпус без достоверных признаков не лезет в автоподбор ---
   14901–14904 (IP55-боксы) переклассифицированы из frame в socket_box и попали в пул
   коробок, но у них wallType="unknown" (по номенклатуре «ГКЛ, Кирпич»). Как «подходящий
   под любую стену» такой корпус иначе вытеснял бы штатную коробку по ёмкости/цене. Гард
   отсекает коробки без определённого типа стены — врезной подбор их не выбирает. */
const IP55_2 = { code: "14902", price: 3.0, kind: "socket_box", wallType: "unknown", boxShape: "rect", boxModules: 2, boxStandards: ["IT"] };
test("IP55-корпус (unknown wall) не выигрывает подбор: IT 2М при штатной 3М V71303", () => {
  // без гарда 14902 (mod 2) как «наименьшая вмещающая» побил бы V71303 (mod 3)
  const box = findBox({ boxes: [...ALL_BOXES, IP55_2], frame: { code: "20614", standard: "IT", slotCount: 2, series: ["Eikon Evo"] }, standard: "IT", frameModules: 2, wantedWall: "solid" });
  assert.equal(box.code, "V71303");
});
test("IP55-корпус в пуле не меняет штатный выбор (BOTH 2М → V71001/V71701)", () => {
  const boxes = [...ALL_BOXES, IP55_2];
  assert.equal(findBox({ boxes, frame: univ2, standard: "BOTH", frameModules: 2, wantedWall: "solid" }).code, "V71001");
  assert.equal(findBox({ boxes, frame: univ2, standard: "BOTH", frameModules: 2, wantedWall: "hollow" }).code, "V71701");
});
test("пул из одних бесхарактерных корпусов → null (нет оснований выбирать)", () => {
  assert.equal(findBox({ boxes: [IP55_2], frame: idea3, standard: "IT", frameModules: 3, wantedWall: "solid" }), null);
  assert.equal(fallbackBox({ boxes: [IP55_2], frame: idea3, standard: "IT", frameModules: 3, wantedWall: "solid" }), null);
});

/* --- findSupport: серия + модульность + стандарт --- */
test("суппорт под IT 3М Idea → 16713 (та же серия и модульность)", () => {
  const s = findSupport({ supports: ALL_SUP, frame: idea3, standard: "IT", frameModules: 3, seriesOf: p => p.series });
  assert.equal(s.code, "16713");
});
test("суппорт под IT 3М Neve Up → 09613, немецкий 09602.1 не выбирается", () => {
  const s = findSupport({ supports: ALL_SUP, frame: neve3, standard: "IT", frameModules: 3, seriesOf: p => p.series });
  assert.equal(s.code, "09613");
});
test("ДЕФЕКТ-1 (суппорт): под IT-накладку при наличии только немецкого суппорта серии → null", () => {
  const deOnly = [SUP["09602.1"]];   // Neve Up, DE, 2M
  const s = findSupport({ supports: deOnly, frame: neve3, standard: "IT", frameModules: 3, seriesOf: p => p.series });
  assert.equal(s, null);
});
test("нет суппорта нужной модульности → null (не подставляем чужой)", () => {
  const s = findSupport({ supports: ALL_SUP, frame: { standard: "IT", slotCount: 5, series: ["Idea"] }, standard: "IT", frameModules: 5, seriesOf: p => p.series });
  assert.equal(s, null);
});

/* --- ПРАВИЛО ЗАКАЗЧИКА: суппорт выбирается ПО КОРОБКЕ (602/603), ответы 31.07 §3.3 ---
   Тип суппорта — последние 3 цифры артикула: 602 «за щеками», 603 «с винтами».
   Суппорты 602/603 в номенклатуре универсальны (BOTH) — стандарт суппорта в подборе больше
   не участвует, тип задаёт коробка (это и снимает прежнее расхождение 09602.1/09603.1). */
const EIKON = {
  "21601.0": { code: "21601.0", price: 1.50, kind: "support", standard: "BOTH", moduleCount: 1, series: ["Eikon Evo", "Eikon Exe"] },
  "21602": { code: "21602", price: 2.00, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Eikon Evo", "Eikon Exe"] },
  "21603": { code: "21603", price: 2.10, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Eikon Evo", "Eikon Exe"] },
};
const EIKON_SUP = Object.values(EIKON);
const eikonIT = { code: "20653", standard: "IT_ROUND", slotCount: 2, series: ["Eikon Evo"] };
const eikonDE = { code: "20663", standard: "DE", slotCount: 2, series: ["Eikon Evo"] };
/* Neve Up с универсальными 602/603 — как в новой номенклатуре (раньше считались немецкими). */
const NEVE_UNIV = [
  { code: "09602.1", price: 2.58, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Neve Up"] },
  { code: "09603.1", price: 2.70, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Neve Up"] },
];

test("суппорт по коробке: V71001 → 602 (за щеками), та же серия", () => {
  const s = findSupport({ supports: EIKON_SUP, frame: eikonIT, standard: "IT_ROUND", frameModules: 2, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(s.code, "21602");
});
test("суппорт по коробке: V71701 → 603 (с винтами)", () => {
  const s = findSupport({ supports: EIKON_SUP, frame: eikonIT, standard: "IT_ROUND", frameModules: 2, box: BOX.V71701, seriesOf: p => p.series });
  assert.equal(s.code, "21603");
});
test("суппорт по коробке: немецкий стандарт → только 603, даже с круглой V71001", () => {
  const s = findSupport({ supports: EIKON_SUP, frame: eikonDE, standard: "DE", frameModules: 2, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(s.code, "21603");
});
test("суппорт по коробке: V71001 (→602), но в серии только 603 → null (не подставляем)", () => {
  const s = findSupport({ supports: [EIKON["21603"]], frame: eikonIT, standard: "IT_ROUND", frameModules: 2, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(s, null);
});
test("суппорт по коробке: 09602.1/09603.1 универсальны — стандарт суппорта не фильтрует", () => {
  const de = findSupport({ supports: NEVE_UNIV, frame: neveDE, standard: "DE", frameModules: 2, box: BOX.V71701, seriesOf: p => p.series });
  assert.equal(de.code, "09603.1");
  const it = findSupport({ supports: NEVE_UNIV, frame: { standard: "IT_ROUND", slotCount: 2, series: ["Neve Up"] }, standard: "IT_ROUND", frameModules: 2, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(it.code, "09602.1");
});

/* --- МОНТАЖНОЕ ПРАВИЛО НОМЕНКЛАТУРЫ («Принцип обработки» + «Модульность для коробки») ---
   «Центральная» накладка садится в коробку БОЛЬШЕЙ модульности, чем её собственная ёмкость:
   1М-накладка — в коробку на 2 модуля, 2М — на 3. Подбор по ёмкости накладки давал им не тот
   суппорт (а 09671 — вообще null), поэтому целью подбора стала модульность КОРОБКИ, а пара
   (принцип + модульность коробки) прямо связывает накладку с её выделенным суппортом.
   Фикстуры — реальные артикулы и реальные значения полей из номенклатуры. */
const NEVE_SUP = [
  { code: "09602.1", price: 2.58, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Neve Up"] },
  { code: "09603.1", price: 2.70, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Neve Up"] },
  { code: "09606", price: 3.10, kind: "support", standard: "IT", moduleCount: 2, series: ["Neve Up"], principle: "2M_CENTRAL", boxModularity: 3 },
  { code: "09613", price: 1.48, kind: "support", standard: "IT", moduleCount: 3, series: ["Neve Up"] },
];
/* Plana: 14507 («суппорт для НАКЛАДНОГО монтажа») стоит в каталоге раньше 14612 и по одной
   лишь модульности выигрывал подбор у 2М-накладок — держим его в пуле, чтобы правило пары
   проверялось против реального конкурента. */
const PLANA_SUP = [
  { code: "14507", price: 9.90, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Plana"] },
  { code: "14601", price: 1.80, kind: "support", standard: "BOTH", moduleCount: 1, series: ["Plana"], principle: "1M_CENTRAL", boxModularity: 2 },
  { code: "14602", price: 2.10, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Plana"] },
  { code: "14603", price: 2.35, kind: "support", standard: "BOTH", moduleCount: 2, series: ["Plana"] },
  { code: "14612", price: 2.90, kind: "support", standard: "IT", moduleCount: 2, series: ["Plana"], principle: "2M_CENTRAL", boxModularity: 3 },
  { code: "14613", price: 2.50, kind: "support", standard: "IT", moduleCount: 3, series: ["Plana"] },
];
/* Накладки с монтажным правилом — как их обогащает js/data.js из EP_VIMAR_ATTRS. */
const f09661 = { code: "09661.01", standard: "BOTH", slotCount: 1, series: ["Neve Up"], principle: "1M_CENTRAL", boxModularity: 2 };
const f09671 = { code: "09671.01", standard: "IT", slotCount: 1, series: ["Neve Up"], principle: "1M_CENTRAL_3", boxModularity: 3 };
const f09672 = { code: "09672.01", standard: "IT", slotCount: 2, series: ["Neve Up"], principle: "2M_CENTRAL", boxModularity: 3 };
const f14641 = { code: "14641.01", standard: "BOTH", slotCount: 1, series: ["Plana"], principle: "1M_CENTRAL", boxModularity: 2 };
const f14652 = { code: "14652.01", standard: "IT", slotCount: 2, series: ["Plana"], principle: "2M_CENTRAL", boxModularity: 3 };

test("09661 (1М центрально в коробку на 2): суппорт по коробке — 09602.1 solid / 09603.1 hollow, не null", () => {
  /* Ремарка номенклатуры: «монтируется только с супартом 09602.1 или 09603.1 в коробку на
     2 модуля». Своего 1М-суппорта в Neve Up нет, поэтому шаг «пара по принципу» обязан
     провалиться дальше — на правило «тип суппорта задаёт коробка». */
  const solid = findSupport({ supports: NEVE_SUP, frame: f09661, standard: "BOTH", frameModules: 1, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(solid.code, "09602.1");
  const hollow = findSupport({ supports: NEVE_SUP, frame: f09661, standard: "BOTH", frameModules: 1, box: BOX.V71701, seriesOf: p => p.series });
  assert.equal(hollow.code, "09603.1");
});
test("09672 (2М центрально в коробку на 3): выделенный суппорт 09606, а не обычный 2М", () => {
  /* Ремарка: «монтируется в коробку на 3 модуля с супортом 09606». По одной модульности
     09606 неотличим от 09602.1 (оба 2М) — различает их только пара «принцип + коробка». */
  const s = findSupport({ supports: NEVE_SUP, frame: f09672, standard: "IT", frameModules: 2, box: BOX.V71303, seriesOf: p => p.series });
  assert.equal(s.code, "09606");
});
test("09671 (1М центрально в коробку на 3): суппорт на 3 модуля 09613 вместо прежнего null", () => {
  /* Ремарка называет только типоразмер («коробка и супорт на 3 модуля»), артикул не указан.
     Выделенного суппорта с таким принципом в серии нет — подбор идёт по МОДУЛЬНОСТИ КОРОБКИ
     (3), а не накладки (1); по ёмкости накладки 1М-суппорта в Neve Up не существует, и здесь
     раньше был честный, но пустой ответ. */
  const s = findSupport({ supports: NEVE_SUP, frame: f09671, standard: "IT", frameModules: 1, box: BOX.V71303, seriesOf: p => p.series });
  assert.equal(s.code, "09613");
});
test("14652 (Plana): пара по принципу побеждает накладной 14507 там, где правило заказчика молчит", () => {
  /* 14507 — суппорт для НАКЛАДНОГО монтажа, но той же модульности: по прежнему правилу он
     выигрывал подбор у всех 2М-накладок Plana и попадал в смету вместо 14612. Итальянская
     прямоугольная коробка типа суппорта не задаёт (у неё нет 71001/71701), поэтому здесь
     решает монтажное правило номенклатуры. */
  const s2 = findSupport({ supports: PLANA_SUP, frame: f14652, standard: "IT", frameModules: 2, box: BOX.V71303, seriesOf: p => p.series });
  assert.equal(s2.code, "14612");
});
test("14641: выделенная пара 14601 СИЛЬНЕЕ общего правила «602/603 по коробке»", () => {
  /* Ремарка номенклатуры к 14641.01 — прямой запрет: «монтируется в коробку на 2 модуля и
     ТОЛЬКО с супортом 14601» (у 19641.01 — то же про 19601). Пара названа заказчиком поимённо
     для этой накладки, а «602/603 задаёт коробка» — общее правило про накладки вообще; при
     обратном порядке 87 накладок (14641.* — 37, 19641.* — 38, 22672.1.* и 22682.1.* — 12)
     получали 14602/14603 (19602/19603, 21602/21603), то есть планку, ремаркой ЗАПРЕЩЁННУЮ.
     Тип стены пару не переключает: её задаёт модульность КОРОБКИ (у 14601 «Модульность для
     коробки = 2»), поэтому 14601 выигрывает и на 71001, и на 71701. */
  assert.ok(PLANA_SUP.some(s => s.code === "14601"), "14601 обязан лежать в пуле — иначе тест ничего не доказывает");
  assert.ok(PLANA_SUP.some(s => s.code === "14602") && PLANA_SUP.some(s => s.code === "14603"),
    "конкуренты по правилу 602/603 тоже в пуле — пара побеждает их, а не пустоту");
  const solid = findSupport({ supports: PLANA_SUP, frame: f14641, standard: "BOTH", frameModules: 1, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(solid.code, "14601", "сплошная стена (коробка 71001) → названный ремаркой 14601, а не 14602");
  const hollow = findSupport({ supports: PLANA_SUP, frame: f14641, standard: "BOTH", frameModules: 1, box: BOX.V71701, seriesOf: p => p.series });
  assert.equal(hollow.code, "14601", "полая стена (коробка 71701) → тот же 14601, а не 14603");
  const r = resolveSupport({ supports: PLANA_SUP, frame: f14641, standard: "BOTH", frameModules: 1, box: BOX.V71701, seriesOf: p => p.series });
  assert.equal(r.assumed, false, "артикул назван заказчиком дословно — пометки «предположительно» быть не должно");
});
test("09661: пары в каталоге нет — правило «602/603 по коробке» остаётся в силе", () => {
  /* Парный случай к 14641: перестановка шагов не смеет отобрать суппорт у накладок, чью пару
     заказчик НЕ разметил. У 09661.* принцип есть (1M_CENTRAL, коробка на 2), но ни один суппорт
     Neve Up его не несёт — ремарка и не называет один артикул, она даёт ДВА варианта («только
     с супартом 09602.1 или 09603.1»), и выбирает между ними именно тип коробки. */
  assert.ok(!NEVE_SUP.some(s => s.principle === f09661.principle && s.boxModularity === f09661.boxModularity),
    "в пуле не должно быть суппорта Neve Up с принципом 1M_CENTRAL — иначе проверяем не тот случай");
  const solid = findSupport({ supports: NEVE_SUP, frame: f09661, standard: "BOTH", frameModules: 1, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(solid.code, "09602.1", "коробка 71001 (сплошная стена) → суппорт «за щеками»");
  const hollow = findSupport({ supports: NEVE_SUP, frame: f09661, standard: "BOTH", frameModules: 1, box: BOX.V71701, seriesOf: p => p.series });
  assert.equal(hollow.code, "09603.1", "коробка 71701 (ГКЛ) → суппорт «с винтами»");
});
test("РЕГРЕСС: обычная накладка без монтажного правила подбирает суппорт как раньше", () => {
  /* Правило есть у 287 позиций каталога (280 накладок + 7 суппортов) — остальные 1351 накладка
     не должна заметить правку ни на йоту. Центральный суппорт к ним не липнет: у накладки нет
     ни принципа, ни модульности коробки, поэтому шаг «пара» пропускается целиком. */
  assert.equal(findSupport({ supports: NEVE_SUP, frame: neve3, standard: "IT", frameModules: 3, box: BOX.V71303, seriesOf: p => p.series }).code, "09613");
  const plana2 = { code: "14653.01", standard: "IT", slotCount: 2, series: ["Plana"] };
  assert.equal(findSupport({ supports: PLANA_SUP, frame: plana2, standard: "IT", frameModules: 2, box: BOX.V71303, seriesOf: p => p.series }).code, "14507",
    "выбор 2М-суппорта у обычной итальянской накладки прежний (отдельный дефект 14507 — не этой правки)");
});
test("findBox: коробка центральной накладки — по модульности КОРОБКИ, а не ёмкости накладки", () => {
  /* На нынешнем каталоге обе величины ведут к одной коробке (мельче 2М круглых и мельче 3М
     прямоугольных в VIMAR нет), поэтому правило проверяем с 1М-коробкой в пуле: по ёмкости
     накладки (1 модуль) она бы и выиграла как «наименьшая вмещающая». */
  const BOX_1M = { code: "V71301", price: 0.50, kind: "socket_box", wallType: "solid", boxShape: "rect", boxModules: 1, boxStandards: ["IT"] };
  const box = findBox({ boxes: [BOX_1M, ...ALL_BOXES], frame: f09671, standard: "IT", frameModules: 1, wantedWall: "solid" });
  assert.equal(box.code, "V71303", "коробка на 3 модуля, как написано в номенклатуре");
});

/* --- resolveSupport: подтверждённая пара против подобранной нами ---------------------
   Решение владельца: артикул подставляем всегда, когда можем, но там, где заказчик его не
   называл, документы обязаны написать «(предположительно)». Подтверждёнными считаем три
   исхода каскада: правило заказчика 602/603 по коробке, прямая пара из номенклатуры
   (принцип + модульность коробки) и общий подбор у накладки БЕЗ монтажного правила.
   Неподтверждённый — только четвёртый: монтажное правило у накладки ЕСТЬ, планки под него
   в каталоге нет, и она выбрана общим правилом (09671.*, 22673.1.*, 09679.* — 36 из 1631). */
test("resolveSupport 09671: артикул подставлен, но помечен как неподтверждённый", () => {
  /* Ремарка номенклатуры называет только типоразмер («коробка и супорт на 3 модуля»).
     Суппорта с принципом 1M_CENTRAL_3 в каталоге нет — 09613 наш кандидат, не заказчика
     (вопрос отправлен 26.08, docs/письмо-заказчику-вопросы-2026-08-26.txt §1). */
  const r = resolveSupport({ supports: NEVE_SUP, frame: f09671, standard: "IT", frameModules: 1, box: BOX.V71303, seriesOf: p => p.series });
  assert.equal(r.support.code, "09613", "артикул в расчёте есть — иначе поста не собрать");
  assert.equal(r.assumed, true, "но он подобран нами, а не назван заказчиком");
});
test("resolveSupport 09661: правило заказчика по коробке — подтверждено, пометки быть не должно", () => {
  /* Ремарка даёт два варианта («09602.1 или 09603.1»), выделенной пары у 09661.* нет —
     решает правило «602/603 задаёт коробка». Это тоже слова заказчика, а не наша догадка. */
  const solid = resolveSupport({ supports: NEVE_SUP, frame: f09661, standard: "BOTH", frameModules: 1, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(solid.support.code, "09602.1");
  assert.equal(solid.assumed, false, "правило заказчика «602/603 по коробке» — подтверждённый источник");
  const hollow = resolveSupport({ supports: NEVE_SUP, frame: f09661, standard: "BOTH", frameModules: 1, box: BOX.V71701, seriesOf: p => p.series });
  assert.equal(hollow.support.code, "09603.1");
  assert.equal(hollow.assumed, false);
});
test("resolveSupport 09672: прямая пара по монтажному правилу — тоже подтверждена", () => {
  const r = resolveSupport({ supports: NEVE_SUP, frame: f09672, standard: "IT", frameModules: 2, box: BOX.V71303, seriesOf: p => p.series });
  assert.equal(r.support.code, "09606");
  assert.equal(r.assumed, false, "артикул назван в номенклатуре — «с супортом 09606»");
});
test("resolveSupport: обычная итальянская накладка — без флага", () => {
  /* 1351 накладка из 1631 монтажного правила не несёт вовсе: подбор по модульности — штатный
     случай, которым каталог жил всегда. Пометка у них обесценила бы пометку у остальных. */
  const r = resolveSupport({ supports: NEVE_SUP, frame: neve3, standard: "IT", frameModules: 3, box: BOX.V71303, seriesOf: p => p.series });
  assert.equal(r.support.code, "09613");
  assert.equal(r.assumed, false);
});
test("resolveSupport: суппорт не подобран — assumed=false (помечать нечего)", () => {
  const noFit = { code: "16743", standard: "IT", slotCount: 3, series: ["Idea"], principle: "1M_CENTRAL_3", boxModularity: 9 };
  const r = resolveSupport({ supports: NEVE_SUP, frame: noFit, standard: "IT", frameModules: 3, box: BOX.V71303, seriesOf: p => p.series });
  assert.equal(r.support, null, "чужую серию не подставляем");
  assert.equal(r.assumed, false);
});
test("findSupport остаётся прежним интерфейсом (обёртка над resolveSupport)", () => {
  const opts = { supports: NEVE_SUP, frame: f09671, standard: "IT", frameModules: 1, box: BOX.V71303, seriesOf: p => p.series };
  assert.equal(findSupport(opts), resolveSupport(opts).support, "вызывающие без признака работают как раньше");
});

/* --- NO_SUPPORT: суппорт не требуется, а не «не подобран» ---
   Крышки IP55 (14931–14944, принцип «NO_SUPPORT, AQUAPLATE») монтируются прямо в коробку.
   Раньше признак не читался и им подбиралась планка «как всем» — лишняя позиция в смете. */
const f14931 = { code: "14931.01", standard: "BOTH", slotCount: 2, series: ["Plana"], principle: "NO_SUPPORT, AQUAPLATE" };
test("NO_SUPPORT: supportRequired=false — изделие монтируется без планки", () => {
  assert.equal(supportRequired(f14931), false, "составной принцип разбирается по токенам");
  assert.equal(supportRequired(f14652), true);
  assert.equal(supportRequired(neve3), true, "нет принципа — суппорт нужен, как раньше");
});
test("NO_SUPPORT: суппорт не подбирается, хотя подходящий по модульности в серии есть", () => {
  const s = findSupport({ supports: PLANA_SUP, frame: f14931, standard: "BOTH", frameModules: 2, box: BOX.V71001, seriesOf: p => p.series });
  assert.equal(s, null, "без признака сюда попадал 14602 — планка, которой в поставке нет");
});

/* --- socketBox: универсальный фолбэк по умолчанию --- */
test("socketBox — самая дешёвая круглая коробка (универсальный подрозетник)", () => {
  assert.equal(socketBox(ALL_BOXES).code, "V71001");
});
test("socketBox без круглых — самая дешёвая любая", () => {
  assert.equal(socketBox([BOX.V71703, BOX.V71303]).code, "V71303");
  assert.equal(socketBox([]), undefined);
});
