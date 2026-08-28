/* Автотесты слотов конструктора: механизм + группа света клавиши (C8).
   Запуск без зависимостей и без сборщика:  node --test tests/

   ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, — ЧТО ГРУППА НЕ ОТЪЕЗЖАЕТ ОТ СВОЕЙ КЛАВИШИ. Конструктор
   переставляет набор механизмов (упакованный порядок из EPPosts.distributePosts) и фильтрует
   его (EPPosts.fitMechanismIds); параллельный массив «группа по индексу» после любой из этих
   операций указывал бы не на ту клавишу, и расчёт посчитал бы деньги по чужим местам молча.
   Поэтому тесты гоняют НАСТОЯЩИЕ функции EPPosts через переходник токенов. */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/builderSlots.js");
const EPPosts = require("../js/posts.js");
/* Сквозная проверка «фантом после перезаливки прайса» гоняет НАСТОЯЩИЙ сбор мест. */
const EPLightingPlan = require("../js/lightingPlan.js");

/* Каталог-заглушка: два ОДИНАКОВЫХ по id механизма в посте — обычное дело (две клавиши 1М),
   и именно на них ломается любая схема «группа по id». */
const CATALOG = {
  1: { id: 1, code: "20021", name: "Клавиша 1М", moduleSpan: 1 },
  2: { id: 2, code: "20022", name: "Клавиша 2М", moduleSpan: 2 },
  3: { id: 3, code: "20210", name: "Розетка 2М", moduleSpan: 2 },
  9: { id: 9, code: "XX", name: "Чужой", moduleSpan: 1 }
};
const product = id => CATALOG[id];
const mechanismSpan = item => (item && item.moduleSpan) || 0;
const deps = { product, mechanismSpan };
const items = ids => ids.map(id => CATALOG[id]);
/* Клавиша ли механизм, знает КАТАЛОГ приложения (partRole === "key"); модуль спрашивает об этом
   предикатом. В фикстуре клавиши — 1 и 2, розетка — 3. */
const isKey = id => /^Клавиша/.test((CATALOG[id] || {}).name || "");

test("fromPost/toPost: группы едут вместе с механизмами и той же длины", () => {
  const slots = S.fromPost({ mechanismIds: [1, 2], keyGroups: ["Кухня", "Спальня"] });
  assert.deepEqual(slots, [{ id: 1, group: "Кухня" }, { id: 2, group: "Спальня" }]);
  assert.deepEqual(S.toPost(slots), { mechanismIds: [1, 2], keyGroups: ["Кухня", "Спальня"] });
});

test("старый пост без keyGroups открывается с пустыми группами, а не падает", () => {
  const slots = S.fromPost({ mechanismIds: [1, 1] });
  assert.deepEqual(S.toPost(slots).keyGroups, ["", ""]);
  assert.equal(S.hasGroups(slots), false);
});

test("keyGroups отдаётся ВСЕГДА полной длины — иначе правка середины сдвинет соответствие", () => {
  const slots = S.fromPost({ mechanismIds: [1, 1, 1], keyGroups: ["Кухня"] });
  assert.deepEqual(S.toPost(slots).keyGroups, ["Кухня", "", ""]);
});

test("группа — ТОЛЬКО строка: «4.10» не превращается в 4.1 и не сливается с «4.1»", () => {
  /* На планах заказчика номера групп записаны именно так; число 4.10 в JS это 4.1, и две
     разные группы стали бы одной — два выключателя вместо двух переключателей. */
  const slots = S.fromPost({ mechanismIds: [1, 1], keyGroups: ["4.10", "4.1"] });
  assert.deepEqual(S.toPost(slots).keyGroups, ["4.10", "4.1"]);
  assert.notEqual(S.toPost(slots).keyGroups[0], S.toPost(slots).keyGroups[1]);
});

test("ФИЛЬТРАЦИЯ настоящей EPPosts.fitMechanismIds не путает группы местами", () => {
  /* 1М(Кухня) + 2М(Спальня) + 1М(Ванная) в накладку на 3 модуля: третий не влезает и должен
     уйти ЦЕЛИКОМ вместе со своей группой, а уцелевшие — сохранить свои. */
  const slots = S.fromPost({ mechanismIds: [1, 2, 1], keyGroups: ["Кухня", "Спальня", "Ванная"] });
  const tokenDeps = S.tokenDeps(slots, deps);
  const kept = EPPosts.fitMechanismIds(S.tokens(slots), S.allowedTokens(slots, items([1, 2])), 3, tokenDeps);
  const next = S.pick(slots, kept);
  assert.deepEqual(S.toPost(next), { mechanismIds: [1, 2], keyGroups: ["Кухня", "Спальня"] });
});

test("чужой для набора механизм выкидывается вместе со своей группой", () => {
  const slots = S.fromPost({ mechanismIds: [9, 1], keyGroups: ["Чужая", "Кухня"] });
  const kept = EPPosts.fitMechanismIds(S.tokens(slots), S.allowedTokens(slots, items([1, 2])), 3, S.tokenDeps(slots, deps));
  assert.deepEqual(S.toPost(S.pick(slots, kept)), { mechanismIds: [1], keyGroups: ["Кухня"] });
});

test("ПЕРЕСТАНОВКА при упаковке по постам переносит группы, даже когда механизмы одинаковые", () => {
  /* Немецкая накладка 2+2. Набор 1М·2М·1М: полная упаковка (packAll) разводит его так, что
     ДВА ОДИНАКОВЫХ 1М (id 1) оказываются в разных постах. По id их не различить — только по
     позиции, что и делает переходник токенов. */
  const frame = { standard: "DE", slotCount: 4, layoutRows: [[2, 2]] };
  const slots = S.fromPost({ mechanismIds: [1, 3, 1], keyGroups: ["Кухня", "", "Прихожая"] });
  const dist = EPPosts.distributePosts(S.tokens(slots), frame, S.tokenDeps(slots, deps));
  assert.equal(dist.valid, true);
  const packed = dist.posts.reduce((all, p) => all.concat(p.mechanismIds), []);
  const next = S.pick(slots, packed);
  /* Каждая группа осталась на СВОЁМ механизме: сравниваем пары, а не два массива по отдельности. */
  const pairs = next.map(x => `${CATALOG[x.id].code}:${x.group}`);
  assert.equal(pairs.filter(p => p === "20021:Кухня").length, 1);
  assert.equal(pairs.filter(p => p === "20021:Прихожая").length, 1);
  assert.equal(pairs.filter(p => p === "20210:").length, 1);
  assert.equal(next.length, 3);
});

test("замена клавиши НА КЛАВИШУ сохраняет группу слота, добавление даёт пустую", () => {
  const slots = S.fromPost({ mechanismIds: [1], keyGroups: ["Кухня"] });
  assert.deepEqual(S.toPost(S.replaceAt(slots, 0, 2, isKey)), { mechanismIds: [2], keyGroups: ["Кухня"] });
  assert.deepEqual(S.toPost(S.add(slots, 2)), { mechanismIds: [1, 2], keyGroups: ["Кухня", ""] });
});

test("замена клавиши на НЕ-клавишу уносит группу — она не переживает место управления", () => {
  /* Розетка местом управления не является, и поля группы у неё в интерфейсе нет: оставшаяся
     группа висела бы на позиции, где клавиши больше нет, — невидимо для человека и с двумя
     последствиями (см. комментарий у replaceAt): фантомное место, когда артикул пропадёт из
     прайса, и молчаливое воскрешение группы при обратной замене. */
  const slots = S.fromPost({ mechanismIds: [1, 1], keyGroups: ["Кухня", "Холл"] });
  assert.deepEqual(S.toPost(S.replaceAt(slots, 0, 3, isKey)),
    { mechanismIds: [3, 1], keyGroups: ["", "Холл"] });
  assert.deepEqual(S.toPost(slots).keyGroups, ["Кухня", "Холл"], "исходный массив не тронут");
});

test("замена на НЕ-клавишу и обратно не воскрешает старую группу", () => {
  const slots = S.fromPost({ mechanismIds: [1], keyGroups: ["Кухня"] });
  const back = S.replaceAt(S.replaceAt(slots, 0, 3, isKey), 0, 1, isKey);
  assert.deepEqual(S.toPost(back), { mechanismIds: [1], keyGroups: [""] });
});

test("без предиката replaceAt ведёт себя как прежде — модуль о каталоге не знает", () => {
  /* Старый контракт: приложение обязано передавать предикат, а чистый модуль сам решать,
     что такое клавиша, не может и не должен. */
  const slots = S.fromPost({ mechanismIds: [1], keyGroups: ["Кухня"] });
  assert.deepEqual(S.toPost(S.replaceAt(slots, 0, 3)), { mechanismIds: [3], keyGroups: ["Кухня"] });
});

/* ---- МИГРАЦИЯ ПРИ ЧТЕНИИ: осиротевшая группа не переживает открытие поста ----------------

   Защита у replaceAt работала только ВПЕРЁД. Группа, записанная на не-клавишу ДО неё, спокойно
   переживала полный цикл «открыть пост в конструкторе → Сохранить»: fromPost читал keyGroups как
   есть, toPost писал обратно. В проектах, сохранённых раньше, фантомные места так и лежали — и
   оживали при первой перезаливке прайса. Значит чистка обязана происходить и НА ЧТЕНИИ.

   Предикат приложения ТРЁХЗНАЧНЫЙ: клавиша / не клавиша / товара в каталоге нет. Третий ответ не
   равен второму — см. keepsGroup в модуле. */
const keyKind = id => (CATALOG[id] ? /^Клавиша/.test(CATALOG[id].name) : null);

test("СТАРЫЙ ПРОЕКТ: группа на не-клавише снимается уже при ЧТЕНИИ поста", () => {
  /* Так выглядит пост, сохранённый до правила: розетка (id 3) с группой «Прихожая». */
  const old = { mechanismIds: [1, 3], keyGroups: ["Прихожая", "Прихожая"] };
  assert.deepEqual(S.fromPost(old, keyKind), [{ id: 1, group: "Прихожая" }, { id: 3, group: "" }]);
});

test("ЦИКЛ «открыть → Сохранить» больше не возвращает фантомную группу в проект", () => {
  const old = { mechanismIds: [1, 3, 2], keyGroups: ["Прихожая", "Прихожая", "Кухня"] };
  const saved = S.toPost(S.fromPost(old, keyKind));
  assert.deepEqual(saved.keyGroups, ["Прихожая", "", "Кухня"]);
  /* и повторный цикл ничего больше не меняет — миграция идемпотентна */
  assert.deepEqual(S.toPost(S.fromPost(saved, keyKind)).keyGroups, saved.keyGroups);
});

test("ТОВАРА НЕТ В КАТАЛОГЕ — группу НЕ снимаем: это потерянная клавиша, а не мусор", () => {
  /* Артикул выпал из прайса. Снять группу значило бы стереть настоящее место управления: N
     группы упал бы, и нетронутые посты получили бы другие механизмы. Расчёт обязан показать
     здесь честный пробел (EPLightingPlan.collect, lostKey), а для этого группа должна дожить. */
  const post = { mechanismIds: [1, 404], keyGroups: ["Кухня", "Кухня"] };
  assert.deepEqual(S.toPost(S.fromPost(post, keyKind)).keyGroups, ["Кухня", "Кухня"]);
});

test("без предиката fromPost читает пост как прежде — модуль о каталоге не знает", () => {
  const old = { mechanismIds: [1, 3], keyGroups: ["Прихожая", "Прихожая"] };
  assert.deepEqual(S.toPost(S.fromPost(old)).keyGroups, ["Прихожая", "Прихожая"]);
});

test("ЧТЕНИЕ И ЗАМЕНА СУДЯТ ОДНИМ ПРАВИЛОМ — иначе одно снимало бы то, что вернуло другое", () => {
  const old = { mechanismIds: [3], keyGroups: ["Прихожая"] };
  assert.deepEqual(S.fromPost(old, keyKind), S.replaceAt(S.fromPost(old), 0, 3, keyKind));
  /* и «товара нет» обе трактуют одинаково — группа остаётся */
  const lost = { mechanismIds: [404], keyGroups: ["Кухня"] };
  assert.deepEqual(S.fromPost(lost, keyKind), S.replaceAt(S.fromPost(lost), 0, 404, keyKind));
});

test("ФАНТОМНОЕ МЕСТО НЕ ОЖИВАЕТ ПОСЛЕ ПЕРЕЗАЛИВКИ ПРАЙСА — сквозная проверка с расчётом", () => {
  /* Тот самый сценарий приёмки. Пост: клавиша (1) + розетка (3), у обеих группа «Прихожая».
     Завтра артикул розетки из прайса пропадает — каталог её больше не знает. */
  const afterPriceReload = id => (id === 3 ? null : CATALOG[id]);
  const places = post => EPLightingPlan.collect([Object.assign({ id: "p1", number: 1 }, post)],
    { product: afterPriceReload, seriesOf: () => ["Neve Up"], isKey: item => !!item && /^Клавиша/.test(item.name) });

  const stale = { mechanismIds: [1, 3], keyGroups: ["Прихожая", "Прихожая"] };
  assert.equal(places(stale).length, 2, "непочиненные данные дают ДВА места вместо одного");
  assert.equal(places(stale)[1].keyUnknown, true, "и второе из них — фантом на розетке");

  const migrated = S.toPost(S.fromPost(stale, keyKind));
  assert.equal(places(migrated).length, 1, "после миграции место ровно одно — настоящее");
});

test("удаление слота уносит только его группу", () => {
  const slots = S.fromPost({ mechanismIds: [1, 1, 1], keyGroups: ["А", "Б", "В"] });
  assert.deepEqual(S.toPost(S.removeAt(slots, 1)), { mechanismIds: [1, 1], keyGroups: ["А", "В"] });
});

test("setGroup меняет ровно один слот и не мутирует исходный массив", () => {
  const slots = S.fromPost({ mechanismIds: [1, 1], keyGroups: ["А", "Б"] });
  const next = S.setGroup(slots, 1, "В");
  assert.deepEqual(S.toPost(next).keyGroups, ["А", "В"]);
  assert.deepEqual(S.toPost(slots).keyGroups, ["А", "Б"], "исходный массив не тронут");
  assert.equal(S.hasGroups(next), true);
});

test("fitMechanismIdsPreserving через токены: лишний уходит с конца, выбранный остаётся с группой", () => {
  /* Пользователь поставил 2М во ВТОРОЙ слот трёхмодульной накладки — с конца выкидывается
     третий, а второй (только что выбранный) остаётся вместе со своей группой. */
  const slots = S.fromPost({ mechanismIds: [1, 3, 1], keyGroups: ["А", "Б", "В"] });
  const kept = EPPosts.fitMechanismIdsPreserving(S.tokens(slots),
    S.allowedTokens(slots, items([1, 2, 3])), 3, 1, S.tokenDeps(slots, deps));
  assert.deepEqual(S.toPost(S.pick(slots, kept)), { mechanismIds: [1, 3], keyGroups: ["А", "Б"] });
});

test("pick пропускает токен вне диапазона, а не роняет слоты в undefined", () => {
  const slots = S.fromPost({ mechanismIds: [1], keyGroups: ["А"] });
  assert.deepEqual(S.toPost(S.pick(slots, [0, 7, -1])), { mechanismIds: [1], keyGroups: ["А"] });
});

/* ---- Группа света — свойство ПОСТА НА ПЛАНЕ, а не шаблона ------------------------------- */

test("clearGroups снимает группы, оставляя механизмы и их порядок", () => {
  /* Так конструктор открывает ШАБЛОН: механизмы шаблона нужны целиком, группы — нет.
     Шаблон, сохранённый до этого правила, приносит свои группы, и они обязаны сняться,
     иначе уедут обратно в шаблон при следующем сохранении. */
  const slots = S.fromPost({ mechanismIds: [1, 2, 1], keyGroups: ["Кухня", "Кухня", "Холл"] });
  const cleared = S.clearGroups(slots);
  assert.deepEqual(S.toPost(cleared), { mechanismIds: [1, 2, 1], keyGroups: ["", "", ""] });
  assert.equal(S.hasGroups(cleared), false);
  assert.deepEqual(S.toPost(slots).keyGroups, ["Кухня", "Кухня", "Холл"], "исходный массив не тронут");
});

test("clearGroups держит длину keyGroups равной длине mechanismIds", () => {
  /* Массив короче развалил бы соответствие по индексу при первой правке середины поста —
     то же требование, что у toPost. */
  const cleared = S.clearGroups(S.fromPost({ mechanismIds: [1, 1, 1] }));
  const fields = S.toPost(cleared);
  assert.equal(fields.keyGroups.length, fields.mechanismIds.length);
});

/* ---- Пометка «Заменить» едет через перестановку слотов ---------------------------------- */

test("reindex: номер помеченного слота едет через перестановку, а не остаётся прежним", () => {
  /* tokenList — ответ EPPosts: старые индексы в новом порядке. Слот 2 после упаковки стоит
     первым, значит и пометка «Заменить» обязана указывать на 0. */
  assert.equal(S.reindex([2, 0, 1], 2), 0);
  assert.equal(S.reindex([2, 0, 1], 0), 1);
  assert.equal(S.reindex([2, 0, 1], 1), 2);
});

test("reindex: выброшенный слот даёт -1 (цель сбрасывается, а не переезжает на чужой)", () => {
  /* Ровно тот случай, что ломался в конструкторе: помечен двухмодульный механизм (индекс 1),
     после уменьшения числа модулей он не влезает и отсеивается, а на его номер встаёт
     клавиша из бывшего индекса 2. Без сброса следующая карточка заменила бы ЧУЖОЙ модуль. */
  const slots = S.fromPost({ mechanismIds: [1, 2, 1], keyGroups: ["А", "Б", "В"] });
  const kept = EPPosts.fitMechanismIds(S.tokens(slots), S.allowedTokens(slots, items([1, 2])), 2, S.tokenDeps(slots, deps));
  assert.deepEqual(kept, [0, 2], "двухмодульный отсеян, обе клавиши влезли");
  assert.deepEqual(S.toPost(S.pick(slots, kept)).keyGroups, ["А", "В"]);
  assert.equal(S.reindex(kept, 1), -1, "помеченного слота больше нет");
  assert.equal(S.reindex(kept, 2), 1, "бывший третий слот стал вторым");
});

test("reindex: не-число вместо номера даёт -1, а не случайную позицию", () => {
  ["", null, undefined, {}, [], "первый", NaN].forEach(bad =>
    assert.equal(S.reindex([0, 1], bad), -1, `«${String(bad)}» — не номер слота`));
});

/* ---- Подпись набора: несклеиваемая ------------------------------------------------------ */

test("signature различает наборы, которые склеенный ключ считал одинаковыми", () => {
  /* Имя группы вводит человек, и разделители в нём законны. Подпись через «id:группа,…»
     объявила бы эти два набора одинаковыми, и правка потерялась бы при закрытии окна без
     единого предупреждения. */
  const a = S.fromPost({ mechanismIds: [1, 1], keyGroups: ["Кухня,Спальня", ""] });
  const b = S.fromPost({ mechanismIds: [1, 1], keyGroups: ["Кухня", "Спальня"] });
  assert.notEqual(S.signature(a), S.signature(b));
  const c = S.fromPost({ mechanismIds: [1], keyGroups: ['Кухня"1'] });
  const d = S.fromPost({ mechanismIds: [1], keyGroups: ["Кухня\\\"1"] });
  assert.notEqual(S.signature(c), S.signature(d), "кавычка в имени не ломает границы полей");
});

test("signature одинакова у одинаковых наборов и меняется от правки группы", () => {
  const slots = S.fromPost({ mechanismIds: [1, 2], keyGroups: ["Кухня", ""] });
  assert.equal(S.signature(slots), S.signature(S.fromPost({ mechanismIds: [1, 2], keyGroups: ["Кухня", ""] })));
  assert.notEqual(S.signature(slots), S.signature(S.setGroup(slots, 1, "Холл")));
  assert.notEqual(S.signature(slots), S.signature(S.add(slots, 1)));
});
