/* ПОВЕДЕНЧЕСКИЙ тест вкладок вариантов отделки в панели свойств комнаты (К8а часть 4): НАСТОЯЩИЙ
   renderProperties из js/app.js, исполненный в vm общим стендом, строит поля отделки из ВЫБРАННОГО
   варианта и пишет правку именно в него. Главный денежный риск блока — «вкладка пишет не в тот
   вариант»: селектор показал бы один вариант, а change записал бы в другой. Проверяем на настоящем
   каталоге VIMAR (коллекции берёт продакшн frameCollectionList), EPRoom/EPRoomVariants/EPRoomVariantsUi
   настоящие.

   МУТАЦИОННАЯ ТАБЛИЦА (в отчёте):
     renderProperties: roomVariantIdx=0 (игнорит активную вкладку)   → красит §2 (селектор показывает вариант 1, а не 2);
     onchange: writeField(r,0,…) вместо roomVariantIdx               → красит §3 (правка ушла в плоские поля, вариант 2 пуст);
     onchange: прямая запись r.collection (без EPRoomVariantsUi)      → красит §3 (вариант 2 не изменился);
     tabsHtml/removeBtnHtml не вставлены в разметку                   → красит §1 (нет вкладок/кнопки удаления).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPRoom = require("../js/room.js");
const EPCatalog = require("../js/catalog.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPRoomVariants = require("../js/roomVariants.js");
const EPRoomVariantsUi = require("../js/roomVariantsUi.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const spy = () => { const f = () => { f.calls++; }; f.calls = 0; return f; };

/* Исполнить настоящий renderProperties для выделенной комнаты room; активную вкладку задаём ДО рендера
   через EPRoomVariantsUi.setActiveIndex (состояние интерфейса, как клик по вкладке). Возвращаем
   {props, dom, ctx} для проверки разметки и обработчиков. */
function renderRoom(room, activeIdx) {
  EPRoomVariantsUi.setActiveIndex(room.id, activeIdx || 0);
  const state = { selected: { kind: "room", id: room.id }, rooms: [room], posts: [], products: PRODUCTS, pxPerMeter: 0 };
  const dom = stand.makeDom({ selects: ["roomStandardSelect", "roomCollectionSelect", "roomSchemeSelect", "room_frameMaterialSelect", "room_frameShapeSelect", "room_frameColorSelect"] });
  const props = stand.makeElement();
  const ctx = {
    state, props, $: dom.$, esc: String,
    byKind: kind => state.products.filter(x => x.kind === kind && x.active),
    flushRoomDraft: spy(), updateSelectionCount: () => {}, renderTemplates: () => {},
    findSelectedEntity: (k, id) => state.rooms.find(r => r.id === id),
    applySelectionClasses: spy(), getObjectsInRoom: () => [], roomAutoAreaText: () => "",
    polygonAreaPx: () => 0, lightingScheme: () => "classic",
    EPLightingGroups, EPRoom, EPCatalog, EPRoomWalls: require("../js/roomWalls.js"),
    EPRoomVariants, EPRoomVariantsUi,
    EPPrefs: { get: (k, fb) => fb, set: () => {} },   /* вид «Списком» — тест про варианты, не про переключатель вида */
    setTool: spy(), persistProject: spy(), renderSummary: spy(), renderAll: spy(), mountedRoomId: null
  };
  stand.run(["frameCollectionList", "frameFacingList", "frameStandardList", "frameFacingView", "renderProperties"], ctx)();
  return { props, dom, ctx };
}

function collectionSelected(props) {
  const m = props.innerHTML.match(/<select id="roomCollectionSelect">([\s\S]*?)<\/select>/);
  assert.ok(m, "селектор коллекции есть");
  const sel = [...m[1].matchAll(/<option value="([^"]*)" selected>/g)].map(o => o[1]);
  return sel;
}

test("§1 панель комнаты без доп.вариантов: вкладка «Вариант 1», «+ вариант», кнопки удаления НЕТ", () => {
  const { props } = renderRoom({ id: "w1", name: "Кухня", polygon: null, collection: "Arke" }, 0);
  assert.match(props.innerHTML, /id="roomVariantTab0"[^>]*>Вариант 1</, "вкладка «Вариант 1» есть");
  assert.match(props.innerHTML, /id="roomVariantAdd"/, "кнопка «+ вариант» есть");
  assert.doesNotMatch(props.innerHTML, /id="roomVariantRemove"/, "при одном варианте кнопки «Удалить вариант» нет");
  assert.deepEqual(collectionSelected(props), ["Arke"], "селектор показывает серию варианта 1");
});

test("§1 две вкладки и кнопка удаления при доп.варианте", () => {
  const room = { id: "w2", name: "Кухня", polygon: null, collection: "Arke", moreVariants: [{ collection: "Eikon Evo" }] };
  const { props } = renderRoom(room, 0);
  assert.match(props.innerHTML, /id="roomVariantTab0"[^>]*>Вариант 1</);
  assert.match(props.innerHTML, /id="roomVariantTab1"[^>]*>Вариант 2</);
  assert.match(props.innerHTML, /id="roomVariantRemove"/, "при двух вариантах кнопка «Удалить вариант» есть");
});

test("§2 селектор читает ВЫБРАННУЮ вкладку: на вкладке 2 показана серия варианта 2", () => {
  const room = { id: "w3", name: "Кухня", polygon: null, collection: "Arke", moreVariants: [{ collection: "Eikon Evo" }] };
  assert.deepEqual(collectionSelected(renderRoom(room, 0).props), ["Arke"], "вкладка 1 → серия варианта 1");
  assert.deepEqual(collectionSelected(renderRoom(room, 1).props), ["Eikon Evo"], "вкладка 2 → серия варианта 2 (а не первого)");
});

test("§3 change на вкладке 2 пишет в вариант 2, плоские поля (вариант 1) не тронуты", () => {
  const room = { id: "w4", name: "Кухня", polygon: null, collection: "Arke", moreVariants: [{ collection: "Eikon Evo" }] };
  const { dom, ctx } = renderRoom(room, 1);
  /* перехват renderProperties (как в roomCollectionPropertiesWiring): объявление легло свойством ctx */
  const real = ctx.renderProperties; const rerender = spy();
  ctx.renderProperties = function () { rerender(); return real.apply(this, arguments); };
  dom.els.roomCollectionSelect.onchange({ target: { value: "Plana" } });
  assert.equal(room.collection, "Arke", "⚠️ плоские поля (вариант 1) НЕ изменились — правка не ушла в первый вариант");
  assert.deepEqual(room.moreVariants, [{ collection: "Plana" }], "правка записана в вариант 2 (ВЫБРАННАЯ вкладка)");
  assert.equal(rerender.calls, 1, "панель перерисована");
  assert.equal(ctx.persistProject.calls, 1, "проект сохранён");
  assert.equal(ctx.renderSummary.calls, 0, "отделка не денежная — смета не пересчитывается");
  assert.equal(ctx.renderAll.calls, 0, "холст не трогается");
});

test("§3 change на вкладке 1 пишет в плоские поля, вариант 2 не тронут", () => {
  const room = { id: "w5", name: "Кухня", polygon: null, collection: "Arke", moreVariants: [{ collection: "Eikon Evo" }] };
  const { dom } = renderRoom(room, 0);
  dom.els.roomCollectionSelect.onchange({ target: { value: "Plana" } });
  assert.equal(room.collection, "Plana", "вариант 1 (плоские поля) обновлён");
  assert.deepEqual(room.moreVariants, [{ collection: "Eikon Evo" }], "вариант 2 не тронут");
});
