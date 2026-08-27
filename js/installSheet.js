/* Помодульный лист для монтажников (PLAN 11) — сборка HTML-документа.
   ОТДЕЛЬНЫЙ документ, не КП: у КП адресат — клиент, здесь — монтажник на объекте,
   поэтому ни цен, ни итогов, ни курса. По каждому посту: таблица «Модуль · Элемент ·
   Артикул · Примечание» с точной позицией модуля (одномодульный «2», двухмодульный
   «2–3») и обвязка (суппорт → коробка → накладка) в порядке сборки.

   Модуль — чистый, как offerPdf.js: на вход готовые данные (их собирает оркестратор
   из EPPosts.moduleLayout и каталога) и форматтеры (esc), на выход строка HTML. Ни
   state, ни DOM, ни window.open — открытие окна остаётся в app.js. Так документ можно
   проверить автотестом, не поднимая браузер (PLAN 7.1).

   Интерфейс приложению — window.EPInstallSheet.buildHtml(data, deps) и
   buildFittings(comp, box, lighting): обвязка поста собирается ЗДЕСЬ, а не в оркестраторе,
   потому что её формат — часть контракта этого документа (см. fittings в описании data ниже).
   lighting — необязательный третий аргумент: механизмы групп света, подставленные расчётом
   (EPLightingPlan). Старый вызов с двумя аргументами работает как раньше. */
(() => {
"use strict";

/* Автопечать окна листа монтажника: печатаем НЕ по таймеру, а когда догрузятся картинки
   (иллюстрации собранных постов тянутся с vimar.ru и за прежние 400 мс могли не успеть — сборка
   уезжала в PDF недогруженной). Все <img> уже complete → печать сразу; иначе ждём load/error
   каждой незагруженной и печатаем на нуле счётчика. Сверху предохранитель 4000 мс, чтобы одна
   битая картинка не подвесила печать навсегда. Флаг done — печать ровно один раз. Инлайн-скрипт:
   в окне печати наших модулей нет. */
const printScript = `<script>(function(){var done=false;function pr(){if(done)return;done=true;window.print();}`
  + `var imgs=[].slice.call(document.images),pending=0;`
  + `imgs.forEach(function(img){if(img.complete)return;pending++;`
  + `function tick(){if(--pending===0)pr();}`
  + `img.addEventListener("load",tick);img.addEventListener("error",tick);});`
  + `if(pending===0)pr();setTimeout(pr,4000);})();<\/script>`;

/* Обвязка одного поста в порядке сборки: суппорт → коробка → накладка. Чистая функция от
   состава поста (comp = EPPosts.postComposition) и ФАКТИЧЕСКОЙ коробки (box — точная
   comp.box либо стандартно-совместимый фолбэк comp.boxFallback; выбор между ними остаётся
   за приложением, оно одно знает тип стены проекта).
   Живёт здесь, а не в оркестраторе, не ради красоты: количество суппорта стояло в app.js
   литералом «1», и по немецко-французской сборке монтажник получал по документу одну
   планку на два поста — дефект, которого не мог поймать ни один автотест, потому что
   app.js в тесты не грузится. Формат строк всё равно принадлежит этому документу
   (см. fittings в описании data ниже), так что правило и проверяется рядом с ним.
   Возвращает [{role, name, code, count}] — ровно те строки, что печатает таблица
   «Обвязка поста». */
function buildFittings(comp, box, lighting) {
  const fittings = [];
  if (!comp) return fittings;
  /* Механизмы групп света (EPLightingPlan.rowsByPost) — ПЕРВЫМИ в обвязке: монтажник ставит их
     в коробку раньше всего остального, они физически стоят ЗА клавишами. В таблице модулей выше
     их нет и быть не может — модуля рамки они не занимают (там стоит клавиша), поэтому место
     механизма в документе именно здесь, в обвязке, с указанием модуля и группы.
     Пробел подбора печатаем СТРОКОЙ С НУЛЁМ и текстом причины из расчёта: монтажник обязан
     увидеть, что за клавишей ничего не стоит, ДО поездки на объект. Это то же правило, по
     которому «суппорт не требуется» пишется словами, а не пропускается. */
  (Array.isArray(lighting) ? lighting : []).forEach(r => {
    if (!r) return;
    const where = `Механизм · модуль ${r.moduleLabel || "—"} · группа «${r.groupLabel || "—"}»`;
    if (r.missing) fittings.push({ role: where, name: r.missingText || "механизм не подобран", code: null, count: 0 });
    else fittings.push({ role: where, name: r.name, code: r.code, count: 1 });
  });
  /* Суппорт: сколько насчитал состав (столько же, сколько коробок), а не «одна планка».
     Изделие, которое по номенклатуре монтируется В КОРОБКУ БЕЗ ПЛАНКИ (крышки IP55,
     принцип NO_SUPPORT), даёт строку «не требуется» с нулём — buildHtml напечатает в
     «Кол.» прочерк. Совсем пропустить строку нельзя: пустое место в обвязке монтажник
     читает как забытую позицию и звонит уточнять. А вот суппорт, который просто НЕ
     ПОДОБРАЛСЯ (пробел каталога), словами не описываем — «не требуется» соврало бы. */
  if (comp.support && comp.supportCount) {
    /* assumed — «артикул подобран нами, заказчиком не подтверждён» (postComposition.supportAssumed):
       монтажное правило у накладки в номенклатуре есть, а планки под него нет, и она выбрана
       по серии и модульности. Монтажник должен видеть это ДО поездки на объект, поэтому
       признак едет строкой обвязки и печатается рядом с артикулом. */
    fittings.push({ role: "Суппорт", name: comp.support.name, code: comp.support.code, count: comp.supportCount,
      assumed: !!comp.supportAssumed });
  } else if (comp.supportNotRequired) {
    fittings.push({ role: "Суппорт", name: "не требуется", code: null, count: 0 });
  }
  if (box && comp.boxCount) fittings.push({ role: "Монтажная коробка", name: box.name, code: box.code, count: comp.boxCount });
  /* Накладка на сборку ровно одна при любом числе постов: импосты делят её изнутри,
     но заказывается она целиком — в отличие от коробок и планок. */
  if (comp.frame) fittings.push({ role: "Накладка", name: comp.frame.name, code: comp.frame.code, count: 1 });
  return fittings;
}

/* data = {
     title?, subtitle?,
     header?: { project?, developer?, date? },   // пустые поля не печатаются
     planBlockHtml?: string,                     // план с бирками номеров постов (EPPlanLabels),
                                                 // готовая секция от оркестратора — см. ниже
     posts: [ {
       number, room?, standardLabel?, german?: { postCount },
       frameName?, frameCode?, color?, height?, purpose?,
       modules: [ { label, name, code, note? } ],       // строки таблицы модулей (плоские)
       moduleGroups?: [ { post, capacity, modules:[…] } ],  // нумерация ПО ПОСТАМ (если >1 поста)
       assembledImageHtml?: string,                     // готовая картинка собранного поста (EPPostImage)
       explodedViewHtml?: string,                       // взрыв-схема поста (EPExplodedView) — деталь → выносная линия → артикул
       fittings: [ { role, name, code, count } ]        // обвязка: суппорт → коробка → накладка
     } ],
     lightingHtml?: string,                      // блок «Группы света» (EPLightingPlan.buildHtml):
                                                 // какие механизмы подставил расчёт, сколько нужно
                                                 // импульсных реле и какие места остались без
                                                 // подстановки. Печатается ПОСЛЕ карточек постов
                                                 // и ПЕРЕД подвалом: это свод по проекту, а не
                                                 // состав конкретного поста (состав уже в обвязке)
     supplierSpecHtml?: string                   // сводная спецификация по артикулам (EPSupplierSpec),
                                                 // готовая секция от оркестратора — см. ниже
   }
   deps = { esc(s) }.

   planBlockHtml печатается СРАЗУ ПОСЛЕ шапки и ПЕРЕД карточками постов — своей страницей:
   монтажник сначала видит, где на объекте пост № 7, и только потом читает его состав. Секцию
   целиком собирает EPPlanLabels (координаты бирок, вписывание чертежа в лист), потому что
   геометрию холста знает только оркестратор; сюда она приходит готовой строкой с инлайн-стилями,
   как assembledImageHtml и explodedViewHtml. Плана в проекте нет — поле пустое, документ
   собирается ровно как раньше.

   supplierSpecHtml печатается ПОСЛЕ всех карточек постов, своей страницей: это приложение
   для поставщика (одинаковые артикулы сведены с количествами), а не рабочий материал
   монтажника — сначала он читает свои посты, свод идёт следом и отрывается отдельно.
   Секцию целиком собирает EPSupplierSpec; сюда она приходит готовой строкой с инлайн-стилями,
   как planBlockHtml.
   Свод — ПОСЛЕДНИЙ блок документа, ниже подвала («Документ для монтажа…»). Подвал стоял
   после свода и печатался НА ЕГО СТРАНИЦЕ: страницу отрывают и отдают поставщику, а он
   читал адресованную монтажнику приписку про позиции модулей. Денежных формулировок здесь
   нет, но разделение обязано быть тем же, что в КП (offerPdf.js, где на отрывной лист
   уезжала оговорка о ценах): всё, что адресовано читателю ЭТОГО документа, остаётся на
   его страницах.
   Возвращает строку полного HTML-документа с авто-печатью. */
function buildHtml(data, deps) {
  const esc = deps.esc;
  const posts = (data && data.posts) || [];
  const single = posts.length === 1;

  /* Шапка документа: печатаем только заполненные поля (не «Проект: —»). */
  const header = data.header || {};
  const headerRows = [
    ["Проект", header.project],
    ["Разработчик", header.developer],
    ["Дата", header.date]
  ].filter(([, v]) => v != null && String(v).trim() !== "")
   .map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join("");

  /* Одна карточка поста: шапка поста + таблица модулей + обвязка. */
  const renderPost = (post) => {
    /* Строки шапки поста — тоже только заполненные (высота/назначение/цвет появятся
       у поста в PLAN 6, здесь они уже подхватятся, когда будут). */
    const meta = [
      ["Помещение", post.room],
      ["Высота установки", post.height],
      ["Назначение", post.purpose],
      ["Накладка", post.frameCode ? `[${post.frameCode}] ${post.frameName || ""}`.trim() : post.frameName],
      ["Цвет", post.color],
      ["Стандарт", post.standardLabel]
    ].filter(([, v]) => v != null && String(v).trim() !== "")
     .map(([k, v]) => `<div class="post-meta-item"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");

    const moduleTr = m =>
      `<tr><td class="mod">${esc(m.label)}</td><td>${esc(m.name)}</td><td class="code">${esc(m.code || "—")}</td><td class="note">${esc(m.note || "")}</td></tr>`;
    /* Раскладка модулей ПО ПОСТАМ: когда постов больше одного (немецкий стандарт,
       двухрядные), модули идут группами под подзаголовком «Пост N» — монтажнику важно, что
       это отдельные коробки. Один пост (итальянская сплошная накладка) или нет moduleGroups
       (старые вызовы) — плоская таблица как прежде.
       ⚠️ САМИ НОМЕРА МОДУЛЕЙ ЗАДАЁТ ОРКЕСТРАТОР (app.js, buildPostSheet) — и он обязан дать
       ОДИН адрес модуля на всю карточку: та же строка стоит в таблице, в обвязке ниже и во
       взрыв-схеме, монтажник читает их рядом. Пока таблица нумеровала модули заново в каждом
       посте, а обвязка — сквозняком, одна клавиша имела в одной карточке два номера. */
    const groups = Array.isArray(post.moduleGroups) ? post.moduleGroups : null;
    const moduleRows = groups && groups.length > 1
      ? groups.map(g => {
          const rows = (g.modules || []).map(moduleTr).join("") || `<tr><td colspan="4" class="empty">Пост без механизмов</td></tr>`;
          return `<tr class="post-row"><td colspan="4">Пост ${esc(g.post)}${g.capacity ? ` · до ${esc(g.capacity)} мод.` : ""}</td></tr>${rows}`;
        }).join("")
      : (post.modules || []).map(moduleTr).join("") || `<tr><td colspan="4" class="empty">Пост без механизмов</td></tr>`;

    /* Кол. без количества — прочерк, а не «0»: так печатается узел, которого в поставке
       нет по устройству изделия (суппорт «не требуется» у крышек IP55). Ноль монтажник
       читает как ошибку расчёта, прочерк — как «нечего везти».
       f.assumed — артикул подобран нами и заказчиком не подтверждён: печатаем пометку
       ВПЛОТНУЮ к артикулу, иначе догадка неотличима от согласованной позиции. Формулировка
       та же, что в смете (estimate.js) и в панели «Состав поста» (app.js) — менять только
       вместе, разнобой в документах хуже, чем отсутствие пометки. */
    const fittingRows = (post.fittings || []).map(f =>
      `<tr><td>${esc(f.role)}</td><td>${esc(f.name)}</td><td class="code">${esc(f.code || "—")}${f.assumed ? " (предположительно)" : ""}</td><td class="right">${Number(f.count) > 0 ? Number(f.count) : "—"}</td></tr>`
    ).join("");

    /* Для немецко-французского стандарта монтажнику важно, что коробок НЕСКОЛЬКО
       (пост = 2 модуля), а между постами — импосты; иначе он поставит одну коробку.
       Суппортов столько же: планка садится в каждую коробку, а прежнее примечание
       молчало про них — и на две коробки везли одну планку. Число суппортов берём из
       данных поста, но упоминаем только когда оно пришло (старые вызовы без
       supportCount печатают примечание ровно как раньше). */
    const germanSupports = post.german && Number(post.german.supportCount) > 1
      ? ` и <b>${Number(post.german.supportCount)}</b> суппорта (по одному в каждую коробку)`
      : "";
    const germanNote = post.german && post.german.postCount > 1
      ? `<div class="german-note">Немецко-французский стандарт: сборка разбита на <b>${Number(post.german.postCount)}</b> поста по 2 модуля — <b>${Number(post.german.postCount)}</b> монтажные коробки${germanSupports}, между постами устанавливаются импосты.</div>`
      : "";

    /* Собранный пост картинкой (EPPostImage): показывает разделение на посты и импосты —
       та же иллюстрация, что в конструкторе/КП. Готовый HTML с инлайн-стилями (без
       экранного CSS), поэтому в печати не разваливается. */
    const illus = post.assembledImageHtml ? `<div class="post-illus">${post.assembledImageHtml}</div>` : "";
    /* Взрыв-схема ДОПОЛНЯЕТ собранную картинку (не заменяет): по ней монтажник видит состав поста
       с артикулом каждой детали. Готовый HTML с инлайн-стилями (EPExplodedView) — в печати цел. */
    const exploded = post.explodedViewHtml
      ? `<div class="exploded-title">Взрыв-схема поста</div><div class="post-exploded">${post.explodedViewHtml}</div>`
      : "";
    return `<section class="post-card">
      <div class="post-card-head"><span class="post-badge">Пост № ${esc(post.number)}</span></div>
      <dl class="post-meta">${meta}</dl>
      ${illus}
      ${exploded}
      ${germanNote}
      <table class="modules"><thead><tr><th>Модуль</th><th>Элемент</th><th>Артикул</th><th>Примечание</th></tr></thead>
        <tbody>${moduleRows}</tbody></table>
      ${fittingRows ? `<div class="fittings-title">Обвязка поста</div>
      <table class="fittings"><thead><tr><th>Узел</th><th>Наименование</th><th>Артикул</th><th class="right">Кол.</th></tr></thead>
        <tbody>${fittingRows}</tbody></table>` : ""}
    </section>`;
  };

  /* Один пост — печатаем как есть; проект целиком — группируем по помещениям (порядок
     как пришёл; «Без помещения» для нераспределённых), лист на каждый пост. */
  let body;
  if (single) {
    body = renderPost(posts[0]);
  } else {
    const groups = new Map();   /* Map сохраняет порядок первого появления помещения */
    posts.forEach(p => {
      const room = (p.room && String(p.room).trim()) || "Без помещения";
      if (!groups.has(room)) groups.set(room, []);
      groups.get(room).push(p);
    });
    body = [...groups].map(([room, list]) =>
      `<div class="room-group"><h2 class="room-heading">${esc(room)}</h2>${list.map(renderPost).join("")}</div>`
    ).join("");
  }

  const title = esc(data.title || "Лист монтажника");
  const subtitle = esc(data.subtitle || (single ? "Помодульная раскладка поста" : "Помодульная раскладка постов по проекту"));

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
  @page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172b3f;font-size:12px}
  h1{font-size:22px;color:#1675c8;margin:0 0 4px}.sub{color:#687f94;margin-bottom:16px}
  .doc-head{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 12px;background:#edf6ff;border-radius:10px;margin-bottom:18px;color:#33465a;font-size:11px}
  .room-heading{font-size:15px;color:#185d96;margin:22px 0 10px;padding-bottom:6px;border-bottom:2px solid #d8e6f2}
  .post-card{border:1px solid #d8e6f2;border-radius:12px;padding:14px 16px;margin:0 0 14px;break-inside:avoid}
  .post-card-head{margin-bottom:8px}
  .post-badge{display:inline-block;background:#1675c8;color:#fff;font-weight:bold;border-radius:8px;padding:4px 12px;font-size:14px}
  .post-meta{display:flex;flex-wrap:wrap;gap:6px 22px;margin:0 0 10px}
  .post-meta-item{margin:0}.post-meta dt{color:#687f94;font-size:10px;text-transform:uppercase;letter-spacing:.03em}.post-meta dd{margin:0;font-weight:bold}
  .german-note{background:#fff5e6;border:1px solid #f0d8ac;border-radius:8px;padding:8px 10px;margin:0 0 10px;font-size:11px;color:#7a5a17}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{padding:7px 9px;border-bottom:1px solid #e2edf6;text-align:left}
  th{background:#e8f4ff;color:#185d96;font-size:11px}
  td.mod{font-weight:bold;color:#185d96;white-space:nowrap;width:64px}
  tr.post-row td{background:#f0f7ff;color:#185d96;font-weight:bold;font-size:11px}
  .post-illus{margin:0 0 10px}
  .exploded-title{margin:6px 0 4px;font-weight:bold;color:#185d96;font-size:12px}
  .post-exploded{margin:0 0 10px;break-inside:avoid}
  td.code{font-family:"Courier New",monospace;color:#33465a}
  td.note{color:#687f94}td.right,th.right{text-align:right}td.empty{color:#687f94;font-style:italic}
  .fittings-title{margin:14px 0 0;font-weight:bold;color:#185d96;font-size:12px}
  .footer{margin-top:26px;color:#687f94;font-size:10px}
  @media print{button{display:none}}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div><h1>${title}</h1><div class="sub">${subtitle}</div></div>
    <button onclick="window.print()">Печать / PDF</button>
  </div>
  ${headerRows ? `<div class="doc-head">${headerRows}</div>` : ""}
  ${data.planBlockHtml || ""}
  ${body}
  ${data.lightingHtml || ""}
  <div class="footer">Документ для монтажа. Позиции модулей указаны слева направо, как в собранной накладке.</div>
  ${data.supplierSpecHtml || ""}
  ${printScript}</body></html>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { buildHtml, buildFittings };
if (typeof window !== "undefined") window.EPInstallSheet = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
