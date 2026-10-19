/*
 * Центральный монтаж накладки из «Примечания» нового файла (решение владельца 19.10: «в екселе
 * все написано, какие к чему подходят» — данные заказчика главнее наследования от братьев).
 * Отдельной колонки принципа в новом файле нет, заказчик пишет его словами в объединённой
 * ячейке на группу. Формулировки сопоставлены кодам по старому файлу, где та же пара текст ↔
 * код совпала на всех накладках с известным принципом:
 *   «1 модуль центрально в коробку [и суппорт] на 2 модуля» → 1M_CENTRAL / 2
 *   «1 модуль центрально в коробку и суппорт на 3 модуля»   → 1M_CENTRAL_3 / 3
 *   «2 модуля через один в коробку и суппорт на 3 модуля»   → 2M_CENTRAL / 3
 *   «В суппорт 19601» → принцип и модульность САМОГО суппорта (так же, как накладка садится на
 *                      него в подборе); у суппорта без принципа («09613», «19626») — не угадываем.
 * Чистая функция: суппорты приходят аргументом, без файлов и DOM.
 */
const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const TEXT_RULES = [
  { re: /^1\s?модуль центрально в коробку и суппорт на 3\s?модуля$/, principle: "1M_CENTRAL_3", boxModularity: 3 },
  { re: /^2 модуля через один в коробку и суппорт на 3\s?модуля$/, principle: "2M_CENTRAL", boxModularity: 3 },
  { re: /^1\s?модуль центрально в коробку (?:и суппорт )?на 2 модуля$/, principle: "1M_CENTRAL", boxModularity: 2 },
  { re: /^1 модуль в коробку 2 модуля центрально$/, principle: "1M_CENTRAL", boxModularity: 2 },
];
const SUPPORT_RE = /^(?:в\s?)?супп?орт\s+(\d{5})(?:\s+и\s+(\d{5}))?$/;

/*
 * supportsByCode — Map код → { principle, boxModularity }. Возвращает:
 *  { rule: "text"|"support", principle, boxModularity } — распознано;
 *  { rule: "nosupportdata", supports } — суппорт назван, но у него принципа нет / они расходятся;
 *  { rule: "unparsed" } — в примечании речь о модулях/суппорте, но формулировки в таблице нет;
 *  null — примечание не про монтаж («Новинка 07.2026», «Запрашивать остатки»).
 */
export function mountFromNote(note, supportsByCode) {
  const t = norm(note);
  if (!t) return null;
  for (const r of TEXT_RULES) if (r.re.test(t)) return { rule: "text", principle: r.principle, boxModularity: r.boxModularity };
  const m = SUPPORT_RE.exec(t);
  if (m) {
    const codes = [m[1], m[2]].filter(Boolean);
    const vals = codes.map((c) => supportsByCode.get(c)).filter((s) => s && s.principle);
    const sigs = new Set(vals.map((s) => `${s.principle}|${s.boxModularity ?? ""}`));
    if (sigs.size !== 1) return { rule: "nosupportdata", supports: codes };
    return { rule: "support", principle: vals[0].principle, boxModularity: vals[0].boxModularity ?? null };
  }
  return /модул|су(?:п|пп)орт/.test(t) ? { rule: "unparsed" } : null;
}
