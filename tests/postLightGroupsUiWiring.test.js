/* ПОВЕДЕНЧЕСКИЙ регресс: видимость групп света в РЕДАКТОРЕ (часть 1c «ПЛАН-В-ДОКУМЕНТЕ»).

   ЗАЧЕМ. Механика групп света считает деньги (проходные/перекрёстные механизмы), но задать
   группу можно было только в конструкторе у слота клавиши, а из панели поста и из сводки не было
   даже НАМЁКА, что группы существуют — узнавали о пробеле только из готового КП. Здесь два новых
   узла интерфейса: перечень групп в свойствах РАЗМЕЩЁННОГО поста (postGroupsPropHtml) и счётчик
   постов с клавишами без группы в сводке (postsWithMissingGroupsText, пишется renderSummary).

   КАК. app.js — монолит-оркестратор (DOM, state), в node не грузится. Вырезаем ИСХОДНЫЙ ТЕКСТ
   функций из app.js и исполняем в vm на общем стенде (appStand). ⚠️ Предикат клавиши берётся
   НАСТОЯЩИЙ: keySlotKind + isKeyProduct режутся из app.js вместе с проверяемыми функциями, а
   разбор поста (EPBuilderSlots.fromPost) и нормализация имени (EPLightingGroups.normalizeGroup) —
   настоящие модули. Второй копии правила «что такое клавиша» тест не заводит (§7.1) — подмена
   предиката в app.js покраснеет здесь.

   МУТАЦИЯ → КРАСНЫЙ ТЕСТ (проверено, см. отчёт):
     - postGroupsPropHtml возвращает "" / без строк клавиш            → «перечень групп в свойствах»;
     - в постройке строки убрать ветвление name? (всегда «задана»)    → «клавиша без группы ≠ заданная»;
     - keySlotKind: розетка стала клавишей (isKeyProduct → true)      → и перечень, и счётчик считают лишнее;
     - в счётчике убрать `!` (считает посты, где группа ЕСТЬ)         → «счётчик не считает пустые группы»;
     - renderSummary не пишет в #missingGroupsStatus / сменили id     → «сводка показывает счётчик».
   Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const stand = require("./helpers/appStand.js");

const EPBuilderSlots = require("../js/builderSlots.js");
const EPLightingGroups = require("../js/lightingGroups.js");
const EPRoomAssign = require("../js/roomAssign.js");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

/* Каталог-шим: 100/101 — клавиши (partRole "key"), 200 — не клавиша (розетка), всё прочее —
   пропавший из прайса артикул (product → null). Ровно те ветви трёхзначного keySlotKind. */
const KEY_A = 100, KEY_B = 101, SOCKET = 200, MISSING = 999;
const product = id => {
  if (id === KEY_A || id === KEY_B) return { partRole: "key" };
  if (id === SOCKET) return { partRole: "socket" };
  return null;
};
const postOf = (mechanismIds, keyGroups) => ({ mechanismIds, keyGroups });

/* ---- 1. postGroupsPropHtml: перечень групп в панели свойств поста -------------------------- */

function groupsHtml(post) {
  return stand.runNamed(["isKeyProduct", "keySlotKind", "postGroupsPropHtml"], {
    product,
    EPBuilderSlots,
    EPLightingGroups,
    esc: s => String(s)
  })(post);
}

test("свойства поста: у клавиши с группой печатается имя, у клавиши без группы — «не задана», розетка не в списке", () => {
  const html = groupsHtml(postOf([KEY_A, SOCKET, KEY_B], ["Кухня", "", ""]));
  assert.match(html, /Кухня/, "заданная группа клавиши обязана быть названа");
  assert.match(html, /группа не задана/, "клавиша без группы показывается как незаданная");
  /* Ровно две строки клавиш: розетка (200) в перечень групп не попадает. Подмена предиката
     (розетка → клавиша) сделает три — тест покраснеет. */
  assert.equal((html.match(/Клавиша \d+/g) || []).length, 2,
    "клавиши считаются настоящим предикатом keySlotKind — не-клавиша в перечень не попадает");
  assert.equal(html.match(/has-group/g).length, 1, "ровно одна клавиша с заданной группой");
  assert.equal(html.match(/no-group/g).length, 1, "ровно одна клавиша без группы");
});

test("свойства поста: пробельная группа считается незаданной (нормализация именем модуля)", () => {
  const html = groupsHtml(postOf([KEY_A], ["   "]));
  assert.match(html, /группа не задана/, "«   » после normalizeGroup — пусто, а не имя группы");
});

test("свойства поста без клавиш: сказано, что задавать группы негде", () => {
  const html = groupsHtml(postOf([SOCKET, SOCKET], ["", ""]));
  assert.match(html, /нет клавиш/, "пост без клавиш обязан прямо сообщить, что группы задавать негде");
  assert.doesNotMatch(html, /Клавиша \d+/, "строк клавиш быть не должно");
});

test("свойства поста: имя группы экранируется через esc", () => {
  /* esc-шим здесь String (не экранирует) — проверяем, что имя проходит ИМЕННО через esc(): при
     удалении esc из разметки текст не изменится, но с настоящим esc в проде тег бы обезвредился.
     Стережём сам факт вызова esc косвенно — через то, что имя вставлено как <b>имя</b>. */
  const html = groupsHtml(postOf([KEY_A], ["Спальня"]));
  assert.match(html, /<b>Спальня<\/b>/, "имя заданной группы печатается выделенным");
});

/* ---- 2. postsWithMissingGroupsText: счётчик проблемных постов в сводке --------------------- */

function counterText(posts) {
  return stand.runNamed(["isKeyProduct", "keySlotKind", "postsWithMissingGroupsText"], {
    product,
    EPBuilderSlots,
    EPLightingGroups,
    state: { posts }
  })();
}

test("счётчик: считает посты с клавишей БЕЗ группы, игнорирует посты, где все клавиши с группой и посты без клавиш", () => {
  const posts = [
    postOf([KEY_A, SOCKET], ["Кухня", ""]),        // все клавиши с группой → не в счёт
    postOf([KEY_A], [""]),                          // клавиша без группы → в счёт
    postOf([SOCKET, SOCKET], ["", ""]),             // клавиш нет → задавать негде, не в счёт
    postOf([KEY_A, KEY_B], ["Зал", ""])             // одна клавиша без группы → в счёт
  ];
  const text = counterText(posts);
  assert.match(text, /без группы света: 2/, "счётчик обязан насчитать ровно два проблемных поста");
});

test("счётчик: все клавиши с группой → строка пустая (нечего показывать)", () => {
  const text = counterText([postOf([KEY_A, KEY_B], ["Кухня", "Зал"]), postOf([SOCKET], [""])]);
  assert.equal(text, "", "проблемных постов нет — строку в сводке не показываем");
});

test("счётчик: розетка без группы НЕ проблема (предикат клавиши настоящий)", () => {
  /* Пост из одной розетки без группы. Клавиш нет — считать нечего. Подмена keySlotKind (розетка
     стала клавишей) сделает строку непустой — тест покраснеет. */
  assert.equal(counterText([postOf([SOCKET], [""])]), "");
});

/* ---- 3. renderSummary пишет счётчик в #missingGroupsStatus --------------------------------- */

function renderSummaryOn(dom, posts) {
  return stand.runNamed(
    ["isKeyProduct", "keySlotKind", "orphanObjectsWarningText", "postsWithMissingGroupsText", "renderSummary"],
    {
      state: { rooms: [], devices: [], posts },
      product,
      EPBuilderSlots,
      EPLightingGroups,
      EPRoomAssign,
      EPEstimate: require("../js/estimate.js"),
      $: dom.$,
      money: v => "money(" + v + ")",
      esc: s => String(s),
      projectLighting: () => ({}),
      buildEstimate: () => ({
        equipment: 0, materials: 0, work: 0, total: 0,
        discount: 0, discountPercent: 0, vat: 0, vatPercent: 0, groups: []
      }),
      lightingHtml: () => "[LIGHTING_HTML]",
      updateStatus: () => {}
    }
  );
}

test("renderSummary: пост с клавишей без группы → #missingGroupsStatus виден со счётчиком", () => {
  const dom = stand.makeDom();
  const render = renderSummaryOn(dom, [postOf([KEY_A], [""])]);
  render();
  assert.match(dom.els.missingGroupsStatus.textContent, /без группы света: 1/,
    "счётчик проблемных постов обязан лечь именно в #missingGroupsStatus");
  assert.equal(dom.els.missingGroupsStatus.hidden, false, "непустой счётчик должен быть виден");
});

test("renderSummary: проблемных постов нет → #missingGroupsStatus очищен и скрыт", () => {
  const dom = stand.makeDom();
  const render = renderSummaryOn(dom, [postOf([KEY_A], ["Кухня"])]);
  render();
  assert.equal(dom.els.missingGroupsStatus.textContent, "");
  assert.equal(dom.els.missingGroupsStatus.hidden, true, "пустой счётчик не должен оставлять полосу");
});

/* ---- 4. проводка разметки и вызова -------------------------------------------------------- */

test("index.html: единственный #missingGroupsStatus стоит в сводке после #lightingSummary", () => {
  assert.equal((INDEX.match(/id="missingGroupsStatus"/g) || []).length, 1,
    "узел счётчика должен быть ровно один — дублировать состояние нельзя");
  const lightingAt = INDEX.indexOf('id="lightingSummary"');
  const statusAt = INDEX.indexOf('id="missingGroupsStatus"');
  const rightPanelAt = INDEX.indexOf('class="sidebar right-panel"');
  assert.ok(rightPanelAt >= 0 && rightPanelAt < lightingAt && lightingAt < statusAt,
    "#missingGroupsStatus должен жить в сводке (.right-panel) сразу за #lightingSummary");
});

test("renderProperties: ветка поста встраивает postGroupsPropHtml(p)", () => {
  const src = stand.functionSource("renderProperties");
  const postBranch = src.slice(src.indexOf('kind==="post"'));
  assert.match(postBranch, /\$\{postGroupsPropHtml\(p\)\}/,
    "перечень групп света обязан быть встроен в разметку панели свойств поста");
});
