r"""ИСПРАВИТЬ ССЫЛКИ НА СКРИПТЫ, УЕХАВШИЕ В АРХИВ.

═══════════ ЗАЧЕМ ═══════════

После ревизии 492 скрипта переехали в `research/archive/tools/`, но
документы продолжают ссылаться на `src/tools/<файл>`. Читатель идёт
по ссылке и не находит ничего.

═══════════ ЧТО ДЕЛАЕТ ═══════════

1. Собирает список файлов в архиве.
2. В документах находит упоминания `src/tools/<файл>`.
3. Если файл есть в архиве — заменяет путь на
   `research/archive/tools/<файл>`.
4. Если файла нет нигде — оставляет и сообщает (значит скрипт удалён
   совсем, ссылку надо убрать руками).

Запуск: python src/tools/fix-doc-links.py [--dry]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
ARCHIVE = ROOT / "research" / "archive" / "tools"


def main() -> int:
    dry = "--dry" in sys.argv

    if not ARCHIVE.exists():
        print(f"нет каталога архива: {ARCHIVE}")
        return 1

    # Что лежит в архиве
    archived = {p.name: p for p in ARCHIVE.rglob("*") if p.is_file()}
    print(f"файлов в архиве: {len(archived)}")

    # Что лежит в src/tools — эти ссылки КОРРЕКТНЫ, их не трогаем.
    #
    # ВАЖНО: первая версия этого скрипта проверяла только архив и
    # поэтому объявила «отсутствующими» 51 ссылку на файлы, которые
    # прекрасно лежат в src/tools. Ошибка была в проверке, а не в
    # документации.
    active = {p.name for p in (ROOT / "src" / "tools").iterdir() if p.is_file()}
    print(f"файлов в src/tools: {len(active)}")

    # Какие документы проверяем
    docs = []
    for d in (ROOT / "docs", ROOT / "research", ROOT):
        for p in d.glob("*.md"):
            if "archive" not in str(p):
                docs.append(p)
    docs = sorted(set(docs))
    print(f"документов: {len(docs)}\n")

    pattern = re.compile(r"src/tools/([A-Za-z0-9_.-]+\.(?:js|py|ps1))")

    changed_files = 0
    replaced_total = 0
    still_missing = []

    for doc in docs:
        text = doc.read_text(encoding="utf-8")
        original = text

        def repl(m: re.Match) -> str:
            name = m.group(1)
            # Файл на месте — ссылка верна, не трогаем.
            if name in active:
                return m.group(0)
            # Файл в архиве — перенаправляем.
            if name in archived:
                return f"research/archive/tools/{name}"
            return m.group(0)

        for m in pattern.finditer(text):
            name = m.group(1)
            if name in active:
                continue
            if name in archived:
                replaced_total += 1
            else:
                still_missing.append(f"{doc.relative_to(ROOT)}: {m.group(0)}")

        text = pattern.sub(repl, text)

        if text != original:
            changed_files += 1
            rel = doc.relative_to(ROOT)
            if dry:
                print(f"[dry] {rel}")
            else:
                doc.write_text(text, encoding="utf-8")
                print(f"обновлён {rel}")

    print(f"\nзаменено ссылок: {replaced_total}")
    print(f"обновлено документов: {changed_files}")

    if still_missing:
        unique = sorted(set(still_missing))
        print(f"\nссылки на скрипты, которых нет нигде ({len(unique)}):")
        for s in unique[:20]:
            print(f"  {s}")
        if len(unique) > 20:
            print(f"  ... ещё {len(unique) - 20}")
        print("\nэти ссылки надо убрать руками: скрипт удалён совсем")

    return 0


if __name__ == "__main__":
    sys.exit(main())
