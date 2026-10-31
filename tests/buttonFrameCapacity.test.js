/* Вместимость кнопочной накладки Flat (К12 ч.4, часть 1) на НАСТОЯЩЕМ каталоге VIMAR через ОДИН шов
   spanForFrame (EPButtonFrame.spanIn + EPCatalog.mechanismSpan). Предмет — числа ёмкости, которые
   окно поста показывает человеку: «свободно N», переполнение старого поста, подписи модулей «1–2».
   Считаем теми же EPPosts.distributePosts/maxFreeSpan/moduleLayout, что и окно поста, — второй копии
   раскладки нет. Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EPCatalog = require("../js/catalog.js");
const EPPosts = require("../js/posts.js");
const EPButtonFrame = require("../js/buttonFrame.js");

/* Настоящий каталог VIMAR через window-шим. */
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "catalog-vimar.js"), "utf8"), { window: win });
const PRODUCTS = win.EP_VIMAR_CATALOG.products;
const byCode = c => PRODUCTS.find(p => p.code === c);
const product = id => PRODUCTS.find(p => Number(p.id) === Number(id));

const F4 = byCode("22684.4.11");   // 4 прорези на 4 кнопки
const F3 = byCode("22683.3.11");   // 3 прорези на 3 кнопки
const F1 = byCode("22682.1.11");   // 1 прорезь на 1 кнопку (не трогаем)
const KEY = byCode("22751.11");    // двойная плоская клавиша
assert.ok(F4 && F3 && F1 && KEY, "разведка каталога: накладки Flat и клавиша 22751 на месте");
assert.equal(EPCatalog.mechanismSpan(KEY), 1, "предпосылка: у клавиши базовая ширина 1 модуль");

/* ОДИН шов (как в app.js): ширина с учётом накладки. */
const spanForFrame = frame => item => EPButtonFrame.spanIn(item, frame, EPCatalog.mechanismSpan(item));
const distIn = (ids, frame) => EPPosts.distributePosts(ids, frame, { product, mechanismSpan: spanForFrame(frame) });

test("22684.4 + одна 22751 → занято 2, СВОБОДНО 2, пост валиден и ещё не полон", () => {
  const d = distIn([KEY.id], F4);
  assert.equal(d.totalOccupied, 2, "двойная клавиша занимает 2 прорези");
  assert.equal(d.totalCapacity, 4);
  assert.equal(EPPosts.maxFreeSpan(d), 2, "свободно 2 — ровно слова владельца");
  assert.equal(d.valid, true);
  assert.equal(d.full, false, "ещё не заполнена");
});

test("22684.4 + две 22751 → занято 4, СВОБОДНО 0, пост полон (каталог закрыт)", () => {
  const d = distIn([KEY.id, KEY.id], F4);
  assert.equal(d.totalOccupied, 4);
  assert.equal(EPPosts.maxFreeSpan(d), 0, "места нет → карточки шире 0 скрыты, каталог закрыт");
  assert.equal(d.full, true);
  assert.equal(d.valid, true);
});

test("22684.4 + три 22751 → переполнение: лишние в overflow, ничего не исчезло из разметки", () => {
  const d = distIn([KEY.id, KEY.id, KEY.id], F4);
  assert.equal(d.valid, false, "третья не помещается — сборка невалидна");
  assert.equal(d.overflow.length, 1, "ровно одна клавиша в overflow");
  assert.ok(d.errors.every(e => e.type === "overflow"), "причина — переполнение, не «шире поста»");
});

test("22683.3 + одна 22751 → СВОБОДНО 1 (ровно слова владельца)", () => {
  const d = distIn([KEY.id], F3);
  assert.equal(d.totalOccupied, 2);
  assert.equal(d.totalCapacity, 3);
  assert.equal(EPPosts.maxFreeSpan(d), 1, "свободно 1");
});

test("22751 в накладке «на 1 кнопку» 22682.1 — один модуль, поведение прежнее", () => {
  const d = distIn([KEY.id], F1);
  assert.equal(d.totalOccupied, 1, "1 прорезь → правило 2-прорезей не включается");
});

test("старый пост 22684.4 с 4×22751: все 4 позиции на месте (размещены + overflow), флаг переполнения", () => {
  const d = distIn([KEY.id, KEY.id, KEY.id, KEY.id], F4);
  const placed = d.posts.reduce((n, p) => n + p.mechanismIds.length, 0);
  assert.equal(placed + d.overflow.length, 4, "ни одна из 4 клавиш не потеряна — распределены либо в overflow");
  assert.equal(d.valid, false, "переполнение помечено (окно поста покажет предупреждение)");
});

test("подпись модулей клавиш — «1–2» и «3–4» (две прорези у каждой двойной клавиши)", () => {
  const layout = EPPosts.moduleLayout([KEY.id, KEY.id], { product, mechanismSpan: spanForFrame(F4) });
  assert.deepEqual(layout.map(l => l.label), ["1–2", "3–4"]);
});

/* СМЕТА не меняется: число мест/механизмов и цена считаются «голым» mechanismSpan (postDeps в app.js
   шов НЕ применяет). Здесь проверяем суть — raw-ширина 4 клавиш остаётся 4 модуля (как до К12 ч.4). */
test("смета: raw-ширина 4×22751 = 4 модуля (постройка цены шов не трогает)", () => {
  const raw = EPPosts.moduleLayout([KEY.id, KEY.id, KEY.id, KEY.id], { product, mechanismSpan: EPCatalog.mechanismSpan })
    .reduce((s, m) => s + m.span, 0);
  assert.equal(raw, 4, "по «голой» ширине 4 клавиши = 4 модуля — смета как раньше");
});

/* МУТАЦИЯ шва: уберём учёт накладки из spanIn (вернём base) — «свободно 2» превратится в «свободно 3»
   у 22684.4 с одной клавишей, и тест обязан покраснеть. Доказываем, что проверка держит правило. */
test("мутация: шов без накладки дал бы свободно 3 (а не 2) — расхождение налицо", () => {
  const noFrameSpan = frame => item => EPCatalog.mechanismSpan(item);   // «сломанный» spanIn
  const dBroken = EPPosts.distributePosts([KEY.id], F4, { product, mechanismSpan: noFrameSpan(F4) });
  assert.equal(EPPosts.maxFreeSpan(dBroken), 3, "сломанный шов: клавиша = 1 модуль → свободно 3");
  const dReal = distIn([KEY.id], F4);
  assert.notEqual(EPPosts.maxFreeSpan(dReal), EPPosts.maxFreeSpan(dBroken), "настоящий шов даёт другое число");
});
