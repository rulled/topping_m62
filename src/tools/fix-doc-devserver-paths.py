r"""Обновить ссылки на dev-сервер в документации.

═══════════ ЧТО ПРОИЗОШЛО ═══════════

Сервер с API переехал: `src/server.js` -> `research/dev-server/server.js`.
Документация ссылается на старый путь, а он теперь не существует —
читатель пойдёт по ссылке и получит 404.

═══════════ ЧТО НЕ ТРОГАЕТСЯ ═══════════

Упоминания `src/static-server.js` — это продакшн-сервер, он остался
на месте. Подстрока `src/server.js` в нём не встречается, но
проверяю явно, чтобы не испортить.

Проверяет, что файл после замены не пуст и не потерял заголовок.

Запуск: python src/tools/fix-doc-devserver-paths.py [--dry]
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

DOCS = [
    ROOT / "docs" / "API.md",
    ROOT / "docs" / "BACKEND.md",
    ROOT / "docs" / "DEPLOY.md",
    ROOT / "docs" / "WEB-CLIENT.md",
    ROOT / "README.md",
]

# Порядок важен: сначала длинные варианты.
PAIRS: list[tuple[str, str]] = [
    ("node src/server.js", "node research/dev-server/server.js"),
    ("src/server.js", "research/dev-server/server.js"),
]


def main() -> int:
    dry = "--dry" in sys.argv
    total = 0

    for path in DOCS:
        if not path.exists():
            print(f"нет файла: {path.relative_to(ROOT)}")
            continue

        text = path.read_text(encoding="utf-8")
        original = text

        for old, new in PAIRS:
            # Не трогаем static-server.js: заменяем только точное
            # вхождение, которого в нём нет по определению.
            if old in text:
                text = text.replace(old, new)

        if text == original:
            continue

        # Проверка на порчу: файл не должен схлопнуться.
        if len(text) < len(original) * 0.9:
            print(f"ОТКАЗ: {path.name} подозрительно уменьшился "
                  f"({len(original)} -> {len(text)})")
            return 1

        changes = sum(original.count(old) for old, _ in PAIRS)
        print(f"{path.relative_to(ROOT)}: заменено {changes}")

        if not dry:
            path.write_text(text, encoding="utf-8")
        total += changes

    print(f"\nвсего замен: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
