/* Автотесты взрыв-схемы поста (js/explodedView.js) для листа монтажника.
   Модуль чистый (как installSheet.js/postImage.js): на вход spec (детали поста) + форматтеры, на
   выход строка HTML с инлайн-стилями — браузер поднимать не нужно. ГЛАВНОЕ требование фичи: у
   КАЖДОЙ детали в подписи есть артикул. Значок детали переиспользует каталожную систему иконок
   VIMAR (pickIcon/iconSvg из EPPostImage) — поэтому в deps отдаём именно их, а не свою разметку. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml } = require("../js/explodedView.js");
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

test("артикул каждой детали присутствует в подписи", () => {
  const html = buildHtml(post, deps);
  post.parts.forEach(p => {
    assert.ok(html.includes(`Артикул: ${p.code}`), `артикул ${p.code} в подписи детали «${p.name}»`);
  });
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

test("бокс фото: у накладки широкий (wide 128×84), у товара квадратный (92×92)", () => {
  const html = buildHtml(post, deps);
  /* background:#fff отличает бокс ФОТО от плашки глифа (#f2f8ff) — так проверяем именно фото-бокс,
     а не 92×92-плашку иконки суппорта/коробки. */
  assert.ok(html.includes("width:128px;height:84px;background:#fff"), "широкий бокс под фото накладки (wide)");
  assert.ok(html.includes("width:92px;height:92px;background:#fff"), "квадратный бокс под квадратное превью товара");
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

test("механизм без товара: артикул «—», вёрстка не падает", () => {
  const html = buildHtml({ parts: [{ role: "Модуль", pos: "1", name: "Механизм не найден (арт. 99999)", code: "", icon: {} }] }, deps);
  assert.match(html, /Артикул: —/, "пустой артикул показан прочерком, а не пусто");
  assert.match(html, /Механизм не найден/, "имя-заглушка выведено");
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
