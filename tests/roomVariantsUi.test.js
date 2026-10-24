/* Автотесты связки вкладок вариантов отделки (EPRoomVariantsUi, К8а часть 4). Без зависимостей:
   node --test tests/roomVariantsUi.test.js

   ЗАЧЕМ. Структурную логику вариантов держит EPRoomVariants (tests/roomVariants.js). Здесь — слой
   интерфейса: применение результата к комнате (плоские поля/moreVariants), запись выбранного варианта
   через каскад, состояние активной вкладки и привязка кнопок. Это места, где легко потерять деньги/
   данные молча: запись ушла не в тот вариант, пустой moreVariants записан как [] (старый проект получил
   поле из воздуха), лимит 5 обойдён, удаление не сработало.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено — см. отчёт):
     applyResult: moreVariants:[] пишется полем (убрать ветку delete) → красит «пустой moreVariants СНИМАЕТ поле»;
     applyResult: заданное поле не выставляется (room[f] не пишется)  → красит «применяет плоские поля варианта 1»;
     applyResult: незаданное поле не снимается (убрать delete room[f])→ красит «снимает плоское поле, которого нет в варианте»;
     writeField игнорирует index (всегда 0)                          → красит «пишет в УКАЗАННЫЙ вариант, не в первый»;
     writeField без каскада (setVariantField→прямая запись)          → красит «смена верхнего признака стирает нижние (каскад)»;
     writeSelection пишет не все FIELDS                              → красит «мастер пишет весь набор и снимает незаданное»;
     activeIndex без сброса при смене комнаты                        → красит «смена комнаты → вкладка 1»;
     activeIndex без зажима сверху                                   → красит «индекс за пределами → ближайший существующий»;
     tabsHtml показывает «+ вариант» всегда                          → красит «+ вариант пропадает на пяти»;
     removeBtnHtml рисует кнопку при одном варианте                  → красит «кнопки удаления нет при одном варианте»;
     bindTabs: клик вкладки зовёт persistProject                     → красит «переключение вкладки НЕ сохраняется в проект»;
     bindTabs: add не делает активным новый вариант                  → красит «+ вариант делает новый выбранным»;
     bindTabs: remove удаляет не активный индекс                     → красит «Удалить вариант убирает ВЫБРАННЫЙ». */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../js/roomVariantsUi.js");
const V = require("../js/roomVariants.js");

/* --- applyResult: результат EPRoomVariants → поля комнаты ---------------------------------- */

test("applyResult применяет плоские поля варианта 1, незаданное СНИМАЕТ", () => {
  const room = { id: "a", name: "Кухня", standard: "IT", frameColor: "Старый" };
  U.applyResult(room, { fields: { standard: "DE", collection: "Plana" }, moreVariants: [] });
  assert.equal(room.standard, "DE", "заданный стандарт выставлен");
  assert.equal(room.collection, "Plana", "заданная серия выставлена");
  assert.ok(!("frameColor" in room), "признак, которого нет в варианте, СНЯТ (а не оставлен старым)");
  assert.equal(room.name, "Кухня", "не-отделочные поля комнаты не тронуты");
});

test("applyResult: пустой moreVariants СНИМАЕТ поле (а не пишет [])", () => {
  const room = { id: "a", moreVariants: [{ standard: "DE" }] };
  U.applyResult(room, { fields: { standard: "IT" }, moreVariants: [] });
  assert.ok(!("moreVariants" in room),
    "⚠️ пустой массив вариантов УДАЛЯЕТ поле — иначе старый проект без доп.вариантов получил бы [] из воздуха");
});

test("applyResult: непустой moreVariants записывается", () => {
  const room = { id: "a", standard: "IT" };
  U.applyResult(room, { fields: { standard: "IT" }, moreVariants: [{ standard: "DE" }, { collection: "Arke" }] });
  assert.deepEqual(room.moreVariants, [{ standard: "DE" }, { collection: "Arke" }]);
});

/* --- writeField: запись одного признака через каскад, в УКАЗАННЫЙ вариант -------------------- */

test("writeField пишет в УКАЗАННЫЙ вариант, не в первый", () => {
  const room = { id: "a", standard: "IT", moreVariants: [{ standard: "DE" }] };
  U.writeField(room, 1, "collection", "Plana");
  assert.equal(room.standard, "IT", "вариант 1 (плоские поля) не тронут");
  assert.deepEqual(room.moreVariants, [{ standard: "DE", collection: "Plana" }],
    "правка ушла именно в вариант 2 — вкладка пишет в свой вариант");
});

test("writeField каскадит: смена верхнего признака стирает нижние", () => {
  const room = { id: "a", standard: "IT", collection: "Arke", frameMaterial: "Металл", frameColor: "Белый" };
  U.writeField(room, 0, "standard", "DE");   /* стандарт — верхний шаг: всё ниже него стирается */
  assert.equal(room.standard, "DE");
  assert.ok(!("collection" in room) && !("frameMaterial" in room) && !("frameColor" in room),
    "смена стандарта обнулила серию/материал/цвет — тот же каскад, что в мастере (§7.1)");
});

test("writeField с пустым значением СНИМАЕТ признак", () => {
  const room = { id: "a", standard: "IT", collection: "Arke" };
  U.writeField(room, 0, "collection", "");
  assert.ok(!("collection" in room), "«Не задана» (пустое) удаляет поле");
  assert.equal(room.standard, "IT", "вышележащий стандарт сохраняется");
});

/* --- writeSelection: запись набора из мастера «С картинками» --------------------------------- */

test("writeSelection пишет весь набор мастера и снимает незаданное", () => {
  const room = { id: "a", standard: "IT", collection: "Старая", frameColor: "Чёрный" };
  U.writeSelection(room, 0, { standard: "DE", collection: "Plana", frameMaterial: "Пластик" });
  assert.equal(room.standard, "DE");
  assert.equal(room.collection, "Plana");
  assert.equal(room.frameMaterial, "Пластик");
  assert.ok(!("frameColor" in room), "незаданный в мастере цвет СНЯТ (как «Не задан»)");
  assert.ok(!("frameShape" in room), "незаданная форма не появилась");
});

test("writeSelection пишет в указанный вариант 2", () => {
  const room = { id: "a", standard: "IT", moreVariants: [{}] };
  U.writeSelection(room, 1, { standard: "DE", collection: "Arke" });
  assert.equal(room.standard, "IT", "вариант 1 не тронут");
  assert.deepEqual(room.moreVariants, [{ standard: "DE", collection: "Arke" }]);
});

/* --- activeIndex / setActiveIndex: состояние вкладки (не проект) ----------------------------- */

test("activeIndex по умолчанию 0 и сбрасывается при СМЕНЕ комнаты", () => {
  assert.equal(U.activeIndex("roomX", 3), 0, "первое обращение к комнате — вкладка 1 (индекс 0)");
  U.setActiveIndex("roomX", 2);
  assert.equal(U.activeIndex("roomX", 3), 2, "в пределах одной комнаты выбор держится");
  assert.equal(U.activeIndex("roomY", 3), 0, "другая комната — снова вкладка 1 (сброс)");
});

test("activeIndex зажимает индекс за пределами к ближайшему существующему", () => {
  U.setActiveIndex("roomZ", 4);
  assert.equal(U.activeIndex("roomZ", 2), 1, "после удаления вариантов индекс 4 зажат до последнего (1)");
  U.setActiveIndex("roomZ", 4);
  assert.equal(U.activeIndex("roomZ", 1), 0, "остался один вариант — вкладка 1");
});

/* --- tabsHtml / removeBtnHtml: разметка --------------------------------------------------- */

test("tabsHtml: вкладки по числу вариантов, активная помечена, «+ вариант» до пяти", () => {
  const html = U.tabsHtml([{}, {}, {}], 1);
  assert.equal((html.match(/room-variant-tab/g) || []).length, 3, "три вкладки на три варианта");
  assert.match(html, /id="roomVariantTab1" aria-pressed="true"/, "активна вкладка выбранного индекса");
  assert.match(html, /id="roomVariantTab0" aria-pressed="false"/);
  assert.match(html, /id="roomVariantAdd"/, "при трёх вариантах «+ вариант» есть");
  assert.match(html, /Вариант 1<\/button>/, "подпись — по номеру");
});

test("tabsHtml: «+ вариант» ПРОПАДАЕТ на пяти вариантах (MAX)", () => {
  assert.equal(V.MAX, 5, "предпосылка: предел — пять вариантов");
  const html = U.tabsHtml([{}, {}, {}, {}, {}], 0);
  assert.doesNotMatch(html, /roomVariantAdd/, "на пяти вариантах кнопки добавления нет — больше нельзя");
  assert.equal((html.match(/room-variant-tab/g) || []).length, 5);
});

test("removeBtnHtml: нет кнопки при одном варианте, есть при двух и более", () => {
  assert.equal(U.removeBtnHtml([{}]), "", "один вариант — кнопки удаления нет");
  assert.match(U.removeBtnHtml([{}, {}]), /id="roomVariantRemove"/, "два варианта — кнопка есть");
});

/* --- bindTabs: привязка вкладок/«+ вариант»/«Удалить вариант» -------------------------------- */

/* DOM-шим под bindTabs: $ отдаёт узел только для ЗАДАННЫХ id (как в браузере, где отсутствующей
   кнопки нет и $() вернёт null) — так проверяется guard `if(addBtn)`. У узла один слот onclick. */
function makeTabsDom(ids) {
  const els = {};
  ids.forEach(id => { els[id] = { onclick: null, click() { this.onclick && this.onclick(); } }; });
  return { els, $: id => els[id] || null };
}
const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };

test("bindTabs: клик по вкладке переключает активную и НЕ сохраняет проект", () => {
  const room = { id: "tabs1", standard: "IT", moreVariants: [{ standard: "DE" }] };
  const dom = makeTabsDom(["roomVariantTab0", "roomVariantTab1", "roomVariantAdd", "roomVariantRemove"]);
  const renderProperties = spy(), persistProject = spy();
  U.setActiveIndex("tabs1", 0);
  U.bindTabs(room, { $: dom.$, renderProperties, persistProject });
  dom.els.roomVariantTab1.click();
  assert.equal(U.activeIndex("tabs1", 2), 1, "выбрана вкладка 2");
  assert.equal(renderProperties.calls, 1, "панель перерисована");
  assert.equal(persistProject.calls, 0, "⚠️ переключение вкладки — состояние интерфейса, в проект НЕ пишется");
});

test("bindTabs: «+ вариант» добавляет пустой вариант, делает его выбранным и сохраняет", () => {
  const room = { id: "tabs2", standard: "IT" };
  const dom = makeTabsDom(["roomVariantTab0", "roomVariantAdd"]);
  const renderProperties = spy(), persistProject = spy();
  U.setActiveIndex("tabs2", 0);
  U.bindTabs(room, { $: dom.$, renderProperties, persistProject });
  dom.els.roomVariantAdd.click();
  assert.deepEqual(room.moreVariants, [{}], "добавлен пустой вариант 2");
  assert.equal(U.activeIndex("tabs2", 2), 1, "новый вариант сразу выбран");
  assert.equal(persistProject.calls, 1, "добавление сохранено (moreVariants — часть проекта)");
});

test("bindTabs: «Удалить вариант» убирает ВЫБРАННЫЙ; удаление первого двигает второй в плоские поля", () => {
  const room = { id: "tabs3", standard: "IT", collection: "Arke", moreVariants: [{ standard: "DE", collection: "Eikon Evo" }] };
  const dom = makeTabsDom(["roomVariantTab0", "roomVariantTab1", "roomVariantAdd", "roomVariantRemove"]);
  const renderProperties = spy(), persistProject = spy();
  U.setActiveIndex("tabs3", 0);                    /* выбрана вкладка 1 */
  U.bindTabs(room, { $: dom.$, renderProperties, persistProject });
  dom.els.roomVariantRemove.click();
  assert.equal(room.standard, "DE", "бывший вариант 2 переехал в плоские поля");
  assert.equal(room.collection, "Eikon Evo");
  assert.ok(!("moreVariants" in room), "доп.вариантов не осталось — поле снято");
  assert.equal(persistProject.calls, 1, "удаление сохранено");
});

test("bindTabs: «Удалить вариант» убирает именно активную вкладку (вариант 2)", () => {
  const room = { id: "tabs4", standard: "IT", moreVariants: [{ standard: "DE" }, { standard: "FR" }] };
  const dom = makeTabsDom(["roomVariantTab0", "roomVariantTab1", "roomVariantTab2", "roomVariantAdd", "roomVariantRemove"]);
  U.setActiveIndex("tabs4", 1);                    /* выбрана вкладка 2 (moreVariants[0]) */
  U.bindTabs(room, { $: dom.$, renderProperties: spy(), persistProject: spy() });
  dom.els.roomVariantRemove.click();
  assert.equal(room.standard, "IT", "вариант 1 (плоские поля) не тронут");
  assert.deepEqual(room.moreVariants, [{ standard: "FR" }], "удалён ровно активный вариант 2, вариант 3 остался");
});

test("bindTabs: при пяти вариантах кнопки «+ вариант» нет — обработчик не навешивается", () => {
  const room = { id: "tabs5", standard: "IT", moreVariants: [{ standard: "DE" }, { standard: "FR" }, { standard: "US" }, { standard: "BOTH" }] };
  assert.equal(V.list(room).length, 5, "предпосылка: пять вариантов");
  const dom = makeTabsDom(["roomVariantTab0", "roomVariantTab1", "roomVariantTab2", "roomVariantTab3", "roomVariantTab4", "roomVariantRemove"]);
  /* roomVariantAdd в dom нет — как в браузере на пяти вариантах; bindTabs не должен падать на $()===null */
  assert.doesNotThrow(() => U.bindTabs(room, { $: dom.$, renderProperties: spy(), persistProject: spy() }));
});
