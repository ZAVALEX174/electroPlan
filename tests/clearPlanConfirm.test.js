/* Поведенческий тест подтверждения сброса подложки (решение владельца 09.09): исполняем НАСТОЯЩИЙ
   текст askClearPlan/confirmClearPlan/showClearPlanConfirm/updatePlanUi из app.js в vm-стенде с
   НАСТОЯЩИМ EPConfirmRepeat. clearPlan необратим (undo нет, снимок затирается сразу), поэтому
   проверяем контракт двух органов управления: нажатие на саму команду не удаляет план НИКОГДА
   (сколько бы их ни пришло и с какими таймингами), удаляет только вторая кнопка, смена подложки
   между нажатиями даёт cancel, а взвод снимается по таймеру и при исчезновении плана. Мутационная
   опора — по строке на каждый эффект. */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPConfirmRepeat = require("../js/confirmRepeat.js"); // НАСТОЯЩИЙ механизм подтверждения

/* Функции app.js замыкаются на модульные let/const (_clearPlanArmed, CLEAR_PLAN_CONFIRM_MS) — их
   объявления вне вырезаемых тел, поэтому кладём как свойства vm-контекста. Date/setTimeout —
   управляемые шимы, чтобы прогонять точные тайминги и таймер автоснятия без реальных часов.
   clearPlan — спай: его вызов есть контракт, а само удаление здесь не проверяем (оно покрыто
   clearPlanWiring). Возвращаем через ctx: все вырезанные function-декларации становятся
   свойствами контекста и сохраняют замыкание на const-стрелку clearPlanSubject. */
function wire(state, overrides) {
  const dom = stand.makeDom();
  const clock = { now: 0 };
  const timers = [];
  const calls = { clearPlan: 0, toast: [] };
  const ctx = Object.assign({
    state,
    $: dom.$,
    EPConfirmRepeat,
    Date: { now: () => clock.now },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    CLEAR_PLAN_CONFIRM_MS: 12000,
    _clearPlanArmed: null,
    _clearPlanHideTimer: null,
    JSON,
    toast: t => { calls.toast.push(t); },
    clearPlan: () => { calls.clearPlan++; }
  }, overrides);
  /* clearPlanSubject НЕ перечисляем: срез showClearPlanConfirm тянется до следующей function-
     декларации, а const clearPlanSubject лежит между ними — он уже попадает в этот срез. */
  stand.runNamed(
    ["showClearPlanConfirm", "askClearPlan", "confirmClearPlan", "updatePlanUi"],
    ctx
  );
  return { dom, ctx, clock, timers, calls };
}

test("поток нажатий по «Убрать план» не удаляет план НИКОГДА — при любых таймингах", () => {
  const state = { planLoaded: true, planToken: 1, planLabel: "a.png" };
  const w = wire(state);
  /* Нетерпеливые клики и автоповтор: интервалы от дребезга (4 мс) до попадания «в окно» (800+ мс). */
  [0, 4, 8, 30, 500, 800, 1600, 5000, 11000, 20000].forEach(t => {
    w.clock.now = t;
    w.ctx.askClearPlan();
    /* Даже если между арм-нажатиями кто-то жмёт подтверждение в тот же миг (elapsed<ARM_MS) —
       это «wait», а не удаление: поток до подтверждения не докликивается. */
    w.ctx.confirmClearPlan();
  });
  assert.equal(w.calls.clearPlan, 0, "clearPlan не вызван ни разу — исходная команда не удаляет");
  assert.equal(w.dom.$("clearPlanConfirmBtn").hidden, false, "вопрос показан второй кнопкой");
  assert.equal(state.planLoaded, true, "план на месте");
});

test("вторая кнопка удаляет план: осознанный второй жест после появления кнопки", () => {
  const state = { planLoaded: true, planToken: 1, planLabel: "a.png" };
  const w = wire(state);
  w.clock.now = 1000;
  w.ctx.askClearPlan();
  assert.equal(w.calls.clearPlan, 0, "взвод ничего не удалил");
  assert.equal(w.dom.$("clearPlanConfirmBtn").hidden, false, "кнопка подтверждения показана");
  w.clock.now = 1400; // прошло 400 мс — больше ARM_MS(250), меньше окна
  w.ctx.confirmClearPlan();
  assert.equal(w.calls.clearPlan, 1, "подтверждение вызвало clearPlan ровно один раз");
  assert.equal(w.dom.$("clearPlanConfirmBtn").hidden, true, "кнопка подтверждения спрятана после удаления");
});

test("подтверждение сразу с появлением кнопки (<ARM_MS) — это промах по соседней команде, не удаление", () => {
  const state = { planLoaded: true, planToken: 1, planLabel: "a.png" };
  const w = wire(state);
  w.clock.now = 1000;
  w.ctx.askClearPlan();
  w.clock.now = 1100; // 100 мс < ARM_MS(250)
  w.ctx.confirmClearPlan();
  assert.equal(w.calls.clearPlan, 0, "мгновенное нажатие не удаляет — action wait");
  assert.equal(w.dom.$("clearPlanConfirmBtn").hidden, false, "вопрос остаётся на экране");
});

test("сменился planToken между вопросом и подтверждением → cancel, план остаётся", () => {
  const state = { planLoaded: true, planToken: 1, planLabel: "a.png" };
  const w = wire(state);
  w.clock.now = 1000;
  w.ctx.askClearPlan();
  state.planToken = 2; // загрузили другой чертёж, пока висел вопрос
  w.clock.now = 1400;
  w.ctx.confirmClearPlan();
  assert.equal(w.calls.clearPlan, 0, "подложка другая — подтверждение не удаляет");
  assert.equal(w.dom.$("clearPlanConfirmBtn").hidden, true, "кнопка снята");
  assert.match(w.calls.toast.at(-1), /сменилась/, "человеку сказано, что подложка сменилась");
});

test("сменился planLabel между вопросом и подтверждением → cancel, план остаётся", () => {
  const state = { planLoaded: true, planToken: 1, planLabel: "a.png" };
  const w = wire(state);
  w.clock.now = 1000;
  w.ctx.askClearPlan();
  state.planLabel = "b.png"; // тот же токен, но другой файл
  w.clock.now = 1400;
  w.ctx.confirmClearPlan();
  assert.equal(w.calls.clearPlan, 0, "имя подложки другое — подтверждение не удаляет");
});

test("таймер автоснятия гасит взвод и прячет кнопку", () => {
  const state = { planLoaded: true, planToken: 1, planLabel: "a.png" };
  const w = wire(state);
  w.clock.now = 1000;
  w.ctx.askClearPlan();
  assert.equal(w.timers.length, 1, "поставлен один таймер автоснятия");
  assert.equal(w.timers[0].ms, 12200, "окно + запас (maxMs+200)");
  w.timers[0].fn(); // сработал таймер
  assert.equal(w.ctx._clearPlanArmed, null, "взвод снят по таймеру");
  assert.equal(w.dom.$("clearPlanConfirmBtn").hidden, true, "кнопка спрятана по таймеру");
});

test("updatePlanUi при planLoaded=false прячет и вторую кнопку — она не висит одна", () => {
  const state = { planLoaded: false };
  const w = wire(state);
  w.dom.$("clearPlanConfirmBtn").hidden = false; // как будто вопрос висел
  w.ctx.updatePlanUi();
  assert.equal(w.dom.$("clearPlanConfirmBtn").hidden, true, "нет плана — вторая кнопка спрятана");
  assert.equal(w.dom.$("clearPlanBtn").hidden, true, "и сама «Убрать план» спрятана");
});

test("updatePlanUi при planLoaded=true НЕ показывает вопрос сам собой (кнопка ждёт взвода)", () => {
  const state = { planLoaded: true };
  const w = wire(state);
  w.dom.$("clearPlanConfirmBtn").hidden = true;
  w.ctx.updatePlanUi();
  assert.equal(w.dom.$("clearPlanConfirmBtn").hidden, true, "с планом кнопка подтверждения по-прежнему скрыта до вопроса");
});
