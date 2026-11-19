r"""Починить импорты в research/dev-server/ после переноса из src/.

═══════════ ЧТО ПРОИЗОШЛО ═══════════

dev-сервер и его 13 модулей лежали в `src/` рядом с продакшн-кодом.
Теперь они в `research/dev-server/`, то есть на два уровня глубже.

Импорты вида `./x.js` (соседний файл, тоже перенесённый) остаются
верными — файлы переехали вместе. А вот импорты модулей, которые
ОСТАЛИСЬ в `src/` (transport.js, eq-hid.js, protocol.js, ...), надо
переписать на `../../src/x.js`.

═══════════ КАК ОТЛИЧИТЬ ═══════════

Просто: если файл с таким именем есть в research/dev-server/ —
значит он переехал вместе, `./` верен. Если его там нет, но есть в
src/ — путь надо удлинить.

Проверяет синтаксис каждого изменённого файла ДО записи.

Запуск: python src/tools/fix-devserver-imports.py [--dry]
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEV = ROOT / "research" / "dev-server"
SRC = ROOT / "src"

# `from './x.js'` или `from '../tools/x.js'` — только относительные.
REL_IMPORT = re.compile(r"""(from\s+['"])\./([^'"]+)(['"])""")


def main() -> int:
    dry = "--dry" in sys.argv
    changed_total = 0

    for path in sorted(DEV.glob("*.js")):
        text = path.read_text(encoding="utf-8")
        original = text
        fixes: list[str] = []

        def repl(m: re.Match[str]) -> str:
            prefix, rel, suffix = m.group(1), m.group(2), m.group(3)
            # Уже указывает на src? Не трогаем.
            if rel.startswith("../src/"):
                return m.group(0)

            target_name = rel.split("/")[-1]
            # Файл переехал вместе с нами — оставляем как есть.
            if (DEV / target_name).exists():
                return m.group(0)
            # Файл остался в src/ — удлиняем путь.
            if (SRC / target_name).exists():
                fixes.append(f"{rel} -> ../../src/{rel}")
                return f"{prefix}../../src/{rel}{suffix}"
            return m.group(0)

        text = REL_IMPORT.sub(repl, text)

        if text == original:
            continue

        print(f"\n{path.name}:")
        for f in fixes:
            print(f"  {f}")

        if dry:
            continue

        # Проверяем синтаксис до записи.
        tmp = DEV / f"{path.stem}.check.mjs"
        tmp.write_text(text, encoding="utf-8")
        r = subprocess.run(
            ["node", "--check", str(tmp)],
            capture_output=True, text=True, timeout=30,
        )
        tmp.unlink(missing_ok=True)

        if r.returncode != 0:
            print(f"  ОШИБКА синтаксиса — {path.name} не записан")
            print((r.stderr or "").strip()[:300])
            return 1

        path.write_text(text, encoding="utf-8")
        changed_total += 1

    print(f"\nизменено файлов: {changed_total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
