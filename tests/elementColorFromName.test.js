/* Вывод «Цвета элемента» механизма из названия (К12 ч.3, tools/lib/elementColorFromName.mjs):
   столбец главнее названия, словарь учится по сериям из заполненных строк, порог давит шум,
   многословные цвета не путаются с их частями. Плюс факт на собранном каталоге (20003/20003.N).
   Мутационные проверки (сломай «столбец главнее» / сломай порог) — ниже, с пометкой [МУТАЦИЯ]. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
let M;
test.before(async () => { M = await import(pathToFileURL(path.join(ROOT, "tools", "lib", "elementColorFromName.mjs")).href); });

// Запись механизма: минимум полей, которые читает модуль.
const rec = (name, series, color) => ({ name, series, color: color ?? null });

// Эталонный набор обученных строк (столбец заполнен), повторяющий форму реальных данных.
function eikonLearned() {
  return [
    // «серый/серая» → Чёрный (Eikon) — у каждой формы не меньше двух вхождений (порог >= 2)
    rec("Клавиша на 1 модуль серая", ["Eikon"], "Чёрный"),
    rec("Клавиша на 2 модуля серая", ["Eikon"], "Чёрный"),
    rec("Выключатель одинарный серый", ["Eikon"], "Чёрный"),
    rec("Выключатель двойной серый", ["Eikon"], "Чёрный"),
    // «белый/белая» → Белый
    rec("Клавиша на 1 модуль, белая", ["Eikon"], "Белый"),
    rec("Клавиша на 2 модуля белая", ["Eikon"], "Белый"),
    rec("Выключатель одинарный белый", ["Eikon"], "Белый"),
    rec("Выключатель двойной белый", ["Eikon"], "Белый"),
    // «серебро матовое» → Серебристый
    rec("Клавиша на 1 модуль, серебро матовое", ["Eikon"], "Серебристый"),
    rec("Клавиша на 2 модуля серебро матовое", ["Eikon"], "Серебристый"),
    rec("Выключатель одинарный серебро матовое", ["Eikon"], "Серебристый"),
  ];
}

test("Eikon «серая» → «Чёрный»", () => {
  const d = M.buildColorDictionary(eikonLearned());
  assert.equal(M.deriveColorFromName(rec("Выключатель тройной 1P 20AX серый", ["Eikon"]), d), "Чёрный");
});

test("Eikon «серебро матовое» → «Серебристый»", () => {
  const d = M.buildColorDictionary(eikonLearned());
  assert.equal(M.deriveColorFromName(rec("Переключатель тройной 1P 20AX серебро матовое", ["Eikon"]), d), "Серебристый");
  // одиночное «серебро» (без «матовое») тоже Серебристый — слово обучено как часть фразы
  assert.equal(M.deriveColorFromName(rec("Розетка серебро", ["Eikon"]), d), "Серебристый");
});

test("Flat «белые» → «Белые матовые» (ровно 2 образца на цвет — порог обязан это выучить)", () => {
  const flat = [
    rec("Две плоские клавиши без символов, Flat, белые", ["Eikon Flat"], "Белые матовые"),
    rec('Две плоские клавиши, символ "три точки", Flat, белые матовые', ["Eikon Flat"], "Белые матовые"),
    rec("Две плоские клавиши без символов, Flat, антрацит", ["Eikon Flat"], "Антрацит"),
    rec('Две плоские клавиши, символ "три точки", Flat, антрацит', ["Eikon Flat"], "Антрацит"),
  ];
  const d = M.buildColorDictionary(flat);
  assert.equal(M.deriveColorFromName(rec('Две плоские клавиши, символы "ON/OFF", Flat, белые', ["Eikon Flat"]), d), "Белые матовые");
  assert.equal(M.deriveColorFromName(rec('Две плоские клавиши, символы "стрелки", Flat, антрацит', ["Eikon Flat"]), d), "Антрацит");
});

test("заполненный столбец ПОБЕЖДАЕТ название", () => {
  const d = M.buildColorDictionary(eikonLearned());
  // в названии «серый» (словарь сказал бы Чёрный), но столбец говорит «Белый» — берём столбец
  assert.equal(M.resolveElementColor(rec("Выключатель серый", ["Eikon"], "Белый"), d), "Белый");
});

test("серия без обученных строк → цвета нет (Linea/Tondo/Tactil)", () => {
  const d = M.buildColorDictionary(eikonLearned());
  assert.equal(M.deriveColorFromName(rec("Выключатель серый", ["Linea"]), d), null);
  assert.equal(M.resolveElementColor(rec("Выключатель серый", ["Linea"]), d), null);
  // мультисерийный ключ (точный список серий) тоже не совпадает с одиночным «Eikon»
  assert.equal(M.deriveColorFromName(rec("Выключатель серый", ["Plana", "Arke", "Eikon"]), d), null);
});

test("одиночная шумная строка не перебивает большинство", () => {
  const learned = [
    rec("Клавиша серая A", ["Eikon"], "Чёрный"),
    rec("Клавиша серая B", ["Eikon"], "Чёрный"),
    rec("Клавиша серая C", ["Eikon"], "Чёрный"),
    rec("Клавиша серая E", ["Eikon"], "Чёрный"),
    rec("Клавиша серая шум", ["Eikon"], "Белый"),  // одна шумная из пяти
  ];
  const d = M.buildColorDictionary(learned);
  // «серая»: 4 Чёрный + 1 Белый = 80% >= 0.8 → закрепляется Чёрный, шумная строка не победила
  assert.equal(M.deriveColorFromName(rec("Выключатель серая", ["Eikon"]), d), "Чёрный");
});

test("[МУТАЦИЯ порога] две шумные из пяти (60% < 80%) НЕ закрепляются", () => {
  const learned = [
    rec("Клавиша серая A", ["Eikon"], "Чёрный"),
    rec("Клавиша серая B", ["Eikon"], "Чёрный"),
    rec("Клавиша серая C", ["Eikon"], "Чёрный"),
    rec("Клавиша серая D", ["Eikon"], "Белый"),
    rec("Клавиша серая E", ["Eikon"], "Серебристый"),
  ];
  const d = M.buildColorDictionary(learned);
  // 3/5 = 60% < 0.8 → слово «серая» неоднозначно, цвет не выводится. Поднять порог > 0.6 в коде
  // (ослабить защиту от шума) — тест покраснеет: вернётся «Чёрный».
  assert.equal(M.deriveColorFromName(rec("Выключатель серая", ["Eikon"]), d), null);
});

test("«сатинированное золото» не путается с «золото» (самая длинная фраза)", () => {
  // Соседние слова у каждой строки РАЗНЫЕ, чтобы не возникла мостиковая биграмма вокруг «золото»:
  // единственное общее слово плоского цвета — само «золото», и оно 50/50 между двумя цветами.
  const learned = [
    rec("Клавиша на 1 модуль золото", ["Eikon Flat"], "Золото"),
    rec("Розетка силовая золото", ["Eikon Flat"], "Золото"),
    rec("Выключатель двойной сатинированное золото", ["Eikon Flat"], "Сатинированное золото"),
    rec("Диммер поворотный сатинированное золото", ["Eikon Flat"], "Сатинированное золото"),
  ];
  const d = M.buildColorDictionary(learned);
  // фраза «сатинированное золото» однозначна (2/2) и длиннее слова «золото» — побеждает
  assert.equal(M.deriveColorFromName(rec("Панель сатинированное золото", ["Eikon Flat"]), d), "Сатинированное золото");
  // одиночное «золото» встречается в ОБОИХ цветах (2/4 = 50% < 0.8) → неоднозначно, наугад не ставим
  assert.equal(M.deriveColorFromName(rec("Панель золото", ["Eikon Flat"]), d), null);
});

test("сравнение без регистра и с ё=е", () => {
  const learned = [
    rec("Клавиша СЕРАЯ", ["Eikon"], "Чёрный"),
    rec("Выключатель серая", ["Eikon"], "Чёрный"),
  ];
  const d = M.buildColorDictionary(learned);
  // «Серая» в другом регистре всё равно совпадает; цвет возвращается с буквой ё, как в столбце
  assert.equal(M.deriveColorFromName(rec("Розетка Серая", ["Eikon"]), d), "Чёрный");
});

test("факт на собранном каталоге: выведенный цвет — в nameColors, столбец — в colors (К12 ч.3 раунд 2)", () => {
  const win = {};
  new Function("window", fs.readFileSync(path.join(ROOT, "js", "catalog-vimar-attrs.js"), "utf8"))(win);
  const colors = win.EP_VIMAR_ATTRS.colors;
  const nameColors = win.EP_VIMAR_ATTRS.nameColors;
  // Выведенный из названия цвет лежит ОТДЕЛЬНО в nameColors (решение владельца 31.10 раунд 2: в colors/
  // elementColor он не идёт, чтобы смета считалась как в HEAD). 20003 «…серый» (столбец пуст) → nameColors
  // «Чёрный»; 20003.N «…серебро матовое» → «Серебристый»; 20003.B «…белый» → «Белый». В colors их НЕТ.
  assert.equal(nameColors["20003"], "Чёрный");
  assert.equal(nameColors["20003.B"], "Белый");
  assert.equal(nameColors["20003.N"], "Серебристый");
  assert.equal(colors["20003"], undefined);
  assert.equal(colors["20003.B"], undefined);
  // 20021 имеет ЗАПОЛНЕННЫЙ столбец «Чёрный» (название «серая») — он в colors, в nameColors его нет.
  assert.equal(colors["20021"], "Чёрный");
  assert.equal(nameColors["20021"], undefined);
});
