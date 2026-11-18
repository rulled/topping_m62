r"""УБРАТЬ BOM ИЗ ФАЙЛОВ ПРОЕКТА.

═══════════ ЗАЧЕМ ═══════════

PowerShell при `Set-Content -Encoding UTF8` в версии 5.1 добавляет
BOM (byte order mark, EF BB BF) в начало файла.

Для JSON это фатально: `JSON.parse` бросает
«Unexpected token 'ï'», и `npm` не может прочитать package.json.

Для JS-модулей BOM технически допустим (спецификация разрешает его
перед директивами), но:
  • некоторые сборщики и линтеры на нём спотыкаются;
  • BOM в файле, который отдаётся браузеру, — лишние 3 байта;
  • невидимый символ в исходнике мешает диффам.

Для HTML BOM безвреден, но лучше не иметь.

═══════════ ЧТО ДЕЛАЕТ ═══════════

Находит все текстовые файлы проекта с BOM и перезаписывает их в
UTF-8 без BOM. Идемпотентно: повторный запуск ничего не меняет.

Запуск: python src/tools/strip-bom.py [--dry]
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# Что проверяем. node_modules и архив не трогаем: там чужой код.
PATTERNS = ("*.json", "*.js", "*.mjs", "*.html", "*.md", "*.cjs")
SKIP_DIRS = {"node_modules", "archive", "external", "_reviews", "firmware", ".git"}

BOM = b"\xef\xbb\xbf"


def should_skip(path: Path) -> bool:
    parts = set(path.relative_to(ROOT).parts)
    return bool(parts & SKIP_DIRS)


def main() -> int:
    dry = "--dry" in sys.argv
    fixed = []
    checked = 0

    for pattern in PATTERNS:
        for path in ROOT.rglob(pattern):
            if not path.is_file() or should_skip(path):
                continue
            checked += 1
            data = path.read_bytes()
            if not data.startswith(BOM):
                continue
            body = data[len(BOM):]
            rel = path.relative_to(ROOT)
            fixed.append(str(rel))
            if dry:
                print(f"[dry] {rel}")
            else:
                path.write_bytes(body)
                print(f"очищен {rel}")

    print(f"\nпроверено файлов: {checked}")
    print(f"с BOM: {len(fixed)}")
    if fixed and not dry:
        print("BOM удалён из всех")
    return 0


if __name__ == "__main__":
    sys.exit(main())
