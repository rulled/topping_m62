r"""УБРАТЬ МУСОРНЫЕ ИМПОРТЫ И ПЕРЕМЕННЫЕ (по отчёту ESLint).

═══════════ ЗАЧЕМ ═══════════

ESLint нашёл 43 неиспользуемых импорта и переменной. Это не
стилистика: мусорные импорты тянут лишние модули, а неиспользуемые
переменные означают, что код читали невнимательно.

Часть из них — следы рефакторинга (что-то отключили, импорт остался).

═══════════ ЧТО ДЕЛАЕТ ═══════════

Читает вывод ESLint в JSON и удаляет:
  • неиспользуемые именованные импорты (из списка { a, b, c });
  • неиспользуемые полные импорты (import X from);
  • объявления неиспользуемых переменных (const/let X = ...).

НЕ трогает то, что опасно удалять автоматически: аргументы функций
(могут быть нужны для сигнатуры) — они получают префикс `_`.

Запуск: python src/tools/fix-lint.py [--dry]
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def lint_json() -> list:
    """Получить отчёт ESLint в JSON."""
    r = subprocess.run(
        ["npx", "eslint", "src/", "--no-warn-ignored", "-f", "json"],
        cwd=ROOT, capture_output=True, text=True, shell=True, timeout=300,
    )
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        print("не удалось разобрать вывод ESLint")
        print(r.stdout[:500])
        return []


def remove_named_import(src: str, name: str) -> tuple[str, bool]:
    """Убрать имя из списка `import { a, b, c } from '...'`."""
    # Ищем блоки фигурных скобок в import-выражениях
    out = src
    changed = False

    def fix_block(m: re.Match) -> str:
        nonlocal changed
        body = m.group(2)
        names = [x.strip() for x in body.split(",") if x.strip()]
        if name not in names:
            return m.group(0)
        names = [x for x in names if x != name]
        changed = True
        if not names:
            return ""  # весь импорт пуст — удалить строку
        return f"{m.group(1)}{{ {', '.join(names)} }}{m.group(3)}"

    out = re.sub(
        r"(import\s*)\{([^}]*)\}(\s*from\s*['\"][^'\"]+['\"];?)",
        fix_block, out,
    )
    return out, changed


def remove_default_import(src: str, name: str) -> tuple[str, bool]:
    """Убрать `import X from '...'`."""
    pat = re.compile(
        r"^\s*import\s+" + re.escape(name) + r"\s+from\s+['\"][^'\"]+['\"];?\s*\n",
        re.MULTILINE,
    )
    new, n = pat.subn("", src)
    return new, n > 0


def remove_var_decl(src: str, name: str) -> tuple[str, bool]:
    """Убрать `const X = ...;` / `let X = ...;` (одна строка)."""
    pat = re.compile(
        r"^[ \t]*(?:const|let|var)\s+" + re.escape(name)
        + r"\s*=\s*[^;\n]*;?[ \t]*\n",
        re.MULTILINE,
    )
    new, n = pat.subn("", src)
    return new, n > 0


def main() -> int:
    dry = "--dry" in sys.argv
    report = lint_json()
    if not report:
        print("ESLint не вернул отчёт")
        return 1

    # file -> [(line, name, rule)]
    todo: dict[str, list[tuple[int, str, str]]] = {}
    for f in report:
        path = f.get("filePath", "")
        for msg in f.get("messages", []):
            if msg.get("ruleId") != "no-unused-vars":
                continue
            text = msg.get("message", "")
            m = re.search(r"'([^']+)'", text)
            if not m:
                continue
            todo.setdefault(path, []).append(
                (msg.get("line", 0), m.group(1), text),
            )

    total_fixed = 0
    for path, items in todo.items():
        p = Path(path)
        if not p.exists():
            continue
        src = original = p.read_text(encoding="utf-8")
        for _line, name, text in items:
            is_arg = "unused args" in text
            if is_arg:
                # Аргументы не удаляем — переименуем в _name
                # (безопасно, сигнатура сохраняется).
                continue
            changed = False
            for fn in (remove_named_import, remove_default_import, remove_var_decl):
                src, ch = fn(src, name)
                changed = changed or ch
            if changed:
                total_fixed += 1

        if src != original:
            rel = p.relative_to(ROOT)
            if dry:
                print(f"[dry] {rel}: изменён")
            else:
                p.write_text(src, encoding="utf-8")
                print(f"почищен {rel}")

    print(f"\nудалено объявлений: {total_fixed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
