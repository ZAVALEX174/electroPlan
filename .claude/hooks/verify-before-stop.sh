#!/bin/bash
# Stop-хук: перед тем как Claude завершит ход, проверяет ВСЕ изменённые за
# сессию .php-файлы (не только последний), включая новые/незакоммиченные.
# Если где-то синтаксическая ошибка — ход не завершается, Claude получает
# список ошибок и чинит их прежде, чем отчитаться о готовности.
#
# Это дополняет php-lint.sh: тот хук ловит ошибку сразу после конкретной
# правки, этот — подстраховывает весь дифф целиком (например, если правка
# одного файла сломала синтаксис в другом через include, или файл был
# изменён через Bash, а не через Edit/Write).

INPUT=$(cat)
if command -v jq >/dev/null 2>&1; then
  STOP_ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')
else
  if printf '%s' "$INPUT" | grep -qE '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    STOP_ACTIVE=true
  else
    STOP_ACTIVE=false
  fi
fi
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

if ! command -v php >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  exit 0
fi

CHANGED=$( { git diff --name-only HEAD -- '*.php'; git diff --name-only --cached -- '*.php'; git ls-files --others --exclude-standard -- '*.php'; } 2>/dev/null | sort -u)

if [ -z "$CHANGED" ]; then
  exit 0
fi

ERRORS=""
while IFS= read -r file; do
  [ -f "$file" ] || continue
  OUT=$(php -l "$file" 2>&1)
  if [ $? -ne 0 ]; then
    ERRORS="$ERRORS
$OUT"
  fi
done <<< "$CHANGED"

if [ -n "$ERRORS" ]; then
  echo "Найдены синтаксические ошибки в изменённых за сессию файлах — исправь их перед тем как закончить:$ERRORS" >&2
  exit 2
fi

exit 0
