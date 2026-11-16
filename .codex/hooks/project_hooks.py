"""Project-scoped Codex lifecycle hooks. Read one Codex JSON event from stdin."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCH_PATH = re.compile(r"^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$", re.MULTILINE)
MAP_COMMIT = re.compile(r"mapped-at-commit:\s*([a-f0-9]+)")


def emit(value: dict) -> None:
    sys.stdout.buffer.write((json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8"))


def event() -> dict:
    try:
        value = json.load(sys.stdin)
        return value if isinstance(value, dict) else {}
    except (ValueError, UnicodeError):
        return {}


def patch_paths(data: dict) -> list[str]:
    tool_input = data.get("tool_input")
    if not isinstance(tool_input, dict):
        return []
    command = tool_input.get("command")
    if not isinstance(command, str):
        return []
    # PowerShell/Windows events may contain CRLF; strip the trailing CR before
    # extension checks and path resolution.
    return [path.strip() for path in PATCH_PATH.findall(command)]


def protected(path: str) -> bool:
    normalized = path.replace("\\", "/").casefold()
    parts = [part for part in normalized.split("/") if part not in ("", ".")]
    name = parts[-1] if parts else ""
    return (
        "bitrix" in parts
        or name == ".env"
        or name.startswith(".env.")
        or name in {".settings.php", ".settings_extra.php", "dbconn.php"}
    )


def pre_tool(data: dict) -> None:
    for path in patch_paths(data):
        if protected(path):
            emit({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": f"Protected project file: {path}. Edit application code outside bitrix and keep secrets out of changes.",
                }
            })
            return
    emit({})


def session_start(data: dict) -> None:
    if data.get("source") != "startup":
        emit({})
        return
    map_file = ROOT / ".claude" / "project-map.md"
    if not map_file.is_file():
        message = "Карта проекта не найдена. При задаче на навигацию по коду обнови карту через project_mapper."
    else:
        marker = MAP_COMMIT.search(map_file.read_text(encoding="utf-8-sig"))
        try:
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
                capture_output=True, timeout=5, check=True,
            ).stdout.strip()
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            head = ""
        if not marker or not head or head.startswith(marker.group(1)):
            emit({})
            return
        message = "Карта .claude/project-map.md построена на старом коммите; сверяй пути с текущим кодом и обнови её через project_mapper, если задача затрагивает изменённые области."
    emit({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": message}})


def prompt_submit(data: dict) -> None:
    message = (
        "Напоминание проекта: следуй AGENTS.md; сверяй слова заказчика с исходными материалами, "
        "показывай наблюдаемый результат и проверяй расчёты и сохранённые проекты. "
        "Не считай будущий сервер Битрикс действующей инфраструктурой."
    )
    emit({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": message}})


def php_lint(path: Path) -> str | None:
    try:
        result = subprocess.run(
            ["php", "-l", str(path)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if result.returncode == 0:
        return None
    return (result.stdout + result.stderr).strip() or f"PHP syntax check failed: {path}"


def in_project(path: str) -> Path | None:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    candidate = candidate.resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        return None
    return candidate


def post_tool(data: dict) -> None:
    errors = []
    for path in patch_paths(data):
        if not path.lower().endswith(".php"):
            continue
        file = in_project(path)
        if file is not None and file.is_file():
            error = php_lint(file)
            if error:
                errors.append(error)
    if errors:
        emit({"decision": "block", "reason": "\n".join(errors)})
    else:
        emit({})


def changed_php_files() -> list[Path]:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
            cwd=ROOT,
            capture_output=True,
            timeout=15,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []
    entries = result.stdout.split(b"\0")
    files: list[Path] = []
    index = 0
    while index < len(entries):
        item = entries[index]
        index += 1
        if not item:
            continue
        status = item[:2].decode("ascii", errors="replace")
        path = item[3:].decode("utf-8", errors="replace")
        if "R" in status or "C" in status:
            index += 1  # -z format includes the original path after a rename/copy.
        if path.lower().endswith(".php"):
            file = in_project(path)
            if file is not None and file.is_file():
                files.append(file)
    return list(dict.fromkeys(files))


def stop(data: dict) -> None:
    if data.get("stop_hook_active"):
        emit({})
        return
    errors = [error for path in changed_php_files() if (error := php_lint(path))]
    rules_file = ROOT / "AGENTS.md"
    line_count = len(rules_file.read_text(encoding="utf-8-sig").splitlines()) if rules_file.is_file() else 0
    warning = (
        f"AGENTS.md содержит {line_count} строк; проверь краткость проектных правил (ориентир до 200)."
        if line_count > 200 else None
    )
    if errors:
        output = {"decision": "block", "reason": "Fix PHP syntax errors in changed files before finishing:\n" + "\n".join(errors)}
        if warning:
            output["systemMessage"] = warning
        emit(output)
    else:
        emit({"systemMessage": warning} if warning else {})


def main() -> None:
    data = event()
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "pre-tool":
        pre_tool(data)
    elif action == "session-start":
        session_start(data)
    elif action == "prompt-submit":
        prompt_submit(data)
    elif action == "post-tool":
        post_tool(data)
    elif action == "stop":
        stop(data)
    else:
        emit({})


if __name__ == "__main__":
    main()
