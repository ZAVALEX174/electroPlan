/* Перетаскивание файла плана на холст (решение владельца 25.10). Пока файл несут над окном вида,
   оно обводится рамкой с надписью «Отпустите, чтобы загрузить план»; при отпускании файл грузится
   ТЕМ ЖЕ путём, что через кнопку «Загрузить план» — потребитель передаёт сюда свою функцию загрузки
   (onFile), копии логики импорта здесь нет (§7.1 HANDOFF: правило живёт в одном месте).

   ЧИСТАЯ ЧАСТЬ — hasFiles/firstFile: «несёт ли перетаскивание файлы» и «какой файл взять». Обе
   работают с обычным объектом DataTransfer и проверяются в Node без браузера. attach — тонкая обёртка:
   вешает dnd-события на ПЕРЕДАННЫЙ элемент (окно вида, не #canvas: у #canvas transform от pan/zoom,
   рамку надо держать в экранных координатах) и зовёт переданные show/hide/onFile. DOM сюда приходит
   аргументами — модуль не знает ни id, ни state (конвенция js/*: зависимости только через аргументы).
   Вынести обвязку в модуль, а не в app.js, просил владелец: «для каждого модуля свой файл».

   Интерфейс — window.EPPlanDrop. */
(() => {
"use strict";

/* Несёт ли перетаскивание ФАЙЛЫ (а не текст/внутренний объект холста). Во время dragenter/dragover
   dataTransfer.files ещё пуст — браузер отдаёт содержимое только на drop, поэтому во время переноса
   смотрим types: при переносе файлов из ОС он содержит "Files". types бывает DOMStringList или массив —
   оба перебираются по length/индексу. */
function hasFiles(dataTransfer) {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === "Files") return true;
  return false;
}

/* Какой файл грузить: первый из перенесённых. Предпочитаем .files (есть на drop); если его нет,
   но есть .items — берём первый item с kind==="file" (getAsFile). Файлов нет → null. */
function firstFile(dataTransfer) {
  if (!dataTransfer) return null;
  const files = dataTransfer.files;
  if (files && files.length) return files[0];
  const items = dataTransfer.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.kind === "file" && typeof it.getAsFile === "function") {
        const f = it.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

/* Вешает перетаскивание файла на el. opts: {el, onFile(file), show(), hide(), escTarget}.
   Реагируем ТОЛЬКО когда несут файлы (hasFiles) — перенос текста и перетаскивание постов/устройств
   мышью (это не HTML5-dnd) не трогаем и рамку не показываем, preventDefault им не шлём.
   dragenter/dragleave всплывают и с вложенных узлов холста — считаем глубину, рамку снимаем лишь
   когда вышли со всех (depth<=0). Рамка снимается также на drop и по Esc.

   СТРАХОВКА от зависшей рамки. Если перенос отменили (клавиша/край окна/dragCancel), браузер может
   НЕ прислать ни dragleave, ни drop — рамка осталась бы висеть. Во время HTML5-dnd браузер не шлёт
   mousemove/pointerdown на document; значит первое такое событие после показа рамки = перенос
   завершился — снимаем рамку. Плюс dragend/drop на window (перенос кончился мимо холста). Слушатели
   passive, без preventDefault — обычной работе холста (пан, клики, перетаскивание постов) не мешают. */
function attach(opts) {
  const el = opts.el;
  const onFile = opts.onFile;
  const show = opts.show || function () {};
  const hide = opts.hide || function () {};
  const doc = opts.doc || (typeof document !== "undefined" ? document : null);
  const win = opts.win || (typeof window !== "undefined" ? window : null);
  let depth = 0, armed = false;
  function disarmReset() { reset(); }
  function arm() {
    if (armed || !doc) return;
    armed = true;
    doc.addEventListener("mousemove", disarmReset, { passive: true });
    doc.addEventListener("pointerdown", disarmReset, { passive: true });
  }
  function reset() {
    depth = 0;
    if (armed && doc) {
      doc.removeEventListener("mousemove", disarmReset);
      doc.removeEventListener("pointerdown", disarmReset);
    }
    armed = false;
    hide();
  }

  el.addEventListener("dragenter", function (e) {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth++;
    arm();
    show();
  });
  el.addEventListener("dragover", function (e) {
    if (!hasFiles(e.dataTransfer)) return;
    /* preventDefault обязателен, иначе браузер не даст drop; dropEffect="copy" — курсор «копировать». */
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  el.addEventListener("dragleave", function (e) {
    if (!hasFiles(e.dataTransfer)) return;
    depth--;
    if (depth <= 0) reset();
  });
  el.addEventListener("drop", function (e) {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    reset();
    const f = firstFile(e.dataTransfer);
    if (f) onFile(f);
  });
  if (opts.escTarget) {
    opts.escTarget.addEventListener("keydown", function (e) {
      if (e.key === "Escape") reset();
    });
  }
  if (win) {
    win.addEventListener("dragend", disarmReset, { passive: true });
    win.addEventListener("drop", disarmReset, { passive: true });
  }
  return { reset };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports (автотесты). */
const api = { hasFiles, firstFile, attach };
if (typeof window !== "undefined") window.EPPlanDrop = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
