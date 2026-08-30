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
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPRoomAssign = require("../js/roomAssign.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Вырезаем исходник функции: от объявления до следующего `\nfunction ` верхнего уровня
   (сосед syncNoRoomClass — updateObjectRoom), между ними валидный JS. */
function functionSource(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start);
  const nextIdx = rest.indexOf("\nfunction ", 1);
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

/* Настоящий classList поверх Set — browser-семантика, включая toggle(cls, force):
   force не задан — переключить; истина — add; ложь — remove. Именно на force держится снятие
   метки у объекта, вернувшегося в комнату. */
function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add: c => set.add(c),
    remove: c => set.delete(c),
    contains: c => set.has(c),
    toggle: (c, force) => {
      if (force === undefined) {
        if (set.has(c)) { set.delete(c); return false; }
        set.add(c); return true;
      }
      if (force) { set.add(c); return true; }
      set.delete(c); return false;
    }
  };
}

/* Узел плана — как в браузере: класс plan-icon + dataset.{id,kind}. */
function makeNode(id, kind, classes) {
  return { dataset: { id: id, kind: kind }, classList: makeClassList(["plan-icon"].concat(classes || [])) };
}

/* Canvas-шим: querySelector ЧЕСТНО разбирает селектор — требуемый класс и один data-атрибут по
   ИМЕНИ и значению. Ищем узел, у которого есть этот класс и dataset[имя]===значение. Так подмена
   имени атрибута (data-id→data-kind) уводит поиск в другое поле, где id объекта не лежит. */
function makeCanvas(nodes) {
  return {
    querySelector(sel) {
      const clsMatch = sel.match(/\.([\w-]+)/);
      const attrMatch = sel.match(/\[data-([\w-]+)\s*=\s*"([^"]*)"\]/);
      assert.ok(attrMatch, "шим не понял селектор (нет [data-…=\"…\"]): " + sel);
      const cls = clsMatch ? clsMatch[1] : null;
      const prop = attrMatch[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // data-id → id
      const val = attrMatch[2];
      return nodes.find(n => (!cls || n.classList.contains(cls)) && n.dataset[prop] === val) || null;
    }
  };
}

/* Живая syncNoRoomClass в песочнице с окружением из app.js: canvas (шим), state и настоящий
   EPRoomAssign (критерий берётся из реального модуля — мутации в нём покраснеют здесь). */
function buildSync(canvas, state) {
  const ctx = { canvas: canvas, state: state, EPRoomAssign: EPRoomAssign };
  vm.createContext(ctx);
  return vm.runInContext(functionSource("syncNoRoomClass") + "\n;syncNoRoomClass;", ctx);
}

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
