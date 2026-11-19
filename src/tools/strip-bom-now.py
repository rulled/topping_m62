r"""УБРАТЬ BOM ИЗ ФАЙЛОВ.

═══════════ ПОЧЕМУ ЭТО НУЖНО ═══════════

PowerShell 5.1 `Set-Content -Encoding UTF8` пишет файл С BOM
(EF BB BF). Для JS это ломает не всё, но:

  * `package.json` с BOM npm не читает («Unexpected token»);
  * шебанг `#!` перестаёт быть первым — скрипт не запускается;
  * в git первый байт показывается как мусор, diff шумит.

В проекте уже была эта проблема (16 файлов), поэтому в CI есть
проверка на BOM. Здесь — точечная чистка после правки через
PowerShell.

Python пишет UTF-8 без BOM по умолчанию, поэтому чистим им.

Запуск: python src/tools/strip-bom-now.py <файл> [<файл>...]
       python src/tools/strip-bom-now.py --all
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
BOM = b"\xef\xbb\xbf"

# Каталоги, которые не трогаем.
SKIP = {"node_modules", ".git", "archive", "external", "_reviews"}
EXTS = {".js", ".mjs", ".json", ".html", ".md", ".css", ".yml", ".yaml"}


def strip_file(path: Path) -> bool:
    """Убрать BOM, если он есть. Вернуть True, если файл изменён."""
    try:
        data = path.read_bytes()
    except OSError as e:
        print(f"  не читается: {path} ({e})")
        return False
    if not data.startswith(BOM):
        return False
    path.write_bytes(data[len(BOM):])
    print(f"  BOM убран: {path.relative_to(ROOT)}")
    return True


def main() -> int:
    args = sys.argv[1:]

    if not args:
        print("нужны файлы или --all")
        return 2

    if args == ["--all"]:
        changed = 0
        for path in ROOT.rglob("*"):
            if not path.is_file():
                continue
            if set(path.parts) & SKIP:
                continue
            if path.suffix not in EXTS:
                continue
            if strip_file(path):
                changed += 1
        print(f"\nвсего убрано BOM: {changed}")
        return 0

    changed = 0
    for raw in args:
        path = Path(raw)
        if not path.is_absolute():
            path = ROOT / path
        if not path.exists():
            print(f"  нет файла: {raw}")
            continue
        if strip_file(path):
            changed += 1

    print(f"\nубрано BOM: {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
