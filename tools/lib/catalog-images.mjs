/*
 * Единое правило картинок каталога для ОБОИХ конвертеров (build-catalog.mjs и
 * build-discontinued.mjs) — чтобы правка жила одним местом, а не двумя копиями (§7.1).
 *
 * Картинки хранятся В ПРОГРАММЕ (img/catalog/<артикул>.jpg / .webp, скачивает
 * tools/download-catalog-images.mjs). 03.11 vimar.ru лёг (TCP 443 не поднимается) — у
 * заказчика пропали все картинки, которые ссылались на сайт. Отсюда два правила ниже.
 */
import { existsSync } from "node:fs";
import path from "node:path";

// Имя файла картинки из артикула: символы, запрещённые в путях, → "_" (тот же приём,
// что в download-catalog-images.mjs — иначе файл и ссылка на него разойдутся).
export const imgSafe = (code) => String(code).replace(/[\\/:*?"<>|]/g, "_");

/* ПРАВИЛО: своя картинка — ВСЕГДА первой (решение владельца 04.11).
   - есть .jpg → полное фото = .jpg;
   - .jpg нет, но есть .webp → товар ВСЁ РАВНО получает свой файл (.webp), а НЕ ссылку на сайт
     (у части позиций на vimar.com вообще нет jpg, только webp-превью — напр. 09026.DND.CM);
   - превью: лёгкий .webp, если он есть, иначе .jpg.
   full === "" только когда своего файла нет вовсе — тогда решает ссылка (см. isDeadImageUrl). */
export function localImagePaths(imgDir, code) {
  const base = imgSafe(code);
  const jpg = existsSync(path.join(imgDir, base + ".jpg")) ? `img/catalog/${base}.jpg` : "";
  const webp = existsSync(path.join(imgDir, base + ".webp")) ? `img/catalog/${base}.webp` : "";
  const full = jpg || webp;        // .jpg приоритетнее; .webp тоже «свой файл», а не сайт
  const preview = webp || jpg;     // в превью — лёгкий .webp, иначе то же полное фото
  return { full, preview };
}

/* ПРАВИЛО: непригодная ссылка на фото = «фото нет» (поле не выводим — рантайм покажет свою
   заглушку «нет фото» вместо пустого квадрата). Два случая, оба означают «снимка нет»:
   - заглушка сайта …/no_photo.png (индекс vimar.ru отдаёт её позициям без фото);
   - любой URL на vimar.ru — сайт недоступен (03.11), такая ссылка у заказчика = пустой квадрат.
   Живой vimar.com НЕ трогаем (это рабочие ссылки). Локальные пути img/catalog/ — тоже не «мёртвые». */
export function isDeadImageUrl(url) {
  const s = String(url || "");
  return /no_photo/i.test(s) || /vimar\.ru/i.test(s);
}
