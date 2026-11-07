/* В29: у поста со снятой с производства накладкой пометка «снята с производства» видна и в панели
   «Спецификация» (рядом с именем поста), прокручивать вниз не нужно. Пометку несёт ОДНО правило
   EPPosts.frameAvailability (posts.js:36–40): estimate.build кладёт её готовый текст в строку
   спецификации полем discontinuedText (документы КП/Excel его не читают — у них пометка в имени
   накладки состава), а renderSummary рисует его рядом с именем.

   Две проверки:
     1. estimate.build — строка спецификации поста получает discontinuedText из frameAvailability
        (мутация: убрать поле/пропаганду в группу → красный).
     2. renderSummary (настоящий текст app.js на DOM-шиме) — пишет пометку в #specList рядом с
        именем (мутация: убрать дописку → красный). Запуск: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert/strict");
const stand = require("./helpers/appStand.js");
const EPEstimate = require("../js/estimate.js");
const EPPosts = require("../js/posts.js");
const EPPackTopUp = require("../js/packTopUp.js");

/* Собираем смету на ОДНОМ посте, где накладка — переданный товар. comp.frameAvailability берём из
   НАСТОЯЩЕЙ EPPosts.frameAvailability (источник пометки реальный); прочее в comp минимально. */
function buildWith(frame) {
  const products = frame ? [frame] : [];
  const product = id => products.find(p => Number(p.id) === Number(id)) || undefined;
  const comp = {
    boxCount: 1, box: null, boxFallback: null,
    support: null, supportCount: 0, supportNotRequired: false,
    backlight: null, sensors: null,
    frameAvailability: EPPosts.frameAvailability(frame ? frame.id : null, frame)
  };
  return EPEstimate.build({
    posts: [{ id: 1, name: "Пост 1", frameId: frame ? frame.id : null, mechanismIds: [] }],
    product, frameProduct: product,
    postComposition: () => comp,
    postCost: () => 0, lightingOf: () => [],
    settings: {}
  });
}

test("estimate.build: снятая накладка даёт строке discontinuedText, активная — пусто", () => {
  const off = buildWith({ id: 7, code: "14651", name: "Накладка Plana", price: 5, active: false });
  assert.equal(off.groups.length, 1);
  assert.equal(off.groups[0].name, "Пост 1", "имя строки не меняем (его печатают КП/Excel)");
  assert.equal(off.groups[0].discontinuedText, "снята с производства");

  const on = buildWith({ id: 8, code: "14653", name: "Накладка Plana", price: 5, active: true });
  assert.equal(on.groups[0].discontinuedText, "");
});

/* renderSummary: настоящий исходник app.js на DOM-шиме. Соседи заглушены (их стерегут свои тесты),
   EPEstimate/EPPackTopUp — настоящие: строку спецификации собирает реальный код. */
function renderWith(est) {
  const dom = stand.makeDom();
  const state = { rooms: [], devices: [], posts: [{ id: "p1", roomId: null }] };
  const render = stand.run(["orphanObjectsWarningText", "renderSummary"], {
    state,
    EPRoomAssign: require("../js/roomAssign.js"),
    EPEstimate, EPPackTopUp,
    $: dom.$,
    money: v => "money(" + v + ")",
    moneyShown: v => "moneyShown(" + v + ")",
    displayRate: () => 1, displayCurrency: () => "EUR",
    esc: s => String(s),
    projectLighting: () => ({}),
    buildEstimate: () => est,
    lightingHtml: () => "[LIGHTING_HTML]",
    updateStatus: () => {}
  });
  render();
  return dom;
}

const estOf = discontinuedText => ({
  groups: [{ name: "Пост 1", count: 1, unit: "компл.", items: [{ price: 10, count: 1 }],
    discount: undefined, discontinuedText }],
  missing: [], equipment: 10, materials: 0, work: 0, subtotal: 10, total: 10,
  discount: 0, discountPercent: 0, discountMixed: false,
  materialsPercent: 0, workPercent: 0,
  vat: 0, vatMode: "none", vatPercent: 0, vatIncluded: false, vatLabel: "НДС"
});

test("renderSummary: пометка стоит рядом с именем поста в #specList", () => {
  const dom = renderWith(estOf("снята с производства"));
  assert.match(dom.els.specList.innerHTML, /<strong>Пост 1 — снята с производства<\/strong>/,
    "снятый пост помечен прямо у имени в панели «Спецификация»");
});

test("renderSummary: активный пост — без пометки", () => {
  const dom = renderWith(estOf(""));
  assert.match(dom.els.specList.innerHTML, /<strong>Пост 1<\/strong>/);
  assert.doesNotMatch(dom.els.specList.innerHTML, /снята с производства/);
});
