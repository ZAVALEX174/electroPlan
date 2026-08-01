/*
 * Разведка независимой классификации VIMAR по сайту vimar.ru.
 *
 * Зачем: наш вид товара (kind) берётся из «Функциональной группы» номенклатуры
 * заказчика, и там есть спорные места (IP55-крышки среди накладок, голые
 * механизмы и аксессуары среди механизмов). Сайт производителя раскладывает тот
 * же ассортимент по СВОИМ группам — это независимое мнение для сверки. Ничего в
 * рантайм-каталоге (js/) не меняется: это только материал для решения владельца.
 *
 * Что делает:
 *   1. Обнаруживает товарные группы по страницам серий (nakladki-*, mekhanizmy-*,
 *      supporta-*, by-me-*, knx-*, ustroystva-avtomatizatsii-* …), объединяя с
 *      заранее известным списком (tools/lib/site-groups.mjs).
 *   2. Обходит каждую группу, листая PAGEN_1 до конца (пока страница приносит
 *      новые артикулы), собирает множество артикулов на группу.
 *   3. Пишет tools/data/site-groups.json (группа → артикулы + мета).
 *   4. Сверяет с нашим каталогом js/catalog-vimar.js: отчёт в консоль и в
 *      tools/data/site-groups-report.md.
 *
 * Сеть — строго последовательно, с паузой и повтором. Ответы кэшируются в
 * .tmp-site/ (маска .tmp-* в .gitignore) → повторный прогон почти без запросов
 * и воспроизводим.
 *
 * Флаги:
 *   --offline        не ходить в сеть; взять готовый site-groups.json и только
 *                    пересобрать отчёт (для правки формата без повторного съёма)
 *   --refresh        игнорировать кэш .tmp-site/ и перекачать страницы
 *   --pause <мс>     пауза между запросами (по умолчанию 700)
 *   --max-pages <N>  предохранитель на число страниц группы (по умолчанию 30)
 *   --catalog <путь> js/catalog-vimar.js
 *   --out <путь>     site-groups.json
 *   --report <путь>  site-groups-report.md
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  SERIES_PAGES, KNOWN_GROUPS, extractArticles, extractGroupSlugs,
  isPageExhausted, newArticles, groupToKind, baseCode, KIND_LABELS,
} from "./lib/site-groups.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const repoRoot = path.resolve(projectRoot, "..");

const { values: args } = parseArgs({
  options: {
    offline: { type: "boolean", default: false },
    refresh: { type: "boolean", default: false },
    pause: { type: "string" },
    "max-pages": { type: "string" },
    catalog: { type: "string" },
    out: { type: "string" },
    report: { type: "string" },
  },
});
const resolveArg = (v, f) => (v ? path.resolve(v) : f);
const CATALOG = resolveArg(args.catalog, path.join(projectRoot, "js/catalog-vimar.js"));
const OUT = resolveArg(args.out, path.join(here, "data/site-groups.json"));
const REPORT = resolveArg(args.report, path.join(here, "data/site-groups-report.md"));
const CACHE_DIR = path.join(projectRoot, ".tmp-site");
const PAUSE = Number(args.pause ?? 700);
const MAX_PAGES = Number(args["max-pages"] ?? 30);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const BASE = "https://vimar.ru/catalog/production/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Ключ кэша из URL — безопасное имя файла. */
const cacheKey = (url) => url.replace(/^https?:\/\//, "").replace(/[^a-z0-9._-]+/gi, "_") + ".html";

/* Загрузка страницы с кэшем на диске, паузой и повтором. Возвращает HTML.
   404/410 (страницы за последней) не роняют обход — возвращаем "" (пусто →
   isPageExhausted остановит группу). */
async function fetchPage(url) {
  const cacheFile = path.join(CACHE_DIR, cacheKey(url));
  if (!args.refresh) {
    try { return await fs.readFile(cacheFile, "utf8"); } catch { /* нет в кэше — качаем */ }
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru" } });
      if (res.status === 404 || res.status === 410) return "";
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cacheFile, html, "utf8");
      await sleep(PAUSE);
      return html;
    } catch (err) {
      lastErr = err;
      await sleep(PAUSE * attempt * 2); // нарастающая пауза перед повтором
    }
  }
  throw new Error(`Не удалось загрузить ${url}: ${lastErr && lastErr.message}`);
}

/* Обнаружение всех товарных групп по страницам серий (объединяем с известным списком). */
async function discoverGroups() {
  const discovered = new Set();
  for (const series of SERIES_PAGES) {
    const html = await fetchPage(`${BASE}${series}/`);
    if (!html) { console.warn(`  ! страница серии пуста: ${series}`); continue; }
    for (const slug of extractGroupSlugs(html)) discovered.add(slug);
  }
  const all = new Set([...KNOWN_GROUPS, ...discovered]);
  return { groups: [...all].sort(), discoveredCount: discovered.size };
}

/* Обход одной группы с пагинацией до исчерпания. */
async function crawlGroup(group) {
  const accumulated = new Set();
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? `${BASE}${group}/` : `${BASE}${group}/?PAGEN_1=${page}`;
    const html = await fetchPage(url);
    if (!html && page === 1) return { articles: [], pages: 0, empty: true };
    const pageArticles = extractArticles(html);
    if (isPageExhausted(accumulated, pageArticles)) break; // новых кодов нет → конец
    for (const a of newArticles(accumulated, pageArticles)) accumulated.add(a);
    pages = page;
  }
  return { articles: [...accumulated].sort(), pages, empty: false };
}

/* Загрузка нашего каталога: файл присваивает window.EP_VIMAR_CATALOG = {...}; */
async function readCatalog(file) {
  const raw = await fs.readFile(file, "utf8");
  const eq = raw.indexOf("=", raw.indexOf("window.EP_VIMAR_CATALOG"));
  const json = raw.slice(eq + 1).trim().replace(/;\s*$/, "");
  return JSON.parse(json);
}

const KINDS = ["frame", "mechanism", "support", "socket_box"];

/* ---- сборка отчёта сверки ---- */
function buildReconciliation(catalog, siteGroups) {
  // артикул сайта → набор групп, где он встречается
  const siteArticleGroups = new Map();
  for (const [group, arts] of Object.entries(siteGroups)) {
    for (const a of arts) {
      if (!siteArticleGroups.has(a)) siteArticleGroups.set(a, new Set());
      siteArticleGroups.get(a).add(group);
    }
  }
  // база артикула → набор групп (для «мягкой» сверки по базовому коду)
  const siteBaseGroups = new Map();
  for (const [a, groups] of siteArticleGroups) {
    const b = baseCode(a);
    if (!siteBaseGroups.has(b)) siteBaseGroups.set(b, new Set());
    for (const g of groups) siteBaseGroups.get(b).add(g);
  }

  const allSiteArticles = new Set(siteArticleGroups.keys());
  const ourCodes = new Set(catalog.products.map((p) => p.code));

  // группы, которые сайт присвоил артикулу (точно или по базе)
  const groupsForCode = (code) => {
    if (siteArticleGroups.has(code)) return siteArticleGroups.get(code);
    const b = baseCode(code);
    return siteBaseGroups.get(b) || new Set();
  };

  // разбивка по нашим kind
  const perKind = {};
  for (const k of KINDS) perKind[k] = { total: 0, onSite: 0, agree: 0, disagree: 0, absent: 0, disagreeGroups: new Map() };

  for (const p of catalog.products) {
    const stat = perKind[p.kind];
    if (!stat) continue;
    stat.total++;
    const groups = groupsForCode(p.code);
    if (groups.size === 0) { stat.absent++; continue; }
    stat.onSite++;
    const siteKinds = new Set([...groups].map(groupToKind));
    if (siteKinds.has(p.kind)) {
      stat.agree++;
    } else {
      stat.disagree++;
      for (const g of groups) stat.disagreeGroups.set(g, (stat.disagreeGroups.get(g) || 0) + 1);
    }
  }

  // наши коды, которых на сайте нет вовсе (ни точно, ни по базе)
  const ourAbsent = catalog.products
    .filter((p) => KINDS.includes(p.kind) && groupsForCode(p.code).size === 0)
    .map((p) => p.code);
  // артикулы сайта, которых нет у нас (ни точно, ни как чья-то база)
  const ourBases = new Set([...ourCodes].map(baseCode));
  const siteOnly = [...allSiteArticles].filter((a) => !ourCodes.has(a) && !ourBases.has(baseCode(a))).sort();

  return { siteArticleGroups, siteBaseGroups, perKind, ourAbsent, siteOnly, allSiteArticles, groupsForCode };
}

/* Ответ на вопросы (а) и (б): к каким группам сайт относит конкретные коды. */
function answerProbe(codes, recon) {
  const rows = [];
  for (const code of codes) {
    const exact = recon.siteArticleGroups.get(code);
    const byBase = recon.siteBaseGroups.get(baseCode(code));
    const groups = exact || byBase || new Set();
    const via = exact ? "точно" : (byBase ? `по базе ${baseCode(code)}` : "нет на сайте");
    rows.push({ code, groups: [...groups].sort(), via });
  }
  return rows;
}

function fmtGroups(groups) {
  if (!groups.length) return "— (нет на сайте)";
  return groups.map((g) => `\`${g}\` → ${KIND_LABELS[groupToKind(g)] || "неизвестно"}`).join("; ");
}

async function main() {
  let siteGroups, meta;

  if (args.offline) {
    const prev = JSON.parse(await fs.readFile(OUT, "utf8"));
    siteGroups = prev.groups;
    meta = prev.meta;
    console.log(`offline: взят готовый ${path.relative(repoRoot, OUT)} (снят ${meta.fetchedAt})`);
  } else {
    console.log("Обнаружение групп по страницам серий…");
    const { groups, discoveredCount } = await discoverGroups();
    console.log(`  групп к обходу: ${groups.length} (обнаружено по сериям: ${discoveredCount}, известных: ${KNOWN_GROUPS.length})`);

    siteGroups = {};
    const pagesPerGroup = {};
    const empties = [];
    for (const group of groups) {
      const { articles, pages, empty } = await crawlGroup(group);
      if (empty) { empties.push(group); continue; }
      siteGroups[group] = articles;
      pagesPerGroup[group] = pages;
      console.log(`  ${group.padEnd(34)} стр:${String(pages).padStart(2)}  артикулов:${articles.length}`);
    }
    if (empties.length) console.warn(`  пустые/несуществующие группы (пропущены): ${empties.join(", ")}`);

    const uniqueArticles = new Set();
    for (const arts of Object.values(siteGroups)) for (const a of arts) uniqueArticles.add(a);
    meta = {
      source: "vimar.ru",
      fetchedAt: new Date().toISOString().slice(0, 10),
      groupsCount: Object.keys(siteGroups).length,
      uniqueArticles: uniqueArticles.size,
      pagesPerGroup,
    };
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    // ключи-группы отсортированы → детерминированный файл при том же съёме
    const ordered = {};
    for (const g of Object.keys(siteGroups).sort()) ordered[g] = siteGroups[g];
    await fs.writeFile(OUT, JSON.stringify({ meta, groups: ordered }, null, 2) + "\n", "utf8");
    console.log(`\nСохранено: ${path.relative(repoRoot, OUT)} — групп ${meta.groupsCount}, уникальных артикулов ${meta.uniqueArticles}`);
  }

  // ---- сверка с нашим каталогом ----
  const catalog = await readCatalog(CATALOG);
  const recon = buildReconciliation(catalog, siteGroups);

  const PROBE_A = ["14901", "14902", "14903", "14904", "14931", "14932", "14943", "14944"];
  const PROBE_B = ["09001.0.250", "09005.0.250", "14001.0", "14005.0", "00938.B", "00936.120.A"];
  const probeA = answerProbe(PROBE_A, recon);
  const probeB = answerProbe(PROBE_B, recon);

  // ---- markdown-отчёт ----
  const L = [];
  L.push("# Сверка нашей классификации VIMAR с сайтом vimar.ru");
  L.push("");
  L.push(`> Автоотчёт \`tools/fetch-site-groups.mjs\` (npm run build:site-groups). `
    + `Съём сайта: **${meta.fetchedAt}**, групп: **${meta.groupsCount}**, уникальных артикулов: **${meta.uniqueArticles}**. `
    + `Наш каталог: \`js/catalog-vimar.js\` (${catalog.products.length} позиций). `
    + `Сверка — только разведка; правки kind принимает владелец.`);
  L.push("");
  L.push("Сопоставление групп сайта с нашим kind: `nakladki*`→frame, `mekhanizmy*`→mechanism, "
    + "`supporta*`→support, `montazhnye-korobki`→socket_box; `aksessuary*`/`osvetitelnye-komponenty`/"
    + "`komponenty-prochie`/`prochee`/`sistemy`/`ustroystva-avtomatizatsii*`/`by-me*`/`knx*` → «не модуль поста».");
  L.push("");

  L.push("## Ответ на вопрос (а): IP55-коробки и крышки");
  L.push("");
  L.push("| Наш код | kind у нас | Группа(ы) на сайте | Сопоставление |");
  L.push("|---|---|---|---|");
  for (const r of probeA) {
    L.push(`| \`${r.code}\` | frame | ${fmtGroups(r.groups)} | ${r.via} |`);
  }
  L.push("");

  L.push("## Ответ на вопрос (б): голые механизмы и светодиоды подсветки");
  L.push("");
  L.push("| Наш код | kind у нас | Группа(ы) на сайте | Сопоставление |");
  L.push("|---|---|---|---|");
  for (const r of probeB) {
    L.push(`| \`${r.code}\` | mechanism | ${fmtGroups(r.groups)} | ${r.via} |`);
  }
  L.push("");

  L.push("## Расхождения по видам");
  L.push("");
  L.push("| Наш kind | Всего | На сайте | Согласен | Расходится | Нет на сайте |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const k of KINDS) {
    const s = recon.perKind[k];
    L.push(`| ${KIND_LABELS[k]} | ${s.total} | ${s.onSite} | ${s.agree} | ${s.disagree} | ${s.absent} |`);
  }
  L.push("");
  for (const k of KINDS) {
    const s = recon.perKind[k];
    if (!s.disagreeGroups.size) continue;
    const top = [...s.disagreeGroups.entries()].sort((a, b) => b[1] - a[1])
      .map(([g, n]) => `\`${g}\` (${n})`).join(", ");
    L.push(`- **${KIND_LABELS[k]}**: сайт относит к другим группам — ${top}`);
  }
  L.push("");

  L.push("## Чего нет на сайте / чего нет у нас");
  L.push("");
  L.push(`Наших модульных артикулов (frame/mechanism/support/socket_box), которых на сайте нет вообще: **${recon.ourAbsent.length}**.`);
  L.push(`Примеры (до 15): ${recon.ourAbsent.slice(0, 15).map((c) => `\`${c}\``).join(", ") || "—"}`);
  L.push("");
  L.push(`Артикулов сайта, которых нет у нас (ни точно, ни как база): **${recon.siteOnly.length}**.`);
  L.push(`Примеры (до 15): ${recon.siteOnly.slice(0, 15).map((c) => `\`${c}\``).join(", ") || "—"}`);
  L.push("");

  await fs.writeFile(REPORT, L.join("\n"), "utf8");

  // ---- консольная сводка ----
  console.log(`\nОтчёт: ${path.relative(repoRoot, REPORT)}`);
  console.log("\n(а) IP55-коробки/крышки — группа сайта:");
  for (const r of probeA) console.log(`  ${r.code.padEnd(9)} → ${r.groups.join(", ") || "нет на сайте"} [${r.via}]`);
  console.log("\n(б) голые механизмы и светодиоды — группа сайта:");
  for (const r of probeB) console.log(`  ${r.code.padEnd(13)} → ${r.groups.join(", ") || "нет на сайте"} [${r.via}]`);
  console.log("\nРасхождения по видам (всего / на сайте / согласен / расходится / нет на сайте):");
  for (const k of KINDS) {
    const s = recon.perKind[k];
    console.log(`  ${KIND_LABELS[k].padEnd(30)} ${String(s.total).padStart(5)} ${String(s.onSite).padStart(6)} ${String(s.agree).padStart(6)} ${String(s.disagree).padStart(6)} ${String(s.absent).padStart(6)}`);
  }
  console.log(`\nНаших модульных нет на сайте: ${recon.ourAbsent.length}; артикулов сайта нет у нас: ${recon.siteOnly.length}`);
}

main().catch((err) => { console.error("Ошибка разведки:", err); process.exitCode = 1; });
