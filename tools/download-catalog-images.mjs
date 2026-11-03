#!/usr/bin/env node
/**
 * Скачивает картинки каталога VIMAR в программу (img/catalog/), чтобы программа
 * не зависела от сторонних сайтов (03.11: vimar.ru недоступен — у заказчика
 * пропали ВСЕ картинки). Источник — www.vimar.com:
 *   страница товара  /en/int/catalog/product/index/code/<АРТИКУЛ>
 *   полное фото      /irj/go/km/docs/z_catalogo/MAIN_IMAGE/<...>.jpg   → img/catalog/<АРТИКУЛ>.jpg
 *   превью           /cache/images/catalog/<...>.webp                  → img/catalog/<АРТИКУЛ>.webp
 * Запуск:  node tools/download-catalog-images.mjs [--limit N] [--concurrency 8]
 * Возобновляемый: уже скачанные файлы пропускаются, недокачанные добираются
 * повторными запусками. Отчёт: tools/qa/out/img-download-report.json.
 * Конвертер (tools/build-catalog.mjs) затем подставляет локальный файл первым,
 * ссылку на сайт VIMAR оставляет запасной (если своего файла нет).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const CATALOG_JS = path.join(projectRoot, "js/catalog-vimar.js");
const OUT_DIR = path.join(projectRoot, "img/catalog");
const REPORT = path.join(projectRoot, "tools/qa/out/img-download-report.json");

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const LIMIT = Number(arg("limit", 0));
const CONCURRENCY = Number(arg("concurrency", 2));
const DELAY_MS = Number(arg("delay", 300)); // пауза между пачками — vimar.com банит IP за всплески (03.11)
const TIMEOUT_MS = 25000;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(REPORT), { recursive: true });

// --- читаем артикулы из каталога тем же способом, что приложение ---
const ctx = vm.createContext({ window: {}, structuredClone });
vm.runInContext(fs.readFileSync(CATALOG_JS, "utf8"), ctx, { filename: "catalog-vimar.js" });
const cat = ctx.window.EP_CATALOG_VIMAR || Object.values(ctx.window)[0];
const items = Array.isArray(cat) ? cat : (cat.items || cat.products || []);
const codes = [...new Set(items.map(it => String(it.code || "").trim()).filter(Boolean))];
console.log(`артикулов в каталоге: ${codes.length}`);

const safe = code => code.replace(/[\\/:*?"<>|]/g, "_");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ElectroPlanCatalogImages/1.0", Accept: "text/html,image/*" };

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

// vimar.com отдаёт 403 на TLS-отпечаток undici (Node fetch), а curl проходит —
// поэтому транспорт — curl (03.11, проверено фактом: те же URL через curl → 200).
async function get(url, asBuffer) {
  const os = await import("node:os");
  for (let attempt = 0; attempt < 3; attempt++) {
    const tmp = asBuffer ? path.join(os.tmpdir(), `epimg-${process.pid}-${Math.random().toString(36).slice(2)}`) : null;
    try {
      const args = ["-sS", "--ssl-no-revoke", "--max-time", "25", "-A", UA["User-Agent"]];
      if (asBuffer) args.push("-o", tmp);
      args.push("-w", asBuffer ? "%{http_code}" : "\n%{http_code}", url);
      const { stdout } = await execFileP("curl", args, { encoding: asBuffer ? "utf8" : "utf8", maxBuffer: 8 * 1024 * 1024 });
      const status = Number(String(stdout).trim().split("\n").pop());
      if (status === 403) { await new Promise(s => setTimeout(s, [15000, 30000, 60000][attempt])); continue; }
      if (asBuffer) {
        const data = status === 200 && fs.existsSync(tmp) ? fs.readFileSync(tmp) : null;
        return { status, body: data };
      }
      return { status, body: String(stdout).slice(0, String(stdout).lastIndexOf("\n")) };
    } catch (e) {
      return { status: 0, error: String(e.message || e).slice(0, 120) };
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true });
    }
  }
  return { status: 403, error: "rate-limit после 3 попыток" };
}

const result = { started: new Date().toISOString(), downloaded: [], missing: [], errors: [] };
const jpgPath = c => path.join(OUT_DIR, safe(c) + ".jpg");
const webpPath = c => path.join(OUT_DIR, safe(c) + ".webp");

async function one(code) {
  if (fs.existsSync(jpgPath(code)) && fs.statSync(jpgPath(code)).size > 0) return; // уже есть (resume)
  const page = await get(`https://www.vimar.com/en/int/catalog/product/index/code/${encodeURIComponent(code)}`);
  if (page.status !== 200) {
    (page.status === 0 ? result.errors : result.missing).push({ code, status: page.status, error: page.error });
    return;
  }
  const html = page.body;
  const mMain = html.match(/\/irj\/go\/km\/docs\/z_catalogo\/MAIN_IMAGE\/[^"'\s]+\.jpe?g/i);
  const mPrev = html.match(/\/cache\/images\/catalog\/[^"'\s]+\.webp/i);
  if (!mMain && !mPrev) { result.missing.push({ code, status: "no-image-on-page" }); return; }
  let ok = false;
  if (mMain) {
    const img = await get("https://www.vimar.com" + mMain[0], true);
    if (img.status === 200 && img.body && img.body.length > 300) { fs.writeFileSync(jpgPath(code), img.body); ok = true; }
  }
  if (mPrev) {
    const img = await get("https://www.vimar.com" + mPrev[0], true);
    if (img.status === 200 && img.body && img.body.length > 100) fs.writeFileSync(webpPath(code), img.body);
  }
  if (ok) result.downloaded.push(code);
  else result.missing.push({ code, status: "image-fetch-failed" });
}

const todo = (LIMIT ? codes.slice(0, LIMIT) : codes).filter(c => !(fs.existsSync(jpgPath(c)) && fs.statSync(jpgPath(c)).size > 0));
console.log(`к скачиванию: ${todo.length} (остальные уже на диске)`);
let done = 0;
for (let i = 0; i < todo.length; i += CONCURRENCY) {
  await Promise.all(todo.slice(i, i + CONCURRENCY).map(one));
  done += Math.min(CONCURRENCY, todo.length - i);
  if (DELAY_MS) await new Promise(s => setTimeout(s, DELAY_MS));
  if (done % 80 < CONCURRENCY) {
    const mb = fs.readdirSync(OUT_DIR).reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0) / 1048576;
    console.log(`…${done}/${todo.length} | скачано ${result.downloaded.length}, нет на сайте ${result.missing.length}, ошибок ${result.errors.length} | ${mb.toFixed(1)} МБ`);
  }
}
result.finished = new Date().toISOString();
result.totalMb = fs.readdirSync(OUT_DIR).reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0) / 1048576;
fs.writeFileSync(REPORT, JSON.stringify(result, null, 1));
console.log(`ГОТОВО: скачано ${result.downloaded.length}, не найдено ${result.missing.length}, ошибок ${result.errors.length}, объём ${result.totalMb.toFixed(1)} МБ. Отчёт: ${path.relative(projectRoot, REPORT)}`);
if (result.errors.length) console.log("ошибки (повторный запуск докачает):", result.errors.slice(0, 10).map(e => e.code + ":" + (e.error || e.status)).join(", "));
