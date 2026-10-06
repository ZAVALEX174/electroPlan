/* Отмена/возврат изменений плана (Б4, часть А). Владелец: «над планом появятся кнопки „Отменить"
   и „Вернуть", работают Ctrl+Z и Ctrl+Y; любое изменение плана отменяется по шагу назад, и смета
   возвращается к прежней сумме; „Вернуть" повторяет отменённое».

   ЧИСТЫЙ МОДУЛЬ, как planRotate.js/confirmRepeat.js: ни DOM, ни state, ни EP_DATA. На вход — снимки
   проекта (projectSnapshot) и event-подобные объекты, на выход — что применить и какое действие сделать.
   Оркестратор app.js снимает/применяет снимки и рисует кнопки; ПРАВИЛО «что входит в план», «когда два
   состояния считаются одинаковыми» и «что делает нажатая комбинация» живёт здесь в одном месте, чтобы у
   правки не было краёв (HANDOFF §7.1).

   ПОЧЕМУ ОТМЕНЯЕТСЯ НЕ ВЕСЬ СНИМОК, А ТОЛЬКО «ПЛАН». projectSnapshot кладёт в проект и нарисованное
   (посты/стены/комнаты/разметку/масштаб/углы), и настройки сделки (работы/материалы/скидка/НДС/курс/
   валюта), и вид холста (pan/scale), и подложку-чертёж. Отменять настройки и вид владелец не просил:
   отмена поста не должна откатывать курс евро или вернуть камеру. Поэтому у снимка белый список полей
   плана (PLAN_FIELDS) — ровно их history и хранит, сравнивает и применяет. Остальные поля снимка
   (настройки, вид, подложка) history не трогает: при undo они остаются текущими. */
(() => {
"use strict";

/* БЕЛЫЙ СПИСОК ПОЛЕЙ ПЛАНА — единственный источник правды «что отменяется». Совпадает с решением
   владельца: нарисованное (devices/posts/rooms/walls/autoWalls/roomLines), память полей исчезнувших
   комнат, масштаб (pxPerMeter/scaleSegment), оба угла (подложки planRotation и всего плана worldAngle)
   и сама ПОДЛОЖКА-ЧЕРТЁЖ (plan — data-URL растра, planLabel — имя файла; часть Б): загрузка чертежа,
   «Убрать план» и «Очистить холст» отменяются по шагу назад.
   НЕ входят: terms/docHeader/offerOptions/assemblyView (настройки сделки), view/orthoMode/snapGrid/
   gridStep/rotateTarget (вид и режимы), name/savedAt (метаданные снимка). ОСОБЫЙ СЛУЧАЙ planVisibility
   («показана/бледная/скрыта», клавиша B): отдельным шагом НЕ является (переключение видимости не
   отменяется — решение владельца), поэтому в классификации остаётся «видом» и в ключ сравнения НЕ
   входит; но planOf всё же переносит её, а app.js восстанавливает ТОЛЬКО вместе со сменой подложки —
   так откат «Убрать план» возвращает ту видимость, что была до удаления. Поля поста (скидка позиции,
   тип стены, подсветка, группы/номера проходных) едут внутри самих объектов posts. */
const PLAN_FIELDS = ["devices", "posts", "rooms", "walls", "autoWalls", "roomLines",
  "roomFieldMemory", "pxPerMeter", "scaleSegment", "planRotation", "worldAngle", "plan", "planLabel"];

/* ПРОИЗВОДНЫЕ ПОЛЯ, которые renderAll пересчитывает САМ из геометрии и поэтому НЕ считаются
   изменением плана. Иначе каждый renderAll после применения снимка менял бы их заново и порождал
   ложный шаг истории (HANDOFF §7.1, R8):
     · roomId у постов/устройств — привязку к комнате ставит recalculateRoomAssignments;
     · componentId/seedX/seedY у комнат — компонент пространства и точку подписи считает drawRooms.
   Координаты объекта (x/y) при переносе меняются по-настоящему — их не исключаем, перенос обязан быть
   шагом; seed/componentId лишь следуют за координатами и сами по себе шага не образуют. */
const DERIVED_DEVICE = ["roomId"];
const DERIVED_POST = ["roomId"];
const DERIVED_ROOM = ["componentId", "seedX", "seedY"];

/* ДЕШЁВЫЙ ОТПЕЧАТОК ПОДЛОЖКИ — для ключа сравнения и для переиспользования строки (ниже). Подложка —
   data-URL растра в десятки МБ; сериализовать её целиком в ключ или сравнивать побайтно на каждом шаге
   недопустимо (память/время). Берём длину и по 48 символов с краёв: у двух РАЗНЫХ картинок совпасть разом
   и длина, и оба края практически невозможно, а стоит это O(1), не O(размера). Нет подложки → "". */
function planFp(src) {
  if (!src) return "";
  const s = String(src);
  return s.length + "|" + s.slice(0, 48) + "|" + s.slice(-48);
}

/* Поля плана из снимка — ровно PLAN_FIELDS, с фолбэками под пустой/битый снимок. Их записывает
   applyPlanSnapshot в app.js: массивы — копией из снимка, углы/масштаб — как есть, подложку (plan/
   planLabel) — ссылкой на строку data-URL. planVisibility переносим вместе с подложкой (app.js применит
   её только при смене чертежа, см. PLAN_FIELDS), иначе откат «Убрать план» не вернул бы её значение. */
function planOf(snapshot) {
  const s = snapshot || {};
  return {
    devices: Array.isArray(s.devices) ? s.devices : [],
    posts: Array.isArray(s.posts) ? s.posts : [],
    rooms: Array.isArray(s.rooms) ? s.rooms : [],
    walls: Array.isArray(s.walls) ? s.walls : [],
    autoWalls: Array.isArray(s.autoWalls) ? s.autoWalls : [],
    roomLines: Array.isArray(s.roomLines) ? s.roomLines : [],
    roomFieldMemory: Array.isArray(s.roomFieldMemory) ? s.roomFieldMemory : [],
    pxPerMeter: s.pxPerMeter == null ? null : s.pxPerMeter,
    scaleSegment: s.scaleSegment || null,
    planRotation: s.planRotation == null ? 0 : s.planRotation,
    worldAngle: s.worldAngle == null ? 0 : s.worldAngle,
    plan: s.plan == null ? null : s.plan,
    planLabel: s.planLabel || "",
    planVisibility: s.planVisibility || "show"
  };
}

/* КЛЮЧ СРАВНЕНИЯ ПЛАНА: стабильная строка из полей плана БЕЗ производных полей (см. DERIVED_*). Два
   снимка с одинаковым ключом — одно и то же состояние плана, шаг между ними не записывается. Строим
   нормализованный объект в фиксированном порядке полей и сериализуем: порядок ключей объектов внутри
   массивов берётся из самих объектов (как их собрал app.js — он собирает их одинаково от снимка к
   снимку), поэтому JSON двух равных планов совпадает побайтно. */
function stripDerived(arr, keys) {
  return (Array.isArray(arr) ? arr : []).map(o => {
    if (!o || typeof o !== "object") return o;
    const c = {};
    for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k) && keys.indexOf(k) < 0) c[k] = o[k];
    return c;
  });
}
function planKey(snapshot) {
  const s = snapshot || {};
  const norm = {
    devices: stripDerived(s.devices, DERIVED_DEVICE),
    posts: stripDerived(s.posts, DERIVED_POST),
    rooms: stripDerived(s.rooms, DERIVED_ROOM),
    walls: Array.isArray(s.walls) ? s.walls : [],
    autoWalls: Array.isArray(s.autoWalls) ? s.autoWalls : [],
    roomLines: Array.isArray(s.roomLines) ? s.roomLines : [],
    roomFieldMemory: Array.isArray(s.roomFieldMemory) ? s.roomFieldMemory : [],
    pxPerMeter: s.pxPerMeter == null ? null : s.pxPerMeter,
    scaleSegment: s.scaleSegment || null,
    planRotation: s.planRotation == null ? 0 : s.planRotation,
    worldAngle: s.worldAngle == null ? 0 : s.worldAngle,
    /* подложку в ключ кладём ОТПЕЧАТКОМ, а не самой строкой: смена/загрузка/сброс чертежа обязаны быть
       шагом (отпечаток сменится), но держать десятки МБ в ключе сравнения нельзя. planVisibility в ключ
       НЕ входит — её переключение шагом не является. */
    planFp: planFp(s.plan),
    planLabel: s.planLabel || ""
  };
  return JSON.stringify(norm);
}

/* СТЕК ИСТОРИИ. Внутри — массив записей {snap, key} и позиция pos (индекс текущей головы). Записи до
   pos — то, во что можно вернуться через «Отменить»; после pos — то, что вернёт «Вернуть». Новое
   действие после отмены сбрасывает «Вернуть» (срезаем хвост за pos) — решение владельца. limit — число
   шагов отмены (50 по решению владельца, EPConfig.historyLimit); базовая точка в это число не входит,
   поэтому держим не более limit+1 записей. Стек не хранит ничего, кроме снимков, — он чистый и
   тестируемый без окружения. */
function create(limit) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  let entries = [];
  let pos = -1;
  /* ⚠️ ХРАНИМ ГЛУБОКУЮ КОПИЮ ПЛАНА, А НЕ ССЫЛКИ. projectSnapshot кладёт state.posts/rooms/… по ССЫЛКЕ,
     а правки идут мутацией на месте (state.posts.push(...)). Без копии сохранённый снимок менялся бы
     вместе с живым состоянием, и откатывать было бы не к чему. Поля плана — чистые данные (числа,
     строки, массивы, простые объекты), поэтому копируем тем же JSON-кругом, что и хранилище проекта.
     На отдаче (undo/redo) отдаём ЕЩЁ одну копию — чтобы последующие правки живого state не портили
     запись в стеке. */
  /* ⚠️ КЛОН ПОЛЕЙ ПЛАНА БЕЗ КОПИИ ПОДЛОЖКИ. Всё, кроме plan, — чистые данные (числа, строки, массивы,
     простые объекты): копируем JSON-кругом, как хранилище проекта. Строку data-URL (plan) через JSON НЕ
     гоняем — она в десятки МБ, а строки в JS неизменяемы: достаточно сохранить ТУ ЖЕ ссылку. */
  const clonePlanFields = p => {
    const url = p.plan;
    const c = JSON.parse(JSON.stringify(Object.assign({}, p, { plan: null })));
    c.plan = url == null ? null : url;
    return c;
  };
  /* Запись шага. prevPlan — план предыдущей головы: если подложка не изменилась (совпал отпечаток),
     ПЕРЕИСПОЛЬЗУЕМ её строку из прошлой записи вместо свежей из снимка. Так 50 шагов с одним чертежом
     держат ОДНУ строку: img.src отдаёт новый экземпляр строки на каждом чтении, иначе в стеке осело бы
     50 копий многомегабайтного data-URL. */
  const mk = (snap, prevPlan) => {
    const p = planOf(snap);
    if (prevPlan && planFp(p.plan) === planFp(prevPlan.plan)) p.plan = prevPlan.plan;
    return { plan: clonePlanFields(p), key: planKey(snap) };
  };
  const give = plan => clonePlanFields(plan);

  /* Базовая точка: единственная запись, в которую пока нельзя ни отменить, ни вернуть. Зовётся в init
     после восстановления проекта — от неё отсчитываются все последующие шаги. */
  function reset(snap) { entries = [mk(snap)]; pos = 0; }

  /* Зафиксировать шаг. План не изменился (ключ совпал с головой) → шага нет (false): так дедуплицируются
     сохранения, не трогающие план (зум, выделение, применение снимка), и повторные сейвы одного действия
     (дебаунс + прямой persist). Изменился → срезаем «Вернуть», кладём запись головой и прижимаем длину к
     лимиту (теряем самые старые шаги, не новые). */
  function push(snap) {
    if (pos < 0) { reset(snap); return true; }
    const e = mk(snap, entries[pos].plan);
    /* Тот же шаг (ключ совпал) → НЕ создаём шаг, но ОСВЕЖАЕМ голову: единственное не-ключевое поле
       плана — planVisibility (видимость подложки не отменяется, поэтому её нет в ключе). Без обновления
       головы её текущее значение терялось бы для истории — и откат «Убрать план», восстанавливающий
       видимость из шага ДО удаления, вернул бы устаревшее значение, а не то, что было в момент удаления.
       Геометрия/углы/подложка у равного ключа тождественны, так что замена меняет только видимость. */
    if (e.key === entries[pos].key) { entries[pos] = e; return false; }
    entries = entries.slice(0, pos + 1);
    entries.push(e);
    if (entries.length > cap + 1) entries = entries.slice(entries.length - (cap + 1));
    pos = entries.length - 1;
    return true;
  }

  /* Дополнить голову: заменить снимок текущего шага новым, НЕ создавая отдельного шага и НЕ трогая
     «Вернуть». Нужно для автопересборки комнат из разметки — она следствие клика по линии (того же
     шага), а не самостоятельное действие человека. */
  function amend(snap) {
    if (pos < 0) { reset(snap); return; }
    entries[pos] = mk(snap, entries[pos].plan);
  }

  /* Снять голову-шаг (В19: «поставил и тут же убрал» двойным кликом не должен оставить ни «поставил»,
     ни «убрал»). Срезает текущую запись и сдвигает позицию назад — план возвращается к тому, что было
     ДО зафиксированного шага. Базовую точку (pos=0) не трогаем. */
  function dropHead() { if (pos > 0) { entries.splice(pos, 1); pos -= 1; return true; } return false; }

  function undo() { if (pos > 0) { pos -= 1; return give(entries[pos].plan); } return null; }
  function redo() { if (pos < entries.length - 1) { pos += 1; return give(entries[pos].plan); } return null; }
  function canUndo() { return pos > 0; }
  function canRedo() { return pos < entries.length - 1; }
  function size() { return entries.length; }
  function position() { return pos; }

  return { reset, push, amend, dropHead, undo, redo, canUndo, canRedo, size, position };
}

/* КАКИЕ ПОЛЯ ЦЕЛЬ НАЖАТИЯ СЧИТАЕМ ТЕКСТОВЫМИ. В них Ctrl+Z обязан остаться БРАУЗЕРНОЙ отменой ввода, а
   не откатом плана: человек печатает имя комнаты/число и жмёт Ctrl+Z, отменяя символ. Текст — textarea,
   contenteditable и <input> текстовых типов (text/number/search/без типа и прочие вводимые). НЕ текст —
   галочка/радио/ползунок/кнопка-инпут и <select>: по решению владельца клик по ним — часть работы над
   планом, и Ctrl+Z после него отменяет действие плана. */
const NON_TEXT_INPUT = ["checkbox", "radio", "range", "button", "submit", "reset", "file", "color", "image", "hidden"];
function isTextTarget(t) {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName || "").toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return NON_TEXT_INPUT.indexOf((t.type || "").toLowerCase()) < 0;
  return false;   /* select, button, холст, body — не текст */
}

/* РЕШЕНИЕ ПО НАЖАТИЮ. ev — event-подобный объект {code, ctrlKey, metaKey, shiftKey, target}; ctx —
   {modalOpen}. Возвращает "undo" | "redo" | null. Правило (решение владельца): Ctrl/⌘+Z — отменить,
   Ctrl/⌘+Y и Ctrl/⌘+Shift+Z — вернуть; при открытой модалке — ничего; в текстовом поле — ничего (отдаём
   браузеру); удержание (e.repeat) НЕ отсекаем — откат подряд разрешён, поэтому repeat здесь не смотрим.
   Чистая функция: вынесена из document.onkeydown, потому что стенд не умеет вырезать присваивание
   onkeydown, а правило хоткея обязано проверяться автотестом по всем случаям. */
function hotkeyAction(ev, ctx) {
  ev = ev || {};
  ctx = ctx || {};
  if (ctx.modalOpen) return null;
  if (!(ev.ctrlKey || ev.metaKey)) return null;
  if (ev.code !== "KeyZ" && ev.code !== "KeyY") return null;
  if (isTextTarget(ev.target)) return null;
  if (ev.code === "KeyY") return "redo";
  return ev.shiftKey ? "redo" : "undo";
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { PLAN_FIELDS, planOf, planKey, planFp, create, hotkeyAction, isTextTarget };
if (typeof window !== "undefined") window.EPHistory = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
