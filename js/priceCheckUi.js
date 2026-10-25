/* Окно «Прайс по шаблону» (К9, часть 3 — утверждено владельцем 24.10):
   «В программе появится кнопка „Прайс по шаблону“: окно с двумя действиями — „Скачать шаблон“
   (Excel с нужными программе столбцами…) и „Проверить файл“ (заказчик выбирает свой прайс и прямо
   в окне видит отчёт: „нет столбца «Цвет накладки»“, „строка 57 — нет цены“, „тип управления «Ж» не
   распознан“, и итог „ошибок нет — файл можно отдавать“). Каталог программы при этом не меняется.»

   УСТРОЙСТВО — как у EPProjectSetup: ЧИСТАЯ часть (buildReport: результат EPPriceTemplate.check →
   модель отчёта с группами, итогом и УЖЕ ЭКРАНИРОВАННЫМ текстом; reportHtml строит из неё разметку)
   покрыта тестом+мутацией. attach(ctx) — тонкая связка: строит окно, вешает кнопки, читает .xls через
   SheetJS, показывает отчёт. Своей логики подбора в attach нет.

   КАТАЛОГ И ПРОЕКТ НЕ ТРОГАЕМ (цитата «Каталог программы при этом не меняется»). Модуль НЕ знает ни про
   EP_DATA, ни про localStorage, ни про state — он только читает выбранный файл и рисует отчёт. Поэтому
   ни скачивание шаблона, ни проверка файла физически не могут изменить каталог или сохранённый проект.

   SheetJS (js/vendor/xlsx.full.min.js) грузим ЛЕНИВО — только при первом «Проверить файл», динамическим
   <script> (без CDN, файл лежит в репозитории). На старте страницы ~860 КБ не тянем и в сеть не ходим.
   Сборка full выбрана ради кодовых страниц BIFF: файл заказчика — русский .xls, а codepage-таблицы
   (нужные для кириллицы в части .xls) есть только в full.

   Двойной экспорт: браузеру — window.EPPriceCheckUi (сборщика нет, PLAN 2.2), Node — module.exports. */
(() => {
"use strict";

/* ---- Чистая часть: результат check() → модель отчёта (тестируется без DOM) ---- */

/*
 * buildReport(result, esc) — превращает { ok, errors, warnings } из EPPriceTemplate.check() в модель
 * для показа. КАЖДОЕ сообщение прогоняется через esc: в тексты check() попадают значения из файла
 * заказчика (например «тип управления «Ж»»), а это непроверенный ввод — в HTML только экранированным.
 * Итог «можно ли отдавать» считаем по ОШИБКАМ (предупреждения на пригодность не влияют), в одном месте.
 */
function buildReport(result, esc) {
  const e = typeof esc === "function" ? esc : (s) => String(s == null ? "" : s);
  const r = result || {};
  const errors = (Array.isArray(r.errors) ? r.errors : []).map((x) => ({ count: x.count | 0, text: e(x.message) }));
  const warnings = (Array.isArray(r.warnings) ? r.warnings : []).map((x) => ({ count: x.count | 0, text: e(x.message) }));
  const ok = errors.length === 0;
  const summary = ok
    ? "Ошибок нет — файл можно отдавать."
    : "Найдено ошибок: " + errors.length + ". Их нужно исправить в файле.";
  return { ok, errorCount: errors.length, warningCount: warnings.length, summary, errors, warnings };
}

/* Разметка отчёта из модели. Текст пунктов уже экранирован в buildReport; count — число, cls —
   константа модуля, их экранировать не нужно. Бейдж с числом строк показываем только когда оно есть
   (у находки «нет столбца» строк нет, count = 0 — бейдж был бы бессмысленным нулём). */
function reportHtml(report) {
  const rep = report || {};
  const list = (items, cls) => "<ul class=\"pc-list\">" + (items || []).map((x) => {
    const badge = x.count > 0 ? "<span class=\"pc-count\">" + x.count + "</span>" : "";
    return "<li class=\"pc-item " + cls + "\">" + badge + "<span class=\"pc-text\">" + x.text + "</span></li>";
  }).join("") + "</ul>";

  let html = "<div class=\"pc-summary " + (rep.ok ? "ok" : "bad") + "\">" + escConst(rep.summary) + "</div>";
  if (rep.errors && rep.errors.length)
    html += "<div class=\"pc-group\"><h3 class=\"pc-group-title bad\">Ошибки (" + rep.errorCount + ")</h3>" + list(rep.errors, "bad") + "</div>";
  if (rep.warnings && rep.warnings.length)
    html += "<div class=\"pc-group\"><h3 class=\"pc-group-title warn\">Предупреждения (" + rep.warningCount + ")</h3>" + list(rep.warnings, "warn") + "</div>";
  return html;
}

/* Итог buildReport собрали мы сами (не из файла), но страхуемся встроенным экранированием: случайная
   скобка/амперсанд в нашей же фразе не должна попасть в разметку сырой. Пользовательского ввода тут нет. */
function escConst(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---- Связка с окном (DOM) ---- */

function attach(ctx) {
  ctx = ctx || {};
  const esc = typeof ctx.esc === "function" ? ctx.esc : escConst;
  const vendorSrc = ctx.vendorSrc || "js/vendor/xlsx.full.min.js";
  const doc = (typeof document !== "undefined") ? document : null;
  if (!doc) return { open() {}, close() {} };

  /* Окно строим в JS (index.html несёт только кнопку и <script> — требование владельца «новый код в свой
     модуль»). Классы те же, что у остальных модалок (.modal-backdrop > .modal > .modal-header/.modal-footer),
     поэтому выглядит как соседние окна. Статическая оболочка — наш собственный текст, без ввода заказчика. */
  const backdrop = doc.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "priceCheckModal";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "priceCheckTitle");
  backdrop.innerHTML =
    "<div class=\"modal price-check-modal\">" +
      "<div class=\"modal-header\">" +
        "<div><span class=\"eyebrow\">Прайс по шаблону</span><h2 id=\"priceCheckTitle\">Прайс по шаблону</h2></div>" +
        "<button class=\"modal-close\" id=\"priceCheckClose\" type=\"button\" aria-label=\"Закрыть\">&times;</button>" +
      "</div>" +
      "<p class=\"scale-modal-copy\">Скачайте шаблон с нужными программе столбцами или проверьте свой прайс — отчёт появится ниже. Каталог программы при этом не меняется.</p>" +
      "<div class=\"pc-actions\">" +
        "<button class=\"btn ghost\" id=\"priceCheckDownload\" type=\"button\">Скачать шаблон</button>" +
        "<label class=\"btn primary pc-file-btn\">Проверить файл<input type=\"file\" id=\"priceCheckInput\" accept=\".xls,.xlsx\" hidden></label>" +
      "</div>" +
      "<div class=\"pc-report\" id=\"priceCheckReport\"></div>" +
      "<div class=\"modal-footer\"><button class=\"btn ghost\" id=\"priceCheckDone\" type=\"button\">Закрыть</button></div>" +
    "</div>";
  doc.body.appendChild(backdrop);

  const $id = (id) => backdrop.querySelector("#" + id);
  const reportBox = $id("priceCheckReport");
  const fileInput = $id("priceCheckInput");

  function setReport(html) { reportBox.innerHTML = html; }
  function info(text) { return "<p class=\"pc-info\">" + escConst(text) + "</p>"; }

  function open() { backdrop.classList.add("open"); }
  function close() { backdrop.classList.remove("open"); }

  /* Скачивание шаблона — байты из EPPriceTemplateFile.build() в Blob и временная ссылка a[download].
     Тот же приём, что у выгрузки спецификации (EPDocs.exportSpecExcel). Состояние программы не трогаем. */
  function downloadTemplate() {
    const TF = (typeof window !== "undefined") ? window.EPPriceTemplateFile : null;
    if (!TF) { setReport(info("Не удалось собрать шаблон: модуль генерации недоступен.")); return; }
    const built = TF.build();
    const blob = new Blob([built.bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url; a.download = built.fileName;
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /* Ленивая загрузка SheetJS: один раз, по первому «Проверить файл». Промис кэшируем, повторные нажатия
     библиотеку не перекачивают. CDN не используем — только локальный файл репозитория. */
  let xlsxPromise = null;
  function loadXlsx() {
    if (typeof window !== "undefined" && window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise((resolve, reject) => {
      const s = doc.createElement("script");
      s.src = vendorSrc;
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("XLSX не инициализировался")));
      s.onerror = () => reject(new Error("не удалось загрузить библиотеку чтения Excel"));
      doc.head.appendChild(s);
    });
    return xlsxPromise;
  }

  /* Лист данных выбираем ТОЙ ЖЕ функцией, что и конвертер (EPPriceSheet.chooseSheet, §7.1): лист
     «VIMAR» по trim, иначе первый лист со столбцом «Артикул», иначе первый лист. startRow — номер
     первой строки листа в Excel (из !ref), чтобы номера строк в отчёте совпали с номерами Excel.
     header:1 — как в тесте модуля и в конвертере: массив массивов, цена приходит числом/строкой. */
  function pickSheetRows(XLSX, wb) {
    const S = (typeof window !== "undefined") ? window.EPPriceSheet : null;
    const names = (wb && wb.SheetNames) || [];
    const toRows = (nm) => XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1 });
    if (!S) return { rows: names.length ? toRows(names[0]) : [], startRow: 1 };
    const chosen = S.chooseSheet({
      names,
      grid: toRows,
      ref: (nm) => wb.Sheets[nm] && wb.Sheets[nm]["!ref"],
    });
    return { rows: chosen.grid, startRow: chosen.startRow };
  }

  /* Проверка выбранного файла. Любой сбой чтения (не Excel, битый файл) — понятное сообщение в окне,
     без падения: окно не должно «молчать» или рушить приложение на чужом файле. */
  async function checkFile(file) {
    if (!file) return;
    setReport(info("Читаю файл «" + file.name + "»…"));
    let XLSX;
    try {
      XLSX = await loadXlsx();
    } catch (e) {
      setReport(info("Не удалось загрузить библиотеку чтения Excel. Обновите страницу и попробуйте снова."));
      return;
    }
    let picked;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      picked = pickSheetRows(XLSX, wb);
    } catch (e) {
      setReport(info("Не удалось прочитать файл как Excel (.xls или .xlsx). Выберите файл прайса в формате Excel."));
      return;
    }
    const T = (typeof window !== "undefined") ? window.EPPriceTemplate : null;
    if (!T) { setReport(info("Не удалось проверить файл: модуль проверки недоступен.")); return; }
    const report = buildReport(T.check(picked.rows, { startRow: picked.startRow }), esc);
    setReport(reportHtml(report));
  }

  // Открыть окно — кнопка в шапке по id из ctx (её разметка в index.html) и возвращаемый open().
  const openBtn = ctx.openBtnId && doc.getElementById(ctx.openBtnId);
  if (openBtn) openBtn.onclick = open;

  $id("priceCheckClose").onclick = close;
  $id("priceCheckDone").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };   // клик мимо — закрыть, как у прочих окон
  $id("priceCheckDownload").onclick = downloadTemplate;
  fileInput.onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    checkFile(f);
    e.target.value = "";   // позволить выбрать тот же файл повторно (событие change иначе не придёт)
  };

  return { open, close };
}

const api = { buildReport, reportHtml, attach };
if (typeof window !== "undefined") window.EPPriceCheckUi = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
