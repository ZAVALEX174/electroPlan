/* ПОВЕДЕНЧЕСКИЙ регресс E13: ЗАПИСЫВАЮЩАЯ половина конструктора — savePostBuilder — до сих пор не
   исполнялась НИ ОДНИМ тестом (grep savePostBuilder tests/ → пусто). Читающую половину
   (openPostBuilder) держат девятнадцать тестов, а «Сохранить» — ноль: любая мутация внутри неё
   оставалась зелёной. Пять зелёных мутаций (см. постановку), из них четыре — прямые деньги/потеря
   данных. Здесь мы ИСПОЛНЯЕМ настоящий текст savePostBuilder из app.js на настоящем каталоге VIMAR
   и держим обе ветки — правку поста НА ПЛАНЕ и сохранение/обновление ШАБЛОНА.

   ЗАЧЕМ ПОВЕДЕНЧЕСКИ. app.js — монолит-оркестратор, в node не грузится; связки дают почти все
   дефекты (§7.1 HANDOFF). Вырезаем НАСТОЯЩИЙ текст savePostBuilder общим стендом и исполняем в vm.
   НЕ заглушаем ровно то, что проверяем: сборку base (keyGroups, socketBoxProductId, mechanismIds),
   адресацию записи по editingTemplateId и текст тоста — всё настоящее. Постороннее — безопасные
   стабы: DataService (persist), askWallScope (диалог охвата), рендеры, closePostBuilder,
   builderWallType. socketBox стабим как ИСТОЧНИК подрозетника (возвращает {id}); проверяем, что
   ЭТОТ id доезжает до поста — сама подстановка `socketBox()?.id` настоящая.

   МУТАЦИОННАЯ ТАБЛИЦА (проверено, см. отчёт):
     keyGroups:[...fields.keyGroups] → keyGroups:[]  → красит save-1/save-3 (группы света молча
       теряются при сохранении и поста, и шаблона).
     socketBoxProductId:socketBox()?.id → …:undefined → красит save-2 (подрозетник не сохраняется).
     {id:existing||uid("tpl_"),…} → {id:uid("tpl_"),…} → красит save-4 (у шаблона с известным
       editingTemplateId «Сохранить» плодит ДУБЛЬ вместо обновления существующей записи).
     toast(existing?"Шаблон обновлён":…) → всегда «Пост сохранён в библиотеку» → красит save-5
       (человеку сообщают не то событие).
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPBuilderSlots = require("../js/builderSlots.js");

const PRODUCTS = stand.loadVimarCatalog().products;
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));

/* Разведка каталога (не хардкодим числа — фиксируем предпосылки, чтобы перезалив прайса уронил
   тест осмысленно). Двухмодульный механизм 02970 (200040) целиком заполняет двухмодульную накладку
   Eikon Tactil → distributePosts даёт valid && full, и savePostBuilder доходит до записи. */
const MECH_2M = 200040;
const activeFrames = PRODUCTS.filter(x => x.kind === "frame" && x.active);
const FRAME_2 = activeFrames.find(f =>
  (f.series || []).includes("Eikon Tactil") && EPCatalog.frameSlotCount(f) === 2);
assert.ok(FRAME_2, "разведка: у Eikon Tactil есть 2-модульная накладка — с ней собираем валидный пост");
assert.equal(EPCatalog.mechanismSpan(product(MECH_2M)), 2, "разведка: механизм 200040 — 2 модуля (заполняет накладку целиком)");

/* Сборка стенда для savePostBuilder. Возвращает управляющие каналы: сохранённый шаблон (аргумент
   DataService.savePost), список тостов, флаг закрытия окна. НЕ стабим сборку base и адресацию —
   именно их проверяют находки. */
function runSave({ slots, wallType = null, editingPlacedId = null, editingTemplateId = null, posts = [], templates = [], socketBoxId = "sb1" }) {
  const dom = stand.makeDom();
  dom.$("postName").value = "Пост";
  dom.$("postFrameSelect").value = String(FRAME_2.id);

  const state = {
    products: PRODUCTS,
    posts,
    templates,
    builder: { slots, wallType, editingPlacedId, editingTemplateId }
  };
  const toasts = [];
  let savedTemplate; // аргумент DataService.savePost — по нему видно id (обновление vs дубль)
  const ctx = {
    state, $: dom.$,
    EPCatalog, EPPosts, EPBuilderSlots,
    frameProduct: product, product,
    mechanismSpan: EPCatalog.mechanismSpan,
    // socketBox — ИСТОЧНИК подрозетника; проверяем, что его id доезжает до base (не сам подбор)
    socketBox: () => (socketBoxId == null ? null : { id: socketBoxId }),
    uid: p => p + "GEN", // детерминированный id для ветки «новый шаблон» (existing отсутствует)
    toast: msg => toasts.push(msg),
    // builderWallType стабим: тип стены здесь посторонний (его сторожат open-12 и finding 5),
    // а «solid == проект» гасит диалог охвата и оставляет обе ветки на прямом пути записи
    builderWallType: () => "solid",
    EP_DATA: { settings: { wallType: "solid" } },
    askWallScope: () => Promise.resolve("self"),
    DataService: {
      savePost: t => { savedTemplate = t; return Promise.resolve(); },
      getSavedPosts: () => Promise.resolve(state.templates)
    },
    renderAll: () => {}, renderProperties: () => {}, renderSummary: () => {},
    renderTemplates: () => {},
    closePostBuilder: () => {}
  };
  const save = stand.run("savePostBuilder", ctx);
  return save().then(() => ({ state, toasts, savedTemplate: () => savedTemplate }));
}

test("E13-save-1: правка поста НА ПЛАНЕ доносит группы света до сохранённого поста", async () => {
  /* Группа «Кухня» на слоте обязана попасть в post.keyGroups. Мутация `keyGroups:[]` теряет её
     молча — комментарий над строкой ровно об этом. */
  const post = { id: "p1", roomId: "r1", frameId: FRAME_2.id };
  const { state } = await runSave({
    slots: [EPBuilderSlots.slot(MECH_2M, "Кухня")],
    editingPlacedId: "p1", posts: [post]
  });
  assert.deepEqual([...state.posts[0].keyGroups], ["Кухня"],
    "группа света обязана доехать до сохранённого поста — мутация keyGroups:[] теряет её без ошибки в консоли");
  assert.deepEqual([...state.posts[0].mechanismIds], [MECH_2M],
    "механизмы поста тоже записаны (контроль: сборка base дошла до поста)");
});

test("E13-save-2: правка поста НА ПЛАНЕ доносит подрозетник (socketBoxProductId)", async () => {
  /* socketBox() вернул {id:"sb1"} — этот id обязан лечь в post.socketBoxProductId. Мутация
     `socketBoxProductId:undefined` теряет подрозетник — это деньги в смете. */
  const post = { id: "p1", roomId: "r1", frameId: FRAME_2.id };
  const { state } = await runSave({
    slots: [EPBuilderSlots.slot(MECH_2M, "")],
    editingPlacedId: "p1", posts: [post], socketBoxId: "sb1"
  });
  assert.equal(state.posts[0].socketBoxProductId, "sb1",
    "id подрозетника из socketBox() обязан доехать до поста — мутация на undefined роняет позицию из сметы");
});

test("E13-save-3: сохранение ШАБЛОНА доносит группы света до записанного шаблона", async () => {
  /* Та же строка keyGroups работает и в ветке шаблона (base общий): группа обязана дойти до
     аргумента DataService.savePost. */
  const { savedTemplate } = await runSave({
    slots: [EPBuilderSlots.slot(MECH_2M, "Спальня")],
    editingTemplateId: null, templates: []
  });
  assert.deepEqual([...savedTemplate().keyGroups], ["Спальня"],
    "группа света обязана доехать и до сохранённого ШАБЛОНА — мутация keyGroups:[] теряет её");
});

test("E13-save-4: «Сохранить» у шаблона с известным editingTemplateId ОБНОВЛЯЕТ запись, а не плодит дубль", async () => {
  /* editingTemplateId="t1" адресует ОБНОВЛЕНИЕ: template.id обязан остаться "t1", чтобы
     DataService.savePost перезаписал существующий шаблон. Мутация `{id:uid("tpl_"),…}` (без
     existing||) дала бы новый сгенерированный id — родился бы ДУБЛЬ. Это ровно то, ради чего
     open-5 фиксирует ВЕРНЫЙ editingTemplateId; здесь проверяется, что его верность используется. */
  const existing = { id: "t1", name: "Старый шаблон", frameId: FRAME_2.id, mechanismIds: [MECH_2M], keyGroups: [""] };
  const { savedTemplate } = await runSave({
    slots: [EPBuilderSlots.slot(MECH_2M, "")],
    editingTemplateId: "t1", templates: [existing]
  });
  assert.equal(savedTemplate().id, "t1",
    "id сохранённого шаблона обязан остаться editingTemplateId (t1) — иначе «Сохранить» создаёт дубль вместо обновления");
});

test("E13-save-5: текст тоста соответствует случаю — «обновлён» vs «сохранён в библиотеку»", async () => {
  /* У шаблона с editingTemplateId сообщение — «Шаблон обновлён»; у нового шаблона — «Пост сохранён
     в библиотеку». Мутация «всегда Пост сохранён в библиотеку» ломает случай обновления. */
  const existing = { id: "t1", name: "Старый", frameId: FRAME_2.id, mechanismIds: [MECH_2M], keyGroups: [""] };
  const upd = await runSave({
    slots: [EPBuilderSlots.slot(MECH_2M, "")], editingTemplateId: "t1", templates: [existing]
  });
  assert.deepEqual(upd.toasts, ["Шаблон обновлён"],
    "при обновлении существующего шаблона человеку сообщают «Шаблон обновлён», а не «сохранён в библиотеку»");
  const fresh = await runSave({
    slots: [EPBuilderSlots.slot(MECH_2M, "")], editingTemplateId: null, templates: []
  });
  assert.deepEqual(fresh.toasts, ["Пост сохранён в библиотеку"],
    "новый шаблон — «Пост сохранён в библиотеку» (вторая ветка тоста, чтобы обе были прибиты)");
});
