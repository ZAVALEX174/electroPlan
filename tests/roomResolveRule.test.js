/* ПОВЕДЕНЧЕСКИЙ регресс правила «в какой комнате точка» (resolveRoomForPoint из js/app.js).

   ЗАЧЕМ ЭТОТ ТЕСТ, ЕСЛИ ЕСТЬ roomAssignSingleRuleWiring.test.js. Тот проверяет ТЕКСТ app.js
   (правило существует в одном экземпляре) — но не исполняет его. Из-за этого зелёными оставались
   дефекты ревью:
     - resolveRoomForPoint падал с ReferenceError: имя геометрии не было проброшено в app.js
       (свободное имя в строгом IIFE) — связка вообще не исполнялась, а ни один тест этого не видел;
     - порядок ветвей можно было переставить (grid-ветвь перед проверкой попадания — ручная подпись
       комнаты перехватывала объект, реально попавший в контур другой, полигональной комнаты).

   ИДЕЯ. app.js — монолит-оркестратор (DOM, state), в node не грузится. Но resolveRoomForPoint —
   чистая функция: все зависимости приходят через ctx и через геометрию. Мы вырезаем её ИСХОДНЫЙ
   ТЕКСТ из app.js и исполняем в изолированном контексте vm, куда кладём РОВНО те геометрические имена,
   которые app.js сам пробрасывает строкой `const {...}=EPGeom;`. Тогда:
     - если в этой строке снова забудут нужный алиас (как было с distancePointToSegment), функция
       упадёт с ReferenceError ровно так же, как в браузере, — и тест это поймает (класс «связка не
       исполняется»);
     - порядок ветвей проверяется НАСТОЯЩИМ прогоном на координатах, а не по тексту.

   Мы НЕ переписываем правило в тесте — исполняем именно то, что лежит в app.js. Второй копии логики
   не заводим (это и стережёт roomAssignSingleRuleWiring.test.js). Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPGeom = require("../js/geometry.js");
const EPRoomAssign = require("../js/roomAssign.js");
const EPConfig = require("../js/config.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Имена, которые app.js достаёт из EPGeom деструктуризацией верхнего уровня. Собираем контекст
   ТОЛЬКО из них — иначе тест «прощал» бы забытый алиас и не воспроизводил браузерный ReferenceError. */
function aliasedGeomNames() {
  const m = SRC.match(/const\s*\{([^}]*)\}\s*=\s*EPGeom\s*;/);
  assert.ok(m, "в app.js не нашлась строка алиасов `const {...}=EPGeom;`");
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}

/* Вырезаем исходник функции: от её объявления до следующего `\nfunction ` верхнего уровня
   (соседей у неё — getRoomForPoint), между ними только `}` и пустая строка — валидный JS. */
function functionSource(name) {
  const start = SRC.indexOf("function " + name);
  assert.ok(start >= 0, "функция " + name + " должна существовать в app.js");
  const rest = SRC.slice(start);
  const nextIdx = rest.indexOf("\nfunction ", 1);
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

/* Живая resolveRoomForPoint в песочнице с окружением, повторяющим лексику app.js:
   - геометрические имена — только те, что реально проброшены (aliasedGeomNames);
   - namespace EPGeom целиком (если правило зовёт EPGeom.* вместо алиаса);
   - EPRoomAssign / EPConfig — глобалы, как в браузере. */
function buildResolver() {
  const ctx = { EPGeom, EPRoomAssign, EPConfig };
  for (const name of aliasedGeomNames()) ctx[name] = EPGeom[name];
  vm.createContext(ctx);
  return vm.runInContext(functionSource("resolveRoomForPoint") + "\n;resolveRoomForPoint;", ctx);
}

/* Прямоугольный контур комнаты в форме state.rooms.{polygon:[{x,y}]}. */
const rect = (x1, y1, x2, y2) => [
  { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }
];
/* Карта пространства, где ВСЯ плоскость — одна компонента связности id=comp: одна клетка на весь
   план, не заблокирована. componentAt(map,*,*) вернёт comp для любой точки — grid-«подпись»
   имитирует ситуацию, где компонента через проёмы накрывает всю квартиру. */
const wholePlaneMap = comp => ({ cols: 1, rows: 1, cell: 1e6, originX: 0, originY: 0, blocked: [false], component: [comp] });

const resolve = buildResolver();

/* --- Класс «связка не исполняется» (дефект 1) -----------------------------------------------
   Обе ветви resolveRoomForPoint обязаны исполниться без исключения: ветвь попадания использует
   алиас pointInPolygon, grid-ветвь — componentAt. Если любой из них снова выпадет из строки
   алиасов app.js — здесь выстрелит ReferenceError, ровно как в браузере, и тест покраснеет. */
test("resolveRoomForPoint исполняется целиком: обе ветви не роняют ReferenceError", () => {
  const hitCtx = { polyRooms: [{ id: "A", polygon: rect(0, 0, 100, 100) }], gridRooms: [], map: null };
  assert.doesNotThrow(() => resolve(50, 50, hitCtx), "ветвь попадания (pointInPolygon) должна отработать");
  const gridCtx = { polyRooms: [], gridRooms: [{ id: "G", componentId: 7 }], map: wholePlaneMap(7) };
  assert.doesNotThrow(() => resolve(500, 500, gridCtx), "grid-ветвь (componentAt) должна отработать");
});

/* --- Порядок: настоящее попадание в контур решает первым (мутация «grid перед попаданием») ------
   Спальня — контур, «Кухня» — ручная подпись без контура, обе в одной компоненте (проём). Точка
   (50,50) лежит ВНУТРИ контура Спальни. При верном порядке pointInPolygon отдаёт Спальню сразу; если
   grid-ветвь переставить перед попаданием, объект на контуре Спальни перехватит подпись-Кухня. */
test("попадание в контур сильнее grid: точка внутри Спальни остаётся Спальней", () => {
  const ctx = {
    polyRooms: [{ id: "Спальня", polygon: rect(0, 0, 100, 100) }],
    gridRooms: [{ id: "Кухня", componentId: 7 }],
    map: wholePlaneMap(7)
  };
  const r = resolve(50, 50, ctx);
  assert.ok(r, "точка внутри контура обязана привязаться");
  assert.equal(r.id, "Спальня",
    "точка внутри Спальни не должна перехватываться grid-подписью Кухни");
});

/* --- grid-ветвь: комнаты без контура привязываются по компоненте связности -------------------- */
test("grid-комнаты без контуров: объект привязывается по компоненте связности", () => {
  const ctx = { polyRooms: [], gridRooms: [{ id: "Гостиная", componentId: 7 }], map: wholePlaneMap(7) };
  const r = resolve(500, 500, ctx);
  assert.ok(r, "в проекте только с подписями объект обязан привязаться по grid");
  assert.equal(r.id, "Гостиная");
});

/* --- Точка вне всех контуров и без grid-подписей — комнаты нет ---------------------------------
   Ни попадание, ни grid ничего не находят: правило обязано вернуть null (объект «вне помещений»),
   а не цепляться к ближайшему контуру. */
test("точка вне контуров без grid-комнат — null", () => {
  const ctx = { polyRooms: [{ id: "A", polygon: rect(0, 0, 100, 100) }], gridRooms: [], map: null };
  assert.equal(resolve(200, 200, ctx), null,
    "точка снаружи контура без grid-подписей не должна привязываться ни к какой комнате");
});

/* --- Guard component>=0: замурованная точка не липнет к grid-комнате с seed -1 -----------------
   ⚠️ ЕДИНСТВЕННОЕ отличие ветки от main по ДЕНЬГАМ. В main было ДВЕ копии правила: подсветка
   (getRoomForPoint) имела guard `if(target<0)return null`, а фактическая привязка внутри
   recalculateRoomAssignments — НЕ имела. На точке, чья компонента -1 (клетка замурована стенами),
   componentAt возвращает -1 и для точки, и для seed grid-комнаты, попавшего в тот же блок, — и
   незащищённая копия делала find(r=>r.componentId===component) === find(-1===-1), приписывая объект
   комнате, чей seed сам заблокирован. Ветка свела правило на защищённый вариант; guard component>=0
   отсекает коллизию -1===-1. Независимый замер: на входе из 6 штрихов в блоке 80×80 разница сметы
   11.06 EUR (main 40.52 → ветка 51.58). Снять guard = вернуть баг main и сдвинуть деньги.

   Вход строим на НАСТОЯЩЕЙ EPGeom.buildSpaceComponents (не рукодельная карта), иначе не доказать,
   что компонента -1 вообще достижима: блок 80×80 забит штриховкой из 6 отрезков (шаг 14, радиус 7
   смыкает соседние клетки), ВСЕ клетки блока заблокированы → componentAt внутри даёт -1. */
test("замурованная точка (компонента -1) не привязывается к grid-комнате, чей seed тоже -1", () => {
  const ox = 100, oy = 100, size = 80, cell = 10, wallRadius = 7;
  const walls = [];
  for (let i = 0; i < 6; i++) { const y = oy + 3 + i * 14; walls.push({ a: { x: ox, y }, b: { x: ox + size, y } }); }
  const map = EPGeom.buildSpaceComponents(size, size, walls, cell, wallRadius, ox, oy);

  const seedX = ox + 55, seedY = oy + 18;      // seed grid-комнаты как в roomResolveContext (r.x+55, r.y+18)
  const roomComp = EPGeom.componentAt(map, seedX, seedY);
  const ptX = ox + 40, ptY = oy + 40;
  const ptComp = EPGeom.componentAt(map, ptX, ptY);

  /* Инвариант входа: -1 достижим на настоящей карте — иначе тест ничего не доказывает. */
  assert.equal(roomComp, -1, "seed grid-комнаты в замурованном блоке обязан дать компоненту -1");
  assert.equal(ptComp, -1, "точка в замурованном блоке обязана дать компоненту -1");

  const ctx = { polyRooms: [], gridRooms: [{ id: "GB", componentId: roomComp }], map };
  assert.equal(resolve(ptX, ptY, ctx), null,
    "точка с компонентой -1 не должна привязываться к grid-комнате, чей componentId тоже -1: " +
    "guard component>=0 обязан отсечь коллизию -1===-1 (в main её не было — привязка и смета плыли)");
});
