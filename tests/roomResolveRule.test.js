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
const stand = require("./helpers/appStand.js");

const EPGeom = require("../js/geometry.js");
const EPRoomAssign = require("../js/roomAssign.js");
const EPConfig = require("../js/config.js");

/* Живая resolveRoomForPoint на общем стенде, в окружении, повторяющем лексику app.js:
   - геометрические имена — ТОЛЬКО те, что реально проброшены `const {…}=EPGeom;`
     (stand.destructuredNames): забудут алиас — контекст его не получит и функция упадёт
     ReferenceError ровно как в браузере;
   - namespace EPGeom целиком (если правило зовёт EPGeom.* вместо алиаса);
   - EPRoomAssign / EPConfig — глобалы, как в браузере. */
function buildResolver() {
  const ctx = { EPGeom, EPRoomAssign, EPConfig };
  for (const name of stand.destructuredNames("EPGeom")) ctx[name] = EPGeom[name];
  return stand.run("resolveRoomForPoint", ctx);
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
   Все три ветви resolveRoomForPoint обязаны исполниться без исключения: ветвь попадания использует
   алиас pointInPolygon, зонд — roomContourProbe, grid-ветвь — componentAt. Если любой снова выпадет из строки
   алиасов app.js — здесь выстрелит ReferenceError, ровно как в браузере, и тест покраснеет. */
test("resolveRoomForPoint исполняется целиком: все три ветви не роняют ReferenceError", () => {
  const hitCtx = { polyRooms: [{ id: "A", polygon: rect(0, 0, 100, 100) }], gridRooms: [], map: null, walls: [] };
  assert.doesNotThrow(() => resolve(50, 50, hitCtx), "ветвь попадания (pointInPolygon) должна отработать");
  assert.doesNotThrow(() => resolve(50, -6, hitCtx), "ветвь зонда (roomContourProbe) должна отработать");
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

/* --- Шаг A: граница, дверной проём и глухая стена -------------------------------------------- */
const wall = (ax, ay, bx, by) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });

test("регресс x=187/188: обе соседние позиции остаются в комнате A", () => {
  const polygon = rect(100, 100, 200, 300);
  /* Правая граница полигона закрыта не целиком: y=212 — дверной проём. Поэтому центр поста на
     границе может пройти внутрь, а не считается находящимся за глухой стеной. */
  const walls = [wall(200, 100, 200, 190), wall(200, 230, 200, 300)];
  const ctx = { polyRooms: [{ id: "A", polygon }], gridRooms: [], map: null, walls };

  const at187 = resolve(187 + 12, 200 + 12, ctx); // cx=199: обычное попадание внутрь
  const at188 = resolve(188 + 12, 200 + 12, ctx); // cx=200: ровно граница, pointInPolygon=false
  assert.equal(at187?.id, "A");
  assert.equal(EPGeom.pointInPolygon(200, 212, polygon), false, "фиксируем исходную причину дефекта");
  assert.equal(at188?.id, "A", "один пиксель не должен выбрасывать пост из комнаты");
});

test("8 px у проёма принимаются, те же 8 px за глухой стеной отвергаются", () => {
  const polygon = rect(100, 100, 200, 300);
  const room = { id: "A", polygon };
  const openCtx = {
    polyRooms: [room], gridRooms: [], map: null,
    walls: [wall(200, 100, 200, 190), wall(200, 230, 200, 300)]
  };
  const closedCtx = { polyRooms: [room], gridRooms: [], map: null, walls: [wall(200, 100, 200, 300)] };
  assert.equal(resolve(208, 212, openCtx)?.id, "A", "в проёме путь к контуру свободен");
  assert.equal(resolve(208, 212, closedCtx), null, "сквозь глухую стену близость не даёт комнату");
});

test("граница допуска: 12 px у проёма принимаются, 13 px — уже нет", () => {
  const polygon = rect(100, 100, 200, 300);
  const ctx = { polyRooms: [{ id: "A", polygon }], gridRooms: [], map: null, walls: [] };
  assert.equal(resolve(212, 212, ctx)?.id, "A", "roomEdgeTolerance включителен");
  assert.equal(resolve(213, 212, ctx), null, "дальний объект не притягивается к комнате");
});

test("заблокированный контур не мешает прежней grid-ветке вернуть Коридор", () => {
  const polygon = rect(100, 100, 200, 300);
  const ctx = {
    polyRooms: [{ id: "Спальня", polygon }],
    gridRooms: [{ id: "Коридор", componentId: 7 }],
    map: wholePlaneMap(7), walls: [wall(200, 100, 200, 300)]
  };
  assert.equal(resolve(208, 212, ctx)?.id, "Коридор",
    "зонд отвергает Спальню за стеной, после чего работает существующий grid-фолбэк");
});

test("равноудалённые доступные контуры не выбираются по порядку или нестабильному id", () => {
  const a = { id: "room_z", polygon: rect(0, 0, 100, 100) };
  const b = { id: "room_a", polygon: rect(120, 0, 220, 100) };
  const makeCtx = polyRooms => ({ polyRooms, gridRooms: [], map: null, walls: [] });
  assert.equal(resolve(110, 50, makeCtx([a, b])), null);
  assert.equal(resolve(110, 50, makeCtx([b, a])), null,
    "при смене порядка/id геометрически неоднозначный объект остаётся видимой сиротой");
});

test("из двух доступных контуров выбирается действительно ближайший", () => {
  const far = { id: "far", polygon: rect(0, 0, 100, 100) };      // 10 px
  const near = { id: "near", polygon: rect(113, 0, 213, 100) };  // 3 px
  const ctx = { polyRooms: [far, near], gridRooms: [], map: null, walls: [] };
  assert.equal(resolve(110, 50, ctx)?.id, "near");
});

test("roomResolveContext передаёт зондированию полный набор стен", () => {
  const walls = [wall(200, 100, 200, 300)];
  const state = { rooms: [{ id: "A", polygon: rect(100, 100, 200, 300) }] };
  const contextFor = stand.run("roomResolveContext", {
    state,
    allWalls: () => walls,
    buildSpaceComponents: () => { throw new Error("без grid-комнат карта не нужна"); },
    componentAt: EPGeom.componentAt
  });
  const ctx = contextFor();
  assert.equal(ctx.walls, walls, "контекст обязан не потерять стены между state и resolveRoomForPoint");
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
