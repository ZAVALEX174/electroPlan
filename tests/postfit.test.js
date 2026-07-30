/* Автотесты подбора коробки и суппорта (EPPostFit) на фикстурах реальных артикулов
   VIMAR (PLAN 7.1). Модуль чистый: каталог приходит массивами, браузер не нужен.
   Главное, что проверяем — требование владельца: подобранное/фолбэк изделие НИКОГДА
   не противоречит монтажному стандарту накладки, а при отсутствии совместимого —
   честный null, а не подмена ценой чужого изделия. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { findBox, fallbackBox, findSupport, socketBox, boxFitsStandard } = require("../js/postfit.js");

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

/* --- socketBox: универсальный фолбэк по умолчанию --- */
test("socketBox — самая дешёвая круглая коробка (универсальный подрозетник)", () => {
  assert.equal(socketBox(ALL_BOXES).code, "V71001");
});
test("socketBox без круглых — самая дешёвая любая", () => {
  assert.equal(socketBox([BOX.V71703, BOX.V71303]).code, "V71303");
  assert.equal(socketBox([]), undefined);
});
