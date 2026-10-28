/* К11-3в. Окно выбора состава листа монтажника: галочки «что показать», готовые наборы
   «Строителю»/«Клиенту» и три своих слота (как в КП). Открывается кнопкой «Лист монтажника» в шапке
   и той же кнопкой в окне поста; «Открыть лист» печатает проект или этот один пост РОВНО по текущим
   галочкам (слова заказчика 15.10: «ставлю галочки → он выдаёт»).

   ОТДЕЛЬНО ОТ «НАСТРОЙКИ СОСТАВА КП» (владелец 28.10): галочки листа и КП не пересекаются — своё окно,
   свой модуль (владелец 10.10: «для каждого модуля свой файл»); app.js только подключает.

   УСТРОЙСТВО — фабрика (как js/wallScope.js/postBuilder.js): app.js зовёт create(deps) один раз, модуль
   сам провязывает кнопки #installSheetWindowModal и отдаёт { open, close, isOpen }. Чистую модель
   галочек/наборов держит EPInstallSheetOptions (fields/preset/normalize/слоты, §7.1 — одна точка); здесь
   только DOM и связка с проектом/EPPrefs. Галочки — свойство ПРОЕКТА (readOptions/writeOptions из app.js,
   рядом с offerOptions), свои слоты — ПРИВЫЧКА ЧЕЛОВЕКА в ep_prefs (общие для всех проектов), как в КП.

   deps = { $, esc, EPPrefs, readOptions(), writeOptions(opts) }.
   open({ target:"project"|"post", print }) — target "post" гасит «План с номерами» (у листа одного поста
   плана нет, п.5); print печатает проект или этот пост. */
(() => {
"use strict";
/* Свои слоты листа — СВОЙ ключ ep_prefs, отдельный от КП ("offerPresets"): наборы галочек листа и
   столбцов КП не должны затирать друг друга (решение 2, docs/К11-разведка.md). */
const PREFS_KEY = "installSheetPresets";

function create(deps) {
  const $ = deps.$;
  const esc = deps.esc;
  const EPPrefs = deps.EPPrefs;
  const O = (typeof window !== "undefined" && window.EPInstallSheetOptions) || null;
  /* Куда и что печатать решает открывший окно (шапка → проект, окно поста → один пост). Печать
     запускает «Открыть лист», а не сам клик по кнопке «Лист монтажника» (владелец 28.10). */
  let target = "project";
  let printFn = null;

  function customPresets() { return O.normalizeCustomPresets(EPPrefs.get(PREFS_KEY, [])); }

  /* Галочки — из схемы (EPInstallSheetOptions.fields): порядок и подписи оттуда, второй копии нет.
     Новое поле листа появится в окне само, как в КП (renderOfferOptions строит из схемы). */
  function renderFields() {
    $("installSheetOptionsFields").innerHTML = O.fields.map(([key, label]) =>
      `<label><input type="checkbox" data-sheet-key="${esc(key)}">${esc(label)}</label>`).join("");
  }

  /* Кнопки своих наборов: заполненный слот — «применить» + «↻ перезаписать текущими галочками»; пустой —
     «＋ Свой набор N». Имя набора вводит человек → через esc. Разметка и классы — те же, что у КП. */
  function renderCustom() {
    $("installSheetCustomPresets").innerHTML = customPresets().map((slot, i) => slot
      ? `<span class="offer-custom"><button class="btn ghost small offer-custom-apply" type="button" data-sheet-apply="${i}" title="Применить набор «${esc(slot.name)}»">${esc(slot.name)}</button>`
        + `<button class="btn ghost small offer-custom-save" type="button" data-sheet-save="${i}" title="Перезаписать «${esc(slot.name)}» текущими галочками">↻</button></span>`
      : `<button class="btn ghost small offer-custom-empty" type="button" data-sheet-save="${i}" title="Сохранить текущие галочки как свой набор">＋ Свой набор ${i + 1}</button>`).join("");
    highlight();
  }

  /* Синхронизировать чекбоксы с текущим состоянием галочек проекта. «План с номерами» в режиме одного
     поста — видна, но неактивна (серая): плана у листа одного поста нет (п.5). Состояние checked
     показываем честно даже у выключенного чекбокса. */
  function sync() {
    const o = deps.readOptions();
    O.fields.forEach(([key]) => {
      const input = $("installSheetOptionsFields").querySelector(`[data-sheet-key="${key}"]`);
      if (!input) return;
      input.checked = !!o[key];
      input.disabled = key === "plan" && target === "post";
    });
    highlight();
  }

  /* Активный набор — тот, чей состав совпадает с текущими галочками (EPInstallSheetOptions.sameOptions).
     Подсвечиваем и готовые кнопки, и свои: человек видит, что выбрано. Изменил галочку руками — ни одна
     кнопка не активна, и это честно. Без DOM (тесты) молча выходим. */
  function highlight() {
    if (typeof document === "undefined") return;
    const cur = deps.readOptions();
    document.querySelectorAll("[data-sheet-preset]").forEach(btn =>
      btn.classList.toggle("active", O.sameOptions(cur, O.preset(btn.dataset.sheetPreset))));
    const list = customPresets();
    document.querySelectorAll("[data-sheet-apply]").forEach(btn => {
      const slot = list[Number(btn.dataset.sheetApply)];
      btn.classList.toggle("active", !!slot && O.sameOptions(cur, slot.options));
    });
  }

  function applyPreset(name) { deps.writeOptions(O.preset(name)); sync(); }

  function applyCustom(i) {
    const slot = customPresets()[i];
    if (!slot) return;
    deps.writeOptions(slot.options); sync();
  }

  /* Сохранить текущие галочки в слот под именем от человека. Пустое имя (отмена prompt или пробелы) —
     слот не трогаем: без названия набор не выбрать. */
  function saveCustom(i) {
    const list = customPresets();
    const name = (prompt("Название набора галочек листа", list[i] ? list[i].name : "") || "").trim();
    if (!name) return;
    EPPrefs.set(PREFS_KEY, O.saveCustomPreset(list, i, name, deps.readOptions()));
    renderCustom();
  }

  /* Переключение галочки → в проект + scheduleSave (внутри writeOptions), как у КП. */
  function toggle(input) {
    const key = input.dataset.sheetKey;
    if (!key) return;
    const o = deps.readOptions();
    o[key] = input.checked;
    deps.writeOptions(o); sync();
  }

  function isOpen() { return $("installSheetWindowModal").classList.contains("open"); }
  function close() { $("installSheetWindowModal").classList.remove("open"); }

  function open(cfg) {
    target = cfg && cfg.target === "post" ? "post" : "project";
    printFn = (cfg && cfg.print) || null;
    /* Подсказка про недоступный план — только в режиме одного поста. */
    const hint = $("installSheetPlanHint"); if (hint) hint.hidden = target !== "post";
    renderCustom(); sync();
    $("installSheetWindowModal").classList.add("open");
    setTimeout(() => $("installSheetWindowOpen").focus(), 0);
  }

  /* Провязка — в одном модуле с самой модалкой (app.js остаётся оркестратором, конкретную модалку
     целиком отдаём наружу), как у EPWallScope. Крестик и клик по фону закрывают окно без печати. */
  renderFields();
  $("installSheetWindowClose").onclick = close;
  $("installSheetWindowModal").onclick = e => { if (e.target === $("installSheetWindowModal")) close(); };
  $("installSheetOptionsFields").onchange = e => { if (e.target.dataset.sheetKey) toggle(e.target); };
  $("installSheetCustomPresets").onclick = e => {
    const apply = e.target.closest("[data-sheet-apply]");
    if (apply) { applyCustom(Number(apply.dataset.sheetApply)); return; }
    const save = e.target.closest("[data-sheet-save]");
    if (save) saveCustom(Number(save.dataset.sheetSave));
  };
  document.querySelectorAll("[data-sheet-preset]").forEach(btn => {
    btn.onclick = () => applyPreset(btn.dataset.sheetPreset);
  });
  /* «Открыть лист» печатает текущий выбор проекта/поста по текущим галочкам. Печать читает галочки
     сама (readOptions в docs/postBuilder), поэтому сюда их не передаём — одна точка (§7.1). */
  $("installSheetWindowOpen").onclick = () => { const fn = printFn; close(); if (fn) fn(); };

  return { open, close, isOpen };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports (тесты). */
const api = { create };
if (typeof window !== "undefined") window.EPInstallSheetWindow = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
