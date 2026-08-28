/* Автотесты состава и стоимости поста (PLAN 7.1).
   Запуск без зависимостей и без сборщика:  node --test tests/
   Модуль js/posts.js — чистый: каталог и подбор суппорта/коробки приходят через deps,
   поэтому браузер поднимать не нужно. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { postCost, postComposition, boxCount,
  moduleLayout, fillWord, fillSummary, nextPostNumber, ensurePostNumbers,
  frameLayout, distributePosts, maxFreeSpan, postModuleGroups } = require("../js/posts.js");

/* Каталог-заглушка на реальных артикулах VIMAR. Накладки (kind frame) несут стандарт
   и число постов ровно так, как их проставит загрузчик из колонок прайса.
   Механизм 1M — 4.30 €, 2M — 6.01 €, накладки/коробка — свои цены. */
const CATALOG = {
  1: { id: 1, code: "09001", name: "Выключатель 1М", price: 4.30, moduleSpan: 1 },
  2: { id: 2, code: "09001.2", name: "Выключатель 2М", price: 6.01, moduleSpan: 2 },
  // накладки
  14653: { id: 14653, code: "14653", name: "Накладка Plana 3М", price: 3.0, standard: "IT", series: "Plana", slotCount: 3 },
  14643: { id: 14643, code: "14643", name: "Накладка Plana 2+2", price: 5.0, standard: "DE", postCount: 2, series: "Plana", slotCount: 4 },
  14644: { id: 14644, code: "14644", name: "Накладка Plana 2+2+2", price: 7.0, standard: "DE", postCount: 3, series: "Plana", slotCount: 6 },
  9662:  { id: 9662, code: "09662", name: "Накладка Neve Up 2М", price: 3.12, standard: "unknown", series: "Neve Up", slotCount: 2 },
  9663:  { id: 9663, code: "09662.02", name: "Накладка Neve Up 2М (универс.)", price: 3.12, standard: "BOTH", series: "Neve Up", slotCount: 2 },
  // суппорт и коробки
  14613: { id: 14613, code: "14613", name: "Суппорт Plana 3М", price: 2.5, kind: "support", series: "Plana", moduleCount: 3 },
  71303: { id: 71303, code: "V71303", name: "Коробка 3М прямоуг.", price: 1.2, kind: "socket_box", wallType: "solid" },
  71001: { id: 71001, code: "V71001", name: "Коробка кругл. ø60", price: 0.85, kind: "socket_box", wallType: "solid" }
};
const product = id => CATALOG[id];
const mechanismSpan = item => (item && item.moduleSpan) || 1;
/* Универсальный подрозетник по умолчанию — как socketBox() в приложении. */
const socketBox = () => CATALOG[71001];
const baseDeps = (over) => Object.assign({ product, frameProduct: product, socketBox, mechanismSpan }, over || {});

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${msg}: получено ${actual}, ожидалось ${expected}`);

test("итальянская 3-модульная накладка: одна коробка на всю сборку", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };   // три 1М-механизма
  const comp = postComposition(post, baseDeps());
  assert.equal(comp.standard, "IT");
  assert.equal(comp.boxCount, 1, "IT — ровно одна прямоугольная коробка");
  assert.equal(comp.approximate, false);
  // цена: 3×4.30 механизмы + 3.0 накладка + 1×0.85 коробка (суппорт не подобран)
  near(postCost(post, baseDeps()), 3 * 4.30 + 3.0 + 0.85, "стоимость IT-поста");
});

test("немецкая накладка 2+2: коробка на каждый пост (2 поста)", () => {
  const post = { frameId: 14643, mechanismIds: [2, 2] };   // два 2М-механизма = 2 поста
  const comp = postComposition(post, baseDeps());
  assert.equal(comp.standard, "DE");
  assert.equal(comp.boxCount, 2, "DE 2+2 — две круглые коробки");
  assert.equal(comp.postCount, 2);
  near(postCost(post, baseDeps()), 2 * 6.01 + 5.0 + 2 * 0.85, "стоимость DE-поста 2+2");
});

test("немецкая 2+2+2 берёт число постов из накладки (postCount=3)", () => {
  const post = { frameId: 14644, mechanismIds: [2, 2, 2] };
  assert.equal(postComposition(post, baseDeps()).boxCount, 3);
});

test("немецкий стандарт без явного postCount: по 2 модуля на пост", () => {
  const frame = { id: 999, code: "X", name: "DE 4М", price: 5, standard: "DE", series: "Plana" };
  const deps = baseDeps({ frameProduct: id => (id === 999 ? frame : product(id)) });
  const post = { frameId: 999, mechanismIds: [1, 1, 1, 1] };   // 4 модуля → 2 поста
  assert.equal(postComposition(post, deps).boxCount, 2, "ceil(4/2)=2");
});

test("универсальная накладка (BOTH) 2М с двумя 1М: одна коробка (регресс бага)", () => {
  /* Раньше BOTH не имел модели и считался по числу механизмов → две коробки и завышенная
     смета на 281 накладке каталога. Правило заказчика 01.08: одна коробка на накладку. */
  const post = { frameId: 9663, mechanismIds: [1, 1] };
  const comp = postComposition(post, baseDeps());
  assert.equal(comp.standard, "BOTH");
  assert.equal(comp.boxCount, 1, "BOTH — ровно одна коробка на накладку");
  assert.equal(comp.approximate, false, "у BOTH есть настоящее правило — не приблизительно");
});

test("неизвестный стандарт: одна коробка на накладку + пометка приблизительности", () => {
  const post = { frameId: 9662, mechanismIds: [1, 1] };
  const comp = postComposition(post, baseDeps());
  assert.equal(comp.standard, "UNKNOWN");
  assert.equal(comp.approximate, true, "состав помечен приблизительным");
  assert.equal(comp.boxCount, 1, "по правилу «одна коробка на накладку», а не по числу механизмов");
});

test("старый набор deps (без стандарта/подбора): socketBox×boxCount + накладка", () => {
  /* Регресс фолбэка socketBox: при отсутствии findBox/fallbackBox цена коробки берётся
     из socketBox(). Число коробок теперь одно (правило «одна коробка на накладку»). */
  const post = { frameId: 9662, mechanismIds: [1, 1] };
  const oldDeps = { product, frameProduct: product, socketBox };
  near(postCost(post, oldDeps), 2 * 4.30 + 1 * 0.85 + 3.12, "механизмы + одна коробка + накладка");
});

test("суппорт подбирается через deps и входит в цену и состав", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findSupport: () => CATALOG[14613] });
  const comp = postComposition(post, deps);
  assert.equal(comp.support && comp.support.code, "14613", "суппорт найден");
  assert.equal(comp.supportCount, 1, "итальянская сборка — одна планка на всю накладку");
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 2.5 + 0.85, "суппорт учтён в стоимости");
});

test("ДЕФЕКТ-2: немецкая накладка 2+2 — суппорт на КАЖДЫЙ пост, а не один на сборку", () => {
  /* Ответ заказчика 26.08: «с суппортом мы тоже два берём, два по два модуля, как и
     коробок». Раньше суппорт входил в цену ровно один раз при любом числе постов —
     смета занижалась на (N−1) планок в каждой немецко-французской сборке. Гейт нарочно
     подаёт findSupport: без него суппорт равен null и регрессия снова не проверялась бы. */
  const post = { frameId: 14643, mechanismIds: [2, 2] };
  const deps = baseDeps({ findSupport: () => CATALOG[14613] });
  const comp = postComposition(post, deps);
  assert.equal(comp.boxCount, 2, "две коробки");
  assert.equal(comp.supportCount, 2, "и столько же суппортов");
  near(postCost(post, deps), 2 * 6.01 + 5.0 + 2 * 2.5 + 2 * 0.85, "в цене ДВА суппорта");
});

test("немецкая 2+2+2: суппортов столько же, сколько постов (3)", () => {
  const post = { frameId: 14644, mechanismIds: [2, 2, 2] };
  const deps = baseDeps({ findSupport: () => CATALOG[14613] });
  const comp = postComposition(post, deps);
  assert.equal(comp.supportCount, 3, "число суппортов идёт за postCount накладки");
  assert.equal(comp.supportCount, comp.boxCount, "суппорт и коробка считаются одним правилом");
});

test("суппорт не подобран — поле null, количество 0, в цену не попадает", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findSupport: () => null });
  const comp = postComposition(post, deps);
  assert.equal(comp.support, null);
  assert.equal(comp.supportCount, 0, "нечего умножать — количество ноль, а не «одна штука»");
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 0.85, "без суппорта");
});

test("подобранная коробка задаёт цену коробки вместо универсального подрозетника", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findBox: () => CATALOG[71303] });   // прямоугольная 1.2 €
  const comp = postComposition(post, deps);
  assert.equal(comp.box && comp.box.code, "V71303");
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 1 * 1.2, "цена по подобранной коробке");
});

test("фолбэк-коробка (findBox=null, fallbackBox есть) идёт в цену вместо socketBox", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findBox: () => null, fallbackBox: () => CATALOG[71303] });   // 1.2 €
  const comp = postComposition(post, deps);
  assert.equal(comp.box, null, "точная коробка не найдена");
  assert.equal(comp.boxFallback && comp.boxFallback.code, "V71303");
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 1 * 1.2, "в цене фолбэк, а не socketBox 0.85");
});

test("ДЕФЕКТ-1: нет совместимой коробки (fallbackBox=null) — цена коробки НЕ добавляется", () => {
  /* Раньше сюда подставлялся socketBox() (круглый V71001) даже под IT-накладку — цена
     заведомо неподходящего изделия. Теперь при наличии fallbackBox в deps socketBox
     как фолбэк не используется: нет коробки — нет цены коробки. */
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findBox: () => null, fallbackBox: () => null });
  const comp = postComposition(post, deps);
  assert.equal(comp.box, null);
  assert.equal(comp.boxFallback, null);
  near(postCost(post, deps), 3 * 4.30 + 3.0, "без цены коробки (socketBox 0.85 НЕ добавлен)");
});

test("пустой пост — ноль коробок, нулевая стоимость коробок", () => {
  const post = { frameId: 14653, mechanismIds: [] };
  assert.equal(postComposition(post, baseDeps()).boxCount, 0);
});

test("пустой пост: суппортов тоже ноль — цена планки не капает в смету", () => {
  /* Механизмов нет — обвязки нет: раньше цена подобранного суппорта прибавлялась
     безусловно, и пустой пост стоил «накладка + планка» без единой коробки. */
  const post = { frameId: 14653, mechanismIds: [] };
  const deps = baseDeps({ findSupport: () => CATALOG[14613] });
  assert.equal(postComposition(post, deps).supportCount, 0);
  near(postCost(post, deps), 3.0, "только накладка");
});

/* --- «Суппорт не требуется» — отдельно от «суппорт не подобран» ---
   Крышки IP55 (принцип NO_SUPPORT в номенклатуре) монтируются прямо в коробку. Пока признака
   не было, им подбиралась планка «как всем» — лишняя позиция в смете; а если бы подбор просто
   вернул null, документы напечатали бы «не подобран», то есть обвинили бы подбор в пробеле. */
test("NO_SUPPORT: суппорт не ищется вовсе, в составе флаг «не требуется»", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  let asked = 0;
  const deps = baseDeps({ supportRequired: () => false, findSupport: () => { asked++; return CATALOG[14613]; } });
  const comp = postComposition(post, deps);
  assert.equal(asked, 0, "подбор даже не вызывается — искать нечего");
  assert.equal(comp.supportNotRequired, true);
  assert.equal(comp.support, null);
  assert.equal(comp.supportCount, 0);
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 0.85, "цена планки в смету не попадает");
});

test("обычная накладка: supportNotRequired=false — «не подобран» и «не требуется» не путаются", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const found = postComposition(post, baseDeps({ supportRequired: () => true, findSupport: () => CATALOG[14613] }));
  assert.equal(found.supportNotRequired, false);
  const missing = postComposition(post, baseDeps({ supportRequired: () => true, findSupport: () => null }));
  assert.equal(missing.supportNotRequired, false, "не нашли — это пробел подбора, а не свойство изделия");
  assert.equal(missing.support, null);
});

test("deps без supportRequired (старый вызов): суппорт нужен всегда, как раньше", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ findSupport: () => CATALOG[14613] });
  const comp = postComposition(post, deps);
  assert.equal(comp.supportNotRequired, false);
  assert.equal(comp.support && comp.support.code, "14613");
});

test("старый набор deps (без findSupport): supportCount 0, регресс цены не тронут", () => {
  /* Обратная совместимость: вызывающие, которые не передают подбор суппорта, получают
     тот же состав и ту же цену, что до появления supportCount. */
  const post = { frameId: 9662, mechanismIds: [1, 1] };
  const oldDeps = { product, frameProduct: product, socketBox };
  const comp = postComposition(post, oldDeps);
  assert.equal(comp.support, null);
  assert.equal(comp.supportCount, 0);
  near(postCost(post, oldDeps), 2 * 4.30 + 1 * 0.85 + 3.12, "цена как прежде");
});

/* --- supportAssumed: «артикул подобран нами, заказчиком не подтверждён» ---
   Решение владельца: у накладок, для которых номенклатура называет только типоразмер
   («в коробку и супорт на 3 модуля»), артикул планки всё равно подставляем, но помечаем.
   Признак приезжает из EPPostFit.resolveSupport через deps.resolveSupport. */
test("supportAssumed: resolveSupport сообщил «не подтверждено» — флаг доходит до состава", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const deps = baseDeps({ resolveSupport: () => ({ support: CATALOG[14613], assumed: true }) });
  const comp = postComposition(post, deps);
  assert.equal(comp.support && comp.support.code, "14613", "артикул в расчёте есть");
  assert.equal(comp.supportAssumed, true, "и помечен как неподтверждённый");
  near(postCost(post, deps), 3 * 4.30 + 3.0 + 2.5 + 0.85, "в цену планка входит как обычно");
});

test("supportAssumed: подтверждённая пара флага не несёт", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const comp = postComposition(post, baseDeps({ resolveSupport: () => ({ support: CATALOG[14613], assumed: false }) }));
  assert.equal(comp.supportAssumed, false, "пометка обесценится, если стоять будет у всех");
});

test("supportAssumed: суппорт не подобран — флага нет (нечего помечать)", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const comp = postComposition(post, baseDeps({ resolveSupport: () => ({ support: null, assumed: true }) }));
  assert.equal(comp.support, null);
  assert.equal(comp.supportAssumed, false, "пустая строка «не подобран» пометки не получает");
});

test("supportAssumed: старый набор deps (только findSupport) работает как раньше", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  const comp = postComposition(post, baseDeps({ findSupport: () => CATALOG[14613] }));
  assert.equal(comp.support && comp.support.code, "14613");
  assert.equal(comp.supportAssumed, false, "нет resolveSupport — нет и признака, а не undefined");
});

test("boxCount экспортируется и считает независимо", () => {
  assert.equal(boxCount({ mechanismIds: [1, 1, 1] }, product(14653), "IT", baseDeps()), 1);
  assert.equal(boxCount({ mechanismIds: [2, 2] }, product(14643), "DE", baseDeps()), 2);
});

/* --- Раскладка модулей: точная позиция «2» / «2–3» (та же, что в конструкторе) --- */
test("moduleLayout: одномодульный даёт «N», двухмодульный — «N–M»", () => {
  const layout = moduleLayout([1, 2, 1], { product, mechanismSpan });   // 1М, 2М, 1М
  assert.deepEqual(layout.map(s => s.label), ["1", "2–3", "4"], "многомодульный механизм занимает диапазон");
  assert.deepEqual(layout.map(s => [s.start, s.end]), [[1, 1], [2, 3], [4, 4]]);
  assert.equal(layout[1].span, 2, "span берётся из механизма");
});

test("moduleLayout: отсутствующий в каталоге механизм считается за 1 модуль (не сливает соседей)", () => {
  const layout = moduleLayout([1, 777, 1], { product, mechanismSpan });   // 777 нет в каталоге
  assert.deepEqual(layout.map(s => s.label), ["1", "2", "3"], "пропущенный товар не обнуляет позицию");
});

/* --- Наполнение словами с количеством: «Розетка — 2, Выключатель — 1» --- */
test("fillWord: первое значимое слово названия, стоп-слова и родительный отбрасываются", () => {
  assert.equal(fillWord({ name: "Розетка 2P+T 16A" }), "Розетка");
  assert.equal(fillWord({ name: "Две  кнопки взаимоблокируемые" }), "Кнопка", "ведущее «Две» пропускается, форма нормализуется");
  assert.equal(fillWord({ name: "Механизм выключателя 1П 16AX" }), "Выключатель", "родительный → именительный");
  assert.equal(fillWord({ name: "нечто", fillWord: "Инвертор" }), "Инвертор", "явное поле имеет приоритет");
});

test("fillSummary: свод по типам с количеством в порядке первого появления", () => {
  const cat = {
    10: { id: 10, name: "Розетка 2P+T 16A", moduleSpan: 2 },
    11: { id: 11, name: "Выключатель 1П 16AX", moduleSpan: 1 }
  };
  const deps = { product: id => cat[id] };
  assert.deepEqual(fillSummary([10, 11, 10], deps), [
    { word: "Розетка", count: 2 },
    { word: "Выключатель", count: 1 }
  ]);
});

/* --- Сквозная нумерация постов: закрепляется при создании, стабильна --- */
test("nextPostNumber: максимум существующих + 1 (не переиспользует удалённые)", () => {
  assert.equal(nextPostNumber([]), 1, "первый пост — №1");
  assert.equal(nextPostNumber([{ number: 1 }, { number: 3 }]), 4, "после удаления №2 следующий — №4, номера не прыгают");
});

test("ensurePostNumbers: миграция старого проекта — недостающие номера по порядку, существующие не трогаются", () => {
  const posts = [{ number: 5 }, {}, { number: 2 }, {}];
  ensurePostNumbers(posts);
  assert.deepEqual(posts.map(p => p.number), [5, 6, 2, 7], "новые продолжают от максимума, старые на месте");
  const fresh = [{}, {}, {}];
  ensurePostNumbers(fresh);
  assert.deepEqual(fresh.map(p => p.number), [1, 2, 3], "проект без номеров — 1..N в порядке массива");
});

/* --- Раскладка накладки на посты (немецкий стандарт + двухрядные) --- */
const MECH = { 1: { id: 1, moduleSpan: 1 }, 2: { id: 2, moduleSpan: 2 }, 3: { id: 3, moduleSpan: 3 }, 4: { id: 4, moduleSpan: 4 } };
const distDeps = { product: id => MECH[id], mechanismSpan: it => (it && it.moduleSpan) || 1 };

test("frameLayout: немецкая накладка без явной раскладки делится по 2 модуля в один ряд", () => {
  const de4 = frameLayout({ standard: "DE", slotCount: 4 });   // fallback-путь (нет layoutRows)
  assert.deepEqual(de4.rows, [[2, 2]]);
  assert.equal(de4.postCount, 2);
  assert.equal(de4.multiRow, false);
  const de6 = frameLayout({ standard: "DE", slotCount: 6 });
  assert.deepEqual(de6.rows, [[2, 2, 2]]);
  assert.equal(de6.postCount, 3);
});

test("frameLayout: двухрядная итальянская «4+4» из layoutRows — два ряда по посту", () => {
  const lay = frameLayout({ standard: "IT", slotCount: 8, layoutRows: [[4], [4]] });
  assert.deepEqual(lay.rows, [[4], [4]]);
  assert.equal(lay.postCount, 2);
  assert.equal(lay.multiRow, true);
  assert.deepEqual(lay.posts.map(p => [p.row, p.capacity]), [[0, 4], [1, 4]]);
});

test("frameLayout: итальянская однорядная — один пост на всю ширину", () => {
  const lay = frameLayout({ standard: "IT", slotCount: 3 });
  assert.deepEqual(lay.rows, [[3]]);
  assert.equal(lay.postCount, 1);
  assert.equal(lay.multiRow, false);
});

test("distributePosts: немецкая 2+2 с двумя 2М — два полных поста", () => {
  const d = distributePosts([2, 2], { standard: "DE", slotCount: 4 }, distDeps);
  assert.equal(d.valid, true);
  assert.equal(d.full, true);
  assert.deepEqual(d.posts.map(p => p.mechanismIds), [[2], [2]]);
});

test("distributePosts: 2+2 с [1М,1М,2М] раскладывается без разрыва, оба поста полны", () => {
  const d = distributePosts([1, 1, 2], { standard: "DE", slotCount: 4 }, distDeps);
  assert.equal(d.valid, true);
  assert.equal(d.full, true);
  assert.deepEqual(d.posts.map(p => p.mechanismIds), [[1, 1], [2]]);
});

test("distributePosts: [1М,2М,1М] в 2+2 репакуется — 2М целиком в один пост, без ложной несовместимости", () => {
  /* Раньше next-fit ронял последний 1М в overflow (2М вставал в пост, а 1М уже некуда).
     Валидная раскладка существует: 2М в один пост, два 1М — в другой. Теперь она находится. */
  const d = distributePosts([1, 2, 1], { standard: "DE", slotCount: 4 }, distDeps);   // 1М · 2М · 1М
  assert.equal(d.valid, true, "валидная укладка есть — ложной несовместимости быть не должно");
  assert.equal(d.full, true, "4 модуля ровно на 4 — оба поста полны");
  assert.equal(d.overflow.length, 0);
  const twoModulePost = d.posts.find(p => p.mechanismIds.includes(2));
  assert.ok(twoModulePost && twoModulePost.occupied === 2, "2М лежит целиком в своём посте, не пересекая импост");
  assert.deepEqual(d.posts.map(p => p.occupied), [2, 2], "оба поста по 2 модуля");
});

test("distributePosts: набор ШИРЕ ёмкости ([2М,2М,1М] в 2+2) — overflow с причиной остаётся", () => {
  /* Здесь валидной раскладки нет в принципе (5 модулей на 4) — несовместимость обязана
     оставаться ошибкой (требование 3.2), а не глотаться репаковкой. */
  const d = distributePosts([2, 2, 1], { standard: "DE", slotCount: 4 }, distDeps);
  assert.equal(d.valid, false);
  assert.ok(d.errors.some(e => e.type === "overflow"), "лишний механизм не помещается ни в один пост");
});

test("distributePosts: 2+2+2 с [1М,1М,1М,2М,1М] — 2М целиком в посте, без ложной несовместимости (баг со скриншота)", () => {
  /* Точный кейс из репро: накладка 09666 «2+2+2» (три поста по 2), набор 1+1+1+2М+1 = 6 модулей.
     Next-fit ставил 2М верхом на импост и ронял последний 1М в overflow → «Несовместимое
     сочетание», хотя валидная раскладка есть (2М в отдельный пост, одномодульные попарно). */
  const frame = { standard: "DE", slotCount: 6, postCount: 3 };
  const d = distributePosts([1, 1, 1, 2, 1], frame, distDeps);
  assert.equal(d.valid, true, "валидная укладка существует — ложной несовместимости быть не должно");
  assert.equal(d.full, true, "6 модулей ровно на 6 — все три поста полны");
  assert.equal(d.overflow.length, 0, "ничего не выпало в overflow");
  d.posts.forEach(p => assert.ok(p.occupied <= p.capacity, "ни один пост не переполнен"));
  const twoModulePost = d.posts.find(p => p.mechanismIds.includes(2));
  assert.ok(twoModulePost && twoModulePost.occupied === 2, "2М-механизм целиком в одном посте (не пересекает импост)");
  assert.deepEqual(d.posts.map(p => p.occupied), [2, 2, 2], "все три поста по 2 модуля");
});

test("distributePosts: механизм шире поста в немецкую накладку не помещается (too-wide)", () => {
  const d = distributePosts([3], { standard: "DE", slotCount: 4 }, distDeps);   // 3М в пост на 2
  assert.equal(d.valid, false);
  const e = d.errors.find(x => x.type === "too-wide");
  assert.ok(e && e.maxCapacity === 2 && e.span === 3, "причина: механизм шире поста");
});

test("distributePosts: двухрядная «4+4» — 4М встаёт в свой ряд, посты по 4", () => {
  const frame = { standard: "IT", slotCount: 8, layoutRows: [[4], [4]] };
  const d = distributePosts([4, 4], frame, distDeps);
  assert.equal(d.valid, true);
  assert.equal(d.full, true);
  assert.deepEqual(d.posts.map(p => [p.row, p.mechanismIds]), [[0, [4]], [1, [4]]]);
  // тот же 4М в немецкий пост (ёмкость 2) — уже шире поста
  assert.equal(distributePosts([4], { standard: "DE", slotCount: 4 }, distDeps).valid, false);
});

/* --- maxFreeSpan: максимальная ширина механизма для выпадающего списка конструктора.
   Берётся наибольшее свободное место среди ВСЕХ постов, а не остаток первого поста —
   иначе 2М-механизм, который влезает во второй пост, пропадает из списка (тот самый баг). */
test("maxFreeSpan: итальянская 3М пустая → 3 (весь ряд свободен)", () => {
  const d = distributePosts([], { standard: "IT", slotCount: 3 }, distDeps);
  assert.equal(maxFreeSpan(d), 3);
});

test("maxFreeSpan: немецкая 2+2 пустая → 2 (по два модуля на пост)", () => {
  const d = distributePosts([], { standard: "DE", slotCount: 4 }, distDeps);
  assert.equal(maxFreeSpan(d), 2);
});

test("maxFreeSpan: немецкая 2+2 с 1М в первом посте → 2 (регрессия бага: 2М влезает во второй пост)", () => {
  const d = distributePosts([1], { standard: "DE", slotCount: 4 }, distDeps);
  // первый пост: занято 1 из 2 (свободно 1); второй пост пуст (свободно 2)
  assert.equal(maxFreeSpan(d), 2, "берётся свободное место второго поста, а не остаток первого");
});

test("maxFreeSpan: немецкая 2+2 полностью занятая → 0", () => {
  const d = distributePosts([2, 2], { standard: "DE", slotCount: 4 }, distDeps);
  assert.equal(maxFreeSpan(d), 0);
});

test("maxFreeSpan: двухрядная «4+4» с 4М в первом ряду → 4 (свободен второй ряд-пост)", () => {
  const frame = { standard: "IT", slotCount: 8, layoutRows: [[4], [4]] };
  const d = distributePosts([4], frame, distDeps);
  assert.equal(maxFreeSpan(d), 4, "второй ряд-пост пуст целиком");
});

test("postModuleGroups: нумерация модулей начинается заново в каждом посте", () => {
  const g = postModuleGroups([1, 1, 2], { standard: "DE", slotCount: 4 }, distDeps);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map(x => x.post), [1, 2], "пост 1, пост 2");
  assert.deepEqual(g[0].modules.map(m => m.label), ["1", "2"], "пост 1: модули 1 и 2");
  assert.deepEqual(g[1].modules.map(m => m.label), ["1–2"], "пост 2: 2М-механизм на модулях 1–2 (счёт заново)");
});

/* --- Тип стены поста и «однотипные блоки» (баг B5 со встречи 24.08) ------------------
   Заказчик разместил один пост дважды, поменял тип стены у одного — «изменилось у обоих»
   (на деле — у всего проекта: тип стены был только настройкой EP_DATA.settings). Теперь
   тип стены может быть СВОИМ у поста, а настройка проекта осталась значением по умолчанию. */
const { postWallType, postTypeKey, wallTypeTargets } = require("../js/posts.js");
/* Коробки под ту же 3М-сборку: сплошная стена дешевле полой — по ним и видно, что подбор
   пошёл по типу стены поста, а не проекта. */
const BOX_SOLID = { id: 900, code: "V71303", name: "Коробка 3М (бетон)", price: 1.04, kind: "socket_box", wallType: "solid" };
const BOX_HOLLOW = { id: 901, code: "V71703", name: "Коробка 3М (ГКЛ)", price: 6.04, kind: "socket_box", wallType: "hollow" };
const wallDeps = projectWall => baseDeps({
  wallType: projectWall,
  findBox: ({ wallType }) => (wallType === "hollow" ? BOX_HOLLOW : wallType === "solid" ? BOX_SOLID : null),
  fallbackBox: () => null
});

test("postWallType: своё значение поста главнее настройки проекта", () => {
  assert.equal(postWallType({ wallType: "hollow" }, "solid"), "hollow");
  assert.equal(postWallType({ wallType: "solid" }, "hollow"), "solid");
});

test("postWallType: у поста поля нет — читаем тип стены ПРОЕКТА (миграция старых проектов)", () => {
  assert.equal(postWallType({}, "hollow"), "hollow");
  assert.equal(postWallType({ wallType: "" }, "solid"), "solid", "пустая строка = поля нет");
  assert.equal(postWallType({ wallType: "кирпич" }, "hollow"), "hollow", "мусор = поля нет");
  assert.equal(postWallType(null, "solid"), "solid");
  assert.equal(postWallType({}, null), "unknown", "нет ни своего, ни проектного — честное unknown");
});

test("postComposition: коробка подбирается по типу стены ПОСТА, а не проекта", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1], wallType: "hollow" };
  const comp = postComposition(post, wallDeps("solid"));
  assert.equal(comp.box.id, BOX_HOLLOW.id, "пост в ГКЛ получает полую коробку, хотя проект — бетон");
  near(postCost(post, wallDeps("solid")), 3 * 4.30 + 3.0 + 6.04, "в цену идёт коробка ПОСТА");
});

test("postComposition: пост без своего типа стены по-прежнему следует за проектом", () => {
  const post = { frameId: 14653, mechanismIds: [1, 1, 1] };
  assert.equal(postComposition(post, wallDeps("hollow")).box.id, BOX_HOLLOW.id);
  assert.equal(postComposition(post, wallDeps("solid")).box.id, BOX_SOLID.id);
});

test("postTypeKey: однотипность — по накладке и набору механизмов, порядок клавиш не важен", () => {
  const a = { frameId: 14653, mechanismIds: [1, 2, 1] };
  const b = { frameId: 14653, mechanismIds: [1, 1, 2] };
  assert.equal(postTypeKey(a), postTypeKey(b), "переставленные клавиши — тот же блок");
  assert.notEqual(postTypeKey(a), postTypeKey({ frameId: 14643, mechanismIds: [1, 2, 1] }), "другая накладка");
  assert.notEqual(postTypeKey(a), postTypeKey({ frameId: 14653, mechanismIds: [1, 1] }), "другой набор");
});

test("postTypeKey: templateId и группы света на однотипность НЕ влияют", () => {
  /* templateId — мёртвое поле: после индивидуальной правки оно врёт (пост давно не такой,
     как шаблон). Группа света — свойство МЕСТА на плане: «кухня» и «спальня» это те же
     физически блоки, и стена у них может быть одна. */
  const a = { frameId: 14653, mechanismIds: [1, 1, 1], templateId: "tplA", keyGroups: ["Кухня", "", ""] };
  const b = { frameId: 14653, mechanismIds: [1, 1, 1], templateId: "tplB", keyGroups: ["Спальня", "", ""] };
  assert.equal(postTypeKey(a), postTypeKey(b));
});

test("wallTypeTargets: по умолчанию (self) адресат ровно один — сам пост", () => {
  const posts = [
    { id: "p1", frameId: 14653, mechanismIds: [1, 1, 1] },
    { id: "p2", frameId: 14653, mechanismIds: [1, 1, 1] },
    { id: "p3", frameId: 9662, mechanismIds: [2] }
  ];
  assert.deepEqual(wallTypeTargets(posts, posts[0], "self").map(p => p.id), ["p1"]);
  assert.deepEqual(wallTypeTargets(posts, posts[0]).map(p => p.id), ["p1"], "scope не задан — тоже только сам");
});

test("wallTypeTargets: sameType берёт все посты того же состава, включая уже правленные вручную", () => {
  const posts = [
    { id: "p1", frameId: 14653, mechanismIds: [1, 1, 1] },
    { id: "p2", frameId: 14653, mechanismIds: [1, 1, 1], wallType: "hollow" },   // правился отдельно
    { id: "p3", frameId: 14653, mechanismIds: [1, 2] },                          // другой набор
    { id: "p4", frameId: 9662, mechanismIds: [1, 1, 1] }                         // другая накладка
  ];
  assert.deepEqual(wallTypeTargets(posts, posts[0], "sameType").map(p => p.id), ["p1", "p2"],
    "«во всех однотипных» значит во ВСЕХ — иначе команда не делает того, что написано");
});

test("wallTypeTargets: черновик поста (ещё не записан в массив) ищет однотипные по НОВОМУ составу", () => {
  /* Так конструктор спрашивает про охват ДО записи: пост уже «станет» 2-модульным,
     и однотипными обязаны считаться блоки, похожие на собранный, а не на прежний. */
  const posts = [
    { id: "p1", frameId: 14653, mechanismIds: [1, 1, 1] },
    { id: "p2", frameId: 9662, mechanismIds: [2] }
  ];
  const draft = { id: "p1", frameId: 9662, mechanismIds: [2] };
  assert.deepEqual(wallTypeTargets(posts, draft, "sameType").map(p => p.id), ["p1", "p2"]);
});

test("wallTypeTargets: пост не из списка — целей нет (промах по id не делает массовую правку)", () => {
  const posts = [{ id: "p1", frameId: 14653, mechanismIds: [1, 1, 1] }];
  assert.deepEqual(wallTypeTargets(posts, { id: "нет-такого", frameId: 14653, mechanismIds: [1, 1, 1] }, "self"), []);
  assert.deepEqual(wallTypeTargets(posts, null, "sameType"), []);
});
