"""Project-scoped Codex lifecycle hooks. Read one Codex JSON event from stdin."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATCH_PATH = re.compile(r"^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$", re.MULTILINE)


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
    return PATCH_PATH.findall(command)


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
    if errors:
        emit({"decision": "block", "reason": "Fix PHP syntax errors in changed files before finishing:\n" + "\n".join(errors)})
    else:
        emit({})


def main() -> None:
    data = event()
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "pre-tool":
        pre_tool(data)
    elif action == "post-tool":
        post_tool(data)
    elif action == "stop":
        stop(data)
    else:
        emit({})


if __name__ == "__main__":
    main()
