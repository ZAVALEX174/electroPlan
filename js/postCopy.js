/* Копирование постов (Б9, часть 1). Владелец: «вставить те же посты в соседний номер — отели».
   Ctrl+C на выделенных постах, Ctrl+V над соседней комнатой — там появляются такие же посты, в
   том же взаимном расположении; каждый считается по комнате, куда попал; смета растёт на их
   стоимость; Ctrl+Z убирает вставленное одним шагом.

   ЧИСТЫЙ МОДУЛЬ, как selection.js/history.js: ни DOM, ни state, ни EP_DATA, ни каталога — все
   зависимости приходят аргументами. Оркестратор (app.js) держит буфер, ловит хоткеи, кладёт
   готовые посты в state и пересчитывает привязку к комнатам; ПРАВИЛА «что считать копией»,
   «какие новые номера постов/проходных» и «куда встать» живут здесь в одном месте, чтобы у правки
   не было краёв (§7.1 HANDOFF).

   Три функции — три вещи, каждая правилом в одном экземпляре:
     snapshot(posts)                  — независимый снимок выделенного для буфера;
     buildCopies(buffer, opts)        — новые посты для вставки (новые id/номера/координаты);
     newCrossNumbers(copies, …)       — новые номера проходных для скопированного набора.
   buildCopies зовёт newCrossNumbers сам — второй копии правила проходных нет.

   Что НЕ здесь (часть 2, проводка в app.js): смена накладки копии на отделку комнаты, случай
   «нет подходящей накладки — остальные вставить, про невставленный сказать», разбор клавиш.

   Интерфейс приложению — window.EPPostCopy. */
(() => {
"use strict";

/* Центр значка поста = (x+12, y+12): иконка 24px, её якорь в (x,y). Та же половина, по которой
   пост привязывается к комнате (getRoomForPoint(x+12,y+12)) и по которой считает рамку выделения
   selection.js. Взаимное расположение копий держим по ЦЕНТРАМ значков, а не по углам. */
const POST_ICON_HALF = 12;

/* Служебные поля поста — их задаёт ВСТАВКА, а не копируются из исходника: id и number обязаны быть
   новыми (иначе два поста с одним номером в документах), x/y вставка кладёт по мировой точке или со
   сдвигом, roomId производный — приложение пересчитывает его из координат (recalculateRoomAssignments).
   Всё ОСТАЛЬНОЕ копируется как есть: имя, накладка, механизмы, группы света, ручной выбор механизма,
   личная скидка, свой тип стены, своя подсветка, ограничение цвета начинки — и любое поле, которое
   появится у поста завтра (клонируем пост целиком и снимаем только этот список; «забытое поле теряется
   молча» уже было граблей проекта). */
const SERVING_FIELDS = ["id", "number", "x", "y", "roomId"];

/* Глубокая копия чистых данных поста (числа/строки/массивы/простые объекты) — тем же JSON-кругом,
   что хранилище проекта и history.js. Гарантирует, что НИ ОДИН вложенный массив/объект (mechanismIds,
   keyGroups, backlight…) не остаётся общим с исходником — иначе правка копии меняла бы оригинал. */
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* Собрать КЛЮЧИ проходных, уже занятые в наборе постов. crossKey — правило сравнения номеров из
   расчёта (EPLightingGroups.crossGroupKey): по нему «5», « 5 » — один номер, «05» — другой. Пустые
   ключи («» — номер не задан) не занимают ничего. Нужен, чтобы новый номер был свободен ИМЕННО по
   тому правилу, по которому расчёт считает номера одинаковыми, — второй нормализации не заводим. */
function collectCrossKeys(posts, crossKey) {
  const keys = new Set();
  (Array.isArray(posts) ? posts : []).forEach(p => {
    const crosses = Array.isArray(p && p.keyCrossNumbers) ? p.keyCrossNumbers : [];
    crosses.forEach(v => { const k = crossKey(v); if (k) keys.add(k); });
  });
  return keys;
}

/* НОВЫЕ НОМЕРА ПРОХОДНЫХ для копируемого набора (решение владельца 10.10): копии получают СВОИ новые
   номера — пары внутри скопированного остаются парами между собой, с исходными не связываются. Каждому
   РАЗЛИЧНОМУ непустому номеру набора (по ключу crossKey) — один новый номер, свободный в проекте И среди
   уже выданных в этой вставке; все клавиши копий с одним исходным номером получают один и тот же новый.
   Пустые остаются пустыми.
   Исходные посты проекта (existingPosts) тоже занимают ключи — поэтому новый номер не совпадёт с номером
   оригинала, и скопированный одиночный пост из пары честно покажет «пары нет», а не оживит инвертор.
   Новый номер — короткое число, понятное человеку: 1, 2, 3…, пропуская занятые. Возврат — Map
   «старый ключ → новый номер-строка». */
function newCrossNumbers(copies, existingPosts, crossKey) {
  const used = collectCrossKeys(existingPosts, crossKey);
  const map = new Map();
  (Array.isArray(copies) ? copies : []).forEach(p => {
    const crosses = Array.isArray(p && p.keyCrossNumbers) ? p.keyCrossNumbers : [];
    crosses.forEach(raw => {
      const key = crossKey(raw);
      if (!key || map.has(key)) return;             /* пусто или номер уже встречался — пропускаем */
      let n = 1;
      while (used.has(crossKey(String(n)))) n++;    /* ищем свободный короткий номер */
      const value = String(n);
      used.add(crossKey(value));                    /* занимаем — следующий различный номер его не возьмёт */
      map.set(key, value);
    });
  });
  return map;
}

/* СНИМОК выделенных постов для буфера. На вход — массив объектов постов (уже разрешённых по выделению);
   на выход — буфер { items:[{post, dx, dy}], center }, где post — НЕЗАВИСИМАЯ глубокая копия (ни один
   массив/объект не общий ни с исходником, ни между собой), а dx/dy — смещение ЦЕНТРА значка поста от
   центра группы. По этим смещениям buildCopies восстанавливает взаимное расположение вокруг точки
   вставки. Центр группы — середина габаритного прямоугольника центров значков (устойчив к порядку
   постов и не зависит от того, где они на плане). Пустой вход → пустой снимок. */
function snapshot(posts) {
  const list = Array.isArray(posts) ? posts : [];
  const raw = list.map(p => ({ post: deepClone(p), cx: Number(p.x) + POST_ICON_HALF, cy: Number(p.y) + POST_ICON_HALF }));
  const center = { x: 0, y: 0 };
  if (raw.length) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    raw.forEach(it => {
      if (it.cx < minx) minx = it.cx; if (it.cx > maxx) maxx = it.cx;
      if (it.cy < miny) miny = it.cy; if (it.cy > maxy) maxy = it.cy;
    });
    center.x = (minx + maxx) / 2;
    center.y = (miny + maxy) / 2;
  }
  return {
    center,
    items: raw.map(it => ({ post: it.post, dx: it.cx - center.x, dy: it.cy - center.y }))
  };
}

/* СБОРКА КОПИЙ для вставки. buffer — снимок из snapshot(); opts:
     existingPosts  — посты проекта сейчас (для стартового номера и занятых номеров проходных);
     point          — {x,y} МИРОВАЯ точка вставки (куда встаёт центр группы) или null/нет (сдвиг от исходных);
     genId          — () => новый id поста (генератор приложения);
     nextPostNumber — EPPosts.nextPostNumber: fn(posts)=>номер (правило нумерации не дублируем здесь);
     crossKey       — EPLightingGroups.crossGroupKey: правило сравнения номеров проходных;
     step           — {x,y} шаг сдвига при вставке без точки (по умолчанию 24×24, ширина значка).
   Возвращает массив НОВЫХ объектов постов: все поля исходника, кроме служебных (SERVING_FIELDS), плюс
   новый id, последовательный номер от nextPostNumber (без дублей в пакете и с существующими), координаты
   и перенумерованные проходные. roomId НЕ ставим — его пересчитает приложение из координат.
   Координаты: задана точка — центр группы встаёт в неё (взаимное расположение сохраняется через dx/dy);
   точки нет — сдвиг от исходных, причём при повторной вставке сдвиг нарастает, пока копии точно
   накрывают уже существующие посты (иначе второй Ctrl+V лёг бы поверх первого). */
function buildCopies(buffer, opts) {
  opts = opts || {};
  /* ОБЯЗАТЕЛЬНЫЕ зависимости — забыли, ПАДАЕМ ГРОМКО, а не продолжаем молча: без crossKey копии молча
     сохранили бы старые номера проходных (слиплись бы с оригиналом, оживив чужой инвертор), без
     genId/nextPostNumber получили бы undefined-id/номер и дубль в документах. «Забытое поле теряется
     молча» уже было граблей проекта (§7.1) — ловим на входе, у самого правила, а не ниже по стеку. */
  if (typeof opts.genId !== "function") throw new Error("buildCopies: нужен genId (генератор id поста)");
  if (typeof opts.nextPostNumber !== "function") throw new Error("buildCopies: нужен nextPostNumber (правило нумерации)");
  if (typeof opts.crossKey !== "function") throw new Error("buildCopies: нужен crossKey (правило сравнения номеров проходных)");
  const items = (buffer && Array.isArray(buffer.items)) ? buffer.items : [];
  const existing = Array.isArray(opts.existingPosts) ? opts.existingPosts : [];
  const genId = opts.genId;
  const crossKey = opts.crossKey;
  const step = opts.step || { x: 24, y: 24 };
  const point = opts.point && Number.isFinite(opts.point.x) && Number.isFinite(opts.point.y) ? opts.point : null;

  /* Клонируем ЕЩЁ раз от снимка: buildCopies могут звать дважды (повторная вставка) — два пакета не
     должны делить объекты, а сам буфер остаться неизменным. */
  const copies = items.map(it => deepClone(it.post));

  /* Новые номера проходных — одним правилом (newCrossNumbers), по всему пакету сразу. */
  const crossMap = newCrossNumbers(copies, existing, crossKey);

  /* Стартовый номер поста — из EPPosts.nextPostNumber (max+1), дальше последовательно: без дублей в
     пакете и без столкновения с существующими. Правило «следующий номер» не копируем — берём как есть. */
  const startNumber = opts.nextPostNumber(existing);

  /* Номера копий раздаём В ПОРЯДКЕ НОМЕРОВ ИСХОДНЫХ постов, а не порядка выделения: по номеру поста
     расчёт решает, какому месту управления достаётся инвертор (канонический порядок проходных,
     EPLightingGroups.canonicalOrder). Исходные №3 и №5 дают копии в том же отношении (меньший номер →
     меньший, больший → больший) при ЛЮБОМ порядке, в котором их выделили и сложили в буфер. Ранжируем
     индексы по исходному number (при равных — стабильно по индексу) и раздаём startNumber+ранг; позиции
     и все прочие поля копии остаются на своих местах — ранжируем ТОЛЬКО номер. */
  const order = items.map((_, i) => i).sort((a, b) => {
    const na = Number(items[a].post.number), nb = Number(items[b].post.number);
    return na !== nb ? na - nb : a - b;
  });
  const numberByIndex = [];
  order.forEach((idx, rank) => { numberByIndex[idx] = startNumber + rank; });

  /* Координаты всех копий сразу. ОДНА защита «точно поверх» на ОБЕ ветки (по точке и сдвигом): после
     базовой раскладки сдвигаем ВЕСЬ пакет на шаг, пока хоть одна копия в точности накрывает
     существующий пост. Без неё два Ctrl+V при неподвижной мыши (та же точка) или подряд без точки
     клали бы вторую пачку ровно на первую — на плане один значок, в смете два поста (скрытый дубль,
     деньги). База: по точке — центр группы в точку (взаимное расположение через dx/dy); без точки —
     исходные координаты. Старт сдвига: по точке — 0 (сперва ровно в точку), без точки — 1 (сразу на
     шаг от оригинала, как было). */
  const occupied = new Set(existing.map(p => Number(p.x) + "," + Number(p.y)));
  const base = point
    ? items.map(it => ({ x: point.x + it.dx - POST_ICON_HALF, y: point.y + it.dy - POST_ICON_HALF }))
    : items.map(it => ({ x: Number(it.post.x), y: Number(it.post.y) }));
  const shifted = m => base.map(p => ({ x: p.x + step.x * m, y: p.y + step.y * m }));
  let m = point ? 0 : 1;
  let positions = shifted(m);
  while (positions.some(pos => occupied.has(pos.x + "," + pos.y)) && m < 1000) { m++; positions = shifted(m); }

  return copies.map((copy, i) => {
    SERVING_FIELDS.forEach(f => delete copy[f]);
    copy.id = genId();
    copy.number = numberByIndex[i];
    copy.x = positions[i].x;
    copy.y = positions[i].y;
    /* Проходные: клавиши с заданным номером получают новый (один на каждый исходный); пустые — пустыми.
       Длину keyCrossNumbers сохраняем (контракт EPBuilderSlots.toPost: равна длине mechanismIds). Нет
       массива вовсе (только что поставленный из шаблона пост) — не выдумываем его. */
    if (Array.isArray(copy.keyCrossNumbers)) {
      copy.keyCrossNumbers = copy.keyCrossNumbers.map(v => {
        const key = crossKey(v);
        return key && crossMap.has(key) ? crossMap.get(key) : v;
      });
    }
    return copy;
  });
}

/* РЕШЕНИЕ «ПЕРЕХВАТЫВАТЬ ЛИ Ctrl+C / Ctrl+V» — чистой функцией под тестом, как EPHistory.hotkeyAction
   (тело document.onkeydown стенд не режет). ev — event-подобный {code, ctrlKey, metaKey}; ctx —
   состояние, которое чистая функция сама знать не может, оркестратор его собирает:
     modalOpen        — открыто любое модальное окно (под ними хоткеи холста молчат, как у undo/redo);
     inTextField      — цель в текстовом поле (EPHistory.isTextTarget) — там Ctrl+C/V родные;
     hasTextSelection — человек выделил текст на странице — НЕ крадём родное копирование текста;
     hasSelection     — есть выделенные посты (иначе копировать нечего);
     hasBuffer        — буфер непуст (иначе вставлять нечего).
   Возврат "copy" | "paste" | null. null = НЕ перехватываем, отдаём браузеру родное поведение.
   Пустой буфер (Ctrl+V) и отсутствие выделения (Ctrl+C) намеренно дают null: клавиша не «проглочена»,
   родное поведение страницы работает. */
function copyHotkey(ev, ctx) {
  ev = ev || {};
  ctx = ctx || {};
  if (ctx.modalOpen) return null;
  if (!(ev.ctrlKey || ev.metaKey)) return null;
  if (ev.code !== "KeyC" && ev.code !== "KeyV") return null;
  if (ctx.inTextField) return null;            /* в поле — родная отмена/копирование/вставка */
  if (ev.code === "KeyC") {
    if (ctx.hasTextSelection) return null;     /* выделен текст — не крадём родное копирование текста */
    return ctx.hasSelection ? "copy" : null;   /* нет выделенных постов — копировать нечего */
  }
  return ctx.hasBuffer ? "paste" : null;       /* пустой буфер — родная вставка */
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports для автотестов. */
const api = { snapshot, buildCopies, newCrossNumbers, copyHotkey, POST_ICON_HALF };
if (typeof window !== "undefined") window.EPPostCopy = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
