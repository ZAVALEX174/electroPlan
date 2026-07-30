/* Коммерческое предложение (печать/PDF) — сборка HTML-документа (PLAN 2.1).
   Модуль знает только про готовую смету (est из EPEstimate.build) и форматтеры,
   переданные аргументами: ни state, ни window.open, ни toast. Открытие окна и
   расчёт остаются в app.js. Так HTML КП можно проверить автотестом, не поднимая
   браузер (PLAN 7.1).

   Интерфейс приложению — window.EPOfferPdf.buildHtml(est, deps). */
(() => {
"use strict";

/* est   — результат EPEstimate.build (groups, equipment, discount, vat, total, …)
   deps  — { money(n), esc(s), displayCurrency(), effectiveRate(settings), settings }
   Возвращает строку полного HTML-документа с авто-печатью. */
function buildHtml(est, deps) {
  const money = deps.money;
  const esc = deps.esc;
  const displayCurrency = deps.displayCurrency;
  const s = deps.settings || {};
  const { materials, work, total } = est;

  /* Подвал с курсом печатаем честно. Суммы в КП уже пересчитаны money() по
     эффективному курсу; здесь важно не выдать курс с надбавкой за официальный
     курс ЦБ РФ — документ уходит клиенту. Показываем обе величины, а при
     надбавке 0 (или ручном курсе, где надбавка не применяется) — как раньше. */
  const rateFooter = () => {
    const base = Number(s.eurRate) || 0;
    const eff = deps.effectiveRate ? deps.effectiveRate(s) : base;
    const isManual = s.rateSource === "вручную";
    const pct = Number(s.rateSurchargePercent) || 0;
    const src = esc(s.rateSource || "вручную");
    const dateNote = s.rateDate ? " от " + new Date(s.rateDate).toLocaleDateString("ru-RU") : "";
    /* Дробная часть курса — через запятую: в русском коммерческом документе точка
       как десятичный разделитель неуместна («92,5000 ₽», а не «92.5000 ₽»). */
    const rub = n => n.toFixed(4).replace(".", ",");
    const body = (!isManual && pct > 0)
      ? `по курсу ${src} ${rub(base)} ₽ + ${pct}% = ${rub(eff)} ₽ за 1 €`
      : `по курсу 1 € = ${rub(eff)} ₽ (${src}${dateNote})`;
    return `<div class="footer">Пересчёт из евро ${body}. Курс на дату выставления предложения.</div>`;
  };

  /* позиции группируются, поэтому в КП честное «Кол.» вместо жёсткой единицы */
  const rows = est.groups.map(g => ({
    name: g.name, composition: g.composition, qty: g.count, unit: g.unit,
    price: g.count ? g.sum / g.count : 0, sum: g.sum
  }));

  return `<!doctype html><html><head><meta charset="utf-8"><title>Коммерческое предложение</title><style>
  @page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#172b3f;font-size:12px}h1{font-size:24px;color:#1675c8;margin:0 0 4px}.sub{color:#687f94;margin-bottom:24px}.meta{display:flex;justify-content:space-between;margin-bottom:20px}.box{padding:12px;background:#edf6ff;border-radius:10px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:9px;border-bottom:1px solid #d8e6f2;text-align:left}th{background:#e8f4ff;color:#185d96}.right{text-align:right}.totals{width:340px;margin:22px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px}.grand{font-size:16px;font-weight:bold;color:white;background:#1675c8;border-radius:8px}.footer{margin-top:35px;color:#687f94;font-size:10px}@media print{button{display:none}}</style></head><body>
  <h1>Коммерческое предложение</h1><div class="sub">Проект электрики и комплектация электроустановочных изделий</div>
  <div class="meta"><div class="box"><b>Проект:</b> ElectroPlan<br><b>Дата:</b> ${new Date().toLocaleDateString("ru-RU")}</div><button onclick="window.print()">Сохранить в PDF</button></div>
  <table><thead><tr><th>№</th><th>Наименование</th><th>Состав / артикул</th><th>Кол.</th><th>Ед.</th><th class="right">Цена</th><th class="right">Сумма</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.composition)}</td><td>${r.qty}</td><td>${esc(r.unit)}</td><td class="right">${money(r.price)}</td><td class="right">${money(r.sum)}</td></tr>`).join("")}
  </tbody></table>
  <div class="totals"><div><span>Оборудование</span><b>${money(est.equipment)}</b></div>
  ${est.discount ? `<div><span>Скидка ${est.discountPercent}%</span><b>−${money(est.discount)}</b></div>` : ""}
  <div><span>Монтажные материалы</span><b>${money(materials)}</b></div><div><span>Работы</span><b>${money(work)}</b></div>
  ${est.vat ? `<div><span>Итого без НДС</span><b>${money(est.subtotal)}</b></div><div><span>НДС ${est.vatPercent}%</span><b>${money(est.vat)}</b></div>` : ""}
  <div class="grand"><span>Итого${est.vat ? " с НДС" : ""}</span><b>${money(total)}</b></div></div>
  ${displayCurrency() === "RUB" ? rateFooter() : ""}
  <div class="footer">Цены являются ориентировочными и могут быть уточнены после согласования бренда, серии оборудования и условий монтажа.</div>
  <script>setTimeout(()=>window.print(),500)<\/script></body></html>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { buildHtml };
if (typeof window !== "undefined") window.EPOfferPdf = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
