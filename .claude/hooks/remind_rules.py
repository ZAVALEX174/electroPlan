#!/usr/bin/env python3
# Механическое напоминание обязательных правил проекта — печатается в контекст на КАЖДОЕ
# сообщение владельца (событие UserPromptSubmit).
# Заведено 01.10.2026 после слов владельца: правила должны «постоянно действовать в каждой
# сессии и на каждом шаге». Как и в remind-screen-first.sh: запись в файл Claude по ходу
# сессии не перечитывает, а вывод хука попадает в контекст на каждое сообщение.
# Текст правил живёт в .claude/RULES.md и правится без правки хука. Печатается только
# «Часть 1» (до строки «## Часть 2»): разделы 7.1–7.3 слишком длинны для каждого сообщения.
# Код выхода ВСЕГДА 0: у UserPromptSubmit код 2 блокирует сообщение владельца, поэтому любой
# сбой кончается предупреждением в контекст, а не ошибкой. stdin не читаем — при ручном
# запуске чтение повисло бы. Запускать как `python .claude/hooks/remind_rules.py`.
import os
import re
import sys
from pathlib import Path

HEADER = "Напоминание: обязательные правила проекта"
NO_RULES = "Напоминание: файл .claude/RULES.md не найден — обязательные правила не загружены"


def build_message():
    # Путь — от самого скрипта, а не от cwd: хук запускается из произвольной папки.
    rules = Path(__file__).resolve().parent.parent / "RULES.md"
    # utf-8-sig: Блокнот Windows ставит BOM, с обычным utf-8 он попал бы в первую строку.
    text = rules.read_text(encoding="utf-8-sig")
    part2 = re.search(r"^## Часть 2", text, re.MULTILINE)
    if part2:
        text = text[:part2.start()]
    if text and not text.endswith("\n"):
        text += "\n"
    return HEADER + "\n\n" + text


def main():
    try:
        message = build_message()
    except Exception:
        # Нет файла, нет прав, не UTF-8 — правила не загружены, и молчать об этом нельзя.
        message = NO_RULES + "\n"
    try:
        # Байты, а не print(): консоль Windows по умолчанию cp1251 и кириллица превратилась
        # бы в кракозябры; заодно «\n» не раздувается до «\r\n».
        sys.stdout.buffer.write(message.encode("utf-8"))
        sys.stdout.buffer.flush()
    except Exception:
        pass


if __name__ == "__main__":
    main()
    # Не sys.exit: если читатель закрыл pipe, финальный flush интерпретатора подменил бы
    # код 0 на 120 (замерено). Всё нужное уже сброшено в main().
    os._exit(0)
