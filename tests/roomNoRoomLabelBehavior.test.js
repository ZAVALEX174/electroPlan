/* ПОВЕДЕНЧЕСКИЙ регресс метки «вне помещений» — исполняет syncNoRoomClass из js/app.js.

   ЗАЧЕМ ЭТОТ ТЕСТ, ЕСЛИ ЕСТЬ roomNoRoomLabelWiring.test.js. Тот сверяет ТЕКСТ app.js (вызовы на
   месте, критерий содержит state.rooms.length) — но не исполняет функцию. Второй состязательный
   проход показал: две мутации, полностью убивающие механизм, оставляли все 753 теста зелёными:
     - инверсия критерия (roomId==null → !=null): «!» загорался на объектах В комнате, а сироты
       оставались без метки;
     - слом селектора (data-id → data-kind): узел не находился никогда, вся правка мертва.
   Текстовый тест их не видит — нужен НАСТОЯЩИЙ прогон syncNoRoomClass на живом DOM-шиме.

   ИДЕЯ (как в roomResolveRule.test.js). app.js — монолит-оркестратор (DOM, state), в node не
   грузится. Но syncNoRoomClass — тонкая обёртка: ищет узел в canvas и переключает класс по
   общему критерию EPRoomAssign.isOutsideRooms. Вырезаем её ИСХОДНЫЙ ТЕКСТ из app.js и исполняем
   в vm-контексте, куда кладём ровно те имена, которыми она пользуется: canvas (DOM-шим), state
   и настоящий EPRoomAssign. Критерий берётся из реального модуля — значит инверсия/игнор числа
   комнат, внесённые в roomAssign.js, покраснеют здесь же.

   ЧЕСТНОСТЬ ШИМА. querySelector честно РАЗБИРАЕТ селектор: вытаскивает имя data-атрибута и
   сравнивает узлы именно по нему (data-id → dataset.id). Подмени app.js селектор на data-kind —
   шим полезет в dataset.kind, там id объекта не лежит, узел не найдётся, метка не встанет →
   красный. classList — настоящий Set с browser-семантикой toggle(force): add при истине, remove
   при лжи. Замени toggle на безусловный add — снятие метки перестанет работать → красный.
   Шим не подыгрывает: он проверяет ровно то, что ломают целевые мутации. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPRoomAssign = require("../js/roomAssign.js");

/* Узел плана — как в браузере: класс plan-icon + dataset.{id,kind}. classList общего стенда несёт
   browser-семантику toggle(cls, force) (force не задан — переключить; истина — add; ложь — remove);
   именно на force держится СНЯТИЕ метки у объекта, вернувшегося в комнату. */
function makeNode(id, kind, classes) {
  return stand.makeElement({ dataset: { id: id, kind: kind }, classes: ["plan-icon"].concat(classes || []) });
}

/* Живая syncNoRoomClass на общем стенде: canvas-шим (querySelector ЧЕСТНО разбирает
   `.cls[data-attr="v"]` — подмена data-id→data-kind уводит поиск в поле без id, узел не найдётся),
   state и настоящий EPRoomAssign (мутации критерия покраснеют здесь). */
function buildSync(canvas, state) {
  return stand.run("syncNoRoomClass", { canvas: canvas, state: state, EPRoomAssign: EPRoomAssign });
}
const makeCanvas = stand.makeCanvas;

/* --- 1. Сирота при наличии комнат → метка поставлена (ловит инверсию критерия) --------------- */
test("объект без комнаты, а комнаты в проекте есть → класс no-room поставлен", () => {
  const node = makeNode("dev-1", "device");
  const state = { rooms: [{ id: "R1" }] };
  const sync = buildSync(makeCanvas([node]), state);
  sync({ id: "dev-1", roomId: null });
  assert.ok(node.classList.contains("no-room"),
    "сирота при наличии комнат обязан получить метку — иначе критерий инвертирован");
});

/* --- 2. Объект вернулся в комнату → метка СНЯТА (именно снята — исходный дефект) -------------- */
test("объект в комнате → класс no-room снят (не «не поставлен», а снят)", () => {
  const node = makeNode("dev-1", "device", ["no-room"]); // раньше был сиротой — метка на нём
  const state = { rooms: [{ id: "R1" }] };
  const sync = buildSync(makeCanvas([node]), state);
  sync({ id: "dev-1", roomId: "R1" });
  assert.ok(!node.classList.contains("no-room"),
    "объект, вернувшийся в комнату, обязан потерять метку — toggle(force=false), а не безусловный add");
});

/* --- 3. Комнат в проекте нет → метки нет ни у кого (иначе «!» горел бы на пустом плане) ------- */
test("комнат в проекте нет → класс no-room не ставится даже сироте", () => {
  const node = makeNode("dev-1", "device");
  const state = { rooms: [] };
  const sync = buildSync(makeCanvas([node]), state);
  sync({ id: "dev-1", roomId: null });
  assert.ok(!node.classList.contains("no-room"),
    "без комнат метка «вне помещений» — шум; критерий обязан учитывать число комнат");
});

/* --- 4. Узел ещё не отрисован → тихий no-op без исключения ------------------------------------ */
test("узла в canvas нет → тихий no-op, без исключения", () => {
  const state = { rooms: [{ id: "R1" }] };
  const sync = buildSync(makeCanvas([]), state); // ни одного узла
  assert.doesNotThrow(() => sync({ id: "dev-1", roomId: null }),
    "объект без отрисованной иконки не должен ронять syncNoRoomClass");
});

/* --- 5. Селектор находит ИМЕННО свой узел (ловит слом data-id → data-kind) -------------------- */
test("селектор трогает только свой узел, соседей с другими data-id не задевает", () => {
  const target = makeNode("dev-2", "device");
  const others = [makeNode("dev-1", "device"), makeNode("dev-3", "post"), makeNode("dev-4", "device")];
  const nodes = [others[0], target, others[1], others[2]];
  const state = { rooms: [{ id: "R1" }] };
  const sync = buildSync(makeCanvas(nodes), state);
  sync({ id: "dev-2", roomId: null });
  assert.ok(target.classList.contains("no-room"),
    "метка обязана лечь на узел с совпадающим data-id");
  for (const n of others) {
    assert.ok(!n.classList.contains("no-room"),
      "соседний узел (другой data-id) не должен получить метку — иначе селектор не адресует точечно");
  }
});
