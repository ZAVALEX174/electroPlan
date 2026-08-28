/* Автотесты листа монтажника (PLAN 11).
   Запуск без зависимостей и без сборщика:  node --test tests/
   Модуль js/installSheet.js — чистый: на вход готовые данные и esc, на выход строка HTML,
   поэтому браузер поднимать не нужно. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml, buildFittings, cardModuleOrder } = require("../js/installSheet.js");
/* Род пробела (поставка или незаполненный проект) — общий для всех документов словарь. */
const LG = require("../js/lightingGroups.js");

/* esc как в приложении — чтобы проверить экранирование пользовательского ввода. */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

const italianPost = {
  number: 3, room: "Кухня", standardLabel: "итальянский · одна коробка на сборку",
  frameName: "Накладка Neve Up 3М", frameCode: "09663", color: "Карбон матовый",
  modules: [
    { label: "1", name: "Выключатель 1П 16AX", code: "20001", note: "" },
    { label: "2–3", name: "Розетка 2P+T 16A", code: "20208", note: "занимает 2 модуля" }
  ],
  fittings: [
    { role: "Суппорт", name: "Суппорт Neve Up 3М", code: "09613", count: 1 },
    { role: "Монтажная коробка", name: "Коробка 3М", code: "V71303", count: 1 },
    { role: "Накладка", name: "Накладка Neve Up 3М", code: "09663", count: 1 }
  ],
  german: null
};

/* Примечание немецкого стандарта отдельно от остального листа: имя суппорта встречается
   и в блоке обвязки, поэтому проверять текст примечания надо ровно в его границах.
   Ищем именно вёрстку (class="german-note"), а не слово: селектор с тем же именем есть
   и в <style> листа. */
const germanNoteOf = html => {
  const from = html.indexOf('<div class="german-note">');
  return from < 0 ? "" : html.slice(from, html.indexOf("</div>", from));
};

/* РОВНО одна строка таблицы (<tr>…</tr>), содержащая подстроку needle. Окно «N символов от
   вхождения» для этого не годится: строки обвязки короткие, и такое окно захватывает
   СЛЕДУЮЩУЮ строку таблицы — проверка количества в строке суппорта проходила из-за
   количества у коробки под ней (обе по 2 шт.) и не покраснела бы при count:1 у суппорта.
   Границы режем по разметке: назад до ближайшего «<tr», вперёд до ближайшего «</tr>». */
const tableRowWith = (html, needle) => {
  const at = html.indexOf(needle);
  assert.notEqual(at, -1, `в документе нет строки с «${needle}»`);
  const from = html.lastIndexOf("<tr", at);
  const to = html.indexOf("</tr>", at);
  assert.ok(from >= 0 && to > from, `«${needle}» найдено вне строки таблицы`);
  return html.slice(from, to + "</tr>".length);
};

test("одиночный пост: заголовок с номером, таблица модулей и обвязка", () => {
  const html = buildHtml({ posts: [italianPost] }, deps);
  assert.match(html, /Пост № 3/, "номер поста в шапке");
  assert.match(html, /2–3/, "точная позиция многомодульного механизма");
  assert.match(html, /20208/, "артикул механизма");
  assert.match(html, /Обвязка поста/, "блок обвязки под таблицей модулей");
  /* порядок обвязки: суппорт → коробка → накладка. Имя накладки встречается и в шапке
     поста, поэтому проверяем порядок ВНУТРИ блока обвязки, а не по всему документу. */
  const fit = html.slice(html.indexOf("Обвязка поста"));
  assert.ok(fit.indexOf("Суппорт Neve Up 3М") < fit.indexOf("Коробка 3М"), "суппорт раньше коробки");
  assert.ok(fit.indexOf("Коробка 3М") < fit.indexOf("Накладка Neve Up 3М"), "коробка раньше накладки");
});

test("немецкий стандарт: примечание о разбиении на посты и импостах", () => {
  const dePost = Object.assign({}, italianPost, { number: 5, german: { postCount: 2 } });
  const html = buildHtml({ posts: [dePost] }, deps);
  assert.match(html, /импост/i, "монтажнику показано, что коробок несколько");
  assert.match(html, /2</, "число постов из german.postCount");
  assert.ok(!/суппорт/i.test(germanNoteOf(html)),
    "старый вызов без supportCount печатает примечание как прежде");
});

test("немецкий стандарт: в примечании есть и число суппортов (планка в каждую коробку)", () => {
  /* По прежнему тексту монтажник вёз одну планку на два поста: про суппорты примечание
     молчало вовсе, хотя их столько же, сколько коробок. */
  const dePost = Object.assign({}, italianPost, { number: 5, german: { postCount: 2, supportCount: 2 } });
  const note = germanNoteOf(buildHtml({ posts: [dePost] }, deps));
  assert.match(note, /2<\/b> суппорта/, "число суппортов напечатано");
  assert.match(note, /импост/i, "про импосты не потеряли");
});

test("обвязка: количество суппортов печатается в колонке «Кол.»", () => {
  /* Немецко-французская сборка: две планки. Раньше оркестратор клал в лист жёсткую
     единицу, и монтажник по документу получал один суппорт на два поста. */
  const dePost = Object.assign({}, italianPost, {
    number: 6,
    fittings: [
      { role: "Суппорт", name: "Суппорт Plana 2М", code: "14613", count: 2 },
      { role: "Монтажная коробка", name: "Коробка кругл.", code: "V71001", count: 2 }
    ],
    german: { postCount: 2, supportCount: 2 }
  });
  const fit = buildHtml({ posts: [dePost] }, deps);
  /* Проверяем количество ИМЕННО в строке суппорта: вырезаем один <tr>…</tr>. Прежняя
     версия брала окно в 200 символов от имени суппорта, а в него попадала и следующая
     строка — коробка, у которой count тоже 2; тест был ложно-зелёным и прошёл бы при
     count:1 у суппорта. */
  const row = tableRowWith(fit, "Суппорт Plana 2М");
  assert.ok(!row.includes("Коробка кругл."), "в срезе только строка суппорта, без соседней");
  assert.match(row, /class="right">2</, "в строке суппорта стоит 2, а не 1");
  assert.equal(row.match(/class="right">/g).length, 1, "в строке ровно одна ячейка «Кол.»");
});

test("обвязка: узел «не требуется» печатается словами, а в «Кол.» — прочерк", () => {
  /* Крышки IP55 (принцип NO_SUPPORT) монтируются в коробку без планки. Пустая строка в
     обвязке читается монтажником как забытая позиция, а «0» — как ошибка расчёта. */
  const ip55 = Object.assign({}, italianPost, {
    number: 7,
    fittings: [
      { role: "Суппорт", name: "не требуется", code: null, count: 0 },
      { role: "Монтажная коробка", name: "Коробка 3М", code: "V71303", count: 1 }
    ]
  });
  const html = buildHtml({ posts: [ip55] }, deps);
  const row = tableRowWith(html, ">не требуется<");
  assert.match(row, /class="code">—</, "артикула нет — прочерк");
  assert.match(row, /class="right">—</, "количества нет — прочерк, а не 0");
  /* Коробка названа и в шапке поста, и в обвязке — берём строку таблицы из блока обвязки. */
  const boxRow = tableRowWith(html.slice(html.indexOf("Обвязка поста")), "Коробка 3М");
  assert.match(boxRow, /class="right">1</, "обычные узлы печатают число как прежде");
});

/* --- buildFittings: сборка обвязки из состава поста ---------------------------------
   Раньше эти строки собирал оркестратор (app.js), где количество суппорта стояло
   литералом «1»; app.js в тесты не грузится, поэтому дефект жил незамеченным. Теперь
   правило здесь и проверяется напрямую — на составе (comp), а не на готовых строках. */

/* Состав поста в том виде, в каком его отдаёт EPPosts.postComposition: итальянская
   накладка — одна коробка, одна планка. */
const italianComp = {
  frame: { name: "Накладка Neve Up 3М", code: "09663" },
  support: { name: "Суппорт Neve Up 3М", code: "09613" },
  supportCount: 1,
  boxCount: 1,
  box: { name: "Коробка 3М", code: "V71303" }
};

test("buildFittings: порядок сборки — суппорт → коробка → накладка", () => {
  const rows = buildFittings(italianComp, italianComp.box);
  assert.deepEqual(rows.map(f => f.role), ["Суппорт", "Монтажная коробка", "Накладка"],
    "узлы идут в том порядке, в каком монтажник собирает пост");
  assert.deepEqual(rows.map(f => f.count), [1, 1, 1], "итальянский пост — по одной штуке каждого");
  assert.equal(rows[0].code, "09613", "артикул суппорта из состава");
});

test("buildFittings: суппортов столько же, сколько коробок (а не жёсткая единица)", () => {
  /* ИСХОДНЫЙ ДЕФЕКТ: в лист монтажника уходило count:1 при любой сборке, и по
     немецко-французской накладке (2 поста = 2 коробки) монтажник вёз одну планку
     на два поста. */
  const de = Object.assign({}, italianComp, { supportCount: 2, boxCount: 2 });
  const rows = buildFittings(de, de.box);
  assert.equal(rows[0].role, "Суппорт");
  assert.equal(rows[0].count, 2, "две планки — по одной в каждую коробку");
  assert.equal(rows[1].count, 2, "и столько же коробок");
  assert.equal(rows[2].count, 1, "накладка на всю сборку одна — импосты делят её изнутри");
});

test("buildFittings: NO_SUPPORT даёт строку «не требуется» с нулём, а не пропуск", () => {
  /* Крышки IP55 садятся в коробку без планки. Пропущенная строка читается монтажником
     как забытая позиция; ноль buildHtml печатает прочерком (см. тест ниже по колонке). */
  const ip55 = { frame: italianComp.frame, support: null, supportCount: 0, supportNotRequired: true,
    boxCount: 1, box: italianComp.box };
  const rows = buildFittings(ip55, ip55.box);
  assert.equal(rows[0].role, "Суппорт", "узел в обвязке остался");
  assert.equal(rows[0].name, "не требуется", "причина написана словами");
  assert.equal(rows[0].count, 0, "количества нет");
  assert.match(buildHtml({ posts: [Object.assign({}, italianPost, { fittings: rows })] }, deps),
    /не требуется<\/td><td class="code">—<\/td><td class="right">—</, "в листе — прочерки, а не «0»");
});

test("buildFittings: неподобранный суппорт молчит, «не требуется» не выдумываем", () => {
  /* Подбор не нашёл планку (supportNotRequired не выставлен) — это пробел каталога, а не
     свойство изделия: строку «не требуется» здесь печатать нельзя, она бы соврала. */
  const gap = { frame: italianComp.frame, support: null, supportCount: 0, boxCount: 1, box: italianComp.box };
  assert.deepEqual(buildFittings(gap, gap.box).map(f => f.role), ["Монтажная коробка", "Накладка"],
    "строки суппорта нет вовсе");
});

test("buildFittings: пустой пост и отсутствие коробки/накладки не роняют обвязку", () => {
  /* Пост без механизмов: обвязка нулевая (ни коробки, ни планки) — остаётся одна накладка.
     Коробка не подобрана (box=null) — узел просто не печатается, а не «undefined». */
  const empty = Object.assign({}, italianComp, { supportCount: 0, boxCount: 0 });
  assert.deepEqual(buildFittings(empty, null).map(f => f.role), ["Накладка"], "пустой пост — только накладка");
  assert.deepEqual(buildFittings({}, null), [], "состав без полей — пустая обвязка");
  assert.deepEqual(buildFittings(null, null), [], "состава нет вовсе — тоже пусто");
});

/* --- «(предположительно)»: артикул подобран нами, заказчиком не подтверждён ------------
   Решение владельца: планку в лист ставим (иначе поста не собрать), но монтажник должен
   видеть, что артикул под вопросом, ДО поездки на объект. */
test("buildFittings: supportAssumed доезжает до строки обвязки", () => {
  const guess = Object.assign({}, italianComp, { supportAssumed: true });
  assert.equal(buildFittings(guess, guess.box)[0].assumed, true, "признак у строки суппорта");
  assert.equal(buildFittings(italianComp, italianComp.box)[0].assumed, false,
    "подтверждённая пара признака не несёт");
});

test("лист монтажника: пометка «(предположительно)» стоит в строке суппорта рядом с артикулом", () => {
  const guess = Object.assign({}, italianComp, { supportAssumed: true });
  const rows = buildFittings(guess, guess.box);
  const html = buildHtml({ posts: [Object.assign({}, italianPost, { fittings: rows })] }, deps);
  const row = tableRowWith(html.slice(html.indexOf("Обвязка поста")), "Суппорт Neve Up 3М");
  assert.match(row, /09613 \(предположительно\)/, "пометка вплотную к артикулу, в его же ячейке");
  /* Ровно там, где надо: у коробки и накладки того же поста пометки быть не должно. */
  const boxRow = tableRowWith(html.slice(html.indexOf("Обвязка поста")), "Коробка 3М");
  assert.ok(!/предположительно/.test(boxRow), "коробка подобрана правилом — не помечается");
});

test("лист монтажника: подтверждённая пара печатается БЕЗ пометки", () => {
  /* Пометка ценна ровно до тех пор, пока стоит у меньшинства: 36 накладок из 1631. */
  const rows = buildFittings(italianComp, italianComp.box);
  const html = buildHtml({ posts: [Object.assign({}, italianPost, { fittings: rows })] }, deps);
  assert.ok(!/предположительно/.test(html), "во всём листе пометки нет");
  const row = tableRowWith(html.slice(html.indexOf("Обвязка поста")), "Суппорт Neve Up 3М");
  assert.match(row, /class="code">09613</, "артикул напечатан как обычно");
});

test("пустые поля шапки не печатаются, а введённые — экранируются", () => {
  const html = buildHtml({
    header: { project: 'Дом <b>А</b>', developer: "", date: "01.08.2026" },
    posts: [italianPost]
  }, deps);
  assert.match(html, /Дом &lt;b&gt;А&lt;\/b&gt;/, "тег из ввода экранирован");
  assert.ok(!/Разработчик/.test(html), "пустое поле «Разработчик» не выведено");
  assert.match(html, /01\.08\.2026/, "дата выведена");
});

test("весь проект: посты группируются по помещениям, нераспределённые — «Без помещения»", () => {
  const p1 = Object.assign({}, italianPost, { number: 1, room: "Кухня" });
  const p2 = Object.assign({}, italianPost, { number: 2, room: "" });
  const html = buildHtml({ posts: [p1, p2] }, deps);
  assert.match(html, /Кухня/, "заголовок помещения");
  assert.match(html, /Без помещения/, "fallback-группа для постов без помещения");
});

test("пост без механизмов не роняет вёрстку", () => {
  const html = buildHtml({ posts: [Object.assign({}, italianPost, { modules: [], fittings: [] })] }, deps);
  assert.match(html, /Пост без механизмов/, "явная строка вместо пустой таблицы");
});

test("нумерация по постам: подзаголовки «Пост N» и счёт модулей в каждом посте заново", () => {
  const post = Object.assign({}, italianPost, {
    number: 7,
    moduleGroups: [
      { post: 1, capacity: 2, modules: [{ label: "1", name: "Выключатель", code: "20001", note: "" }, { label: "2", name: "Кнопка", code: "20002", note: "" }] },
      { post: 2, capacity: 2, modules: [{ label: "1", name: "Розетка", code: "20208", note: "" }] }
    ]
  });
  const html = buildHtml({ posts: [post] }, deps);
  assert.match(html, /class="post-row"/, "подзаголовки-посты рисуются");
  assert.match(html, /Пост 1/, "подзаголовок первого поста");
  assert.match(html, /Пост 2/, "подзаголовок второго поста");
  /* оба поста нумеруют модули с 1 — в таблице есть минимум две ячейки-модуля «1» */
  assert.ok((html.match(/class="mod">1</g) || []).length >= 2, "счёт модулей в каждом посте начинается с 1");
});

test("один пост (нет moduleGroups>1) рисует плоскую таблицу как прежде", () => {
  const html = buildHtml({ posts: [italianPost] }, deps);   // moduleGroups нет вовсе
  assert.match(html, /2–3/, "плоская нумерация сохранена для итальянской накладки");
  assert.ok(!/class="post-row"/.test(html), "подзаголовков-постов у однопостовой накладки нет");
});

/* ---- порядок модулей в карточке: таблица и взрыв-схема читаются подряд ------------------- */

/* Немецко-французская сборка 2+2, набор 1М·2М·1М: упаковка по постам разводит его так, что
   ВТОРОЙ по набору механизм (2М) уезжает во второй пост, а третий (1М) встаёт вторым модулем
   первого. Порядок карточки от порядка набора отличается — на этом и расходились блоки. */
const packedGroups = [
  { post: 1, capacity: 2, modules: [{ label: "1", code: "09021.N", keyIndex: 0 }, { label: "2", code: "09021.N", keyIndex: 2 }] },
  { post: 2, capacity: 2, modules: [{ label: "1–2", code: "09022.N", keyIndex: 1 }] }
];
const flatModules = [
  { label: "1", code: "09021.N", keyIndex: 0 },
  { label: "2–3", code: "09022.N", keyIndex: 1 },
  { label: "4", code: "09021.N", keyIndex: 2 }
];

test("cardModuleOrder: у сборки из нескольких постов порядок карточки — ПО ПОСТАМ", () => {
  assert.deepEqual(cardModuleOrder(packedGroups, flatModules).map(m => m.keyIndex), [0, 2, 1]);
});

test("cardModuleOrder: одна накладка — прежний плоский порядок набора", () => {
  assert.deepEqual(cardModuleOrder(null, flatModules).map(m => m.keyIndex), [0, 1, 2]);
  assert.deepEqual(cardModuleOrder([packedGroups[0]], flatModules).map(m => m.keyIndex), [0, 1, 2]);
  assert.deepEqual(cardModuleOrder(undefined, undefined), []);
});

test("ПОРЯДОК СТРОК ТАБЛИЦЫ и cardModuleOrder — одно правило: взрыв-схеме не с чем разойтись", () => {
  /* Взрыв-схему собирает оркестратор по cardModuleOrder, а таблицу печатает buildHtml. Пока
     правило было записано дважды, адреса в двух блоках одной карточки шли в разном порядке
     («1.1, 2.1–2, 1.2» против «1.1, 1.2, 2.1–2»). Сверяем порядок ячеек-модулей в напечатанной
     таблице с порядком, который получает схема. */
  const post = Object.assign({}, italianPost, { number: 7, modules: flatModules, moduleGroups: packedGroups });
  const html = buildHtml({ posts: [post] }, deps);
  const printed = [...html.matchAll(/class="mod">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(printed, cardModuleOrder(packedGroups, flatModules).map(m => m.label));
});

test("assembledImageHtml вставляется в карточку поста как есть", () => {
  const post = Object.assign({}, italianPost, { assembledImageHtml: '<span class="assembled-post">IMG</span>' });
  const html = buildHtml({ posts: [post] }, deps);
  assert.match(html, /class="assembled-post"/, "картинка собранного поста в листе монтажника");
});

test("автопечать ждёт загрузки картинок и печатает ровно один раз", () => {
  const html = buildHtml({ posts: [italianPost] }, deps);
  /* печать по готовности картинок, а не по прежнему setTimeout(...,400): иллюстрации постов
     тянутся с vimar.ru и могли не успеть → сборка уезжала в PDF недогруженной */
  assert.match(html, /document\.images/, "печать привязана к загрузке изображений");
  assert.match(html, /addEventListener\("load"/, "ждём событие load незагруженных картинок");
  assert.match(html, /addEventListener\("error"/, "битая картинка (error) тоже снимает ожидание");
  assert.match(html, /if\(done\)return;done=true/, "флаг done — печать ровно один раз");
  assert.match(html, /setTimeout\(pr,4000\)/, "предохранитель: печать не позже 4000 мс");
  assert.ok(!/setTimeout\(\(\)=>window\.print\(\),400\)/.test(html), "прежней печати по таймеру больше нет");
});

/* Контракт вставки плана: лист монтажника печатает готовую секцию «план с бирками»
   (EPPlanLabels) сразу после шапки и ПЕРЕД карточками постов — монтажник сначала видит,
   где какой пост на объекте, и только потом читает состав. Контракт закрепляем тестом,
   иначе вставку можно молча удалить или переставить и ничего не покраснеет. */
test("план с бирками попадает в лист монтажника и стоит перед карточками постов", () => {
  const marker = '<section data-test="plan-block">план</section>';
  const html = buildHtml({ posts: [italianPost], planBlockHtml: marker }, deps);
  assert.ok(html.includes(marker), "секция плана напечатана");
  const posPlan = html.indexOf(marker);
  const posCard = html.indexOf("<section class=\"post-card\">");
  assert.ok(posCard > -1, "карточка поста на месте");
  assert.ok(posPlan < posCard, "план идёт ДО карточек постов");
});

test("лист монтажника без плана собирается как раньше", () => {
  const withOut = buildHtml({ posts: [italianPost], planBlockHtml: "" }, deps);
  const undef = buildHtml({ posts: [italianPost] }, deps);
  assert.ok(!/data-test="plan-block"/.test(withOut), "секции плана нет");
  assert.equal(withOut, undef, "пустая строка и отсутствие поля дают одинаковый документ");
});

/* ── Механизмы групп света в обвязке поста (C8) ───────────────────────────────────────
   Механизм подставляется расчётом по числу мест группы и физически стоит ЗА клавишей — своего
   модуля рамки у него нет, поэтому в таблице модулей его быть не может. Место монтажника,
   где он обязан появиться, — обвязка, с номером модуля и именем группы. */
const lightRow = (over) => Object.assign(
  { keyIndex: 0, moduleLabel: "1", groupLabel: "Кухня", roleLabel: "Переключатель",
    code: "20005.0", name: "Механизм-переключатель 1P 16AX", price: 25.79, missing: false }, over || {});
const comp = { support: { name: "Суппорт X", code: "S1" }, supportCount: 1, boxCount: 1,
  frame: { name: "Накладка", code: "F1" } };
const box = { name: "Коробка", code: "B1" };

test("механизм группы света идёт ПЕРВЫМ в обвязке — до суппорта, коробки и накладки", () => {
  const rows = buildFittings(comp, box, [lightRow()]);
  assert.deepEqual(rows.map(r => r.code), ["20005.0", "S1", "B1", "F1"]);
  assert.match(rows[0].role, /модуль 1/);
  assert.match(rows[0].role, /Кухня/);
  assert.equal(rows[0].count, 1);
});

test("пробел ПОСТАВКИ печатается строкой с нулём и причиной, а не пропускается", () => {
  /* Монтажник обязан увидеть ДО поездки, что за клавишей ничего не стоит: пустое место в
     обвязке читается как забытая позиция, и он звонит уточнять. Пример — настоящий пробел
     поставки: группа указана, а механизма такой роли в серии клавиши нет. */
  const rows = buildFittings(comp, box, [lightRow({ missing: true, code: null,
    missingReason: LG.GAPS.NOT_IN_SERIES,
    missingText: LG.GAP_TEXTS[LG.GAPS.NOT_IN_SERIES] })]);
  assert.equal(rows[0].count, 0);
  assert.equal(rows[0].code, null);
  assert.match(rows[0].name, /нет механизма нужного типа/);
});

test("пробел ПРОЕКТА в обвязку не идёт — та же трактовка, что в накладной поставщика", () => {
  /* Обвязка — перечень ДЕТАЛЕЙ поста, то есть того, что надо привезти и поставить. «Группа не
     указана» и «схема не описана» деталью не являются: это незаполненный проект. Пока обвязка
     печатала их, а накладная поставщика молча отбрасывала, один и тот же пробел трактовался
     двумя документами об одном проекте по-разному — и лист монтажника у любого старого
     проекта (групп там нет ни у одной клавиши) состоял из «Не указана группа света» на каждую
     клавишу, топя настоящий пробел поставки. Род пробела решает ОДИН общий
     EPLightingGroups.isSupplyGap; ниже — та же сборка, что делает оркестратор в app.js
     (buildPostSheet), чтобы правило нельзя было поменять с одной стороны. */
  const rows = [
    lightRow({ keyIndex: 0, missing: true, code: null, missingReason: LG.GAPS.NO_GROUP,
      missingText: LG.GAP_TEXTS[LG.GAPS.NO_GROUP] }),
    lightRow({ keyIndex: 1, moduleLabel: "2", missing: true, code: null,
      missingReason: LG.GAPS.NOT_IN_SERIES, missingText: LG.GAP_TEXTS[LG.GAPS.NOT_IN_SERIES] })
  ];
  const forFittings = rows.filter(r => !r.missing || LG.isSupplyGap(r.missingReason));
  const fittings = buildFittings(comp, box, forFittings);
  assert.deepEqual(fittings.map(f => f.code), [null, "S1", "B1", "F1"], "в обвязке один пробел, а не два");
  assert.match(fittings[0].role, /модуль 2/, "и это тот, что про поставку");
  assert.ok(!/Не указана группа света/.test(fittings.map(f => f.name).join(" ")));
});

test("вызов без третьего аргумента даёт прежнюю обвязку байт в байт", () => {
  assert.deepEqual(buildFittings(comp, box), buildFittings(comp, box, []));
  assert.deepEqual(buildFittings(comp, box).map(r => r.code), ["S1", "B1", "F1"]);
});

test("блок «Группы света» печатается после карточек постов и перед подвалом", () => {
  const marker = '<section data-test="lighting">группы</section>';
  const html = buildHtml({ posts: [italianPost], lightingHtml: marker }, deps);
  const posCard = html.indexOf('<section class="post-card">');
  const posLight = html.indexOf(marker);
  const posFooter = html.indexOf('<div class="footer">');
  assert.ok(posCard > -1 && posLight > posCard, "блок идёт ПОСЛЕ карточек постов");
  assert.ok(posLight < posFooter, "и ПЕРЕД подвалом документа");
});

test("лист монтажника без блока групп света собирается как раньше", () => {
  assert.equal(buildHtml({ posts: [italianPost], lightingHtml: "" }, deps),
    buildHtml({ posts: [italianPost] }, deps));
});
