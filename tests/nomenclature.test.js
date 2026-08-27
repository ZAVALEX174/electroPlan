"use strict";
/* Тесты классификации номенклатуры VIMAR и сведения цен с прайсом (tools/lib/nomenclature.mjs).
   Модуль — ESM (.mjs), подключаем через динамический import в before(); чистые функции
   файлов не читают, поэтому тесты детерминированы и не зависят от .xls.
   Исключение — блок readNomenclature внизу: он собирает СВОЙ мини-файл во временной папке
   (номенклатура заказчика лежит вне репозитория, привязываться к ней нельзя). */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const XLSX = require("xlsx");

let N;
before(async () => {
  N = await import(pathToFileURL(path.join(__dirname, "../tools/lib/nomenclature.mjs")).href);
});

test("kindOf: функциональная группа → тип товара", () => {
  assert.equal(N.kindOf("Монтажные коробки"), "socket_box");
  assert.equal(N.kindOf("Суппорты"), "support");
  assert.equal(N.kindOf("Декоративные накладки"), "frame");
  assert.equal(N.kindOf("управление светом"), "mechanism");
  assert.equal(N.kindOf("Розетки"), "mechanism");
  assert.equal(N.kindOf("отели"), "mechanism");      // регистр в файле разный
  assert.equal(N.kindOf("Отели"), "mechanism");
  assert.equal(N.kindOf(""), "mechanism");           // пусто → устройство по умолчанию
});

test("standardOf: монтажный стандарт", () => {
  assert.equal(N.standardOf("Итальянский"), "IT");
  assert.equal(N.standardOf("Немецкий"), "DE");
  assert.equal(N.standardOf("Итальянский, Немецкий"), "BOTH");
  assert.equal(N.standardOf(""), "UNKNOWN");
});

test("wallTypeOf: тип стены (оба → universal/unknown)", () => {
  assert.equal(N.wallTypeOf("Кирпич"), "solid");
  assert.equal(N.wallTypeOf("ГКЛ"), "hollow");
  assert.equal(N.wallTypeOf("ГКЛ, Кирпич"), "unknown");   // подходит к любой стене
  assert.equal(N.wallTypeOf(""), "unknown");
});

test("moduleCountOf: размер в модулях (число и диапазон-строка)", () => {
  assert.equal(N.moduleCountOf(3), 3);
  assert.equal(N.moduleCountOf(7), 7);
  assert.equal(N.moduleCountOf("1, 2"), 2);   // круглая коробка «для 1-2 модулей» → до 2
  assert.equal(N.moduleCountOf(null), null);
  assert.equal(N.moduleCountOf(""), null);
});

test("boxShapeOf / boxStandardsOf: форма и совместимые стандарты коробки", () => {
  assert.equal(N.boxShapeOf("Коробка встраиваемая круглая для 1-2 модулей"), "round");
  assert.equal(N.boxShapeOf("Коробка встраиваемая прямоугольная для 3 модулей"), "rect");
  assert.equal(N.boxShapeOf("Коробка встраиваемая для 8 модулей"), "rect");  // без слова формы → прямоугольная (IT)
  assert.deepEqual(N.boxStandardsOf("round"), ["IT_ROUND", "DE", "FR"]);
  assert.deepEqual(N.boxStandardsOf("rect"), ["IT"]);
});

test("seriesListOf: список серий → массив с показным регистром", () => {
  assert.deepEqual(N.seriesListOf("NEVE UP"), ["Neve Up"]);
  assert.deepEqual(N.seriesListOf("EIKON EVO, EIKON EXE"), ["Eikon Evo", "Eikon Exe"]);
  assert.deepEqual(N.seriesListOf("ARKE FIT"), ["Arke Fit"]);
  assert.deepEqual(N.seriesListOf(""), []);   // коробки без серии
});

test("categoryAndIcon: фикс для рамки/суппорта/коробки, classify для механизма", () => {
  assert.deepEqual(N.categoryAndIcon("frame", "Накладка на 2 модуля, белая"), { categoryId: 100, icon: "□" });
  assert.deepEqual(N.categoryAndIcon("support", "Суппорт для 2 модулей 71мм"), { categoryId: 200, icon: "≡" });
  assert.deepEqual(N.categoryAndIcon("socket_box", "Коробка круглая"), { categoryId: 200, icon: "○" });
  // механизм: категория для группировки выпадающего списка (не 100/200)
  const sw = N.categoryAndIcon("mechanism", "Выключатель 1П 16AX 1 модуль, белый");
  assert.equal(sw.categoryId, 500);
  const socket = N.categoryAndIcon("mechanism", "Розетка 2P+T 16A немецкий стандарт, белая");
  assert.equal(socket.categoryId, 300);
});

test("controlRoleOf: «Тип управления» → роль управления словарём ROLES", () => {
  /* Строки-коды выбраны не произвольно: switch/changeover/button/inverter — ровно те,
     которыми оперирует ROLES в js/lightingGroups.js, чтобы подбор механизма по роли места
     сравнивал их напрямую. Регистр и пробелы в файле разные — нормализуем. */
  assert.equal(N.controlRoleOf("В"), "switch");
  assert.equal(N.controlRoleOf("П"), "changeover");
  assert.equal(N.controlRoleOf("Кн"), "button");
  assert.equal(N.controlRoleOf("И"), "inverter");
  assert.equal(N.controlRoleOf("Д"), "sensor");
  assert.equal(N.controlRoleOf("Bluetooth"), "bluetooth");
  assert.equal(N.controlRoleOf(" кн "), "button");     // пробелы и регистр не мешают
  assert.equal(N.controlRoleOf(""), null);             // пусто — признака нет
  assert.equal(N.controlRoleOf("Ж"), null);            // неизвестный код не выдумываем
});

test("partRoleOf: голый механизм — по группе «Механизмы» + типу управления", () => {
  /* Признак «нужна отдельная клавиша» берём из ДАННЫХ, а не из отсутствия moduleSpan:
     незаполненная модульность — побочный эффект, а не утверждение о конструкции. */
  const bare = (controlRole, name) => N.partRoleOf({ group: "Механизмы", controlRole, name });
  assert.equal(bare("switch", "Механизм-выключатель 1P 16AX серый"), "bare_mechanism");
  assert.equal(bare("changeover", "Механизм-переключатель 1P 16AX серый"), "bare_mechanism");
  assert.equal(bare("button", "Механизм-кнопка 1P NO 10A серый"), "bare_mechanism");
  assert.equal(bare("inverter", "Механизм переключателя с 4-мя контактами ( инвертор )"), "bare_mechanism");
  // «Механизмы» + не тот тип управления — НЕ голый механизм: в группе лежит 03925
  // «2 кнопки Bluetooth» на пять серий сразу и готовые изделия Eikon Tactil с пустым типом.
  assert.equal(bare("bluetooth", "2 кнопки управления Bluetooth Low Energy"), null);
  assert.equal(bare(null, "Регулятор MASTER 230V универсальный"), null);
  // тот же тип управления в ДРУГОЙ группе — готовое изделие с клавишей, не голый механизм
  assert.equal(N.partRoleOf({ group: "управление светом", controlRole: "switch", name: "Выключатель 1П 16AX 1 модуль" }), null);
  assert.equal(N.partRoleOf({ group: "управление светом", controlRole: "inverter", name: "Переключатель с 4-мя контактами ( инвертор ) 1П 16AX, белый" }), null);
});

test("partRoleOf: клавиша — по ПЕРВОМУ слову названия, а не по «клавиш» где угодно", () => {
  /* Прежний косвенный признак (categoryId=900 от classify()) ловил слово «клавиш» в любом
     месте строки — вместе с «накладк», «крышк», «винт». Здесь проверка якорная. */
  assert.equal(N.partRoleOf({ group: "управление светом", name: "Клавиша на 1 модуль серая" }), "key");
  assert.equal(N.partRoleOf({ group: "отели", name: 'Клавиша 1M С символом "DND", белая' }), "key");
  // радиочастотная клавиша несёт «Тип управления» = Bluetooth, но остаётся клавишей;
  // отличает её именно поле control, а не отсутствие роли
  assert.equal(N.partRoleOf({ group: "управление светом", controlRole: "bluetooth", name: "Клавиша для устройсв на радиочастоте на 2 модуля, белая" }), "key");
  // «клавиш» не первым словом или не тем словом — не клавиша
  assert.equal(N.partRoleOf({ group: "управление светом", name: "Накладка с подсветкой клавиш" }), null);
  assert.equal(N.partRoleOf({ group: "управление светом", name: "Крышка защитная" }), null);
  assert.equal(N.partRoleOf({ group: "управление светом", name: "Клавишный выключатель" }), null);
  // \b в JS по кириллице не работает (\w — только латиница), поэтому «конец слова» проверяем
  // явным «дальше не буква»: якорь обязан держаться и на этом
  assert.equal(N.partRoleOf({ group: "управление светом", name: "Клавиши 2 шт." }), null);
  assert.equal(N.partRoleOf({ group: "", name: "" }), null);
  assert.equal(N.partRoleOf(), null);
});

test("buildAttrs: роль детали и роль управления едут в рантайм разделом roles", () => {
  /* Ключ — артикул, запись {part, control}. Два поля, а не один составной код: рантайм
     спрашивает их порознь (клавиша/механизм решает раскладку поста, роль управления
     сравнивается со строкой ROLES напрямую). */
  const rec = (code, partRole, controlRole) => ({ code, kind: "mechanism", partRole, controlRole });
  const a = N.buildAttrs([
    rec("20001.0", "bare_mechanism", "switch"),
    rec("20005.0", "bare_mechanism", "changeover"),
    rec("20008.0", "bare_mechanism", "button"),
    rec("20013.0", "bare_mechanism", "inverter"),
    rec("20021", "key", null),
    rec("09013", null, "inverter"),     // готовое изделие-инвертор: роль управления есть, детали нет
    rec("14653.01", null, null),        // ни того, ни другого — ключа быть не должно
  ]);
  assert.deepEqual(a.roles["20001.0"], { part: "bare_mechanism", control: "switch" });
  assert.deepEqual(a.roles["20005.0"], { part: "bare_mechanism", control: "changeover" });
  assert.deepEqual(a.roles["20008.0"], { part: "bare_mechanism", control: "button" });
  assert.deepEqual(a.roles["20013.0"], { part: "bare_mechanism", control: "inverter" });
  assert.deepEqual(a.roles["20021"], { part: "key" });
  // 09013 Neve Up — инвертор ГОТОВЫМ изделием (клавиша в комплекте), а не механизмом под
  // отдельную клавишу: part отсутствует, и по этому рантайм их и различает.
  assert.deepEqual(a.roles["09013"], { control: "inverter" });
  assert.equal("14653.01" in a.roles, false);
});

test("resolveCatalogPrice: приоритет прайса, номенклатура — фолбэк", () => {
  // цена есть в прайсе → берём её, источник price
  assert.deepEqual(N.resolveCatalogPrice(0.64, { price: 0.85, pack: 10 }), { price: 0.85, source: "price", packQty: 10 });
  // нет в прайсе (price=null) → фолбэк на номенклатуру
  assert.deepEqual(N.resolveCatalogPrice(7.36, { price: null, pack: null }), { price: 7.36, source: "nomenclature", packQty: null });
  // нет записи в прайсе вовсе → фолбэк
  assert.deepEqual(N.resolveCatalogPrice(12.5, undefined), { price: 12.5, source: "nomenclature", packQty: null });
  // битая цена прайса (0/отрицательная) не должна победить номенклатуру
  assert.equal(N.resolveCatalogPrice(5, { price: 0 }).source, "nomenclature");
  // округление до 2 знаков
  assert.equal(N.resolveCatalogPrice(null, { price: 1.239 }).price, 1.24);
});

test("applyKindOverrides: frame→socket_box пересчитывает производные признаки", () => {
  // как запись из readNomenclature: у накладки есть slotCount, категория/иконка рамки
  const records = [
    { code: "14902", kind: "frame", name: "Коробка IP55 2 модуля", moduleSize: 2, slotCount: 2, categoryId: 100, icon: "□" },
    { code: "14653.01", kind: "frame", name: "Накладка 2М", moduleSize: 2, slotCount: 2, categoryId: 100, icon: "□" },
  ];
  const { applied } = N.applyKindOverrides(records, { "14902": { kind: "socket_box", why: "корпус" } });
  assert.equal(applied, 1);
  const box = records[0];
  assert.equal(box.kind, "socket_box");
  assert.equal("slotCount" in box, false);            // признак рамки снят
  assert.equal(box.boxShape, "rect");                 // без слова формы → прямоугольная
  assert.deepEqual(box.boxStandards, ["IT"]);
  assert.deepEqual({ categoryId: box.categoryId, icon: box.icon }, { categoryId: 200, icon: "○" });
  // не тронутая запись осталась рамкой
  assert.equal(records[1].kind, "frame");
  assert.equal(records[1].slotCount, 2);
});

test("applyKindOverrides: mechanism→accessory не даёт признаков поста (не в buildAttrs)", () => {
  const records = [
    { code: "00938.B", kind: "mechanism", name: "Светодиод для подсветок", moduleSize: 1 },
  ];
  const { applied } = N.applyKindOverrides(records, { "00938.B": { kind: "accessory", why: "не модуль поста" } });
  assert.equal(applied, 1);
  assert.equal(records[0].kind, "accessory");
  // accessory не попадает ни в накладки, ни в суппорты, ни в коробки автосостава
  const a = N.buildAttrs(records);
  assert.equal("00938.B" in a.standards, false);
  assert.equal("00938.B" in a.supports, false);
  assert.equal("00938.B" in a.boxes, false);
});

test("applyKindOverrides: пустая карта и совпадающий kind — ноль правок", () => {
  const records = [{ code: "X", kind: "mechanism", name: "Механизм", moduleSize: 1 }];
  assert.equal(N.applyKindOverrides(records, {}).applied, 0);
  // артикула нет в записях — игнорируется без ошибки
  assert.equal(N.applyKindOverrides(records, { "Y": { kind: "accessory" } }).applied, 0);
  // kind уже совпадает — не считается правкой
  assert.equal(N.applyKindOverrides(records, { "X": { kind: "mechanism" } }).applied, 0);
});

test("buildAttrs: формат признаков для рантайма (standards/supports/boxes)", () => {
  const records = [
    { code: "14653.01", kind: "frame", standard: "IT" },
    { code: "14613", kind: "support", standard: "IT", moduleSize: 3, pitchMm: null },
    { code: "V71303", kind: "socket_box", standard: "IT", wallType: "solid", boxShape: "rect", moduleSize: 3, boxStandards: ["IT"] },
    { code: "09001", kind: "mechanism", standard: "BOTH" },  // механизм без правила в attrs не попадает
  ];
  const a = N.buildAttrs(records);
  assert.deepEqual(a.standards["14653.01"], { standard: "IT", postCount: null });
  assert.deepEqual(a.supports["14613"], { standard: "IT", modules: 3, pitchMm: null });
  assert.deepEqual(a.boxes["V71303"], { wallType: "solid", shape: "rect", modules: 3, standards: ["IT"] });
  assert.equal(a.wallTypes["V71303"], "solid");
  assert.equal("09001" in a.standards, false);
  assert.equal("09001" in a.supports, false);
  assert.equal("09001" in a.mounting, false);   // и в mounting тоже: правила у записи нет
});

test("buildAttrs: монтажное правило (принцип + модульность коробки) доходит до рантайма", () => {
  /* Без этих двух полей подбор считает коробку и суппорт по ёмкости накладки, и все
     «центральные» позиции получают не то: 09672 (2М-накладка в коробку на 3 модуля)
     подбирала обычный 2М-суппорт вместо выделенного 09606. Поля нужны И накладке, И
     суппорту — именно совпадение пары связывает их между собой. */
  const records = [
    { code: "09672.01", kind: "frame", standard: "IT", principle: "2M_CENTRAL", boxModularity: 3 },
    { code: "09606", kind: "support", standard: "IT", moduleSize: 2, pitchMm: null, principle: "2M_CENTRAL", boxModularity: 3 },
  ];
  const a = N.buildAttrs(records);
  assert.deepEqual(a.standards["09672.01"], { standard: "IT", postCount: null, principle: "2M_CENTRAL", boxModularity: 3 });
  assert.deepEqual(a.supports["09606"], { standard: "IT", modules: 2, pitchMm: null, principle: "2M_CENTRAL", boxModularity: 3 });
});

test("buildAttrs: у позиции без монтажного правила ключей principle/boxModularity нет", () => {
  /* Правило есть у 449 позиций из 2146 — пустые ключи у остальных раздули бы файл
     атрибутов и заставили бы рантайм отличать «нет правила» от «правило пустое». */
  const a = N.buildAttrs([{ code: "14613", kind: "support", standard: "IT", moduleSize: 3, pitchMm: null, principle: null, boxModularity: null }]);
  assert.equal("principle" in a.supports["14613"], false);
  assert.equal("boxModularity" in a.supports["14613"], false);
});

test("buildAttrs: принцип обработки МЕХАНИЗМА едет в рантайм разделом mounting", () => {
  /* Своего раздела признаков у механизмов нет (стандарт сборки и модульность поста им
     ни к чему), и правило им долго не проставлялось вовсе: addMountingRule звался только
     в ветках накладки и суппорта, из-за чего 158 механизмов с заполненным «Принципом
     обработки» (BUTTON, SCHUP, Bluetooth) до каталога не доезжали. Ключ — артикул. */
  const records = [
    { code: "09001", kind: "mechanism", standard: "BOTH", principle: "BUTTON" },
    { code: "03925", kind: "mechanism", standard: "IT", principle: "Bluetooth" },
    { code: "00935.A", kind: "accessory", principle: "LED", boxModularity: 1 },   // прочие виды — туда же
  ];
  const a = N.buildAttrs(records);
  assert.deepEqual(a.mounting["09001"], { principle: "BUTTON" });
  assert.deepEqual(a.mounting["03925"], { principle: "Bluetooth" });
  assert.deepEqual(a.mounting["00935.A"], { principle: "LED", boxModularity: 1 });
  // механизм не должен просочиться в разделы накладок/суппортов/коробок
  assert.equal("09001" in a.standards, false);
  assert.equal("09001" in a.boxes, false);
});

test("buildAttrs: принцип обработки КОРОБКИ едет в её запись boxes", () => {
  /* IP55-корпуса 14901–14904 переклассифицированы из накладок в socket_box
     (tools/data/kind-overrides.json), а ветка socket_box монтажное правило не переносила —
     «NO_INNERS, AQUAPLATE» терялся ровно у тех четырёх позиций, ради которых оверрайд
     и делался. Правило живёт в самой записи коробки, а не в mounting: раздел признаков
     у коробки есть, и js/data.js читает её одним лукапом. */
  const a = N.buildAttrs([
    { code: "14901", kind: "socket_box", wallType: "unknown", boxShape: "rect", moduleSize: 1, boxStandards: ["IT"], principle: "NO_INNERS, AQUAPLATE" },
  ]);
  assert.deepEqual(a.boxes["14901"], {
    wallType: "unknown", shape: "rect", modules: 1, standards: ["IT"], principle: "NO_INNERS, AQUAPLATE",
  });
  assert.equal("14901" in a.mounting, false);   // без дублирования между разделами
  assert.equal("14901" in a.wallTypes, false);  // тип стены неизвестен — в подбор не идёт
});

/* ───────────────────── readNomenclature: чтение реального .xls ─────────────────────
   Файл номенклатуры заказчика лежит ВНЕ репозитория, поэтому мини-книгу собираем сами.
   Шапка воспроизводит настоящую, включая «Подгруппы » с ПРОБЕЛОМ на конце — именно из-за
   него колонка не читалась: readNomenclature тримит заголовки перед поиском, а имя колонки
   в COL было записано с пробелом, и indexOf не совпадал НИКОГДА (subgroup===null у всех
   2146 строк). Тест падал бы до починки и стережёт её впредь. */
const FIXTURE_HEADER = [
  "Бренд", "Серия", "Артикул", "Наименование", "Размер в модулях", "цена, евро",
  "Тип управления", "Функциональная группа", "Тип стены", "Монтажный стандарт",
  "Количество уровней в рамке", "Цвет элемента", "Группа доступа",
  "Описание особенностей элемента", "Принцип обработки", "Подгруппы ", "Модульность для коробки",
];
/* Строки — копии настоящих (артикулы, названия и значения колонок как в файле заказчика). */
const FIXTURE_ROWS = [
  ["VIMAR", "EIKON EVO, EIKON EXE", "20001.0", "Механизм-выключатель 1P 16AX серый", null, 12.5, "В", "Механизмы", "", "", null, "серый", null, "", "", "Выключатели", null],
  ["VIMAR", "EIKON EVO, EIKON EXE", "20005.0", "Механизм-переключатель 1P 16AX серый", null, 13.5, "П", "Механизмы", "", "", null, "серый", null, "", "", "Выключатели", null],
  ["VIMAR", "EIKON EVO, EIKON EXE", "20008.0", "Механизм-кнопка 1P NO 10A серый", null, 14.5, "Кн", "Механизмы", "", "", null, "серый", null, "", "", "Выключатели", null],
  ["VIMAR", "EIKON EVO, EIKON EXE", "20013.0", "Механизм переключателя с 4-мя контактами ( инвертор ) 1P 16AХ серый", null, 25.5, "И", "Механизмы", "", "", null, "серый", null, "", "", "Выключатели", null],
  ["VIMAR", "EIKON EVO, EIKON EXE", "20021", "Клавиша на 1 модуль серая", 1, 4.5, "", "управление светом", "", "Итальянский", null, "серый", null, "", "BUTTON", "", null],
  ["VIMAR", "ARKE, EIKON EVO, PLANA", "03925", "2 кнопки управления Bluetooth Low Energy", null, 90, "Bluetooth", "Механизмы", "", "", null, "белый", null, "", "Bluetooth", "Bluetooth", null],
  ["VIMAR", "EIKON EVO", "20653.01", "Накладка 3 модуля, белая", 3, 8.9, "", "Декоративные накладки", "", "Итальянский", 1, "", null, "", "", "", null],
];

function writeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ep-nom-"));
  const file = path.join(dir, "nom.xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([FIXTURE_HEADER, ...FIXTURE_ROWS]), "Лист2");
  XLSX.writeFile(wb, file);
  return { dir, file };
}

test("readNomenclature: колонка «Подгруппы » (с пробелом в .xls) читается", () => {
  const { dir, file } = writeFixture();
  try {
    const { records, stats } = N.readNomenclature(file);
    const by = Object.fromEntries(records.map((r) => [r.code, r]));
    assert.equal(by["20001.0"].subgroup, "Выключатели");
    assert.equal(by["03925"].subgroup, "Bluetooth");
    assert.equal(by["20021"].subgroup, null);        // в файле пусто — так и остаётся null
    assert.equal(stats.withSubgroup, 5);             // пять строк фикстуры с заполненной подгруппой
    // заодно: соседние колонки не разъехались от нормализации поиска
    assert.equal(by["20021"].principle, "BUTTON");
    assert.equal(by["20653.01"].levels, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readNomenclature: признак роли доезжает до записи товара", () => {
  /* Ровно те артикулы, которыми владелец проверял состав каталога вручную: четыре голых
     механизма Eikon Evo+Exe по одному на каждую роль и клавиша к ним. Плюс контрольные —
     03925 (в группе «Механизмы», но тип управления Bluetooth: голым механизмом НЕ считается,
     иначе подцепилась бы сразу ко всем клавишам пяти серий) и накладка. */
  const { dir, file } = writeFixture();
  try {
    const { records, stats } = N.readNomenclature(file);
    const by = Object.fromEntries(records.map((r) => [r.code, r]));
    const role = (code) => ({ part: by[code].partRole, control: by[code].controlRole });
    assert.deepEqual(role("20001.0"), { part: "bare_mechanism", control: "switch" });
    assert.deepEqual(role("20005.0"), { part: "bare_mechanism", control: "changeover" });
    assert.deepEqual(role("20008.0"), { part: "bare_mechanism", control: "button" });
    assert.deepEqual(role("20013.0"), { part: "bare_mechanism", control: "inverter" });
    assert.deepEqual(role("20021"), { part: "key", control: null });
    assert.deepEqual(role("03925"), { part: null, control: "bluetooth" });
    assert.deepEqual(role("20653.01"), { part: null, control: null });
    // «Тип управления» доезжает и в исходном виде — сверять с файлом заказчика
    assert.equal(by["20013.0"].controlType, "И");
    assert.deepEqual(stats.byPartRole, { bare_mechanism: 4, key: 1 });

    // и дальше, через buildAttrs, — в раздел roles файла атрибутов
    const a = N.buildAttrs(records);
    assert.deepEqual(a.roles["20013.0"], { part: "bare_mechanism", control: "inverter" });
    assert.deepEqual(a.roles["20021"], { part: "key" });
    assert.equal("20653.01" in a.roles, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("собранный js/catalog-vimar-attrs.js несёт роли по реальной номенклатуре", () => {
  /* Проверяем ОТГРУЖАЕМЫЙ артефакт, а не только чистые функции: между ними стоит конвертер,
     и регресс в нём тесты чистых функций не поймают. Числа — замер владельца: 18 голых
     механизмов (Plana/Arke/Eikon Evo+Exe по четыре роли, осевые Eikon Flat 22104/22108 и
     четыре Neve Up) и 34 клавиши. */
  const box = {};
  new Function("window", "\"use strict\";" + fs.readFileSync(path.join(__dirname, "../js/catalog-vimar-attrs.js"), "utf8"))(box);
  const roles = box.EP_VIMAR_ATTRS.roles;
  const parts = Object.values(roles).filter((r) => r.part === "bare_mechanism");
  assert.equal(parts.length, 18);
  assert.equal(Object.values(roles).filter((r) => r.part === "key").length, 34);
  const bareByControl = {};
  for (const r of parts) bareByControl[r.control] = (bareByControl[r.control] || 0) + 1;
  assert.deepEqual(bareByControl, { switch: 4, changeover: 5, button: 6, inverter: 3 });
  assert.deepEqual(roles["20001.0"], { part: "bare_mechanism", control: "switch" });
  assert.deepEqual(roles["20005.0"], { part: "bare_mechanism", control: "changeover" });
  assert.deepEqual(roles["20008.0"], { part: "bare_mechanism", control: "button" });
  assert.deepEqual(roles["20013.0"], { part: "bare_mechanism", control: "inverter" });
  assert.deepEqual(roles["20021"], { part: "key" });
  /* Neve Up устроена ИНАЧЕ: голые механизмы есть только для выключателя/переключателя/кнопки
     (все «с подсветкой», у кнопки два кандидата — 12В и 250В), а голого механизма-ИНВЕРТОРА
     нет вовсе. 09013 — инвертор ГОТОВЫМ изделием, клавиша в комплекте: у него есть роль
     управления, но нет роли детали. Значит классическая схема при N≥3 на Neve Up из пары
     «клавиша + голый механизм» не собирается — это данные, а не недосмотр каталога. */
  assert.deepEqual(roles["09001.0.250"], { part: "bare_mechanism", control: "switch" });
  assert.deepEqual(roles["09005.0.250"], { part: "bare_mechanism", control: "changeover" });
  assert.deepEqual(roles["09008.0.12"], { part: "bare_mechanism", control: "button" });
  assert.deepEqual(roles["09008.0.250"], { part: "bare_mechanism", control: "button" });
  assert.deepEqual(roles["09013"], { control: "inverter" });
  assert.equal(Object.keys(roles).filter((c) => /^09\d+\.0/.test(c) && roles[c].control === "inverter").length, 0);
});

test("buildAttrs: функциональная группа и подгруппа едут в рантайм разделом groups", () => {
  /* Разделы выбора товара в полноэкранном конструкторе поста берутся из колонки заказчика
     «Функциональная группа», а не из categoryId: тот ставит эвристика classify() по названию,
     и её разделы расходятся с теми, которыми думает заказчик. */
  const rec = (code, kind, group, subgroup) => ({ code, kind, group, subgroup });
  const a = N.buildAttrs([
    rec("20021", "mechanism", "управление светом", "Выключатели с подсветкой"),
    rec("20210", "mechanism", "Розетки", null),
    rec("20001.0", "mechanism", "Механизмы", null),
    rec("14591", "accessory", "Подсветка клавиш", null),
    rec("20663", "frame", "Декоративные накладки", null),   // накладки группируются по СЕРИИ
    rec("09613", "support", "Суппорты", null),
    rec("V71303", "socket_box", "Монтажные коробки", null),
  ]);
  assert.deepEqual(a.groups["20021"], { group: "управление светом", subgroup: "Выключатели с подсветкой" });
  assert.deepEqual(a.groups["20210"], { group: "Розетки" }, "подгруппы нет — ключа нет");
  assert.deepEqual(a.groups["20001.0"], { group: "Механизмы" });
  assert.deepEqual(a.groups["14591"], { group: "Подсветка клавиш" }, "аксессуары тоже в разделе");
  // Накладок (1635 позиций), суппортов и коробок в разделе нет намеренно: в конструкторе
  // выбираются механизмы, а файл атрибутов вырос бы с 14.5 КБ до 73 КБ без единой строки пользы.
  assert.equal(a.groups["20663"], undefined);
  assert.equal(a.groups["09613"], undefined);
  assert.equal(a.groups["V71303"], undefined);
});

test("buildAttrs: у механизма без функциональной группы ключа в groups нет", () => {
  /* «Признака нет» рантайм отличает по ОТСУТСТВИЮ ключа — то же правило, что у roles и
     principle. Пустая запись раздула бы файл и сломала бы эту проверку. */
  const a = N.buildAttrs([{ code: "X1", kind: "mechanism", group: "", subgroup: "" }]);
  assert.equal(a.groups["X1"], undefined);
});

test("собранный js/catalog-vimar-attrs.js несёт функциональные группы механизмов", () => {
  /* Проверяем ОТГРУЖАЕМЫЙ артефакт: раздел собран, доехал через конвертер и содержит те
     разделы, которыми думает заказчик. Числа — замер по его номенклатуре (435 механизмов
     в 8 разделах + 25 аксессуаров «Подсветка клавиш»); регресс в номенклатуре или в сборке
     обязан быть виден здесь, а не в браузере пустым списком товаров. */
  const box = {};
  new Function("window", "\"use strict\";" + fs.readFileSync(path.join(__dirname, "../js/catalog-vimar-attrs.js"), "utf8"))(box);
  const groups = box.EP_VIMAR_ATTRS.groups;
  assert.equal(Object.keys(groups).length, 460);
  const tally = {};
  for (const code in groups) tally[groups[code].group] = (tally[groups[code].group] || 0) + 1;
  assert.deepEqual(tally, {
    "управление светом": 173, "Информационные разъемы": 75, "Зарядные устройства": 60,
    "управление климатом и жалюзи": 38, "Розетки": 30, "Заглушки и выводы кабеля": 26,
    "Механизмы": 24, "Подсветка клавиш": 25, "отели": 8, "Отели": 1
  });
  /* Клавиша живёт в «управлении светом», голый механизм — в «Механизмах»: разделы разные,
     и в конструкторе голые механизмы уезжают в свой раздел в конце списка. */
  assert.equal(groups["20021"].group, "управление светом");
  assert.equal(groups["20001.0"].group, "Механизмы");
  /* «отели» и «Отели» в данных записаны по-разному; схлопывает их уже рантайм
     (EPCatalogSections по ключу в нижнем регистре), а сборка написание не правит. */
  assert.ok(tally["отели"] > 0 && tally["Отели"] > 0);
});
