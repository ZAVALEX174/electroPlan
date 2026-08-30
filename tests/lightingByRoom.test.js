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

/* Обёртка ровно как в app.js.lightingFor: карты пост→комната и комната→схема, дальше planByRooms. */
function planByRoomsFor(posts, rooms, projectScheme) {
  const scheme = projectScheme || "classic";
  const roomById = new Map((rooms || []).map(r => [r.id, r]));
  const roomOfPost = new Map(posts.map(p => [p.id, p.roomId != null ? p.roomId : null]));
  return LBR.planByRooms({
    places: collect(posts),
    projectScheme: scheme,
    projectSchemeLabel: (LG.SCHEMES.find(s => s.id === scheme) || {}).label || "",
    partitionKeyOf: place => { const rid = roomOfPost.get(place.postId); return rid == null ? null : rid; },
    schemeForPartition: key => key == null ? scheme : Room.roomLightingScheme(roomById.get(key), scheme, LG.SCHEMES),
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

test("пустой проект — план по схеме проекта, пробел схемы сохраняется", () => {
  const plan = planByRoomsFor([], [], "bell");   /* bell не поддержана — пробел на пустом проекте */
  assert.equal(plan.scheme, "bell");
  assert.ok(plan.gaps.some(g => g.kind === "scheme-not-implemented"));
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
  /* порядок групп в слитом плане тоже стабилен (сортировка партиций по ключу комнаты) */
  const keysA = planByRoomsFor(posts, rooms, "classic").groups.map(g => g.key + "@" + g.placeCount);
  const keysB = planByRoomsFor([posts[3], posts[1], posts[2], posts[0]], rooms, "classic").groups.map(g => g.key + "@" + g.placeCount);
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

/* ── склейка пробелов подпланов (дефект: planByRooms конкатенировал gaps вместо склейки) ── */

test("одинаковые пробелы из разных комнат склеиваются в одну печатную строку", () => {
  const rooms = [{ id: "A" }, { id: "B" }, { id: "C" }];
  /* по посту БЕЗ группы в каждой из трёх комнат — три одинаковых пробела group-not-set */
  const posts = [post("a", "A", ""), post("b", "B", ""), post("c", "C", "")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  const notSet = plan.gaps.filter(g => g.kind === "group-not-set");
  assert.equal(notSet.length, 1, "один пробел на все три комнаты, а не три");
  assert.equal(notSet[0].places.length, 3, "места всех трёх комнат объединены (мест: 3)");
  const html = LP.buildHtml(plan, {});
  assert.ok(html.includes("мест: 3"), "печать: одна строка с «мест: 3»");
  assert.equal((html.match(/Не указана группа света/g) || []).length, 1, "предупреждение не размножено");
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
  assert.ok(plan.gaps.some(g => g.kind === "group-not-set" && g.places.includes(1)),
    "у дыры честный пробел «группа не назначена» на её индексе");
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
  assert.ok(plan.gaps.some(g => g.kind === "group-not-set"), "битое место — честный пробел");
});

/* ── supported при смешанных схемах (одна bell-комната не должна лгать про весь проект) ── */

test("одна bell-комната не делает supported:false всему проекту", () => {
  const rooms = [{ id: "A", lightingScheme: "classic" }, { id: "B", lightingScheme: "bell" }];
  const posts = [post("a", "A", "Свет"), post("b", "B", "Свет")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  assert.equal(plan.supported, true, "classic-часть посчитана — план поддержан, totals непусты");
  assert.ok(plan.totals.switch >= 1, "механизм classic-комнаты в totals — supported=false лгал бы");
  assert.ok(plan.gaps.some(g => g.kind === "scheme-not-implemented"), "bell-часть не потеряна — её пробел на месте");
});

test("проект целиком из bell-комнат — supported:false и totals пусты (это правда)", () => {
  const rooms = [{ id: "A", lightingScheme: "bell" }, { id: "B", lightingScheme: "bell" }];
  const posts = [post("a", "A", "Свет"), post("b", "B", "Свет")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  assert.equal(plan.supported, false, "ни одна партиция не поддержана");
  assert.equal(Object.keys(plan.totals).reduce((s, k) => s + plan.totals[k], 0), 0,
    "механизмов нет — supported=false не лжёт");
});

/* ── порядок партиций: «без комнаты» идёт первой (ключ partitionNorm сортируется раньше "r:") ── */

test("партиция «без комнаты» печатается раньше комнатных — порядок ключа сохранён", () => {
  const rooms = [{ id: "A" }];
  /* roomless-группа «zzz» и комнатная «aaa»: если бы порядок партиций шёл по имени группы или
     по порядку входа, «aaa» встала бы первой. Первой обязана быть roomless — она сортируется
     раньше любого ключа комнаты ("r:"). */
  const posts = [post("p2", "A", "aaa"), post("p1", null, "zzz")];
  const plan = planByRoomsFor(posts, rooms, "classic");
  assert.equal(plan.groups[0].key, "zzz", "первой идёт группа партиции «без комнаты»");
  assert.equal(plan.groups[1].key, "aaa", "затем — группа комнаты A");
});
