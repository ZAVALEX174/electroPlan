/*
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

const sig = (r) => `${!!r.askBacklight}|${r.backlightPosition ?? ""}|${r.backlightColor ?? ""}`;

/*
 * rec — запись нового файла; oldRecords — записи прежнего файла. Возвращает
 * { rule: "brother"|"tondo"|"diverge"|null, askBacklight, backlightPosition, backlightColor, brothers }
 * или null, если правило не применимо. Применять только к НОВЫМ клавишам без своих признаков.
 */
export function inheritBacklight(rec, oldRecords) {
  if (rec.partRole !== "key" || rec.askBacklight || rec.backlightPosition != null || rec.backlightColor) return null;
  const base = baseCode(rec.code);
  const brothers = oldRecords.filter((o) => o.code !== rec.code && baseCode(o.code) === base);
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
