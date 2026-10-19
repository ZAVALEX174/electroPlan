/*
 * Снятые с производства позиции каталога — чистая функция для сборки (К2, решение владельца).
 *
 * Номенклатура К2 убрала часть артикулов. Их не выбрасываем из каталога совсем, а возвращаем из
 * снимка прежнего каталога (tools/data/discontinued-732ae3a.json) с active=false, прежним id, ценой
 * и уже вмешанными признаками — модель блока В23 «снята с производства»: новым постам не
 * предлагается (рантайм фильтрует active), а в сохранённом проекте считается по своей цене.
 * «Снятый» — артикул снимка, которого НЕТ среди активных позиций текущей номенклатуры; так
 * повторно появившийся в номенклатуре артикул снова станет активным сам, без правки снимка.
 *
 * Функция без побочных эффектов (ни fs, ни git) — вход только аргументами; источник «прежних
 * данных» — зафиксированный снимок, переданный вызывающим. Это держит сборку воспроизводимой.
 */

/* Товары из снимка, которых нет среди активных кодов, — с active=false и прежним id.
   `idMap` (из catalog-ids.json) — authoritative-источник id; сверяем с id из снимка и, если
   разошлись, сообщаем через idWarnings (оба обязаны быть прежним стабильным id — расхождение
   означало бы, что сохранённый проект получит чужую цену/состав, см. §7.1 и stable-ids.mjs).
   Возвращаем { products, idWarnings }. */
export function collectDiscontinued(snapshotProducts, activeCodes, idMap) {
  const products = [];
  const idWarnings = [];
  for (const p of snapshotProducts) {
    if (activeCodes.has(p.code)) continue;   // есть в новой номенклатуре → активен, не снятый
    const mapped = idMap ? idMap[p.code] : undefined;
    if (mapped != null && Number(mapped) !== Number(p.id)) {
      idWarnings.push({ code: p.code, snapshotId: p.id, idsFileId: mapped });
    }
    const id = mapped != null ? mapped : p.id;
    // Разворачиваем снимок как есть (цена, серия, признаки автосостава — прежние, inline), меняем
    // только active и фиксируем id. Всё, что читает рантайм, сохраняется один в один.
    products.push({ ...p, id, active: false });
  }
  products.sort((a, b) => String(a.code).localeCompare(String(b.code), "en"));
  return { products, idWarnings };
}
