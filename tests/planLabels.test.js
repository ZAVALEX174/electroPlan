/* Автотесты плана с бирками номеров постов (js/planLabels.js, D9).
   Модуль чистый: на вход данные, на выход строка HTML — браузер поднимать не нужно.
   Главное, что здесь проверяется, — ГЕОМЕТРИЯ: бирка в документе обязана встать ровно туда
   же, где стоит иконка поста на экране, а подложка на экране ЛЕТТЕРБОКСИТСЯ внутри мирового
   бокса холста (object-fit:contain). Поэтому большая часть проверок — числа из layout(),
   а не поиск подстрок в вёрстке. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml, layout } = require("../js/planLabels.js");

/* esc как в приложении (из app.js наружу не экспортируется) — чтобы проверить экранирование. */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deps = { esc };

const PLAN = "data:image/png;base64,iVBORw0KGgo=";
/* Квадратная подложка в квадратном боксе: леттербокса нет, подложка занимает бокс целиком —
   на таком наборе координаты бирок читаются глазами. */
const square = extra => Object.assign({
  imageUrl: PLAN, natW: 100, natH: 100, canvasW: 200, canvasH: 200,
  posts: [{ number: 1, x: 100, y: 100 }]
}, extra);

const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${msg}: ожидалось ${expected}, получено ${actual}`);

test("подложка без леттербокса: бирка в центре плана даёт 50% / 50%", () => {
  const L = layout(square());
  close(L.image.left, 0, "картинка прижата к левому краю кадра");
  close(L.image.top, 0, "картинка прижата к верху кадра");
  close(L.image.width, 100, "картинка занимает всю ширину кадра");
  close(L.image.height, 100, "картинка занимает всю высоту кадра");
  assert.equal(L.badges.length, 1);
  close(L.badges[0].left, 50, "центр плана по горизонтали");
  close(L.badges[0].top, 50, "центр плана по вертикали");
});

test("леттербокс по вертикали: сдвиг offY снят, бирка снова в центре чертежа", () => {
  /* Широкая подложка 200×100 в квадратном боксе 200×200: disp=1, картинка 200×100 висит
     полосой посередине, offY=50. Пост в мировой точке (100,100) стоит ровно в центре
     ЧЕРТЕЖА — значит и бирка обязана быть 50/50, а не 50/50 от бокса. */
  const L = layout(square({ natW: 200, natH: 100, posts: [{ number: 4, x: 100, y: 100 }] }));
  close(L.aspectPct, 50, "кадр повторяет пропорцию чертежа 200×100");
  close(L.badges[0].left, 50, "центр по горизонтали");
  close(L.badges[0].top, 50, "центр по вертикали: смещение леттербокса вычтено");
});

test("леттербокс по горизонтали: узкая подложка, бирка у левого края чертежа", () => {
  /* Подложка 100×200 в боксе 200×200: disp=1, картинка 100×200, offX=50.
     Мировая точка x=50 — это ЛЕВЫЙ край чертежа, y=100 — его середина. Проверяем не
     абсолютные проценты кадра, а положение бирки ОТНОСИТЕЛЬНО чертежа: поля бокса
     (offX=50) не должны уехать в документ вместе с картинкой. */
  const L = layout(square({ natW: 100, natH: 200, posts: [{ number: 2, x: 50, y: 100 }] }));
  close(L.badges[0].left, L.image.left, "бирка ровно на левом крае чертежа");
  close(L.badges[0].top, L.image.top + L.image.height / 2, "середина чертежа по вертикали");
});

test("угловые посты садятся ровно на углы чертежа", () => {
  const L = layout(square({ posts: [{ number: 1, x: 0, y: 0 }, { number: 2, x: 200, y: 200 }] }));
  close(L.badges[0].left, L.image.left, "левый верхний угол чертежа");
  close(L.badges[0].top, L.image.top, "левый верхний угол чертежа");
  close(L.badges[1].left, L.image.left + L.image.width, "правый нижний угол чертежа");
  close(L.badges[1].top, L.image.top + L.image.height, "правый нижний угол чертежа");
});

test("бирка на самом краю чертежа получает поле и не срезается кадром", () => {
  /* Бирка — кружок ПОВЕРХ точки: пост в углу подложки без запаса вылез бы за кадр
     наполовину. Кадр расширяется на поле, картинка внутри него слегка отступает. */
  const L = layout(square({ posts: [{ number: 1, x: 0, y: 0 }] }));
  assert.ok(L.image.left > 0 && L.image.top > 0, "чертёж отступил от края кадра");
  assert.ok(L.badges[0].left > 0 && L.badges[0].top > 0, "бирка внутри кадра, не на самой границе");
  assert.ok(L.image.width < 100, "кадр шире чертежа ровно на поля");
});

test("пост за пределами подложки расширяет кадр, а не обрезается", () => {
  /* Холст бесконечный: при отдалённом виде клик попадает в мировые координаты за краем
     картинки. Такую бирку нельзя ни срезать, ни притянуть к краю — документ обязан
     показать то же, что экран. */
  const L = layout(square({ posts: [{ number: 9, x: -100, y: 100 }] }));
  assert.ok(L.image.left > 0, "картинка сдвинулась вправо: слева освободилось место под бирку");
  assert.ok(L.image.width < 100, "картинка занимает уже не весь кадр");
  assert.ok(L.badges[0].left >= 0 && L.badges[0].left < L.image.left,
    "бирка внутри кадра и левее чертежа");
});

test("кадр вписывается в лист: ширина не больше maxWidthMm, высота — не больше maxHeightMm", () => {
  const wide = layout(square({ natW: 400, natH: 100, maxWidthMm: 176, maxHeightMm: 224 }));
  close(wide.widthMm, 176, "широкий чертёж упирается в ширину листа");
  const tall = layout(square({ natW: 100, natH: 400, maxWidthMm: 176, maxHeightMm: 224 }));
  /* высокий кадр упирается в ВЫСОТУ: ширина считается обратно из пропорции */
  assert.ok(tall.widthMm < 176, "высокий чертёж ужат по ширине, чтобы влезть по высоте");
  close(tall.widthMm * tall.aspectPct / 100, 224, "высота ровно по полезной площади листа");
});

test("подложка опциональна: без неё блок строится по одним постам", () => {
  /* НОВЫЙ КОНТРАКТ. Подложка — лишь фон для обводки: помещения и посты рисуются и без
     чертежа. Раньше «нет картинки → нет блока»; теперь блок обязан появиться. */
  const noImg = square({ imageUrl: "" });
  assert.ok(buildHtml(noImg, deps) !== "", "без подложки блок всё равно есть");
  assert.equal(layout(noImg).image, null, "фона нет — image === null");
  assert.equal(layout(noImg).imageUrl, null, "imageUrl обнулён, в вёрстку <img> не пойдёт");
  assert.ok(!/<img\b/.test(buildHtml(noImg, deps)), "без подложки тег <img> не выводится");
  /* пробельная подложка и SVG без размеров (naturalWidth 0) — тоже «фона нет», не «блока нет» */
  assert.equal(layout(square({ imageUrl: "   " })).image, null, "пробельная подложка — без фона");
  assert.equal(layout(square({ natW: 0 })).image, null, "SVG без размеров — без фона, но блок есть");
  assert.equal(layout(square({ canvasW: 0, canvasH: 0 })).image, null, "нет размеров холста — без фона");
});

test("блок = null, только когда печатать нечего: ни постов, ни помещений", () => {
  assert.equal(buildHtml(square({ posts: [] }), deps), "", "ни постов, ни помещений — блока нет");
  assert.equal(layout(square({ posts: [] })), null, "layout тоже null на пустом проекте");
  assert.equal(buildHtml(null, deps), "", "нет данных вообще — блока нет");
  assert.equal(layout(square({ posts: [{ number: 1 }] })), null, "пост без координат — и без помещений — null");
  /* но одно помещение без постов уже поднимает блок */
  assert.ok(layout(square({ posts: [], rooms: [{ name: "Кухня", x: 100, y: 100 }] })) !== null,
    "помещение без постов — блок есть");
});

test("пост без номера печатается знаком вопроса, как на плане", () => {
  const L = layout(square({ posts: [{ x: 100, y: 100 }, { number: "", x: 20, y: 20 }, { number: 0, x: 40, y: 40 }] }));
  assert.equal(L.badges[0].number, "?", "номера нет — вопрос, а не пустая бирка");
  assert.equal(L.badges[1].number, "?", "пустая строка — тоже вопрос");
  assert.equal(L.badges[2].number, "0", "ноль — валидный номер, не подменяется вопросом");
});

test("координаты не числами не роняют блок: такие посты пропускаются", () => {
  const L = layout(square({ posts: [{ number: 1, x: "нет", y: 10 }, { number: 2, x: 100, y: 100 }] }));
  assert.equal(L.badges.length, 1, "остался только пост с координатами");
  assert.equal(L.badges[0].number, "2");
  /* пустая строка не должна становиться нулём (Number("") === 0 подсунул бы бирку в угол) */
  assert.equal(layout(square({ posts: [{ number: 3, x: "", y: "" }] })), null);
});

test("экранирование: номер поста и URL подложки проходят esc", () => {
  const html = buildHtml(square({
    imageUrl: 'data:image/png;base64,AA"><script>alert(1)</script>',
    posts: [{ number: '<img src=x onerror="alert(1)">', x: 100, y: 100 }],
    title: "План <b>объекта</b>"
  }), deps);
  assert.ok(!/<script/.test(html), "инъекция через data-URL не открыла тег");
  /* единственный настоящий <img> в блоке — сама подложка: тег из номера поста не ожил */
  assert.equal((html.match(/<img\b/g) || []).length, 1, "инъекция через номер поста не открыла тег");
  assert.match(html, /&lt;script&gt;/, "разметка из URL экранирована");
  assert.match(html, /&lt;img src=x/, "разметка из номера поста экранирована");
  assert.match(html, /&lt;b&gt;/, "разметка из заголовка экранирована");
  /* кавычка из data-URL закрыла бы атрибут src и вынесла бы остаток строки в разметку */
  assert.ok(!/base64,AA">/.test(html), "кавычка в data-URL не разорвала атрибут src");
});

test("вёрстка блока: только инлайн-стили, своя страница, резиновая пропорция", () => {
  const html = buildHtml(square({ posts: [{ number: 1, x: 50, y: 50 }, { number: 2, x: 150, y: 150 }] }), deps);
  assert.match(html, /Расположение постов на плане/, "заголовок блока");
  assert.ok(!/class=/.test(html), "классов нет: в окне печати внешнего CSS не будет");
  assert.match(html, /page-break-after:always/, "блок печатается своей страницей");
  assert.match(html, /break-inside:avoid/, "чертёж не рвётся посередине");
  assert.match(html, /padding-top:100\.000%/, "пропорция кадра держится процентным padding-top");
  assert.match(html, /max-width:100%/, "кадр вписывается в ширину страницы без обрезки");
  assert.match(html, /object-fit:fill/, "прямоугольник картинке уже посчитан — второй contain запрещён");
  assert.equal((html.match(/border-radius:50%/g) || []).length, 2, "две круглые бирки");
  assert.match(html, /left:25\.000%;top:25\.000%/, "бирка № 1 на своём месте");
  assert.match(html, /left:75\.000%;top:75\.000%/, "бирка № 2 на своём месте");
});

test("бирка читается и без фоновой графики принтера", () => {
  const html = buildHtml(square(), deps);
  /* Chrome по умолчанию не печатает фоны: синий кружок с белым текстом ушёл бы в PDF
     невидимым. Поэтому фон белый, номер тёмный, а фон дополнительно запрошен явно. */
  assert.match(html, /print-color-adjust:exact/, "фон бирки запрошен явно");
  assert.match(html, /color:#14395c/, "номер тёмный — читается даже без залитого фона");
  assert.match(html, /box-shadow:0 0 0 2px rgba\(255,255,255/, "белое кольцо отделяет бирку от тёмного чертежа");
  assert.match(html, /width:22px;height:22px/, "размер бирки фиксированный, не зависит от масштаба листа");
});

test("подпись под планом настраивается и может быть отключена", () => {
  assert.match(buildHtml(square(), deps), /Номер на бирке/, "подпись по умолчанию");
  assert.match(buildHtml(square({ note: "Сверяйте с таблицей" }), deps), /Сверяйте с таблицей/);
  assert.ok(!/Номер на бирке/.test(buildHtml(square({ note: "" }), deps)), "пустая подпись не печатается");
});

/* Квадрат-контур в мировых точках — удобно проверять руками. */
const ROOM_POLY = [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 180 }, { x: 20, y: 180 }];

test("контур помещения рисуется полигоном, имя — у якоря подписи", () => {
  const html = buildHtml(square({
    posts: [{ number: 1, x: 100, y: 100 }],
    rooms: [{ name: "Кухня", polygon: ROOM_POLY, x: 100, y: 100 }]
  }), deps);
  assert.match(html, /<polygon /, "контур выведен svg-полигоном");
  assert.match(html, /vector-effect="non-scaling-stroke"/, "линия контура не растягивается вслед за кадром");
  assert.match(html, /fill="none"/, "контур без заливки, как .room-poly на экране");
  assert.match(html, /Кухня/, "имя помещения напечатано");
});

test("комната без контура печатается подписью, без полигона и не теряется", () => {
  const spec = { posts: [{ number: 1, x: 100, y: 100 }], rooms: [{ name: "Кладовая", x: 150, y: 150 }] };
  const L = layout(square(spec));
  assert.equal(L.rooms.length, 1, "комната без контура осталась в раскладке");
  assert.equal(L.rooms[0].polygon, null, "контура у неё нет");
  assert.ok(L.rooms[0].label, "но есть якорь подписи");
  const html = buildHtml(square(spec), deps);
  assert.ok(!/<polygon/.test(html), "без контура полигон не рисуется");
  assert.match(html, /Кладовая/, "имя всё равно напечатано");
});

test("кадр учитывает контуры помещений, а не только бирки постов", () => {
  /* Без подложки: контур уходит далеко влево-вверх от единственного поста. Если кадр
     считать по одним биркам (мутация), пост встал бы в центр; с учётом контура он
     смещается к правому-нижнему краю кадра. */
  const L = layout(square({
    imageUrl: "",
    posts: [{ number: 1, x: 100, y: 100 }],
    rooms: [{ name: "Зал", polygon: [{ x: -200, y: -200 }, { x: 0, y: -200 }, { x: 0, y: 0 }, { x: -200, y: 0 }], x: -100, y: -100 }]
  }));
  assert.ok(L.rooms[0].polygon, "контур в раскладке");
  close(L.rooms[0].polygon[0].left, 0, "дальний угол контура — у левого края кадра");
  assert.ok(L.badges[0].left > 90, "бирка ушла к правому краю: кадр растянут контуром влево");
});

test("имя помещения проходит esc — тег из названия не оживает", () => {
  const html = buildHtml(square({
    posts: [{ number: 1, x: 100, y: 100 }],
    rooms: [{ name: "<b>Зал</b>", x: 100, y: 100 }]
  }), deps);
  assert.match(html, /&lt;b&gt;Зал&lt;\/b&gt;/, "имя помещения экранировано");
  assert.equal((html.match(/<b>/g) || []).length, 0, "тег из имени помещения не ожил");
});

/* ─────────────── СВЯЗИ ГРУПП СВЕТА (часть 1b) ───────────────
   Ключ группы приходит из app.js уже приведённым; модуль по нему собирает посты одной группы,
   подписывает имя у бирки и соединяет посты линией. Проверяем геометрию числами из layout(). */

const G = (key, label) => ({ key, label: label == null ? key : label });

test("два поста одной группы соединяются линией; концы — центры бирок", () => {
  const L = layout(square({ posts: [
    { number: 1, x: 60, y: 60, groups: [G("кухня", "Кухня")] },
    { number: 2, x: 140, y: 140, groups: [G("кухня", "Кухня")] }
  ] }));
  assert.equal(L.groupLines.length, 1, "одна связь на пару постов группы");
  const ln = L.groupLines[0];
  /* цепочка идёт по номеру поста: пост 1 → пост 2 */
  close(ln.x1, L.badges[0].left, "начало линии — центр бирки поста 1 по X");
  close(ln.y1, L.badges[0].top, "начало линии — центр бирки поста 1 по Y");
  close(ln.x2, L.badges[1].left, "конец линии — центр бирки поста 2 по X");
  close(ln.y2, L.badges[1].top, "конец линии — центр бирки поста 2 по Y");
});

test("группа с одним местом линии не даёт, но подпись у бирки есть", () => {
  const L = layout(square({ posts: [{ number: 1, x: 100, y: 100, groups: [G("кухня", "Кухня")] }] }));
  assert.equal(L.groupLines.length, 0, "одно место — соединять нечего");
  assert.deepEqual(L.badges[0].groups, ["Кухня"], "подпись группы у бирки всё равно есть");
});

test("посты РАЗНЫХ групп линией не соединяются", () => {
  const L = layout(square({ posts: [
    { number: 1, x: 60, y: 60, groups: [G("кухня", "Кухня")] },
    { number: 2, x: 140, y: 140, groups: [G("спальня", "Спальня")] }
  ] }));
  assert.equal(L.groupLines.length, 0, "разные ключи — связи нет");
});

test("пост без групп остаётся как раньше: без подписи и без линий", () => {
  const L = layout(square({ posts: [{ number: 1, x: 100, y: 100 }] }));
  assert.deepEqual(L.badges[0].groups, [], "групп у бирки нет");
  assert.equal(L.groupLines.length, 0, "линий нет");
});

test("три места группы — цепочка (N−1 отрезков), а не полный граф", () => {
  /* Порядок цепочки — по номеру поста; при полном графе было бы 3 отрезка на 3 поста. */
  const L = layout(square({ posts: [
    { number: 3, x: 20, y: 20, groups: [G("зал")] },
    { number: 1, x: 180, y: 20, groups: [G("зал")] },
    { number: 2, x: 100, y: 180, groups: [G("зал")] }
  ] }));
  assert.equal(L.groupLines.length, 2, "три места — два отрезка цепочки, не три");
  /* цепочка 1→2→3: badges идут во входном порядке (3,1,2) => индексы 1,2,0 */
  close(L.groupLines[0].x1, L.badges[1].left, "первый отрезок стартует от поста 1");
  close(L.groupLines[0].x2, L.badges[2].left, "…и идёт к посту 2");
  close(L.groupLines[1].x1, L.badges[2].left, "второй отрезок стартует от поста 2");
  close(L.groupLines[1].x2, L.badges[0].left, "…и идёт к посту 3");
});

test("несколько групп у поста: имена перечислены, связь идёт в каждую группу", () => {
  const L = layout(square({ posts: [
    { number: 1, x: 30, y: 30, groups: [G("кухня", "Кухня"), G("зал", "Зал")] },
    { number: 2, x: 170, y: 30, groups: [G("кухня", "Кухня")] },
    { number: 3, x: 100, y: 170, groups: [G("зал", "Зал")] }
  ] }));
  assert.deepEqual(L.badges[0].groups, ["Кухня", "Зал"], "у бирки перечислены обе группы поста");
  assert.equal(L.groupLines.length, 2, "две связи: пост-1↔пост-2 (Кухня) и пост-1↔пост-3 (Зал)");
});

test("вёрстка связей: пунктирная линия и подпись группы под биркой", () => {
  const html = buildHtml(square({ posts: [
    { number: 1, x: 60, y: 60, groups: [G("кухня", "Кухня")] },
    { number: 2, x: 140, y: 140, groups: [G("кухня", "Кухня")] }
  ] }), deps);
  assert.match(html, /<line /, "связь выведена svg-линией");
  assert.match(html, /stroke-dasharray="4 3"/, "линия пунктирная, чтобы не спорить с контурами");
  assert.match(html, /vector-effect="non-scaling-stroke"/, "толщина связи не растягивается вслед за кадром");
  assert.equal((html.match(/Кухня/g) || []).length, 2, "имя группы подписано у обеих бирок");
});

test("имя группы проходит esc — тег из имени группы не оживает", () => {
  const html = buildHtml(square({ posts: [{ number: 1, x: 100, y: 100, groups: [G("k", "<b>Зал</b>")] }] }), deps);
  assert.match(html, /&lt;b&gt;Зал&lt;\/b&gt;/, "имя группы экранировано");
  assert.equal((html.match(/<b>/g) || []).length, 0, "тег из имени группы не ожил");
});

/* ── ПОКОМНАТНОЕ разбиение связей (часть 1d) ───────────────────────────────────────────────
   Бакет цепочки — пара «комната + ключ группы». Ключ комнаты приходит готовым полем post.room
   (в app.js его кладёт EPLightingByRoom.partitionNorm от roomId). Одноимённая группа в РАЗНЫХ
   комнатах — разные цепочки; в одной комнате — как раньше; spec без поля комнаты не меняет
   прежнего поведения (у всех постов ключ один). */

test("одноимённая группа в РАЗНЫХ комнатах линией не соединяется", () => {
  /* «Кухня» на этаже r:1 и «Кухня» на этаже r:2 — это две разные цепочки, по одному месту в
     каждой. Линий нет: соединять внутри комнаты нечего, а через комнаты — недопустимо. */
  const L = layout(square({ posts: [
    { number: 1, x: 60, y: 60, room: "r:1", groups: [G("кухня", "Кухня")] },
    { number: 2, x: 140, y: 140, room: "r:2", groups: [G("кухня", "Кухня")] }
  ] }));
  assert.equal(L.groupLines.length, 0, "разные комнаты — одноимённые группы не сшиваются");
});

test("две одноимённые группы в РАЗНЫХ комнатах, по два поста — ДВЕ отдельные цепочки", () => {
  const L = layout(square({ posts: [
    { number: 1, x: 40, y: 40, room: "r:1", groups: [G("кухня", "Кухня")] },
    { number: 2, x: 80, y: 80, room: "r:1", groups: [G("кухня", "Кухня")] },
    { number: 3, x: 120, y: 120, room: "r:2", groups: [G("кухня", "Кухня")] },
    { number: 4, x: 160, y: 160, room: "r:2", groups: [G("кухня", "Кухня")] }
  ] }));
  assert.equal(L.groupLines.length, 2, "по одной линии внутри каждой комнаты, не одна сквозная");
  /* внутри r:1 сшиты посты 1-2, внутри r:2 — посты 3-4; проверяем концы по биркам */
  close(L.groupLines[0].x1, L.badges[0].left, "первая связь — пост 1 (комната r:1)");
  close(L.groupLines[0].x2, L.badges[1].left, "…к посту 2 (та же r:1)");
  close(L.groupLines[1].x1, L.badges[2].left, "вторая связь — пост 3 (комната r:2)");
  close(L.groupLines[1].x2, L.badges[3].left, "…к посту 4 (та же r:2)");
});

test("та же группа в ОДНОЙ комнате соединяется как раньше", () => {
  const L = layout(square({ posts: [
    { number: 1, x: 60, y: 60, room: "r:1", groups: [G("кухня", "Кухня")] },
    { number: 2, x: 140, y: 140, room: "r:1", groups: [G("кухня", "Кухня")] }
  ] }));
  assert.equal(L.groupLines.length, 1, "одна комната — связь как прежде");
});

test("посты без комнаты — одна общая корзина «без помещения»", () => {
  /* Ключ «без помещения» одинаков у обоих (partitionNorm(null) даёт «no-room»): группа сшивается. */
  const L = layout(square({ posts: [
    { number: 1, x: 60, y: 60, room: "no-room", groups: [G("кухня", "Кухня")] },
    { number: 2, x: 140, y: 140, room: "no-room", groups: [G("кухня", "Кухня")] }
  ] }));
  assert.equal(L.groupLines.length, 1, "без комнаты — одна корзина, связь есть");
});

test("spec без поля комнаты: прежнее поведение (все посты в одной корзине)", () => {
  const L = layout(square({ posts: [
    { number: 1, x: 60, y: 60, groups: [G("кухня", "Кухня")] },
    { number: 2, x: 140, y: 140, groups: [G("кухня", "Кухня")] }
  ] }));
  assert.equal(L.groupLines.length, 1, "нет поля комнаты — прежняя одна цепочка, не падение");
});
