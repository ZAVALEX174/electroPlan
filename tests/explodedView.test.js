/* Автотесты взрыв-схемы поста (js/explodedView.js) для листа монтажника.
   Модуль чистый (как installSheet.js/postImage.js): на вход spec (детали поста) + форматтеры, на
   выход строка HTML с инлайн-стилями — браузер поднимать не нужно. ГЛАВНОЕ требование фичи: у
   КАЖДОЙ детали в подписи есть артикул. Значок детали переиспользует каталожную систему иконок
   VIMAR (pickIcon/iconSvg из EPPostImage) — поэтому в deps отдаём именно их, а не свою разметку. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml, layoutColumns, layout, shortenName, linesNeeded } = require("../js/explodedView.js");
const { pickIcon, iconSvg } = require("../js/postImage.js");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc, pickIcon, iconSvg };

/* Пост как его собирает оркестратор: накладка (широкое фото, wide) → механизмы (квадратные фото) →
   суппорт → коробка. Фото у КАЖДОЙ детали — как в референсе VIMAR (buildExplodedSpec тянет их
   каталожным productImage); у товаров без фото photo:null и деталь падает на глиф. */
const post = {
  parts: [
    { role: "Накладка", name: "Накладка Neve Up 3М", code: "09663",
      icon: { categoryId: 100, icon: "□", name: "Накладка Neve Up 3М" },
      photo: { imageUrl: "https://vimar.example/09663.jpg", wide: true } },
    { role: "Модуль", pos: "1", name: "Выключатель 1П 16AX", code: "20001",
      icon: { categoryId: 500, icon: "⌁", name: "Выключатель 1П 16AX" },
      photo: { imageUrl: "https://vimar.example/20001.jpg" } },
    { role: "Модуль", pos: "2–3", name: "Розетка 2P+T 16A", code: "20208",
      icon: { categoryId: 300, icon: "◉", name: "Розетка 2P+T 16A" },
      photo: { imageUrl: "https://vimar.example/20208.jpg" } },
    { role: "Суппорт", name: "Суппорт Neve Up 3М", code: "09613",
      icon: { categoryId: 200, icon: "≡", name: "Суппорт Neve Up 3М" } },
    { role: "Монтажная коробка", name: "Коробка 3М", code: "V71303",
      icon: { categoryId: 200, icon: "○", name: "Коробка 3М" } }
  ]
};

/* ---- раскладка колонок ряда: чистая функция layoutColumns (K11) --------------------------
   Механизмы (role==="Модуль") сворачиваются в стек по Y, но не выше двух рядов: лишние уходят в
   соседнюю колонку. Так взрыв-схема немецко-французской сборки на 3–4 механизма перестаёт быть
   высоким «вертикальным крестом» и влезает в лист рядом с иллюстрацией. Прежний контракт (1 механизм —
   одиночная колонка, 2 — один стек) сохранён, иначе рассыпались бы геометрические тесты ниже. */
const rolesOf = (nMech) => ["Накладка"].concat(Array(nMech).fill("Модуль"), ["Суппорт", "Монтажная коробка"]);

test("layoutColumns: один механизм — одиночная колонка (горизонтальный ряд, прежний контракт)", () => {
  assert.deepEqual(layoutColumns(rolesOf(1)), [[0], [1], [2], [3]]);
});

test("layoutColumns: два механизма — ОДНА колонка-стек (прежний контракт, тесты геометрии ниже)", () => {
  assert.deepEqual(layoutColumns(rolesOf(2)), [[0], [1, 2], [3], [4]]);
});

test("layoutColumns: три механизма ложатся в ДВЕ колонки, стек не выше двух рядов", () => {
  const cols = layoutColumns(rolesOf(3));
  assert.deepEqual(cols, [[0], [1, 2], [3], [4], [5]]);
  const mechCols = cols.slice(1, -2);                 // между накладкой и суппортом/коробкой
  assert.equal(mechCols.length, 2, "механизмы разложены в две колонки, а не в одну высокую");
  assert.ok(mechCols.every(c => c.length <= 2), "ни одна колонка стека не выше двух рядов");
});

test("layoutColumns: четыре механизма — 2×2, высота всё ещё два ряда (ни при каком числе не растёт)", () => {
  const cols = layoutColumns(rolesOf(4));
  const mechCols = cols.slice(1, -2);
  assert.deepEqual(mechCols, [[1, 2], [3, 4]]);
  assert.ok(mechCols.every(c => c.length <= 2), "высота стека ограничена двумя рядами и на четырёх механизмах");
  const six = layoutColumns(rolesOf(6)).slice(1, -2);
  assert.ok(six.every(c => c.length <= 2), "и на шести механизмах высота не превышает двух рядов");
});

test("layoutColumns: нет механизмов — каждая деталь своя колонка (вырожденный ряд)", () => {
  assert.deepEqual(layoutColumns(["Накладка", "Суппорт"]), [[0], [1]]);
  assert.deepEqual(layoutColumns([]), []);
});

/* ---- раскладка НЕ ПЕРЕСЕКАЕТСЯ: прямоугольники бокс/подпись в дизайн-координатах (K11, раунд 2) ----
   Дефект приёмки: подпись механизма налезала на картинку соседнего и слова рвались посреди. Корень —
   схему сжимал max-width, рассинхронив px-боксы и %-позиции. Чиним рендером 1:1 (installSheet), а ЗДЕСЬ
   держим контракт раскладки: в координатах сцены НИ ОДИН прямоугольник (бокс детали ИЛИ зарезервированная
   подпись labW×labH) не пересекается с чужим. Схема печатается 1:1, поэтому непересечение в этих
   координатах = непересечение на бумаге. Чистая layout() позволяет проверить это без браузера. */
const partsWith = nMech => {
  const p = [{ role: "Накладка", name: "Накладка на 4 модуля (2+2), белая", code: "09664.01", photo: { imageUrl: "f", wide: true } }];
  for (let i = 0; i < nMech; i++) p.push({ role: "Модуль", pos: String(i + 1), name: "Выключатель 1П 16AX 1 модуль, белый", code: "09001", photo: { imageUrl: "m" } });
  p.push({ role: "Суппорт", name: "Суппорт для 2 модулей 71мм с защелками", code: "09602.1" });
  p.push({ role: "Монтажная коробка", name: "Коробка встраиваемая круглая для 1-2 модулей", code: "V71001" });
  return p;
};
/* Все прямоугольники сцены: по каждой детали — бокс (картинка/глиф) и зарезервированная подпись. */
const rectsOf = L => {
  const r = [];
  L.items.forEach((it, i) => {
    r.push({ t: `бокс#${i}`, x: it.cx - it.bw / 2, y: it.cy - it.bh / 2, w: it.bw, h: it.bh });
    r.push({ t: `подпись#${i}`, x: it.labLeft, y: it.labTop, w: it.labW, h: it.labH });
  });
  return r;
};
const overlapsIn = rects => {
  const ov = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  const hits = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++)
    if (ov(rects[i], rects[j])) hits.push(`${rects[i].t} ∩ ${rects[j].t}`);
  return hits;
};

[1, 2, 3, 4, 6].forEach(nMech => {
  test(`layout: прямоугольники бокс/подпись НЕ пересекаются (${nMech} механизма)`, () => {
    const hits = overlapsIn(rectsOf(layout(partsWith(nMech))));
    assert.deepEqual(hits, [], `пересечения в раскладке: ${hits.join("; ")}`);
  });
});

test("layout: ширина подписи вмещает самое длинное слово (слова не рвутся при 1:1)", () => {
  /* Схема печатается 1:1, значит фактическая ширина подписи = labW (px). Самое длинное слово
     наименования («Выключатель»/«встраиваемая») ≈ 77px при 11px-шрифте (замерено в Chrome).
     Если labW станет меньше — слово начнёт рваться посреди (дефект приёмки). Гейт — labW ≥ 78. */
  const L = layout(partsWith(3));
  L.items.forEach((it, i) => assert.ok(it.labW >= 78, `подпись #${i} шириной ${it.labW}px < 78px — длинное слово порвётся`));
});

/* ---- shortenName: сокращение наименования подписи до двух строк ПО ШИРИНЕ (владелец 26.10) --------
   Второй аргумент теперь — ШИРИНА бокса подписи в px (LABEL_W=80), а не число символов: 22 символа двум
   строкам не равны (жирным 11px «Ш» вдвое шире «i»), раньше это давало третью строку и line-clamp рвал
   слово. Оценку ширины держит linesNeeded; тест ниже гоняет её по всему каталогу. */
const W = 80;   // LABEL_W подписи схемы

test("shortenName: имя, влезающее в две строки, возвращается как есть, без «…»", () => {
  const r = shortenName("Выключатель 1П 16AX", W);
  assert.equal(r, "Выключатель 1П 16AX");
  assert.ok(linesNeeded(r, W) <= 2, "и оно действительно укладывается в 2 строки");
  assert.equal(shortenName("", W), "");
  assert.equal(shortenName(null, W), "");
});

test("shortenName: длинное имя режется ПО СЛОВУ, оканчивается «…» и влезает в 2 строки", () => {
  const src = "Коробка встраиваемая круглая для 1-2 модулей";
  const r = shortenName(src, W);
  assert.ok(r.endsWith("…"), "есть многоточие обрезки");
  assert.ok(linesNeeded(r, W) <= 2, `«${r}» укладывается в 2 строки`);
  /* рез именно по границе слова: без «…» остаются целые слова исходника */
  const kept = r.slice(0, -1);
  assert.ok(src.startsWith(kept), "сохранён префикс из целых слов");
  assert.ok(!/\s$/.test(kept), "перед «…» нет висячего пробела");
});

test("shortenName: висячая пунктуация перед «…» снимается (владелец 26.10: «модуля,…» → «модуля…»)", () => {
  /* У «Накладка на 3 модуля, белая» после слова «модуля» стоит запятая; в подписи она не должна
     прилипнуть к многоточию. */
  const r = shortenName("Накладка на 3 модуля, белая", W);
  assert.ok(r.endsWith("модуля…"), `«${r}» — без запятой перед «…»`);
  assert.ok(!/[,\s]…$/.test(r), "перед «…» нет запятой или пробела");
});

test("shortenName: первое слово шире бюджета режется посимвольно (одно длинное слово не остаётся целиком)", () => {
  const r = shortenName("Электроустановочноеизделие", W);   // одно слово, шире двух строк по 80px
  assert.ok(r.endsWith("…"), `жёсткий рез с многоточием: «${r}»`);
  assert.ok(linesNeeded(r, W) <= 2, "результат укладывается в 2 строки");
  assert.ok("Электроустановочноеизделие".startsWith(r.slice(0, -1)), "сохранено начало слова");
});

/* ---- Д3/Д6: оценка ширины укладывает ВСЕ имена каталога в 2 строки ----------------------------
   shortenName обязана по оценке linesNeeded уложить КАЖДОЕ наименование каталога в 2 строки по LABEL_W.
   Это не тавтология: мутация, занижающая перенос (например, считать дефис неразрывным), красит тест —
   имена с дефисом («Механизм-выключатель») тогда выходят на 3-ю строку. Каталог грузим через window-шим
   (файл кладёт в window.EP_VIMAR_CATALOG, module.exports у него нет). */
test("Д3: shortenName укладывает ВСЕ имена каталога в 2 строки по оценке (0 превышений)", () => {
  global.window = global.window || {};
  require("../js/catalog-vimar.js");
  const products = global.window.EP_VIMAR_CATALOG.products;
  const names = [...new Set(products.map(p => String(p.name || "")).filter(Boolean))];
  const over = names.filter(n => linesNeeded(shortenName(n, W), W) > 2);
  assert.equal(over.length, 0, `имена, не влезшие в 2 строки: ${over.slice(0, 5).join(" | ")}`);
  assert.ok(names.length > 2000, `каталог загружен (${names.length} имён)`);
});

/* ---- Д6: buildHtml выводит СОКРАЩЁННОЕ имя, а не полное (мутация «печатать p.name» краснеет) ---- */
test("buildHtml печатает сокращённое имя подписи, а не полное наименование", () => {
  const longName = "Механизм-переключатель 1P 10AX с подсветкой белый";
  const html = buildHtml({ parts: [{ role: "Модуль", pos: "1", name: longName, code: "20003", icon: {} }] }, deps);
  const shortExpected = shortenName(longName, W);
  assert.ok(shortExpected !== longName && shortExpected.endsWith("…"), "фикстура: имя реально сокращается");
  assert.ok(html.includes(esc(shortExpected)), "в HTML стоит сокращённая строка подписи");
  assert.ok(!html.includes(esc(longName)), "полного наименования в подписи нет (иначе мутация «печатать p.name» зелёная)");
});

/* ---- Д1/Д6: при многих деталях схема НЕ шире карточки, а стек растёт в высоту ------------------
   Клавиша с механизмом группы света = две детали «Модуль» (клавиша + механизм). На 4 и 6 клавишах это 8
   и 12 деталей: прежде схема росла вбок (sceneW до 826), вылезала за карточку (≈654px на A4) и max-width:
   100% рассинхронивал подписи. Теперь layout наращивает рядность — ширина сцены ≤ ширины карточки,
   пересечений нет. */
const CARD_W = 654;   // внутренняя ширина карточки листа на A4
const keysWithMech = nKeys => {
  const p = [{ role: "Накладка", name: "Накладка 4М", code: "09664", photo: { imageUrl: "f", wide: true } }];
  for (let i = 1; i <= nKeys; i++) {
    p.push({ role: "Модуль", pos: String(i), name: "Выключатель 1П 16AX", code: "20001", photo: { imageUrl: "m" } });
    p.push({ role: "Модуль", pos: `${i} · механизм`, name: "Механизм переключателя 1P 10AX", code: "09004.0", photo: { imageUrl: "m" } });
  }
  p.push({ role: "Суппорт", name: "Суппорт 4М", code: "09614" });
  p.push({ role: "Монтажная коробка", name: "Коробка 4М", code: "V71304" });
  return p;
};
[4, 6].forEach(nKeys => {
  test(`layout: схема из ${nKeys} клавиш с механизмами (${nKeys * 2} деталей) не шире карточки и без пересечений`, () => {
    const L = layout(keysWithMech(nKeys));
    assert.ok(L.sceneW <= CARD_W, `ширина сцены ${L.sceneW}px ≤ ${CARD_W}px (не вылезает за карточку)`);
    assert.deepEqual(overlapsIn(rectsOf(L)), [], "прямоугольники бокс/подпись не пересекаются");
  });
});

/* ---- Д4: детали одной клавиши (клавиша + механизм + подсветка) не делятся между колонками -------- */
test("layoutColumns: детали одной клавиши держатся одной колонкой (Д4)", () => {
  const parts = [
    { role: "Накладка" },
    { role: "Модуль", pos: "1" }, { role: "Модуль", pos: "1 · механизм" }, { role: "Модуль", pos: "1 · подсветка" },
    { role: "Модуль", pos: "2" }, { role: "Модуль", pos: "2 · механизм" },
    { role: "Суппорт" }, { role: "Монтажная коробка" }
  ];
  const cols = layoutColumns(parts);
  assert.ok(cols.some(c => c.join(",") === "1,2,3"), `детали клавиши 1 одной колонкой: ${JSON.stringify(cols)}`);
  assert.ok(cols.some(c => c.join(",") === "4,5"), "детали клавиши 2 одной колонкой");
  const key1 = new Set([1, 2, 3]), key2 = new Set([4, 5]);
  cols.forEach(c => {
    const has1 = c.some(i => key1.has(i)), has2 = c.some(i => key2.has(i));
    assert.ok(!(has1 && has2), `колонка ${JSON.stringify(c)} смешала детали разных клавиш`);
  });
});

test("код каждой детали присутствует в подписи отдельной моноширинной строкой (без слова «Артикул:»)", () => {
  /* Владелец 26.10: слово «Артикул:» убрано, остаётся только код моноширинным. Проверяем код ИМЕННО
     в строке подписи (monospace-блок), а не где угодно: коды деталей встречаются и в URL фото
     (…/09663.jpg), поэтому голый includes(code) был бы ложно-зелёным. */
  const html = buildHtml(post, deps);
  post.parts.forEach(p => {
    assert.ok(html.includes(`monospace;margin-top:1px;overflow-wrap:anywhere">${p.code}</div>`),
      `код ${p.code} в моноширинной строке подписи детали «${p.name}»`);
  });
  assert.ok(!/Артикул:/.test(html), "слова «Артикул:» в подписях схемы больше нет");
});

test("накладка с фото рисуется <img>, а не глифом", () => {
  const html = buildHtml(post, deps);
  assert.match(html, /<img src="https:\/\/vimar\.example\/09663\.jpg"/, "фото накладки-подложки вставлено");
});

test("фото рисуется у КАЖДОЙ детали каталога, а не только у накладки", () => {
  const html = buildHtml(post, deps);
  assert.match(html, /<img src="https:\/\/vimar\.example\/20001\.jpg"/, "фото механизма-выключателя вставлено");
  assert.match(html, /<img src="https:\/\/vimar\.example\/20208\.jpg"/, "фото механизма-розетки вставлено");
});

test("бокс фото: у накладки широкий (wide 86×56), у товара квадратный (64×64)", () => {
  const html = buildHtml(post, deps);
  /* background:#fff отличает бокс ФОТО от плашки глифа (#f2f8ff) — так проверяем именно фото-бокс,
     а не 64×64-плашку иконки суппорта/коробки. Размеры уменьшены в K11 (раунд 3), чтобы стек
     механизмов был ниже и карточки плотнее ложились на страницу; пропорция широкого бокса сохранена (≈1.53). */
  assert.ok(html.includes("width:86px;height:56px;background:#fff"), "широкий бокс под фото накладки (wide)");
  assert.ok(html.includes("width:64px;height:64px;background:#fff"), "квадратный бокс под квадратное превью товара");
});

test("деталь без фото (суппорт/коробка) — каталожный глиф, а не пустой <img>", () => {
  /* Суппорт и коробка в фикстуре без photo — регресс-гейт: не должны эмитить <img> (тем более
     пустой src), только глиф. */
  const html = buildHtml({ parts: [post.parts[3], post.parts[4]] }, deps);
  assert.ok(!/<img/.test(html), "без фото <img> не появляется");
  assert.match(html, /<line x1="5" y1="8"/, "суппорт нарисован каталожным глифом");
});

test("накладка без пригодного фото — глифом по kind (фото не выдумываем)", () => {
  const noPhoto = { parts: [Object.assign({}, post.parts[0], { photo: null })] };
  const html = buildHtml(noPhoto, deps);
  assert.ok(!/<img/.test(html), "без фото картинки нет");
  /* □ (frame) в общей системе падает на generic-глиф — его разметка (скруглённый квадрат). */
  assert.match(html, /<rect x="6\.6" y="6\.6"/, "накладка нарисована каталожным глифом");
});

test("глиф детали берётся из каталожной системы иконок (pickIcon+iconSvg)", () => {
  /* Суппорт (icon «≡») → тип support → у него три горизонтали (iconMarkup support). Так
     проверяем, что взрыв-схема рисует ТОТ ЖЕ глиф, что и конструктор, а не свой. */
  assert.equal(pickIcon(post.parts[3].icon), "support", "≡ → суппорт (общая система)");
  const html = buildHtml({ parts: [post.parts[3]] }, deps);
  assert.match(html, /<line x1="5" y1="8"/, "разметка глифа суппорта из iconSvg");
});

/* НЕ ПОКРЫТО ЗДЕСЬ: формирование кикера «Суппорт ×2» (сколько планок ставить). Число
   приписывается к role в buildExplodedSpec — это app.js, который в тесты не грузится, а
   этот модуль лишь печатает переданную строку. Тест, который сам кладёт в part.role
   «Суппорт ×2» и находит её в HTML, проверял бы вывод любой строки (тот же кикер уже
   покрыт тестом «Модуль 2–3» ниже) и создавал бы ложное чувство покрытия — поэтому его
   здесь нет. Покрыть можно только вынеся buildExplodedSpec из app.js в чистый модуль. */

test("позиция модуля попадает в подпись (кикер «Модуль 2–3»)", () => {
  const html = buildHtml(post, deps);
  assert.match(html, /Модуль 2–3/, "позиция многомодульного механизма показана");
});

test("выносные линии и ось-«шампур» присутствуют (SVG-слой)", () => {
  const html = buildHtml(post, deps);
  /* W теперь зависит от числа деталей (ряд) — viewBox не пришпилен к 480, проверяем только формат. */
  assert.match(html, /<svg viewBox="0 0 \d+ \d+"/, "сцена SVG с viewBox W×H");
  assert.match(html, /<polyline points=/, "ось разнесённой сборки");
  assert.match(html, /<line /, "тик-соединители от иконок к подписям");
});

/* Центры боксов деталей в px «дизайна». Узлы (плашки/фото) в HTML — единственные блоки с
   transform:translate(-50%,-50%), поэтому их left/top — это центр бокса; порядок узлов = порядок parts.
   Размеры сцены берём из viewBox, % переводим в px. Подписи не матчатся (у них нет translate). */
function nodeCenters(html) {
  const vb = html.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const W = Number(vb[1]), H = Number(vb[2]);
  const re = /left:([\d.]+)%;top:([\d.]+)%;transform:translate\(-50%,-50%\);box-sizing:border-box;width:(\d+)px;height:(\d+)px/g;
  const out = []; let m;
  while ((m = re.exec(html))) out.push({ x: Number(m[1]) / 100 * W, y: Number(m[2]) / 100 * H, w: Number(m[3]), h: Number(m[4]) });
  return { W, H, nodes: out };
}

test("один механизм → горизонтальный ряд, как раньше (стек из одной карточки)", () => {
  /* Пост с единственным механизмом: накладка + 1 модуль + суппорт + коробка. Стек из одной карточки
     не «тянет» сцену вверх, поэтому все боксы садятся на одну ось Y (прежний ряд), у каждой детали —
     своя X-позиция. */
  const one = { parts: [post.parts[0], post.parts[1], post.parts[3], post.parts[4]] };
  const { nodes } = nodeCenters(buildHtml(one, deps));
  assert.equal(nodes.length, 4, "четыре карточки");
  assert.ok(nodes.every(nd => Math.abs(nd.y - nodes[0].y) < 0.01), "все боксы на одной оси Y (горизонтальный ряд)");
  const xs = nodes.map(nd => nd.x.toFixed(2));
  assert.equal(new Set(xs).size, 4, "у каждой детали своя X-позиция");
});

test("несколько механизмов — одна X-позиция, вертикальный стек по Y с чистым просветом", () => {
  /* Оба механизма (parts[1], parts[2]) — на ОДНОМ center X (свёрнуты в колонку-стек), второй ниже
     первого, между боксами — явный чистый просвет (расстояние центров минус высота бокса ≥ 20px). */
  const { nodes } = nodeCenters(buildHtml(post, deps));
  const mod1 = nodes[1], mod2 = nodes[2];
  assert.ok(Math.abs(mod1.x - mod2.x) < 0.01, "оба механизма на одной оси X (единый слот стека)");
  assert.ok(mod2.y > mod1.y, "второй механизм ниже первого (стек вниз)");
  const gapY = (mod2.y - mod1.y) - mod1.h;
  assert.ok(gapY >= 20, `чистый вертикальный просвет в стеке = ${gapY}px (нужно ≥20)`);
});

test("накладка/суппорт/коробка — на своих X-позициях, отличных от стека механизмов", () => {
  /* Одиночные детали не сливаются со стеком: у накладки, стека, суппорта и коробки — четыре разных
     center X, между соседними колонками — чистый горизонтальный просвет ≥ 20px. */
  const { nodes } = nodeCenters(buildHtml(post, deps));
  const frame = nodes[0], stackX = nodes[1].x, support = nodes[3], box = nodes[4];
  const colX = [frame.x, stackX, support.x, box.x];
  assert.equal(new Set(colX.map(x => x.toFixed(2))).size, 4, "четыре различные X-позиции колонок");
  /* Горизонтальный просвет между колонками: шаг центров минус полуширины соседних боксов. Полуширины:
     накладка (wide) 64, стек 46 (квадратный механизм), суппорт/коробка (глиф) 46. */
  const half = [frame.w / 2, nodes[1].w / 2, support.w / 2, box.w / 2];
  for (let i = 1; i < colX.length; i++) {
    const gap = (colX[i] - colX[i - 1]) - (half[i] + half[i - 1]);
    assert.ok(gap >= 20, `чистый горизонтальный просвет между колонками ${i} и ${i + 1} = ${gap}px (нужно ≥20)`);
  }
});

test("центры колонок (ось-«шампур») лежат на одной горизонтали", () => {
  /* Ось-«шампур» проходит через центр каждой колонки на общем уровне axisY — её точки = center X колонок,
     все с одинаковым Y. При стеке из 2 механизмов колонок четыре: накладка, стек, суппорт, коробка. */
  const m = buildHtml(post, deps).match(/<polyline points="([^"]+)"/);
  assert.ok(m, "ось-шампур присутствует");
  const pts = m[1].trim().split(/\s+/).map(s => s.split(",").map(Number));
  assert.equal(pts.length, 4, "четыре колонки: накладка, стек механизмов, суппорт, коробка");
  assert.ok(pts.every(p => p[1] === pts[0][1]), "все центры колонок на одной оси Y");
});

test("пользовательский ввод в имени экранируется", () => {
  const html = buildHtml({ parts: [{ role: "Модуль", pos: "1", name: 'Кнопка <b>X</b>', code: "20002", icon: { categoryId: 500 } }] }, deps);
  assert.match(html, /Кнопка &lt;b&gt;X&lt;\/b&gt;/, "тег из названия экранирован");
});

test("механизм без товара: код «—», вёрстка не падает", () => {
  const html = buildHtml({ parts: [{ role: "Модуль", pos: "1", name: "Механизм не найден (арт. 99999)", code: "", icon: {} }] }, deps);
  assert.match(html, /monospace;margin-top:1px;overflow-wrap:anywhere">—<\/div>/, "пустой код показан прочерком, а не пусто");
  assert.match(html, /Механизм не найден/, "имя-заглушка выведено (сокращение сохраняет начало)");
});

test("пост без деталей не роняет вёрстку (пустая строка)", () => {
  assert.equal(buildHtml({ parts: [] }, deps), "", "нет деталей — блок не рисуется");
  assert.equal(buildHtml({}, deps), "", "нет parts вовсе — тоже пусто");
  assert.equal(buildHtml(null, deps), "", "нет spec — тоже пусто");
});

test("без deps.iconSvg модуль не падает (фолбэк на текстовый глиф)", () => {
  const html = buildHtml({ parts: [post.parts[3]] }, { esc });
  /* SVG-слой выносных линий есть всегда; проверяем именно, что ГЛИФ детали не из iconSvg
     (нет разметки суппорта), а текстовый фолбэк-символ показан. */
  assert.ok(!/<line x1="5" y1="8"/.test(html), "без iconSvg разметки глифа суппорта нет");
  assert.match(html, /≡/, "показан текстовый глиф детали как фолбэк");
});

test("детерминизм: одинаковый вход — одинаковый выход", () => {
  assert.equal(buildHtml(post, deps), buildHtml(post, deps), "чистая функция без побочных эффектов");
});
