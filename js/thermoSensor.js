/* Термодатчик терморегулятора — АВТОСОСТАВ ПОСТА (К5а, решение владельца 21.10).
   ------------------------------------------------------------------------------------
   Терморегулятор «с возможностью подключения термодатчика» (02974/09474/30811 и их цветовые
   варианты — всего 9 артикулов) требует отдельный выносной датчик 02965.1. Датчик НЕ занимает
   модуля рамки (это провод с чувствительным элементом, а не механизм на суппорте), но входит в
   цену поста и обязан быть виден везде, где виден состав поста: окно поста, КП, Excel, свод
   поставщику. У терморегуляторов «по воздуху» и «Умный дом»/KNX датчика нет.

   ПРИЗНАК — ИЗ ДАННЫХ, НЕ ПО НАЗВАНИЮ. Какой датчик нужен терморегулятору, номенклатура говорит
   прямо в «Примечании» (`…термодатчика "02965.1"`); конвертер вынимает артикул в раздел sensors
   (tools/build-catalog-attrs.mjs), а js/data.js кладёт его на товар полем thermoSensorCode. Здесь
   мы это поле только ЧИТАЕМ — второго парсера названий не заводим (ОЗ-1 научил: поля каталога
   врут, признак берём из явных данных заказчика).

   ЕДИНОЕ ПРАВИЛО (§7.1): и план датчиков поста (plan), и запрет ставить датчик механизмом рамки
   (isSensorMechanism), и формулировка строки состава (rowSummary) живут ЗДЕСЬ, чтобы у правки не
   было краёв — все экраны и документы берут результат отсюда, а не решают каждый сам.

   ⚠️ ЗАДЕЛ ПОД К5б. Переключатель «с датчиком / без датчика» у поста — отдельная задача; здесь его
   НЕТ. Но plan уже отдаёт результат ОБЪЕКТОМ (items/gaps/count), а не числом, и потребители ключуются
   на этот объект (ключ сметы «|s:», postCost по items) — ровно как подсветка. Когда у поста появится
   своё «без датчика», достаточно будет вернуть из plan пустой набор для такого поста: ни один
   потребитель не придётся менять.

   Чистый модуль, как js/backlightPick.js: ни state, ни DOM, ни EP_DATA. Каталог и подбор товара-
   датчика приходят аргументами (deps). */
(function () {
  "use strict";

  /* Функциональная группа выносного датчика в номенклатуре — по ней отличаем САМ датчик от
     механизмов рамки (его нельзя выбрать в слот окна поста: это не механизм, его добавляет расчёт).
     Признак из данных (functionalGroup), а не по артикулу: группа «Термодатчик» заполнена номенклатурой
     ровно у датчиков. */
  var SENSOR_GROUP = "Термодатчик";

  /* Товар САМ является выносным термодатчиком? — тогда в слот окна поста его не предлагаем. Признак
     по данным: функциональная группа «Термодатчик». Запасной признак — ссылка на него как на датчик у
     какого-либо терморегулятора — проверяют потребители, передав множество кодов датчиков (sensorCodes);
     без него хватает группы. */
  function isSensorMechanism(item, sensorCodes) {
    if (!item) return false;
    if (item.functionalGroup === SENSOR_GROUP) return true;
    // Фолбэк: код товара назван датчиком у какого-то терморегулятора (на случай, если группа не
    // проставлена, но ссылка в данных есть). sensorCodes — Set/массив кодов датчиков (необязателен).
    if (sensorCodes && item.code) {
      if (typeof sensorCodes.has === "function") return sensorCodes.has(String(item.code));
      if (Array.isArray(sensorCodes)) return sensorCodes.indexOf(String(item.code)) !== -1;
    }
    return false;
  }

  /* Артикул термодатчика, который ТРЕБУЕТ данный механизм-терморегулятор, либо null. Признак приходит
     из данных полем thermoSensorCode (js/data.js из раздела sensors). Нет поля → датчик не нужен. */
  function sensorCodeFor(mech) {
    var code = mech && mech.thermoSensorCode;
    return (typeof code === "string" && code) ? code : null;
  }

  /* План термодатчиков поста: по одному датчику на КАЖДЫЙ терморегулятор поста, которому он нужен
     (два одинаковых 02974 = два датчика — поэтому идём по mechIds, а не по множеству).
       deps.product(id)     — товар каталога по id механизма поста;
       deps.findSensor(code) — подбор товара-датчика по артикулу (активные главнее снятых, как
                               findBacklight; EPCatalogPool.pick в приложении).
     items — подобранные датчики [{mechId, mech, sensor, code}]; идут в цену (postCost) и в состав.
     gaps  — датчик нужен, но его артикула нет в каталоге [{mechId, mech, wantCode}]: честный пробел,
             в цену НЕ входит и чужой артикул не подставляется (как backlightPlan.gaps, posts.js).
     count — сколько датчиков реально идёт в состав и в цену. */
  function plan(mechIds, deps) {
    var d = deps || {};
    var product = d.product || function () { return null; };
    var find = d.findSensor || function () { return null; };
    var items = [], gaps = [];
    (mechIds || []).forEach(function (id) {
      var mech = product(id);
      var want = sensorCodeFor(mech);
      if (!want) return;                         // механизм датчика не требует — пропускаем
      var sensor = find(want) || null;
      if (sensor) items.push({ mechId: id, mech: mech, sensor: sensor, code: want });
      else gaps.push({ mechId: id, mech: mech, wantCode: want });   // нужен, а в каталоге нет — пробел
    });
    return {
      items: items, gaps: gaps,
      count: items.length,        // столько датчиков идёт в состав и в цену
      hasGap: gaps.length > 0     // есть терморегулятор, которому датчик не подобрали (пробел состава)
    };
  }

  /* Формулировка строки «Термодатчик» для экранов (окно поста, карточка, подсказка) — ОДНА на все
     (§7.1), как backlightRowSummary. money передаём зависимостью: модуль чистый, валюту показа знает
     приложение. Одинаковые датчики сводим количеством («2 × …»), цена — за штуку (как суппорт/коробка/
     подсветка в том же составе). Пробел называем СЛОВАМИ («термодатчик не подобран») и в цену он не
     входит. Нет ни датчиков, ни пробелов (или нет поля sensors) → null: строки нет, экран как раньше. */
  function rowSummary(sensorPlan, deps) {
    var money = (deps && deps.money) || function (v) { return String(v); };
    if (!sensorPlan || (!sensorPlan.items.length && !sensorPlan.gaps.length)) return null;
    var agg = new Map();
    sensorPlan.items.forEach(function (u) {
      var s = u.sensor, k = s.code || s.name;
      var cur = agg.get(k) || { name: s.name, code: s.code, price: Number(s.price) || 0, count: 0 };
      cur.count++; agg.set(k, cur);
    });
    var parts = [];
    agg.forEach(function (g) { parts.push((g.count > 1 ? g.count + " × " : "") + g.name + " · " + money(g.price)); });
    var gaps = sensorPlan.gaps.length;
    if (gaps) parts.push(gaps > 1 ? gaps + " × термодатчик не подобран" : "термодатчик не подобран");
    return { parts: parts, text: parts.join(", "), gaps: gaps, count: sensorPlan.items.length };
  }

  /* Двойной экспорт: браузеру — namespace (сборщика нет, PLAN 2.2), Node — module.exports
     для автотестов (PLAN 7.1). */
  var api = { plan: plan, rowSummary: rowSummary, isSensorMechanism: isSensorMechanism, sensorCodeFor: sensorCodeFor, SENSOR_GROUP: SENSOR_GROUP };
  if (typeof window !== "undefined") window.EPThermoSensor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
