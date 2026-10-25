/* Генерация Excel-шаблона прайса (К9, часть 2 — утверждено владельцем 24.10):
   «„Скачать шаблон“ (Excel с нужными программе столбцами в нужном порядке, у каждого — пояснение,
   „обязательно/желательно“, допустимые значения и пример заполненных строк)».

   Книга из ДВУХ листов:
     «Прайс»      — строка заголовков = все столбцы шаблона в их порядке, ниже 3 строки-примера
                    (накладка, механизм, суппорт), которые проходят проверку EPPriceTemplate.check();
     «Пояснения»  — по строке на столбец: обязательность, для каких товаров, что это, допустимые
                    значения, пример.

   ⚠ ИСТОЧНИК СТОЛБЦОВ ОДИН (§7.1). И заголовки, и лист «Пояснения» строятся из EPPriceTemplate.COLUMNS
   — второго списка столбцов здесь нет: добавится/переименуется столбец в priceTemplate.js — шаблон
   поедет за ним сам. Строки-примеры хранятся по ИМЕНИ столбца (не по позиции), поэтому перестановка
   столбцов в COLUMNS их не ломает.

   ⚠ ПИСАТЕЛЬ xlsx НЕ ДУБЛИРУЕТСЯ. Низкоуровневый OOXML/zip-писатель — в specExcel.js; здесь берём из
   него sheetXml/stylesXml/workbookBytes и конструкторы ячеек txt/num (window-глобал или require —
   тот же приём разрешения зависимостей, что в specExcel/offerPdf). Денежного формата шаблону не нужно,
   но styles.xml один на книгу и всё равно несёт стиль шапки S_HEADER — валюту передаём «EUR» как
   нейтральную (денежных ячеек в шаблоне нет, на вид она не влияет).

   Чистый модуль: ни DOM, ни state, ни window. build() -> { bytes: Uint8Array, fileName }. Скачивание
   (Blob + a[download]) и кнопка — часть 3, в оркестраторе.

   Двойной экспорт: браузеру — window.EPPriceTemplateFile (сборщика нет, PLAN 2.2), Node — module.exports. */
(() => {
"use strict";

function templateApi() {
  if (typeof window !== "undefined" && window.EPPriceTemplate) return window.EPPriceTemplate;
  if (typeof require !== "undefined") return require("./priceTemplate.js");
  return null;
}
function excelApi() {
  if (typeof window !== "undefined" && window.EPSpecExcel) return window.EPSpecExcel;
  if (typeof require !== "undefined") return require("./specExcel.js");
  return null;
}

/* Строки-примеры — РЕАЛЬНЫЕ позиции файла заказчика «Номенклатура 2026-10-10.xls» (лист VIMAR),
   по одной каждого вида. Значения заданы по ИМЕНИ столбца; типы — как в файле (код — строкой, чтобы
   Excel не съел «.0»/ведущие нули; цена/упаковка/модули — числами). Незаполненные у позиции столбцы
   опускаем — программа их и так считает пустыми.
   НАКЛАДКЕ дозаполнены отделочные столбцы (Цвет/Материал/Форма накладки): в файле заказчика они ПУСТЫ
   у всех накладок (именно поэтому проверка реального файла требует их заполнить) — а шаблон обязан
   показать заполненный пример, поэтому ставим значения, согласованные с названием позиции («…белая»).
   Это ЕДИНСТВЕННЫЕ выдуманные значения; всё остальное — из файла. */
const EXAMPLES = [
  // Накладка — артикул 09661.01 (Excel-строка 269). Отделка (Цвет/Материал/Форма) — пример, в файле пусто.
  {
    "Артикул": "09661.01",
    "Наименование": "Накладка на 1 модуль центрально для коробки на 2 модуля, белая",
    "Прайс розница РФ, Евро": 3.12,
    "Кол-во в упаковке": 10,
    "Количество модулей": 1,
    "Коллекция": "NEVE UP",
    "Функциональная группа": "Рамка",
    "Монтажный стандарт": "Итальянский и Немецкий",
    "Количество уровней в рамке": 1,
    "Цвет накладки": "Белый",
    "Материал накладки": "Технополимер",
    "Форма накладки": "Классика",
  },
  // Механизм управления светом — артикул 09001 (Excel-строка 124). Всё из файла.
  {
    "Артикул": "09001",
    "Наименование": "Выключатель 1П 16AX 1 модуль, белый",
    "Прайс розница РФ, Евро": 4.3,
    "Кол-во в упаковке": 50,
    "Количество модулей": 1,
    "Коллекция": "NEVE UP",
    "Тип управления": "В",
    "Функциональная группа": "Управление светом",
  },
  // Суппорт — артикул 14600 (Excel-строка 621). Всё из файла.
  {
    "Артикул": "14600",
    "Наименование": "Суппорт для 1 модуля без винтов, серый",
    "Прайс розница РФ, Евро": 3.14,
    "Кол-во в упаковке": 20,
    "Количество модулей": 1,
    "Коллекция": "PLANA",
    "Функциональная группа": "Суппорт",
    "Тип стены": "ГКЛ",
    "Монтажный стандарт": "Итальянский и Немецкий",
  },
];

const FILE_NAME = "Шаблон прайса ElectroPlan.xlsx";

/* Ячейка значения примера: число — числовой ячейкой (Excel увидит число), остальное — текстом.
   Пустую клетку опускаем (null), чтобы лист не нёс пустых inlineStr. */
function valueCell(X, v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return X.num(v);
  return X.txt(String(v));
}

/* Собрать книгу-шаблон. Возвращает { bytes: Uint8Array, fileName }. */
function build() {
  const T = templateApi();
  const X = excelApi();
  if (!T || !X) throw new Error("EPPriceTemplateFile: нет EPPriceTemplate/EPSpecExcel");
  const COLUMNS = T.COLUMNS;

  /* --- Лист «Прайс»: шапка = имена столбцов в порядке COLUMNS, ниже строки-примеры. --- */
  const priceHeader = COLUMNS.map((c) => X.txt(c.name, X.S_HEADER));
  const priceRows = EXAMPLES.map((ex) => COLUMNS.map((c) => valueCell(X, ex[c.name])));
  const priceWidths = COLUMNS.map((c) => Math.min(42, Math.max(14, c.name.length + 2)));
  const priceSheet = X.sheetXml([priceHeader, ...priceRows], priceWidths);

  /* --- Лист «Пояснения»: по строке на столбец, все поля из COLUMNS. --- */
  const explHeaderLabels = ["Столбец", "Обязательно/желательно", "Для каких товаров", "Что это", "Допустимые значения", "Пример"];
  const explHeader = explHeaderLabels.map((l) => X.txt(l, X.S_HEADER));
  const explRows = COLUMNS.map((c) => [
    X.txt(c.name),
    X.txt(c.required ? "Обязательно" : "Желательно"),
    X.txt(c.appliesTo),
    X.txt(c.explain),
    X.txt(c.allowed),
    X.txt(c.example == null ? "" : String(c.example)),
  ]);
  const explWidths = [34, 22, 30, 56, 56, 26];
  const explSheet = X.sheetXml([explHeader, ...explRows], explWidths);

  const bytes = X.workbookBytes([
    { name: "Прайс", xml: priceSheet },
    { name: "Пояснения", xml: explSheet },
  ], X.stylesXml("EUR"));
  return { bytes, fileName: FILE_NAME };
}

const api = { build, FILE_NAME };
if (typeof window !== "undefined") window.EPPriceTemplateFile = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
