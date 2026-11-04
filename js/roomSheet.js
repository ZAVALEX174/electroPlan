/* Экспликация по комнатам (Б7, §1.4 опросника) — сборка HTML-документа для печати/PDF.
   ОТДЕЛЬНЫЙ документ, не КП и не лист монтажника: по каждой комнате заголовок «Название — площадь»
   и таблица её постов (№, наполнение словами, накладка, модульность, высота, назначение, цена)
   с итогом по комнате; в конце — посты «Без помещения» (отдельной группой, её собирает
   оркестратор) и общий итог по проекту. Пустые комнаты (без постов) показываем с площадью
   и пометкой «постов нет» — площадь комнаты нужна и без постов, а пропавшая комната читалась
   бы как потерянные данные.

   Модуль — чистый, как installSheet.js/offerPdf.js: на вход готовые данные (их собирает
   оркестратор roomSheetForProject в js/docs.js из state/каталога) и форматтеры (esc, moneyShown),
   на выход строка HTML. Ни state, ни DOM, ни window.open — открытие окна остаётся в оркестраторе.
   Так документ можно проверить автотестом, не поднимая браузер (PLAN 7.1).

   Итог по комнате и общий итог считаются ЗДЕСЬ (сумма price постов группы / всех групп) —
   правило суммирования живёт одним местом рядом с таблицей, которая его печатает. Цены приходят
   УЖЕ в валюте показа (postTotalCost → EPEstimate.postPriceShown), форматирует их deps.moneyShown
   — та же точка округления, что у КП и сметы (§7.1: второй копии roundShown здесь нет).

   Интерфейс приложению — window.EPRoomSheet.buildHtml(data, deps).

   data = {
     title?, subtitle?,
     header?: { project?, developer?, date? },   // пустые поля не печатаются
     groups: [ {
       name,                                     // имя комнаты; «Без помещения» — тоже группа (room:null в оркестраторе)
       areaText?,                                // площадь готовой строкой («12,5 м²»), пусто — не печатаем
       posts: [ {
         number,                                 // № поста (как на плане и в других документах)
         fillText,                               // наполнение словами («Розетка — 2, Выключатель — 1»)
         frameName,                              // накладка
         modules,                                // модульность (число модулей накладки)
         height,                                 // высота установки
         purpose,                                // назначение
         price                                   // цена поста ЧИСЛОМ, в валюте показа (для итогов)
       } ]
     } ]
   }
   deps = { esc, moneyShown, logo? }.   // logo — data-URL логотипа компании (EPPrefs); пусто → как раньше

   Возвращает строку полного HTML-документа с авто-печатью. */
(() => {
"use strict";

/* Логотип в шапку рисует ОБЩИЙ EPDocImages — то же правило, что и у КП и листа монтажника (§7.1):
   размер <img> и пустой случай живут в одном месте. Резолвим как в installSheet.js: в браузере
   namespace уже загружен, в Node — через require; без модуля логотипа просто нет. */
function docLogoApi() {
  if (typeof window !== "undefined" && window.EPDocImages) return window.EPDocImages;
  if (typeof require !== "undefined") return require("./docImages.js");
  return { imgHtml: () => "" };
}

/* Автопечать: та же механика, что в листе монтажника (печатаем, когда догрузятся картинки,
   с предохранителем 4000 мс и печатью ровно один раз). Картинок в экспликации сейчас нет,
   кроме логотипа, — но он тоже <img>, и печатать до его загрузки нельзя. */
const printScript = `<script>(function(){var done=false;function pr(){if(done)return;done=true;window.print();}`
  + `var imgs=[].slice.call(document.images),pending=0;`
  + `imgs.forEach(function(img){if(img.complete)return;pending++;`
  + `function tick(){if(--pending===0)pr();}`
  + `img.addEventListener("load",tick);img.addEventListener("error",tick);});`
  + `if(pending===0)pr();setTimeout(pr,4000);})();<\/script>`;

function buildHtml(data, deps) {
  const esc = deps.esc;
  const moneyShown = deps.moneyShown;
  const groups = (data && data.groups) || [];
  const logoImg = docLogoApi().imgHtml(deps.logo, esc);

  /* Шапка документа: печатаем только заполненные поля (не «Проект: —») — как в листе монтажника. */
  const header = data.header || {};
  const headerRows = [
    ["Проект", header.project],
    ["Разработчик", header.developer],
    ["Дата", header.date]
  ].filter(([, v]) => v != null && String(v).trim() !== "")
   .map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join("");

  const moneyCell = v => `<td class="right price">${esc(moneyShown(Number(v) || 0))}</td>`;
  /* Пустое поле поста (высота/назначение не заполнены) печатаем прочерком — как прочерк артикула
     в листе монтажника: пустая ячейка читается как недозаполненная таблица. */
  const textCell = v => `<td>${esc(v != null && String(v).trim() !== "" ? v : "—")}</td>`;

  /* Одна группа (комната либо «Без помещения»): заголовок «Название — площадь» и таблица постов.
     Итог по комнате — только когда посты есть: у пустой комнаты «Итого 0» ничего не скажет,
     а пометка «постов нет» — скажет. */
  const renderGroup = g => {
    const head = `<h2 class="room-heading">${esc(g.name)}${g.areaText && String(g.areaText).trim() !== "" ? ` — ${esc(g.areaText)}` : ""}</h2>`;
    const posts = Array.isArray(g.posts) ? g.posts : [];
    const thead = `<thead><tr><th>№</th><th>Наполнение</th><th>Накладка</th><th class="right">Модульность</th><th>Высота</th><th>Назначение</th><th class="right">Цена</th></tr></thead>`;
    if (!posts.length) {
      return `${head}<table class="room-table">${thead}<tbody><tr><td colspan="7" class="empty">постов нет</td></tr></tbody></table>`;
    }
    const rows = posts.map(p => `<tr>`
      + `<td class="num">${esc(p.number)}</td>`
      + textCell(p.fillText)
      + textCell(p.frameName)
      + `<td class="right">${esc(p.modules != null && p.modules !== "" ? p.modules : "—")}</td>`
      + textCell(p.height)
      + textCell(p.purpose)
      + moneyCell(p.price)
      + `</tr>`).join("");
    const total = posts.reduce((s, p) => s + (Number(p.price) || 0), 0);
    const totalRow = `<tr class="room-total"><td colspan="6">Итого по комнате</td>${moneyCell(total)}</tr>`;
    return `${head}<table class="room-table">${thead}<tbody>${rows}${totalRow}</tbody></table>`;
  };

  /* Общий итог — сумма по всем группам (включая «Без помещения»): то же правило, что итог
     комнаты, применённое ко всему списку, — расхождению «комнаты сошлись, проект нет» негде жить. */
  const grandTotal = groups.reduce((s, g) =>
    s + (Array.isArray(g.posts) ? g.posts : []).reduce((x, p) => x + (Number(p.price) || 0), 0), 0);

  const title = esc(data.title || "Экспликация по комнатам");
  const subtitle = esc(data.subtitle || "Посты и стоимость по помещениям проекта");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
  @page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172b3f;font-size:12px;margin:0}
  h1{font-size:22px;color:#1675c8;margin:0 0 4px}.sub{color:#687f94;margin-bottom:16px}
  .doc-head{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 12px;background:#edf6ff;border-radius:10px;margin-bottom:18px;color:#33465a;font-size:11px}
  /* Заголовок комнаты держится со своей ПЕРВОЙ строкой таблицы (break-after:avoid) — то же правило,
     что в листе монтажника: заголовок не должен остаться внизу страницы без своей таблицы. */
  .room-heading{font-size:15px;color:#185d96;margin:14px 0 8px;padding-bottom:6px;border-bottom:2px solid #d8e6f2;break-after:avoid;page-break-after:avoid}
  table{width:100%;border-collapse:collapse;margin:0 0 14px}
  th,td{padding:4px 9px;border-bottom:1px solid #e2edf6;text-align:left;vertical-align:top}
  th{background:#e8f4ff;color:#185d96;font-size:11px}
  td.num{font-weight:bold;color:#185d96;white-space:nowrap;width:40px}
  td.right,th.right{text-align:right}
  td.price{white-space:nowrap}
  td.empty{color:#687f94;font-style:italic}
  tr.room-total td{background:#f0f7ff;color:#185d96;font-weight:bold}
  .grand-total{margin-top:6px;padding:10px 12px;background:#1675c8;color:#fff;font-weight:bold;border-radius:10px;font-size:14px;text-align:right;break-inside:avoid;page-break-inside:avoid}
  @media print{button{display:none}}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>${logoImg}<h1>${title}</h1><div class="sub">${subtitle}</div></div>
    <button onclick="window.print()">Печать / PDF</button>
  </div>
  ${headerRows ? `<div class="doc-head">${headerRows}</div>` : ""}
  ${groups.map(renderGroup).join("")}
  <div class="grand-total">Итого по проекту: ${esc(moneyShown(grandTotal))}</div>
  ${printScript}</body></html>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { buildHtml };
if (typeof window !== "undefined") window.EPRoomSheet = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
