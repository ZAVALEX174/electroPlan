/* Чистые функции EPLeftPanel (левая панель, Редизайн ч.4):
   - planStatusText — статус секции «Исходный план» словами (без «1:N», решение владельца 29.10);
   - shouldAutoCollapse — решение «свернуть ли секцию автоматически» (один раз на переход);
   - toolForCode — карта «физическая клавиша → инструмент» для горячих клавиш V/W/L/R/E.
   ОДНО место каждого правила (§7.1) — копий в app.js/index.html нет.

   МУТАЦИЯ → КРАСНЫЙ (проверено ниже по пунктам):
   - planStatusText: убрать ветку scaled → «масштаб задан» потеряется;
   - shouldAutoCollapse: снять любое из трёх условий (нет prev / не loaded&&scaled / тот же token) —
     краснеет соответствующий тест;
   - toolForCode: сменить любое соответствие клавиши инструменту — краснеет карта.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const EPLeftPanel = require("../js/leftPanel.js");

test("planStatusText: нет плана → «не загружен»", () => {
  assert.equal(EPLeftPanel.planStatusText({ loaded: false, scaled: false }), "не загружен");
  assert.equal(EPLeftPanel.planStatusText(null), "не загружен");
  // scaled без loaded не бывает, но страхуемся: без плана статус всегда «не загружен»
  assert.equal(EPLeftPanel.planStatusText({ loaded: false, scaled: true }), "не загружен");
});

test("planStatusText: план есть, масштаба нет → «загружен»", () => {
  assert.equal(EPLeftPanel.planStatusText({ loaded: true, scaled: false }), "загружен");
});

test("planStatusText: план и масштаб → «загружен · масштаб задан» (без «1:N»)", () => {
  const s = EPLeftPanel.planStatusText({ loaded: true, scaled: true });
  assert.equal(s, "загружен · масштаб задан");
  assert.ok(!/1:/.test(s), "масштаб «1:N» не показываем (решение владельца 29.10)");
});

test("shouldAutoCollapse: первый замер (нет prev) не сворачивает — уважаем сохранённое состояние", () => {
  assert.equal(EPLeftPanel.shouldAutoCollapse(null, { loaded: true, scaled: true, token: 1 }), false);
});

test("shouldAutoCollapse: переход в «загружен · масштаб задан» сворачивает (один раз)", () => {
  // был план без масштаба → задали масштаб (тот же token)
  assert.equal(EPLeftPanel.shouldAutoCollapse(
    { loaded: true, scaled: false, token: 1 }, { loaded: true, scaled: true, token: 1 }), true);
  // не было плана → сразу загружен+масштаб
  assert.equal(EPLeftPanel.shouldAutoCollapse(
    { loaded: false, scaled: false, token: 0 }, { loaded: true, scaled: true, token: 1 }), true);
});

test("shouldAutoCollapse: уже свёрнут на этом плане — повторно не сворачивает (человек мог раскрыть руками)", () => {
  assert.equal(EPLeftPanel.shouldAutoCollapse(
    { loaded: true, scaled: true, token: 1 }, { loaded: true, scaled: true, token: 1 }), false);
});

test("shouldAutoCollapse: новый план (token сменился) снова взводит автосворачивание", () => {
  assert.equal(EPLeftPanel.shouldAutoCollapse(
    { loaded: true, scaled: true, token: 1 }, { loaded: true, scaled: true, token: 2 }), true);
});

test("shouldAutoCollapse: условие ещё не выполнено (нет масштаба) — не сворачивает", () => {
  assert.equal(EPLeftPanel.shouldAutoCollapse(
    { loaded: true, scaled: false, token: 1 }, { loaded: true, scaled: false, token: 1 }), false);
  assert.equal(EPLeftPanel.shouldAutoCollapse(
    { loaded: false, scaled: false, token: 0 }, { loaded: true, scaled: false, token: 1 }), false);
});

test("toolForCode: клавиши V/W/L/R/E дают верный data-tool", () => {
  assert.equal(EPLeftPanel.toolForCode("KeyV"), "select");
  assert.equal(EPLeftPanel.toolForCode("KeyW"), "wall");
  assert.equal(EPLeftPanel.toolForCode("KeyL"), "roomline");
  assert.equal(EPLeftPanel.toolForCode("KeyR"), "room");
  assert.equal(EPLeftPanel.toolForCode("KeyE"), "vertex");
});

test("toolForCode: чужая клавиша → пустая строка (клавиша не наша)", () => {
  assert.equal(EPLeftPanel.toolForCode("KeyS"), "");
  assert.equal(EPLeftPanel.toolForCode("KeyB"), "");
  assert.equal(EPLeftPanel.toolForCode("KeyF"), "");
  assert.equal(EPLeftPanel.toolForCode("Space"), "");
});

/* Поведенческий стенд attach: <details> с async-toggle мимикрируем узлом, у которого присвоение .open
   (при смене значения) синхронно зовёт слушателей toggle — это СТРОЖЕ браузера (флаг должен сняться
   в том же такте). EPPrefs — спай по ключам. Проверяем: автосворачивание НЕ пишет lpOpenPlan, а ручное
   переключение — пишет. МУТАЦИЯ: верни запись в prefs на программном toggle (убери проверку autoCollapsing)
   — тест «автосворачивание не меняет сохранённое» покраснеет. */
function fakeDetails(open) {
  const listeners = [];
  const el = { _open: open, addEventListener: (t, fn) => { if (t === "toggle") listeners.push(fn); } };
  Object.defineProperty(el, "open", {
    get() { return el._open; },
    set(v) { v = !!v; if (v !== el._open) { el._open = v; listeners.forEach(fn => fn()); } }
  });
  return el;
}
function makeStand() {
  const nodes = { panePlan: fakeDetails(true), paneTools: fakeDetails(true), paneLibrary: fakeDetails(true),
    planStatus: { textContent: "" }, newPostBtn: { addEventListener() {} } };
  const prefs = {};
  const sets = [];
  const EPPrefs = { get: (k, fb) => (Object.prototype.hasOwnProperty.call(prefs, k) ? prefs[k] : fb),
    set: (k, v) => { prefs[k] = v; sets.push([k, v]); } };
  let ps = { loaded: false, scaled: false, token: 0 };
  const api = EPLeftPanel.attach({ $: id => nodes[id], EPPrefs, planState: () => ps });
  return { nodes, prefs, sets, api, setPlan: v => { ps = v; } };
}

test("attach: автосворачивание «Исходного плана» НЕ пишет lpOpenPlan в prefs", () => {
  const s = makeStand();
  s.api.primePlanSection();                      // база: плана нет, секция открыта (pref не трогали)
  s.setPlan({ loaded: true, scaled: false, token: 1 }); s.api.syncPlanSection();   // загрузили план
  s.setPlan({ loaded: true, scaled: true, token: 1 }); s.api.syncPlanSection();    // задали масштаб → авто-сворот
  assert.equal(s.nodes.panePlan.open, false, "секция свернулась программно");
  assert.ok(!s.sets.some(([k]) => k === "lpOpenPlan"), "в prefs lpOpenPlan НЕ записан: " + JSON.stringify(s.sets));
  assert.equal(Object.prototype.hasOwnProperty.call(s.prefs, "lpOpenPlan"), false, "сохранённого состояния секции плана нет");
});

test("attach: ручное переключение секции плана пишется в prefs (привычка человека)", () => {
  const s = makeStand();
  s.api.primePlanSection();
  s.nodes.panePlan.open = false;   // человек свернул руками → toggle без флага autoCollapsing
  assert.deepEqual(s.sets.filter(([k]) => k === "lpOpenPlan"), [["lpOpenPlan", false]], "ручное сворачивание записано");
  s.nodes.panePlan.open = true;    // человек раскрыл руками
  assert.deepEqual(s.sets.filter(([k]) => k === "lpOpenPlan").slice(-1), [["lpOpenPlan", true]], "ручное раскрытие записано");
});
