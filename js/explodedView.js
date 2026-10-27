/* Взрыв-схема поста для листа монтажника (ориентир — иллюстрации-«разнесёнки» из каталогов
   VIMAR: устройства управления, суппорт, коробка и накладка разнесены в пространстве, от каждой
   детали идёт выносная линия к подписи). ДОПОЛНЯЕТ, а не заменяет собранную картинку
   (assembledImageHtml из EPPostImage): та показывает изделие в сборе, эта — из чего оно состоит,
   с артикулом У КАЖДОЙ детали (главное требование — монтажник должен видеть код позиции).

   Модуль чистый, как installSheet.js/postImage.js: на вход готовый spec (детали поста уже
   собраны оркестратором из каталога — второй раз в каталог не ходим) и форматтеры, на выход —
   строка HTML. Ни state, ни DOM. Значок детали НЕ изобретаем: переиспользуем каталожную систему
   иконок VIMAR — pickIcon(признаки товара)→тип и iconSvg(тип)→инлайновый SVG, обе приходят из
   EPPostImage через deps. Так глиф детали во взрыв-схеме совпадает с тем, что рисует конструктор.

   ПЕЧАТЬ. Лист монтажника уходит в отдельное окно печати; вся геометрия задана ИНЛАЙН-СТИЛЯМИ и
   инлайновым SVG (как в postImage.js) — без внешних классов, которые в окне печати не подтянутся.
   Сцена резиновая: фикс-ширина W (теперь ЗАВИСИТ от числа деталей — ряд шире колонки), но не шире
   контейнера (max-width:100%), высоту резервирует ПРОЦЕНТНЫЙ padding-top ЗАРАНЕЕ — вёрстка не
   схлопывается до загрузки фото накладки с vimar.ru (тот же приём и та же причина, что в
   postImage.js). Линии рисует один SVG-слой в тех же координатах W×H, детали и подписи —
   абсолютные HTML-блоки, спозиционированные в % от сцены; при сжатии сцены и SVG, и блоки
   масштабируются вместе, поэтому концы выносных линий держатся.

   spec = {
     parts: [ {
       role,          // узел: "Накладка" / "Суппорт" / "Монтажная коробка" / "Модуль" …
       pos?,          // позиция модуля ("2" / "2–3") — приписывается к role в подписи
       name,          // наименование детали
       code?,         // артикул (в подпись идёт всегда: есть → код, нет → «—»)
       icon?: { categoryId?, icon?, name? },  // признаки товара для pickIcon → глиф каталога
       photo?: { imageUrl, wide? }            // настоящее фото ЛЮБОЙ детали; wide → широкий бокс
                                              //   (накладка), иначе квадратный (товар). Нет фото → глиф
     } ]
   }
   deps = { esc(s), pickIcon(iconInput)→тип, iconSvg(тип, px, ink)→SVG }.
   Интерфейс приложению — window.EPExplodedView.buildHtml(spec, deps). */
(() => {
"use strict";

/* Геометрия сцены в px «дизайна» (координаты SVG и % HTML считаются от неё). Детали идут ГОРИЗОНТАЛЬНЫМ
   рядом слева направо в порядке сборки, но не «одна деталь = один слот»: механизмы (role==="Модуль")
   сворачиваются в ОДНУ X-позицию и стекаются друг под другом по Y. Итог для типового поста — три-четыре
   слота: [накладка] [СТЕК механизмов] [суппорт] [коробка] (см. columns в buildHtml). Так модули не режут
   ряд на N карточек, а читаются одной группой на общем «шампуре» (владелец продукта попросил именно это).
   Раскладка по X — накопительная: каждая следующая КОЛОНКА отстоит от предыдущей на постоянный ЧИСТЫЙ
   зазор GAP_X между краями (а не на фикс-шаг центров), потому что бокс накладки шире квадратных боксов
   товаров — при фикс-шаге зазор «плавал» бы и накладка выныривала из-под соседа. По Y карточки внутри
   стека разделены полной ячейкой (бокс + подпись + чистый просвет GAP_Y), одиночные колонки (накладка,
   суппорт, коробка) центрируются по вертикали относительно самой высокой колонки — не «прилипают» к верху
   на фоне высокого стека. Ширина W зависит от числа колонок, высота H — от самой высокой колонки (стек). */
/* K11 раунд 4. Вертикальные поля сцены срезаны (с 14 до 10): взрыв-схема — единственный неделимый ряд
   карточки (.post-visuals), её высота решает, влезет ли ряд в остаток страницы. По 4px сверху и снизу на
   каждом посте проекта набегают в итоговую раскладку листа. Горизонтальное поле PAD_SIDE не трогаем:
   оно работает в паре с LABEL_W, чтобы крайняя подпись не вылезла за кадр. */
const PAD_TOP = 10, PAD_BOT = 10, PAD_SIDE = 14;
/* K11, раунд 2. Размеры уменьшены сознательно: во взрыв-схеме бокс и подпись заданы в ФИКСИРОВАННЫХ px,
   а позиции — в % сцены. Пока сцена не масштабируется (её натуральная ширина ≤ контейнера), px и %
   совпадают и подписи стоят точно в своём резерве. Как только сцена едет рядом с иллюстрацией и её
   натуральная ширина больше ячейки, max-width:100% сжимает ТОЛЬКО позиции (%), а боксы и текст остаются
   крупными — и подпись наезжает на соседний бокс (дефект приёмки). Поэтому держим натуральную ширину
   сцены (3–4 механизма ≈ 508px) МЕНЬШЕ ячейки схемы в ряду — тогда рендер идёт 1:1 и наложений нет. */
const ICON = 64;                  // сторона квадратной иконки-детали. K11 раунд 3: уменьшена с 80, чтобы
                                  //   стек механизмов (2 ряда) был ниже и карточки плотнее укладывались на
                                  //   страницу проекта. Подпись шире бокса (LABEL_W), но её ширины хватает на
                                  //   самое длинное слово, а соседние подписи всё равно разведены (см. LABEL_W)
const PHOTO_W = 86, PHOTO_H = 56; // бокс широкого фото накладки (та же пропорция ~1.53, что была у 128×84)
const PHOTO_SQ = 64;              // бокс квадратного фото товара (превью VIMAR — квадратные); = ICON,
                                  //   чтобы фото и глифы-плашки товаров держали одну высоту в ряду
const GAP_X = 24;                 // чистый горизонтальный просвет между соседними КОЛОНКАМИ (гейт в тесте ≥20px)
const GAP_Y = 20;                 // чистый ВЕРТИКАЛЬНЫЙ просвет между карточками внутри стека механизмов —
                                  //   от низа резерва подписи одной карточки до верха бокса следующей.
                                  //   K11 раунд 4: опущен с 24 до пола 20px (ниже гейт теста непересечения
                                  //   не пускает) — стек механизмов становится ниже, карточки плотнее
const LABEL_W = 80;              // ширина блока подписи ≥ самого длинного слова при 11px (≈77px, замерено в
                                  //   Chrome) — при рендере 1:1 слово в неё помещается и НЕ рвётся. Подпись
                                  //   шире бокса (64), но полуразнос (8px) меньше половины GAP_X, поэтому
                                  //   соседние подписи НЕ пересекаются (гейт — тест непересечения прямоугольников)
const TICK_GAP = 10;             // вертикальный зазор от низа иконки до верха подписи — в нём живёт тик-линия.
                                 //   K11 раунд 4: срезан с 12 до 10 — в стеке он входит в высоту ДВАЖДЫ
/* Сокращение наименования в подписи — по ШИРИНЕ бокса, а не по числу символов (владелец 26.10: «имя не
   длиннее двух строк, обрезка по слову»). Прежний потолок в 22 символа двум строкам не равен: жирным 11px
   «Шшшшшш» вдвое шире «iiiiii», и 22-символьное имя из широких букв давало 3-ю строку, а line-clamp рвал
   её посреди слова (дефект приёмки Д3: «Адаптер Keystone…», «Коробка встраиваем…»). shortenName ниже
   оценивает ширину слов по ИЗМЕРЕННОЙ таблице (CHAR_W, Arial 600 11px, замерено в Chrome, округлено вверх)
   и держит столько слов, сколько влезает в NAME_LINES строк по LABEL_W. CSS-клэмп (-webkit-line-clamp:2)
   оставлен СТРАХОВКОЙ. */
const NAME_LINES = 2;             // имя в подписи — не длиннее двух строк (владелец 26.10)
const LABEL_H = 76;              // резерв высоты под подпись, ЧЕСТНЫЙ worst-case (замерено в Chrome, окно 400px,
                                  //   с переносами кикера и кода ниже): самая высокая подпись ≈71px. Разбор по
                                  //   узлам: у суппорта кикер «СУППОРТ ×2 (ПРЕДПОЛОЖИТЕЛЬНО)» — 3 строки 9px
                                  //   (≈30px: слово «(ПРЕДПОЛОЖИТЕЛЬНО)» ≈114px само ломается на 2 строки) + имя
                                  //   2 строки 11px (клэмп, ≈26px) + код 1 строка (09613); у механизма кикер
                                  //   «МОДУЛЬ … · ПОДСВЕТКА» 2 строки + имя 2 строки + код 2 строки (14-символьный
                                  //   артикул ≈92px рвётся на 2 через overflow-wrap:anywhere) ≈71px. 76 — c запасом
                                  //   ~5px. Переносы честные: кикер overflow-wrap:break-word, код overflow-wrap:
                                  //   anywhere, имя line-clamp:2 — ни один текст за ширину подписи не вылезает
const ICON_PX = 36;              // сторона глифа внутри 64-плашки (та же доля ~0.565)
const INK = "#2f4257";           // цвет глифа — тёмно-синий чернил документа
const MAX_STACK_ROWS = 2;        // СТАРТОВАЯ высота стека механизмов в рядах (K11). Раньше это был жёсткий
                                 //   потолок, и лишние механизмы уходили вбок — схема росла до 826px, вылезала
                                 //   за карточку и рассинхронивала подписи (Д1). Теперь это лишь НИЖНЯЯ граница:
                                 //   layout наращивает рядность, пока ширина не уляжется в FIT_W (меньше колонок —
                                 //   уже схема). На типовом посте (≤6 механизмов) двух рядов хватает и раскладка
                                 //   прежняя; выше — стек растёт в высоту, а не вбок
const FIT_W = 650;               // предел НАТУРАЛЬНОЙ ширины сцены, px (K11 раунд 5, Д1). Внутренняя ширина
                                 //   карточки листа на A4 ≈654px (210мм − поля 14мм − паддинг карточки 16px −
                                 //   рамка); держим сцену УЖЕ неё с запасом ~4px. Схема, не влезшая рядом с
                                 //   иллюстрацией, переносится ПОД неё (installSheet .post-visuals flex-wrap) и там
                                 //   встаёт во всю ширину карточки — но всё равно ≤FIT_W<654, поэтому max-width:100%
                                 //   её НЕ сжимает и рассинхрона px-боксов с %-позициями не возникает

/* Раскладка плоского списка деталей в КОЛОНКИ ряда — ЧИСТАЯ функция, без геометрии и DOM: её можно
   проверить тестом отдельно. На вход либо массив деталей (нужны role и pos), либо массив ролей-строк
   (прежний контракт тестов). Оркестратор (buildExplodedSpec в app.js) кладёт детали в порядке
   накладка(и) → подряд идущие механизмы → суппорт → коробка.
   Механизмы (role==="Модуль") сворачиваются в стек по Y. СНАЧАЛА группируем их в ЕДИНИЦЫ КЛАВИШ:
   клавиша + её механизм группы света + её подсветка (docs.js ставит их подряд, у зависимых деталей в
   pos есть разделитель « · ») — одна единица. Детали одной клавиши НЕ делятся между колонками (Д4):
   иначе подсветка клавиши 1 оказывалась над клавишей 2. Затем единицы пакуем в колонки, добавляя их,
   пока суммарных РЯДОВ в колонке ≤ maxRows (но хотя бы одна единица в колонке — даже если она выше).
   maxRows по умолчанию MAX_STACK_ROWS; layout наращивает его, пока ширина сцены не уляжется в FIT_W —
   тогда у широкой схемы становится меньше колонок (она не вылезает за карточку, Д1).
   Контракт прежних тестов сохранён: роли-строки трактуются как самостоятельные клавиши (единица из
   одного ряда), и при maxRows=2 один механизм даёт колонку из одной детали, два — одну колонку-стек.
   Остальные детали (накладка, суппорт, коробка) — по колонке на деталь. Колонка — массив ИНДЕКСОВ
   деталей сверху вниз. */
function layoutColumns(items, maxRows) {
  const list = Array.isArray(items) ? items : [];
  const n = list.length;
  const roleOf = el => (el && typeof el === "object") ? el.role : el;
  const posOf = el => (el && typeof el === "object") ? el.pos : undefined;
  const rows = Number(maxRows) > 0 ? Math.floor(maxRows) : MAX_STACK_ROWS;
  const cols = [];
  const firstMod = list.findIndex(el => roleOf(el) === "Модуль");
  if (firstMod === -1) { for (let i = 0; i < n; i++) cols.push([i]); return cols; }
  let lastMod = firstMod;
  while (lastMod + 1 < n && roleOf(list[lastMod + 1]) === "Модуль") lastMod++;
  for (let i = 0; i < firstMod; i++) cols.push([i]);            // накладка(и) — до первого механизма
  /* Единицы клавиш: деталь с « · » в pos (механизм/подсветка) прилипает к текущей клавише, иначе
     начинает новую. Роль-строка pos не несёт → каждая деталь своя единица (прежний контракт). */
  const units = [];
  for (let i = firstMod; i <= lastMod; i++) {
    const dependent = / · /.test(String(posOf(list[i]) == null ? "" : posOf(list[i])));
    if (!dependent || !units.length) units.push([i]); else units[units.length - 1].push(i);
  }
  let col = [], used = 0;
  units.forEach(u => {
    if (col.length && used + u.length > rows) { cols.push(col); col = []; used = 0; }
    u.forEach(i => col.push(i)); used += u.length;
  });
  if (col.length) cols.push(col);
  for (let i = lastMod + 1; i < n; i++) cols.push([i]);         // суппорт, коробка — после механизмов
  return cols;
}

/* Размер бокса детали: настоящее фото → широкий (накладка) или квадратный (товар); нет фото → плашка глифа. */
const boxWof = p => (p && p.photo && p.photo.imageUrl) ? (p.photo.wide ? PHOTO_W : PHOTO_SQ) : ICON;
const boxHof = p => (p && p.photo && p.photo.imageUrl) ? (p.photo.wide ? PHOTO_H : PHOTO_SQ) : ICON;

/* Горизонтальная геометрия колонок — ОДНА копия (её зовёт и поиск рядности, и сама layout): ширина каждой
   колонки (по самому широкому боксу), центры колонок накопительно (край к краю + GAP_X) и итоговая ширина
   сцены. По краям отступ берём по большему из бокса и подписи (LABEL_W может быть шире крайнего бокса),
   чтобы подпись не вылезла за сцену. */
function colGeometryX(parts, columns) {
  const colW = columns.map(col => Math.max.apply(null, col.map(i => boxWof(parts[i]))));
  const colCenterX = [];
  columns.forEach((col, j) => {
    colCenterX[j] = j === 0
      ? PAD_SIDE + Math.max(colW[0] / 2, LABEL_W / 2)
      : colCenterX[j - 1] + colW[j - 1] / 2 + GAP_X + colW[j] / 2;
  });
  const last = columns.length - 1;
  const sceneW = colCenterX[last] + Math.max(colW[last] / 2, LABEL_W / 2) + PAD_SIDE;
  return { colW, colCenterX, sceneW };
}

/* ГЕОМЕТРИЯ взрыв-схемы — ЧИСТАЯ функция в координатах «дизайна» (px сцены), без DOM и без %: её
   можно проверить тестом на отсутствие пересечений прямоугольников бокс/подпись. buildHtml лишь
   переводит эти координаты в проценты и рисует. Схема печатается 1:1 (не масштабируется, см.
   installSheet .post-visuals), поэтому НЕПЕРЕСЕЧЕНИЕ в этих координатах = непересечение на бумаге.
   На вход parts (нужны role для колонок и photo для размера бокса), на выход sceneW/H, ось и по
   каждой детали прямоугольники бокса и зарезервированной подписи (labW×labH).
   Возвращает {sceneW,H,axisY,columns,colCenterX,items:[{cx,cy,bw,bh,labLeft,labTop,labW,labH}]}. */
function layout(parts) {
  const n = parts.length;
  /* Рядность стека ищем снизу вверх (K11 раунд 5, Д1): при двух рядах схема иногда шире карточки
     (много механизмов → много колонок). Пока натуральная ширина сцены > FIT_W, наращиваем maxRows —
     единиц в колонке становится больше, колонок меньше, схема уже. maxRows ограничен числом деталей
     (дальше сокращать нечего), так цикл заведомо конечен. Детали клавиши при этом не разрываются —
     это обеспечивает группировка в layoutColumns. */
  let maxRows = MAX_STACK_ROWS;
  let columns = layoutColumns(parts, maxRows);
  while (colGeometryX(parts, columns).sceneW > FIT_W && maxRows < n) {
    maxRows++;
    columns = layoutColumns(parts, maxRows);
  }
  const gx = colGeometryX(parts, columns);
  const colCenterX = gx.colCenterX, sceneW = gx.sceneW;
  /* Раскладка КАЖДОЙ колонки по Y относительно её верха (relTop[0]=0). Ячейка карточки = бокс + тик + резерв
     подписи (cellH); между карточками стека — чистый просвет GAP_Y. Дальше берём вертикальный размах БОКСОВ
     (от верха первого до низа последнего) и его середину boxSpanMid: по ней центрируем колонку на общей оси
     axisY. Так одиночные колонки садятся боксом ровно на ось (как в прежнем ряду), а стек раскрывается
     симметрично вверх-вниз от оси. topExtent/botExtent — насколько колонка торчит выше/ниже своей оси
     (низ = резерв подписи последней карточки), из их максимумов и складывается высота сцены. */
  const cellH = i => boxHof(parts[i]) + TICK_GAP + LABEL_H;
  const relTop = columns.map(col => {
    const r = [0];
    for (let k = 1; k < col.length; k++) r[k] = r[k - 1] + cellH(col[k - 1]) + GAP_Y;
    return r;
  });
  const boxSpanMid = columns.map((col, j) => {
    const lastK = col.length - 1;
    return (relTop[j][0] + relTop[j][lastK] + boxHof(parts[col[lastK]])) / 2;
  });
  const topExtent = columns.map((col, j) => boxSpanMid[j] - relTop[j][0]);
  const botExtent = columns.map((col, j) => {
    const lastK = col.length - 1;
    return relTop[j][lastK] + cellH(col[lastK]) - boxSpanMid[j];
  });
  const maxTop = Math.max.apply(null, topExtent), maxBot = Math.max.apply(null, botExtent);
  const axisY = PAD_TOP + maxTop;                    // общая ось: центры одиночных боксов и середина стека
  const H = PAD_TOP + maxTop + maxBot + PAD_BOT;
  /* Прямоугольники каждой ДЕТАЛИ (по исходному индексу i): центр бокса cx/cy, верх и левый край подписи.
     Смещаем колонку так, чтобы её boxSpanMid лёг на axisY; внутри колонки карточки идут по relTop. */
  const items = new Array(n);
  columns.forEach((col, j) => {
    const offset = axisY - boxSpanMid[j];
    col.forEach((i, k) => {
      const cardTop = offset + relTop[j][k];
      const bw = boxWof(parts[i]), bh = boxHof(parts[i]);
      items[i] = { cx: colCenterX[j], cy: cardTop + bh / 2, bw, bh,
        labLeft: colCenterX[j] - LABEL_W / 2, labTop: cardTop + bh + TICK_GAP, labW: LABEL_W, labH: LABEL_H };
    });
  });
  return { sceneW, H, axisY, columns, colCenterX, items };
}

/* Ширина символа в px для оценки переноса (Arial 600 11px — шрифт наименования в подписи). Таблица
   ЗАМЕРЕНА в Chrome (символ ×30 / 30) и округлена ВВЕРХ до 0.5px: оценка всегда НЕ МЕНЬШЕ реальной
   ширины, поэтому слов отбирается не больше, чем влезет, и третьей строки не возникает. Незнакомый
   символ (в т.ч. «…») — по самому широкому «Ш» (DEFAULT_CW): редкий знак скорее переоценим, чем
   недооценим. Буквы сгруппированы по измеренной ширине. */
const DEFAULT_CW = 11.5, SPACE_W = 3.5;
const CHAR_W = (() => {
  const m = {};
  [[3.5, "  ,ilI/.j"], [4, "-tf()"], [4.5, "r°"], [5, "г"], [5.5, "тз\""], [6, "1к"],
   [6.5, "023456789еясчаухeasyc+эJvГkx~ё«»"], [7, "водилпбрйнLnudТoTУZgFhьцКbЗpøq"],
   [7.5, "VEXPРSYХÉ"], [8, "СDKNBHUПAВНжДАRCЛЭЧБ"], [8.5, "мъ"], [9, "QGwO"],
   [9.5, "ыюMМшФщ"], [10, "фm"], [10.5, "W"], [11.5, "Ш"]
  ].forEach(([w, chars]) => { for (const c of chars) m[c] = w; });
  return m;
})();
const charWidth = ch => { const w = CHAR_W[ch]; return w === undefined ? DEFAULT_CW : w; };
const wordWidth = w => { let s = 0; for (const ch of w) s += charWidth(ch); return s; };

/* Разбивка слова на под-чанки по возможностям переноса CSS — после «-» и «/» (как в «Механизм-
   выключатель», «Technologies/Avaya/Systimax»): движок предпочитает рвать строку ИМЕННО там, и
   не учитывать это — занизить число строк (дефект: «Механизм-выключатель…» рвётся на 3 строки, а
   посимвольная оценка давала 2). Разделитель остаётся в левом чанке. */
function splitBreakable(word) {
  const subs = []; let cur = "";
  for (const ch of word) { cur += ch; if (ch === "-" || ch === "/") { subs.push(cur); cur = ""; } }
  if (cur) subs.push(cur);
  return subs;
}

/* Сколько строк займёт text в боксе ширины maxW при ЖАДНОМ переносе (как CSS с overflow-wrap:break-word):
   чанк (слово или часть слова до/после дефиса), не влезающий в остаток строки, уходит на новую; чанк
   шире всей строки ломается посимвольно. Пробел считаем только на границе СЛОВ. Оценка консервативна —
   ширины символов округлены вверх, поэтому реальных строк не больше оценки. */
function linesNeeded(text, maxW) {
  let lines = 1, cur = 0;
  const words = String(text).split(/\s+/).filter(Boolean);
  words.forEach((word, wi) => {
    splitBreakable(word).forEach((sub, si) => {
      if (!sub) return;
      const sp = (si === 0 && wi > 0 && cur > 0) ? SPACE_W : 0;   // пробел — только перед первым чанком слова
      const sw = wordWidth(sub);
      if (cur + sp + sw <= maxW) { cur += sp + sw; return; }
      if (cur > 0) { lines++; cur = 0; }
      if (sw <= maxW) { cur = sw; return; }
      for (const ch of sub) {                       // под-чанк шире строки — ломаем посимвольно
        const cw = charWidth(ch);
        if (cur + cw <= maxW) cur += cw; else { lines++; cur = cw; }
      }
    });
  });
  return lines;
}

/* Снять висячую пунктуацию/пробел перед «…» (владелец 26.10: «модуля,…» → «модуля…»). */
const stripTail = s => s.replace(/[\s,.;:–\-·(«]+$/, "");

/* Сокращение наименования для подписи схемы — ПО ШИРИНЕ, в ≤ maxLines строк по maxW (владелец 26.10:
   «имя не длиннее двух строк, обрезка по слову»). НЕ словарь сокращений — формулировки руками не
   придумываем: отрезаем по границе слова и ставим «…». Имя влезает целиком — возвращаем как есть, без
   «…». Первое слово само шире бюджета режем ПО ВНУТРЕННЕЙ ГРАНИЦЕ — после «-»/«/» (splitBreakable):
   «Механизм-выключатель 1P 16AX серый» → «Механизм-…», дефис СОХРАНЯЕТСЯ перед «…» (владелец 27.10) —
   так монтажник видит осмысленный корень, а не обрубок «Механизм-выключате…» посреди слова. Посимвольный
   рез — только когда не влезает даже первый под-чанк (одно слитное слово без «-»/«/», напр.
   «Электроустановочноеизделие»). Полное имя остаётся в таблицах под схемой, поэтому потеря хвоста
   содержимое не теряет. Работает на СЫРОЙ строке (до esc). */
function shortenName(name, maxW, maxLines) {
  const s = String(name == null ? "" : name).trim();
  const W = Number(maxW) > 0 ? Number(maxW) : LABEL_W;
  const L = Number(maxLines) > 0 ? Math.floor(maxLines) : NAME_LINES;
  if (!s) return s;
  if (linesNeeded(s, W) <= L) return s;           // влезает целиком — без «…»
  const words = s.split(/\s+/);
  let best = "";                                  // самый длинный префикс целых слов, влезающий с «…»
  for (let k = 1; k < words.length; k++) {
    const cand = stripTail(words.slice(0, k).join(" "));
    if (cand && linesNeeded(cand + "…", W) <= L) best = cand; else break;  // строки монотонны — дальше не влезет
  }
  if (best) return best + "…";
  /* Первое слово целиком не влезло — берём самый длинный префикс его под-чанков (граница после «-»/«/»),
     влезающий с «…». Разделитель НЕ снимаем (владелец: «Механизм-…»), иначе обрезка потеряла бы видимую
     границу переноса. splitBreakable оставляет «-»/«/» в левом чанке — его и сохраняем. */
  const subs = splitBreakable(words[0]);
  let bestSub = "";
  for (let k = 1; k < subs.length; k++) {
    const cand = subs.slice(0, k).join("");
    if (linesNeeded(cand + "…", W) <= L) bestSub = cand; else break;       // строки монотонны — дальше не влезет
  }
  if (bestSub) return bestSub + "…";
  let cut = "";                                   // не влезает даже первый под-чанк — режем посимвольно
  for (const ch of words[0]) {
    if (linesNeeded(cut + ch + "…", W) <= L) cut += ch; else break;
  }
  return stripTail(cut) + "…";
}

function buildHtml(spec, deps) {
  const esc = (deps && deps.esc) || (s => String(s == null ? "" : s));
  const pickIcon = (deps && deps.pickIcon) || (() => "generic");
  const iconSvg = deps && deps.iconSvg;
  const parts = (spec && Array.isArray(spec.parts) ? spec.parts : []).filter(Boolean);
  const n = parts.length;
  if (!n) return "";   /* нет деталей (пост без наполнения) — блок не рисуем, лист не падает */

  const L = layout(parts);
  const columns = L.columns, colCenterX = L.colCenterX, axisY = L.axisY, sceneW = L.sceneW, H = L.H;
  const boxH = p => boxHof(p);
  const cx = L.items.map(it => it.cx), cy = L.items.map(it => it.cy), labTop = L.items.map(it => it.labTop);

  const px = x => (x / sceneW * 100).toFixed(3);   // px дизайна → % ширины сцены
  const py = y => (y / H * 100).toFixed(3);        // px дизайна → % высоты сцены

  /* SVG-слой разнесённой сборки. Ось-«шампур» — горизонтальная прямая через центры КОЛОНОК на общей оси
     axisY (проходит сквозь одиночные боксы и середину стека, в стек заходит сбоку). У стека механизмов —
     вертикальный «шампур»-спайн от центра первой карточки до центра последней: показывает, что это одна
     колонка, нанизанная по Y. Плюс короткий тик-соединитель от низа каждого бокса к верху его подписи. Один
     общий viewBox W×H, поэтому линии совпадают с абсолютными HTML-блоками (те в % от той же сцены).
     vector-effect держит толщину при неравномерном сжатии. Слой рисуется ПОД боксами (HTML после SVG в
     потоке), поэтому «шампур» виден только в просветах — эффект разнесённой сборки. */
  const axisPts = colCenterX.map(x => `${x.toFixed(1)},${axisY.toFixed(1)}`).join(" ");
  const axis = `<polyline points="${axisPts}" fill="none" stroke="#c4d3e3" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  const spines = columns.map((col, j) => {
    if (col.length < 2) return "";   // спайн нужен только там, где карточек несколько (стек механизмов)
    const x = colCenterX[j].toFixed(1);
    return `<line x1="${x}" y1="${cy[col[0]].toFixed(1)}" x2="${x}" y2="${cy[col[col.length - 1]].toFixed(1)}" stroke="#c4d3e3" stroke-width="1.3" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  }).join("");
  const leaders = parts.map((p, i) => {
    const yBox = (cy[i] + boxH(p) / 2).toFixed(1);  // низ бокса детали
    const x = cx[i].toFixed(1);
    return `<line x1="${x}" y1="${yBox}" x2="${x}" y2="${labTop[i].toFixed(1)}" stroke="#8aa4bf" stroke-width="1" stroke-dasharray="1.5 3" vector-effect="non-scaling-stroke"/>`;
  }).join("");

  /* Детали — абсолютные HTML-блоки по центру своей позиции в ряду. Деталь с настоящим фото → <img>
     (широкий бокс у накладки — wide, квадратный у товара), без фото → каталожный глиф в плашке.
     object-fit:contain не режет кадр: квадратное превью товара впишется в квадратный бокс без полей. */
  const nodes = parts.map((p, i) => {
    const style = `position:absolute;left:${px(cx[i])}%;top:${py(cy[i])}%;transform:translate(-50%,-50%);box-sizing:border-box`;
    if (p.photo && p.photo.imageUrl) {
      const bw = p.photo.wide ? PHOTO_W : PHOTO_SQ;
      const bh = p.photo.wide ? PHOTO_H : PHOTO_SQ;
      return `<div style="${style};width:${bw}px;height:${bh}px;background:#fff;border:1px solid #cfe0f0;border-radius:9px;overflow:hidden;display:flex;align-items:center;justify-content:center">`
        + `<img src="${esc(p.photo.imageUrl)}" alt="${esc(p.name || "Деталь")}" style="max-width:100%;max-height:100%;object-fit:contain"></div>`;
    }
    const type = pickIcon(p.icon || {});
    const glyph = iconSvg
      ? iconSvg(type, ICON_PX, INK)
      : `<span style="font-family:Arial,sans-serif;font-size:${ICON_PX}px;line-height:1;color:${INK}">${esc((p.icon && p.icon.icon) || "•")}</span>`;
    return `<div style="${style};width:${ICON}px;height:${ICON}px;display:flex;align-items:center;justify-content:center;background:#f2f8ff;border:1px solid #cfe0f0;border-radius:12px">${glyph}</div>`;
  }).join("");

  /* Подписи — компактный блок ПОД каждой карточкой (labTop[i]), центрированный на её оси X. У стека
     механизмов подписей несколько — по одной под каждой карточкой стека, каждая на своём Y. Кикер (узел +
     позиция модуля) по содержанию НЕ сокращаем, но даём overflow-wrap:break-word — длинное слово
     «(ПРЕДПОЛОЖИТЕЛЬНО)» (114px) само перенесётся, а не вылезет на соседнюю подпись (Д2). Наименование
     сокращаем до двух строк (владелец 26.10): shortenName режет по слову с «…» ПО ШИРИНЕ, а CSS-клэмп
     (-webkit-line-clamp:2 — движок печати Chrome его понимает, как в бирках плана) оставлен страховкой.
     Код — отдельной строкой моноширинным БЕЗ слова «Артикул:» (владелец 26.10): кикер уже называет узел,
     а моноширинный код и так читается как артикул; нет кода → «—», чтобы монтажник видел пропуск.
     overflow-wrap:anywhere ломает 14-символьный артикул (≈92px>LABEL_W) на две строки, а не внахлёст на
     соседа (Д2). Полное имя детали — в таблицах под схемой. Текст по центру — подпись «сидит» под иконкой. */
  const labels = parts.map((p, i) => {
    const kicker = p.pos ? `${p.role || ""} ${p.pos}`.trim() : (p.role || "");
    /* K11 раунд 6 (владелец 27.10). Белый фон + z-index:1 под подписью: ось-«шампур» и вертикальный
       спайн стека проходят через Y верхней подписи и «зачёркивали» её текст (20021.B, 09001). Подпись
       рисуется ПОСЛЕ SVG-слоя и с z-index:1 — она выше линий, а фон прячет линию ПОД текстом (линия
       «уходит под подпись», как просил владелец). print-color-adjust:exact — чтобы белый фон печатался
       (иначе в PDF линия снова проступит), тот же приём, что у плашек фото/иконок выше. Фон в границах
       labW×labH (резерв подписи), а он с боксами/фото не пересекается (тест непересечения) — иконки и
       фото соседних деталей подпись не перекрывает. */
    return `<div style="position:absolute;left:${px(cx[i] - LABEL_W / 2)}%;top:${py(labTop[i])}%;width:${px(LABEL_W)}%;font-family:Arial,sans-serif;text-align:center;box-sizing:border-box;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;z-index:1">`
      + (kicker ? `<div style="font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:#8195a9;overflow-wrap:break-word">${esc(kicker)}</div>` : "")
      + `<div style="font-size:11px;color:#172b3f;font-weight:600;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:break-word">${esc(shortenName(p.name || "—", LABEL_W))}</div>`
      + `<div style="font-size:11px;color:#33465a;font-family:'Courier New',monospace;margin-top:1px;overflow-wrap:anywhere">${esc(p.code || "—")}</div>`
      + `</div>`;
  }).join("");

  return `<div style="position:relative;width:${sceneW}px;max-width:100%">`
    + `<div style="position:relative;padding-top:${(H / sceneW * 100).toFixed(3)}%;height:0">`
    + `<svg viewBox="0 0 ${sceneW} ${H}" width="100%" height="100%" preserveAspectRatio="none" style="position:absolute;inset:0;overflow:visible" fill="none">${axis}${spines}${leaders}</svg>`
    + nodes + labels
    + `</div></div>`;
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для
   автотестов (PLAN 7.1). */
const api = { buildHtml, layoutColumns, layout, shortenName, linesNeeded };
if (typeof window !== "undefined") window.EPExplodedView = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
