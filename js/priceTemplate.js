/* Шаблон прайса и проверка загружаемого файла (К9, часть 1 — решения владельца 24.10).
   Заказчик: «новый прайс должен грузиться по жёстко заданным критериям… именно по шаблону
   сделанный». Этот модуль описывает, КАКИЕ столбцы программа ждёт в прайсе, и проверяет
   выбранный заказчиком файл, выдавая человекочитаемый отчёт («нет столбца «Цвет накладки»»,
   «строка 57 — нет цены», «тип управления «Ж» не распознан»).

   Модуль ЧИСТЫЙ: ни state, ни DOM, ни xlsx. На вход check() получает уже прочитанный лист
   (массив строк, как XLSX sheet_to_json({header:1})), на выход — {ok, errors, warnings, stats}.
   Разбор .xls и показ отчёта на экране — это части 2 и 3 (окно + генерация шаблона), здесь их нет.

   ⚠ ПРО ИСТОЧНИК ДОПУСТИМЫХ ЗНАЧЕНИЙ (§7.1). Правила распознавания живут в конвертере
   (tools/lib/nomenclature*.mjs, ESM под Node): controlRoleOf (буквы типа управления),
   GROUP_KIND_2026 (какие группы — накладки/суппорты/коробки), standardOf (монтажный стандарт),
   wallTypeOf2026 (тип стены). В браузер эти ESM-функции не дотащить, а ПЕРЕНОС их в этот модуль
   с импортом обратно в конвертер рискует молча изменить сборку каталога (catalog-vimar*.js) —
   трогать её в задаче «шаблон прайса» нельзя. Поэтому списки ниже продублированы здесь ОДИН раз,
   а tests/priceTemplate.test.js сверяет КАЖДЫЙ из них с реальным правилом конвертера: разойдутся —
   тест покраснеет. То есть точка проверки на расхождение одна, хоть сам список и в двух местах.

   Двойной экспорт: браузеру — window.EPPriceTemplate (сборщика нет, PLAN 2.2), Node — module.exports. */
(() => {
"use strict";

const norm = (v) => String(v == null ? "" : v).trim();
const fold = (v) => norm(v).toLowerCase();

/* Общий разбор листа (цена, шапка, номер строки Excel, размер в модулях) живёт в одном месте —
   js/priceSheet.js (§7.1): те же функции зовёт конвертер, поэтому проверка и сборка каталога не
   разъезжаются. Браузеру — window.EPPriceSheet (подключён до этого файла), Node — require. */
function sheetApi() {
  if (typeof window !== "undefined" && window.EPPriceSheet) return window.EPPriceSheet;
  if (typeof require !== "undefined") return require("./priceSheet.js");
  return null;
}

/* ---- Закрытые списки допустимых значений (сверяются с конвертером в тестах) ---- */

// Тип управления: буквы, которые распознаёт controlRoleOf (CONTROL_ROLES). Остальные значения
// («ДД», «Кн+Кн», «Выключатель сенсорный», опечатка «Ж») конвертер не отображает в роль — по ним
// клавиша/механизм не подберётся сам; это предупреждение, а не ошибка (файл всё равно пригоден).
const CONTROL_LETTERS = ["В", "П", "Кн", "И", "Д", "Bluetooth"];

// Функциональные группы, у которых конвертер меняет ВИД товара (GROUP_KIND_2026). Декоративные
// накладки — «Рамка»/«Рамка и Клавиша», а в группе «Накладной или Гермитичный монтаж» накладками
// являются ГЕРМОКРЫШКИ (имя «Крышка…»/«Накладка…», EPPriceSheet.isHermeticCover — решение владельца
// 25.10, вариант «а»): всем им обязательны отделка, монтажный стандарт и модули. Прочие позиции той
// же группы (коробки, лампы, розетки) — аксессуары, этих полей не требуют. Любая другая непустая
// группа (Управление светом, Розетки, Клавиша, Отели …) — механизм; это штатно, большинство каталога —
// механизмы, поэтому непустая нераспознанная группа ошибкой НЕ является.
const FRAME_GROUPS = ["Рамка", "Рамка и Клавиша"];
const SUPPORT_GROUPS = ["Суппорт", "Суппорта", "Суппорт накладной BLUETOOTH"];
const BOX_GROUPS = ["Монтажная коробка"];
const ACCESSORY_GROUPS = ["Накладной или Гермитичный монтаж"];

// Монтажный стандарт: standardOf распознаёт по подстрокам «итальян»/«немец» (в любом сочетании).
const STANDARD_TOKENS = ["итальян", "немец"];
const STANDARD_EXAMPLES = ["Итальянский", "Немецкий", "Итальянский и Немецкий"];
// Тип стены: wallTypeOf2026 распознаёт «Бетон»/«Кирпич» (сплошная) и «ГКЛ» (полая).
const WALL_TOKENS = ["бетон", "кирпич", "гкл"];
const WALL_EXAMPLES = ["Бетон", "Кирпич", "ГКЛ"];

const CONTROL_SET = new Set(CONTROL_LETTERS.map(fold));
const FRAME_SET = new Set(FRAME_GROUPS.map(fold));

function controlRecognized(v) { return CONTROL_SET.has(fold(v)); }
function standardRecognized(v) { const s = fold(v); return STANDARD_TOKENS.some((t) => s.includes(t)); }
function wallRecognized(v) { const s = fold(v); return WALL_TOKENS.some((t) => s.includes(t)); }
function isFrameGroup(v) { return FRAME_SET.has(fold(v)); }

// Артикул быстросъёмного механизма «.FX» (WAGO) конвертер в каталог не вносит (FX_CODE_RE в
// nomenclature2026.mjs) — такие строки при проверке пропускаем, это не ошибка файла.
const FX_CODE_RE = /\.FX(\.|$)/i;

/* ---- Описание столбцов шаблона ---- */

// Порядок: столбцы файла заказчика 2026-10-10 в его порядке + 4 желательных из прежнего файла
// («Подгруппы», «Принцип обработки», «Модульность для коробки», «Группа доступа»). required=true —
// обязательный столбец (нет столбца → ошибка); false — желательный (нет → предупреждение).
// Поле appliesTo описывает, для каких товаров значение обязано быть ЗАПОЛНЕНО (проверяется в check).
// «Изображение» и «Кодировка цвета накладки» в шаблон НЕ выносим (решение владельца 25.10):
// программа их не читает (в COL конвертера их нет), шаблону и проверке они не нужны.
const COLUMNS = [
  { name: "Артикул", required: true, appliesTo: "Все товары",
    explain: "Код позиции у производителя. По нему программа узнаёт товар и сверяет повторы.",
    allowed: "Любой непустой код. Код с «.FX» (быстросъёмные WAGO) программа пропускает.", example: "20001.0" },
  { name: "Наименование", required: true, appliesTo: "Все товары",
    explain: "Название позиции, как показывать человеку.", allowed: "Любой непустой текст.",
    example: "Выключатель 1-клавишный 16А" },
  { name: "Прайс розница РФ, Евро", required: true, appliesTo: "Все товары",
    explain: "Цена в евро (базовая валюта каталога; в рубли пересчитывает сама программа).",
    allowed: "Число больше нуля (точка или запятая как разделитель дробной части).", example: "12,50" },
  { name: "Кол-во в упаковке", required: true, appliesTo: "Все товары",
    explain: "Сколько штук в упаковке поставщика — для округления заказа кратно упаковке.",
    allowed: "Целое число больше нуля; можно и числом, и текстом («50»). Пусто — округления не будет.",
    example: "10" },
  { name: "Примечание", required: false, appliesTo: "По необходимости",
    explain: "Свободная ремарка (монтаж, совместимость). Одно примечание может стоять на группу строк.",
    allowed: "Любой текст или пусто.", example: "Монтируется в суппорт 09606" },
  { name: "Количество модулей", required: true, appliesTo: "Механизмы и накладки",
    explain: "Ширина в модулях. У накладки задаёт раскладку на посты, у механизма — сколько места занимает.",
    allowed: "Число (3); доля (0.5); «7+7» — сумма рядов; «1, 2» — диапазон коробки (берётся больший).",
    example: "2" },
  { name: "Коллекция", required: true, appliesTo: "Все товары (у коробок бывает пусто)",
    explain: "Серия(и) VIMAR, к которым относится позиция.",
    allowed: "Одна серия или несколько через запятую.", example: "Eikon, Arke" },
  { name: "Тип управления", required: false, appliesTo: "Механизмы управления светом",
    explain: "Роль в схеме света. По ней программа сама подбирает механизм под клавишу.",
    allowed: "Одна из букв: " + CONTROL_LETTERS.join(", ") + " (В — выключатель, П — проходной, Кн — кнопка, И — инвертор, Д — датчик). Другое значение программа не распознает.",
    example: "В" },
  { name: "Функциональная группа", required: true, appliesTo: "Все товары",
    explain: "Определяет вид товара: накладка, суппорт, коробка или механизм.",
    allowed: "Накладки: " + FRAME_GROUPS.join(", ") + ". Суппорты: " + SUPPORT_GROUPS.join(", ")
      + ". Коробки: " + BOX_GROUPS.join(", ") + ". Крышки/аксессуары: " + ACCESSORY_GROUPS.join(", ")
      + ". Любое другое значение — механизм.",
    example: "Рамка" },
  { name: "Тип стены", required: false, appliesTo: "Монтажные коробки",
    explain: "Под какую стену коробка.", allowed: WALL_EXAMPLES.join(", ") + ".", example: "Бетон" },
  { name: "Монтажный стандарт", required: true, appliesTo: "Накладки",
    explain: "Итальянский / немецкий монтаж — по нему накладка сходится с суппортом и коробкой.",
    allowed: STANDARD_EXAMPLES.join(", ") + " (и их сочетание).", example: "Итальянский" },
  { name: "Количество уровней в рамке", required: false, appliesTo: "Накладки",
    explain: "Сколько горизонтальных рядов постов в накладке.", allowed: "Целое число (1, 2, 3).", example: "1" },
  { name: "Цвет механизма", required: false, appliesTo: "Механизмы и клавиши",
    explain: "Собственный цвет начинки (не накладки).", allowed: "Название цвета или пусто.", example: "Белый" },
  { name: "Цвет накладки", required: true, appliesTo: "Накладки",
    explain: "Цвет отделки. По нему конструктор сужает выбор накладок под отделку комнаты.",
    allowed: "Название цвета.", example: "Белый" },
  { name: "Материал накладки", required: true, appliesTo: "Накладки",
    explain: "Материал отделки.", allowed: "Название материала.", example: "Технополимер" },
  { name: "Форма накладки", required: true, appliesTo: "Накладки",
    explain: "Форма/серия отделки.", allowed: "Название формы.", example: "Классика" },
  { name: "Спрашивать подсветку 1 - да, пусто - нет", required: false, appliesTo: "Клавиши и подсветки",
    explain: "Нужно ли спрашивать у пользователя подсветку клавиши.", allowed: "1 — да, пусто — нет.", example: "1" },
  { name: "Цвет подсветки", required: false, appliesTo: "Клавиши с подсветкой",
    explain: "Цвет свечения индикатора.", allowed: "Название цвета или пусто.", example: "Голубая" },
  { name: "Позиция подсветки 1 - верх, 2 - центр, 3 - низ", required: false, appliesTo: "Клавиши с подсветкой",
    explain: "Где на клавише индикатор.", allowed: "1 — верх, 2 — центр, 3 — низ, или пусто.", example: "2" },
  // Желательные столбцы прежнего файла — программа их читает, если они есть; без них работает.
  { name: "Подгруппы", required: false, appliesTo: "Механизмы",
    explain: "Подраздел механизма в конструкторе (Выключатели, Диммеры, Датчики движения …).",
    allowed: "Название подгруппы или пусто.", example: "Выключатели" },
  { name: "Принцип обработки", required: false, appliesTo: "Накладки, суппорты, механизмы",
    explain: "Правило монтажа (связывает накладку с её суппортом и коробкой).",
    allowed: "Код принципа или пусто.", example: "BUTTON" },
  { name: "Модульность для коробки", required: false, appliesTo: "Накладки и суппорты",
    explain: "В коробку на сколько модулей ставится позиция.", allowed: "Целое число или пусто.", example: "2" },
  { name: "Группа доступа", required: false, appliesTo: "По необходимости",
    explain: "Служебный признак прежнего файла.", allowed: "Число или пусто.", example: "1" },
];

/* ---- Проверка файла ---- */

// Форматирование списка номеров строк: не длинной простынёй, а первыми несколькими + «и ещё N».
function sampleRows(rows, limit) {
  const lim = limit || 8;
  if (rows.length <= lim) return rows.join(", ");
  return rows.slice(0, lim).join(", ") + " … и ещё " + (rows.length - lim);
}

// Накопитель однотипных находок: по одному пункту отчёта на причину, с подсчётом и примерами строк.
function makeBucket() {
  const order = [];
  const byKey = new Map();
  return {
    add(key, excelRow, buildMessage) {
      let b = byKey.get(key);
      if (!b) { b = { rows: [], build: buildMessage }; byKey.set(key, b); order.push(key); }
      if (excelRow != null) b.rows.push(excelRow);
    },
    list() {
      return order.map((key) => {
        const b = byKey.get(key);
        return { key, count: b.rows.length, rows: b.rows.slice(), message: b.build(b.rows) };
      });
    },
  };
}

/*
 * Проверка прайса. rows — массив строк листа (XLSX sheet_to_json({header:1})): массив массивов.
 * opts.startRow — номер первой строки массива в Excel (из !ref листа, см. EPPriceSheet.startRowOf):
 * когда над шапкой есть пустые строки, диапазон листа начинается не с A1 и rows[0] — не 1-я строка
 * Excel. Передают его окно проверки и тест; по умолчанию 1 (лист с A1). Номер строки в отчёте =
 * индекс + startRow, чтобы заказчик нашёл строку глазами. Шапку и цену разбираем общими функциями
 * EPPriceSheet (§7.1) — теми же, что у конвертера.
 *
 * Возвращает { ok, errors, warnings, stats }. Каждый элемент errors/warnings:
 *   { key, count, rows, message } — message уже готов к показу (без HTML; экранирование — на уровне окна).
 * ok === true, если ошибок нет (предупреждения на ok не влияют).
 */
function check(rows, opts) {
  const grid = Array.isArray(rows) ? rows : [];
  const S = sheetApi();
  const startRow = (opts && Number.isFinite(opts.startRow)) ? opts.startRow : 1;
  const errors = makeBucket();
  const warnings = makeBucket();
  const stats = {
    headerRow: null, dataRows: 0, blankRows: 0, noCodeRows: 0, fxRows: 0, duplicates: 0,
    frames: 0, supports: 0, boxes: 0, accessories: 0, mechanisms: 0,
  };

  // Строка шапки — первая, где встречается «Артикул» (общая функция конвертера).
  const headerIdx = S ? S.findHeaderRow(grid) : -1;
  if (headerIdx < 0) {
    errors.add("noHeader", null, () => "в файле не найдена строка шапки со столбцом «Артикул» — это не тот лист или не тот формат.");
    return { ok: false, errors: errors.list(), warnings: warnings.list(), stats };
  }
  stats.headerRow = headerIdx + startRow;

  const header = (grid[headerIdx] || []).map(norm);
  const colIndex = new Map();
  header.forEach((h, i) => { if (h && !colIndex.has(h)) colIndex.set(h, i); });
  const has = (name) => colIndex.has(norm(name));
  const idxOf = (name) => { const i = colIndex.get(norm(name)); return i == null ? -1 : i; };
  const cellAt = (row, name) => { const i = idxOf(name); return i < 0 ? null : row[i]; };

  // --- Наличие столбцов ---
  for (const col of COLUMNS) {
    if (has(col.name)) continue;
    if (col.required) errors.add("col:" + col.name, null, () => "нет столбца «" + col.name + "» (обязательный).");
    else warnings.add("col:" + col.name, null, () => "нет столбца «" + col.name + "» (желательный — программа прочитает его, если добавите).");
  }

  const iCode = idxOf("Артикул");
  const seen = new Set();

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    const excelRow = r + startRow;
    if (!Array.isArray(row) || row.every((c) => norm(c) === "")) { stats.blankRows++; continue; }

    const code = iCode < 0 ? "" : norm(row[iCode]);
    if (!code) {
      // строка с данными, но без артикула — конвертер её пропускает; предупреждаем, чтобы человек проверил
      stats.noCodeRows++;
      warnings.add("noCode", excelRow, (rr) => "строк с данными, но без артикула — " + rr.length + " (программа их пропустит): " + sampleRows(rr) + ".");
      continue;
    }
    if (FX_CODE_RE.test(code)) { stats.fxRows++; continue; }   // «.FX» — не вносится в каталог, это не ошибка
    if (seen.has(code)) {
      stats.duplicates++;
      errors.add("dup", excelRow, (rr) => "повторяющийся артикул — " + rr.length + " (строки " + sampleRows(rr) + "); артикул должен быть уникален.");
      continue;
    }
    seen.add(code);
    stats.dataRows++;

    // --- Цена --- (разбор тот же, что у конвертера: EPPriceSheet.parsePrice)
    const priceCell = cellAt(row, "Прайс розница РФ, Евро");
    if (norm(priceCell) === "") {
      errors.add("priceEmpty", excelRow, (rr) => "нет цены — " + rr.length + " (строки " + sampleRows(rr) + ").");
    } else {
      const pv = S ? S.parsePrice(priceCell) : NaN;
      if (!Number.isFinite(pv) || pv <= 0) {
        errors.add("priceBad", excelRow, (rr) => "цена не число или не больше нуля — " + rr.length + " (строки " + sampleRows(rr) + ").");
      }
    }

    // --- Наименование ---
    const name = norm(cellAt(row, "Наименование"));
    if (name === "") {
      errors.add("nameEmpty", excelRow, (rr) => "нет наименования — " + rr.length + " (строки " + sampleRows(rr) + ").");
    }

    // --- Функциональная группа / вид товара ---
    const group = norm(cellAt(row, "Функциональная группа"));
    if (!group) {
      warnings.add("groupEmpty", excelRow, (rr) => "функциональная группа пуста — " + rr.length + " (строки " + sampleRows(rr) + "); такие позиции программа считает механизмами.");
    }

    // Вид определяем ТЕМ ЖЕ правилом, что конвертер: группа «Рамка»/«Рамка и Клавиша» —
    // накладка, и герметичная крышка/накладка (EPPriceSheet.isHermeticCover) — тоже накладка
    // (решение владельца 25.10, вариант «а»). Накладке обязательны стандарт, отделка и модули.
    const frame = isFrameGroup(group) || (S ? S.isHermeticCover(group, name) : false);
    if (frame) stats.frames++;
    else if (new Set(SUPPORT_GROUPS.map(fold)).has(fold(group))) stats.supports++;
    else if (new Set(BOX_GROUPS.map(fold)).has(fold(group))) stats.boxes++;
    else if (new Set(ACCESSORY_GROUPS.map(fold)).has(fold(group))) stats.accessories++;
    else if (group) stats.mechanisms++;

    // --- Поля, обязательные для декоративных накладок ---
    if (frame) {
      if (norm(cellAt(row, "Монтажный стандарт")) === "")
        errors.add("frameStd", excelRow, (rr) => "монтажный стандарт пуст у " + rr.length + " накладок (строки " + sampleRows(rr) + ").");
      // Количество модулей у накладки задаёт раскладку на посты. Ошибка, если конвертер не
      // разберёт значение (EPPriceSheet.moduleCountOf): пусто или текст вроде «два» (null).
      if (!S || S.moduleCountOf(cellAt(row, "Количество модулей")) == null)
        errors.add("frameMod", excelRow, (rr) => "количество модулей пусто или не распознано у " + rr.length + " накладок (строки " + sampleRows(rr) + "); ожидается число (2), доля (0.5), «7+7» или «1, 2».");
      if (norm(cellAt(row, "Материал накладки")) === "")
        errors.add("frameMat", excelRow, (rr) => "материал накладки пуст у " + rr.length + " накладок (строки " + sampleRows(rr) + ").");
      if (norm(cellAt(row, "Форма накладки")) === "")
        errors.add("frameShape", excelRow, (rr) => "форма накладки пуста у " + rr.length + " накладок (строки " + sampleRows(rr) + ").");
      if (norm(cellAt(row, "Цвет накладки")) === "")
        errors.add("frameColor", excelRow, (rr) => "цвет накладки пуст у " + rr.length + " накладок (строки " + sampleRows(rr) + ").");
    }

    // --- Тип управления: нераспознанное значение не ломает файл, но авто-подбора не будет ---
    const ctrl = norm(cellAt(row, "Тип управления"));
    if (ctrl && !controlRecognized(ctrl)) {
      warnings.add("ctrl:" + fold(ctrl), excelRow, (rr) => "тип управления «" + ctrl + "» не распознан — " + rr.length + " (строки " + sampleRows(rr) + "); по этим позициям механизм под клавишу не подберётся автоматически.");
    }

    // --- Монтажный стандарт: заполнен, но не распознан ---
    const std = norm(cellAt(row, "Монтажный стандарт"));
    if (std && !standardRecognized(std)) {
      warnings.add("std:" + fold(std), excelRow, (rr) => "монтажный стандарт «" + std + "» не распознан — " + rr.length + " (строки " + sampleRows(rr) + "); ожидается «Итальянский» и/или «Немецкий».");
    }

    // --- Тип стены: заполнен, но не распознан ---
    const wall = norm(cellAt(row, "Тип стены"));
    if (wall && !wallRecognized(wall)) {
      warnings.add("wall:" + fold(wall), excelRow, (rr) => "тип стены «" + wall + "» не распознан — " + rr.length + " (строки " + sampleRows(rr) + "); ожидается «Бетон», «Кирпич» или «ГКЛ».");
    }

    // --- Кол-во в упаковке: если заполнено, должно быть целым числом > 0 ---
    const pack = cellAt(row, "Кол-во в упаковке");
    if (norm(pack) !== "") {
      const ok = (typeof pack === "number" && Number.isInteger(pack) && pack > 0) || /^\d+$/.test(norm(pack));
      if (!ok || (/^\d+$/.test(norm(pack)) && Number(norm(pack)) <= 0))
        warnings.add("packBad", excelRow, (rr) => "кол-во в упаковке не целое число больше нуля — " + rr.length + " (строки " + sampleRows(rr) + "); округления кратно упаковке не будет.");
    }

    // --- Подсветка: признак «спрашивать» — только 1 или пусто; позиция — 1/2/3 или пусто ---
    const ask = norm(cellAt(row, "Спрашивать подсветку 1 - да, пусто - нет"));
    if (ask && ask !== "1")
      warnings.add("askBad", excelRow, (rr) => "«спрашивать подсветку» — " + rr.length + " строк(и) с не 1 и не пусто (" + sampleRows(rr) + "); ожидается 1 или пусто.");
    const pos = norm(cellAt(row, "Позиция подсветки 1 - верх, 2 - центр, 3 - низ"));
    if (pos && !["1", "2", "3"].includes(pos))
      warnings.add("posBad", excelRow, (rr) => "позиция подсветки — " + rr.length + " строк(и) с недопустимым значением (" + sampleRows(rr) + "); ожидается 1, 2 или 3.");
  }

  const errList = errors.list();
  return { ok: errList.length === 0, errors: errList, warnings: warnings.list(), stats };
}

const api = {
  COLUMNS,
  CONTROL_LETTERS,
  FRAME_GROUPS, SUPPORT_GROUPS, BOX_GROUPS, ACCESSORY_GROUPS,
  STANDARD_TOKENS, STANDARD_EXAMPLES, WALL_TOKENS, WALL_EXAMPLES,
  FX_CODE_RE,
  controlRecognized, standardRecognized, wallRecognized, isFrameGroup,
  check,
};

if (typeof window !== "undefined") window.EPPriceTemplate = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
