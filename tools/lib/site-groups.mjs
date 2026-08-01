/*
 * Чистая логика разведки классификации VIMAR по сайту vimar.ru.
 *
 * Отделена от сети (tools/fetch-site-groups.mjs) намеренно: разбор HTML,
 * определение «страница пагинации исчерпана» и сопоставление «группа сайта →
 * наш kind» — детерминированные функции, их можно покрыть юнит-тестами на
 * строках-фикстурах без единого запроса. Сам обход и кэш — в раннере.
 *
 * Никаких побочных эффектов и обращений к файлам здесь нет.
 */

/* Страницы серий — точки входа для обнаружения групп. С них видны ссылки на
   все группы серии (nakladki-*, mekhanizmy-*, supporta-*, by-me-*, knx-* …). */
export const SERIES_PAGES = [
  "eikon-tactil", "eikon-evo", "eikon", "eikon-exe",
  "arke", "idea", "plana", "neve-up", "dopolnitelnoe-oborudovanie",
];

/* Слаги серий исключаются при обнаружении групп: серии кросс-ссылаются друг на
   друга, но сами товарными группами не являются. */
export const SERIES_SLUGS = new Set(SERIES_PAGES);

/* katalogi-dlya-prosmotra — это PDF-каталоги, а не товары (по заданию пропускаем). */
export const SKIP_SLUGS = new Set(["katalogi-dlya-prosmotra"]);

/* Заранее известный список групп (страховка на случай, если обнаружение по
   сериям что-то не поднимет). Серийные варианты автоматизации/by-me/knx
   дополняются обнаружением — их точные слаги здесь не перечислены. */
export const KNOWN_GROUPS = [
  "nakladki", "nakladki-evo", "nakladki-arke", "nakladki-eikon",
  "nakladki-eikon-exe", "nakladki-idea", "nakladki-plana", "nakladki-tactil",
  "mekhanizmy-evo", "mekhanizmy-arke", "mekhanizmy-eikon", "mekhanizmy-idea",
  "mekhanizmy-plana", "mekhanizmy-tactil", "mekhanizmy-flatvintage",
  "supporta", "supporta-arke", "supporta-eikon", "supporta-evo",
  "supporta-idea", "supporta-plana",
  "aksessuary-arke", "aksessuary-eikon", "aksessuary-evo", "aksessuary-idea",
  "aksessuary-plana", "aksessuary-tactil",
  "montazhnye-korobki", "osvetitelnye-komponenty", "komponenty-prochie",
  "prochee", "ustroystva-avtomatizatsii", "sistemy",
];

/* Артикул VIMAR: 5-значная база с необязательным буквенным префиксом (V у
   монтажных коробок — V71303) и хвостами вариантов через точку (.01, .AU,
   .0.250). Прайсовый регэксп \b\d{5}(?:\.\w+)*\b из задания не ловит V-коробки
   (все 13 наших socket_box — V7xxxx), поэтому база расширена на [A-Z]{0,2}:
   без этого сверка socket_box просто не состоялась бы. Границы слова не дают
   зацепить хвост длинного числа. */
const ARTICLE_SRC = "\\b[A-Z]{0,2}\\d{5}(?:\\.\\w+)*\\b";

/* Ссылка на товарную группу: один сегмент /catalog/production/<слаг>/.
   Карточки товара (/catalog/production/<серия>/<код>/) отдают лишь слаг серии
   первым сегментом — коды в группы не просачиваются. */
const GROUP_LINK_RE = /\/catalog\/production\/([a-z0-9-]+)\//g;

/* Убираем скрипты/стили/комментарии и вообще всю разметку: артикулы в листинге
   стоят видимым текстом, а вот в <script> лежит мусор (SERVER_TZ_OFFSET:'10800'
   ловится как «10800»), в href/src — пути картинок с цифрами. После вырезания
   тегов остаётся только текст, где токен-артикул отделён пробелами. */
export function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

/* Множество артикулов со страницы (порядок появления сохраняется). */
export function extractArticles(html) {
  const text = stripHtml(html);
  const re = new RegExp(ARTICLE_SRC, "g");
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
  }
  return out;
}

/* Слаги групп со страницы серии: все одиночные production-сегменты минус слаги
   серий, минус пропускаемые (PDF-каталоги). */
export function extractGroupSlugs(html, seriesSlugs = SERIES_SLUGS) {
  const out = [];
  const seen = new Set();
  let m;
  const re = new RegExp(GROUP_LINK_RE.source, "g");
  while ((m = re.exec(String(html))) !== null) {
    const slug = m[1];
    if (seriesSlugs.has(slug) || SKIP_SLUGS.has(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/* Новые артикулы страницы относительно уже собранных. */
export function newArticles(accumulated, pageArticles) {
  return pageArticles.filter((a) => !accumulated.has(a));
}

/* Пагинация исчерпана, если очередная страница не принесла НИ ОДНОГО нового
   артикула. За последней страницей vimar.ru отдаёт клон первой/последней —
   в обоих случаях новых кодов нет, обход останавливается. */
export function isPageExhausted(accumulated, pageArticles) {
  return newArticles(accumulated, pageArticles).length === 0;
}

/* Сопоставление группы сайта с нашим kind. nakladki*→frame, mekhanizmy*→
   mechanism, supporta*→support, montazhnye-korobki→socket_box. Аксессуары,
   осветительные/прочие компоненты, автоматика, by-me/knx, sistemy — «не модуль
   поста» (в нашем каталоге таких kind нет). Неизвестная группа → null. */
export function groupToKind(group) {
  const g = String(group).toLowerCase();
  if (g.startsWith("nakladki")) return "frame";
  if (g.startsWith("mekhanizmy")) return "mechanism";
  if (g.startsWith("supporta")) return "support";
  if (g === "montazhnye-korobki") return "socket_box";
  if (
    g.startsWith("aksessuary") ||
    g === "osvetitelnye-komponenty" ||
    g === "komponenty-prochie" ||
    g === "prochee" ||
    g === "sistemy" ||
    g.startsWith("ustroystva-avtomatizatsii") ||
    g.startsWith("by-me") ||
    g.startsWith("knx")
  ) {
    return "non-module";
  }
  return null;
}

/* База артикула — до первого хвоста-варианта (14931.01 → 14931, V71306.AU →
   V71306). Нужна для «мягкой» сверки, когда сайт показывает базовый код, а у
   нас цветовой вариант (или наоборот). */
export function baseCode(code) {
  return String(code).split(".")[0];
}

export const KIND_LABELS = {
  frame: "накладки (frame)",
  mechanism: "механизмы (mechanism)",
  support: "суппорты (support)",
  socket_box: "монтажные коробки (socket_box)",
  "non-module": "не модуль поста",
};
