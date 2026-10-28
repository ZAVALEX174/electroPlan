/* D (К11-3в): подсказка #installSheetPlanHint с атрибутом hidden обязана прятаться. .hint-line —
   это .hint-line{display:block} (авторский слой), а он при РАВНОЙ специфичности (0,1,0) перебивает
   UA-правило [hidden]{display:none} (тоже 0,1,0, но раньше в каскаде) — и подсказка «План с номерами…
   только в листе на весь проект» висела бы и в окне, открытом на весь проект. В браузере это видно,
   но node-тесты CSS не исполняют, поэтому проверяем КАСКАД по тексту styles.css: есть авторское
   правило .hint-line[hidden]{display:none}, и его специфичность СТРОГО ВЫШЕ правила .hint-line{display:block}.
   Удаление правила делает тест красным. Тот же приём, что priceCardHiddenCss.test.js. Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "css", "styles.css"), "utf8");

/* Грубая специфичность как тройка [id, class+attr+pseudo, element] — достаточно сравнить
   .hint-line (0,1,0) и .hint-line[hidden] (0,2,0). */
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classesAttrs = (sel.match(/\.[\w-]+/g) || []).length
    + (sel.match(/\[[^\]]*\]/g) || []).length
    + (sel.match(/:{1,2}[\w-]+/g) || []).length;
  const elements = (sel.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [ids, classesAttrs, elements];
}
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

/* Селектор правила, где для .hint-line задан указанный display. */
function hintRuleWith(displayValue) {
  const re = new RegExp("([^{}\\n;]*\\.hint-line[^{}\\n]*?)\\{[^}]*display\\s*:\\s*" + displayValue + "\\b", "g");
  let m, best = null;
  while ((m = re.exec(CSS))) best = m[1].trim();
  return best;
}

test("styles.css: .hint-line[hidden] действительно скрывается (display:none специфичнее display:block)", () => {
  const blockSel = hintRuleWith("block");
  const noneSel = hintRuleWith("none");
  assert.ok(noneSel, "должно быть авторское правило .hint-line[hidden]{display:none}");
  assert.match(noneSel, /\.hint-line\[hidden\]/,
    "скрытие адресовано именно .hint-line с атрибутом hidden (узко, не глобальный [hidden])");
  /* .hint-line{display:block} ломал hidden; скрытие обязано быть строго специфичнее, иначе при равной
     специфичности победит порядок, а не смысл. */
  if (blockSel) {
    assert.ok(cmp(specificity(noneSel), specificity(blockSel)) > 0,
      `специфичность '${noneSel}' должна быть выше '${blockSel}' — иначе hidden снова проиграет`);
  }
});
