/* Вместимость кнопочной накладки Flat (К12 ч.4, переделка по словам заказчика 15.10) на НАСТОЯЩЕМ
   каталоге VIMAR через ОДИН шов spanForFrame (EPButtonFrame.spanIn + EPCatalog.mechanismSpan).
   Предмет — числа ёмкости, которые окно поста показывает человеку: «свободно N», переполнение,
   подписи модулей «1»/«2». Одна клавиша 22751 = одна прорезь, поэтому в 22684.4 встают 4 клавиши.
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

test("22684.4 + одна 22751 → занято 1, СВОБОДНО 3, пост валиден и ещё не полон", () => {
  const d = distIn([KEY.id], F4);
  assert.equal(d.totalOccupied, 1, "одна клавиша — одна прорезь (переделка 15.10)");
  assert.equal(d.totalCapacity, 4);
  assert.equal(EPPosts.maxFreeSpan(d), 3, "свободно 3 — ещё три клавиши влезут");
  assert.equal(d.valid, true);
  assert.equal(d.full, false, "ещё не заполнена");
});

test("22684.4 + четыре 22751 → занято 4, СВОБОДНО 0, пост полон (заказ 15: 4 клавиши в 4 прорези)", () => {
  const d = distIn([KEY.id, KEY.id, KEY.id, KEY.id], F4);
  assert.equal(d.totalOccupied, 4);
  assert.equal(EPPosts.maxFreeSpan(d), 0, "места нет → карточки шире 0 скрыты, каталог закрыт");
  assert.equal(d.full, true);
  assert.equal(d.valid, true, "ровно 4 клавиши помещаются — сборка валидна");
});

test("22684.4 + пять 22751 → переполнение: пятая в overflow, ничего не исчезло из разметки", () => {
  const d = distIn([KEY.id, KEY.id, KEY.id, KEY.id, KEY.id], F4);
  assert.equal(d.valid, false, "пятая не помещается — сборка невалидна");
  assert.equal(d.overflow.length, 1, "ровно одна клавиша в overflow");
  assert.ok(d.errors.every(e => e.type === "overflow"), "причина — переполнение, не «шире поста»");
  const placed = d.posts.reduce((n, p) => n + p.mechanismIds.length, 0);
  assert.equal(placed + d.overflow.length, 5, "ни одна из 5 клавиш не потеряна");
});

test("22683.3 + одна 22751 → СВОБОДНО 2", () => {
  const d = distIn([KEY.id], F3);
  assert.equal(d.totalOccupied, 1);
  assert.equal(d.totalCapacity, 3);
  assert.equal(EPPosts.maxFreeSpan(d), 2, "свободно 2");
});

test("22751 в накладке «на 1 кнопку» 22682.1 — один модуль, поведение прежнее", () => {
  const d = distIn([KEY.id], F1);
  assert.equal(d.totalOccupied, 1, "одна прорезь — одна клавиша");
});

test("подпись модулей клавиш — «1» и «2» (каждая 22751 занимает один модуль)", () => {
  const layout = EPPosts.moduleLayout([KEY.id, KEY.id], { product, mechanismSpan: spanForFrame(F4) });
  assert.deepEqual(layout.map(l => l.label), ["1", "2"]);
});

/* СМЕТА не меняется: число мест/механизмов и цена считаются «голым» mechanismSpan (postDeps в app.js
   шов НЕ применяет). Здесь проверяем суть — raw-ширина 4 клавиш остаётся 4 модуля (как до К12 ч.4). */
test("смета: raw-ширина 4×22751 = 4 модуля (постройка цены шов не трогает)", () => {
  const raw = EPPosts.moduleLayout([KEY.id, KEY.id, KEY.id, KEY.id], { product, mechanismSpan: EPCatalog.mechanismSpan })
    .reduce((s, m) => s + m.span, 0);
  assert.equal(raw, 4, "по «голой» ширине 4 клавиши = 4 модуля — смета как раньше");
});

/* МУТАЦИЯ шва: если спан клавиши в накладке снова станет 2 (как было до переделки 15.10), 22684.4 с
   четырьмя клавишами переполнится (влезут только две) — а по новому правилу все 4 помещаются. Тест
   обязан покраснеть на такой мутации. Доказываем, что проверка держит именно «одна клавиша = 1 прорезь». */
test("мутация: span=2 переполнил бы 22684.4 четырьмя клавишами — настоящее правило вмещает все 4", () => {
  const span2 = frame => item =>
    EPButtonFrame.isButtonFrame(frame) && EPCatalog.mechanismSpan(item) ? 2 : EPCatalog.mechanismSpan(item);
  const four = [KEY.id, KEY.id, KEY.id, KEY.id];
  const dBroken = EPPosts.distributePosts(four, F4, { product, mechanismSpan: span2(F4) });
  assert.equal(dBroken.valid, false, "сломанный шов (span=2): 4 клавиши не влезают в 4 прорези");
  const dReal = distIn(four, F4);
  assert.equal(dReal.valid, true, "настоящий шов: 4 клавиши = 4 прорези, пост валиден");
  assert.notEqual(dReal.valid, dBroken.valid, "правило реально влияет на вместимость");
});
