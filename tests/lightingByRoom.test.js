/* Автотесты расчёта групп света ПО КОМНАТАМ (ЧАСТЬ 3).
   Запуск без зависимостей и без сборщика:  node --test tests/

   Чистая часть — EPLightingByRoom.planByRooms (раскрой проекта на партиции по комнатам, вызов
   расчёта со СВОЕЙ схемой каждой и слияние обратно в один план) и EPLightingByRoom.cacheSignature
   (подпись кэша с привязкой постов к комнатам и схемами комнат). app.js в прогон не входит, поэтому
   партиционирование, слияние и подпись вынесены в отдельный модуль и проверяются здесь с НАСТОЯЩИМ
   расчётом (LG.plan) и настоящим разрешением схемы комнаты (Room.roomLightingScheme).
   Ошибка здесь не падает, а молча меняет деньги в смете, поэтому проверяем и раскладку ролей, и
   разделение одноимённых групп, и детерминизм, и сброс кэша. */
const test = require("node:test");
const assert = require("node:assert/strict");
const LBR = require("../js/lightingByRoom.js");
const LG = require("../js/lightingGroups.js");
const LP = require("../js/lightingPlan.js");
const Room = require("../js/room.js");

/* ── каталог-заглушка (форма настоящего: partRole/controlRole) ─────────────────────── */
const KEY = { id: 1, code: "20021", name: "Клавиша 1 модуль", price: 5.08, partRole: "key", series: ["Eikon Evo"] };
const SWITCH = { id: 10, code: "20001.0", name: "Выключатель", price: 20.26, partRole: "bare_mechanism", controlRole: "switch", series: ["Eikon Evo"] };
const CHANGEOVER = { id: 11, code: "20005.0", name: "Переключатель", price: 25.79, partRole: "bare_mechanism", controlRole: "changeover", series: ["Eikon Evo"] };
const INVERTER = { id: 12, code: "20013.0", name: "Инвертор", price: 42.33, partRole: "bare_mechanism", controlRole: "inverter", series: ["Eikon Evo"] };
const BUTTON = { id: 13, code: "20008.0", name: "Кнопка", price: 18, partRole: "bare_mechanism", controlRole: "button", series: ["Eikon Evo"] };
const MECHS = [SWITCH, CHANGEOVER, INVERTER, BUTTON];
const ALL = [KEY].concat(MECHS);

const product = id => ALL.find(p => p.id === Number(id));
const seriesOf = item => (item && item.series) || [];
const isKey = item => !!item && item.partRole === "key";
const findMechanism = ({ role, series }) => LP.resolveMechanism({ role, series }, MECHS).product;
const collect = posts => LP.collect(posts, { product, seriesOf, isKey });

/* Пост с одной клавишей и одной группой — минимальное место управления. */
const post = (id, roomId, group, number) => ({ id, number: number == null ? id : number, roomId,
  mechanismIds: [KEY.id], keyGroups: [group] });

/* Обёртка ровно как в app.js.lightingFor: карты пост→комната, комната→схема/подпись/ранг, дальше
   planByRooms. labelForPartition и orderForPartition повторяют проводку app.js (подпись комнаты и
   порядок «как в листе монтажника, без комнаты в конце»). */
function planByRoomsFor(posts, rooms, projectScheme) {
  const scheme = projectScheme || "classic";
  const roomById = new Map((rooms || []).map(r => [r.id, r]));
  const roomOrder = new Map((rooms || []).map((r, i) => [r.id, i]));
  const roomOfPost = new Map(posts.map(p => [p.id, p.roomId != null ? p.roomId : null]));
  return LBR.planByRooms({
    places: collect(posts),
    projectScheme: scheme,
    projectSchemeLabel: (LG.SCHEMES.find(s => s.id === scheme) || {}).label || "",
    partitionKeyOf: place => { const rid = roomOfPost.get(place.postId); return rid == null ? null : rid; },
    schemeForPartition: key => key == null ? scheme : Room.roomLightingScheme(roomById.get(key), scheme, LG.SCHEMES),
    labelForPartition: key => key == null ? "Без помещения" : ((roomById.get(key) || {}).name || ""),
    orderForPartition: key => key == null ? Infinity : (roomOrder.has(key) ? roomOrder.get(key) : Infinity),
    plan: LG.plan,
    planDeps: { seriesOf, findMechanism }
  });
}

/* place по адресу «postId#keyIndex» — сравнивать раскладку, не завися от позиции в массиве. */
const byAddress = plan => {
  const map = new Map();
  (plan.places || []).forEach(p => { if (p) map.set(String(p.postId) + "#" + p.keyIndex, p); });
  return map;
};

/* ── партиционирование по комнатам и раскладка по своей схеме ───────────────────────── */

test("две комнаты с разными схемами считаются каждая по своей", () => {
  const rooms = [{ id: "A", lightingScheme: "classic" }, { id: "B", lightingScheme: "relay" }];
  const posts = [post("p1", "A", "Зал"), post("p2", "B", "Зал")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const at = byAddress(plan);
  /* одноимённая «Зал» в разных комнатах — разные группы и разные схемы */
  assert.equal(at.get("p1#0").role, "switch");           /* classic, N=1 */
  assert.equal(at.get("p2#0").role, "button");           /* relay */
  assert.equal(plan.relayTotal, 1);                      /* реле посчитано только у relay-комнаты */
});

test("одноимённые группы в разных комнатах — ДВЕ независимые группы", () => {
  const rooms = [{ id: "A" }, { id: "B" }];   /* без своих схем → обе classic (схема проекта) */
  /* «Кухня»: два места в комнате A, одно в комнате B. Одним проектом это был бы N=3
     (2 переключателя + инвертор); по комнатам — N=2 в A (2 переключателя) и N=1 в B (выключатель). */
  const posts = [post("a1", "A", "Кухня"), post("a2", "A", "Кухня"), post("b1", "B", "Кухня")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const kitchen = plan.groups.filter(g => g.key === "кухня");
  assert.equal(kitchen.length, 2, "две отдельные группы «Кухня»");
  assert.deepEqual(kitchen.map(g => g.placeCount).sort(), [1, 2]);
  assert.equal(plan.totals.changeover, 2, "две переключателя (комната A, N=2)");
  assert.equal(plan.totals.switch, 1, "один выключатель (комната B, N=1)");
  assert.equal(plan.totals.inverter, 0, "инвертора нет — группа по комнатам не набрала N=3");
});

test("посты без комнаты считаются по схеме проекта", () => {
  const posts = [post("p1", null, "Свет"), post("p2", null, "Свет")];
  const plan = planByRoomsFor(posts, [], "classic");   /* оба без комнаты → одна партиция, N=2 */
  const at = byAddress(plan);
  assert.equal(at.get("p1#0").role, "changeover");
  assert.equal(at.get("p2#0").role, "changeover");
  assert.equal(plan.totals.changeover, 2);
});

test("пост без комнаты и посты в комнате — РАЗНЫЕ партиции", () => {
  const rooms = [{ id: "A" }];
  const posts = [post("p1", null, "Свет"), post("p2", "A", "Свет")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const at = byAddress(plan);
  assert.equal(at.get("p1#0").role, "switch", "roomless «Свет» N=1");
  assert.equal(at.get("p2#0").role, "switch", "комнатный «Свет» N=1");
  assert.equal(plan.groups.filter(g => g.key === "свет").length, 2);
});

/* ── обратная совместимость: один расчёт === планByRooms одной партицией ──────────────── */

test("без своих схем и без раскроя по комнатам результат совпадает с одиночным planом", () => {
  /* Все посты в ОДНОЙ комнате без своей схемы → ровно одна партиция со схемой проекта.
     Раскладка ролей и суммы обязаны совпасть с прежним поведением (один LG.plan на проект). */
  const posts = [post("p1", "A", "Кухня"), post("p2", "A", "Кухня"), post("p3", "A", "Спальня")];
  const rooms = [{ id: "A" }];
  const merged = planByRoomsFor(posts, rooms, "classic");
  const single = LG.plan({ scheme: "classic", places: collect(posts) }, { seriesOf, findMechanism });
  assert.equal(LP.planSignature(merged), LP.planSignature(single));
  assert.deepEqual(merged.totals, single.totals);
});

test("пустой проект bell — план по схеме проекта, БЕЗ пробела схемы (bell поддержана)", () => {
  const plan = planByRoomsFor([], [], "bell");
  assert.equal(plan.scheme, "bell");
  assert.equal(plan.supported, true);
  assert.ok(!plan.gaps.some(g => g.kind === "scheme-not-implemented"), "«расчёт недоступен» больше нет");
});

test("пустой проект НЕРАСПОЗНАННОЙ схемы — пробел схемы на пустом проекте сохраняется", () => {
  /* Пустой проект по-прежнему отдаёт причину, когда схема без правил: тут — битый идентификатор. */
  const plan = planByRoomsFor([], [], "нет-такой");
  assert.ok(plan.gaps.some(g => g.kind === "scheme-unknown"));
});

/* ── детерминизм ────────────────────────────────────────────────────────────────────── */

test("результат не зависит от порядка постов на входе", () => {
  const rooms = [{ id: "A" }, { id: "B", lightingScheme: "relay" }];
  const posts = [post("a1", "A", "Кухня"), post("a2", "A", "Кухня"), post("b1", "B", "Кухня"), post("a3", "A", "Зал")];
  const straight = byAddress(planByRoomsFor(posts, rooms, "classic"));
  const shuffled = byAddress(planByRoomsFor([posts[2], posts[0], posts[3], posts[1]], rooms, "classic"));
  straight.forEach((p, key) => {
    const q = shuffled.get(key);
    assert.equal(q.role, p.role, "роль места " + key);
    assert.equal(q.code, p.code, "артикул места " + key);
    assert.equal(q.placeNo, p.placeNo, "адрес места " + key);
  });
  /* Порядок групп в слитом плане стабилен благодаря СОРТИРОВКЕ ПАРТИЦИЙ (по рангу комнаты, при
     равенстве — по строковому ключу), а не порядку появления комнат во входе.
     ⚠️ Перестановка обязана начинаться с поста комнаты B (posts[2] = b1), иначе тест бессилен:
     если во ВХОДЕ первой встречается комната A в обоих случаях, то и порядок Map (по первому
     появлению), и отсортированный порядок совпадут — и «сортировку убрали» тест не заметит.
     С b1 впереди без сортировки Map отдал бы группы B раньше A, и keysB разошёлся бы с keysA. */
  const keysA = planByRoomsFor(posts, rooms, "classic").groups.map(g => g.key + "@" + g.placeCount);
  const keysB = planByRoomsFor([posts[2], posts[0], posts[1], posts[3]], rooms, "classic").groups.map(g => g.key + "@" + g.placeCount);
  assert.deepEqual(keysA, keysB);
});

test("пост, переехавший в другую комнату, попадает в её партицию", () => {
  const rooms = [{ id: "A" }, { id: "B" }];
  /* оба поста в A: «Свет» N=2 → два переключателя */
  const together = byAddress(planByRoomsFor([post("p1", "A", "Свет"), post("p2", "A", "Свет")], rooms, "classic"));
  assert.equal(together.get("p1#0").role, "changeover");
  assert.equal(together.get("p2#0").role, "changeover");
  /* p2 переехал в B: в каждой комнате «Свет» N=1 → два выключателя */
  const moved = byAddress(planByRoomsFor([post("p1", "A", "Свет"), post("p2", "B", "Свет")], rooms, "classic"));
  assert.equal(moved.get("p1#0").role, "switch");
  assert.equal(moved.get("p2#0").role, "switch");
});

/* ── слияние сохраняет выравнивание мест по индексу входа (для rowsByPost) ──────────────── */

test("места слитого плана выровнены по индексу входа — rowsByPost раскладывает по постам", () => {
  const rooms = [{ id: "A" }, { id: "B" }];
  const posts = [post("p1", "B", "Кухня"), post("p2", "A", "Кухня"), post("p3", "A", "Кухня")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const places = collect(posts);
  assert.equal(plan.places.length, places.length);
  /* индекс места в слитом плане совпадает с индексом источника — иначе документ прочитает чужую клавишу */
  plan.places.forEach((p, i) => assert.equal(String(p.postId), String(places[i].postId)));
  const rows = LP.rowsByPost(plan, places, LG.GAP_TEXTS);
  assert.equal(rows.get(LP.postKey({ id: "p1" }))[0].roleLabel, "Выключатель");   /* B: «Кухня» N=1 */
  assert.equal(rows.get(LP.postKey({ id: "p2" }))[0].roleLabel, "Переключатель"); /* A: «Кухня» N=2 */
});

/* ── подпись кэша ───────────────────────────────────────────────────────────────────── */

const sigOf = (posts, rooms, projectScheme) => LBR.cacheSignature({
  projectScheme: projectScheme || "classic", productCount: ALL.length,
  posts, rooms: rooms || [],
  schemeOf: r => Room.roomLightingScheme(r, projectScheme || "classic", LG.SCHEMES)
});

test("подпись кэша меняется при переезде поста в другую комнату", () => {
  const rooms = [{ id: "A" }, { id: "B" }];
  const before = sigOf([post("p1", "A", "Свет")], rooms);
  const after = sigOf([post("p1", "B", "Свет")], rooms);
  assert.notEqual(before, after);
});

test("подпись кэша меняется при смене схемы у комнаты", () => {
  const posts = [post("p1", "A", "Свет")];
  const before = sigOf(posts, [{ id: "A" }]);
  const after = sigOf(posts, [{ id: "A", lightingScheme: "relay" }]);
  assert.notEqual(before, after);
});

test("подпись кэша стабильна, когда ничего значимого не изменилось", () => {
  const rooms = [{ id: "A", lightingScheme: "relay" }];
  const posts = [post("p1", "A", "Свет")];
  assert.equal(sigOf(posts, rooms), sigOf(posts.map(p => Object.assign({}, p)), rooms.map(r => Object.assign({}, r))));
});

/* ── НАБЛЮДАЕМОЕ: проставленный «№ проходной» сразу меняет блок «Группы света» ──────────────
   Дефект (владелец воспроизвёл в браузере): двум постам в одной комнате проставили один и тот же
   № проходной, а блок «Группы света» продолжал показывать их отдельными выключателями — пока не
   переключишь схему электрики туда-обратно (что сдвигало подпись кэша и вызывало пересчёт).
   Корень — cacheSignature НЕ включал keyCrossNumbers, и projectLighting отдавал устаревший план.
   Тест сторожит НАБЛЮДАЕМОЕ (текст блока), исполняя тот же механизм кэша, что и app.js.projectLighting:
   ответ берётся из кэша, пока не сменилась cacheSignature. Ту же причину имеет и ручной выбор
   механизма (keyMechanisms) — он тоже добавлен в подпись. */
const postCross = (id, roomId, crossNo) => ({ id, number: id, roomId,
  mechanismIds: [KEY.id], keyGroups: [""], keyCrossNumbers: [crossNo == null ? "" : String(crossNo)] });

test("проставленный № проходной сразу перестраивает блок «Группы света» (кэш сбрасывается)", () => {
  /* Зеркало app.js.projectLighting: значение живёт в кэше, ключ — cacheSignature; пересчёт ТОЛЬКО
     при смене подписи. Если подпись слепа к crossNo, второй вызов вернёт устаревший план. */
  let cache = { sig: null, value: null };
  const rooms = [{ id: "A" }];
  const projectLighting = posts => {
    const sig = sigOf(posts, rooms, "classic");
    if (cache.sig !== sig) cache = { sig, value: planByRoomsFor(posts, rooms, "classic") };
    return cache.value;
  };

  /* Стартовое состояние: два поста без номера проходной → два самостоятельных выключателя. */
  const htmlBefore = LP.buildHtml(projectLighting([postCross("p1", "A", null), postCross("p2", "A", null)]), {});
  assert.match(htmlBefore, /Выключатель/, "исходно — два отдельных выключателя");
  assert.doesNotMatch(htmlBefore, /Проходная № 1/, "проходной ещё нет");

  /* Человек проставил обоим постам «№ проходной» = 1 и сохранил. Блок ОБЯЗАН тут же показать
     объединённую проходную из двух переключателей — без переключения схемы и прочих действий. */
  const htmlAfter = LP.buildHtml(projectLighting([postCross("p1", "A", "1"), postCross("p2", "A", "1")]), {});
  assert.match(htmlAfter, /Проходная № 1/, "проставленный номер сразу склеил посты в одну проходную");
  assert.match(htmlAfter, /Переключатель/, "два места проходной → переключатели, а не выключатели");
  assert.doesNotMatch(htmlAfter, /клавиша 1/, "отдельных групп «Пост N · клавиша 1» больше нет");
});

test("ручной выбор механизма клавиши сразу перестраивает блок (keyMechanisms в подписи)", () => {
  /* Тот же класс дефекта: keyMechanisms (ручная роль клавиши) меняет план, а подпись — нет.
     Наблюдаемое: одиночный пост, роль клавиши руками переведена в «переключатель». */
  let cache = { sig: null, value: null };
  const rooms = [{ id: "A" }];
  const projectLighting = posts => {
    const sig = sigOf(posts, rooms, "classic");
    if (cache.sig !== sig) cache = { sig, value: planByRoomsFor(posts, rooms, "classic") };
    return cache.value;
  };
  const withMech = mech => [{ id: "p1", number: 1, roomId: "A", mechanismIds: [KEY.id], keyGroups: ["Свет"], keyMechanisms: [mech] }];

  const htmlBefore = LP.buildHtml(projectLighting(withMech("")), {});
  assert.match(htmlBefore, /Выключатель/, "одно место группы «Свет» → выключатель");

  const htmlAfter = LP.buildHtml(projectLighting(withMech(CHANGEOVER.controlRole)), {});
  assert.match(htmlAfter, /Переключатель/, "ручной выбор переключателя виден сразу, без стороннего действия");
});

/* ── склейка пробелов подпланов (дефект: planByRooms конкатенировал gaps вместо склейки) ── */

test("одинаковые пробелы из разных комнат склеиваются в одну печатную строку", () => {
  const rooms = [{ id: "A" }, { id: "B" }, { id: "C" }];
  /* В каждой из трёх комнат — пост группы «Свет» с ПОТЕРЯННОЙ клавишей (товар выпал из каталога,
     прайс перезалит): один и тот же пробел KEY_UNKNOWN с одним groupKey. Три комнаты → должен
     склеиться в ОДНУ печатную строку с «мест: 3», а не размножиться по комнате.
     (Раньше здесь стоял пробел «группа не указана», но он исчез: клавиша без имени теперь
     самостоятельный выключатель, а не пробел — см. resolveGroup.) */
  const lost = (id, roomId) => ({ id, number: id, roomId, mechanismIds: [999], keyGroups: ["Свет"] });
  const posts = [lost("a", "A"), lost("b", "B"), lost("c", "C")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const unknown = plan.gaps.filter(g => g.kind === "key-unknown");
  assert.equal(unknown.length, 1, "один пробел на все три комнаты, а не три");
  assert.equal(unknown[0].places.length, 3, "места всех трёх комнат объединены (мест: 3)");
  const html = LP.buildHtml(plan, {});
  assert.ok(html.includes("мест: 3"), "печать: одна строка с «мест: 3»");
});

test("relay-article из разных relay-комнат склеивается в одну строку", () => {
  const rooms = [{ id: "A", lightingScheme: "relay" }, { id: "B", lightingScheme: "relay" }];
  const posts = [post("a", "A", "Свет"), post("b", "B", "Свет")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const relayGap = plan.gaps.filter(g => g.kind === "relay-article-unknown");
  assert.equal(relayGap.length, 1, "одна строка relay-article на обе relay-комнаты");
});

/* ── разреженный список и битые места (forEach проскакивал дыры, undefined ронял расчёт) ── */

test("разреженный список мест — дыра попадает в партицию и получает честный пробел", () => {
  const places = collect([post("p1", "A", "Свет"), post("p2", "A", "Свет"), post("p3", "A", "Свет")]);
  delete places[1];   /* приложение так делает после удаления клавиши — индекс 1 остаётся дырой */
  const plan = LBR.planByRooms({
    places, projectScheme: "classic", projectSchemeLabel: "",
    partitionKeyOf: place => (place && place.postId != null ? "A" : null),
    schemeForPartition: () => "classic",
    plan: LG.plan, planDeps: { seriesOf, findMechanism }
  });
  assert.equal(plan.places.length, 3, "длина выдачи равна длине входа, дыр в ней нет");
  assert.equal(plan.missingTotal, 1, "дыра честно учтена как пробел, не потеряна");
  assert.ok(plan.gaps.some(g => g.kind === "series-unknown" && g.places.includes(1)),
    "у дыры честный пробел: своя группа-выключатель есть, но серии у неё нет");
});

test("undefined в списке мест не роняет расчёт — честный пробел, как у одиночного plan", () => {
  const places = collect([post("p1", "A", "Свет")]);
  places.push(undefined);   /* «битое» место; partitionKeyOf приложения читает place.postId */
  const run = () => LBR.planByRooms({
    places, projectScheme: "classic", projectSchemeLabel: "",
    partitionKeyOf: place => (place.postId === "p1" ? "A" : null),   /* без своей защиты — как в app.js */
    schemeForPartition: () => "classic",
    plan: LG.plan, planDeps: { seriesOf, findMechanism }
  });
  assert.doesNotThrow(run, "защита на входе не даёт TypeError");
  const plan = run();
  assert.equal(plan.places.length, 2, "битое место занимает свою позицию");
  assert.ok(plan.gaps.some(g => g.kind === "series-unknown"), "битое место — честный пробел (нет серии)");
});

/* ── смешанный проект: classic + relay + bell по комнатам ── */

test("смешанный проект (classic + relay + bell): реле считаются ТОЛЬКО у relay-комнаты", () => {
  /* Ключевая проверка правила «считать ли реле — решает одно место». Три комнаты по своей схеме:
     classic → выключатель, relay → кнопка + реле, bell → кнопка БЕЗ реле. Реле в проекте ровно
     одно (от relay-комнаты); bell-комната даёт кнопку, но реле не добавляет. */
  const rooms = [
    { id: "A", lightingScheme: "classic" },
    { id: "B", lightingScheme: "relay" },
    { id: "C", lightingScheme: "bell" }
  ];
  const posts = [post("a", "A", "Свет"), post("b", "B", "Свет"), post("c", "C", "Свет")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const at = byAddress(plan);
  assert.equal(at.get("a#0").role, "switch", "classic-комната — выключатель");
  assert.equal(at.get("b#0").role, "button", "relay-комната — кнопка");
  assert.equal(at.get("c#0").role, "button", "bell-комната — тоже кнопка");
  assert.equal(plan.relayTotal, 1, "реле только у relay-комнаты, bell реле не добавляет");
  assert.equal(plan.relays.length, 1, "секция реле одна — от relay-комнаты");
  assert.equal(plan.relays[0].count, 1, "одно реле на группу relay-комнаты");
  assert.ok(!plan.gaps.some(g => g.kind === "scheme-not-implemented"), "все три схемы поддержаны");
  assert.equal(plan.supported, true);
});

test("переключение проекта bell ↔ relay меняет ТОЛЬКО реле, кнопки те же", () => {
  const posts = [post("p1", null, "Холл"), post("p2", null, "Холл")];
  const bell = planByRoomsFor(posts, [], "bell");
  const relay = planByRoomsFor(posts, [], "relay");
  assert.deepEqual(bell.places.map(p => p && p.role), relay.places.map(p => p && p.role), "роли-кнопки те же");
  assert.deepEqual(bell.totals, relay.totals, "итоги по кнопкам те же");
  assert.equal(relay.relayTotal, 1, "у relay реле есть…");
  assert.equal(bell.relayTotal, 0, "…у bell — нет");
  assert.deepEqual(bell.relays, []);
});

/* ── порядок партиций: как в листе монтажника — комнаты по state.rooms, «без комнаты» ПОСЛЕДНЕЙ ── */

test("порядок групп = порядок комнат в проекте, «без комнаты» последней", () => {
  /* Комнаты в проекте идут B, затем A (нарочно не по алфавиту — проверяем, что порядок берётся из
     переданного roomOrder, а не из строкового ключа). «Без комнаты» обязана уйти в конец, как
     «Без помещения» в листе монтажника — раньше она печаталась ПЕРВОЙ (дефект 3). */
  const rooms = [{ id: "B" }, { id: "A" }];
  const posts = [post("a1", "A", "aaa"), post("p0", null, "zzz"), post("b1", "B", "bbb")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  assert.deepEqual(plan.groups.map(g => g.key), ["bbb", "aaa", "zzz"],
    "сначала комната B, затем A (порядок state.rooms), «без комнаты» — последней");
});

/* ── слияние переводит ВСЕ индексы подпланов в глобальные (перемап) ──────────────────────
   Общий приём: комната B во ВХОДЕ идёт первой (индексы 0,1), но сортируется ПОЗЖЕ A ("r:A" <
   "r:B"), поэтому подсписок A обрабатывается первым и его место с глобальным индексом 2 получает
   в подплане суб-индекс 0. Если перемап где-то потерян, суб-индекс уедет в выдачу как глобальный —
   ровно это ловят три теста ниже. Без такого расхождения (когда партиции идут по возрастанию
   индекса) суб-индекс совпал бы с глобальным и мутация осталась бы зелёной. */
const remapScenario = () => {
  const rooms = [{ id: "A" }, { id: "B" }];
  const posts = [post("b1", "B", "Свет"), post("b2", "B", "Свет"), post("a1", "A", "Зал")];
  return planByRoomsFor(posts, rooms, "classic");   /* A: «Зал» N=1; B: «Свет» N=2 */
};

test("index каждого места слитого плана — его ГЛОБАЛЬНАЯ позиция во входе", () => {
  /* Мутация «place.index не переписан на глобальный»: место A с глобальным индексом 2 несло бы
     суб-индекс 0 — любой потребитель, адресующий место по .index, прочитал бы чужую клавишу. */
  const plan = remapScenario();
  plan.places.forEach((p, i) => { if (p) assert.equal(p.index, i, "index места на позиции " + i); });
});

test("group.places — глобальные индексы, и каждый указывает на место ЭТОЙ группы", () => {
  /* Мутация «groups[].places не перемаплены»: places группы «Зал» держали бы суб-индекс [0],
     а по нему в слитом плане лежит место комнаты B из группы «Свет» — группа ссылалась бы на
     чужие места, а placeCount разошёлся бы с длиной списка. */
  const plan = remapScenario();
  plan.groups.forEach(g => {
    assert.equal(g.places.length, g.placeCount, "placeCount группы «" + g.key + "» = длине places");
    g.places.forEach(gi => {
      const pl = plan.places[gi];
      assert.ok(pl, "место группы «" + g.key + "» существует по индексу " + gi);
      assert.equal(pl.groupKey, g.key, "место индекса " + gi + " принадлежит группе «" + g.key + "»");
    });
  });
});

test("order слитого плана — перестановка всех глобальных индексов входа, без дыр и дублей", () => {
  /* Мутация «order не перемаплен»: обе партиции толкали бы суб-индексы, order стал бы [0,0,1] —
     дубль 0 и потерянный 2. order обязан быть канонической перестановкой ВСЕХ входных индексов. */
  const plan = remapScenario();
  const idxs = plan.order.slice().sort((a, b) => a - b);
  assert.deepEqual(idxs, [0, 1, 2], "order накрывает ровно индексы 0..n-1 по разу");
  plan.order.forEach(i => assert.ok(plan.places[i], "order[" + i + "] указывает на существующее место"));
});

test("место без имени группы раскладывается по своему глобальному индексу (remap)", () => {
  /* Мутация «места не перемаплены»: место безымянной клавиши комнаты A (глобальный индекс 1,
     суб-индекс 0) встало бы на индекс 0 — туда, где место комнаты B. Клавиша без имени теперь
     самостоятельный выключатель (resolveGroup), а не пробел, — проверяем, что её ВЫКЛЮЧАТЕЛЬ
     лёг на её собственный глобальный индекс, а не на чужой.
     (Прежние тесты unassigned.places/placeCount удалены вместе с самим полем: «не назначенных»
     мест больше не бывает — каждая клавиша попадает в какую-то группу.) */
  const rooms = [{ id: "A" }, { id: "B" }];
  const posts = [post("b1", "B", "Свет"), post("a1", "A", "")];   /* a1 без имени, глоб. индекс 1 */
  const plan = planByRoomsFor(posts, rooms, "classic");
  assert.equal(plan.places[1].postId, "a1", "место комнаты A стоит на своём глобальном индексе");
  assert.equal(plan.places[1].role, LG.ROLES.SWITCH, "безымянная клавиша — самостоятельный выключатель");
  assert.equal(plan.places[1].code, "20001.0");
  assert.equal(plan.places[0].postId, "b1", "место комнаты B — на индексе 0");
});

test("реле relay-комнаты переносится в слитый план и печатается в КП", () => {
  /* Мутация «relays не переносятся»: relays слитого плана остались бы пустыми, и блок групп света
     в КП НЕ напечатал бы строку реле — при том что relayTotal (другой счётчик) считался бы верно.
     Смотрим на наблюдаемый результат — печать buildHtml, ровно то, что видит человек. */
  const rooms = [{ id: "R", lightingScheme: "relay" }];
  const posts = [post("r1", "R", "Свет"), post("r2", "R", "Свет")];   /* relay, N=2 → count>0 */
  const plan = planByRoomsFor(posts, rooms, "classic");
  assert.ok(plan.relays.filter(r => r.count > 0).length >= 1, "в слитом плане есть запись реле");
  const html = LP.buildHtml(plan, {});
  assert.ok(html.includes("Импульсное реле"), "строка реле напечатана в блоке групп света");
});

test("totalsRequired складывается по партициям — равен числу назначенных ролей во всех местах", () => {
  /* Мутация «totalsRequired не складывается»: остался бы пустой {} при двух местах роли switch.
     Правило: totalsRequired[role] = сколько мест слитого плана получили эту роль (независимо от
     того, найден ли товар). Проверяем против самих мест, а не против ожидаемого числа руками. */
  const rooms = [{ id: "A" }, { id: "B" }];
  const posts = [post("a1", "A", "Свет"), post("b1", "B", "Свет")];   /* по одному месту N=1 → switch */
  const plan = planByRoomsFor(posts, rooms, "classic");
  const need = {};
  plan.places.forEach(p => { if (p && p.role) need[p.role] = (need[p.role] || 0) + 1; });
  Object.keys(need).forEach(role =>
    assert.equal(plan.totalsRequired[role] || 0, need[role], "totalsRequired." + role));
  assert.equal(plan.totalsRequired.switch, 2, "две комнаты по одному «Свет» — два выключателя требуются");
});

/* ── ДОКУМЕНТ: шапка схемы, комната у строк, порядок и детерминизм (дефекты 1–3) ──────────
   Проверяем через НАБЛЮДАЕМЫЙ результат — EPLightingPlan.buildHtml, — то, что видит человек. */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => `${(Number(n) || 0).toFixed(2)} €`;
const html = plan => LP.buildHtml(plan, { esc, money });
/* Комната с именем — иначе labelForPartition вернёт "" и подпись не проверить. */
const namedPost = (id, roomId, group, number) => post(id, roomId, group, number);

/* ── дефект 1: шапка схемы ──────────────────────────────────────────────────────────── */

test("шапка: одна схема на все комнаты — печатается её имя, не «по комнатам»", () => {
  const rooms = [{ id: "A", name: "Гостиная" }, { id: "B", name: "Спальня" }];   /* обе classic */
  const plan = planByRoomsFor([namedPost("a1", "A", "Свет"), namedPost("b1", "B", "Свет")], rooms, "classic");
  assert.equal(plan.schemesByRoom, false);
  const h = html(plan);
  assert.ok(h.includes("Схема: Классическая"), "имя единой схемы в шапке");
  assert.ok(!h.includes("по комнатам"), "не должно быть «по комнатам», когда схема одна");
});

test("шапка: схемы разных комнат различаются — «по комнатам», а не одна из них", () => {
  const rooms = [{ id: "A", name: "Гостиная", lightingScheme: "classic" },
                 { id: "B", name: "Спальня", lightingScheme: "relay" }];
  const plan = planByRoomsFor([namedPost("a1", "A", "Свет"), namedPost("b1", "B", "Свет")], rooms, "classic");
  assert.equal(plan.schemesByRoom, true);
  const h = html(plan);
  assert.ok(h.includes("Схема: по комнатам"), "шапка честно говорит про разные схемы");
  assert.ok(!/Схема: (Классическая|Реле)</.test(h), "ни одна схема не выдаётся за общую");
});

/* ── дефект 2: комната у группы, реле, пробела; посты без комнаты — своя подпись ──────── */

test("комната печатается у группы — одноимённые «Свет» разных комнат различимы", () => {
  const rooms = [{ id: "A", name: "Гостиная" }, { id: "B", name: "Спальня" }];
  const plan = planByRoomsFor([namedPost("a1", "A", "Свет"), namedPost("b1", "B", "Свет")], rooms, "classic");
  const h = html(plan);
  assert.ok(h.includes("Группа «Свет» · Гостиная"), "группа комнаты A с её именем");
  assert.ok(h.includes("Группа «Свет» · Спальня"), "группа комнаты B с её именем");
});

test("комната печатается у реле", () => {
  const rooms = [{ id: "R", name: "Холл", lightingScheme: "relay" }];
  const posts = [namedPost("r1", "R", "Свет"), namedPost("r2", "R", "Свет")];   /* N=2 → реле нужно */
  const h = html(planByRoomsFor(posts, rooms, "classic"));
  assert.ok(/Импульсное реле · группа «Свет» · Холл/.test(h), "строка реле называет комнату");
});

test("комната печатается у пробела одной комнаты", () => {
  const rooms = [{ id: "A", name: "Гостиная" }];
  /* Пост группы «Свет» с потерянной клавишей → пробел KEY_UNKNOWN этой комнаты. Раньше здесь стоял
     пробел «группа не указана», но он исчез (клавиша без имени = выключатель, не пробел). */
  const posts = [{ id: "a1", number: "a1", roomId: "A", mechanismIds: [999], keyGroups: ["Свет"] }];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const h = html(plan);
  assert.ok(h.includes("Гостиная"), "пробел одной комнаты называет её");
  assert.ok(h.includes(LG.GAP_TEXTS[LG.GAPS.KEY_UNKNOWN]), "текст пробела на месте");
});

test("пост без комнаты — своя честная подпись «Без помещения», а не пустая", () => {
  const plan = planByRoomsFor([namedPost("p1", null, "Свет")], [], "classic");
  const h = html(plan);
  assert.ok(h.includes("Группа «Свет» · Без помещения"), "roomless-группа подписана честно");
});

test("склеенный пробел РАЗНЫХ комнат единой комнаты не называет (склейка сохранена)", () => {
  const rooms = [{ id: "A", name: "Гостиная" }, { id: "B", name: "Спальня" }, { id: "C", name: "Кухня" }];
  /* Одна и та же группа «Свет» с потерянной клавишей в трёх комнатах → один пробел KEY_UNKNOWN,
     склеенный по всем трём (раньше это проверялось пробелом «группа не указана», которого больше
     нет — см. resolveGroup). */
  const lost = (id, roomId) => ({ id, number: id, roomId, mechanismIds: [999], keyGroups: ["Свет"] });
  const posts = [lost("a", "A"), lost("b", "B"), lost("c", "C")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const unknown = plan.gaps.filter(g => g.kind === "key-unknown");
  assert.equal(unknown.length, 1, "три комнаты склеены в одну строку");
  assert.equal(unknown[0].roomLabel, null, "у склеенного из трёх комнат пробела единой комнаты нет");
  const h = html(plan);
  assert.ok(h.includes("мест: 3"), "печать: одна строка «мест: 3»");
  /* Проверяем именно САМУ строку пробела (до её закрывающего тега): комнатная подпись у групп
     света рядом законна, а вот у СКЛЕЕННОГО пробела единой комнаты быть не должно. */
  const gapText = LG.GAP_TEXTS[LG.GAPS.KEY_UNKNOWN].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.ok(!new RegExp(gapText + "[^<]*(Гостиная|Спальня|Кухня)").test(h),
    "склеенная строка не приписана ни одной комнате — врать про место нельзя");
});

/* ── дефект 3: порядок групп в документе = порядок state.rooms, «без комнаты» последней ── */

test("документ печатает группы в порядке state.rooms, «Без помещения» последней", () => {
  const rooms = [{ id: "B", name: "Спальня" }, { id: "A", name: "Гостиная" }];   /* порядок B, A */
  const posts = [namedPost("a1", "A", "Свет"), namedPost("x", null, "Свет"), namedPost("b1", "B", "Свет")];
  const h = html(planByRoomsFor(posts, rooms, "classic"));
  const iB = h.indexOf("Спальня"), iA = h.indexOf("Гостиная"), iN = h.indexOf("Без помещения");
  assert.ok(iB >= 0 && iA >= 0 && iN >= 0, "все три партиции напечатаны");
  assert.ok(iB < iA, "Спальня (B) раньше Гостиной (A) — порядок state.rooms, не алфавит");
  assert.ok(iA < iN, "«Без помещения» — последней, как в листе монтажника");
});

/* ── детерминизм документа: перестановка входа не меняет HTML ─────────────────────────── */

test("HTML документа не зависит от порядка постов на входе", () => {
  const rooms = [{ id: "A", name: "Гостиная" }, { id: "B", name: "Спальня", lightingScheme: "relay" }];
  const posts = [namedPost("a1", "A", "Кухня"), namedPost("a2", "A", "Кухня"),
                 namedPost("b1", "B", "Холл"), namedPost("a3", "A", "Зал")];
  const straight = html(planByRoomsFor(posts, rooms, "classic"));
  const shuffled = html(planByRoomsFor([posts[2], posts[0], posts[3], posts[1]], rooms, "classic"));
  assert.equal(straight, shuffled, "тот же документ при любом порядке входа");
});
