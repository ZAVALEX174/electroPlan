/* ПОВЕДЕНЧЕСКИЙ регресс E13 (находка 5): СОДЕРЖИМОЕ builderSignature не сторожит никто. Раунд 4
   сделал подпись настоящей ради open-19 (МОМЕНТ снятия снимка — после renderBuilder), но ЧТО
   входит в подпись, не проверял ни один тест. Комментарий над функцией: «ТИП СТЕНЫ В ПОДПИСИ
   ОБЯЗАТЕЛЕН: без него закрытие по Esc считало бы пост нетронутым и молча выбрасывало бы правку».
   Здесь мы держим ровно это: смена типа стены (а также имени поста, накладки, состава слотов)
   делает подпись отличной от снимка — то есть builderDirty() становится true.

   ЗАЧЕМ ПОВЕДЕНЧЕСКИ И БЕЗ КОПИИ. builderSignature замыкается на настоящий builderWallType
   (черновик типа стены окна) и на чистую EPBuilderSlots.signature. Рукописная копия подписи в
   этом проекте уже дважды давала ложно-зелёный тест, поэтому берём НАСТОЯЩИЙ текст обеих функций
   из app.js (constSource/functionSource) и исполняем в vm — как это уже делает
   openPostBuilderCollectionWiring. builderDirty живёт top-level const-стрелкой сразу за
   builderSignature, поэтому functionSource("builderSignature") прихватывает её текст в тот же
   лексический блок — получаем настоящий builderDirty без второй копии правила.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено, см. отчёт):
     убрать builderWallType() из подписи → красит sig-wall (смена типа стены больше не «грязнит»
       пост: builderDirty остаётся false, Esc молча выбросил бы правку типа стены).
     убрать $("postName").value из подписи → красит sig-name.
     убрать String($("postFrameSelect").value||"") → красит sig-frame.
     убрать EPBuilderSlots.signature(state.builder.slots) → красит sig-slots.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPBuilderSlots = require("../js/builderSlots.js");

/* НАСТОЯЩИЕ builderSignature и builderDirty из app.js, одной программой в общем лексическом блоке.
   functionSource("builderSignature") доводит текст до следующего `\nfunction ` (retargetBuilderSlot),
   поэтому в него уже входит промежуточная строка `const builderDirty=…;` — ту и возвращаем. Так обе
   функции настоящие и делят один контекст (state, $, builderWallType, EPBuilderSlots). */
function cutSignature(ctx) {
  const code =
    stand.constSource("builderWallType") + "\n" +
    stand.functionSource("builderSignature") + "\n" +
    ";({sig:builderSignature,dirty:builderDirty});";
  vm.createContext(ctx);
  return vm.runInContext(code, ctx);
}

/* Стенд: DOM с именем поста и накладкой, черновик builder со слотами и типом стены. snapshot ставим
   текущей подписью — с этого момента builderDirty честно сравнивает «сейчас» со «снимком». */
function makeStand({ name = "Пост", frame = "202011", wallType = "solid", slots = [], projectWall = "solid" } = {}) {
  const dom = stand.makeDom();
  dom.$("postName").value = name;
  dom.$("postFrameSelect").value = frame;
  const state = { builder: { slots, wallType, snapshot: null } };
  const ctx = { state, $: dom.$, EPBuilderSlots, EP_DATA: { settings: { wallType: projectWall } } };
  const { sig, dirty } = cutSignature(ctx);
  state.builder.snapshot = sig(); // снимок «как было»
  return { dom, state, sig, dirty };
}

test("E13-sig-wall: смена ТИПА СТЕНЫ грязнит подпись (builderDirty → true)", () => {
  /* Черновик типа стены окна — часть подписи по прямому требованию комментария. Мутация «убрать
     builderWallType() из подписи» оставила бы подпись равной снимку после смены стены → Esc счёл
     бы пост нетронутым и выбросил бы правку молча. */
  const { state, dirty } = makeStand({ wallType: "solid", slots: [EPBuilderSlots.slot(200040, "")] });
  assert.equal(dirty(), false, "предпосылка: до правки пост нетронут — подпись равна снимку");
  state.builder.wallType = "hollow"; // человек сменил тип стены в окне
  assert.equal(dirty(), true,
    "смена типа стены обязана сделать подпись «грязной» — иначе Esc молча выбросит правку типа стены");
});

test("E13-sig-name: смена ИМЕНИ поста грязнит подпись", () => {
  const { dom, dirty } = makeStand({ name: "Пост", slots: [EPBuilderSlots.slot(200040, "")] });
  assert.equal(dirty(), false, "предпосылка: пост нетронут");
  dom.$("postName").value = "Кухонный пост";
  assert.equal(dirty(), true, "имя поста входит в подпись — его правка обязана грязнить пост");
});

test("E13-sig-frame: смена НАКЛАДКИ грязнит подпись", () => {
  const { dom, dirty } = makeStand({ frame: "202011", slots: [EPBuilderSlots.slot(200040, "")] });
  assert.equal(dirty(), false, "предпосылка: пост нетронут");
  dom.$("postFrameSelect").value = "999999";
  assert.equal(dirty(), true, "выбранная накладка входит в подпись — её смена обязана грязнить пост");
});

test("E13-sig-slots: смена СОСТАВА СЛОТОВ (и группы света) грязнит подпись", () => {
  /* Состав кодирует чистая EPBuilderSlots.signature (id + группа по позиции). И добавление
     механизма, и смена группы света на клавише обязаны менять подпись. */
  const { state, dirty } = makeStand({ slots: [EPBuilderSlots.slot(200040, "")] });
  assert.equal(dirty(), false, "предпосылка: пост нетронут");
  state.builder.slots = [EPBuilderSlots.slot(200040, "Кухня")]; // человек задал группу света
  assert.equal(dirty(), true, "группа света слота входит в подпись — её задание обязано грязнить пост");
});
