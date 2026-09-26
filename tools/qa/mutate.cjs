// Прогон мутаций в ИЗОЛИРОВАННОЙ копии проекта (рабочее дерево не трогается).
// Запуск: node tools/qa/mutate.cjs <файл-мутаций.json> [тестовый-шаблон]
//   файл мутаций: [{ "name": "M1 …", "file": "js/estimate.js", "from": "точный фрагмент", "to": "замена" }, …]
//   «from» должен встречаться в файле РОВНО один раз, иначе мутация пропускается с пометкой.
//   Переводы строк: \n во from/to сам подстраивается под CRLF файла.
//   Тестовый шаблон по умолчанию — весь набор "tests/*.test.js".
// Мутация «поймана», если число fail выросло по сравнению с базовым прогоном копии.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const listFile = process.argv[2];
const pattern = process.argv[3] || "tests/*.test.js";
if (!listFile) { console.error("укажите файл мутаций (json)"); process.exit(1); }
const mutations = JSON.parse(fs.readFileSync(listFile, "utf8"));

const SKIP = new Set(["node_modules", ".git", ".claude", "chertez", "seg-preview", "vendor", "local", "outputs"]);
const copy = path.join(os.tmpdir(), "ep-mut-copy");
// Ссылка node_modules в копии — junction на библиотеки ПРОЕКТА: снимаем её явно до удаления копии,
// чтобы рекурсивное удаление никогда не пошло внутрь настоящего node_modules.
function removeCopy() {
  const link = path.join(copy, "node_modules");
  try { fs.lstatSync(link); try { fs.unlinkSync(link); } catch { fs.rmdirSync(link); } } catch { /* ссылки нет */ }
  fs.rmSync(copy, { recursive: true, force: true });
}
removeCopy();
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".tmp-") || (e.name === "out" && src.endsWith("qa"))) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (!/\.(pdf|jpg|pptx)$/i.test(e.name)) fs.copyFileSync(s, d);
  }
}
copyDir(ROOT, copy);
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(copy, "node_modules"), "junction");

const run = () => {
  let out = "";
  try { out = execSync(`node --test "${pattern}"`, { cwd: copy, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = e.stdout || ""; }
  return Number((out.match(/^ℹ fail (\d+)/m) || [])[1] || 0);
};
const base = run();
console.log(`копия: ${copy}\nбаза: fail=${base}`);
for (const m of mutations) {
  const file = path.join(copy, m.file);
  const orig = fs.readFileSync(file, "utf8");
  const eol = orig.includes("\r\n") ? "\r\n" : "\n";
  const from = m.from.replace(/\r?\n/g, eol), to = (m.to || "").replace(/\r?\n/g, eol);
  const n = orig.split(from).length - 1;
  if (n !== 1) { console.log(`${m.name}: вхождений ${n} — ПРОПУСК`); continue; }
  fs.writeFileSync(file, orig.split(from).join(to));
  const fail = run();
  fs.writeFileSync(file, orig);
  console.log(`${m.name}: fail=${fail} ${fail > base ? "ПОЙМАНА" : "⚠ НЕ ПОЙМАНА"}`);
}
removeCopy();
