/* ПОВЕДЕНЧЕСКИЙ регресс E13 (РАУНД-5, находка №1): правило миграции ОСИРОТЕВШИХ ГРУПП СВЕТА
   (EPBuilderSlots.keepsGroup) приложение включает, передавая предикат keySlotKind в EPBuilderSlots.
   Мест вызова с этим предикатом ЧЕТЫРЕ (js/app.js), а под поведенческим тестом до сих пор было ОДНО —
   openPostBuilder (open-17/18). Три остальных места держались текстом *Wiring-теста, но смена смысла
   там не краснила: снять аргумент keySlotKind = молча вернуть старое, дефектное поведение (группа
   переживает потерю места управления → при перезаливке прайса оживает фантомным местом и уводит
   ЧУЖИЕ посты на другие механизмы, 25.79 € → 42.33 €).

   Покрываем ПОВЕДЕНЧЕСКИ, исполняя НАСТОЯЩИЙ текст функций app.js в vm (общий стенд appStand.js), а
   не рукописной копией: копия предиката в этом проекте уже дважды давала ложно-зелёный тест. keySlotKind
   ТРЁХЗНАЧНЫЙ: true — клавиша (группа остаётся), false — товар в каталоге есть и клавишей не является
   (группа снимается), null — товара в каталоге НЕТ (данные заказчика могли уехать — группа остаётся).

   ⚠️ partRole в СЫРОМ каталоге НЕТ (его дописывает DataService из номенклатуры уже в рантайме,
   js/data.js), а стенд грузит сырой catalog-vimar.js. Поэтому клавишу (200274) размечаем сами —
   так же, как это делает сборка, — чтобы был доступен ответ true; 200048 остаётся не-клавишей (false),
   а 999999 в каталоге нет вовсе (null). Это те же три исхода, что и в openPostBuilderCollectionWiring.

   ЧТО ЗАФИКСИРОВАНО (по одному месту вызова на тест) и МУТАЦИИ, которые краснит каждый:
     E13-mig-1  dropOrphanKeyGroups (миграция при ЧТЕНИИ проекта) на посте из постановки находки:
                fromPost(po,keySlotKind) → fromPost(po) даёт cleaned=0 и keyGroups без изменений — КРАСНЕЕТ.
     E13-mig-2  сам ВЫЗОВ dropOrphanKeyGroups(state.posts) в restoreProject:
                вызов → «;» оставляет старые данные нечищеными при загрузке проекта — КРАСНЕЕТ.
     E13-mig-3  replaceAt (защита при ЗАМЕНЕ клавиши другим товаром) через pickBuilderProduct:
                replaceAt(...,keySlotKind) → replaceAt(...) сохраняет группу на не-клавише — КРАСНЕЕТ.
     E13-mig-4  buildPostSheet: НЕ покрывается — мутация ЭКВИВАЛЕНТНА (см. комментарий у теста).
   Запуск: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const stand = require("./helpers/appStand.js");

const EPBuilderSlots = require("../js/builderSlots.js");
const EPPosts = require("../js/posts.js");
const EPCatalog = require("../js/catalog.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const rawProduct = id => PRODUCTS.find(p => Number(p.id) === Number(id));

/* Артикулы из постановки находки (проверены разведкой каталога):
   200274 «Клавиша на 3 модуля …» — клавиша (в сыром каталоге partRole нет → размечаем сами);
   200048 «2 кнопки Bluetooth» — механизм, но НЕ клавиша (в каталоге есть, partRole ≠ key);
   999999 — артикул, которого в каталоге НЕТ (данные заказчика уехали). */
const KEY_ID = 200274, NONKEY_ID = 200048, MISSING_ID = 999999;
assert.ok(rawProduct(KEY_ID), "разведка: 200274 есть в каталоге");
assert.ok(rawProduct(NONKEY_ID), "разведка: 200048 есть в каталоге");
assert.ok(!rawProduct(MISSING_ID), "разведка: 999999 в каталоге НЕТ — ветка null предиката");

/* product-шим приложения: клавише (200274) дописываем partRole="key", как это делает сборка из
   номенклатуры (в сыром catalog-vimar.js этого поля нет). Остальные товары — как в каталоге. */
const product = id => {
  const p = rawProduct(id);
  return p && Number(id) === KEY_ID ? Object.assign({}, p, { partRole: "key" }) : p;
};

/* НАСТОЯЩИЙ keySlotKind (top-level const-стрелка app.js) для тестов, где место вызова НЕ исполняется
   целиком (buildPostSheet-эквивалентность). Там, где место вызова обязано быть настоящим
   (dropOrphanKeyGroups, restoreProject, pickBuilderProduct), keySlotKind вырезается ВМЕСТЕ с ними
   через runNamed и делит их лексический контекст. Исходный текст, а не копия. */
const keySlotKind = vm.runInNewContext(
  stand.constSource("isKeyProduct") + "\n" + stand.constSource("keySlotKind") + "\n;keySlotKind;",
  { product });
assert.equal(keySlotKind(KEY_ID), true, "разведка предиката: 200274 (размечен) — клавиша");
assert.equal(keySlotKind(NONKEY_ID), false, "разведка предиката: 200048 — товар в каталоге, не клавиша");
assert.equal(keySlotKind(MISSING_ID), null, "разведка предиката: 999999 — товара нет → null");

/* ─────────────────────────────────────────────────────────────────────────────────────────
   E13-mig-1: МИГРАЦИЯ ПРИ ЧТЕНИИ ПРОЕКТА — dropOrphanKeyGroups (js/app.js). Исполняем НАСТОЯЩУЮ
   функцию на посте ровно из постановки находки: клавиша с «Кухня» + не-клавиша со «Спальня» +
   пропавший артикул с «Гараж». Обе ветки предиката проверяются одним постом:
     • не-клавиша (false) → «Спальня» СНИМАЕТСЯ;
     • пропавший из каталога (null) → «Гараж» НЕ снимается (потерянная клавиша — честный пробел). */
test("E13-mig-1: dropOrphanKeyGroups снимает группу с не-клавиши и НЕ трогает пропавший из каталога товар", () => {
  const dropOrphanKeyGroups = stand.runNamed(
    ["isKeyProduct", "keySlotKind", "dropOrphanKeyGroups"],
    { product, EPBuilderSlots, console: { info() {} } });
  const post = { mechanismIds: [KEY_ID, NONKEY_ID, MISSING_ID], keyGroups: ["Кухня", "Спальня", "Гараж"] };
  const cleaned = dropOrphanKeyGroups([post]);
  assert.deepEqual(post.keyGroups, ["Кухня", "", "Гараж"],
    "миграция при чтении: «Спальня» снята с не-клавиши (false), «Кухня» осталась на клавише (true), «Гараж» сохранён на пропавшем товаре (null)");
  assert.equal(cleaned, 1,
    "ровно одна позиция вычищена — не-клавиша; без предиката (fromPost без keySlotKind) было бы 0 и группы остались бы все");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────
   E13-mig-2: сам ВЫЗОВ dropOrphanKeyGroups(state.posts) в restoreProject. mig-1 держит саму
   функцию, но НЕ её вызов при загрузке — а именно ради загрузочной миграции всё и писалось
   (комментарий app.js: чинить «когда человек случайно откроет пост» значит не чинить вовсе).
   Исполняем НАСТОЯЩИЙ restoreProject на минимальном проекте (без terms/plan/docHeader, чтобы не
   тянуть весь рендер): проект несёт осиротевшую группу на не-клавише — после загрузки она обязана
   быть снята. Мутация «вызов → ;» оставит группу нечищеной. */
test("E13-mig-2: restoreProject чистит осиротевшие группы загружаемого проекта (вызов dropOrphanKeyGroups)", async () => {
  const project = { posts: [{ mechanismIds: [KEY_ID, NONKEY_ID], keyGroups: ["Кухня", "Спальня"] }] };
  const state = {};
  const restoreProject = stand.runNamed(
    ["isKeyProduct", "keySlotKind", "dropOrphanKeyGroups", "restoreProject"],
    {
      ProjectStore: { load: () => project },
      state, EPPosts, EPBuilderSlots, product,
      EPConfig: { gridSteps: [10], gridDefault: 10 },
      EPOfferOptions: { normalize: () => ({}) },
      EP_DATA: { settings: {} },
      $: stand.makeDom().$,
      fillDocHeaderInputs() {}, syncOfferOptions() {}, markCanvasUsed() {},
      console: { info() {} }
    });
  const restored = await restoreProject();
  assert.ok(restored, "минимальный проект загрузился");
  assert.deepEqual(state.posts[0].keyGroups, ["Кухня", ""],
    "при ЗАГРУЗКЕ проекта осиротевшая «Спальня» снята с не-клавиши; удаление вызова dropOrphanKeyGroups оставило бы её на месте");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────
   E13-mig-3: защита при ЗАМЕНЕ клавиши другим товаром — replaceAt через НАСТОЯЩИЙ pickBuilderProduct
   (js/app.js). Человек в конструкторе меняет клавишу с группой «Кухня» на не-клавишу (2 кнопки
   Bluetooth): группе стоять не на чем, поля у неё в интерфейсе нет — replaceAt обязан снять её тут
   же, иначе она остаётся висеть невидимо (тот же дефект фантомного места). Исполняем pickBuilderProduct
   целиком: он зовёт replaceAt(...,keySlotKind), затем fit/pick — итоговый слот сохраняется, и его
   .group наблюдаем. Постороннее для этой связи (ёмкость, keepMechs, перерисовка) — стабы; сама
   replaceAt и её предикат — настоящие. Мутация «replaceAt без keySlotKind» оставит группу «Кухня». */
test("E13-mig-3: pickBuilderProduct снимает группу при замене клавиши на не-клавишу (replaceAt+keySlotKind)", () => {
  const state = {
    builder: {
      target: { mode: "replace", index: 0 },
      slots: [EPBuilderSlots.slot(KEY_ID, "Кухня")]
    }
  };
  const pickBuilderProduct = stand.runNamed(
    ["isKeyProduct", "keySlotKind", "pickBuilderProduct"],
    {
      state, EPBuilderSlots, EPPosts, product,
      mechanismSpan: EPCatalog.mechanismSpan,
      // ёмкость — стаб (её источник проверяют другие тесты); здесь важна только замена и её предикат
      builderCapacity: () => 4,
      // keepMechs = набор совместимых механизмов: без него заменённый слот выпал бы из состава и .group нечего было бы читать
      builderCtx: { keepMechs: [{ id: NONKEY_ID }] },
      renderBuilder() {}
    });
  pickBuilderProduct(NONKEY_ID);
  assert.equal(state.builder.slots.length, 1, "заменённый слот остаётся в составе — его .group и проверяем");
  assert.equal(state.builder.slots[0].id, NONKEY_ID, "в слоте теперь выбранный товар (не-клавиша)");
  assert.equal(state.builder.slots[0].group, "",
    "группа «Кухня» снята при замене клавиши на не-клавишу; replaceAt без keySlotKind сохранил бы её");
});

/* ─────────────────────────────────────────────────────────────────────────────────────────
   E13-mig-4: buildPostSheet (лист монтажника). ЧЕСТНО: мутация «fromPost(post,keySlotKind) →
   fromPost(post)» здесь ЭКВИВАЛЕНТНА и поведенческим тестом НЕ УБИВАЕТСЯ. Причина — статическая и
   проверяемая: в buildPostSheet результат fromPost (переменная slots) уходит ТОЛЬКО в
   EPBuilderSlots.tokens(slots) и EPBuilderSlots.tokenDeps(slots,…). tokens читает лишь ИНДЕКС
   (map((_,i)=>i)), tokenDeps.product — лишь s.id; поле .group, единственное, что меняет предикат,
   не читает НИ ОДИН потребитель. Группы света в лист монтажника приходят НЕ из slots, а из плана
   света (lightingRowsFor(post,light) → EPLightingPlan), уже посчитанного по данным, которые
   загрузочная миграция (mig-2) вычистила заранее. Здесь это фиксируем как инвариант, чтобы
   «оживление» dead-аргумента в будущем краснело: два потребителя дают ОДИНАКОВЫЙ результат с
   предикатом и без, хотя сами .group различаются. */
test("E13-mig-4: keySlotKind в buildPostSheet — эквивалентная мутация (потребители slots игнорируют .group)", () => {
  const post = { mechanismIds: [KEY_ID, NONKEY_ID], keyGroups: ["Кухня", "Спальня"] };
  const withPred = EPBuilderSlots.fromPost(post, keySlotKind); // как в продакшене
  const without = EPBuilderSlots.fromPost(post);               // как в мутанте
  // ровно те два потребителя, что есть у slots в buildPostSheet:
  const consume = slots => {
    const td = EPBuilderSlots.tokenDeps(slots, { product, mechanismSpan: EPCatalog.mechanismSpan });
    return EPBuilderSlots.tokens(slots).map(t => { const p = td.product(t); return p ? Number(p.id) : null; });
  };
  assert.deepEqual(consume(withPred), consume(without),
    "потребители slots (tokens + tokenDeps.product) дают идентичный результат с предикатом и без — мутация не наблюдаема");
  assert.notDeepEqual(withPred.map(s => s.group), without.map(s => s.group),
    "при этом сам предикат РАБОТАЕТ (снимает «Спальня» с не-клавиши) — просто buildPostSheet эту разницу отбрасывает");
});
