// Запуск съёмки: node tools/qa/run.mjs            — полный показ (скриншоты для презентации)
//                node tools/qa/run.mjs vat        — общая часть (две комнаты, пост 4М в немецкой кухне)
//                                                  + хвост tools/qa/tails/vat.txt вместо сцен «отказ…КП»
// Хвост — кусок кода, вставляемый в main() shoot.mjs вместо сцен от «// отказ: пост 3 модуля» до
// конца: там уже есть проект с постом, хелперы ev/click/setVal/shot/json/connect и перехват window.open.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const QA = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const tailName = process.argv[2];
let script = path.join(QA, "shoot.mjs");
if (tailName) {
  const tailFile = path.join(QA, "tails", tailName + ".txt");
  if (!fs.existsSync(tailFile)) { console.error("нет хвоста " + tailFile); process.exit(1); }
  const lines = fs.readFileSync(script, "utf8").split("\n");
  const a = lines.findIndex(l => l.includes("// отказ: пост 3 модуля"));
  const b = lines.findIndex(l => l.trimEnd() === "  c.close();");
  if (a < 0 || b < 0) { console.error("в shoot.mjs не найдены метки вставки хвоста"); process.exit(1); }
  fs.mkdirSync(path.join(QA, "out"), { recursive: true });
  script = path.join(QA, "out", "_scenario-" + tailName + ".mjs");
  fs.writeFileSync(script, [...lines.slice(0, a), fs.readFileSync(tailFile, "utf8"), ...lines.slice(b)].join("\n"));
}
const r = spawnSync(process.execPath, [script], { stdio: "inherit", env: { ...process.env, QA_DIR: QA } });
process.exit(r.status ?? 1);
