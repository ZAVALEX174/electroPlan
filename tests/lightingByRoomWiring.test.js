/* Структурный регресс-тест ПРОВОДКИ расчёта групп света ПО КОМНАТАМ в js/app.js.

   ЗАЧЕМ ТЕСТ ПО ТЕКСТУ, А НЕ ПО ПОВЕДЕНИЮ. app.js — монолит-оркестратор (DOM, state), он не
   грузится ни одним тестом и в node не исполняется. Чистую логику (раскрой по комнатам, слияние,
   подпись кэша) проверяет tests/lightingByRoom.test.js на настоящем модуле — НО он проверяет
   МОДУЛЬ, а не то, что app.js действительно ходит в этот модуль. Тестовый хелпер planByRoomsFor
   там — вторая копия проводки из app.js: ошибка в оригинале (lightingFor перестал звать
   planByRooms, projectLighting перестал подписывать кэш через cacheSignature — вернулись к
   «одной схеме на проект») осталась бы зелёной, потому что копия считает правильно.
   Этот тест закрепляет ОРИГИНАЛ по исходному тексту. Он НЕ подмена поведенческому — он ловит
   ровно разрыв провода, который поведенческий увидеть не может. Регэкспы с \s* — устойчивость к
   форматированию, а не сравнение строк целиком.

   Мутационная проверка (в отчёте): удаление вызова EPLightingByRoom.planByRooms из lightingFor
   роняет первый структурный assert; удаление EPLightingByRoom.cacheSignature из projectLighting —
   второй. Тела берём через общий хелпер stripComments (комментарии вырезаны), поэтому и мутация
   «закомментировать вызов, не удаляя строку» краснеет — а не только физическое удаление. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./helpers/stripComments.js");
const stand = require("./helpers/appStand.js");
const LP = require("../js/lightingPlan.js");
const LG = require("../js/lightingGroups.js");
const Room = require("../js/room.js");
const LBR = require("../js/lightingByRoom.js");
const Pool = require("../js/catalogPool.js");
const MechColor = require("../js/mechColor.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

/* Тело функции от её объявления до объявления следующей — чтобы вызовы искать в нужной функции,
   а не где-то ещё в файле. Границей служит начало любой следующей `function имя(`. */
function bodyOf(name) {
  const start = SRC.indexOf("function " + name + "(");
  assert.ok(start >= 0, "в app.js должна быть функция " + name);
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\nfunction\s+\w+\s*\(/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test("lightingFor() считает через EPLightingByRoom.planByRooms — не старым «одной схемой на проект»", () => {
  const body = stripComments(bodyOf("lightingFor"));
  assert.ok(
    /EPLightingByRoom\s*\.\s*planByRooms\s*\(/.test(body),
    "lightingFor обязан вызывать EPLightingByRoom.planByRooms (раскрой по комнатам)"
  );
  /* Раскрой немыслим без карт «пост→комната» и «комната→схема»: их отсутствие означало бы возврат
     к единому расчёту. Проверяем, что обе функции-зависимости уходят в вызов. */
  assert.ok(/partitionKeyOf\s*:/.test(body), "в вызов передаётся partitionKeyOf (место → комната)");
  assert.ok(/schemeForPartition\s*:/.test(body), "в вызов передаётся schemeForPartition (комната → схема)");
  /* Проходная (crossNo) сквозная по проекту — её места в одну партицию, не по комнатам (В21). Без
     crossKeyOf в вызове расчёт вернулся бы к покомнатному разрезанию номеров — два «пары нет» вместо
     пары; без crossMixedGap пропало бы предупреждение о разных схемах комнат проходной. */
  assert.ok(/crossKeyOf\s*:/.test(body), "в вызов передаётся crossKeyOf (клавиша проходной → её сквозной ключ)");
  assert.ok(/crossMixedGap\s*:/.test(body), "в вызов передаётся crossMixedGap (предупреждение о разных схемах комнат)");
});

test("projectLighting() подписывает кэш через EPLightingByRoom.cacheSignature — с комнатами", () => {
  const body = stripComments(bodyOf("projectLighting"));
  assert.ok(
    /EPLightingByRoom\s*\.\s*cacheSignature\s*\(/.test(body),
    "projectLighting обязан собирать подпись кэша через EPLightingByRoom.cacheSignature"
  );
  /* Подпись без комнат не сбрасывала бы кэш при смене схемы комнаты или переезде поста —
     ровно тот дефект, ради которого cacheSignature появился. Комнаты обязаны попасть в подпись. */
  assert.ok(/rooms\s*:/.test(body), "в подпись кэша передаются комнаты проекта (rooms)");
});

/* ── ПОВЕДЕНЧЕСКИ: настоящая app.js lightingFor действительно СВЯЗЫВАЕТ проходную и предупреждает ──
   Структурные тесты выше сторожат ТЕКСТ (строки crossKeyOf:/crossMixedGap: в вызове), но не СМЫСЛ:
   независимая проверка нашла, что подмена `crossKeyOf:place=>""` и `crossMixedGap:null` проходит —
   текст на месте, а проходная рассыпается на «пары нет» и даёт в смете лишние 263,24 €. Поэтому ту
   же проводку закрываем ПОВЕДЕНЧЕСКИ: вырезаем НАСТОЯЩИЙ исходник lightingFor из app.js и исполняем
   его в vm на тех же вынесенных модулях (EPLightingByRoom/EPLightingGroups/…), что и браузер.
   Мутационно: `crossKeyOf:place=>""` → первый тест краснеет (места разъезжаются по комнатам, N=1,
   роли не changeover, и появляется cross-single-place); `crossMixedGap:null` → второй краснеет
   (предупреждение cross-mixed-schemes не доходит до плана). */

/* Каталог-заглушка той же формы, что в lightingByRoom.test.js: клавиша + голые механизмы ролей. */
const KEY = { id: 1, code: "20021", name: "Клавиша 1 модуль", price: 5.08, partRole: "key", series: ["Eikon Evo"] };
const SWITCH = { id: 10, code: "20001.0", name: "Выключатель", partRole: "bare_mechanism", controlRole: "switch", series: ["Eikon Evo"] };
const CHANGEOVER = { id: 11, code: "20005.0", name: "Переключатель", partRole: "bare_mechanism", controlRole: "changeover", series: ["Eikon Evo"] };
const INVERTER = { id: 12, code: "20013.0", name: "Инвертор", partRole: "bare_mechanism", controlRole: "inverter", series: ["Eikon Evo"] };
const BUTTON = { id: 13, code: "20008.0", name: "Кнопка", partRole: "bare_mechanism", controlRole: "button", series: ["Eikon Evo"] };
const MECHS = [SWITCH, CHANGEOVER, INVERTER, BUTTON];
const ALL = [KEY].concat(MECHS);

/* Пост одной клавиши с номером проходной (crossNo) — вход lightingFor; форма как в builderSlots.toPost. */
const postCross = (id, roomId, crossNo) => ({ id, number: id, roomId,
  mechanismIds: [KEY.id], keyGroups: [""], keyCrossNumbers: [String(crossNo)] });

/* Исполняет НАСТОЯЩУЮ app.js lightingFor на заглушечном каталоге и заданных комнатах/схеме проекта.
   Контекст vm — ровно те имена, что lightingFor берёт из лексики app.js; логику НЕ переписываем,
   только подставляем зависимости приложения (как и сам оркестратор). */
function lightingForOn(posts, rooms, projectScheme) {
  const ctx = {
    EPLightingPlan: LP, EPLightingGroups: LG, EPRoom: Room, EPLightingByRoom: LBR, EPCatalogPool: Pool,
    EPMechColor: MechColor, EPCatalog: { facingColorKey: () => "" },
    product: id => ALL.find(p => p.id === Number(id)) || null,
    productSeries: item => (item && item.series) || [],
    controlPlaceKind: item => (item && item.partRole === "key" ? "key" : null),
    byKind: kind => (kind === "mechanism" ? MECHS : []),
    byKindOff: () => [],
    mechanismSpan: () => 1,
    lightingScheme: () => projectScheme,
    state: { rooms, posts }
  };
  const lightingFor = stand.run("lightingFor", ctx);
  return lightingFor(posts);
}

const roleAt = (light, postId) => {
  const p = (light.plan.places || []).find(pl => pl && String(pl.postId) === String(postId));
  return p ? p.role : null;
};
const hasGap = (light, kind) => (light.plan.gaps || []).some(g => g.kind === kind);

test("lightingFor: один номер проходной в РАЗНЫХ комнатах связывает места (не «пары нет»)", () => {
  /* Обе комнаты одной схемы (classic) → проходная из двух мест = два переключателя, без «пары нет».
     Подмена crossKeyOf на пустую строку разрежет номер по комнатам: в каждой по одному месту —
     cross-single-place, и роль перестанет быть changeover. */
  const rooms = [{ id: "K", name: "Коридор", lightingScheme: "classic" },
                 { id: "S", name: "Спальня", lightingScheme: "classic" }];
  const light = lightingForOn([postCross("p1", "K", "7"), postCross("p2", "S", "7")], rooms, "classic");
  assert.equal(roleAt(light, "p1"), "changeover", "коридор — переключатель проходной");
  assert.equal(roleAt(light, "p2"), "changeover", "спальня — переключатель проходной");
  assert.ok(!hasGap(light, LG.GAPS.CROSS_LONELY), "проходная связана — ни одной «пары нет»");
});

test("lightingFor: проходная через комнаты с РАЗНЫМИ схемами даёт предупреждение cross-mixed-schemes", () => {
  /* Комнаты разных схем (classic/relay) → считаем по схеме проекта и предупреждаем. Подмена
     crossMixedGap на null текст провода не трогает, но предупреждение до плана не доходит. */
  const rooms = [{ id: "K", name: "Коридор", lightingScheme: "classic" },
                 { id: "S", name: "Спальня", lightingScheme: "relay" }];
  const light = lightingForOn([postCross("p1", "K", "7"), postCross("p2", "S", "7")], rooms, "classic");
  assert.ok(hasGap(light, LG.GAPS.CROSS_MIXED_SCHEMES), "предупреждение о разных схемах комнат проходной");
  assert.ok(!hasGap(light, LG.GAPS.CROSS_LONELY), "это по-прежнему связанная проходная, а не «пары нет»");
});
