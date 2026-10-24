/* К8а, часть 3 (В) — СЕЛЕКТОР «ВАРИАНТ» В ОКНЕ ПОСТА (решение владельца 24.10, п.1 + производные).
   Что владелец увидит: у комнаты с >1 вариантом в окне поста появляется выбор «Вариант отделки»; по
   умолчанию первый (у существующего поста — тот, которому годится его накладка); сменил вариант —
   накладка и механизмы пересобираются под него (как при смене комнаты); у комнаты с одним вариантом
   селектора нет и всё как раньше.

   Уровни:
     В1 чистый   — EPRoomVariantsUi.builderIndex / builderInitialIndex / builderVariantLabel;
     В2 рендер   — renderBuilderVariantSelect: >1 вариант показывает, ≤1 прячет, onChange по выбору;
     В3 связка   — НАСТОЯЩИЙ builderFilterRoom (вырезка postBuilder.js) отдаёт ВЫБРАННЫЙ вариант —
                   значит и накладки (builderRoomFilter), и начинка, и хинты идут от него (§7.1);
     В4 проводка — текст: renderBuilder вешает onChange = «variantIndex + changeBuilderRoom» (смена
                   варианта = смена комнаты), селектор рисуется из renderBuilder.

   МУТАЦИИ (прогнаны руками, см. отчёт): builderIndex без верхнего зажима → В1 краснеет; builderInitialIndex
   без гейта isExisting → В1 краснеет; renderBuilderVariantSelect `<=1`→`<1` → В2 (один вариант) краснеет;
   builderFilterRoom всегда variants[0] → В3 (variantIndex=1) краснеет.
   Запуск: node --test tests/postVariantSelect.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPRoomVariants = require("../js/roomVariants.js");
const EPRoomVariantsUi = require("../js/roomVariantsUi.js");
const EPPostVariant = require("../js/postVariant.js");

/* Комната двух вариантов: немецкий Plana белый (плоские поля) + итальянский Neve Up слоновая кость. */
const ROOM2 = { id: "r2", name: "Гостиная", standard: "DE", collection: "Plana", frameColor: "Белая",
  moreVariants: [{ standard: "IT", collection: "Neve Up", frameColor: "Слоновая кость" }] };
const ROOM1 = { id: "r1", name: "Кухня", standard: "DE", collection: "Plana", frameColor: "Белая" };

/* ============================ В1. ЧИСТЫЙ УРОВЕНЬ ============================ */

test("В1 builderIndex: зажимает индекс в [0, N-1]; одновариантная → всегда 0", () => {
  assert.equal(EPRoomVariantsUi.builderIndex(ROOM2, 1), 1, "валидный индекс 2-го варианта");
  assert.equal(EPRoomVariantsUi.builderIndex(ROOM2, 9), 1, "за верхней границей → последний (мутация «без верхнего зажима» дала бы 9 и краснит здесь)");
  assert.equal(EPRoomVariantsUi.builderIndex(ROOM2, -3), 0, "ниже нуля → 0");
  assert.equal(EPRoomVariantsUi.builderIndex(ROOM1, 7), 0, "одновариантная комната → 0 (прежнее поведение)");
  assert.equal(EPRoomVariantsUi.builderIndex(ROOM2, undefined), 0, "неопределён → 0");
});

test("В1 builderInitialIndex: новый пост → 0; существующий → вариант под его накладку; не подошёл → 0", () => {
  const FR = { id: 1, series: ["X"] };   /* «накладка» поста */
  /* fits(variant, frame): вариант подходит, если его collection совпадает с серией накладки. */
  const fits = (v, f) => v.collection === f.series[0];
  const frameNU = { id: 2, series: ["Neve Up"] };   /* подходит варианту №2 */
  assert.equal(EPRoomVariantsUi.builderInitialIndex(ROOM2, frameNU, false, fits), 0,
    "новый пост (isExisting=false) → 0, даже если накладка подошла бы 2-му; мутация «игнорировать isExisting» дала бы 1 и краснит здесь");
  assert.equal(EPRoomVariantsUi.builderInitialIndex(ROOM2, frameNU, true, fits), 1,
    "существующий пост → первый вариант, которому годится его накладка (Neve Up = вариант №2)");
  assert.equal(EPRoomVariantsUi.builderInitialIndex(ROOM2, FR, true, fits), 0,
    "накладка (серия X) не годится ни одному варианту → 0");
  assert.equal(EPRoomVariantsUi.builderInitialIndex(null, frameNU, true, fits), 0, "комнаты нет → 0");
});

test("В1 builderVariantLabel: «Вариант N: стандарт · серия · цвет»; пусто → «любая отделка»", () => {
  const sl = s => s === "DE" ? "немецкий" : "итальянский";
  assert.equal(EPRoomVariantsUi.builderVariantLabel({ standard: "DE", collection: "Plana", frameColor: "Белая" }, 0, sl),
    "Вариант 1: немецкий · Plana · Белая");
  assert.equal(EPRoomVariantsUi.builderVariantLabel({ collection: "Neve Up" }, 1, sl), "Вариант 2: Neve Up",
    "заданы не все признаки — в подписи только заданные");
  assert.equal(EPRoomVariantsUi.builderVariantLabel({}, 2, sl), "Вариант 3: любая отделка", "пустой вариант → «любая отделка»");
});

/* ============================ В2. РЕНДЕР СЕЛЕКТОРА ============================ */

function renderSel(room, index) {
  const dom = stand.makeDom({ selects: ["builderVariantSelect"] });
  const calls = [];
  EPRoomVariantsUi.renderBuilderVariantSelect({ $: dom.$, room, index, onChange: i => calls.push(i) });
  return { dom, calls };
}

test("★ В2: >1 варианта → поле видно, опции по вариантам, выбран текущий; onChange по выбору", () => {
  const { dom, calls } = renderSel(ROOM2, 1);
  assert.equal(dom.$("builderVariantField").hidden, false, "поле показано");
  const html = dom.$("builderVariantSelect").innerHTML;
  assert.equal((html.match(/<option/g) || []).length, 2, "две опции — по числу вариантов");
  assert.match(html, /value="1" selected/, "выбран текущий вариант (index 1)");
  assert.match(html, /Plana/, "подпись первого варианта");
  assert.match(html, /Neve Up/, "подпись второго варианта");
  /* onChange срабатывает при выборе опции (эмулируем событие select-шима). */
  dom.$("builderVariantSelect").onchange({ target: { value: "0" } });
  assert.deepEqual(calls, [0], "onChange получил выбранный индекс");
});

test("★ В2: ОДИН вариант → селектора НЕТ (поле скрыто, пусто) — поведение как сейчас", () => {
  const { dom } = renderSel(ROOM1, 0);
  assert.equal(dom.$("builderVariantField").hidden, true,
    "при одном варианте поля нет; мутация «<=1»→«<1» показала бы селектор и краснит здесь");
  assert.equal(dom.$("builderVariantSelect").innerHTML, "", "опций нет");
});

test("В2: комнаты нет → селектор скрыт", () => {
  const { dom } = renderSel(null, 0);
  assert.equal(dom.$("builderVariantField").hidden, true);
});

test("★ В2-БЕЗОПАСНОСТЬ: поля варианта из файла проекта экранируются (XSS не исполняется)", () => {
  /* collection варианта приходит из открытого проекта — злонамеренная строка не должна попасть сырым
     тегом в innerHTML. moreVariants даёт второй вариант → селектор показан. */
  const evil = { id: "rx", name: "X", collection: "Plana", frameColor: "Белая",
    moreVariants: [{ collection: '<img src=x onerror="alert(1)">' }] };
  const { dom } = renderSel(evil, 0);
  const html = dom.$("builderVariantSelect").innerHTML;
  assert.doesNotMatch(html, /<img src=x onerror/, "сырой тег в разметку НЕ попал; мутация «убрать esc» краснит здесь");
  assert.match(html, /&lt;img/, "подпись экранирована (&lt;img …)");
});

/* ============================ В6. §7.1: окно и размещение — ОДИН предикат placementFits ============================
   Дефект разведки: окно считало «накладка пропала (frame=null) → ни один вариант не подходит → вариант 1»,
   а размещение по placementFits считает пустой вариант подходящим. Теперь оба зовут EPPostVariant.placementFits. */

/* Критерий варианта как roomCatalogFilter (здесь без валидации по каталогу — для кейса Plana/{} не нужна). */
const critOf = v => ({ standard: v.standard, collection: v.collection, frameMaterial: v.frameMaterial, frameShape: v.frameShape, frameColor: v.frameColor });

test("★ В6: накладка пропала (frame=null), комната [Plana, пустой вариант] — окно и размещение дают ОДИН индекс", () => {
  const room = { id: "rnp", name: "Гостиная", collection: "Plana", frameColor: "Белая", moreVariants: [{}] };
  const fits = (v, f) => EPPostVariant.placementFits(f, critOf(v));
  const placementIdx = EPRoomVariants.fitIndex(EPRoomVariants.list(room), null, fits);
  const windowIdx = EPRoomVariantsUi.builderInitialIndex(room, null, true, fits);
  assert.equal(placementIdx, 1, "размещение: пропавшая накладка подходит пустому варианту (№2)");
  assert.equal(windowIdx, 1, "окно открывается на ТОМ ЖЕ варианте — старый предикат «!!f && …» дал бы 0 (расхождение)");
  assert.equal(windowIdx, placementIdx, "окно и размещение сходятся — один предикат placementFits");
});

test("★ В6: openPostBuilder зовёт ОБЩИЙ EPPostVariant.placementFits, без второй трактовки", () => {
  const src = stand.sourceOf("postBuilder.js");
  assert.match(src, /EPPostVariant\.placementFits\(f,roomCatalogFilter\(v\)\)/,
    "предикат варианта в openPostBuilder — общий placementFits; мутация «вернуть inline !!f && productsForRoom» краснит здесь");
  assert.doesNotMatch(src, /\(v,f\)=>!!f&&EPCatalog\.productsForRoom\(\[f\]/, "старой inline-трактовки предиката в postBuilder нет");
});

/* ============================ В3. СВЯЗКА: builderFilterRoom → ВЫБРАННЫЙ вариант ============================ */

function filterRoom(state) {
  return stand.run("builderFilterRoom", { state, EPRoomVariants, EPRoomVariantsUi })();
}

test("★ В3: builderFilterRoom отдаёт отделку ВЫБРАННОГО варианта (от него и накладки, и начинка, и хинты)", () => {
  const base = { rooms: [ROOM2], posts: [], builder: { roomId: "r2", editingPlacedId: null } };
  const v0 = filterRoom({ ...base, builder: { ...base.builder, variantIndex: 0 } });
  assert.equal(v0.collection, "Plana", "вариант 0 — Plana");
  assert.equal(v0.frameColor, "Белая");
  const v1 = filterRoom({ ...base, builder: { ...base.builder, variantIndex: 1 } });
  assert.equal(v1.collection, "Neve Up",
    "вариант 1 — Neve Up; мутация «всегда variants[0]» вернула бы Plana и краснит здесь");
  assert.equal(v1.frameColor, "Слоновая кость", "и его цвет — отбор идёт от выбранного варианта");
});

test("★ В3: ОДИН вариант — builderFilterRoom отдаёт плоские поля комнаты (байт-в-байт прежнего)", () => {
  const got = filterRoom({ rooms: [ROOM1], posts: [], builder: { roomId: "r1", editingPlacedId: null, variantIndex: 0 } });
  assert.equal(got.collection, "Plana", "коллекция = плоское поле комнаты");
  assert.equal(got.standard, "DE");
  assert.equal(got.frameColor, "Белая");
  /* индекс за границей у одновариантной комнаты всё равно даёт её единственную отделку */
  const clamped = filterRoom({ rooms: [ROOM1], posts: [], builder: { roomId: "r1", editingPlacedId: null, variantIndex: 5 } });
  assert.equal(clamped.collection, "Plana", "индекс зажат → та же единственная отделка");
});

test("В3: комнаты нет (roomId null, не на плане) → null (каталог не сужаем)", () => {
  const got = filterRoom({ rooms: [], posts: [], builder: { roomId: null, editingPlacedId: null, variantIndex: 0 } });
  assert.equal(got, null);
});

/* ============================ В4. ПРОВОДКА: смена варианта = смена комнаты ============================ */

test("★ В4: renderBuilder рисует селектор и вешает onChange = «variantIndex + changeBuilderRoom»", () => {
  const src = stand.sourceOf("postBuilder.js");
  assert.match(src, /EPRoomVariantsUi\.renderBuilderVariantSelect\(/, "renderBuilder зовёт отрисовку селектора варианта");
  // onChange ставит выбранный вариант И прогоняет путь смены комнаты (applyAutoDefaultFrame + renderBuilder внутри)
  assert.match(src, /onChange:i=>\{state\.builder\.variantIndex=i;changeBuilderRoom\(state\.builder\.roomId\)\}/,
    "смена варианта = та же логика, что смена комнаты (changeBuilderRoom)");
  // openPostBuilder инициализирует вариант: новый → 0, существующий → fitIndex по накладке
  assert.match(src, /state\.builder\.variantIndex=EPRoomVariantsUi\.builderInitialIndex\(/, "openPostBuilder задаёт начальный вариант");
});

/* ============================ В5. СБРОС ВАРИАНТА ТОЛЬКО ПРИ СМЕНЕ КОМНАТЫ ============================
   Решение владельца 1 — «по умолчанию первый»: новая комната открывается на варианте 0, а не на номере
   от прежней комнаты. Разведено так: обработчик селектора «Комната» сбрасывает variantIndex=0; обработчик
   селектора «Вариант» ставит выбранный индекс; changeBuilderRoom (общий путь пере-подбора) вариант НЕ
   трогает — поэтому смена варианта его сохраняет, а смена комнаты сбрасывает. */

test("★ В5: changeBuilderRoom НЕ трогает variantIndex (смену варианта он сохраняет)", () => {
  const state = { builder: { roomId: "r2", variantIndex: 1, frameAuto: false }, rooms: [ROOM2], posts: [] };
  const dom = stand.makeDom({ selects: ["postSlotCount"] });
  const ctx = {
    state, $: dom.$,
    applyAutoDefaultFrame: () => null,          /* auto нет → frameSlotCount/syncAutoPostName не зовутся */
    builderCapacity: () => 3, frameSlotCount: () => 3,
    renderPostSlotCountSelect: () => {}, syncAutoPostName: () => {}, renderBuilder: () => {}
  };
  stand.run("changeBuilderRoom", ctx)("r2");
  assert.equal(state.builder.variantIndex, 1,
    "changeBuilderRoom оставил вариант как был — иначе смена варианта (onChange → changeBuilderRoom) сбрасывала бы выбор на 0");
});

test("★ В5: обработчики разведены — комната сбрасывает вариант в 0, вариант сохраняет выбор; changeBuilderRoom нейтрален", () => {
  const src = stand.sourceOf("postBuilder.js");
  assert.match(src, /builderRoomSelect"\)\.onchange=e=>\{state\.builder\.variantIndex=0;changeBuilderRoom\(/,
    "смена КОМНАТЫ сбрасывает вариант в 0 (решение «по умолчанию первый»); мутация «убрать сброс» краснит здесь");
  // changeBuilderRoom в теле НЕ упоминает variantIndex — сброс живёт только в обработчике комнаты
  const body = src.slice(src.indexOf("function changeBuilderRoom("));
  const end = body.indexOf("\nasync function savePostBuilder");
  assert.doesNotMatch(body.slice(0, end), /variantIndex/,
    "тело changeBuilderRoom не трогает variantIndex — иначе сброс сработал бы и при смене варианта");
});
