#!/bin/bash
# Stop-хук: при завершении каждого хода проверяет размер CLAUDE.md.
# Подсчёт строк — чисто механическая операция, поэтому без сабагента и без
# модели: дешевле (ноль токенов) и надёжнее (сработает всегда, не зависит
# от того, вспомнит ли модель проверить). systemMessage показывается прямо
# вам в интерфейсе и не попадает в контекст модели как инструкция — Claude
# не начнёт сам самовольно резать CLAUDE.md в ответ на это сообщение.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

CLAUDE_MD="CLAUDE.md"
LIMIT=200

[ -f "$CLAUDE_MD" ] || exit 0

LINES=$(wc -l < "$CLAUDE_MD" | tr -d ' ')

if [ "$LINES" -gt "$LIMIT" ]; then
  MSG="Внимание, размер файла CLAUDE.md для проекта превысил рекомендованный лимит! Проверьте содержимое и подкорректируйте в случае необходимости. (сейчас: ${LINES} строк, ориентир: ~150-200)"
  if command -v jq >/dev/null 2>&1; then
    echo "{\"systemMessage\": $(printf '%s' "$MSG" | jq -Rs .)}"
  else
    ESC=$(printf '%s' "$MSG" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"systemMessage": "%s"}\n' "$ESC"
  fi
fi

exit 0
