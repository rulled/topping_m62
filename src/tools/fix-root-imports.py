r"""Починить импорты и пути после переноса страницы в корень.

═══════════ ЧТО ПРОИСХОДИТ ═══════════

`web/app.js` лежал в подкаталоге, поэтому до модулей было
`../src/x.js`, а до соседей — `./mixer-state.js`.

Теперь `app.js` в КОРНЕ репозитория:
  * до `src/` — один уровень, значит `./src/x.js`;
  * соседние модули (`mixer-state.js`, `scenes.js`) тоже в корне,
    значит `./` остаётся верным.

═══════════ ПОЧЕМУ ЭТО НУЖНО ═══════════

GitHub Pages и любой чистый статик-хостинг раздают каталог как есть,
без алиасов. index.html обязан лежать в корне — иначе главная
страница 404. Раз страница в корне, то и пути считаются от корня.

Проверяет синтаксис до записи и то, что после правки каждый импорт
разрешается в существующий файл.

Запуск: python src/tools/fix-root-imports.py [--dry]
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# Файлы, которые переехали в корень.
MOVED = ["app.js", "mixer-state.js", "scenes.js"]

# `from '../src/x.js'` -> `from './src/x.js'`
UP_TO_SRC = re.compile(r"""(from\s+['"])\.\./src/""")


def main() -> int:
    dry = "--dry" in sys.argv
    changed = 0

    for name in MOVED:
        path = ROOT / name
        if not path.exists():
            print(f"нет файла: {name}")
            continue

        text = path.read_text(encoding="utf-8")
        original = text
        text = UP_TO_SRC.sub(r"\1./src/", text)

        if text == original:
            print(f"{name}: без изменений")
            continue

        # Соберём список изменённых импортов для отчёта.
        old_specs = re.findall(r"""from\s+['"](\.\./src/[^'"]+)['"]""", original)
        new_specs = re.findall(r"""from\s+['"](\./src/[^'"]+)['"]""", text)
        print(f"{name}: исправлено импортов {len(old_specs)}")

        if dry:
            continue

        tmp = ROOT / f"{name}.check.mjs"
        tmp.write_text(text, encoding="utf-8")
        r = subprocess.run(["node", "--check", str(tmp)], capture_output=True, text=True)
        tmp.unlink(missing_ok=True)
        if r.returncode != 0:
            print(f"  ОШИБКА синтаксиса — {name} не записан")
            print((r.stderr or "").strip()[:300])
            return 1

        path.write_text(text, encoding="utf-8")
        changed += 1

        # Проверяем, что новые пути разрешаются.
        for spec in new_specs:
            target = (ROOT / spec).resolve()
            if not target.exists():
                print(f"  ВНИМАНИЕ: {spec} не существует")

    print(f"\nизменено файлов: {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
