#!/bin/bash
# PostToolUse-хук (Edit|Write): сразу после правки .php-файла проверяет его
# синтаксис через `php -l` и возвращает результат Claude в структурированном
# виде, чтобы модель сама увидела и исправила ошибку в рамках того же хода,
# не дожидаясь следующего сообщения от человека.

INPUT=$(cat)

# file_path из JSON на stdin — с запасным разбором без jq (Windows/Git Bash).
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
else
  FILE_PATH=$(printf '%s' "$INPUT" \
    | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -1 \
    | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')
fi

if [[ "$FILE_PATH" != *.php ]] || [ ! -f "$FILE_PATH" ]; then
  echo '{}'
  exit 0
fi

if ! command -v php >/dev/null 2>&1; then
  echo '{}'
  exit 0
fi

LINT_OUTPUT=$(php -l "$FILE_PATH" 2>&1)
if [ $? -ne 0 ]; then
  if command -v jq >/dev/null 2>&1; then
    REASON=$(printf '%s' "$LINT_OUTPUT" | jq -Rs .)
  else
    # Ручное экранирование в JSON-строку, если jq недоступен: \, ", переводы строк.
    REASON='"'$(printf '%s' "$LINT_OUTPUT" \
      | tr -d '\r' \
      | sed 's/\\/\\\\/g; s/"/\\"/g' \
      | awk 'NR>1{printf "\\n"} {printf "%s", $0}')'"'
  fi
  echo "{\"decision\": \"block\", \"reason\": $REASON}"
else
  echo '{}'
fi
exit 0
