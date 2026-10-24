/* Вкладки вариантов отделки комнаты в панели свойств (К8а, часть 4) — связка интерфейса над чистым
   EPRoomVariants. Отдельный модуль по образцу js/roomWalls.js (владелец 10.10: «для каждого модуля
   свой файл, чтобы не засорять app.js»): app.js только строит HTML полей отделки из ВЫБРАННОГО
   варианта и зовёт отсюда tabsHtml/removeBtnHtml/bindTabs, а также writeField/writeSelection вместо
   прямой записи в поля комнаты.

   --- ЗАЧЕМ --------------------------------------------------------------------------------------
   В одной комнате бывает «немецкий для вертикальных, итальянский для остального» — до пяти наборов
   отделки (решение владельца 24.10, «пяти хватит»). Структура, лимит, каскад и переезд вариантов в
   плоские поля живут в EPRoomVariants (части 1–2, приняты). Здесь — только интерфейс: вкладки
   «Вариант 1…N», кнопка «+ вариант» (пропадает на пяти), «Удалить вариант» (нет при одном варианте)
   и запись правок ЧЕРЕЗ EPRoomVariants (одна трактовка, у правки нет краёв — §7.1).

   --- ВЫБРАННАЯ ВКЛАДКА — СОСТОЯНИЕ ИНТЕРФЕЙСА, НЕ ПРОЕКТ (решение владельца) ----------------------
   Индекс активной вкладки хранится здесь, в модульной переменной, и в проект НЕ пишется: при смене
   комнаты сбрасывается на Вариант 1, после удаления зажимается в границы (ближайший существующий).
   Так чужой/перезагруженный проект всегда открывается на первом варианте, а не на том, где кто-то
   остановился в прошлый раз.

   Интерфейс: window.EPRoomVariantsUi. */
(() => {
"use strict";

/* Структура, лимит и каскад вариантов живут в EPRoomVariants — зовём ЕЁ, а не свою копию (§7.1). Как
   в roomCarry.js: в браузере namespace уже загружен (roomVariants.js подключён раньше), в Node —
   резолвим через require, чтобы автотесты модуля работали без window-шима. */
function V() {
  if (typeof window !== "undefined" && window.EPRoomVariants) return window.EPRoomVariants;
  if (typeof require !== "undefined") return require("./roomVariants.js");
  return null;
}
/* Каталог нужен лишь для подписи «стандарт словом» (standardLabel) в селекторе варианта окна поста.
   Резолвим как V(): в браузере namespace загружен (catalog.js раньше), в Node — через require. */
function Catalog() {
  if (typeof window !== "undefined" && window.EPCatalog) return window.EPCatalog;
  if (typeof require !== "undefined") return require("./catalog.js");
  return null;
}
/* Экранирование для вставки в innerHTML. Поля вариантов (серия/материал/форма/цвет) приходят из
   ОТКРЫТОГО ФАЙЛА ПРОЕКТА (room.moreVariants) — это пользовательские данные, в разметку только через esc
   (как селектор «Комната» в postBuilder). Модуль-локальный, чтобы не тянуть esc из app.js через аргументы. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Подпись комнаты человеку в заголовках отделки (К8б, решение владельца): «для какой комнаты вы
   выбираете». Имя — текущее room.name; пустое нормализуем в «Комната» ТЕМ ЖЕ правилом, что saveRoom/
   EPRoomDraft.commit, — одна подпись у комнаты во всех местах (§7.1). Возвращаем УЖЕ экранированным:
   результат уходит в innerHTML заголовка панели отделки и окна «Подбор накладки». */
function roomLabel(room) {
  const name = String(room && room.name != null ? room.name : "").trim() || "Комната";
  return esc(name);
}

/* Полный текст заголовка блока «Отделка накладки — <комната>» в правой панели. Держим в ОДНОМ месте:
   его зовёт и шаблон панели (renderProperties), и точечное обновление после переименования комнаты
   (flushRoomDraft — как updateRoomLabelText для подписи на холсте), чтобы два заголовка не разошлись
   (§7.1). Имя через roomLabel — уже экранировано, префикс статичен; результат уходит в innerHTML. */
function facingTitle(room) {
  return "Отделка накладки — " + roomLabel(room);
}

/* Активная вкладка: к какой комнате относится и её индекс. Не проект — живёт только в сеансе. */
let activeSel = { roomId: null, index: 0 };

/* Индекс активной вкладки для комнаты roomId при count вариантах. Смена комнаты → Вариант 1
   (решение владельца: при смене комнаты сбрасывать). Индекс за пределами (после удаления) →
   ближайший существующий: зажимаем в [0, count-1]. Эту же функцию зовут и рендер панели, и
   открытие мастера, и запись — один источник «какой вариант сейчас редактируется». */
function activeIndex(roomId, count) {
  if (activeSel.roomId !== roomId) { activeSel.roomId = roomId; activeSel.index = 0; }
  if (!(activeSel.index >= 0)) activeSel.index = 0;
  if (activeSel.index > count - 1) activeSel.index = count > 0 ? count - 1 : 0;
  return activeSel.index;
}

/* Явно выбрать вкладку index у комнаты roomId (клик по вкладке, добавление/удаление варианта).
   Зажим в границы делает следующий activeIndex — здесь просто запоминаем намерение. */
function setActiveIndex(roomId, index) {
  activeSel = { roomId: roomId, index: index };
}

/* Применить результат операции EPRoomVariants ({fields, moreVariants}) к КОМНАТЕ: вариант 1 —
   плоские поля (заданный признак выставить, незаданный СНЯТЬ), варианты 2..n — moreVariants.
   ⚠️ ПУСТОЙ moreVariants → УДАЛИТЬ поле, а не писать []: иначе старый проект без доп.вариантов
   получил бы пустой массив «из воздуха» и перестал читаться как «одна отделка». FIELDS берём из
   EPRoomVariants — второй список признаков не заводим. */
function applyResult(room, result) {
  V().FIELDS.forEach(f => {
    const v = result.fields[f];
    if (typeof v === "string" && v) room[f] = v; else delete room[f];
  });
  if (Array.isArray(result.moreVariants) && result.moreVariants.length) room.moreVariants = result.moreVariants;
  else delete room.moreVariants;
}

/* Записать один признак варианта index (список-вид селекторов): каскад и валидацию держит
   V().setVariantField, применение к комнате — applyResult. Вызывающий (app.js) дальше
   сам перерисовывает панель и сохраняет проект — как делали прежние onchange. */
function writeField(room, index, prop, value) {
  applyResult(room, V().setVariantField(room, index, prop, value));
}

/* Записать НАБОР признаков варианта index (вид «С картинками»: мастер задаёт сразу серию+материал+…).
   Идём по FIELDS тем же каскадом setVariantField, что и список-вид, — чтобы у записи варианта не было
   второй трактовки (§7.1). sel — черновик мастера (framePickerSel), прошедший каскад pickFrameStep,
   поэтому в нём нет «дыр»; незаданный признак снимается (value undefined → setVariantField СНИМАЕТ). */
function writeSelection(room, index, sel) {
  V().FIELDS.forEach(prop => { writeField(room, index, prop, sel ? sel[prop] : undefined); });
}

/* Полоса вкладок «Отделка: [Вариант 1] … [+ вариант]». Подписи статичны («Вариант N», N — номер),
   пользовательского ввода нет — экранировать нечего. «+ вариант» ПРОПАДАЕТ на пяти вариантах
   (V().MAX): больше пяти нельзя (владелец «пяти хватит»). */
function tabsHtml(variants, index) {
  const tabs = variants.map((_, i) =>
    '<button type="button" class="room-variant-tab' + (i === index ? ' active' : '')
    + '" id="roomVariantTab' + i + '" aria-pressed="' + (i === index) + '">Вариант ' + (i + 1) + '</button>'
  ).join("");
  const add = variants.length < V().MAX
    ? '<button type="button" class="room-variant-add" id="roomVariantAdd">+ вариант</button>' : "";
  return '<div class="room-variants-tabs"><span class="room-variants-label">Отделка:</span>'
    + '<div class="room-variants-list">' + tabs + add + '</div></div>';
}

/* Кнопка «Удалить вариант» под полями отделки. При ОДНОМ варианте кнопки нет (решение владельца:
   «нет кнопки при одном варианте») — комната всегда имеет минимум один вариант отделки. */
function removeBtnHtml(variants) {
  if (variants.length <= 1) return "";
  return '<div class="room-variant-remove-row"><button type="button" class="btn ghost room-variant-remove" id="roomVariantRemove">Удалить вариант</button></div>';
}

/* Привязка вкладок, «+ вариант» и «Удалить вариант» в панели свойств (разметку даёт tabsHtml/
   removeBtnHtml, её вставляет app.js). deps.$ — узлы по id, deps.renderProperties — перерисовка
   панели, deps.persistProject — сохранение. Переключение вкладки — ЧИСТОЕ состояние интерфейса:
   только перерисовка, БЕЗ persistProject (в проект выбор вкладки не пишем). Добавление/удаление
   меняют moreVariants комнаты → persistProject. Отделка не денежная (в estimate.js не входит, посты
   считаются по варианту 1) — renderSummary/renderAll здесь не нужны, как у onchange списка. */
function bindTabs(room, deps) {
  const $ = deps.$;
  const variants = V().list(room);
  const idx = activeIndex(room.id, variants.length);
  variants.forEach((_, i) => {
    const b = $("roomVariantTab" + i);
    if (b) b.onclick = () => { setActiveIndex(room.id, i); deps.renderProperties(); };
  });
  const addBtn = $("roomVariantAdd");
  if (addBtn) addBtn.onclick = () => {
    const result = V().addVariant(room);
    if (!result) return;                                            /* уже пять — кнопки быть не должно, но страхуемся */
    applyResult(room, result);
    setActiveIndex(room.id, V().list(room).length - 1);  /* новый вариант пуст и сразу выбран */
    deps.persistProject();
    deps.renderProperties();
  };
  const removeBtn = $("roomVariantRemove");
  if (removeBtn) removeBtn.onclick = () => {
    applyResult(room, V().removeVariant(room, idx));     /* удаляем ВЫБРАННЫЙ; удаление первого → второй переезжает в плоские поля (EPRoomVariants) */
    setActiveIndex(room.id, idx);                                   /* тот же индекс; activeIndex зажмёт его в новые границы (ближайший существующий) */
    deps.persistProject();
    deps.renderProperties();
  };
}

/* ─── СЕЛЕКТОР «ВАРИАНТ» В ОКНЕ ПОСТА (К8а, часть 3, решение владельца 24.10) ──────────────────────
   Отдельно от вкладок панели комнаты (выше): в окне поста выбирают, ПОД КАКОЙ вариант отделки комнаты
   собирается пост — от него накладка и механизмы. Структура/лимит вариантов — та же EPRoomVariants (V()),
   второй копии нет (§7.1). Вариант у поста НЕ хранится: индекс живёт в state.builder (окно поста зовёт
   эти функции), как и выбранная комната. */

/* Зажать индекс варианта в границы комнаты [0, N-1]. N всегда ≥1 (V().list не пуст), поэтому для
   одновариантной комнаты всегда 0 — поведение байт-в-байт прежнего (пост собирается по единственной
   отделке = плоским полям). Нестроковый/пустой index → 0. */
function builderIndex(room, index){
  const n = V().list(room).length;
  const i = (index | 0);
  return i < 0 ? 0 : (i > n - 1 ? n - 1 : i);
}
/* Начальный вариант при ОТКРЫТИИ окна (производное решение, сообщено владельцу): новый пост → 0
   (isExisting=false); существующий пост/шаблон → индекс ПЕРВОГО варианта, которому подходит его накладка
   (V().fitIndex по предикату fits от вызывающего — он знает каталог), не подошёл ни одному → 0. Комнаты
   нет → 0. Так пост на плане открывается на «своём» варианте, а не всегда на первом. */
function builderInitialIndex(room, frame, isExisting, fits){
  if (!room || !isExisting) return 0;
  const i = V().fitIndex(V().list(room), frame, fits);
  return i < 0 ? 0 : i;
}
/* Подпись варианта в селекторе: «Вариант N: <стандарт словом> · <серия> · <цвет>»; ни одного признака
   не задано → «Вариант N: любая отделка». Стандарт словом — через переданный standardLabel (тот же
   EPCatalog.standardLabel, что везде); серия/цвет — прямо поля варианта (канонические из каталога).
   noFrames (К8г, решение владельца Б): под вариант в каталоге нет ни одной накладки — к подписи
   добавляем « — нет накладок», чтобы собрать несовместимое через окно поста тоже было видно нельзя. */
function builderVariantLabel(variant, i, standardLabel, noFrames){
  const parts = [];
  if (variant.standard) parts.push(standardLabel(variant.standard));
  if (variant.collection) parts.push(variant.collection);
  if (variant.frameColor) parts.push(variant.frameColor);
  return "Вариант " + (i + 1) + ": " + (parts.length ? parts.join(" · ") : "любая отделка")
    + (noFrames ? " — нет накладок" : "");
}
/* Отрисовать и привязать селектор «Вариант» в окне поста. Поле ПОЯВЛЯЕТСЯ ТОЛЬКО при >1 варианте
   (решение: при одном варианте селектора нет, выбирать не из чего) — иначе скрыто и пусто. deps:
   { $, room, index, onChange, variantHasNoFrames? }. onChange(i) — реакция окна на выбор: ровно смена
   комнаты (postBuilder зовёт applyAutoDefaultFrame + renderBuilder), второй трактовки нет (§7.1).
   variantHasNoFrames(variant) — необязательный предикат «под вариант накладок нет» (К8г, Б): нет его
   → пометки нет (прежнее поведение). Подпись содержит ПОЛЯ ВАРИАНТА из файла проекта (серия/цвет) —
   пользовательский ввод, поэтому в HTML кладём через esc (value — индекс-число, экранировать нечего). */
function renderBuilderVariantSelect(deps){
  const $ = deps.$, wrap = $("builderVariantField"), sel = $("builderVariantSelect");
  if (!wrap || !sel) return;
  const variants = deps.room ? V().list(deps.room) : [];
  if (variants.length <= 1) { wrap.hidden = true; sel.innerHTML = ""; return; }
  wrap.hidden = false;
  const idx = builderIndex(deps.room, deps.index);
  const standardLabel = Catalog().standardLabel;
  const noFrames = typeof deps.variantHasNoFrames === "function" ? deps.variantHasNoFrames : () => false;
  sel.innerHTML = variants.map((v, i) =>
    '<option value="' + i + '"' + (i === idx ? ' selected' : '') + '>' + esc(builderVariantLabel(v, i, standardLabel, noFrames(v))) + '</option>'
  ).join("");
  sel.value = String(idx);
  sel.onchange = e => deps.onChange(Number(e.target.value) || 0);
}

/* ─── К8г: СУЖЕНИЕ ОТДЕЛКИ В ПАНЕЛИ КОМНАТЫ («Списком») + «нет накладок» ───────────────────────────
   «Нельзя собрать несовместимое»: в виде «Списком» каждое поле отделки предлагает только значения,
   при которых под ВЕРХНИЕ уже выбранные поля варианта есть накладки. Отбор — ТОТ ЖЕ Catalog().
   productsForRoom, что у мастера «С картинками» и у конструктора поста (§7.1): второй копии правила
   нет. Порядок полей — V().FIELDS (стандарт→серия→материал→форма→цвет); критерий берём ТОЛЬКО из
   полей ВЫШЕ текущего — нижние как раз выбирают, они сужать не должны.
   validate(variant,prop) — валидированное действующее значение поля (мёртвое/снятое из прайса → null);
   его даёт app.js (EPRoom.roomCollection/roomFrameFacing по спискам каталога) — один источник
   валидации и для подписей, и здесь. */
function facingUpperPool(frames, variant, prop, validate){
  const fields = V().FIELDS, i = fields.indexOf(prop), criteria = {};
  for (let k = 0; k < i; k++){ const up = validate(variant, fields[k]); if (up) criteria[fields[k]] = up; }
  return Catalog().productsForRoom(frames, criteria);
}
/* Значения признака В ПУЛЕ — та же диспетчеризация, что у мастера (framePickerDeps.valuesOf): стандарт
   раскрывает BOTH (productStandards), серия — массив (productCollections), отделка — скаляр
   (productFacingValues). */
function facingValuesOf(pool, prop){
  const C = Catalog();
  return prop === "standard" ? C.productStandards(pool)
    : prop === "collection" ? C.productCollections(pool) : C.productFacingValues(pool, prop);
}
/* <option>ы одного поля отделки для вида «Списком». Значения сужены верхними полями. Решение владельца
   (А): сохранённое значение, выпавшее из суженного списка, но валидное по каталогу, ОСТАЁТСЯ выбранным
   отдельной опцией «<значение> (не подходит)» — данные проекта не трогаем ни при открытии, ни при
   сохранении. emptyLabel — текст пункта «не задано». Подпись стандарта — словом (standardLabel),
   прочие признаки человеческие как есть. Значения серии/цвета из файла проекта — в HTML через esc. */
function facingFieldOptionsHtml(frames, variant, prop, emptyLabel, validate){
  const values = facingValuesOf(facingUpperPool(frames, variant, prop, validate), prop);
  const cur = validate(variant, prop);
  const label = v => prop === "standard" ? Catalog().standardLabel(v) : v;
  let html = '<option value=""' + (cur ? '' : ' selected') + '>' + esc(emptyLabel) + '</option>'
    + values.map(v => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label(v)) + '</option>').join("");
  if (cur && values.indexOf(cur) === -1)
    html += '<option value="' + esc(cur) + '" selected>' + esc(label(cur)) + ' (не подходит)</option>';
  return html;
}
/* Есть ли под ВЕСЬ вариант хоть одна накладка (решение владельца Б). Критерий — все пять полей
   варианта (валидированные тем же validate), отбор — тот же productsForRoom. True → накладок нет,
   вызывающий (панель комнаты и селектор окна поста) показывает «нет подходящих накладок». Полный
   критерий собираем по V().FIELDS — это перечень тех же полей, что строит roomCatalogFilter у окна
   поста; сам отбор (productsForRoom) один, второй копии нет (§7.1). */
function variantHasNoFrames(frames, variant, validate){
  const criteria = {};
  V().FIELDS.forEach(f => { const v = validate(variant, f); if (v) criteria[f] = v; });
  return Catalog().productsForRoom(frames, criteria).length === 0;
}

/* ─── К8г, решение владельца (2): смена ВАРИАНТА/КОМНАТЫ у НОВОГО поста с несовместимой накладкой ───
   Текст подтверждения: накладка, выбранная руками, не подходит новому варианту; продолжение сбросит
   её к умолчанию варианта и ВСЕ механизмы поста. labels — условия варианта (frameFacingSelectionLabels),
   их даёт окно поста; пусто → без скобок. Формулировку держим здесь, у правила (§7.1). */
function builderVariantResetMessage(labels){
  const cond = labels && labels.length ? " (" + labels.join(", ") + ")" : "";
  return "Выбранная накладка не подходит этому варианту отделки" + cond
    + ". Продолжить? Накладка заменится на подходящую по умолчанию, а все механизмы поста будут сброшены.";
}
/* Развилка смены варианта/комнаты у поста. d — замыкания от окна поста (postBuilder, §7.1 — одно
   правило на оба селектора): applicable — правило применимо (НОВЫЙ пост, накладка выбрана руками,
   она есть); fits — подходит ли текущая накладка новому варианту (EPPostVariant.placementFits, тот же
   предикат, что у размещения и окна); confirm(msg) — подтверждение существующим способом окна;
   reset() — сбросить механизмы и вернуть накладку к авто-умолчанию; apply() — записать вариант/комнату
   и перерисовать; restore() — вернуть селектор на прежнее значение, ничего не меняя.
   Не применимо или накладка подходит → молча apply(); иначе ОК → reset+apply, Отмена → restore. */
function applyBuilderVariantChange(d){
  if(!d.applicable || d.fits){ d.apply(); return; }
  if(d.confirm(d.message)){ d.reset(); d.apply(); }
  else d.restore();
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { roomLabel, facingTitle, activeIndex, setActiveIndex, applyResult, writeField, writeSelection, tabsHtml, removeBtnHtml, bindTabs,
  builderIndex, builderInitialIndex, builderVariantLabel, renderBuilderVariantSelect,
  facingFieldOptionsHtml, variantHasNoFrames, builderVariantResetMessage, applyBuilderVariantChange };
if (typeof window !== "undefined") window.EPRoomVariantsUi = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
