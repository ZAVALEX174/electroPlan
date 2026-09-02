/* ПОВЕДЕНЧЕСКИЙ регресс ПРОВОДКИ селектора «Количество модулей рамки» и ЕДИНОГО источника
   ёмкости поста (js/app.js) + index.html.

   ЗАЧЕМ ИМЕННО ПОВЕДЕНЧЕСКИ. Прошлая версия этого теста сверяла ТЕКСТ app.js регэкспами и в
   шапке утверждала «app.js в node не грузится, поэтому проверяем по тексту». Это опровергается
   собственным репозиторием: tests/renderSummaryOrphanWiring.test.js исполняет НАСТОЯЩИЙ исходник
   renderSummary в vm на DOM-шиме. Тем же приёмом здесь исполняются НАСТОЯЩИЕ renderBuilder /
   builderCapacity / renderPostSlotCountSelect / pickBuilderProduct на НАСТОЯЩЕМ каталоге VIMAR.
   Текстовая сверка мимо этого пропускала мутации: фит от count вместо capacity, fallback ||1,
   frameSlotOptions без extra — они текстом не ловятся.

   КАК. Вырезаем ИСХОДНЫЙ ТЕКСТ функций (через общий stripComments — он же чинит границу
   вырезания: «\nfunction » внутри комментария больше не обрубает тело) и исполняем в vm-контексте.
   Чистая доменная логика (EPCatalog/EPPosts/EPBuilderSlots) и каталог — НАСТОЯЩИЕ; только
   UI-соседи (enhancePicker, renderBuilderSlots/Catalog/Composition, assembledPostHtml, свет) —
   заглушки: их корректность стерегут свои тесты, здесь предмет — проводка ёмкости и селектора.

   ЧТО ЛОВИТ (мутации из двойной проверки ветки):
   1) пустое тело renderPostSlotCountSelect → селектор без вариантов;
   2) фит считает от count (селектор), а не от capacity (накладка) → механизмы исчезают;
   3) fallback ёмкости `||1` вместо `||count` → пост на многорядной/недоступной накладке теряет
      ёмкость открытия;
   4) frameSlotOptions(byKind("frame")) без extra → ёмкость открытого поста пропадает из селектора.
   Плюс блокеры ветки: недоступная накладка не подменяется молча (сохранение блокируется,
   механизмы целы) и pickBuilderProduct берёт ту же ёмкость, что renderBuilder.
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

/* index.html читаем напрямую — единственный тест ниже сверяет ПУСТОТУ разметки #postSlotCount.
   Исходник app.js (со снятыми комментариями, чтобы `\nfunction ` из комментария не оборвал тело),
   вырезание функций и vm — на общем стенде appStand. */
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

/* Настоящий каталог VIMAR через window-шим стенда. */
const PRODUCTS = stand.loadVimarCatalog().products;

/* Конкретные накладки каталога (проверены разведкой):
   09668.01 (id 200178) — 8 модулей, серия Neve Up; 09666.01 (id 200166) — 6 модулей. */
const FRAME8 = PRODUCTS.find(p => p.code === "09668.01");
const FRAME6 = PRODUCTS.find(p => p.code === "09666.01");
/* Одномодульный механизм, совместимый с Neve Up — им заполняем посты и им же «заменяем». */
const MECH1 = EPCatalog.compatibleMechanisms(FRAME8, PRODUCTS.filter(x => x.kind === "mechanism" && x.active))
  .find(m => EPCatalog.mechanismSpan(m) === 1);
assert.ok(FRAME8 && FRAME6 && MECH1, "разведка каталога: 09668.01, 09666.01 и 1М-механизм Neve Up должны быть в каталоге");

const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));

/* DOM-шим стенда: #postFrameSelect — <select> по спеке (присвоение .value отсутствующей опции
   СНИМАЕТ выбор → ""), остальные узлы — generic. Именно спека select делает тест честным:
   молчаливая подмена накладки отличается от валидного выбора. */
function makeDom() {
  return stand.makeDom({ selects: ["postFrameSelect"] });
}

/* Общий vm-контекст для исполнения renderBuilder/builderCapacity/pickBuilderProduct: доменная
   логика и каталог настоящие, UI-соседи — заглушки. frameOptions отдаёт реальные <option
   value="id">, чтобы шим-select удержал выбранное значение (иначе спека сняла бы его). */
function makeCtx(state, dom) {
  const byKind = kind => state.products.filter(x => x.kind === kind && x.active);
  const frameProduct = id => product(id);
  const ctx = {
    state, product, byKind, frameProduct,
    $: dom.$,
    frameSlotCount: EPCatalog.frameSlotCount,
    frameSlotOptions: EPCatalog.frameSlotOptions,
    compatibleMechanisms: EPCatalog.compatibleMechanisms,
    mechanismSpan: EPCatalog.mechanismSpan,
    moduleWord: EPCatalog.moduleWord,
    productSeries: EPCatalog.productSeries,
    esc: s => String(s == null ? "" : s),
    frameOptions: (items, sel) => (items || []).map(i =>
      `<option value="${i.id}" ${Number(i.id) === Number(sel) ? "selected" : ""}>${i.id}</option>`).join(""),
    keySlotKind: () => false,
    enhancePicker: () => {},
    resolveMissingFrame: () => null,
    mechanismModulesTotal: ids => ids.reduce((s, id) => s + EPCatalog.mechanismSpan(product(id)), 0),
    /* Маркер, а не "": иначе фантомное превью в состоянии «накладки нет» (мутация
       `postPreview=assembledPostHtml(...)`) дало бы "" и прошло мимо утверждения `=== ""`. */
    assembledPostHtml: () => "<post-preview>",
    lightingFor: () => ({}),
    projectPostsWithBuilder: () => [],
    builderPostDraft: () => ({ mechanismIds: [] }),
    /* Заглушка ДОСТАВЛЯЕТ остаток в ДОМ-хост слотов ровно так, как это делает настоящая
       renderBuilderSlots (строка «свободно N — выберите товар» при remaining>0). Так обещание
       «в состоянии „накладки нет" раскладка не считается» проверяется по ФАКТУ доставки рядом
       с каталогом, а не по аргументу: мутация `renderBuilderSlots(layout,0,…)` → ненулевой
       remaining вернёт на экран «Свободно N», и тест это увидит. */
    renderBuilderSlots: (layout, remaining) => {
      dom.$("builderSlots").innerHTML = remaining > 0
        ? `Свободно ${remaining} — выберите товар карточкой в каталоге справа`
        : "нет свободных модулей";
    },
    lightingRowsFor: () => [],
    retargetBuilderSlot: () => {},
    builderErrorHtml: () => "",
    /* Заглушка ПЕРЕРИСОВЫВАЕТ ДОМ-хост каталога (маркером «свежести»). Если ветка перестанет
       звать renderBuilderCatalog, в хосте останется несвежее содержимое предыдущего поста —
       обещание «список механизмов не показывается» проверяется по факту доставки в хост. */
    renderBuilderCatalog: () => { dom.$("builderCatalog").innerHTML = "<catalog-refreshed>"; },
    /* Заглушка ПОВТОРЯЕТ контракт настоящей renderBuilderComposition ровно в одном: при
       отсутствии накладки хост получает errorHtml. Так утверждение о баннере проверяется по
       DOM-ХОСТУ, а не по объекту контекста — иначе мутация «errorHtml→""» на вызове проходит
       мимо (баннер лежит в builderCtx, но до экрана не доходит). */
    renderBuilderComposition: (frame, errorHtml) => { dom.$("builderComposition").innerHTML = frame ? "<composition>" : (errorHtml || ""); },
    renderBuilder: () => {},
    builderCtx: {},
    EPBuilderSlots, EPPosts
  };
  /* Контекст создаёт стенд при stand.run(...); свойства, дописанные в ctx до вызова
     (builderCtx и т.п.), песочница видит. */
  return ctx;
}

/* Пост из N одномодульных механизмов одного артикула (слоты конструктора). */
const slotsOf = (mechId, n) =>
  EPBuilderSlots.fromPost({ mechanismIds: Array.from({ length: n }, () => Number(mechId)) }, () => false);

/* --- index.html: селектор строит код, а не разметка ------------------------------------ */

test("index.html: #postSlotCount отдаёт ПУСТОЙ select — варианты строит код, а не разметка", () => {
  const m = HTML.match(/<select id="postSlotCount">([\s\S]*?)<\/select>/);
  assert.ok(m, 'в разметке должен быть <select id="postSlotCount">');
  assert.equal(m[1].trim(), "", "select обязан быть пустым: зашитые <option> вернут исчезнувшую модульность");
});

/* --- renderPostSlotCountSelect: варианты из каталога + ёмкость открытого поста (extra) --- */

test("renderPostSlotCountSelect строит варианты из каталога И добавляет ёмкость открытого поста (extra)", () => {
  const dom = makeDom();
  const ctx = makeCtx({ products: PRODUCTS }, dom);
  const render = stand.run("renderPostSlotCountSelect", ctx);

  // ёмкость открытого поста = 5, которой в каталоге нет (модульности каталога: 1,2,3,4,6,7,8)
  render(5);
  const opts = [...dom.els.postSlotCount.innerHTML.matchAll(/<option value="(\d+)"/g)].map(m => Number(m[1]));

  // мутация 1 (пустое тело) → селектор без вариантов
  assert.ok(opts.length > 0, "селектор обязан получить варианты — пустое тело renderPostSlotCountSelect оставит его пустым");
  // варианты — настоящие модульности каталога
  const catalogCounts = EPCatalog.frameSlotCounts(PRODUCTS.filter(x => x.kind === "frame" && x.active));
  catalogCounts.forEach(n =>
    assert.ok(opts.includes(n), `модульность каталога ${n} обязана быть в селекторе`));
  // мутация 4 (frameSlotOptions без extra) → ёмкость 5 пропадёт
  assert.ok(!catalogCounts.includes(5), "предпосылка теста: пятёрки в каталоге нет");
  assert.ok(opts.includes(5), "ёмкость открытого поста (extra=5) обязана попасть в селектор — иначе пост с исчезнувшей модульностью покажет чужое значение");
});

/* --- builderCapacity: единственный источник ёмкости ------------------------------------ */

test("builderCapacity берёт ёмкость от НАСТОЯЩЕЙ накладки, а не от селектора", () => {
  const dom = makeDom();
  dom.$("postFrameSelect").innerHTML = `<option value="${FRAME8.id}"></option>`;
  dom.$("postFrameSelect").value = String(FRAME8.id);   // накладка 8 модулей
  dom.$("postSlotCount").value = "5";                    // селектор врёт «5»
  const ctx = makeCtx({ products: PRODUCTS }, dom);
  const cap = stand.run("builderCapacity", ctx)();
  assert.equal(cap, 8, "ёмкость обязана считаться от накладки (8), а не от селектора (5)");
});

test("builderCapacity: fallback на ёмкость открытия (count), а НЕ на 1, когда накладка не разрешается", () => {
  const dom = makeDom();
  // накладка не в каталоге (её артикул ушёл) → frameSlotCount(undefined)=null → работает fallback
  dom.els.postFrameSelect = { value: "999999", dataset: {} };   // плоский, без спеки — важно только .value
  dom.$("postSlotCount").value = "6";
  const ctx = makeCtx({ products: PRODUCTS }, dom);
  const cap = stand.run("builderCapacity", ctx)();
  // мутация 3 (`||1`) вернула бы 1 и потеряла бы ёмкость поста
  assert.equal(cap, 6, "fallback ёмкости обязан быть count (6), а не 1");
});

/* --- renderBuilder: фит от capacity (накладки), не от count (селектора) ----------------- */

test("renderBuilder: 8 механизмов в накладке 8М при селекторе «5» — состав НЕ режется до 5", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(MECH1.id, 8), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  // накладку задаём явно (как openPostBuilder), селектор врёт «5»
  dom.$("postFrameSelect").dataset.preferredFrameId = String(FRAME8.id);
  dom.$("postSlotCount").value = "5";
  const render = stand.run(["builderCapacity", "renderBuilder"], ctx);
  render();

  // мутация 2 (фит от count=5) урезала бы состав до 5 механизмов
  assert.equal(state.builder.slots.length, 8, "все 8 механизмов обязаны выжить — ёмкость от накладки (8), а не от селектора (5)");
  assert.match(dom.els.builderCapacity.innerHTML, /из 8/, "полоса заполнения обязана считать от накладки (из 8)");
  assert.ok(!dom.els.savePost.disabled, "полный набор в разрешённой накладке — «Сохранить» активно");
});

/* --- Блокер 1: недоступная накладка не подменяется молча -------------------------------- */

test("renderBuilder: артикул накладки ушёл из прайса — молчаливой подмены нет, «Сохранить» заблокировано, механизмы целы", () => {
  const dom = makeDom();
  // пост на 5 одномодульных механизмах; накладки (id 999999) в каталоге нет
  const state = { products: PRODUCTS, builder: { slots: slotsOf(MECH1.id, 5), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = "999999";
  dom.$("postSlotCount").value = "5";   // ёмкость открытия из числа механизмов
  const render = stand.run(["builderCapacity", "renderBuilder"], ctx);
  render();

  assert.ok(dom.els.savePost.disabled, "с недоступной накладкой сохранять нельзя — иначе пост уйдёт на чужую накладку");
  assert.equal(state.builder.slots.length, 5, "механизмы поста терять нельзя: ёмкость от открытия (5), а не от подставленной 1М-накладки");
  assert.equal(dom.els.postFrameSelect.value, "999999", "поле держит недоступную накладку плейсхолдером, а не подменяет её frames[0]");
  assert.match(ctx.builderCtx.errorHtml, /Накладка поста недоступна/, "окно обязано объяснить причину человеческим текстом, а не молчать");
});

/* --- Блокер 2: pickBuilderProduct берёт ту же ёмкость, что renderBuilder ---------------- */

test("pickBuilderProduct: замена карточки в накладке 8М при селекторе «5» — состав НЕ режется до 5", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(MECH1.id, 8), target: { mode: "replace", index: 0 }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.els.postFrameSelect = { value: String(FRAME8.id), dataset: {} };   // накладка уже выбрана прошлым render
  dom.$("postSlotCount").value = "5";                                     // селектор врёт «5»
  ctx.builderCtx = { mechs: EPCatalog.compatibleMechanisms(FRAME8, PRODUCTS.filter(x => x.kind === "mechanism" && x.active)) };
  const pick = stand.run(["builderCapacity", "pickBuilderProduct"], ctx);
  pick(Number(MECH1.id));

  // мутация «count вместо builderCapacity» урезала бы состав до 5
  assert.equal(state.builder.slots.length, 8, "замена карточки обязана считать ёмкость как renderBuilder (8), а не как селектор (5)");
});

/* --- Состояние «накладки нет»: держится через повторный render, баннер доходит до хоста ---
   Единственный прежний тест на это состояние делал ОДИН render() и проверял баннер по объекту
   контекста — из-за этого две мутации выживали на зелёном:
   A) js/app.js `hasExplicitFrame?explicitFrameId:frameSelect.value` → `:""`: dataset живёт один
      render, и со ВТОРОГО render (любой клик по карточке перерисовывает конструктор) накладка
      снова подменялась frames[0], «Сохранить» оживало — исходный блокер возвращался целиком.
   B) js/app.js `builderCtx.errorHtml` → `""` на вызове renderBuilderComposition: баннер
      вычислялся, но на экран не доходил (тест смотрел builderCtx, а не DOM-хост).
   Плюс тест сторожит ВСЕ обещания шапки 6e096c3 — каждое ПО ФАКТУ ДОСТАВКИ В DOM-ХОСТ, а не по
   объекту контекста и не по вызову-заглушке. Прежняя версия проверяла builderCtx.remaining и
   заглушки, из-за чего три мутации оставались зелёными (двойная проверка ветки нашла их):
     — снятие `$("builderCapacity").innerHTML=""` → под баннером висела старая полоса заполнения;
     — `renderBuilderSlots(layout,0,…)` → ненулевой remaining печатал «Свободно N» рядом с
       каталогом, который говорит «добавлять некуда»;
     — снятие `renderBuilderCatalog()` → в каталоге жили карточки предыдущего поста.
   Поэтому DOM-хосты (builderCapacity/builderSlots/builderCatalog/postPreview/builderComposition)
   предзаполняем содержимым «прошлого поста» и требуем, чтобы каждый ДОШЁЛ до чистого/свежего
   состояния. */
test("renderBuilder: недоступная накладка держится ЧЕРЕЗ повторный render, все обещания доходят до DOM-хостов", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(MECH1.id, 5), target: { mode: "add" }, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = "999999";   // накладки нет в каталоге
  dom.$("postSlotCount").value = "5";
  const render = stand.run(["builderCapacity", "renderBuilder"], ctx);

  render();   // первый render: накладка задана явно через dataset
  assert.ok(!("preferredFrameId" in dom.els.postFrameSelect.dataset), "предпосылка: dataset снят после первого render");

  /* «Прошлый пост» на экране: полоса заполнения, список слотов со свободным местом и карточки
     каталога. Второй render (имитация клика по карточке) обязан их убрать/перерисовать. */
  dom.$("builderCapacity").innerHTML = "Занято 5 из 6 · свободно 1 модуль";
  dom.$("builderSlots").innerHTML = "Свободно 3 — выберите товар карточкой в каталоге справа";
  dom.$("builderCatalog").innerHTML = "<stale-post-cards>";
  dom.$("postPreview").innerHTML = "<stale-preview>";
  render();   // второй render имитирует перерисовку после клика по карточке

  // мутация A: со второго render frameMissing гаснет и накладка подменяется frames[0]
  assert.equal(dom.els.postFrameSelect.value, "999999", "недоступная накладка держится значением и на повторном render, а не подменяется frames[0]");
  assert.ok(dom.els.savePost.disabled, "«Сохранить» остаётся заблокированным и после повторного render");
  assert.equal(state.builder.slots.length, 5, "механизмы поста целы через оба render — ни фита, ни упаковки от фантомной накладки");

  // обещание «баннер»: доходит до composition-хоста, а не остаётся в объекте контекста
  assert.match(dom.els.builderComposition.innerHTML, /Накладка поста недоступна/, "баннер обязан доходить до composition-хоста");
  // обещание «ёмкость не считается»: старая полоса заполнения СТЁРТА в хосте
  assert.equal(dom.els.builderCapacity.innerHTML, "", "полоса заполнения прошлого поста обязана быть стёрта — ёмкости без накладки нет");
  // обещание «раскладка не считается»: в хосте слотов НЕТ обещания свободного места (remaining=0)
  assert.doesNotMatch(dom.els.builderSlots.innerHTML, /Свободно/, "список слотов не обещает свободные модули — раскладки без накладки нет");
  // обещание «список механизмов не показывается»: каталог ПЕРЕРИСОВАН, карточки прошлого поста ушли
  assert.equal(dom.els.builderCatalog.innerHTML, "<catalog-refreshed>", "каталог обязан быть перерисован — карточки прошлого поста с рабочими обработчиками жить не должны");
  // обещание «превью не рисуется»: фантомная рамка на 1 модуль стёрта
  assert.equal(dom.els.postPreview.innerHTML, "", "фантомное превью на 1 модуль исчезло — рисовать нечего");

  // ровно одна причина и никаких выдуманных чисел в контексте
  assert.equal((ctx.builderCtx.errorHtml.match(/builder-error/g) || []).length, 1, "окно называет РОВНО одну причину, без вымышленной второй ошибки раскладки");
  assert.equal(ctx.builderCtx.remaining, 0, "свободного места нет — обещать его нельзя");
  assert.equal(ctx.builderCtx.addMax, 0, "предельная ширина добавления — 0: в отсутствующую накладку добавлять некуда");
  assert.equal(ctx.builderCtx.frameMissing, true, "контекст помечен «накладка непригодна»");
});

/* --- Третье состояние (задача 1): накладка НЕ ВЫБРАНА вовсе (пост без накладки) ----------
   Смета различает три случая накладки (js/estimate.js): разрешилась / артикул задан, но пропал
   из каталога / нет вовсе. Конструктор различал только два: пустой frameId проваливался в общий
   путь, где selectedFrameId молча брал frames[0] — та же выдуманная подмена, от которой ветка
   защищалась сверху. Теперь пустой requestedFrameId — отдельное состояние frameUnset: frames[0]
   не подставляется, причина названа ДРУГИМ текстом («не выбрана» ≠ «недоступна»), сохранение
   заблокировано, механизмы целы. НОВЫЙ пост сюда не попадает — ему openPostBuilder даёт накладку
   по умолчанию (проверяется отдельным утверждением ниже). */
test("renderBuilder: накладка не выбрана вовсе (frameId пуст) — frames[0] не подставляется, причина ОТЛИЧНА от «недоступна»", () => {
  const dom = makeDom();
  const state = { products: PRODUCTS, builder: { slots: slotsOf(MECH1.id, 3), target: { mode: "add" }, editingTemplateId: "tpl_x", editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  // шаблон без накладки: openPostBuilder ставит dataset = String(frameId ?? "") = ""
  dom.$("postFrameSelect").dataset.preferredFrameId = "";
  dom.$("postSlotCount").value = "3";
  // «прошлый пост» на экране — обязан быть убран
  dom.$("builderCapacity").innerHTML = "Занято 5 из 6 · свободно 1 модуль";
  dom.$("builderCatalog").innerHTML = "<stale-post-cards>";
  dom.$("postPreview").innerHTML = "<stale-preview>";
  const render = stand.run(["builderCapacity", "renderBuilder"], ctx);

  render();
  render();   // держится через повторный render (dataset снят, состояние читается из value="")

  assert.equal(dom.els.postFrameSelect.value, "", "накладка не выбрана: поле пусто, frames[0] молча НЕ подставлена");
  assert.ok(dom.els.savePost.disabled, "без накладки сохранять нечего — «Сохранить» заблокировано");
  assert.equal(state.builder.slots.length, 3, "механизмы поста целы — от несуществующей накладки ничего не режется");
  assert.match(dom.els.builderComposition.innerHTML, /Накладка поста не выбрана/, "причина — «не выбрана», ОТЛИЧНАЯ от «недоступна» (артикул пропал)");
  assert.doesNotMatch(dom.els.builderComposition.innerHTML, /недоступна/, "«не выбрана» и «недоступна» — разные причины, смешивать их нельзя");
  assert.equal((ctx.builderCtx.errorHtml.match(/builder-error/g) || []).length, 1, "ровно одна причина на экране");
  assert.equal(dom.els.builderCapacity.innerHTML, "", "полоса заполнения прошлого поста стёрта");
  assert.equal(dom.els.builderCatalog.innerHTML, "<catalog-refreshed>", "каталог перерисован — старые карточки ушли");
  assert.equal(dom.els.postPreview.innerHTML, "", "превью пустое — накладки нет");
});

/* Новый пост С НУЛЯ не блокируется: openPostBuilder(без аргументов) даёт ему накладку по
   умолчанию (defaultFrame), поэтому requestedFrameId непуст и frameUnset не срабатывает —
   создание с нуля идёт нормальным путём. */
test("renderBuilder: новый пост с накладкой по умолчанию — НЕ уходит в frameUnset, сохранение доступно", () => {
  const dom = makeDom();
  const allActiveFrames = PRODUCTS.filter(x => x.kind === "frame" && x.active);
  const defFrame = allActiveFrames.find(f => EPCatalog.frameSlotCount(f) === 3) || allActiveFrames[0];
  const cap = EPCatalog.frameSlotCount(defFrame);
  const mech = EPCatalog.compatibleMechanisms(defFrame, PRODUCTS.filter(x => x.kind === "mechanism" && x.active))
    .find(m => EPCatalog.mechanismSpan(m) === 1);
  const state = { products: PRODUCTS, builder: { slots: slotsOf(mech.id, cap), target: { mode: "add" }, editingTemplateId: null, editingPlacedId: null } };
  const ctx = makeCtx(state, dom);
  dom.$("postFrameSelect").dataset.preferredFrameId = String(defFrame.id);   // как openPostBuilder новому посту
  dom.$("postSlotCount").value = String(cap);
  const render = stand.run(["builderCapacity", "renderBuilder"], ctx);
  render();

  assert.equal(dom.els.postFrameSelect.value, String(defFrame.id), "новый пост держит накладку по умолчанию, а не пустое поле");
  assert.notEqual(ctx.builderCtx.frameMissing, true, "нормальный путь — состояние «накладка непригодна» не взводится");
  assert.ok(!dom.els.savePost.disabled, "заполненный новый пост на разрешённой накладке — «Сохранить» доступно, создание с нуля не заблокировано");
});

/* --- renderBuilderCatalog в состоянии «накладки нет»: без обещаний и без ложной причины ---
   Шапка каталога больше не обещает «Свободно N модулей» при нуле карточек и не выдаёт ложное
   «Каталог механизмов не загружен» (mechs пусты, но каталог-то загружен — недоступна накладка).
   Гоняем НАСТОЯЩИЙ renderBuilderCatalog: ранний выход по builderCtx.frameMissing самодостаточен
   (нужны только $, builderCtx, esc), тяжёлые UI-зависимости он не задевает. */
test("renderBuilderCatalog: накладки нет — не обещает свободное место и не врёт про «каталог не загружен»", () => {
  const dom = makeDom();
  const ctx = makeCtx({ products: PRODUCTS, builder: { slots: [], target: { mode: "add" }, query: "" } }, dom);
  ctx.builderCtx = { frameMissing: true, mechs: [], remaining: 0, addMax: 0, maxPostCap: 0 };
  const renderCat = stand.run("renderBuilderCatalog", ctx);
  renderCat();

  const target = dom.els.builderTarget.innerHTML;
  const cat = dom.els.builderCatalog.innerHTML;
  assert.ok(!/Свободно/.test(target), "шапка каталога не обещает свободные модули, когда накладки нет");
  assert.ok(!/не загружен/.test(cat), "не выдаёт ложную причину «каталог не загружен» — каталог загружен, недоступна накладка");
  assert.match(cat, /выберите накладку/i, "объясняет, что без накладки добавлять нечего");
});
