/* РЕГРЕСС ВЁРСТКИ: атрибут hidden обязан прятать строку итога в панели «Стоимость проекта».
   Строки #discountRow/#vatRow/#vatIncludedRow — это .price-card, а .price-card{display:flex}
   (авторский слой) перебивает UA-правило [hidden]{display:none} — hidden игнорировался, и в панели
   висели пустые «0,00 €» (режим «Не учитывать») и дубль «в т.ч. НДС» (режим «Выделить»). В браузере
   это видно, но node-тесты CSS не исполняют, поэтому проверяем КАСКАД по тексту styles.css:
   существует авторское правило, которое для .price-card[hidden] ставит display:none, и его
   специфичность СТРОГО ВЫШЕ, чем у правила, задающего .price-card{display:flex} — значит скрытие
   реально победит. Удаление правила делает тест красным. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "css", "styles.css"), "utf8");

/* Грубая специфичность селектора как тройка [id, class+attr+pseudo, element] — этого достаточно,
   чтобы сравнить .price-card (0,1,0) и .price-card[hidden] (0,2,0). Комментарии CSS сюда не
   попадают: селекторы берём из конкретных найденных правил. */
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classesAttrs = (sel.match(/\.[\w-]+/g) || []).length
    + (sel.match(/\[[^\]]*\]/g) || []).length
    + (sel.match(/:{1,2}[\w-]+/g) || []).length;
  const elements = (sel.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [ids, classesAttrs, elements];
}
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

/* Селектор правила, где для .price-card задан указанный display. Возвращает сам селектор
   (левую часть перед `{`), чтобы посчитать его специфичность. */
function priceCardRuleWith(displayValue) {
  const re = new RegExp("([^{}\\n;]*\\.price-card[^{}\\n]*?)\\{[^}]*display\\s*:\\s*" + displayValue + "\\b", "g");
  let m, best = null;
  while ((m = re.exec(CSS))) best = m[1].trim();
  return best;
}

test("styles.css: .price-card[hidden] действительно скрывается (display:none специфичнее display:flex)", () => {
  const flexSel = priceCardRuleWith("flex");
  const noneSel = priceCardRuleWith("none");
  assert.ok(noneSel, "должно быть авторское правило .price-card[hidden]{display:none}");
  assert.match(noneSel, /\.price-card\[hidden\]/,
    "скрытие адресовано именно .price-card с атрибутом hidden (узко, не глобальный [hidden])");
  /* Если .price-card{display:flex} есть — именно оно ломало hidden; скрытие обязано быть строго
     специфичнее, иначе при равной специфичности победит порядок, а не смысл. */
  if (flexSel) {
    assert.ok(cmp(specificity(noneSel), specificity(flexSel)) > 0,
      `специфичность '${noneSel}' должна быть выше '${flexSel}' — иначе hidden снова проиграет`);
  }
});
