"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Template = require("../js/priceTemplate.js");
const Catalog = require("../js/priceCatalog.js");
const TemplateFile = require("../js/priceTemplateFile.js");
const XLSX = require("xlsx");

const header = Template.COLUMNS.map(c => c.name);
const row = values => header.map(name => values[name] == null ? "" : values[name]);
const base = (code, name, group, extras) => ({
  "Артикул": code, "Наименование": name, "Прайс розница РФ, Евро": "12,50",
  "Кол-во в упаковке": "10", "Коллекция": "Arke", "Функциональная группа": group,
  ...extras
});

test("К9: проверенный шаблон раскладывает накладку, механизм и коробку по полям каталога", () => {
  const rows = [header,
    row(base("F-4", "Рамка (2+2)", "Рамка", {
      "Количество модулей": "2+2", "Монтажный стандарт": "Итальянский и Немецкий",
      "Материал накладки": "Технополимер", "Форма накладки": "Классика", "Цвет накладки": "Белая",
      "Принцип обработки": "TEST", "Модульность для коробки": "4"
    })),
    row(base("M-1", "Клавиша белая", "Управление светом", {
      "Количество модулей": "1", "Тип управления": "П", "Цвет механизма": "Белый",
      "Подгруппы": "Выключатели", "Спрашивать подсветку 1 - да, пусто - нет": "1"
    })),
    row(base("B-2", "Коробка круглая", "Монтажная коробка", {
      "Количество модулей": "1, 2", "Тип стены": "Бетон"
    }))
  ];
  const old = [{ id: 81, code: "M-1", kind: "mechanism", name: "Старое", price: 9, imageUrl: "img/m.jpg" }];
  const snapshot = JSON.stringify(old);
  const result = Catalog.convert(rows, { existingProducts: old });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.changes, { added: 2, updated: 1, unchanged: 0 });
  const by = code => result.products.find(p => p.code === code);
  assert.equal(by("F-4").id, 82);
  assert.equal(by("F-4").slotCount, 4);
  assert.equal(by("F-4").standard, "BOTH");
  assert.deepEqual(by("F-4").layoutRows, [[2, 2]]);
  assert.equal(by("F-4").postCount, 2);
  assert.equal(by("F-4").frameMaterial, "Технополимер");
  assert.equal(by("F-4").principle, "TEST");
  assert.equal(by("F-4").boxModularity, 4);
  assert.equal(by("M-1").id, 81, "артикул сохраняет прежний ID");
  assert.equal(by("M-1").price, 12.5);
  assert.equal(by("M-1").imageUrl, "img/m.jpg", "изображение прежнего товара сохранено");
  assert.equal(by("M-1").partRole, "key");
  assert.equal(by("M-1").controlRole, "changeover");
  assert.equal(by("M-1").elementColor, "Белый");
  assert.equal(by("M-1").packQty, 10);
  assert.equal(by("B-2").boxModules, 2);
  assert.equal(by("B-2").wallType, "solid");
  assert.deepEqual(by("B-2").boxStandards, ["IT_ROUND", "DE", "FR"]);
  assert.equal(JSON.stringify(old), snapshot, "входной каталог не мутирует до публикации");
});

test("К9: ошибки шаблона блокируют преобразование, а .FX и пустые строки не становятся товарами", () => {
  const frame = base("F-1", "Рамка", "Рамка", {
    "Количество модулей": "3", "Монтажный стандарт": "Итальянский",
    "Материал накладки": "Металл", "Форма накладки": "Классика", "Цвет накладки": "Чёрная"
  });
  const bad = Catalog.convert([header, row({ ...frame, "Прайс розница РФ, Евро": "" })]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.products, []);
  const good = Catalog.convert([header, row(frame), row(base("14000.FX", "WAGO", "Механизм")), []]);
  assert.equal(good.ok, true);
  assert.deepEqual(good.products.map(p => p.code), ["F-1"]);
});

test("К9: настоящий скачиваемый Excel проходит сквозь чтение листа и преобразователь", () => {
  const wb = XLSX.read(Buffer.from(TemplateFile.build().bytes), { type: "buffer" });
  const sheet = wb.Sheets["Прайс"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  const result = Catalog.convert(rows);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.products.map(p => [p.code, p.kind, p.price]), [
    ["09661.01", "frame", 3.12], ["09001", "mechanism", 4.3], ["14600", "support", 3.14]
  ]);
  assert.equal(result.products[0].standard, "BOTH");
  assert.equal(result.products[0].frameColor, "Белый");
  assert.equal(result.products[1].controlRole, "switch");
  assert.equal(result.products[2].moduleCount, 1);
});

test("К9: группа «Механизм» с ролью П становится голым проходным механизмом", () => {
  const result = Catalog.convert([header, row(base("S-1", "Переключатель", "Механизм", {
    "Тип управления": "П", "Количество модулей": "1"
  }))]);
  assert.equal(result.ok, true);
  assert.equal(result.products[0].partRole, "bare_mechanism");
  assert.equal(result.products[0].controlRole, "changeover");
});

test("К9: пустые ячейки снимают старые признаки, а служебные поля читаются из шаблона", () => {
  const old = [{ id: 17, code: "M-2", kind: "mechanism", packQty: 10,
    controlRole: "switch", backlightColor: "Синий", accessGroup: 3, note: "Старая" }];
  const rows = [header, row(base("M-2", "Розетка", "Розетки", {
    "Кол-во в упаковке": "", "Примечание": "Новая", "Группа доступа": "2"
  }))];
  const result = Catalog.convert(rows, { existingProducts: old });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.products[0].id, 17);
  assert.equal(result.products[0].packQty, undefined);
  assert.equal(result.products[0].controlRole, undefined);
  assert.equal(result.products[0].backlightColor, undefined);
  assert.equal(result.products[0].accessGroup, 2);
  assert.equal(result.products[0].note, "Новая");
});

test("К9: накладка с названием клавиши не получает роль механизма", () => {
  const result = Catalog.convert([header, row(base("F-K", "Клавиша в рамке", "Рамка и Клавиша", {
    "Количество модулей": "1", "Монтажный стандарт": "Итальянский",
    "Материал накладки": "Пластик", "Форма накладки": "Классика", "Цвет накладки": "Белый",
    "Тип управления": "В"
  }))]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.products[0].kind, "frame");
  assert.equal(result.products[0].partRole, undefined);
  assert.equal(result.products[0].controlRole, undefined);
});

test("К9: шаблон без товаров не считается пригодным к загрузке", () => {
  const result = Catalog.convert([header]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /нет товаров/);
});

test("К9: дополнительные поля двух номенклатур и ссылка на фото попадают в товар", () => {
  const rows = [header, row(base("M-3", "Кнопка", "Механизм", {
    "Бренд": "VIMAR", "Описание особенностей элемента": "Без суппорта",
    "Подпись для картинки": "Клавиша", "Кодировка цвета накладки": "01",
    "Изображение": "https://example.com/photo.jpg"
  }))];
  const old = [{ id: 22, code: "M-3", kind: "mechanism", imageUrl: "img/old.jpg",
    previewImageUrl: "img/old.webp" }];
  const result = Catalog.convert(rows, { existingProducts: old });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const product = result.products[0];
  assert.equal(product.brand, "VIMAR");
  assert.equal(product.description, "Без суппорта");
  assert.equal(product.imageCaption, "Клавиша");
  assert.equal(product.frameColorCode, "01");
  assert.equal(product.imageUrl, "https://example.com/photo.jpg");
  assert.equal(product.previewImageUrl, undefined, "превью старого фото сброшено");
});

test("К9: опасный адрес изображения останавливает импорт", () => {
  const result = Catalog.convert([header, row(base("M-4", "Кнопка", "Механизм", {
    "Изображение": "javascript:alert(1)"
  }))]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.products, []);
  assert.ok(result.errors.some(e => e.key === "imageBad"));
});
