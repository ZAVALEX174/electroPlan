/* В19 (решение владельца 03.10): в режиме «Разместить» двойной клик по иконке стоящего поста =
   «открыть ЭТОТ пост». Первый клик двойного по правилу В11 уже поставил НОВЫЙ пост поверх старого
   и вышел из размещения; второй клик + браузерный dblclick прилетают по НОВОМУ посту. Жест обязан
   сохранить прежний смысл: новый пост убрать, открыть СТАРЫЙ. Одинарный клик по иконке — по-прежнему
   новый пост (это сторожит placementAnyTool.test.js).

   Два уровня проверки:
   1) ЧИСТОЕ ПРАВИЛО EPPlaceDblClick.resolve — что считается «продолжением того двойного клика»
      (совпал id нового поста И мы в окне по времени), с мутационной таблицей у каждого случая.
   2) ПОВЕДЕНЧЕСКАЯ СВЯЗКА openPostOnDblClick (НАСТОЯЩИЙ текст из app.js через общий стенд): что по
      решению resolve app.js реально убирает новый пост, гасит вводящий в заблуждение тост и
      открывает нужный пост. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPPlaceDblClick = require("../js/placeDblClick.js");

/* ----------------------------- 1. Чистое правило resolve --------------------------------------- */

const PLACEMENT = { newId: "post_new", overId: "post_old", t: 800 };

test("resolve: dblclick по только что поставленному поверх старого — откатить новый, открыть старый", () => {
  /* now-t = 1000-800 = 200 мс, внутри окна 1000. МУТАЦИЯ: убрать ветку undo (всегда {undo:false}) →
     этот случай покраснеет (жест опять плодил бы дубль и открывал новый). */
  const d = EPPlaceDblClick.resolve(PLACEMENT, "post_new", 1000);
  assert.deepEqual(d, { undo: true, removeId: "post_new", openId: "post_old" });
});

test("resolve: нет запомненной постановки (двойной клик по пустому месту/обычный) — просто открыть этот пост", () => {
  /* placement=null — так выглядит двойной клик по ПУСТОМУ месту (addPending обнулил маркер) и
     двойной клик вне размещения. МУТАЦИЯ: игнорировать placement и всегда возвращать undo:true →
     покраснеет (стали бы удалять пост, которого никто не ставил). */
  const d = EPPlaceDblClick.resolve(null, "post_x", 1000);
  assert.deepEqual(d, { undo: false, openId: "post_x" });
});

test("resolve: dblclick по ДРУГОМУ посту (не по только что поставленному) — открыть именно его", () => {
  /* newId в маркере = post_new, а дважды кликнули post_old. МУТАЦИЯ: сравнивать не newId, а,
     например, overId, или снять проверку id — покраснеет (открыли/удалили бы чужой пост). */
  const d = EPPlaceDblClick.resolve(PLACEMENT, "post_old", 1000);
  assert.deepEqual(d, { undo: false, openId: "post_old" });
});

test("resolve: отдельный двойной клик по новому посту ПОЗЖЕ окна — открыть новый, не откатывать", () => {
  /* now-t = 2000-800 = 1200 > 1000. Это осознанное «открыть новый пост» много позже постановки.
     МУТАЦИЯ: убрать верхнюю границу окна (elapsed<win) → покраснеет (откатили бы пост, который
     человек хотел открыть). */
  const d = EPPlaceDblClick.resolve(PLACEMENT, "post_new", 2000);
  assert.deepEqual(d, { undo: false, openId: "post_new" });
});

test("resolve: граница окна точна — за 1 мс до конца откатываем, ровно на границе уже нет", () => {
  /* МУТАЦИЯ: заменить `<` на `<=` → второй assert покраснеет; убрать окно вовсе → оба слипнутся. */
  assert.equal(EPPlaceDblClick.resolve(PLACEMENT, "post_new", 800 + 999).undo, true, "999 мс — внутри окна");
  assert.equal(EPPlaceDblClick.resolve(PLACEMENT, "post_new", 800 + 1000).undo, false, "ровно 1000 мс — уже вне");
});

test("resolve: часы уехали назад (elapsed<0) — не откатываем", () => {
  /* now < t: отрицательная разница не доказывает, что это продолжение клика. МУТАЦИЯ: убрать
     `elapsed>=0` → покраснеет. */
  const d = EPPlaceDblClick.resolve(PLACEMENT, "post_new", 700);
  assert.equal(d.undo, false);
});

/* --------------------- 2. Поведенческая связка openPostOnDblClick (app.js) --------------------- */
/* Исполняем НАСТОЯЩИЙ текст openPostOnDblClick в vm: _lastIconPlacement — глобал контекста (как
   top-level let в app.js), EPPlaceDblClick — настоящий модуль, остальное — шпионы. */
function runDblClick(seedPlacement, postId, now) {
  const calls = { remove: [], persist: 0, open: [], drop: 0 };
  const toast = {
    textContent: "Объект добавлен в комнату «Кухня»",
    classList: { _removed: [], remove(c) { this._removed.push(c); } }
  };
  const ctx = {
    EPPlaceDblClick,
    _lastIconPlacement: seedPlacement,
    Date: { now: () => now },
    $: id => (id === "toast" ? toast : null),
    removeEntity: (kind, id) => calls.remove.push([kind, id]),
    persistProject: () => calls.persist++,
    openPostBuilder: o => calls.open.push(o),
    /* Б4: В19 снимает шаг «поставил» (dropHead) и глушит запись «убрал» замком применения */
    _applyingSnapshot: false,
    _history: { dropHead: () => { calls.drop++; } },
    syncHistoryUi() {}
  };
  const fn = stand.run("openPostOnDblClick", ctx);
  fn(postId);
  return { calls, ctx, toast };
}

test("openPostOnDblClick: продолжение двойного клика — убран новый пост, тост погашен, открыт СТАРЫЙ", () => {
  const { calls, ctx, toast } = runDblClick({ newId: "post_new", overId: "post_old", t: 800 }, "post_new", 1000);
  assert.deepEqual(calls.remove, [["post", "post_new"]], "новый пост убран целиком (как «Удалить»)");
  assert.equal(calls.persist, 1, "удаление сохранено (автосейв не остался с лишним постом)");
  /* openPostBuilder получает объект, созданный ВНУТРИ vm — сверяем поле, а не deepEqual (чужой realm). */
  assert.equal(calls.open.length, 1);
  assert.equal(calls.open[0].placedId, "post_old", "открыт конструктор СТАРОГО поста");
  assert.ok(toast.classList._removed.includes("show") && toast.textContent === "", "тост «Объект добавлен…» погашен");
  assert.equal(ctx._lastIconPlacement, null, "маркер постановки снят — повторно не сработает");
  assert.equal(calls.drop, 1, "Б4: шаг «поставил» снят из истории (dropHead) — двойного клика в истории нет");
});

test("openPostOnDblClick: обычный двойной клик (маркера нет) — ничего не удаляем, открываем этот пост", () => {
  const { calls, toast } = runDblClick(null, "post_z", 1000);
  assert.deepEqual(calls.remove, [], "без маркера пост не удаляется");
  assert.equal(calls.persist, 0, "и сохранение удаления не зовётся");
  assert.equal(calls.open.length, 1);
  assert.equal(calls.open[0].placedId, "post_z", "открыт именно тот пост, по которому кликнули");
  assert.equal(toast.textContent, "Объект добавлен в комнату «Кухня»", "чужой тост не трогаем");
});
