#!/bin/bash
# SessionStart-хук: проверяет, есть ли карта кода проекта (.claude/project-map.md)
# и не отстала ли она от текущего состояния кода. Если карты нет или она
# устарела — сообщает об этом Claude через additionalContext (обычный stdout
# для SessionStart уже добавляется в контекст), чтобы тот сам решил вызвать
# сабагента project-mapper прежде, чем браться за задачу. Хук не решает за
# Claude — только даёт ему знать факт.

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

MAP_FILE=".claude/project-map.md"

if [ ! -f "$MAP_FILE" ]; then
  echo "Карта кода проекта ($MAP_FILE) ещё не создана. Прежде чем искать что-либо в /local вручную через Glob/Grep — запусти сабагента project-mapper, чтобы построить карту, затем продолжай задачу."
  exit 0
fi

if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
  MAPPED_HEAD=$(grep -oE 'mapped-at-commit: [a-f0-9]+' "$MAP_FILE" 2>/dev/null | head -1 | awk '{print $2}')
  if [ -n "$MAPPED_HEAD" ] && [ -n "$CURRENT_HEAD" ] && [ "$MAPPED_HEAD" != "$CURRENT_HEAD" ]; then
    echo "Карта кода проекта ($MAP_FILE) построена на коммите $MAPPED_HEAD, а сейчас HEAD — $CURRENT_HEAD. Возможно, устарела. Если задача касается кода, который мог измениться — освежи карту через сабагента project-mapper (он допишет только изменившееся, не станет пересобирать всё с нуля)."
  fi
fi

exit 0
