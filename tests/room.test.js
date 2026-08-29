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
