// Снимает скриншоты сценария показа через Chrome DevTools Protocol (headless Chrome).
// Запуск: node tools/qa/run.mjs [хвост] — см. tools/qa/README.md.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
// Папка tools/qa (QA_DIR задаёт run.mjs, когда сценарий собран во временный файл) и корень проекта от неё.
const QA = process.env.QA_DIR || path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(QA, "../..").replace(/\\/g, "/");
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".wasm":"application/wasm", ".woff2":"font/woff2" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = ROOT + p;
  fs.readFile(f, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(data); });
}).listen(8431);

const DIR = path.join(QA, "out");   // скриншоты, профиль браузера, пойманный HTML — всё в out/ (в .gitignore)
const SHOTS = path.join(DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 9333;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = path.join(DIR, "profile");
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1600,1000", "--hide-scrollbars", "--no-first-run", "--disable-popup-blocking", "about:blank"
], { stdio: "ignore" });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(p, method = "GET") {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method }); return await r.json(); } catch { await sleep(200); }
  }
  throw new Error("chrome не ответил");
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else listeners.forEach(l => l(m));
  };
  const ready = new Promise(r => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ready, send, on: f => listeners.push(f), close: () => ws.close() };
}

let n = 0;
const log = [];
async function main() {
  await json("/json/version");
  const tab = await json("/json/new?http://127.0.0.1:8431/", "PUT");
  const c = connect(tab.webSocketDebuggerUrl); await c.ready;
  await c.send("Page.enable"); await c.send("Runtime.enable"); await c.send("DOM.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.reload"); await sleep(5000);

  const ev = async (expr) => {
    const r = await c.send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const rect = async (sel) => ev(`const e=${sel};if(!e)return null;e.scrollIntoView({block:"center",inline:"nearest"});const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};`);
  const mouse = async (x, y, type) => c.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const click = async (sel, dx = null, dy = null) => {
    const r = await rect(sel); if (!r) throw new Error("нет элемента: " + sel);
    const x = r.x + (dx ?? r.w / 2), y = r.y + (dy ?? r.h / 2);
    await mouse(x, y, "mouseMoved"); await mouse(x, y, "mousePressed"); await mouse(x, y, "mouseReleased"); await sleep(350);
  };
  const setVal = async (sel, v) => { await ev(`const e=${sel};e.value=${JSON.stringify(v)};e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));`); await sleep(400); };
  const mark = async (sels) => ev(`document.querySelectorAll(".__mk").forEach(x=>x.remove());for(const s of ${JSON.stringify(sels)}){const e=eval(s);if(!e)continue;const r=e.getBoundingClientRect();const d=document.createElement("div");d.className="__mk";Object.assign(d.style,{position:"fixed",left:(r.left-5)+"px",top:(r.top-5)+"px",width:(r.width+10)+"px",height:(r.height+10)+"px",border:"4px solid #e11d48",borderRadius:"8px",zIndex:99999,pointerEvents:"none",boxShadow:"0 0 0 4px rgba(225,29,72,.25)"});document.body.appendChild(d);}return true;`);
  const unmark = () => ev(`document.querySelectorAll(".__mk").forEach(x=>x.remove());return 1;`);
  const shot = async (name, marks = [], cl = null, conn = c) => {
    if (marks.length) await mark(marks);
    await sleep(250);
    const p = { format: "png" }; if (cl) p.clip = { ...cl, scale: 1 };
    const r = await conn.send("Page.captureScreenshot", p);
    const f = path.join(SHOTS, `${String(++n).padStart(2, "0")}-${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, "base64")); log.push(path.basename(f));
    if (marks.length) await unmark();
  };
  const $ = id => `document.getElementById(${JSON.stringify(id)})`;
  const btnText = t => `Array.from(document.querySelectorAll("button")).find(b=>b.offsetParent&&b.textContent.includes(${JSON.stringify(t)}))`;
  const canvasPt = async (fx, fy) => { const r = await rect($("canvas")); return { x: r.x + r.w * fx, y: r.y + r.h * fy }; };
  const clickAt = async (x, y) => { await mouse(x, y, "mouseMoved"); await mouse(x, y, "mousePressed"); await mouse(x, y, "mouseReleased"); await sleep(400); };
  const drag = async (x,y,dx,dy)=>{await mouse(x,y,"mouseMoved");await mouse(x,y,"mousePressed");for(let i=1;i<=6;i++)await c.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:x+dx*i/6,y:y+dy*i/6,button:"left",buttons:1});await mouse(x+dx,y+dy,"mouseReleased");await sleep(900);};
  const makeRoom = async (fx, fy) => {
    for (let i = 0; i < 4; i++) {
      await click(`document.querySelector('[data-tool="room"]')`); await sleep(400);
      const q = await canvasPt(fx, fy); await drag(q.x, q.y, 180, 110);
      const ok = await ev('return !!Array.from(document.querySelectorAll("input")).find(x=>x.offsetParent&&x.value==="Новая комната")');
      if (ok) return;
      log.push("повтор комнаты " + i + ": labels=" + await ev('return document.querySelectorAll(".room-label").length'));
      await sleep(800);
    }
    throw new Error("комната не создалась");
  };
  const RIGHT = { x: 1270, y: 80, width: 330, height: 920 };
  const nameRoom = async (name) => {
    await ev(`const i=Array.from(document.querySelectorAll("input")).find(x=>x.offsetParent&&x.value==="Новая комната");i.focus();i.value=${JSON.stringify(name)};i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));i.blur();return 1;`);
    await sleep(400);
  };

  // 01 общий вид
  await shot("start");

  // --- Комната Б: немецкий (станет первой комнатой проекта) ---
  let p; await makeRoom(0.62, 0.30);
  await nameRoom("Кухня (немецкий)");
  await shot("room-standard", [`document.getElementById("roomStandardSelect")`]);
  await setVal($("roomStandardSelect"), "DE");
  await shot("room-standard-de", [`document.getElementById("roomStandardSelect")`]);
  // вид «С картинками»
  const pic = await ev(`return !!document.getElementById("roomFacingViewPictures")`);
  if (pic) {
    await click($("roomFacingViewPictures")); await sleep(500);
    await shot("room-pictures", [`document.getElementById("roomFacingViewPictures")`]);
    await ev(`const b=Array.from(document.querySelectorAll(".room-facing-view-btn")).find(x=>x.id!=="roomFacingViewPictures");b&&b.click();return 1;`); await sleep(400);
  }

  // --- Новый пост в немецкой комнате ---
  await click($("newPostBtn")); await sleep(800);
  await shot("newpost-de", [`document.getElementById("postFrameSelect").closest(".field,label,div")`, `document.getElementById("postSlotCount")`]);
  log.push("frame DE: " + await ev(`return document.getElementById("postFrameSelect").selectedOptions[0]?.textContent`));
  await click($("cancelPost")); await sleep(400);

  // --- Комната А: итальянский, Neve Up, белая ---
  await makeRoom(0.30, 0.62);
  await nameRoom("Гостиная (итальянский)");
  await setVal($("roomStandardSelect"), "IT");
  await setVal($("roomCollectionSelect"), "Neve Up");
  await setVal($("room_frameColorSelect"), "Белая");
  await shot("room-it", [`document.getElementById("roomStandardSelect")`, `document.getElementById("roomCollectionSelect")`, `document.getElementById("room_frameColorSelect")`]);

  // пост на 4 модуля в гостиной
  const buildPost = async (mods, cards, label) => {
    await click($("newPostBtn")); await sleep(800);
    const itId = await ev(`return Array.from(document.getElementById("builderRoomSelect").options).find(o=>o.textContent.includes("Гостиная")).value`);
    await setVal($("builderRoomSelect"), itId);
    if (mods !== 3) await setVal($("postSlotCount"), String(mods));
    await setVal($("builderSearch"), "09001"); await sleep(500);
    for (const t of cards) {
      await click(`Array.from(document.querySelectorAll("#builderCatalog button")).find(b=>b.textContent.includes(${JSON.stringify(t)}))`);
    }
    await sleep(500);
    log.push(label + ": " + await ev(`return document.getElementById("postFrameSelect").selectedOptions[0]?.textContent`));
  };
  await buildPost(4, ["1 модуль, белый", "1 модуль, белый", "2 модуля, белый"], "post4");
  await shot("post4-built", [`document.getElementById("builderRoomSelect")`, `document.getElementById("postFrameSelect").parentElement`, `document.getElementById("savePost")`]);
  await click($("savePost")); await sleep(700);
  await shot("library", [`document.querySelector("[data-place-template]")`]);

  // размещение в немецкую кухню
  await click(`document.querySelector("[data-place-template]")`);
  const lab = await rect(`Array.from(document.querySelectorAll(".room-label")).find(e=>e.textContent.includes("Кухня"))`);
  await clickAt(lab.x + lab.w / 2, lab.y + lab.h + 45); await sleep(300);
  await shot("placed-toast", [`Array.from(document.querySelectorAll(".room-label")).find(e=>e.textContent.includes("Кухня"))`]);
  await mouse(lab.x + lab.w / 2 + 2, lab.y + lab.h + 45, "mouseMoved"); await sleep(700);
  await shot("placed-hover");
  await clickAt(lab.x + lab.w / 2, lab.y + lab.h + 45); await sleep(500);
  await click(btnText("Редактировать")); await sleep(900);
  log.push("placed frame: " + await ev(`return document.getElementById("postFrameSelect").selectedOptions[0]?.textContent`));
  await shot("placed-edit", [`document.getElementById("postFrameSelect").parentElement`, `document.getElementById("builderRoomSelect")`]);
  await click($("cancelPost")); await sleep(400);

  // отказ: пост 3 модуля
  await click(btnText("Выбор"));
  await buildPost(3, ["1 модуль, белый", "1 модуль, белый", "1 модуль, белый"], "post3");
  await click($("savePost")); await sleep(700);
  await click(`Array.from(document.querySelectorAll("[data-place-template]")).at(-1)`);
  await clickAt(lab.x + lab.w / 2 + 60, lab.y + lab.h + 45); await sleep(200);
  await shot("refuse-toast", [`document.querySelector(".toast")`]);
  log.push("toast: " + await ev(`return document.querySelector(".toast")?.textContent`));
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return 1;`); await sleep(300);

  // --- Подпись и печать ---
  const mk = async (kind) => ev(`const c=document.createElement("canvas");c.width=360;c.height=${kind === "sig" ? 140 : 360};const g=c.getContext("2d");
    if(${kind === "sig"}){g.strokeStyle="#1d3a8a";g.lineWidth=5;g.lineCap="round";g.beginPath();g.moveTo(20,100);g.bezierCurveTo(60,10,90,130,130,60);g.bezierCurveTo(160,20,180,120,220,70);g.bezierCurveTo(250,40,280,110,340,50);g.stroke();}
    else{g.strokeStyle="rgba(29,58,138,.85)";g.lineWidth=8;g.beginPath();g.arc(180,180,160,0,7);g.stroke();g.lineWidth=3;g.beginPath();g.arc(180,180,120,0,7);g.stroke();g.fillStyle="rgba(29,58,138,.85)";g.font="bold 34px Arial";g.textAlign="center";g.fillText("ОБРАЗЕЦ",180,170);g.font="22px Arial";g.fillText("ПЕЧАТЬ",180,210);}
    return c.toDataURL("image/png").split(",")[1];`);
  const sig = path.join(DIR, "signature.png"), stamp = path.join(DIR, "stamp.png");
  fs.writeFileSync(sig, Buffer.from(await mk("sig"), "base64"));
  fs.writeFileSync(stamp, Buffer.from(await mk("stamp"), "base64"));
  await ev(`document.getElementById("docSignatureBtn").scrollIntoView({block:"center"});return 1;`); await sleep(300);
  await shot("sign-buttons", [`document.getElementById("docSignatureBtn")`, `document.getElementById("docStampBtn")`]);
  const doc = await c.send("DOM.getDocument", {});
  for (const [id, f] of [["docSignatureInput", sig], ["docStampInput", stamp]]) {
    const { nodeId } = await c.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#" + id });
    await c.send("DOM.setFileInputFiles", { nodeId, files: [f] }); await sleep(700);
  }
  await ev(`document.getElementById("docStampBtn").scrollIntoView({block:"center"});return 1;`); await sleep(300);
  await shot("sign-loaded", [`document.getElementById("docSignaturePreview")`, `document.getElementById("docStampPreview")`]);

  // КП — новое окно
  await ev('window.__kp="";window.open=()=>({closed:false,document:{open(){},write(h){window.__kp+=h},close(){},title:""},focus(){},print(){},close(){},addEventListener(){},location:{}});return 1;');
  await click($("pdfBtn")); await sleep(1200);
  const html = await ev("return window.__kp");
  fs.writeFileSync(path.join(DIR, "kp.html"), html);
  const nt = await json("/json/new?about:blank", "PUT");
  {
    const k = connect(nt.webSocketDebuggerUrl); await k.ready; await k.send("Page.enable");
    await k.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1400, deviceScaleFactor: 1, mobile: false });
    const ft = await k.send("Page.getFrameTree");
    await k.send("Page.setDocumentContent", { frameId: ft.frameTree.frame.id, html }); await sleep(1500);
    let r = await k.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS, String(++n).padStart(2, "0") + "-kp-top.png"), Buffer.from(r.data, "base64")); log.push("kp-top " + html.length);
    await k.send("Runtime.evaluate", { expression: "window.scrollTo(0,document.body.scrollHeight)" }); await sleep(500);
    r = await k.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS, String(++n).padStart(2, "0") + "-kp-bottom.png"), Buffer.from(r.data, "base64")); log.push("kp-bottom");
    k.close();
  }


  // --- Пустой пул: немецкий + Arke + Антрацит ---
  await clickAt(lab.x + lab.w / 2, lab.y + lab.h / 2); await sleep(500);
  await setVal($("roomCollectionSelect"), "Arke");
  await setVal($("room_frameColorSelect"), "Антрацит");
  await click($("newPostBtn")); await sleep(900);
  const kitchen = await ev(`return Array.from(document.getElementById("builderRoomSelect").options).find(o=>o.textContent.includes("Кухня")).value`);
  await setVal($("builderRoomSelect"), kitchen); await sleep(500);
  await shot("empty-pool", [`document.querySelector(".builder-error")`, `document.getElementById("postFrameSelect").parentElement`]);
  log.push("empty: " + await ev(`return document.querySelector(".builder-error")?.textContent`));

  c.close();
}
main().then(() => { console.log(log.join("\n")); chrome.kill(); server.close(); process.exit(0); })
  .catch(e => { console.error("ОШИБКА:", e.message); console.log(log.join("\n")); chrome.kill(); process.exit(1); });
