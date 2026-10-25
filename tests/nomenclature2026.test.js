"use strict";
/* Тесты читателя новой номенклатуры заказчика образца 2026-10-10 (К2, шаги 1–2,
   tools/lib/nomenclature2026.mjs). Чистые функции классификации проверяем напрямую;
   readNomenclature2026 — на СВОИХ мини-файлах во временной папке (новый .xls c листом
   «VIMAR » и шапкой в 3-й строке, прежний .xls «Лист2», CSV отделки), потому что
   настоящая номенклатура заказчика лежит вне репозитория и привязываться к ней нельзя.
   Модуль — ESM (.mjs), подключаем динамическим import в before(). */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const XLSX = require("xlsx");

let N;
let dir, newXls, oldXls, csv, facingJson, res;

test("moduleCountOf2026: «+» → сумма, «,» → максимум, дробь → как есть", () => {
  assert.equal(N.moduleCountOf2026("7+7"), 14);      // многорядная накладка — сумма мест по рядам
  assert.equal(N.moduleCountOf2026("7+7+7"), 21);
  assert.equal(N.moduleCountOf2026("1+1"), 2);
  assert.equal(N.moduleCountOf2026("3+3"), 6);
  assert.equal(N.moduleCountOf2026("4+4"), 8);
  assert.equal(N.moduleCountOf2026("1, 2"), 2);      // диапазон вместимости коробки — максимум
  assert.equal(N.moduleCountOf2026("6, 7"), 7);
  assert.equal(N.moduleCountOf2026("12, 14"), 14);
  assert.equal(N.moduleCountOf2026("0.5"), 0.5);     // фальшблок на 1/2 модуля — не 5
  assert.equal(N.moduleCountOf2026(3), 3);
  assert.equal(N.moduleCountOf2026(""), null);
  assert.equal(N.moduleCountOf2026(null), null);
});

test("wallTypeOf2026: «Бетон» и «Кирпич» → solid, «ГКЛ» → hollow", () => {
  assert.equal(N.wallTypeOf2026("Бетон"), "solid");   // новое написание прежнего «Кирпич»
  assert.equal(N.wallTypeOf2026("Кирпич"), "solid");
  assert.equal(N.wallTypeOf2026("ГКЛ"), "hollow");
  assert.equal(N.wallTypeOf2026("ГКЛ, Бетон"), "unknown");
  assert.equal(N.wallTypeOf2026(""), "unknown");
});

test("kindOf2026: новые имена групп → прежние виды", () => {
  assert.equal(N.kindOf2026("Рамка"), "frame");
  assert.equal(N.kindOf2026("Рамка и Клавиша"), "frame");
  // Накладные/настольные коробки и крышки IP55 — НЕ накладки (решение владельца 18.10):
  // уходят в accessory, чтобы не попадать в выбор накладки поста и не тянуть стандарт UNKNOWN.
  assert.equal(N.kindOf2026("Накладной или Гермитичный монтаж"), "accessory");
  assert.equal(N.kindOf2026("Суппорт"), "support");
  assert.equal(N.kindOf2026("Суппорта"), "support");
  assert.equal(N.kindOf2026("Монтажная коробка"), "socket_box");
  assert.equal(N.kindOf2026("Механизм"), "mechanism");
  assert.equal(N.kindOf2026("Силовые розетки"), "mechanism");
  assert.equal(N.kindOf2026("Лючок в пол"), "mechanism");   // нет прежнего эквивалента → по умолчанию
});

test("isHermeticCover: крышка/накладка группы «Накладной или Гермитичный монтаж» — накладка, коробка/лампа — нет", () => {
  const G = "Накладной или Гермитичный монтаж";
  // крышки/накладки IP44/IP55 → накладки (решение владельца 19.10): из них собирается герметичный пост
  assert.ok(N.isHermeticCover(G, "Крышка на 2 модуля Neve Up IP55, с распорками, белая"));
  assert.ok(N.isHermeticCover(G, "Накладка на 3 модуля IP55 с винтами, белая"));
  assert.ok(N.isHermeticCover(G, "Крышка IP44 на 3 модуля с прозрачной дверцей"));
  // коробки/лампа/розетка/суппорт/база той же группы накладками НЕ становятся
  assert.ok(!N.isHermeticCover(G, "Коробка IP55 на 3 модуля"));
  assert.ok(!N.isHermeticCover(G, "Лампа электронная переносная 230V"));
  assert.ok(!N.isHermeticCover(G, "Суппорт для 1 модуля H-53мм BARRA DIN"));
  // гейт по группе: слово «Накладка» несут и обычные рамки группы «Рамка» — их правило не трогает
  assert.ok(!N.isHermeticCover("Рамка", "Накладка CLASSIC на 3 модуля Reflex лед"));
  assert.ok(!N.isHermeticCover("Механизм", "Крышка-заглушка"));
});

/* --- Интеграция readNomenclature2026 на мини-файлах --- */

// Шапка нового файла (3-я строка), 21 столбец — порядок как в файле заказчика.
const NEW_HEADER = [
  "Артикул", "Наименование", "Прайс розница РФ, Евро", "Кол-во в упаковке", "Примечание",
  "Количество модулей", "Коллекция", "Тип управления", "Функциональная группа", "Тип стены",
  "Монтажный стандарт", "Количество уровней в рамке", "Цвет механизма",
  "Кодировка цвета накладки", "Цвет накладки", "Материал накладки", "Форма накладки",
  "Спрашивать подсветку 1 - да, пусто - нет", "Цвет подсветки",
  "Позиция подсветки 1 - верх, 2 - центр, 3 - низ", "Изображение",
];
// row(): собрать строку нового листа по именам полей (пропуски — null).
function newRow(o) {
  const m = {
    code: o.code, name: o.name ?? "", price: o.price ?? null, pack: o.pack ?? null,
    note: o.note ?? null, mod: o.mod ?? null, coll: o.coll ?? null, ctrl: o.ctrl ?? null,
    group: o.group ?? null, wall: o.wall ?? null, std: o.std ?? null, levels: o.levels ?? null,
    mcolor: o.mcolor ?? null, fcode: null, fcolor: o.fcolor ?? null, fmat: o.fmat ?? null,
    fshape: o.fshape ?? null, ask: o.ask ?? null, bcolor: o.bcolor ?? null, bpos: o.bpos ?? null, img: null,
  };
  return [m.code, m.name, m.price, m.pack, m.note, m.mod, m.coll, m.ctrl, m.group, m.wall,
    m.std, m.levels, m.mcolor, m.fcode, m.fcolor, m.fmat, m.fshape, m.ask, m.bcolor, m.bpos, m.img];
}

// Прежний файл: лист «Лист2», шапка в 1-й строке, 25 столбцов (как в nomenclature.mjs).
const OLD_HEADER = [
  "Бренд", "Серия", "Артикул", "Наименование", "Размер в модулях", "цена, евро",
  "Тип управления", "Функциональная группа", "Тип стены", "Монтажный стандарт",
  "Количество уровней в рамке", "Цвет элемента", "Группа доступа", "Цвет накладки",
  "Материал накладки", "Форма накладки", "Спрашивать подсветку 1 - да, пусто - нет",
  "Цвет подсветки", "Позиция подсветки 1 - верх, 2 - центр, 3 - низ", "Изображение",
  "Описание особенностей элемента", "Принцип обработки", "Подгруппы", "Подпись для картинки",
  "Модульность для коробки",
];
function oldRow(o) {
  const r = new Array(25).fill(null);
  r[1] = o.series ?? ""; r[2] = o.code; r[3] = o.name ?? ""; r[4] = o.mod ?? null;
  r[5] = o.price ?? null; r[6] = o.ctrl ?? null; r[7] = o.group ?? ""; r[8] = o.wall ?? null;
  r[9] = o.std ?? null; r[10] = o.levels ?? null; r[11] = o.color ?? null;
  r[13] = o.fcolor ?? null; r[14] = o.fmat ?? null; r[15] = o.fshape ?? null;
  r[21] = o.principle ?? null; r[22] = o.subgroup ?? null; r[24] = o.boxModularity ?? null;
  return r;
}

before(async () => {
  N = await import(pathToFileURL(path.join(__dirname, "../tools/lib/nomenclature2026.mjs")).href);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nom2026-"));
  // --- новый файл: служебный лист + лист «VIMAR » (шапка в 3-й строке) ---
  const aoa = [
    [], [],                       // две служебные строки до шапки
    NEW_HEADER,                   // строка 3 (индекс 2) — шапка
    // F7: общая немецкая многорядная накладка «7+7»; отделка/уровни в новом пусты → из прежнего
    newRow({ code: "F7", name: "Накладка 7+7", price: 10, mod: "7+7", coll: "Plana", group: "Рамка", std: "Немецкий", note: "Общее примечание" }),
    // B1: коробка «1, 2» на бетоне
    newRow({ code: "B1", name: "Коробка круглая", price: 2, mod: "1, 2", group: "Монтажная коробка", wall: "Бетон" }),
    // FR1: общая накладка, в новом стандарт «Итальянский» (распознан) при прежнем BOTH → новый главнее
    newRow({ code: "FR1", name: "Рамка 1М", price: 3, mod: 1, coll: "Plana", group: "Рамка", std: "Итальянский" }),
    // NEW1: новая накладка (нет в прежнем) — отделка из CSV
    newRow({ code: "NEW1", name: "Накладка новая", price: 4, mod: 1, coll: "Linea", group: "Рамка", std: "Итальянский" }),
    // M1: общий механизм, принцип/подгруппа в новом файле отсутствуют колонками → из прежнего
    newRow({ code: "M1", name: "Выключатель 1М", price: 5, mod: 1, coll: "Plana", group: "Механизм", ctrl: "В" }),
    // ND1: новый механизм с нераспознанным типом управления «ДД» → роль null, в отчёт
    newRow({ code: "ND1", name: "Датчик движения", price: 6, mod: 1, coll: "Eikon", group: "Управление светом", ctrl: "ДД" }),
    // M9.FX.0: быстросъёмный «.FX» — должен быть исключён из каталога правилом по артикулу
    newRow({ code: "M9.FX.0", name: "Механизм быстросъёмный", price: 7, mod: 1, coll: "Plana", group: "Механизм", ctrl: "В" }),
    [], // пустая строка-разделитель — должна пропуститься
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Диапазон листа — от A1, иначе пустые верхние строки «съедаются» и шапка уезжает с 3-й
  // строки. В настоящем файле заказчика !ref = A1:U… (R1 пуста, но в диапазоне), поэтому
  // фиксируем так же, чтобы grid[2] был шапкой, как в рабочем файле.
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: NEW_HEADER.length - 1 } });
  // Объединённая «Примечание» (колонка E, индекс 4) на строки F7..FR1 (индексы 3..5) —
  // значение только в верхней ячейке; читатель обязан раскрыть на весь диапазон.
  ws["!merges"] = [{ s: { r: 3, c: 4 }, e: { r: 5, c: 4 } }];
  const wbNew = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbNew, XLSX.utils.aoa_to_sheet([["служебный"]]), "BExRepositorySheet");
  XLSX.utils.book_append_sheet(wbNew, ws, "VIMAR ");   // имя листа с пробелом на конце
  newXls = path.join(dir, "new.xls");
  XLSX.writeFile(wbNew, newXls, { bookType: "xls" });

  // --- прежний файл ---
  const oldAoa = [
    OLD_HEADER,
    oldRow({ code: "F7", name: "Накладка 7+7", series: "Plana", mod: 14, group: "Декоративные накладки", std: "Немецкий", levels: 2, fcolor: "Серый", fmat: "Технополимер", fshape: "Классическая" }),
    oldRow({ code: "FR1", name: "Рамка 1М", series: "Plana", mod: 1, group: "Декоративные накладки", std: "Итальянский, Немецкий", fcolor: "Белый", fmat: "Технополимер", fshape: "Классическая" }),
    oldRow({ code: "M1", name: "Выключатель 1М", series: "Plana", mod: 1, group: "Механизмы", ctrl: "В", color: "Серый", principle: "BUTTON", subgroup: "Выключатели", boxModularity: 2 }),
  ];
  const wbOld = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOld, XLSX.utils.aoa_to_sheet(oldAoa), "Лист2");
  oldXls = path.join(dir, "old.xls");
  XLSX.writeFile(wbOld, oldXls, { bookType: "xls" });

  // --- CSV отделки новых накладок (UTF-8 BOM, «;») ---
  csv = path.join(dir, "finish.csv");
  fs.writeFileSync(csv,
    "﻿Артикул;Наименование;Коллекция;Цвет накладки;Материал накладки;Форма накладки;Источник;Примечание\n" +
    "NEW1;Накладка новая;Linea;Чёрная;Технополимер;Классическая;сайт;\"прим; с кавычками\"\n", "utf8");

  // --- ручной оверрайд отделки: FR1 материал «Металл» (поверх прежнего «Технополимер») ---
  facingJson = path.join(dir, "facing.json");
  fs.writeFileSync(facingJson, JSON.stringify({
    overrides: { "FR1": { frameMaterial: "Металл", why: "тест оверрайда" } },
  }), "utf8");

  res = N.readNomenclature2026(newXls, { oldXlsPath: oldXls, finishCsv: csv, facingOverridesPath: facingJson });
});

const byCode = () => new Map(res.records.map((r) => [r.code, r]));

test("лист «VIMAR » и шапка в 3-й строке читаются; пустая строка пропущена", () => {
  assert.equal(res.stats.sheet, "VIMAR ");
  assert.equal(res.records.length, 6);          // 6 артикулов, разделитель пропущен
  assert.ok(res.stats.blankRows >= 1);
});

test("«7+7» → ёмкость 14 (сумма), «1, 2» → 2 (максимум)", () => {
  const m = byCode();
  assert.equal(m.get("F7").moduleSize, 14);
  assert.equal(m.get("F7").slotCount, 14);
  assert.equal(m.get("B1").moduleSize, 2);
});

test("объединённое «Примечание» раскрыто на все строки диапазона", () => {
  const m = byCode();
  assert.equal(m.get("F7").note, "Общее примечание");
  assert.equal(m.get("B1").note, "Общее примечание");   // вторая строка объединения
  assert.equal(m.get("FR1").note, "Общее примечание");  // третья строка объединения
});

test("«Бетон» → тип стены solid у коробки", () => {
  assert.equal(byCode().get("B1").wallType, "solid");
});

test("приоритет нового значения над старым: стандарт IT из нового (хотя в прежнем BOTH)", () => {
  assert.equal(byCode().get("FR1").standard, "IT");
});

test("подстановка из прежнего файла, когда в новом пусто", () => {
  const m = byCode();
  // уровни рамки — в новом пусто, из прежнего (нужны для раскладки на ряды)
  assert.equal(m.get("F7").levels, 2);
  // отделка накладки — в новом пуста у всех, общая F7 берёт из прежнего
  assert.equal(m.get("F7").frameColorRaw, "Серый");
  // принцип/подгруппа/модульность — колонок в новом файле нет вовсе, у общего M1 из прежнего
  assert.equal(m.get("M1").principle, "BUTTON");
  assert.equal(m.get("M1").subgroup, "Выключатели");
  assert.equal(m.get("M1").boxModularity, 2);
  assert.equal(m.get("M1").color, "Серый");
});

test("отделка новой накладки (нет в прежнем) берётся из CSV", () => {
  const fr = byCode().get("NEW1");
  assert.equal(fr.frameColorRaw, "Чёрная");
  assert.equal(fr.frameMaterialRaw, "Технополимер");
  assert.equal(fr.frameShapeRaw, "Классическая");
  assert.equal(res.stats.finishFromCsv, 1);
});

test("нераспознанный тип управления у НОВОГО артикула: роль null, значение в отчёте", () => {
  const nd = byCode().get("ND1");
  assert.equal(nd.controlRole, null);
  assert.ok(res.stats.unrecognizedControl["ДД"]?.includes("ND1"));
});

test("статистика бэкфилла и пересечения с прежним файлом", () => {
  assert.equal(res.stats.commonWithOld, 3);   // F7, FR1, M1
  assert.equal(res.stats.newArticles, 3);     // B1, NEW1, ND1
  assert.ok(res.stats.backfill.levels >= 1);
  assert.ok(res.stats.backfill.frameColor >= 1);
  assert.ok(res.stats.backfill.principle >= 1);
});

test("FX_CODE_RE ловит «.FX» сегментом кода, а не любой подстрокой", () => {
  assert.ok(N.FX_CODE_RE.test("14000.FX.0"));
  assert.ok(N.FX_CODE_RE.test("14208.FX"));
  assert.ok(N.FX_CODE_RE.test("20208.FX.C.N"));
  assert.ok(!N.FX_CODE_RE.test("20506"));
  assert.ok(!N.FX_CODE_RE.test("14FX00"));     // не сегмент — не ловим
  assert.ok(!N.FX_CODE_RE.test("19953.FXA"));  // «.FXA» — не сегмент «.FX»
});

test("быстросъёмный «.FX» исключён из каталога правилом по артикулу", () => {
  assert.equal(byCode().has("M9.FX.0"), false, "M9.FX.0 не попал в каталог");
  assert.equal(res.stats.excludedFx, 1);
  assert.ok(res.stats.excludedFxCodes.includes("M9.FX.0"));
});

test("ручной оверрайд отделки главнее CSV и бэкфилла", () => {
  // FR1 в прежнем файле «Технополимер», но оверрайд ставит «Металл» — он главнее.
  assert.equal(byCode().get("FR1").frameMaterialRaw, "Металл");
  assert.equal(res.stats.facingOverridden, 1);
});

/* --- Починка К9 25.10: разбор листа общий с проверкой (§7.1) --- */

// Собрать мини-книгу нового формата (служебный лист + «VIMAR », шапка в 3-й строке) из aoa.
function writeNewBook(fileName, header, dataRows) {
  const aoa = [[], [], header.slice(), ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: header.length - 1 } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["служебный"]]), "BExRepositorySheet");
  XLSX.utils.book_append_sheet(wb, ws, "VIMAR ");
  const p = path.join(dir, fileName);
  XLSX.writeFile(wb, p, { bookType: "xls" });
  return p;
}

test("цена-текст «6,99»/«12.50» в новом файле → nomPrice разобран числом (не запасной прайс)", () => {
  const H = ["Артикул", "Наименование", "Прайс розница РФ, Евро", "Кол-во в упаковке",
    "Примечание", "Количество модулей", "Коллекция", "Тип управления", "Функциональная группа"];
  const p = writeNewBook("textprice.xls", H, [
    ["20506", "Механизм X", "6,99", 10, null, 1, "Arke", null, "Механизм"],
    ["99999.9", "Механизм Y", "12.50", 10, null, 1, "Arke", null, "Механизм"],
  ]);
  const m = new Map(N.readNomenclature2026(p, { oldXlsPath: oldXls, finishCsv: csv }).records.map((x) => [x.code, x]));
  assert.equal(m.get("20506").nomPrice, 6.99);    // «6,99» → 6.99, а не null (прежде падало в прайс 173,43)
  assert.equal(m.get("99999.9").nomPrice, 12.5);  // «12.50» → 12.5
});

test("новые столбцы «Принцип обработки»/«Модульность для коробки»/«Подгруппы»/«Группа доступа» читаются из нового файла", () => {
  const H = ["Артикул", "Наименование", "Прайс розница РФ, Евро", "Кол-во в упаковке",
    "Примечание", "Количество модулей", "Коллекция", "Тип управления", "Функциональная группа",
    "Тип стены", "Монтажный стандарт", "Количество уровней в рамке", "Цвет механизма",
    "Цвет накладки", "Материал накладки", "Форма накладки",
    "Принцип обработки", "Подгруппы", "Модульность для коробки", "Группа доступа"];
  const p = writeNewBook("newcols.xls", H, [
    ["88888.01", "Накладка новая 2М", 5, 10, null, 2, "Eikon", null, "Рамка",
      null, "Итальянский", null, null, "Белый", "Технополимер", "Классика",
      "BUTTON", "Выключатели", 2, 1],
  ]);
  const rec = N.readNomenclature2026(p, { oldXlsPath: oldXls, finishCsv: csv }).records.find((x) => x.code === "88888.01");
  assert.equal(rec.principle, "BUTTON");
  assert.equal(rec.subgroup, "Выключатели");
  assert.equal(rec.boxModularity, 2);
  assert.equal(rec.accessGroup, 1);
});

test("объединённое «Примечание» раскрывается в правильные строки И столбцы при листе не от A1 (!ref с C4) — §7.1 край", () => {
  // Лист выгружен не от A1: данные начинаются с C4 — над ними пустые строки (1..3) и пустые
  // столбцы (A, B). Координаты !merges абсолютны от A1, а grid идёт от угла C4 → смещение и по
  // строке, и по столбцу. Если учесть только строку (или ничего) — примечание уедет мимо.
  const H = ["Артикул", "Наименование", "Прайс розница РФ, Евро", "Кол-во в упаковке",
    "Примечание", "Количество модулей", "Коллекция", "Тип управления", "Функциональная группа"];
  // «Примечание» — 5-й столбец шапки (grid-индекс 4); при старте с C это Excel-столбец G (абс. 6).
  const dataAoa = [
    H,                                                                          // C4 — шапка
    ["P1", "Накладка 1", 5, 10, "Монтаж в суппорт", 1, "Plana", null, "Рамка"], // C5 — верх объединения
    ["P2", "Накладка 2", 5, 10, null,               1, "Plana", null, "Рамка"], // C6 — внутри объединения
    ["P3", "Накладка 3", 5, 10, null,               1, "Plana", null, "Рамка"], // C7 — низ объединения
    ["P4", "Накладка 4", 5, 10, null,               1, "Plana", null, "Рамка"], // C8 — вне объединения
  ];
  const ws = XLSX.utils.aoa_to_sheet(dataAoa, { origin: "C4" });
  // Диапазон листа фиксируем от C4: aoa_to_sheet при origin всё равно ставит !ref от A1, а нам нужен
  // лист, у которого !ref начинается не с A1 (как у выгрузки заказчика с пустыми строками/столбцами).
  // Данные: 5 строк (шапка + 4) → Excel-строки 4..8 (0-based 3..7); 9 столбцов → C..K (0-based 2..10).
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 3, c: 2 }, e: { r: 7, c: 10 } });
  // Вертикальное объединение «Примечания»: Excel-столбец G (абс. col 6), строки 5..7 (абс. 0-based 4..6).
  ws["!merges"] = [{ s: { r: 4, c: 6 }, e: { r: 6, c: 6 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["служебный"]]), "BExRepositorySheet");
  XLSX.utils.book_append_sheet(wb, ws, "VIMAR ");
  const p = path.join(dir, "offset-merge.xls");
  XLSX.writeFile(wb, p, { bookType: "xls" });

  const r = N.readNomenclature2026(p, { oldXlsPath: oldXls, finishCsv: csv });
  assert.equal(r.stats.ref.split(":")[0], "C4");       // лист действительно не от A1 — иначе тест ничего не ловит
  const m = new Map(r.records.map((x) => [x.code, x]));
  assert.equal(m.get("P1").note, "Монтаж в суппорт");  // верх объединения
  assert.equal(m.get("P2").note, "Монтаж в суппорт");  // внутренняя строка — раскрыта
  assert.equal(m.get("P3").note, "Монтаж в суппорт");  // низ объединения — раскрыт
  assert.equal(m.get("P4").note, null);                // вне объединения — не затронут
});

test("выбор листа как у проверки: нет «VIMAR» → первый лист со столбцом «Артикул»", () => {
  // Книга из листов «Пояснения» (без «Артикула») и «Прайс» (с шапкой) — прежде конвертер брал
  // ПОСЛЕДНИЙ лист и читал 0 записей; теперь берёт первый лист с «Артикулом», как проверка.
  const H = ["Артикул", "Наименование", "Прайс розница РФ, Евро", "Кол-во в упаковке",
    "Примечание", "Количество модулей", "Коллекция", "Тип управления", "Функциональная группа"];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Столбец", "Что это"]]), "Пояснения");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ["20001.0", "Мех", 5, 10, null, 1, "Arke", null, "Механизм"]]), "Прайс");
  const p = path.join(dir, "twosheets.xls");
  XLSX.writeFile(wb, p, { bookType: "xls" });
  const r = N.readNomenclature2026(p, { oldXlsPath: oldXls, finishCsv: csv });
  assert.equal(r.stats.sheet, "Прайс");
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].code, "20001.0");
});
