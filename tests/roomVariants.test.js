/* Автотесты вариантов отделки комнаты (EPRoomVariants, К8а). Без зависимостей и сборщика:
   node --test tests/roomVariants.test.js

   ЗАЧЕМ. У комнаты до пяти наборов отделки. Здесь фиксируются правила, которые легко сломать
   незаметно: вариант 1 = плоские поля (старый проект = один вариант), лимит 5, каскад сброса
   нижележащих при смене признака, переезд второго варианта в плоские поля при удалении первого, и
   правило размещения (подходит любому → его индекс, ни одному → первый). */
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../js/roomVariants.js");

/* --- list: нормализация --------------------------------------------------------------------- */

test("старый проект без moreVariants → ровно один вариант = плоские поля", () => {
  const room = { standard: "IT", collection: "Arke", frameMaterial: "Металл" };
  assert.deepEqual(V.list(room), [{ standard: "IT", collection: "Arke", frameMaterial: "Металл" }]);
});

test("комната без полей отделки → один пустой вариант [{}] (весь каталог)", () => {
  assert.deepEqual(V.list({}), [{}]);
  assert.deepEqual(V.list(null), [{}]);
  assert.deepEqual(V.list({ name: "Кухня", lightingScheme: "relay" }), [{}]);
});

test("вариант берёт только 5 признаков; нестроковое/пустое = не задано", () => {
  const room = {
    standard: "IT", collection: "", frameMaterial: 42, frameShape: null, frameColor: "Белый",
    name: "лишнее", wallKinds: ["solid"]
  };
  assert.deepEqual(V.list(room), [{ standard: "IT", frameColor: "Белый" }]);
});

test("moreVariants добавляются к плоским как варианты 2..n", () => {
  const room = { standard: "IT", moreVariants: [{ standard: "DE", collection: "Eikon" }, { frameColor: "Чёрный" }] };
  assert.deepEqual(V.list(room), [{ standard: "IT" }, { standard: "DE", collection: "Eikon" }, { frameColor: "Чёрный" }]);
});

test("мусор в moreVariants (не объект, массив, null) отбрасывается", () => {
  const room = { standard: "IT", moreVariants: [null, "строка", 7, ["x"], { standard: "DE" }, {}] };
  /* остаются только два объекта: {standard:DE} и пустой {} */
  assert.deepEqual(V.list(room), [{ standard: "IT" }, { standard: "DE" }, {}]);
});

test("лимит 5: лишние варианты сверх пяти отбрасываются", () => {
  const room = { standard: "IT", moreVariants: [{ standard: "DE" }, { standard: "FR" }, { standard: "US" }, { standard: "BOTH" }, { standard: "IT_ROUND" }] };
  const got = V.list(room);
  assert.equal(got.length, 5);
  /* первые пять: плоский + четыре первых из moreVariants; шестой (IT_ROUND) выпал */
  assert.deepEqual(got.map(v => v.standard), ["IT", "DE", "FR", "US", "BOTH"]);
});

test("лимит 5 считается ПОСЛЕ отсева мусора (мусор не занимает место)", () => {
  const room = { standard: "IT", moreVariants: [null, { standard: "DE" }, "x", { standard: "FR" }, 0, { standard: "US" }, { standard: "BOTH" }] };
  assert.deepEqual(V.list(room).map(v => v.standard), ["IT", "DE", "FR", "US", "BOTH"]);
});

/* --- addVariant ----------------------------------------------------------------------------- */

test("addVariant добавляет пустой вариант в moreVariants", () => {
  assert.deepEqual(V.addVariant({ standard: "IT" }), { fields: { standard: "IT" }, moreVariants: [{}] });
});

test("addVariant при пяти вариантах → null (отказ)", () => {
  const room = { standard: "IT", moreVariants: [{ standard: "DE" }, { standard: "FR" }, { standard: "US" }, { standard: "BOTH" }] };
  assert.equal(V.list(room).length, 5);
  assert.equal(V.addVariant(room), null);
});

test("addVariant не мутирует вход", () => {
  const room = { standard: "IT" };
  V.addVariant(room);
  assert.deepEqual(room, { standard: "IT" });
});

/* --- removeVariant -------------------------------------------------------------------------- */

test("удаление первого: второй вариант становится первым и переезжает в плоские поля", () => {
  const room = { standard: "IT", collection: "Arke", moreVariants: [{ standard: "DE", collection: "Eikon" }, { frameColor: "Белый" }] };
  const got = V.removeVariant(room, 0);
  assert.deepEqual(got, { fields: { standard: "DE", collection: "Eikon" }, moreVariants: [{ frameColor: "Белый" }] });
});

test("удаление не первого: плоские поля не трогаются", () => {
  const room = { standard: "IT", moreVariants: [{ standard: "DE" }, { standard: "FR" }] };
  assert.deepEqual(V.removeVariant(room, 1), { fields: { standard: "IT" }, moreVariants: [{ standard: "FR" }] });
});

test("удаление единственного варианта → [{}] (комната всегда имеет минимум один)", () => {
  assert.deepEqual(V.removeVariant({ standard: "IT" }, 0), { fields: {}, moreVariants: [] });
});

test("removeVariant с несуществующим индексом → состояние без изменений", () => {
  const room = { standard: "IT", moreVariants: [{ standard: "DE" }] };
  assert.deepEqual(V.removeVariant(room, 9), { fields: { standard: "IT" }, moreVariants: [{ standard: "DE" }] });
  assert.deepEqual(V.removeVariant(room, -1), { fields: { standard: "IT" }, moreVariants: [{ standard: "DE" }] });
});

test("removeVariant не мутирует вход", () => {
  const room = { standard: "IT", moreVariants: [{ standard: "DE" }] };
  V.removeVariant(room, 0);
  assert.deepEqual(room, { standard: "IT", moreVariants: [{ standard: "DE" }] });
});

/* --- setVariantField: каскад ---------------------------------------------------------------- */

test("смена признака стирает все НИЖЕлежащие, вышележащие и сам сохраняет", () => {
  const room = { standard: "IT", collection: "Arke", frameMaterial: "Металл", frameShape: "Квадрат", frameColor: "Белый" };
  /* меняем collection (шаг 1): standard (шаг 0) сохраняется, material/shape/color (шаги 2..4) стираются */
  const got = V.setVariantField(room, 0, "collection", "Eikon");
  assert.deepEqual(got.fields, { standard: "IT", collection: "Eikon" });
});

test("смена последнего признака (цвет) не стирает ничего над ним", () => {
  const room = { standard: "IT", collection: "Arke", frameMaterial: "Металл", frameShape: "Квадрат", frameColor: "Белый" };
  const got = V.setVariantField(room, 0, "frameColor", "Чёрный");
  assert.deepEqual(got.fields, { standard: "IT", collection: "Arke", frameMaterial: "Металл", frameShape: "Квадрат", frameColor: "Чёрный" });
});

test("смена самого верхнего признака (стандарт) стирает все четыре нижних", () => {
  const room = { standard: "IT", collection: "Arke", frameMaterial: "Металл", frameShape: "Квадрат", frameColor: "Белый" };
  assert.deepEqual(V.setVariantField(room, 0, "standard", "DE").fields, { standard: "DE" });
});

test("пустое значение СНИМАЕТ признак и так же стирает нижележащие", () => {
  const room = { standard: "IT", collection: "Arke", frameMaterial: "Металл" };
  assert.deepEqual(V.setVariantField(room, 0, "collection", "").fields, { standard: "IT" });
});

test("setVariantField работает по индексу варианта 2..n", () => {
  const room = { standard: "IT", moreVariants: [{ standard: "DE", collection: "Eikon", frameColor: "Белый" }] };
  const got = V.setVariantField(room, 1, "collection", "Arke");
  assert.deepEqual(got, { fields: { standard: "IT" }, moreVariants: [{ standard: "DE", collection: "Arke" }] });
});

test("setVariantField с неизвестным prop или индексом → без изменений", () => {
  const room = { standard: "IT", moreVariants: [{ standard: "DE" }] };
  assert.deepEqual(V.setVariantField(room, 0, "wallKinds", "solid"), { fields: { standard: "IT" }, moreVariants: [{ standard: "DE" }] });
  assert.deepEqual(V.setVariantField(room, 5, "standard", "US"), { fields: { standard: "IT" }, moreVariants: [{ standard: "DE" }] });
});

test("setVariantField не мутирует вход", () => {
  const room = { standard: "IT", collection: "Arke", moreVariants: [{ standard: "DE" }] };
  V.setVariantField(room, 0, "standard", "DE");
  assert.deepEqual(room, { standard: "IT", collection: "Arke", moreVariants: [{ standard: "DE" }] });
});

/* --- fitIndex / placementIndex -------------------------------------------------------------- */

/* предикат «накладка подходит варианту»: совпадает по заданным признакам (не заданное в варианте не
   ограничивает) — упрощённая модель реального fits, который снаружи строится через каталог */
function fits(variant, frame) {
  return Object.keys(variant).every(k => variant[k] === frame[k]);
}

test("fitIndex: индекс ПЕРВОГО подходящего варианта", () => {
  const variants = [{ standard: "DE" }, { standard: "IT" }, { standard: "IT", collection: "Arke" }];
  const frame = { standard: "IT", collection: "Arke" };
  /* подходят индексы 1 и 2 — должен вернуться первый, 1 */
  assert.equal(V.fitIndex(variants, frame, fits), 1);
});

test("fitIndex: ни один не подходит → -1", () => {
  const variants = [{ standard: "DE" }, { standard: "FR" }];
  assert.equal(V.fitIndex(variants, { standard: "IT" }, fits), -1);
});

test("fitIndex: пустой вариант {} подходит всему (весь каталог)", () => {
  assert.equal(V.fitIndex([{ standard: "DE" }, {}], { standard: "IT" }, fits), 1);
});

test("placementIndex: подходит варианту → его индекс (накладку не трогаем)", () => {
  const variants = [{ standard: "DE" }, { standard: "IT" }];
  assert.equal(V.placementIndex(variants, { standard: "IT" }, fits), 1);
});

test("placementIndex: не подходит ни одному → 0 (подмена под первый)", () => {
  const variants = [{ standard: "DE" }, { standard: "FR" }];
  assert.equal(V.placementIndex(variants, { standard: "IT" }, fits), 0);
});

test("placementIndex: подходит первому → 0", () => {
  assert.equal(V.placementIndex([{ standard: "IT" }, { standard: "DE" }], { standard: "IT" }, fits), 0);
});
