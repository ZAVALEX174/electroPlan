#!/bin/bash
# PreToolUse-хук (Edit|Write): блокирует правки ядра Битрикса и файлов с секретами.
# Это защита "второго уровня" поверх deny-правил в settings.json — если правило
# в settings.json когда-нибудь случайно уберут, эта проверка всё равно сработает
# и Claude получит понятное объяснение, а не просто отказ без причины.

INPUT=$(cat)

# Собрать пути-кандидаты из JSON на stdin. jq может быть не установлен (типичная
# ситуация на Windows/Git Bash), поэтому есть запасной разбор через grep/sed.
# Без него хук молча пропускал бы любую правку (fail-open) — для защиты ядра
# это недопустимо.
#
# Важно: в fallback берём НЕ первый, а ВСЕ значения "file_path" во входе. У Write
# полезная нагрузка — {"file_path": …, "content": …}, порядок ключей не
# гарантирован, и если "content" сам содержит строку `"file_path": "/local/…"`,
# ограничение первым совпадением дало бы подставить путь-обманку и пропустить
# правку в /bitrix/. Проверяем каждый кандидат — спрятать реальный путь нельзя.
if command -v jq >/dev/null 2>&1; then
  CANDIDATES=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
else
  CANDIDATES=$(printf '%s' "$INPUT" \
    | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')
fi

if [ -z "$CANDIDATES" ]; then
  exit 0
fi

PROTECTED_PATTERNS=(
  "/bitrix/"
  ".settings.php"
  ".settings_extra.php"
  "dbconn.php"
  "/.env"
)

while IFS= read -r FILE_PATH; do
  [ -n "$FILE_PATH" ] || continue
  # Нормализовать разделители пути: Windows отдаёт "\", а паттерны записаны через
  # "/". В JSON бэкслеши приходят удвоенными ("\\"), поэтому сводим оба варианта
  # к "/", чтобы совпадение работало одинаково на всех ОС.
  FILE_PATH_NORM=$(printf '%s' "$FILE_PATH" | sed 's#\\\\#/#g; s#\\#/#g')
  for pattern in "${PROTECTED_PATTERNS[@]}"; do
    if [[ "$FILE_PATH_NORM" == *"$pattern"* ]]; then
      echo "Заблокировано: '$FILE_PATH' попадает под защищённый паттерн '$pattern'. Ядро /bitrix/ и файлы с секретами менять нельзя — вноси изменения только в /local/. Если файл действительно нужно изменить вручную — сделай это сам за пределами Claude Code." >&2
      exit 2
    fi
  done
done <<< "$CANDIDATES"

exit 0
