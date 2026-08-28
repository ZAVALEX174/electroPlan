/* Коммит незавершённого черновика ветки «комната» панели свойств.

   ЗАЧЕМ. Имя и площадь комнаты в панели свойств живут ТОЛЬКО в инпутах (#roomName/#roomArea):
   в объект комнаты они попадают через saveRoom — по кнопке «Сохранить», по blur и по Enter.
   Но панель целиком перерисовывается заменой props.innerHTML, и часть перерисовок асинхронна и
   приходит, ПОКА поле в фокусе. Удаление сфокусированного инпута через замену innerHTML родителя
   НЕ рождает события blur — значит saveRoom не позовётся, и набранное пропадёт МОЛЧА, без исключения.
   Поэтому черновик надо коммитить в начале renderProperties, ДО замены innerHTML.

   ЧТО ПОКРЫТО. Перерисовки, которые приходят в фокус, но НЕ пересоздают сам объект комнаты, —
   черновик доживает до коммита, т.к. state.rooms.find(mountedRoomId) находит ту же комнату:
   ответ курса ЦБ (refreshRate→applyProjectSettings→renderProperties) и автотрассировка стен
   (autoTracePlan — она правит state.autoWalls, комнаты не трогает).
   ЧЕГО НЕ ПОКРЫВАЕТ, И ПОКРЫТЬ ЗДЕСЬ НЕЛЬЗЯ. Авторасчёт комнат по линиям и распознавание
   (scheduleRoomsFromLines→buildRoomsFromLines, detectRooms, detectRoomsML) делают
   state.rooms=state.rooms.filter(r=>!r.autoPolygon) и создают комнаты заново — с новым uid("room_")
   и именем «Помещение N». К моменту renderProperties редактируемая авто-комната уже уничтожена,
   find(mountedRoomId) даёт undefined, коммита нет — черновик теряется молча. Флаш ПЕРЕД фильтром
   это не спасёт: объект комнаты всё равно заменяется новым, и имя по замыслу пересчёт не переживает
   (ручная правка контура — переживает, она снимает autoPolygon; черновик имени/площади — нет).

   ПОЧЕМУ ЧИСТАЯ ФУНКЦИЯ, А НЕ ВЫЗОВ У КАЖДОГО ПОТРЕБИТЕЛЯ. renderProperties зовётся из ~25 мест
   (drag-циклы в том числе). Правило «сначала закоммить черновик» вынесено в одну точку — начало
   renderProperties, — и оттуда покрывает все вызовы разом (§7.1: у правила не должно быть краёв).
   Само РЕШЕНИЕ «коммитить ли и что именно» — здесь, без DOM и без state: renderRooms/persistProject
   остаются в оркестраторе. Так правило проверяется автотестом (app.js тестами не покрыт).

   Интерфейс приложению — window.EPRoomDraft. */
(() => {
"use strict";

/* commit(fields, room) → { commit, name, area }

   fields — сырые значения инпутов: { name, area } (то, что набрал человек, без trim).
   room   — объект комнаты, которой принадлежат смонтированные поля, ЛИБО null/undefined, если
            комнаты уже нет в проекте (её удалили, а renderProperties позвали следом).

   Возврат:
     commit — писать ли name/area в комнату и тянуть ли renderRooms()+persistProject();
     name/area — нормализованные значения (то, что записал бы saveRoom). При commit:false
                 отдаются для справки, но применять их не нужно. */
function commit(fields, room) {
  /* Комнаты в проекте уже нет (removeEntity выкинул её из state.rooms и позвал
     renderProperties) — не воскрешаем и не падаем. */
  if (!room) return { commit: false, name: null, area: null };
  /* Нормализуем РОВНО как saveRoom: trim обоих полей и «Комната» вместо пустого имени.
     Площадь принимается любой строкой — валидации формата в проекте нет и вводить её не нужно. */
  const name = String(fields && fields.name != null ? fields.name : "").trim() || "Комната";
  const area = String(fields && fields.area != null ? fields.area : "").trim();
  /* Холостой ход: то, что записал бы saveRoom, уже лежит в комнате. Без этой проверки
     renderProperties тянул бы renderRooms()+persistProject() на КАЖДУЮ перерисовку (в том
     числе в drag-циклах) — это регресс производительности, а не сохранение черновика.
     Поля комнаты нормализуем ТЕМИ ЖЕ правилами, что и ввод: у комнаты из постороннего
     localStorage name/area могут отсутствовать (undefined), и голое сравнение "" !== undefined
     дало бы ложный commit → лишние renderRooms()+persistProject() без действий человека. */
  const curName = String(room.name != null ? room.name : "").trim() || "Комната";
  const curArea = String(room.area != null ? room.area : "").trim();
  if (name === curName && area === curArea) return { commit: false, name, area };
  return { commit: true, name, area };
}

/* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2),
   Node — module.exports для автотестов (PLAN 7.1). */
const api = { commit };
if (typeof window !== "undefined") window.EPRoomDraft = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
