/* Коммерческое предложение (печать/PDF) — сборка HTML-документа (PLAN 2.1).
   Модуль знает только про готовую смету (est из EPEstimate.build) и форматтеры,
   переданные аргументами: ни state, ни window.open, ни toast. Открытие окна и
   расчёт остаются в app.js. Так HTML КП можно проверить автотестом, не поднимая
   браузер (PLAN 7.1).

   Интерфейс приложению — window.EPOfferPdf.buildHtml(est, deps). */
(() => {
"use strict";

/* Оговорку о неполноте итога берём из EPEstimate.pricelessNote(est) — ТОЙ ЖЕ функции, что печатает
   её на экране (js/app.js #pricelessStatus). Резолвим как roomCarry свою геометрию: в браузере
   namespace уже загружен (estimate.js подключён раньше offerPdf.js), в Node — через require. Это
   не state и не DOM, а переиспользование чистой логики — общая формулировка не имеет права на
   вторую копию (§7.1). Отсутствие модуля не срывает сборку документа: тогда оговорки просто нет. */
function defaultEstimate() {
  if (typeof window !== "undefined" && window.EPEstimate) return window.EPEstimate;
  if (typeof require !== "undefined") return require("./estimate.js");
  return { pricelessNote: () => "" };
}

/* Логотип в шапку рисует ОБЩИЙ EPDocLogo — то же правило, что и у листа монтажника (§7.1):
   размер <img> и пустой случай (логотипа нет → "") живут в одном месте, этот документ решает
   только КУДА в своей шапке поставить готовую строку. Резолвим как EPEstimate: в браузере
   namespace уже загружен, в Node — через require; без модуля логотипа просто нет. */
function docLogoApi() {
  if (typeof window !== "undefined" && window.EPDocLogo) return window.EPDocLogo;
  if (typeof require !== "undefined") return require("./docLogo.js");
  return { imgHtml: () => "" };
}

/* Предел длины редактируемых условий сделки. «Соглашение сторон» — это несколько абзацев (условия
   оплаты, поставка до 180 дней, претензии, срок действия цен), а не документ: 2000 символов — это
   ~30–40 строк, с большим запасом на любые разумные условия. Больше почти наверняка не условия КП,
   а случайная вставка; предел защищает и печать (текст не разносит вёрстку A4), и хранилище (EPPrefs
   → LocalStorage: 2000 символов ≪ квоты, рядом с data-URL логотипа это ничто). Ограничение применяет
   ВВОД (app.js обрезает при сохранении, textarea maxlength не даёт напечатать больше — обрезка видима,
   не «молча»); число ЭКСПОРТИРУЕМ, чтобы у ввода и печати был ОДИН предел, а не две копии. */
const MAX_TERMS_CHARS = 2000;

/* Подвал «Условия сделки» — редактируемый человеком текст (EPPrefs.companyTerms), бланк КОМПАНИИ, а
   не свойство проекта (как логотип/наборы столбцов): вписал один раз — стоит во всех своих КП. ОДНО
   правило в одном месте (§7.1): ЧТО печатается в подвале условий, решает только эта функция. Живёт
   здесь, в offerPdf, а НЕ рядом с pricelessNote в estimate: pricelessNote производна от est.missing
   (неполнота сметы) и печатается в обоих документах, а этот текст к смете и цифрам отношения не имеет
   и идёт ТОЛЬКО в КП (в лист монтажника не идёт — тот не коммерческий документ). Пусто → "" (никакого
   пустого блока: без текста КП обязан выглядеть байт-в-байт как раньше — отдельный проверяемый случай).
   Это ТЕКСТ, а не HTML: экранируем целиком (конвенция 4), затем переносы строк человека → <br>, чтобы
   его абзацы сохранились в печати. Порядок важен — сначала esc (он не трогает \n), потом \n → <br>:
   обратный порядок экранировал бы уже вставленные <br>. \r\n и одиночный \r приводим к \n. */
function termsFooterHtml(terms, esc) {
  const raw = typeof terms === "string" ? terms.trim() : "";
  if (!raw) return "";
  const e = typeof esc === "function" ? esc : (s => String(s));
  const body = e(raw.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
  return `<div class="terms">${body}</div>`;
}

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
   deps  — { money(n), esc(s), displayCurrency(), effectiveRate(settings), settings, options,
             header, postLayout, planBlockHtml, lightingHtml, supplierSpecHtml }
   options — выбор разделов/столбцов КП (EPOfferOptions-схема): ЧТО показать. На деньги и состав
   не влияет — только на видимость (нормализуется здесь же, отсутствие = все разделы полностью).
   planBlockHtml — готовая секция «план с бирками» (EPPlanLabels.buildHtml), собирает её
   оркестратор: только он знает про #canvas и state. Приходит СТРОКОЙ ровно как
   assembledImageHtml в раскладке постов — этот документ вёрстку блока не трогает.
   lightingHtml — готовая секция «Группы света» (EPLightingPlan.buildHtml): какие механизмы
   подставил расчёт по числу мест управления группой, сколько нужно импульсных реле и какие
   места остались без подстановки. Печатается СРАЗУ ПОД спецификацией и ПЕРЕД итогами: это
   пояснение к составу позиций выше (откуда в посте на три клавиши переключатель и инвертор,
   а не три выключателя), и после итогов его бы никто не прочитал.
   supplierSpecHtml — готовая секция «сводная спецификация по артикулам» (EPSupplierSpec):
   те же позиции, но в разрезе артикулов и БЕЗ ЦЕН — её отправляют поставщику. Печатается
   ПОСЛЕ денежных итогов, своей страницей: КП читают ради цены, свод — приложение к нему,
   и вклинившись перед итогами он бы отодвинул главное.
   Свод идёт ПОСЛЕДНИМ блоком документа, ниже обоих подвалов (курс пересчёта и оговорка о
   ценах). Раньше подвал стоял после него и печатался НА ЕГО СТРАНИЦЕ: страницу отрывают и
   отдают поставщику, а он читал «Цены являются ориентировочными…» — денежные формулировки
   КП на листе, где цен нет по замыслу. Заказчик 24.08 просил разделять, что кому уходит:
   «этот лист отправляется поставщику». Всё, что относится к сделке, обязано остаться на
   страницах КП, а не уезжать с отрывным листом.
   Возвращает { html, hasContent }: html — полный HTML-документ с авто-печатью, hasContent —
   будет ли в документе хоть один видимый содержательный блок (см. contentFragments ниже).
   Оба ответа считаются ОДНИМ проходом, чтобы страж пустого КП (app.js) и печать не разошлись. */
function compose(est, deps) {
  const money = deps.money;
  const esc = deps.esc;
  const displayCurrency = deps.displayCurrency;
  const s = deps.settings || {};
  const { materials, work, total } = est;
  const config = typeof window !== "undefined" && window.EPOfferOptions
    ? window.EPOfferOptions : require("./offerOptions.js");
  const options = config.normalize(deps.options);
  const itemText = (value, code) => config.itemText(value, options.articles, code);
  const estimate = deps.EPEstimate || defaultEstimate();

  /* Оговорка о позициях без цены — ОДНОЙ строкой с экраном (см. defaultEstimate выше). Считает по
     тому же est.missing, что и панель «Стоимость проекта»; печатается прямо под «Итого», иначе КП
     выглядел бы окончательной суммой, хотя часть позиций вошла в неё нулём. deps.EPEstimate — точка
     подмены для теста; в приложении её не передают. */
  const pricelessNote = estimate.pricelessNote(est);

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
    name: itemText(g.name, g.items?.length === 1 ? g.items[0].code : null),
    /* Не вырезаем коды из склеенной строки: состав строится тем же renderItem,
       что и смета, но над копиями подписей без артикулов. Старый внешний вызов
       без items не позволяет надёжно отделить код от имени — явно сообщаем это. */
    composition: options.articles ? g.composition : (Array.isArray(g.items)
      ? g.items.map(it => estimate.renderItem({ ...it, name: itemText(it.name, it.code) })).filter(Boolean).join(", ")
      : "Состав без артикулов недоступен"),
    article: (g.items || []).filter(it => !it.notRequired && it.count > 0)
      .map(it => `${it.code || "артикул не определён"}${it.count > 1 ? " × " + it.count : ""}${it.assumed ? " (предположительно)" : ""}`).join(", "),
    quantity: g.count, unit: g.unit,
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
  /* Логотип компании над реквизитами (deps.logo — data-URL из EPPrefs, бланк человека, не свойство
     проекта). Пусто → imgHtml вернёт "" и шапка останется байт-в-байт как раньше. */
  const logoImg = docLogoApi().imgHtml(deps.logo, esc);

  /* Раздел «Раскладка постов» (PLAN 1) — перед позиционной таблицей: по строке на пост,
     наполнение словами с количеством (а не список артикулов), модульность отдельной
     колонкой и иллюстрация собранного поста. Артикулы остаются ниже, в спецификации.
     Постов в проекте нет — раздел не печатаем. */
  const layout = deps.postLayout || [];
  /* У исправной накладки подпись под иллюстрацией не дублируем. Но исчезнувший артикул
     или снятая позиция — существенное состояние: его готовый текст даёт оркестратор из
     EPPosts.frameAvailability. Без этой строки «Раскладка постов» молчала о детали,
     которую смета в том же КП называла отсутствующей. */
  const layoutIllustration = p => {
    const picture = p.assembledImageHtml
      || (p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(itemText(p.frameName || ("Пост № " + p.number), p.frameCode))}">` : "—");
    const status = p.frameStatusText
      ? `<div class="pl-frame-status">${esc(itemText(p.frameStatusText, p.frameCode))}</div>`
      : "";
    return picture + status;
  };
  /* Печать раскладки производна ОТ СХЕМЫ (fields.layout), а не от рукописного switch с фолбэком
     на номер поста: раньше новое поле схемы давало колонку в шапке, а в теле — номер под чужим
     заголовком, без признака ошибки. Ячейку рисует рендерер, ЗАВЕДЁННЫЙ ПОД ТОТ ЖЕ ключ; ключ
     без рендерера в колонки не попадает (layoutColumns), поэтому данные под чужой шапкой
     невозможны — колонка появляется только вместе со своим рендерером. */
  const layoutRenderers = {
    number: p => esc(p.number),
    fill: p => (p.fill || []).map(f => f.noCount ? esc(itemText(f.word)) : `${esc(itemText(f.word))} — ${Number(f.count) || 0}`).join("<br>") || "—",
    modules: p => Number(p.modules) || 0,
    box: p => `${esc(itemText(p.box?.name || "Монтажная коробка не подобрана", p.box?.code))}`
      + (options.articles && p.box?.code ? ` [${esc(p.box.code)}]` : "")
      + (p.box?.count > 0 ? ` × ${Number(p.box.count)}` : ""),
    article: p => esc(p.frameCode || "—"),
    /* Стоимость блока — цена ОДНОГО поста в базовой валюте каталога (её считает оркестратор той же
       EPEstimate.postPrice, что и смета). money() пересчитывает в валюту показа так же, как суммы
       спецификации — сами цены не переписываем. */
    price: p => money(Number(p.price) || 0),
    /* Стоимость артикулов — разбивка цены поста по изделиям (p.itemPrices приходит из
       EPEstimate.build того же расчёта, что смета: замена цельных изделий уже сделана). По строке на
       узел: «Наименование — [N × ]цена». Цена узла (item.price) — за штуку, поэтому при count>1
       показываем и множитель, и итог строки; Σ этих строк равна «Стоимости блока». Узел без артикула
       каталога (пробел подбора, снятая позиция) цены не имеет — печатаем «цена не определена», а не
       ложный ноль (та же честность, что у pricelessNote). Имя — через itemText, как в наполнении:
       без артикулов коды из подписи вычищаются. Пустой список (пост без ценимых узлов) — «—». */
    itemPrices: p => {
      const items = (p.itemPrices || []).filter(it => it && (Number(it.count) || 0) > 0);
      if (!items.length) return "—";
      return items.map(it => {
        const name = esc(itemText(it.name, it.code));
        if (!it.code) return `${name} — цена не определена`;
        const unit = Number(it.price) || 0, count = Number(it.count) || 0;
        return count > 1 ? `${name} — ${count} × ${money(unit)} = ${money(unit * count)}` : `${name} — ${money(unit)}`;
      }).join("<br>");
    },
    illustration: p => layoutIllustration(p)
  };
  const layoutColumns = config.fields.layout.filter(([key]) =>
    options.layout[key] && layoutRenderers[key]
      && (key !== "article" || options.articles)
      && (!["price", "itemPrices"].includes(key) || options.prices));
  const layoutCell = (p, key) => layoutRenderers[key](p);
  const layoutSection = options.sections.layout && layout.length && layoutColumns.length ? `<h2 class="section-title">Раскладка постов</h2>
  <table class="layout"><thead><tr>${layoutColumns.map(([key, label]) => `<th${key === "price" ? ' class="right"' : ""}>${esc(label)}</th>`).join("")}</tr></thead><tbody>
  ${layout.map(p => `<tr>${layoutColumns.map(([key]) => `<td class="${key === "number" ? "pl-num" : key === "illustration" ? "pl-illus" : key === "price" ? "right" : ""}">${layoutCell(p, key)}</td>`).join("")}</tr>`).join("")}
  </tbody></table>` : "";
  /* Выключенная иллюстрация/раскладка не должна заодно прятать снятую накладку.
     По умолчанию эти же предупреждения остаются под иллюстрациями без дублирования. */
  const frameWarnings = !layoutSection || !options.layout.illustration
    ? layout.filter(p => p.frameStatusText).map(p => `<div class="pl-frame-status">Пост ${esc(p.number)}: ${esc(itemText(p.frameStatusText, p.frameCode))}</div>`).join("")
    : "";
  const specColumns = [
    ...(options.specification.number ? [["number", "№"]] : []), ["name", "Наименование"],
    ...config.fields.specification.filter(([key]) => key !== "number" && options.specification[key]
      && (key !== "article" || options.articles) && (!["price", "sum"].includes(key) || options.prices))
      .map(([key, label]) => [key, key === "composition" && options.articles ? "Состав / артикул" : label])
  ];
  const specSection = options.sections.specification ? `<h2 class="section-title">Спецификация и комплектация</h2>
  <table class="specification"><thead><tr>${specColumns.map(([key, label]) => `<th${["price", "sum"].includes(key) ? ' class="right"' : ""}>${esc(label)}</th>`).join("")}</tr></thead><tbody>
  ${rows.map((r, i) => `<tr>${specColumns.map(([key]) => ["price", "sum"].includes(key)
    ? `<td class="right">${money(r[key])}</td>`
    : `<td>${key === "name" ? `<b>${esc(r.name)}</b>` : esc(key === "number" ? i + 1 : r[key])}</td>`).join("")}</tr>`).join("")}
  </tbody></table>` : "";

  /* Секции-строки, приходящие оркестратором готовыми, — ОТДЕЛЬНЫМИ const: их же читает страж
     пустого КП (hasContent), поэтому «раздел включён, но печатать нечего» не размазано по шаблону. */
  const planSection = options.sections.plan ? deps.planBlockHtml || "" : "";
  const lightingSection = options.sections.lighting ? deps.lightingHtml || "" : "";
  const supplierSection = options.sections.supplier ? deps.supplierSpecHtml || "" : "";
  /* Документу есть что показать, если включены цены (итоги печатаются всегда) ИЛИ хоть один
     содержательный блок непуст. Проверяем НЕ «раздел включён», а «раздел что-то напечатает»:
     раскладка без столбцов/без постов и план без чертежа дают "" и документ не открывают.
     Оговорки, курс и подвал — производные от цен, отдельного содержимого не несут. */
  const contentFragments = [planSection, layoutSection, frameWarnings, specSection, lightingSection, supplierSection];
  const hasContent = options.prices || contentFragments.some(f => f && String(f).trim() !== "");

  /* Подвал редактируемых условий сделки — из бланка компании (deps.terms, EPPrefs). НЕ зависит от
     цен: условия оплаты и поставки печатаются и в КП без цен, поэтому считается ВНЕ ветки
     options.prices. Стоит НИЖЕ денежных подвалов, но ВЫШЕ свода поставщика: условия относятся к
     сделке и обязаны остаться на страницах КП, а не уехать с отрывным листом поставщика (см. коммент
     о supplierSection выше). Пусто → "" (термин не гейтит hasContent: подвал из одних условий без
     спецификации и цен — не повод открывать документ). */
  const termsFooter = termsFooterHtml(deps.terms, esc);

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Коммерческое предложение</title><style>
  @page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#172b3f;font-size:12px}h1{font-size:24px;color:#1675c8;margin:0 0 4px}.sub{color:#687f94;margin-bottom:24px}.meta{display:flex;justify-content:space-between;margin-bottom:20px}.box{padding:12px;background:#edf6ff;border-radius:10px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:9px;border-bottom:1px solid #d8e6f2;text-align:left}th{background:#e8f4ff;color:#185d96}.right{text-align:right}.totals{width:340px;margin:22px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px}.grand{font-size:16px;font-weight:bold;color:white;background:#1675c8;border-radius:8px}.footer{margin-top:35px;color:#687f94;font-size:10px}.priceless{width:340px;margin:8px 0 0 auto;color:#9b3f2b;font-size:11px;font-weight:bold;line-height:1.3;-webkit-print-color-adjust:exact;print-color-adjust:exact}.terms{margin-top:28px;padding-top:12px;border-top:1px solid #d8e6f2;color:#4a5b6c;font-size:11px;line-height:1.45}.section-title{font-size:16px;color:#185d96;margin:26px 0 4px}.layout td.pl-num{font-weight:bold;color:#185d96;text-align:center}.layout td.pl-illus{text-align:center}.layout td.pl-illus>img{max-height:56px;max-width:96px;object-fit:contain}.pl-frame-status{margin-top:5px;color:#9b3f2b;font-size:10px;font-weight:bold;line-height:1.25}@media print{button{display:none}}</style></head><body>
  <h1>Коммерческое предложение</h1><div class="sub">Проект электрики и комплектация электроустановочных изделий</div>
  <div class="meta"><div class="box">${logoImg}${headerRows}</div><button onclick="window.print()">Сохранить в PDF</button></div>
  ${planSection}
  ${layoutSection}
  ${frameWarnings}
  ${specSection}
  ${lightingSection}
  ${options.prices ? `<div class="totals"><div><span>Оборудование</span><b>${money(est.equipment)}</b></div>
  ${est.discount ? `<div><span>Скидка ${est.discountPercent}%</span><b>−${money(est.discount)}</b></div>` : ""}
  <div><span>Монтажные материалы</span><b>${money(materials)}</b></div><div><span>Работы</span><b>${money(work)}</b></div>
  ${est.vat ? `<div><span>Итого без НДС</span><b>${money(est.subtotal)}</b></div><div><span>НДС ${est.vatPercent}%</span><b>${money(est.vat)}</b></div>` : ""}
  <div class="grand"><span>Итого${est.vat ? " с НДС" : ""}</span><b>${money(total)}</b></div></div>` : ""}
  ${pricelessNote ? `<div class="priceless">${options.prices ? esc(pricelessNote) : `Позиций без товара в каталоге: ${est.missing.length}. Проверьте состав проекта перед передачей документа.`}</div>` : ""}
  ${options.prices && displayCurrency() === "RUB" ? rateFooter() : ""}
  ${options.prices ? `<div class="footer">Цены являются ориентировочными и могут быть уточнены после согласования бренда, серии оборудования и условий монтажа.</div>` : ""}
  ${termsFooter}
  ${supplierSection}
  ${printScript}</body></html>`;
  return { html, hasContent };
}

/* buildHtml — прежний интерфейс приложению (строка документа). hasContent — тонкая обёртка над
   тем же compose: страж пустого КП в app.js зовёт её на ТЕХ ЖЕ deps, что уйдут в печать, и не
   заводит вторую копию правил «что напечатается». */
function buildHtml(est, deps) { return compose(est, deps).html; }
function hasContent(est, deps) { return compose(est, deps).hasContent; }

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { buildHtml, hasContent, termsFooterHtml, MAX_TERMS_CHARS };
if (typeof window !== "undefined") window.EPOfferPdf = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
