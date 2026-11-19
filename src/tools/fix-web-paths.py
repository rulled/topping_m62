r"""Обновить пути страницы после переноса из web/ в корень.

═══════════ ЧТО ПРОИЗОШЛО ═══════════

`web/index.html`, `web/app.js`, `web/scenes.js`, `web/mixer-state.js`
переехали в корень репозитория. Это обязательно для GitHub Pages:
он ищет index.html в корне и не умеет алиасов.

═══════════ ЧТО ПРАВИТСЯ, А ЧТО НЕТ ═══════════

Правится только РАБОЧИЙ код и пути файлов:
   'web/index.html'  -> 'index.html'
   '../../web/scenes.js' -> '../../scenes.js'
   eslint src/ web/  -> eslint src/ *.js

НЕ правится историческое в текстах: фразы вида «раньше лежало в
web/» — это объяснение, зачем переехали. Стирать их значило бы
потерять причину решения.

Запуск: python src/tools/fix-web-paths.py [--dry]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# Файл -> список замен (точные подстроки, в порядке применения).
FILES: dict[str, list[tuple[str, str]]] = {
    "jsconfig.json": [
        ('"web/app.js"', '"app.js"'),
        ('"web/mixer-state.js"', '"mixer-state.js"'),
        ('"web/scenes.js"', '"scenes.js"'),
    ],
    "eslint.config.mjs": [
        ("'web/**/*.js'", "'*.js'"),
    ],
    "package.json": [
        ('"lint": "eslint src/ web/"', '"lint": "eslint src/ *.js"'),
        ('"lint:fix": "eslint src/ web/ --fix"', '"lint:fix": "eslint src/ *.js --fix"'),
    ],
    "src/tools/audit-production-graph.js": [
        ("const BROWSER_ENTRIES = ['web/app.js'];", "const BROWSER_ENTRIES = ['app.js'];"),
        ("*   browser — от web/app.js (то, что грузит браузер)",
         "*   browser — от app.js (то, что грузит браузер)"),
        ("* А вот всё, что достижимо из `web/app.js`, браузер обязан получить",
         "* А вот всё, что достижимо из `app.js`, браузер обязан получить"),
    ],
    "src/tools/check-page-script.js": [
        ("const PAGE = 'web/index.html';", "const PAGE = 'index.html';"),
        ("const APP = 'web/app.js';", "const APP = 'app.js';"),
    ],
    "src/tools/test-static-performance.js": [
        ("readFileSync('web/index.html')", "readFileSync('index.html')"),
    ],
    "src/tools/test-scenes.js": [
        ("from '../../web/mixer-state.js';", "from '../../mixer-state.js';"),
        ("from '../../web/scenes.js';", "from '../../scenes.js';"),
    ],
    "src/tools/test-subdirectory-hosting.js": [
        ("readFileSync('web/index.html', 'utf8')", "readFileSync('index.html', 'utf8')"),
        ("readFileSync('web/app.js', 'utf8')", "readFileSync('app.js', 'utf8')"),
    ],
    "src/tools/check-deploy-readiness.js": [
        ("'web/index.html',", "'index.html',"),
        ("'web/app.js',", "'app.js',"),
        ("'web/mixer-state.js',", "'mixer-state.js',"),
        ("'web/scenes.js',", "'scenes.js',"),
        ("await get(port, '/web/app.js')", "await get(port, '/app.js')"),
    ],
}


def main() -> int:
    dry = "--dry" in sys.argv
    total = 0

    for rel, pairs in FILES.items():
        path = ROOT / rel
        if not path.exists():
            print(f"нет файла: {rel}")
            continue

        text = path.read_text(encoding="utf-8")
        original = text

        for old, new in pairs:
            if old in text:
                text = text.replace(old, new)
            else:
                print(f"  {rel}: НЕ НАЙДЕНО -> {old[:55]}")

        if text == original:
            continue

        if dry:
            print(f"{rel}: было бы изменено")
            continue

        # Для js-файлов проверяем синтаксис до записи.
        if rel.endswith((".js", ".mjs")):
            tmp = ROOT / (path.stem + ".check.mjs")
            tmp.write_text(text, encoding="utf-8")
            r = subprocess.run(["node", "--check", str(tmp)], capture_output=True, text=True)
            tmp.unlink(missing_ok=True)
            if r.returncode != 0:
                print(f"ОШИБКА синтаксиса в {rel} — не записан")
                print((r.stderr or "").strip()[:300])
                return 1

        path.write_text(text, encoding="utf-8")
        print(f"{rel}: обновлён")
        total += 1

    print(f"\nобновлено файлов: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
