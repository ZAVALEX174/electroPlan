/* Автотесты разрешения схемы электрики комнаты (EPRoom.roomLightingScheme).
   Запуск без зависимостей и без сборщика:  node --test tests/

   ЗАЧЕМ. Схема электрики стала свойством КОМНАТЫ, а настройка проекта — значением по умолчанию
   (симметрично EPPosts.postWallType). Здесь фиксируется единственное правило, которое легко
   сломать незаметно: ОТСУТСТВИЕ/МУСОР/неизвестный id → схема ПРОЕКТА, а не «неизвестно» и не
   пустое место. Своя валидная схема — приоритетнее проектной. */
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/room.js");

/* Список схем в форме, близкой к EPLightingGroups.SCHEMES (нужны только id). */
const SCHEMES = [{ id: "classic" }, { id: "relay" }, { id: "bell" }];

test("своя валидная схема имеет приоритет над проектной", () => {
  assert.equal(R.roomLightingScheme({ lightingScheme: "relay" }, "classic", SCHEMES), "relay");
});

test("отсутствие поля → схема проекта", () => {
  assert.equal(R.roomLightingScheme({}, "classic", SCHEMES), "classic");
  assert.equal(R.roomLightingScheme({ name: "Кухня" }, "relay", SCHEMES), "relay");
});

test("null-комната не роняет функцию и даёт схему проекта", () => {
  assert.equal(R.roomLightingScheme(null, "classic", SCHEMES), "classic");
  assert.equal(R.roomLightingScheme(undefined, "relay", SCHEMES), "relay");
});

test("мусор в поле (пустая строка, не-строка) → схема проекта", () => {
  assert.equal(R.roomLightingScheme({ lightingScheme: "" }, "classic", SCHEMES), "classic");
  /* «   » — непустая строка, но НЕ id из списка схем, поэтому уходит на проект. */
  assert.equal(R.roomLightingScheme({ lightingScheme: "   " }, "classic", SCHEMES), "classic");
  assert.equal(R.roomLightingScheme({ lightingScheme: 42 }, "classic", SCHEMES), "classic");
  assert.equal(R.roomLightingScheme({ lightingScheme: null }, "relay", SCHEMES), "relay");
  assert.equal(R.roomLightingScheme({ lightingScheme: {} }, "classic", SCHEMES), "classic");
});

test("неизвестный id схемы (мёртвое значение) → схема проекта", () => {
  assert.equal(R.roomLightingScheme({ lightingScheme: "legacy-removed" }, "classic", SCHEMES), "classic");
});

test("список схем задаётся объектами {id} или голыми id — оба варианта работают", () => {
  assert.equal(R.roomLightingScheme({ lightingScheme: "relay" }, "classic", ["classic", "relay", "bell"]), "relay");
  assert.equal(R.roomLightingScheme({ lightingScheme: "ghost" }, "classic", ["classic", "relay"]), "classic");
});

test("без списка схем валидной считается любая непустая строка (проверку id пропускаем)", () => {
  assert.equal(R.roomLightingScheme({ lightingScheme: "whatever" }, "classic"), "whatever");
  assert.equal(R.roomLightingScheme({ lightingScheme: "" }, "classic"), "classic");
});

/* --- КОЛЛЕКЦИЯ (СЕРИЯ) ОТДЕЛКИ КОМНАТЫ (E13, EPRoom.roomCollection) ---------------------
   Правило ОТЛИЧАЕТСЯ от схемы: у коллекции нет значения-умолчания проекта. Отсутствие/мусор/
   мёртвое название → null («не задана, фильтра нет»), а НЕ проект. Это и есть поведение для
   поста вне комнат, комнаты без коллекции и старого проекта без поля. */
const COLLECTIONS = ["Arke", "Plana", "Eikon Evo"];

test("своя валидная коллекция возвращается как есть", () => {
  assert.equal(R.roomCollection({ collection: "Arke" }, COLLECTIONS), "Arke");
  assert.equal(R.roomCollection({ collection: "Eikon Evo" }, COLLECTIONS), "Eikon Evo");
});

test("отсутствие поля коллекции → null (весь каталог, не значение проекта)", () => {
  assert.equal(R.roomCollection({}, COLLECTIONS), null);
  assert.equal(R.roomCollection({ name: "Кухня" }, COLLECTIONS), null);
});

test("null/undefined-комната не роняет функцию и даёт null", () => {
  assert.equal(R.roomCollection(null, COLLECTIONS), null);
  assert.equal(R.roomCollection(undefined, COLLECTIONS), null);
});

test("мусор в поле (пустая строка, не-строка) → null", () => {
  assert.equal(R.roomCollection({ collection: "" }, COLLECTIONS), null);
  assert.equal(R.roomCollection({ collection: 42 }, COLLECTIONS), null);
  assert.equal(R.roomCollection({ collection: null }, COLLECTIONS), null);
  assert.equal(R.roomCollection({ collection: {} }, COLLECTIONS), null);
});

test("мёртвое название (нет в каталоге) → null, каталог не сужается по несуществующей серии", () => {
  assert.equal(R.roomCollection({ collection: "Idea (снята)" }, COLLECTIONS), null);
});

test("без списка коллекций валидной считается любая непустая строка", () => {
  assert.equal(R.roomCollection({ collection: "whatever" }), "whatever");
  assert.equal(R.roomCollection({ collection: "" }), null);
});

/* Краевые режимы E13 — держат ветвление roomCollection точечно (§7.1 состязательного прохода):
   без этих входов мутации `typeof own!=="string"||!own`→`!own`, `!collections`→`!collections||!collections.length`
   и добавление `.trim()` проходят зелёными, потому что валидный список + строковые входы их маскируют. */

test("нестроковое значение БЕЗ списка коллекций → null, а не сырое значение", () => {
  /* Ключ именно «без списка»: с COLLECTIONS indexOf(число/объект) и так даёт -1 → null и маскирует
     мутацию `!own` (число truthy — она бы пропустила его до `return own`). Проверяем канал, где
     число/объект дошли бы до return: список не передан. */
  assert.equal(R.roomCollection({ collection: 5 }), null);
  assert.equal(R.roomCollection({ collection: {} }), null);
  assert.equal(R.roomCollection({ collection: true }), null);
});

test("пустой список коллекций (каталог ещё не загружен) → null, а не сырое значение", () => {
  /* frameCollectionList() до загрузки каталога отдаёт []. [] истинно, поэтому проверка названия
     идёт по пустому списку → indexOf === -1 → null. Мутация `!collections.length` вернула бы сырое
     значение, показав фильтр по коллекции, которой в пустом каталоге заведомо нет. */
  assert.equal(R.roomCollection({ collection: "Arke" }, []), null);
  assert.equal(R.roomCollection({ collection: "whatever" }, []), null);
});

test("значение с окружающими пробелами (правленый вручную проект) → null, без тихого trim", () => {
  /* «Не задана», а не «Arke»: roomCollection НЕ нормализует пробелы — " Arke" не равно "Arke" в
     каталоге. Мутант с .trim() совпал бы с валидной серией и молча включил фильтр. */
  assert.equal(R.roomCollection({ collection: " Arke" }, COLLECTIONS), null);
  assert.equal(R.roomCollection({ collection: "Arke " }, COLLECTIONS), null);
});
