/* ПОВЕДЕНЧЕСКИЙ регресс E13 (находка 2): ветка ЗАКРЫТИЯ конструктора не покрыта ничем.
   grep requestClosePostBuilder|closePostBuilder tests/ находил их только в комментариях; сам
   EPConfirmRepeat покрыт как чистый модуль (confirmRepeat.test.js), но СВЯЗКА с конструктором —
   нет. Тот же тип разрыва, что был у roomCarry и builderSignature: механизм настоящий, а обёртка
   в app.js молча меняла смысл. Здесь держим саму обёртку requestClosePostBuilder ПОВЕДЕНЧЕСКИ.

   ЗАЧЕМ ПОВЕДЕНЧЕСКИ И БЕЗ КОПИИ. app.js — монолит-оркестратор, в node не грузится; связки дают
   почти все дефекты (§7.1 HANDOFF). Вырезаем НАСТОЯЩИЙ текст requestClosePostBuilder общим стендом
   (tests/helpers/appStand.js) и исполняем в vm. НЕ заглушаем ровно то, что проверяем:
   EPConfirmRepeat — настоящий (js/confirmRepeat.js), builderDirty/builderSignature/closePostBuilder
   и константа ESC_CONFIRM_MS — настоящие из app.js. Время управляем через локальный для vm Date
   (Date.now() зовёт requestClosePostBuilder и передаёт его аргументом в чистый press) — глобальный
   Date не трогаем, модуль сам принимает now аргументом.

   ЧТО ЗАФИКСИРОВАНО (поведенчески, не текстом):
   (а) при НЕзагрязнённом конструкторе Esc закрывает окно СРАЗУ (лишний вопрос на выходе из
       просмотра раздражал бы);
   (б) при загрязнённом — первое нажатие НЕ закрывает, а взводит подтверждение; второе в пределах
       окна закрывает; взвод запоминается в state.builder.escArmed;
   (в) значение ESC_CONFIRM_MS участвует в решении: нажатие ЗА пределами окна (elapsed > 4000)
       НЕ подтверждает, а перевзводит вопрос.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено, см. отчёт):
     if(!builderDirty()) → if(true) — красит close-dirty-arm (грязный пост закрылся бы сразу,
       несохранённая работа пропала бы молча: первое нажатие вернуло бы true и сняло «open»).
     press(state.builder.escArmed,…) → press(null,…) — красит close-dirty-confirm (взвод не
       запоминается: второе нажатие снова взводит вопрос, Esc не закроет окно НИКОГДА).
     ESC_CONFIRM_MS=4000 → 40000 — красит close-window-expired (нажатие через 5 c при окне 4 c
       обязано перевзвести вопрос, а не подтвердить; при окне 40 c оно закрыло бы окно).
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPBuilderSlots = require("../js/builderSlots.js");
const EPConfirmRepeat = require("../js/confirmRepeat.js"); // НАСТОЯЩИЙ механизм подтверждения

/* НАСТОЯЩИЕ функции app.js одной программой в общем лексическом блоке. Для каждого имени берём
   functionSource (есть `function имя(`) либо constSource (const-стрелка/константа). builderDirty
   приезжает в текст builderSignature: functionSource доводит его до следующего `\nfunction`
   (retargetBuilderSlot), а между ними лежит `const builderDirty=…;`. Так все функции настоящие и
   делят один контекст (state, $, builderWallType, EPBuilderSlots, EPConfirmRepeat, ESC_CONFIRM_MS,
   closePostBuilder, toast, Date). Возвращаем и request, и sig — sig нужен, чтобы снять ЧЕСТНЫЙ
   снимок «как было» настоящей подписью, а не рукописной константой. */
function cutClose(ctx) {
  /* ESC_CONFIRM_MS отдельно НЕ режем: `const ESC_CONFIRM_MS=4000;` лежит между closePostBuilder и
     requestClosePostBuilder, и functionSource(closePostBuilder) прихватывает его в свой текст (как
     builderDirty приезжает в builderSignature). Так константа настоящая, а не продублирована. */
  const names = ["builderWallType", "builderSignature", "closePostBuilder", "requestClosePostBuilder"];
  const code = names.map(name => {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b(?:async\\s+)?function\\s+" + safe + "\\s*\\(").test(stand.SRC)
      ? stand.functionSource(name)
      : stand.constSource(name);
  }).join("\n") + "\n;({request:requestClosePostBuilder, sig:builderSignature, dirty:builderDirty});";
  vm.createContext(ctx);
  return vm.runInContext(code, ctx);
}

/* Стенд закрытия: DOM с постом (имя/накладка), черновик builder со слотами и типом стены, часы clock
   под управлением теста. snapshot ставим НАСТОЯЩЕЙ подписью — с этого момента builderDirty честно
   сравнивает «сейчас» со «снимком»: не тронешь ничего — чисто, тронешь поле — грязно. toast копит
   сообщения (для наблюдаемости, ассертами не пользуемся). */
function makeStand({ name = "Пост", frame = "202011", wallType = "solid", slots = [], projectWall = "solid" } = {}) {
  const dom = stand.makeDom();
  dom.$("postName").value = name;
  dom.$("postFrameSelect").value = frame;
  dom.$("postModal").classList.add("open"); // окно открыто — закрытие обязано снять «open»
  const state = { builder: { slots, wallType, snapshot: null, escArmed: null } };
  const toasts = [];
  let clock = 0;
  const ctx = {
    state, $: dom.$, EPBuilderSlots, EPConfirmRepeat,
    EP_DATA: { settings: { wallType: projectWall } },
    toast: m => toasts.push(m),
    Date: { now: () => clock },
    Set // closePostBuilder пересоздаёт builder с new Set()
  };
  const { request, sig } = cutClose(ctx);
  state.builder.snapshot = sig(); // снимок «как было» — настоящей подписью
  return {
    dom, state, request, toasts,
    at(t) { clock = t; return this; },          // задать «сейчас» перед нажатием
    isOpen() { return dom.$("postModal").classList.contains("open"); }
  };
}

test("E13-close-clean: незагрязнённый конструктор закрывается СРАЗУ, без подтверждения", () => {
  /* Нетронутый пост: builderDirty() === false → первое же нажатие закрывает окно, лишнего вопроса
     на выходе из просмотра нет. */
  const s = makeStand({ slots: [EPBuilderSlots.slot(200040, "")] });
  assert.equal(s.state.builder.snapshot != null, true, "предпосылка: снимок снят — есть с чем сравнивать");
  const closed = s.at(1000).request();
  assert.equal(closed, true, "нетронутый конструктор обязан закрыться первым же нажатием");
  assert.equal(s.isOpen(), false, "окно закрыто: класс «open» снят с модалки");
});

test("E13-close-dirty-arm: загрязнённый конструктор первым нажатием НЕ закрывается, а взводит подтверждение", () => {
  /* Человек правил пост и жмёт Esc: первое нажатие обязано ВЗВЕСТИ вопрос, а не закрыть окно молча.
     Мутация `if(!builderDirty())` → `if(true)` закрыла бы грязный пост сразу (return true, «open»
     снят) — несохранённая работа пропала бы. Здесь она краснеет. */
  const s = makeStand({ name: "Пост", slots: [EPBuilderSlots.slot(200040, "")] });
  s.dom.$("postName").value = "Кухонный пост"; // правка после снимка → builderDirty() === true
  const closed = s.at(1000).request();
  assert.equal(closed, false, "первое нажатие по ГРЯЗНОМУ посту не закрывает окно");
  assert.equal(s.isOpen(), true, "окно осталось открытым — работа не потеряна");
  assert.ok(s.state.builder.escArmed && Number.isFinite(s.state.builder.escArmed.at),
    "взвод подтверждения запомнен в state.builder.escArmed — иначе второе нажатие не с чем сравнивать");
});

test("E13-close-dirty-confirm: второе нажатие в пределах окна закрывает; взвод берётся из state.builder.escArmed", () => {
  /* Взвели (t=1000) → подтвердили (t=2000: тишина 1000 мс > minMs 800, окно 1000 мс < 4000).
     Мутация `press(state.builder.escArmed,…)` → `press(null,…)` теряет взвод: второе нажатие снова
     получает armed=null → action «arm», окно НЕ закрывается никогда. Здесь она краснеет. */
  const s = makeStand({ name: "Пост", slots: [EPBuilderSlots.slot(200040, "")] });
  s.dom.$("postName").value = "Кухонный пост"; // грязно
  assert.equal(s.at(1000).request(), false, "первое нажатие — взвод, не закрытие");
  assert.ok(s.state.builder.escArmed, "предпосылка: взвод записан после первого нажатия");
  const closed = s.at(2000).request();
  assert.equal(closed, true, "второе нажатие в пределах окна закрывает без сохранения");
  assert.equal(s.isOpen(), false, "окно закрыто вторым нажатием — взвод из state.builder.escArmed сработал");
});

test("E13-close-window-expired: нажатие ЗА пределами ESC_CONFIRM_MS не подтверждает, а перевзводит вопрос", () => {
  /* Взвели (t=1000) → нажали снова через 5 с (t=6000). Окно ESC_CONFIRM_MS = 4000, elapsed = 5000 >
     4000 → «ещё раз» через это время уже НЕ то же действие: press возвращает action «arm»
     (перевзвод), окно остаётся открытым, взвод пересчитан на t=6000. Мутация ESC_CONFIRM_MS=4000 →
     40000 сделала бы 5000 < 40000 → confirm → окно закрылось бы. Здесь она краснеет. */
  const s = makeStand({ name: "Пост", slots: [EPBuilderSlots.slot(200040, "")] });
  s.dom.$("postName").value = "Кухонный пост"; // грязно
  assert.equal(s.at(1000).request(), false, "первое нажатие — взвод");
  const closed = s.at(6000).request();
  assert.equal(closed, false, "нажатие через 5 c при окне 4 c НЕ закрывает — вопрос уже протух");
  assert.equal(s.isOpen(), true, "окно осталось открытым: истёкшее окно перевзводит, а не подтверждает");
  assert.equal(s.state.builder.escArmed && s.state.builder.escArmed.at, 6000,
    "вопрос перевзведён на момент последнего нажатия (6000) — при окне 40 c здесь было бы закрытие");
});
