/*
 * «Унаследовать поля от брата» — ОДНО правило для новых артикулов, которых нет в прежнем файле:
 * подсветка клавиш (решение владельца 19.10) и монтажные поля новых накладок (principle +
 * boxModularity). Брата ищет findBrothers; поля потребители берут сами. Ниже — подсветка.
 *
 * Подсветка НОВЫХ клавиш (решение владельца 19.10). В новом файле заказчика колонки подсветки
 * пусты у клавиш, которых нет в прежнем файле, — подсветка им не считалась и осевая 00937/00938
 * не подбиралась. Два правила, оба по данным, а не списком артикулов:
 *  (а) «брат по базовому артикулу»: тот же код без последнего суффикса отделки (22751.89 ↔
 *      22751.11, 19021.C ↔ 19021.B). Берём признаки брата; если братья расходятся — не угадываем;
 *  (б) круглые «подсвечиваемые» клавиши Tondo (22761.RN.*) — как подсвечиваемая клавиша Flat
 *      22751.11 (эталон ниже): brother-а в прежнем файле у них нет.
 * Чистые функции: только аргументы, без файлов и DOM.
 */

// Базовый артикул: без последнего dot-сегмента (суффикса отделки). Без точки — сам код.
export const baseCode = (code) => (code.includes(".") ? code.replace(/\.[^.]+$/, "") : code);

// Эталон для (б): подсвечиваемая клавиша Flat — признаки берутся из её записи, а не дублируются.
export const TONDO_REFERENCE_CODE = "22751.11";
const TONDO_BACKLIT_RE = /подсвечиваем/i;
const isTondo = (series) => (series || []).some((s) => String(s).toLowerCase() === "eikon tondo");

/*
 * Братья новой записи в пуле прежних записей, по убыванию близости:
 *  base  — тот же код без последнего суффикса (22672.1.87 ↔ 22672.1.*);
 *  tondo — круглая Tondo `NNNNN.RN.K.отделка` ↔ Eikon `NNNNN.K.*` того же артикула без RN
 *          (22683.RN.1.01 ↔ 22683.1.*). Источник — vimar.com: «3-module cover plate for a Tondo
 *          control… blank modules 21041 in the free slots» — та же рамка на тот же суппорт и те же
 *          заглушки, что у Eikon 22683.1/22683.2; у варианта K Eikon данных нет — не наследуется;
 *  root  — тот же первый сегмент (19641.12.01 ↔ 19641.*);
 *  plana — первый сегмент без «U» (14641U.01 ↔ 14641.*): Plana Up садится на тот же суппорт,
 *          что Plana, и модульность/принцип те же (docs/совместимость-vimar-внешние-источники.md,
 *          S1 стр. 326). Для других серий «U» не отбрасываем — только пятизначная база с U.
 * Возвращает { tier, brothers } первого уровня, где братья есть (даже без данных — решает
 * потребитель), иначе null. Себя в братьях нет.
 */
const rootOf = (code) => code.split(".")[0];
const planaRootOf = (code) => { const m = /^(\d{5})U$/.exec(rootOf(code)); return m ? m[1] : null; };
export function findBrothers(rec, pool, tiers = ["base", "tondo", "root", "plana"]) {
  const others = pool.filter((o) => o.code !== rec.code);
  for (const tier of tiers) {
    let brothers = [];
    if (tier === "base") { const b = baseCode(rec.code); brothers = others.filter((o) => baseCode(o.code) === b); }
    else if (tier === "tondo") {
      const m = /^(\d{5})\.RN\.(\d+)\.[^.]+$/.exec(rec.code);
      if (m) { const pre = m[1] + "." + m[2] + "."; brothers = others.filter((o) => o.code.startsWith(pre) && !o.code.includes(".RN.")); }
    }
    else if (tier === "root") { const rt = rootOf(rec.code); brothers = others.filter((o) => rootOf(o.code) === rt); }
    else if (tier === "plana") { const rt = planaRootOf(rec.code); if (rt) brothers = others.filter((o) => rootOf(o.code) === rt); }
    if (brothers.length) return { tier, brothers };
  }
  return null;
}

/*
 * Поля от брата: fields — имена полей, которых у rec нет (null/undefined). Братья уровня
 * сравниваются по совокупности ВСЕХ полей, включая пустые: если часть братьев данных не имеет
 * (22682.2.* без принципа) или они расходятся — не угадываем. Результат:
 * { rule: tier, values, brothers } | { rule: "diverge"|"nodata", brothers } | null (братьев нет).
 */
export function inheritFields(rec, pool, fields) {
  const missing = fields.filter((f) => rec[f] == null);
  if (!missing.length) return null;
  const found = findBrothers(rec, pool);
  if (!found) return null;
  const sigOf = (o) => JSON.stringify(missing.map((f) => o[f] ?? null));
  const sigs = new Set(found.brothers.map(sigOf));
  const codes = found.brothers.map((b) => b.code);
  if (sigs.size > 1) return { rule: "diverge", brothers: codes };
  const b = found.brothers[0];
  if (missing.every((f) => b[f] == null)) return { rule: "nodata", brothers: codes };
  const values = {};
  for (const f of missing) if (b[f] != null) values[f] = b[f];
  return { rule: found.tier, values, brothers: codes };
}

const sig = (r) => `${!!r.askBacklight}|${r.backlightPosition ?? ""}|${r.backlightColor ?? ""}`;

/*
 * rec — запись нового файла; oldRecords — записи прежнего файла. Возвращает
 * { rule: "brother"|"tondo"|"diverge"|null, askBacklight, backlightPosition, backlightColor, brothers }
 * или null, если правило не применимо. Применять только к НОВЫМ клавишам без своих признаков.
 */
export function inheritBacklight(rec, oldRecords) {
  if (rec.partRole !== "key" || rec.askBacklight || rec.backlightPosition != null || rec.backlightColor) return null;
  const found = findBrothers(rec, oldRecords, ["base"]);
  const brothers = found ? found.brothers : [];
  if (brothers.length) {
    const sigs = new Set(brothers.map(sig));
    if (sigs.size > 1) return { rule: "diverge", brothers: brothers.map((b) => b.code) };
    const b = brothers[0];
    if (!b.askBacklight) return null;
    return { rule: "brother", askBacklight: true, backlightPosition: b.backlightPosition ?? null,
      backlightColor: b.backlightColor || null, brothers: brothers.map((x) => x.code) };
  }
  if (isTondo(rec.series) && TONDO_BACKLIT_RE.test(rec.name)) {
    const ref = oldRecords.find((o) => o.code === TONDO_REFERENCE_CODE);
    if (!ref || !ref.askBacklight) return null;
    return { rule: "tondo", askBacklight: true, backlightPosition: ref.backlightPosition ?? null,
      backlightColor: ref.backlightColor || null, brothers: [ref.code] };
  }
  return null;
}
