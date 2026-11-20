/* Выпуск выполняет владелец локально; GitHub меняется только отдельным git push. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const release = require("../js/catalogRelease.js");
const converter = require("../js/priceCatalog.js");
const sheet = require("../js/priceSheet.js");
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

export function embeddedProducts(root = defaultRoot) {
  const ctx = { window: {}, structuredClone };
  vm.createContext(ctx);
  for (const file of ["catalog-vimar.js", "catalog-vimar-attrs.js", "catalog-vimar-openings.js", "catalog-vimar-faces.js", "catalog-vimar-discontinued.js", "data.js"])
    vm.runInContext(fs.readFileSync(path.join(root, "js", file), "utf8"), ctx, { filename: file });
  return JSON.parse(JSON.stringify(ctx.window.EP_DATA.products));
}
export function readVersion(root, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Некорректная версия каталога");
  const bytes = fs.readFileSync(path.join(root, "catalog", "versions", hash + ".json"));
  if (sha(bytes) !== hash) throw new Error("Контрольная сумма версии не совпадает");
  const value = JSON.parse(bytes);
  if (value.schema !== 1) throw new Error("Неизвестная схема каталога");
  release.validate(value.products);
  return { products: value.products, bytes };
}
export function currentProducts(root) {
  const manifestFile = path.join(root, "catalog", "current.json");
  if (!fs.existsSync(manifestFile)) return embeddedProducts(root);
  const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (m.schema !== 1 || m.file !== "versions/" + m.sha256 + ".json") throw new Error("Повреждён манифест каталога");
  const version = readVersion(root, m.sha256);
  if (m.count !== version.products.length) throw new Error("Неверное число товаров в манифесте");
  return version.products;
}
function atomicWrite(file, data) {
  const temp = file + ".tmp-" + process.pid;
  try { fs.writeFileSync(temp, data, { flag: "wx" }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function publish(root, products, report) {
  release.validate(products);
  const bytes = Buffer.from(JSON.stringify({ schema: 1, products }) + "\n");
  const hash = sha(bytes), dir = path.join(root, "catalog");
  const versionPath = path.join(dir, "versions", hash + ".json");
  fs.mkdirSync(path.dirname(versionPath), { recursive: true });
  if (fs.existsSync(versionPath)) {
    if (!fs.readFileSync(versionPath).equals(bytes)) throw new Error("Существующая версия повреждена");
  } else fs.writeFileSync(versionPath, bytes, { flag: "wx" });
  // Отчёт и версия записаны раньше указателя: сбой оставит прежний активный каталог.
  fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
  const reportFile = path.join(dir, "reports", hash + ".json");
  if (!fs.existsSync(reportFile)) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  const manifest = { schema: 1, sha256: hash, file: "versions/" + hash + ".json", count: products.length };
  atomicWrite(path.join(dir, "current.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
export async function run(args, root = defaultRoot) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--file", "--rollback"].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Нет значения " + arg);
      opts[arg.slice(2)] = args[++i];
    } else if (["--publish", "--bootstrap", "--retire-missing"].includes(arg)) opts[arg.slice(2)] = true;
    else throw new Error("Неизвестный параметр: " + arg);
  }
  if ([opts.file, opts.bootstrap, opts.rollback].filter(Boolean).length !== 1)
    throw new Error("Укажите --file <прайс.xlsx>, --bootstrap или --rollback <sha256>; --publish записывает выпуск");
  if (opts["retire-missing"] && !opts.file) throw new Error("--retire-missing используется только с --file");
  let products, report;
  if (opts.rollback) {
    ({ products } = readVersion(root, opts.rollback)); report = { rollback: opts.rollback };
  } else if (opts.bootstrap) {
    if (opts.publish && fs.existsSync(path.join(root, "catalog", "current.json"))) throw new Error("Начальная версия уже опубликована");
    products = embeddedProducts(root); report = { bootstrap: true, count: products.length };
  } else {
    const XLSX = require("xlsx"), existing = currentProducts(root);
    const inputFile = path.resolve(opts.file), stat = fs.lstatSync(inputFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25000000)
      throw new Error("Ожидался обычный Excel-файл размером не более 25 МБ");
    const wb = XLSX.readFile(inputFile);
    const chosen = sheet.chooseSheet({ names: wb.SheetNames,
      grid: name => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }), ref: name => wb.Sheets[name]["!ref"] });
    const decoded = converter.convert(chosen.grid, { startRow: chosen.startRow, existingProducts: existing });
    if (!decoded.ok) throw new Error("Прайс не прошёл проверку: " + decoded.errors.map(e => e.message).join("; "));
    ({ products, report } = release.build(existing, decoded.products, { retireMissing: opts["retire-missing"] }));
    report.warnings = decoded.warnings;
  }
  release.validate(products);
  const manifest = opts.publish ? publish(root, products, report) : null;
  return { published: !!manifest, manifest, count: products.length, report };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await run(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
