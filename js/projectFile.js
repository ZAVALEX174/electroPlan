/* Проект в файл: «Скачать проект» (сохранить на диск), «Открыть проект» (с этого или другого
   компьютера) и «Новый проект» (чистый, с предупреждением о не скачанном). Решения владельца 19.10
   (docs/проект-в-файл-разведка-2026-10-19.md, §«Решения владельца по 5 вопросам»).

   УСТРОЙСТВО — как у EPDocs/EPRoomWalls: ЧИСТЫЕ функции (формат файла, разбор/проверка, имя файла,
   подпись «скачан», слияние бланка «своё главнее») живут в экспортируемом api и покрыты тестами +
   мутацией; attach(ctx) — тонкая связка: читает FileReader, пишет Blob, трогает DOM, провязывает три
   кнопки шапки и окно подтверждения. Логики в attach нет — только порядок вызовов чистых функций.

   ГЛАВНЫЙ КРАЙ (разведка): файл собирается из projectSnapshot() НАПРЯМУЮ, а не из ProjectStore — при
   переполнении localStorage persistProject кладёт туда plan:null, и файл потерял бы чертёж. Снимок в
   обёртку кладём как есть, вместе с планом-data-URL. Поэтому download берёт ctx.projectSnapshot().

   БЛАНК ЧЕЛОВЕКА И ШАБЛОНЫ ПОСТОВ (решение 1): в файл кладём бланк (EPPrefs: реквизиты исполнителя,
   логотип/подпись/печать, условия, наборы столбцов КП) и шаблоны постов. При ОТКРЫТИИ своё главнее:
   на этом компьютере ключа нет — берём из файла; есть свой — оставляем свой (по каждому ключу
   отдельно). offerCounters (номера КП) и ep_eur_rate (кэш курса) в файл НЕ едут — это свойство
   компьютера, а не проекта.

   «НЕ СКАЧАН» (решение 3): проект изменился после последнего скачивания (или ни разу не скачивали).
   Опорная подпись снимка (без savedAt/view) лежит в localStorage и переживает перезагрузку; автосейв
   её не трогает — любое изменение проекта само разводит текущую подпись с опорной.

   Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для тестов. */
(() => {
"use strict";

const FORMAT = "electroplan-project";
const VERSION = 1;

/* Ключи бланка человека (EPPrefs), которые едут в файл проекта (решение владельца 19.10, п.1).
   offerCounters и ep_eur_rate сюда НЕ входят намеренно — см. шапку. */
const PREF_KEYS = ["myRequisites", "companyLogo", "companySignature", "companyStamp", "companyTerms", "offerPresets"];

/* «Пусто» для бланка: null/""/пустой объект/пустой массив. Объект myRequisites по умолчанию {} — это
   «своего нет», значит при открытии его замещает бланк из файла; непустой объект — своё, не трогаем. */
function isBlank(v) {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/* Обёртка файла: снимок проекта + бланк человека + шаблоны постов. Снимок кладём КАК ЕСТЬ (с планом):
   его обязан передать вызывающий из projectSnapshot(), не из ProjectStore (там plan:null при
   переполнении) — иначе файл потеряет чертёж. */
function build(snapshot, prefs, postTemplates) {
  return {
    format: FORMAT,
    version: VERSION,
    savedAt: new Date().toISOString(),
    project: snapshot,
    prefs: prefs && typeof prefs === "object" ? prefs : {},
    postTemplates: Array.isArray(postTemplates) ? postTemplates : []
  };
}

/* Разбор и проверка открываемого файла. Чужой/битый JSON — отказ (ok:false) с понятным сообщением,
   текущий проект вызывающий не трогает. Файл от БОЛЕЕ НОВОЙ версии формата открываем, но помечаем
   newer:true — вызывающий предупредит «часть данных может не отобразиться» (решение 19.10, п.5). */
function parse(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch (e) { return { ok: false, error: "Это не файл проекта ElectroPlan: файл не читается." }; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    return { ok: false, error: "Это не файл проекта ElectroPlan." };
  if (obj.format !== FORMAT)
    return { ok: false, error: "Это не файл проекта ElectroPlan." };
  if (typeof obj.version !== "number" || !obj.project || typeof obj.project !== "object")
    return { ok: false, error: "Файл проекта повреждён — открыть не удалось." };
  return {
    ok: true,
    newer: obj.version > VERSION,
    version: obj.version,
    project: obj.project,
    prefs: obj.prefs && typeof obj.prefs === "object" ? obj.prefs : {},
    postTemplates: Array.isArray(obj.postTemplates) ? obj.postTemplates : []
  };
}

/* Подпись снимка для отметки «проект скачан». Хэш по снимку БЕЗ savedAt и view: дата снимка каждый раз
   новая, вид (куда сдвинут/как масштабирован холст) меняется без изменения сути — не исключи их, и
   «не скачан» загоралось бы сразу после скачивания. Детерминированный строковый хэш (djb2-xor): тот же
   вход → та же подпись. Коллизии для задачи «изменилось ли» пренебрежимы, а хэш (а не вся строка)
   дёшев в localStorage, даже когда в снимке план-data-URL на мегабайты. */
function signature(snapshot) {
  const s = Object.assign({}, snapshot);
  delete s.savedAt;
  delete s.view;
  const json = JSON.stringify(s);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 33) ^ json.charCodeAt(i)) >>> 0;
  return String(h);
}

/* Имя файла из названия проекта / номера КП и даты, без запрещённых в Windows символов
   (\ / : * ? " < > | и управляющих) и без завершающих точек/пробелов (их Windows тоже не любит).
   Пусто всё → «Проект». Расширение .electroplan.json. */
function fileName(project, number, date) {
  const base = (project && String(project).trim()) || (number && String(number).trim()) || "Проект";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
  const safe = (base + " " + day)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim() || "Проект";
  return safe + ".electroplan.json";
}

/* Бланк человека для записи в файл: {ключ: значение} по PREF_KEYS, пустые опускаем. get(key) — чтение
   одного ключа EPPrefs (передаёт attach). */
function pickPrefs(get) {
  const out = {};
  PREF_KEYS.forEach(k => { const v = get(k); if (!isBlank(v)) out[k] = v; });
  return out;
}

/* Слияние бланка при открытии (решение 19.10, п.1), по каждому ключу отдельно: своё непустое —
   оставляем (не в списке на запись); своего нет, а в файле непустое — берём из файла. localPrefs —
   текущий бланк этого компьютера (как у pickPrefs), filePrefs — из файла. Возвращает [[ключ,значение]]
   к записи в EPPrefs. */
function mergePrefs(filePrefs, localPrefs) {
  const out = [];
  PREF_KEYS.forEach(k => {
    if (!isBlank(localPrefs ? localPrefs[k] : undefined)) return;   // своё главнее
    const incoming = filePrefs ? filePrefs[k] : undefined;
    if (!isBlank(incoming)) out.push([k, incoming]);
  });
  return out;
}

/* Шаблоны постов (решение 19.10, п.1): свои есть — оставляем свои; своих нет — берём из файла.
   Возвращает список к записи в хранилище шаблонов либо null (писать нечего). */
function mergeTemplates(fileTemplates, localTemplates) {
  if (Array.isArray(localTemplates) && localTemplates.length) return null;   // свои есть — не трогаем
  return Array.isArray(fileTemplates) && fileTemplates.length ? fileTemplates : null;
}

/* Фабрика: раскладывает ctx, провязывает кнопки шапки и окно подтверждения, возвращает setCleanBaseline
   (его зовёт init на чистом старте — пустой проект «терять нечего»). Инфраструктурные глобалы
   (ProjectStore/EPPrefs/localStorage/location/Blob/FileReader/URL/document) берём напрямую — сборщика
   нет (PLAN 2.2), как EP_DATA у EPDocs; app.js-локальное приходит через ctx. */
function attach(ctx) {
  const { $, projectSnapshot, loadProject, docHeader, toast, readTemplates, writeTemplates } = ctx;

  const SIG_KEY = "ep_download_sig";
  function sigRead() { try { return localStorage.getItem(SIG_KEY); } catch (e) { return null; } }
  function sigWrite(v) { try { localStorage.setItem(SIG_KEY, v); } catch (e) { /* квота/приватный режим */ } }

  /* Опорная подпись = подпись «скачанного» снимка. «Не скачан» = опорной нет или текущая подпись с ней
     разошлась. Переживает перезагрузку (localStorage). */
  function setCleanBaseline(snapshot) { sigWrite(api.signature(snapshot)); }
  function isClean() { const base = sigRead(); return base != null && base === api.signature(projectSnapshot()); }

  /* --- Скачать проект в файл --- */
  function download() {
    const snap = projectSnapshot();                    // живой снимок (с планом), НЕ из ProjectStore
    const wrapper = api.build(snap, api.pickPrefs(k => EPPrefs.get(k)), readTemplates());
    const dh = docHeader();
    const name = api.fileName(dh.project, dh.number, dh.date);
    const blob = new Blob([JSON.stringify(wrapper, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);     // revoke откладываем — клик должен успеть забрать содержимое
    setCleanBaseline(snap);                            // только что скачали — проект «скачан»
    toast("Проект скачан в файл: " + name);
  }

  /* --- Открыть проект из файла --- */
  async function openParsed(parsed) {
    /* бланк: своё главнее (mergePrefs вернёт только недостающие на этом компьютере ключи) */
    api.mergePrefs(parsed.prefs, api.pickPrefs(k => EPPrefs.get(k))).forEach(([k, v]) => EPPrefs.set(k, v));
    const mergedTemplates = api.mergeTemplates(parsed.postTemplates, readTemplates());
    if (mergedTemplates) writeTemplates(mergedTemplates);
    ProjectStore.save(parsed.project);                 // кладём объект, дальше — общий путь загрузки
    await loadProject();                               // рендер, курс, шапка, вид, сброс истории — как init
    setCleanBaseline(projectSnapshot());               // открытый проект равен файлу на диске → «скачан»
    toast(parsed.newer
      ? "Файл создан в более новой версии программы, часть данных может не отобразиться"
      : "Проект открыт");
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onerror = () => toast("Файл не удалось прочитать.");
    reader.onload = () => {
      const parsed = api.parse(String(reader.result || ""));
      if (!parsed.ok) { toast(parsed.error); return; }           // чужой/битый — текущий проект не трогаем
      if (isClean()) { openParsed(parsed); return; }
      askConfirm({
        title: "Открыть проект",
        msg: "Текущий проект не скачан в файл. Открыть другой? Несохранённые изменения пропадут.",
        downloadLabel: "Скачать и открыть",
        proceedLabel: "Открыть без скачивания",
        onDownload: () => { download(); openParsed(parsed); },
        onProceed: () => openParsed(parsed)
      });
    };
    reader.readAsText(file);
  }

  /* --- Новый проект --- */
  /* Чистим проект в браузере и перезагружаем страницу: init без проекта ставит дефолты — самый
     надёжный «с нуля» (разведка, решение 4). Бланк человека и шаблоны (EPPrefs/ep_post_templates) при
     этом остаются — чистим только снимок проекта. */
  function startNew() { ProjectStore.clear(); location.reload(); }
  function newProject() {
    if (isClean()) { startNew(); return; }
    askConfirm({
      title: "Новый проект",
      msg: "Текущий проект не скачан в файл. Начать новый? Несохранённые изменения пропадут.",
      downloadLabel: "Скачать и начать новый",
      proceedLabel: "Начать без скачивания",
      onDownload: () => { download(); startNew(); },
      onProceed: startNew
    });
  }

  /* --- Окно подтверждения (3 кнопки): «Скачать и …» / «… без скачивания» / «Отмена» --- */
  const modal = $("projectConfirmModal");
  function closeConfirm() { if (modal) modal.classList.remove("open"); }
  function askConfirm(o) {
    $("projectConfirmTitle").textContent = o.title;
    $("projectConfirmMsg").textContent = o.msg;
    $("projectConfirmDownload").textContent = o.downloadLabel;
    $("projectConfirmProceed").textContent = o.proceedLabel;
    $("projectConfirmDownload").onclick = () => { closeConfirm(); o.onDownload(); };
    $("projectConfirmProceed").onclick = () => { closeConfirm(); o.onProceed(); };
    modal.classList.add("open");
  }
  if (modal) {
    $("projectConfirmCancel").onclick = closeConfirm;
    $("projectConfirmClose").onclick = closeConfirm;
    modal.onclick = e => { if (e.target === modal) closeConfirm(); };   // клик мимо — отмена, как у прочих окон
  }

  /* Провязка кнопок шапки (как EPDocs провязывает #pdfBtn). Открытие — скрытым input; value обнуляем,
     чтобы тот же файл можно было выбрать повторно (change иначе не сработает). */
  $("downloadProjectBtn").onclick = download;
  $("openProjectBtn").onclick = () => $("openProjectInput").click();
  $("openProjectInput").onchange = e => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
    e.target.value = "";
  };
  $("newProjectBtn").onclick = newProject;

  return { setCleanBaseline };
}

const api = { FORMAT, VERSION, PREF_KEYS, isBlank, build, parse, signature, fileName, pickPrefs, mergePrefs, mergeTemplates, attach };
if (typeof window !== "undefined") window.EPProjectFile = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
