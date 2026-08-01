"use strict";
/* Тесты чистой логики разведки классификации по vimar.ru (tools/lib/site-groups.mjs).
   Модуль — ESM (.mjs), подключаем динамическим import в before(); функции сети/файлов
   не трогают, поэтому тесты идут на строках-фикстурах и детерминированы. */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

let S;
before(async () => {
  S = await import(pathToFileURL(path.join(__dirname, "../tools/lib/site-groups.mjs")).href);
});

test("extractArticles: базовые коды и цветовые варианты из текста листинга", () => {
  const html = `<div class="item"><span>Артикул: 21668.01</span></div>
                <div class="item"><a href="/x/21668.17/">21668.17</a></div>
                <div class="item">14931 — Крышка IP55</div>`;
  const arts = S.extractArticles(html);
  assert.deepEqual(arts.sort(), ["14931", "21668.01", "21668.17"]);
});

test("extractArticles: V-префиксные коробки и хвост варианта .AU/.0.250", () => {
  const html = "<td>V71303</td><td>V71306.AU</td><td>09005.0.250</td>";
  assert.deepEqual(S.extractArticles(html).sort(), ["09005.0.250", "V71303", "V71306.AU"]);
});

test("extractArticles: мусор из <script>/href/картинок не попадает", () => {
  const html = `<script>var t={'SERVER_TZ_OFFSET':'10800','X':'28800'};</script>
                <img src="/upload/iblock/abc/99999.jpg">
                <a href="/catalog/12345/">12345.01</a>`;
  const arts = S.extractArticles(html);
  // из видимого текста — только настоящий артикул; 10800/28800/99999/12345 из тегов отсеяны
  assert.deepEqual(arts, ["12345.01"]);
});

test("extractArticles: 5-значная база не выкусывается из более длинного числа", () => {
  assert.deepEqual(S.extractArticles("<p>1234567</p>"), []);
  assert.deepEqual(S.extractArticles("<p>ABC12345</p>"), []); // 3 буквы перед — не префикс VIMAR
});

test("extractGroupSlugs: группы вычленяются, серии и PDF-каталоги отсеяны", () => {
  const html = `
    <a href="/catalog/production/eikon/">Eikon</a>
    <a href="/catalog/production/nakladki-eikon/">Накладки</a>
    <a href="/catalog/production/mekhanizmy-eikon/">Механизмы</a>
    <a href="/catalog/production/knx-eikon/">KNX</a>
    <a href="/catalog/production/katalogi-dlya-prosmotra/">PDF</a>
    <a href="/catalog/production/nakladki-eikon/14653.01/">карточка</a>`;
  const slugs = S.extractGroupSlugs(html);
  assert.deepEqual(slugs.sort(), ["knx-eikon", "mekhanizmy-eikon", "nakladki-eikon"]);
  assert.equal(slugs.includes("eikon"), false); // серия
  assert.equal(slugs.includes("katalogi-dlya-prosmotra"), false); // PDF
});

test("isPageExhausted / newArticles: стоп, когда новых кодов нет", () => {
  const acc = new Set(["14931", "14932"]);
  assert.deepEqual(S.newArticles(acc, ["14932", "14943"]), ["14943"]); // одна новинка
  assert.equal(S.isPageExhausted(acc, ["14932", "14943"]), false);
  assert.equal(S.isPageExhausted(acc, ["14931", "14932"]), true); // всё уже видели → конец
  assert.equal(S.isPageExhausted(acc, []), true); // пустая страница → конец
});

test("groupToKind: сопоставление группы сайта с нашим kind", () => {
  assert.equal(S.groupToKind("nakladki"), "frame");
  assert.equal(S.groupToKind("nakladki-eikon-exe"), "frame");
  assert.equal(S.groupToKind("mekhanizmy-flatvintage"), "mechanism");
  assert.equal(S.groupToKind("supporta-arke"), "support");
  assert.equal(S.groupToKind("montazhnye-korobki"), "socket_box");
  assert.equal(S.groupToKind("aksessuary-eikon"), "non-module");
  assert.equal(S.groupToKind("osvetitelnye-komponenty"), "non-module");
  assert.equal(S.groupToKind("komponenty-prochie"), "non-module");
  assert.equal(S.groupToKind("prochee"), "non-module");
  assert.equal(S.groupToKind("ustroystva-avtomatizatsii-eikon"), "non-module");
  assert.equal(S.groupToKind("by-me-eikon"), "non-module");
  assert.equal(S.groupToKind("knx-eikon"), "non-module");
  assert.equal(S.groupToKind("sistemy"), "non-module");
  assert.equal(S.groupToKind("what-is-this"), null); // неизвестная — в отчёт отдельно
});

test("baseCode: база артикула до первого хвоста", () => {
  assert.equal(S.baseCode("14931.01"), "14931");
  assert.equal(S.baseCode("V71306.AU"), "V71306");
  assert.equal(S.baseCode("09005.0.250"), "09005");
  assert.equal(S.baseCode("14901"), "14901");
});
