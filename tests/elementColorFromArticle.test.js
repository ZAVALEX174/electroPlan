/* Вывод «Цвета элемента» механизма ИЗ АРТИКУЛА (К12 ч.3 раунд 3, tools/lib/elementColorFromArticle.mjs):
   словарь учится по сериям — базовый цвет серии из «голых» артикулов и цветовой суффикс, чей цвет
   ОТЛИЧАЕТСЯ от базового (так символьный .C/.L/.P не считается цветом). Приоритет источников —
   столбец > название > артикул — проверяется через buildAttrs (там живёт порядок). Плюс факт на
   собранном каталоге (20066/20021.C). Мутации (сломай порог / сломай «название главнее артикула») —
   ниже, с пометкой [МУТАЦИЯ]. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const EPMechColor = require("../js/mechColor.js");
const EPCatalog = require("../js/catalog.js");

const ROOT = path.join(__dirname, "..");
let A, N;
test.before(async () => {
  A = await import(pathToFileURL(path.join(ROOT, "tools", "lib", "elementColorFromArticle.mjs")).href);
  N = await import(pathToFileURL(path.join(ROOT, "tools", "lib", "nomenclature.mjs")).href);
});

// Запись: минимум полей, которые читает модуль (code, series, color). color пуст — цвет неизвестен.
const rec = (code, color) => ({ code, series: ["Eikon"], color: color ?? null });
const q = (code, series) => ({ code, series });

/* Эталонный набор Eikon, повторяющий форму реальных данных: «голые» базы серые (Чёрный), суффикс
   .B — белый, .N — серебро; символьный .C несёт БАЗОВЫЙ цвет (Чёрный) и имеет свой цветной сосед
   .C.N. Плюс колерные соседи, чьи code нужны словарю для поиска «баз» (их цвет может быть пуст). */
function eikonLearned() {
  return [
    rec("100", "Чёрный"), rec("101", "Чёрный"), rec("102", "Чёрный"),   // голые базы → Чёрный
    rec("100.B", "Белый"), rec("101.B", "Белый"), rec("102.B", "Белый"), // .B → Белый
    rec("100.N", "Серебристый"), rec("101.N", "Серебристый"),            // .N → Серебристый
    rec("100.C", "Чёрный"), rec("101.C", "Чёрный"),                      // символ .C — цвет БАЗЫ (Чёрный)
    rec("300.C", null), rec("300.C.N", null),                            // символьный артикул с цветным соседом
  ];
}

test("Eikon: «голая» база → Чёрный; .B → Белый; .N → Серебристый", () => {
  const d = A.buildArticleColorDictionary(eikonLearned());
  assert.equal(A.deriveColorFromArticle(q("100", ["Eikon"]), d), "Чёрный");   // база (есть сосед 100.B)
  assert.equal(A.deriveColorFromArticle(q("102", ["Eikon"]), d), "Чёрный");
  assert.equal(A.deriveColorFromArticle(q("100.B", ["Eikon"]), d), "Белый");  // цветовой суффикс
  assert.equal(A.deriveColorFromArticle(q("100.N", ["Eikon"]), d), "Серебристый");
});

test("символьный суффикс (.C) НЕ цветовой: его цвет = цвет базы, через правило базы", () => {
  const d = A.buildArticleColorDictionary(eikonLearned());
  // .C собрал 100% Чёрный, но Чёрный = базовый цвет серии → цветовым суффиксом НЕ становится
  assert.equal(d.get("eikon").colorSuffixes.has("C"), false);
  // 300.C — символьный артикул с цветным соседом 300.C.N: цвет берётся ПРАВИЛОМ БАЗЫ (Чёрный),
  // а не как «цвет суффикса .C» (его нет). Это и есть 20021.C → Чёрный на реальных данных.
  assert.equal(A.deriveColorFromArticle(q("300.C", ["Eikon"]), d), "Чёрный");
  // одиночный символьный артикул БЕЗ цветного соседа — ни суффикса, ни базы → ничего
  assert.equal(A.deriveColorFromArticle(q("999.C", ["Eikon"]), d), null);
});

test("Arke: .M → Металлик (цвет ≠ базовый Чёрный)", () => {
  const arke = [
    rec2("A1", ["Arke"], "Чёрный"), rec2("A2", ["Arke"], "Чёрный"),       // база Чёрный
    rec2("A1.M", ["Arke"], "Металлик"), rec2("A2.M", ["Arke"], "Металлик"), // .M → Металлик
    rec2("A1.B", ["Arke"], "Белый"), rec2("A2.B", ["Arke"], "Белый"),      // .B → Белый
  ];
  const d = A.buildArticleColorDictionary(arke);
  assert.equal(A.deriveColorFromArticle(q("A1.M", ["Arke"]), d), "Металлик");
  assert.equal(A.deriveColorFromArticle(q("A1", ["Arke"]), d), "Чёрный");
});

test("Plana: база → Белый", () => {
  const plana = [
    rec2("P1", ["Plana"], "Белый"), rec2("P2", ["Plana"], "Белый"),         // база Белый
    rec2("P1.SL", ["Plana"], "Серебристый"), rec2("P2.SL", ["Plana"], "Серебристый"), // .SL → Серебро
  ];
  const d = A.buildArticleColorDictionary(plana);
  assert.equal(A.deriveColorFromArticle(q("P1", ["Plana"]), d), "Белый");    // база (сосед P1.SL)
  assert.equal(A.deriveColorFromArticle(q("P1.SL", ["Plana"]), d), "Серебристый");
});

test("серия без данных (Linea) → ничего", () => {
  const d = A.buildArticleColorDictionary(eikonLearned());
  assert.equal(A.deriveColorFromArticle(q("14001", ["Linea"]), d), null);
  // мультисерийный ключ не совпадает с одиночным «Eikon»
  assert.equal(A.deriveColorFromArticle(q("100", ["Plana", "Arke", "Eikon"]), d), null);
});

test("одиночная шумная строка не перебивает цветовой суффикс (4/5 = 80% >= порога)", () => {
  const noisy = [
    rec2("Z1", ["Neve Up"], "Белый"), rec2("Z2", ["Neve Up"], "Белый"),     // база Белый
    rec2("Z1.CM", ["Neve Up"], "Чёрный"), rec2("Z2.CM", ["Neve Up"], "Чёрный"),
    rec2("Z3.CM", ["Neve Up"], "Чёрный"), rec2("Z4.CM", ["Neve Up"], "Чёрный"),
    rec2("Z5.CM", ["Neve Up"], "Белый"),  // одна шумная из пяти .CM
  ];
  const d = A.buildArticleColorDictionary(noisy);
  // .CM: 4 Чёрный + 1 Белый = 80% >= 0.8 → закрепляется Чёрный (≠ базовый Белый), шум не победил
  assert.equal(A.deriveColorFromArticle(q("Z9.CM", ["Neve Up"]), d), "Чёрный");
});

test("[МУТАЦИЯ порога] две шумные из пяти (60% < 80%) НЕ закрепляются", () => {
  const noisy = [
    rec2("Z1", ["Neve Up"], "Белый"), rec2("Z2", ["Neve Up"], "Белый"),
    rec2("Z1.CM", ["Neve Up"], "Чёрный"), rec2("Z2.CM", ["Neve Up"], "Чёрный"),
    rec2("Z3.CM", ["Neve Up"], "Чёрный"), rec2("Z4.CM", ["Neve Up"], "Серебристый"),
    rec2("Z5.CM", ["Neve Up"], "Металлик"),  // .CM: 3 Чёрный из 5 = 60%
  ];
  const d = A.buildArticleColorDictionary(noisy);
  // 3/5 = 60% < 0.8 → .CM неоднозначен, цветовым суффиксом не становится. Опустить порог <= 0.6 в
  // коде (ослабить защиту от шума) — тест покраснеет: вернётся «Чёрный».
  assert.equal(A.deriveColorFromArticle(q("Z9.CM", ["Neve Up"]), d), null);
});

// --- Приоритет источников (живёт в buildAttrs: название главнее артикула) --------------------
// Синтетический набор одной серии: «голые» базы Чёрный (цвет из АРТИКУЛА), и целевой артикул TGT
// без столбца, но с «белая» в названии (цвет из НАЗВАНИЯ) и соседом TGT.N (значит TGT — база, по
// артикулу был бы Чёрный). Ожидаем Белый: название перебивает артикул.
function mech(code, name, color, partRole) {
  return { code, name, color: color ?? null, series: ["Testser"], kind: "mechanism", partRole: partRole || "key" };
}
function prioritySet() {
  return [
    mech("B1", "выключатель один", "Чёрный"), mech("B2", "выключатель два", "Чёрный"),
    mech("B1.N", "выключатель один", "Серебристый"), mech("B2.N", "выключатель два", "Серебристый"),
    mech("WX.B", "клавиша белая один", "Белый"), mech("WY.B", "клавиша белая два", "Белый"),
    mech("TGT", "клавиша белая ручная", null),          // нет столбца; название → Белый
    mech("TGT.N", "устройство", "Серебристый"),          // делает TGT «базой» (есть сосед .N)
  ];
}

test("столбец ПОБЕЖДАЕТ артикул (столбец едет в colors; articleColors/nameColors его не трогают)", () => {
  // «100» несёт столбец Чёрный; по артикулу он тоже был бы Чёрный, но проверяем именно развязку:
  // столбец идёт в colors, в nameColors/articleColors ключа нет (столбец читают смета/«в цвет накладки»).
  const recs = [
    mech("100", "выключатель", "Чёрный"), mech("100.B", "выключатель", "Белый"),
    mech("101", "выключатель", "Чёрный"), mech("101.B", "выключатель", "Белый"),
  ];
  const { colors, nameColors, articleColors } = N.buildAttrs(recs);
  assert.equal(colors["100"], "Чёрный");
  assert.equal(nameColors["100"], undefined);
  assert.equal(articleColors["100"], undefined);
});

test("название ПОБЕЖДАЕТ артикул (TGT: название «белая» → nameColors Белый, в articleColors его НЕТ)", () => {
  const { nameColors, articleColors } = N.buildAttrs(prioritySet());
  // Цвет из названия идёт в nameColors; артикул для той же позиции НЕ вычисляется (иначе Чёрный из
  // артикула мог бы перебить Белый в colorOf). [МУТАЦИЯ приоритета] если в buildAttrs поменять ветки
  // местами (сначала артикул, он кладёт в articleColors и пропускает название) — покраснеет: TGT
  // получит articleColors Чёрный, а nameColors["TGT"] станет undefined.
  assert.equal(nameColors["TGT"], "Белый");
  assert.equal(articleColors["TGT"], undefined);
});

test("факт на собранном каталоге: серые по артикулу → articleColors; colors и nameColors не тронуты", () => {
  const win = {};
  new Function("window", fs.readFileSync(path.join(ROOT, "js", "catalog-vimar-attrs.js"), "utf8"))(win);
  const { colors, nameColors, articleColors } = win.EP_VIMAR_ATTRS;
  // Серые по артикулу (ни столбца, ни названия): 20066 — база Eikon, 20021.C/20022.C — базы семейства
  // (есть сосед .C.N). Получают цвет ИЗ АРТИКУЛА → раздел articleColors, и выпадут из белой комнаты.
  assert.equal(articleColors["20066"], "Чёрный");
  assert.equal(articleColors["20021.C"], "Чёрный");
  assert.equal(articleColors["20022.C"], "Чёрный");
  // Цвет из АРТИКУЛА в colors (смета) и в nameColors НЕ попадает (решение владельца «смета как HEAD»,
  // раздельные источники). 20066.B/.N несут цвет из НАЗВАНИЯ («белый»/«серебро») → они в nameColors.
  assert.equal(colors["20066"], undefined);
  assert.equal(nameColors["20066"], undefined);
  assert.equal(articleColors["20066.B"], undefined);
  assert.equal(nameColors["20066.B"], "Белый");
  // Голые механизмы за клавишей (видны в белой комнате всегда) цвет из артикула НЕ получают.
  assert.equal(articleColors["20001.0"], undefined);
  assert.equal(articleColors["20013.0"], undefined);
});

/* DoD там, где смотрит владелец: окно поста комнаты Eikon Evo, фильтр «Только механизмы цвета
   «Белый»». Собираем механизмы ровно как рантайм (js/data.js): elementColor из colors, nameColor из
   nameColors, articleColor из articleColors; окно поста видит их через EPMechColor.colorOf. */
function loadRealMechanisms() {
  const win = {};
  ["catalog-vimar.js", "catalog-vimar-attrs.js"].forEach((f) =>
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), { window: win }));
  const { colors, nameColors, articleColors } = win.EP_VIMAR_ATTRS;
  return win.EP_VIMAR_CATALOG.products
    .filter((p) => p.kind === "mechanism" && p.active !== false)
    .map((p) => {
      const o = { ...p };
      if (colors[p.code]) o.elementColor = colors[p.code];
      if (nameColors[p.code]) o.nameColor = nameColors[p.code];
      if (articleColors[p.code]) o.articleColor = articleColors[p.code];
      return o;
    });
}

test("DoD: белая комната Eikon Evo — серые по артикулу (20066, 20021.C/L/P, 20022.C/L/P) отсеяны, 20066.B есть, голые видны", () => {
  const mechs = loadRealMechanisms();
  const FDEPS = { colorOf: EPMechColor.colorOf, keyOf: EPCatalog.facingColorKey };
  const pool = EPCatalog.compatibleMechanisms({ series: ["Eikon Evo"] }, mechs);
  const shown = EPMechColor.filter(pool, "Белый", FDEPS);
  const has = (c) => shown.some((m) => m.code === c);
  // Серые по артикулу (Чёрный) при выбранном Белом — ОТСЕЯНЫ (это и есть починка дефекта)
  ["20066", "20021.C", "20021.L", "20021.P", "20022.C", "20022.L", "20022.P", "20026"].forEach((c) =>
    assert.ok(!has(c), c + " (серый по артикулу) отсеян при Белом"));
  // Белый .B — остаётся (цвет из названия Белый); голые механизмы за клавишей — видны всегда (бесцветны)
  assert.ok(has("20066.B"), "20066.B (белый) остаётся");
  ["20001.0", "20005.0", "20008.0", "20013.0"].forEach((c) =>
    assert.ok(has(c), c + " (голый механизм) виден в белой комнате"));
});

// Запись для чистых тестов с произвольной серией (eikonLearned фиксирует «Eikon»).
function rec2(code, series, color) { return { code, series, color: color ?? null }; }
