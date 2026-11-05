/* Блок денежных итогов документа + оговорка о неполноте — ОДНА вёрстка на КП (offerPdf) и
   экспликацию по комнатам (roomSheet). Решение владельца 05.11 «экспликация считает как в КП»:
   «Оборудование», «Скидка», «Монтажные материалы», «Работы», «Итого без НДС», «НДС» и «Итого с НДС»
   обязаны выйти теми же цифрами и тем же блоком, что в КП. Пока блок жил только в offerPdf, второй
   документ либо копировал бы его арифметику и разметку (§7.1: у копии правка имеет края), либо считал
   «Итого по проекту» мимо сметы. Поэтому строим его ЗДЕСЬ, а оба документа лишь вставляют готовую строку.

   Чистый модуль (ни DOM, ни state): на вход — смета est (EPEstimate.build) и форматтеры, на выход — строка
   HTML. Все числа приходят из EPEstimate.totalsShown/discountShown/discountLabel (валюта показа, округление
   под валюту — второй копии арифметики нет), оговорка — из EPEstimate.pricelessNote. CSS-классы
   (.totals/.grand/.priceless) задаёт <style> каждого документа — у КП и экспликации они одинаковы.

   deps = { moneyShown(n), esc(s), rate, currency, prices?, EPEstimate? }
     rate/currency — множитель и валюта показа (как у КП: displayRate()/displayCurrency());
     prices — печатать ли денежный блок (в КП — options.prices; у экспликации всегда true). Оговорка
       печатается и без цен — тогда своей формулировкой (как в КП), т.к. сумма всё равно неполна;
     EPEstimate — точка подмены для теста; в приложении namespace берётся из window/require.

   ⚠️ БАЙТ-В-БАЙТ С КП. Внутренние переводы строк (`\n  `) и порядок строк воспроизводят прежний
   шаблон offerPdf: footerHtml вставляется в КП на место двух прежних дырок `${totals}`/`${priceless}`,
   поэтому склейка «блок + \n␣␣ + оговорка» обязана совпасть с тем, что печаталось между topUpSection и
   подвалом курса. Продолжения строк в шаблоне ниже намеренно на отступе в 2 пробела — это те самые байты. */
(() => {
"use strict";

/* Резолвим EPEstimate как offerPdf/roomSheet свои зависимости: в браузере namespace уже загружен
   (estimate.js подключён раньше), в Node — через require. Без модуля блок считать нечем — отдаём "". */
function estApi() {
  if (typeof window !== "undefined" && window.EPEstimate) return window.EPEstimate;
  if (typeof require !== "undefined") return require("./estimate.js");
  return null;
}

/* Добор до целых упаковок (К6б) — тем же EPPackTopUp, что смета/КП/Excel (§7.1). Резолвим как EPEstimate. */
function packTopUpApi() {
  if (typeof window !== "undefined" && window.EPPackTopUp) return window.EPPackTopUp;
  if (typeof require !== "undefined") return require("./packTopUp.js");
  return null;
}

function footerHtml(est, deps) {
  const d = deps || {};
  const esc = typeof d.esc === "function" ? d.esc : (s => String(s));
  const estimate = d.EPEstimate || estApi();
  if (!estimate) return "";
  const rate = Number(d.rate) > 0 ? Number(d.rate) : 1;
  const currency = d.currency || "EUR";
  const prices = d.prices !== false;
  const moneyShown = typeof d.moneyShown === "function" ? d.moneyShown : (n => String(n));
  const totals = estimate.totalsShown(est, rate, currency);
  const pricelessNote = estimate.pricelessNote(est);
  const e = est || {};
  const missingLen = ((e.missing) || []).length;
  /* Денежный блок — ровно те строки и гейты, что печатал КП. Вторую копию арифметики не заводим:
     все числа из totals, видимость строки «Скидка» — по discountShown>0, режим НДС — по est.vat. */
  const totalsBlock = prices ? `<div class="totals"><div><span>Оборудование</span><b>${moneyShown(totals.equipment)}</b></div>
  ${estimate.discountShown(e, rate, currency) > 0 ? `<div><span>${estimate.discountLabel(e.discountMixed, e.discountPercent)}</span><b>−${moneyShown(totals.discount)}</b></div>` : ""}
  <div><span>Монтажные материалы</span><b>${moneyShown(totals.materials)}</b></div><div><span>Работы</span><b>${moneyShown(totals.work)}</b></div>
  ${e.vat && !e.vatIncluded ? `<div><span>Итого без НДС</span><b>${moneyShown(totals.subtotal)}</b></div><div><span>${esc(e.vatLabel || "НДС")} ${e.vatPercent}%</span><b>${moneyShown(totals.amount)}</b></div>` : ""}
  <div class="grand"><span>Итого${e.vat && !e.vatIncluded ? " с НДС" : ""}</span><b>${moneyShown(totals.total)}</b></div>
  ${e.vat && e.vatIncluded ? `<div><span>${esc(e.vatLabel || "в т.ч. НДС")} ${e.vatPercent}%</span><b>${moneyShown(totals.amount)}</b></div>` : ""}</div>` : "";
  /* Оговорка о позициях без цены — та же, что на экране и в КП (EPEstimate.pricelessNote). Без цен —
     прежней формулировкой КП (считает пропавшие числом), чтобы неполнота суммы не замалчивалась. */
  const priceless = pricelessNote ? `<div class="priceless">${prices ? esc(pricelessNote) : `Позиций без товара в каталоге: ${missingLen}. Проверьте состав проекта перед передачей документа.`}</div>` : "";
  return `${totalsBlock}
  ${priceless}`;
}

/* Раздел «Добор до целых упаковок» — ОДНА вёрстка на КП (offerPdf) и экспликацию (решение владельца
   05.11 «добор разделом, как в КП»). Поставщик отгружает целыми упаковками, и разницу «упаковка −
   потребность» заказчик видит отдельным разделом ПЕРЕД итогами. Строки добора — синтетические группы
   сметы (g.topUp, EPPackTopUp.splitRows) с печатными ценами из specShown (валюта показа, К7) — второй
   копии арифметики нет (§7.1). Печатается, КОГДА добор есть; нет — "" (как в КП).
   deps = { esc, moneyShown, rate, currency, options, itemText } — те же, что у КП: options задаёт набор
   столбцов (№/Артикул/Цена/Сумма), itemText чистит коды из имени при выключенных артикулах.
   ⚠️ БАЙТ-В-БАЙТ С КП: разметка и переводы строк (2 пробела в продолжениях) повторяют прежний topUpSection
   из offerPdf — функция вставляется в оба документа как готовая строка на то же место. */
function topUpSectionHtml(est, deps) {
  const d = deps || {};
  const esc = typeof d.esc === "function" ? d.esc : (s => String(s));
  const moneyShown = typeof d.moneyShown === "function" ? d.moneyShown : (n => String(n));
  const estimate = d.EPEstimate || estApi();
  const topUp = packTopUpApi();
  if (!estimate || !topUp) return "";
  const rate = Number(d.rate) > 0 ? Number(d.rate) : 1;
  const currency = d.currency || "EUR";
  const options = d.options || {};
  const itemText = typeof d.itemText === "function" ? d.itemText : ((v) => v);
  const spec = estimate.specShown(est, rate, currency);
  const split = topUp.splitRows(est, spec);
  if (!split.topUp.length) return "";
  /* Набор столбцов — ЕДИНОЕ правило EPPackTopUp.topUpColumns (то же, что у Excel и КП); нет функции —
     прежний набор. Гейты (№/артикулы/цены) — по тем же опциям, что КП. */
  const topUpColumns = topUp.topUpColumns ? topUp.topUpColumns(options) : [
    ...(options.specification && options.specification.number ? [["number", "№"]] : []),
    ...(options.articles ? [["article", "Артикул"]] : []),
    ["name", "Наименование"], ["added", "Добавлено"],
    ...(options.prices ? [["price", "Цена"], ["sum", "Сумма"]] : [])
  ];
  const topUpRow = ({ g, i }, n) => {
    const code = (g.items && g.items[0] && g.items[0].code) || "";
    const r = spec.rows[i] || {};
    const cell = {
      number: n + 1, article: esc(code), name: `<b>${esc(itemText(g.name, code || null))}</b>`,
      added: `${Number(g.count) || 0} ${esc(g.unit)}`, price: moneyShown(r.price), sum: moneyShown(r.sum)
    };
    return `<tr>${topUpColumns.map(([key]) => `<td class="${["price", "sum"].includes(key) ? "right" : ""}">${cell[key]}</td>`).join("")}</tr>`;
  };
  return `<h2 class="section-title">Добор до целых упаковок</h2>
  <table class="specification"><thead><tr>${topUpColumns.map(([key, label]) => `<th${["price", "sum"].includes(key) ? ' class="right"' : ""}>${esc(label)}</th>`).join("")}</tr></thead><tbody>
  ${split.topUp.map((e, n) => topUpRow(e, n)).join("")}
  </tbody></table>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для тестов. */
const api = { footerHtml, topUpSectionHtml };
if (typeof window !== "undefined") window.EPDocTotals = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
