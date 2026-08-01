/* Коммерческое предложение (печать/PDF) — сборка HTML-документа (PLAN 2.1).
   Модуль знает только про готовую смету (est из EPEstimate.build) и форматтеры,
   переданные аргументами: ни state, ни window.open, ни toast. Открытие окна и
   расчёт остаются в app.js. Так HTML КП можно проверить автотестом, не поднимая
   браузер (PLAN 7.1).

   Интерфейс приложению — window.EPOfferPdf.buildHtml(est, deps). */
(() => {
"use strict";

/* Автопечать окна КП: печатаем НЕ по таймеру, а когда догрузятся картинки (иллюстрации постов
   тянутся с vimar.ru и за прежние 500 мс могли не успеть — сборка уезжала в PDF недогруженной).
   Все <img> уже complete → печать сразу; иначе ждём load/error каждой незагруженной и печатаем на
   нуле счётчика. Сверху предохранитель 4000 мс, чтобы одна битая картинка не подвесила печать
   навсегда. Флаг done — печать ровно один раз. Инлайн-скрипт: в окне печати наших модулей нет. */
const printScript = `<script>(function(){var done=false;function pr(){if(done)return;done=true;window.print();}`
  + `var imgs=[].slice.call(document.images),pending=0;`
  + `imgs.forEach(function(img){if(img.complete)return;pending++;`
  + `function tick(){if(--pending===0)pr();}`
  + `img.addEventListener("load",tick);img.addEventListener("error",tick);});`
  + `if(pending===0)pr();setTimeout(pr,4000);})();<\/script>`;

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

  /* Шапка документа (PLAN 5): поля из панели проекта. Печатаем только заполненные —
     «Клиент: —» в уходящем клиенту документе не нужен. Дата по умолчанию — сегодня. */
  const h = deps.header || {};
  const headerRows = [
    ["Проект", h.project], ["Клиент", h.client], ["Адрес объекта", h.address],
    ["Разработчик", h.developer], ["Дата", h.date || new Date().toLocaleDateString("ru-RU")],
    ["Номер КП", h.number]
  ].filter(([, v]) => v != null && String(v).trim() !== "")
   .map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join("<br>");

  /* Раздел «Раскладка постов» (PLAN 1) — перед позиционной таблицей: по строке на пост,
     наполнение словами с количеством (а не список артикулов), модульность отдельной
     колонкой и иллюстрация собранного поста. Артикулы остаются ниже, в спецификации.
     Постов в проекте нет — раздел не печатаем. */
  const layout = deps.postLayout || [];
  const layoutSection = layout.length ? `<h2 class="section-title">Раскладка постов</h2>
  <table class="layout"><thead><tr><th>№&nbsp;поста</th><th>Наполнение</th><th>Модульность</th><th>Иллюстрация</th></tr></thead><tbody>
  ${layout.map(p => `<tr><td class="pl-num">${esc(p.number)}</td>
    <td>${(p.fill || []).map(f => `${esc(f.word)} — ${Number(f.count) || 0}`).join("<br>") || "—"}</td>
    <td>${Number(p.modules) || 0}</td>
    <td class="pl-illus">${p.assembledImageHtml || (p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.frameName || ("Пост № " + p.number))}">` : "—")}</td></tr>`).join("")}
  </tbody></table>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Коммерческое предложение</title><style>
  @page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#172b3f;font-size:12px}h1{font-size:24px;color:#1675c8;margin:0 0 4px}.sub{color:#687f94;margin-bottom:24px}.meta{display:flex;justify-content:space-between;margin-bottom:20px}.box{padding:12px;background:#edf6ff;border-radius:10px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:9px;border-bottom:1px solid #d8e6f2;text-align:left}th{background:#e8f4ff;color:#185d96}.right{text-align:right}.totals{width:340px;margin:22px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px}.grand{font-size:16px;font-weight:bold;color:white;background:#1675c8;border-radius:8px}.footer{margin-top:35px;color:#687f94;font-size:10px}.section-title{font-size:16px;color:#185d96;margin:26px 0 4px}.layout td.pl-num{font-weight:bold;color:#185d96;text-align:center}.layout td.pl-illus{text-align:center}.layout td.pl-illus>img{max-height:56px;max-width:96px;object-fit:contain}@media print{button{display:none}}</style></head><body>
  <h1>Коммерческое предложение</h1><div class="sub">Проект электрики и комплектация электроустановочных изделий</div>
  <div class="meta"><div class="box">${headerRows}</div><button onclick="window.print()">Сохранить в PDF</button></div>
  ${layoutSection}
  <h2 class="section-title">Спецификация и комплектация</h2>
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
  ${printScript}</body></html>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { buildHtml };
if (typeof window !== "undefined") window.EPOfferPdf = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
