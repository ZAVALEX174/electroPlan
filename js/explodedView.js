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
const PAD_TOP = 14, PAD_BOT = 14, PAD_SIDE = 14;
const ICON = 92;                  // сторона квадратной иконки-детали (было 46 — увеличено ~×2)
const PHOTO_W = 128, PHOTO_H = 84;// бокс широкого фото накладки (накладка шире, чем высокая; ~×2 от 64×42)
const PHOTO_SQ = 92;              // бокс квадратного фото товара (превью VIMAR — квадратные); = ICON,
                                  //   чтобы фото и глифы-плашки товаров держали одну высоту в ряду
const GAP_X = 24;                 // чистый горизонтальный просвет между соседними КОЛОНКАМИ: ~26% от ICON(92)
                                  //   / ~19% от PHOTO_W(128) — глазу нужен зазор, пропорциональный крупным
                                  //   иконкам, иначе ряд «слипается» (гейт — в тесте, ≥20px)
const GAP_Y = 24;                 // чистый ВЕРТИКАЛЬНЫЙ просвет между карточками внутри стека механизмов —
                                  //   от низа резерва подписи одной карточки до верха бокса следующей. Тот же
                                  //   принцип «явный просвет», что и по X (гейт — в тесте, ≥20px), иначе
                                  //   визуально механизм «наезжает» на подпись соседа
const LABEL_W = 108;              // ширина блока подписи под иконкой: ≈ ширина иконки + небольшой запас —
                                  //   длинное наименование переносится в несколько строк внутри бокса
const TICK_GAP = 12;             // вертикальный зазор от низа иконки до верха подписи — в нём живёт тик-линия
const LABEL_H = 100;             // резерв высоты под подпись с переносом длинного имени (kicker + до ~5 строк
                                  //   наименования при 12px в узком боксе + артикул). Подписи спозиционированы
                                  //   абсолютом; резерв закладываем в высоту КАЖДОЙ ячейки стека, чтобы подпись
                                  //   механизма гарантированно не наехала на следующий бокс даже при длинном
                                  //   имени (текст в Node не измерить — берём консервативный worst-case)
const ICON_PX = 52;              // сторона глифа внутри 92-плашки (было 26 в 46-плашке — та же доля 0.565)
const INK = "#2f4257";           // цвет глифа — тёмно-синий чернил документа

function buildHtml(spec, deps) {
  const esc = (deps && deps.esc) || (s => String(s == null ? "" : s));
  const pickIcon = (deps && deps.pickIcon) || (() => "generic");
  const iconSvg = deps && deps.iconSvg;
  const parts = (spec && Array.isArray(spec.parts) ? spec.parts : []).filter(Boolean);
  const n = parts.length;
  if (!n) return "";   /* нет деталей (пост без наполнения) — блок не рисуем, лист не падает */

  /* Размер бокса детали: настоящее фото → широкий (накладка) или квадратный (товар); нет фото → плашка глифа. */
  const boxW = p => (p.photo && p.photo.imageUrl) ? (p.photo.wide ? PHOTO_W : PHOTO_SQ) : ICON;
  const boxH = p => (p.photo && p.photo.imageUrl) ? (p.photo.wide ? PHOTO_H : PHOTO_SQ) : ICON;

  /* Группировка плоского списка деталей в КОЛОНКИ ряда. Оркестратор (buildExplodedSpec в app.js) кладёт
     детали в порядке накладка(и) → подряд идущие механизмы → суппорт → коробка. Механизмы (role==="Модуль")
     сворачиваем в ОДНУ колонку (стек по Y), остальное — по колонке на деталь. Механизмы гарантированно идут
     подряд, поэтому берём непрерывный диапазон [firstMod..lastMod]. Модулей нет (пустой пост) → каждая деталь
     = своя колонка: раскладка вырождается в прежний горизонтальный ряд, рендер не падает. Колонка — массив
     ИНДЕКСОВ деталей сверху вниз (индекс, а не сама деталь, чтобы cx/cy/labTop заполнять по исходному i). */
  const columns = [];
  const firstMod = parts.findIndex(p => p.role === "Модуль");
  if (firstMod === -1) {
    parts.forEach((_, i) => columns.push([i]));
  } else {
    let lastMod = firstMod;
    while (lastMod + 1 < n && parts[lastMod + 1].role === "Модуль") lastMod++;
    for (let i = 0; i < firstMod; i++) columns.push([i]);   // накладка(и) — до первого механизма
    const stack = [];
    for (let i = firstMod; i <= lastMod; i++) stack.push(i); // блок подряд идущих механизмов — одна колонка
    columns.push(stack);
    for (let i = lastMod + 1; i < n; i++) columns.push([i]); // суппорт, коробка — после последнего механизма
  }

  /* Ширина колонки — по самому широкому боксу в ней (в стеке механизмов все квадратные, но общий случай). */
  const colW = columns.map(col => Math.max.apply(null, col.map(i => boxW(parts[i]))));

  /* Раскладка КАЖДОЙ колонки по Y относительно её верха (relTop[0]=0). Ячейка карточки = бокс + тик + резерв
     подписи (cellH); между карточками стека — чистый просвет GAP_Y. Дальше берём вертикальный размах БОКСОВ
     (от верха первого до низа последнего) и его середину boxSpanMid: по ней центрируем колонку на общей оси
     axisY. Так одиночные колонки садятся боксом ровно на ось (как в прежнем ряду), а стек раскрывается
     симметрично вверх-вниз от оси. topExtent/botExtent — насколько колонка торчит выше/ниже своей оси
     (низ = резерв подписи последней карточки), из их максимумов и складывается высота сцены. */
  const cellH = i => boxH(parts[i]) + TICK_GAP + LABEL_H;
  const relTop = columns.map(col => {
    const r = [0];
    for (let k = 1; k < col.length; k++) r[k] = r[k - 1] + cellH(col[k - 1]) + GAP_Y;
    return r;
  });
  const boxSpanMid = columns.map((col, j) => {
    const lastK = col.length - 1;
    return (relTop[j][0] + relTop[j][lastK] + boxH(parts[col[lastK]])) / 2;
  });
  const topExtent = columns.map((col, j) => boxSpanMid[j] - relTop[j][0]);
  const botExtent = columns.map((col, j) => {
    const lastK = col.length - 1;
    return relTop[j][lastK] + cellH(col[lastK]) - boxSpanMid[j];
  });
  const maxTop = Math.max.apply(null, topExtent), maxBot = Math.max.apply(null, botExtent);
  const axisY = PAD_TOP + maxTop;                    // общая ось: центры одиночных боксов и середина стека
  const H = PAD_TOP + maxTop + maxBot + PAD_BOT;

  /* Центры колонок по X — накопительно (край к краю + GAP_X). По краям учитываем, что подпись (LABEL_W)
     может быть шире крайнего бокса — отступ берём по большему, чтобы подпись не вылезла за сцену. */
  const colCenterX = [];
  columns.forEach((col, j) => {
    colCenterX[j] = j === 0
      ? PAD_SIDE + Math.max(colW[0] / 2, LABEL_W / 2)
      : colCenterX[j - 1] + colW[j - 1] / 2 + GAP_X + colW[j] / 2;
  });
  const lastCol = columns.length - 1;
  const sceneW = colCenterX[lastCol] + Math.max(colW[lastCol] / 2, LABEL_W / 2) + PAD_SIDE;

  /* Координаты каждой ДЕТАЛИ (по исходному индексу i): центр бокса cx/cy и верх её подписи labTop. Смещаем
     колонку так, чтобы её boxSpanMid лёг на axisY; внутри колонки карточки идут по relTop. */
  const cx = [], cy = [], labTop = [];
  columns.forEach((col, j) => {
    const offset = axisY - boxSpanMid[j];
    col.forEach((i, k) => {
      const cardTop = offset + relTop[j][k];
      cx[i] = colCenterX[j];
      cy[i] = cardTop + boxH(parts[i]) / 2;
      labTop[i] = cardTop + boxH(parts[i]) + TICK_GAP;
    });
  });

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
     позиция модуля), наименование с переносом (white-space:normal + overflow-wrap: длинное имя разбивается
     на строки внутри узкого бокса) и ОБЯЗАТЕЛЬНЫЙ артикул отдельной строкой моноширинным (нет кода → «—»,
     чтобы монтажник видел пропуск, а не пустоту). Текст выровнен по центру — подпись «сидит» под своей
     иконкой. */
  const labels = parts.map((p, i) => {
    const kicker = p.pos ? `${p.role || ""} ${p.pos}`.trim() : (p.role || "");
    return `<div style="position:absolute;left:${px(cx[i] - LABEL_W / 2)}%;top:${py(labTop[i])}%;width:${px(LABEL_W)}%;font-family:Arial,sans-serif;text-align:center;box-sizing:border-box">`
      + (kicker ? `<div style="font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:#8195a9">${esc(kicker)}</div>` : "")
      + `<div style="font-size:12px;color:#172b3f;font-weight:600;line-height:1.2;white-space:normal;overflow-wrap:break-word">${esc(p.name || "—")}</div>`
      + `<div style="font-size:11px;color:#33465a;font-family:'Courier New',monospace;margin-top:1px">Артикул: ${esc(p.code || "—")}</div>`
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
const api = { buildHtml };
if (typeof window !== "undefined") window.EPExplodedView = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
