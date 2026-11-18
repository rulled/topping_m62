r"""ВЫНОС ВСТРОЕННОГО СКРИПТА СТРАНИЦЫ В ОТДЕЛЬНЫЙ ФАЙЛ.

═══════════ ЗАЧЕМ ═══════════

`web/index.html` содержит встроенный `<script type="module">` на
~40 000 символов — весь клиент целиком.

Это работало на dev-сервере, потому что тот не ставил CSP. На
статик-сервере CSP `script-src 'self'` **блокирует инлайн-скрипты**,
и страница не выполняется вовсе: DOM есть, контролы пустые.

Можно было бы добавить `'unsafe-inline'` в CSP, но это:
  • ослабляет защиту на весь сайт;
  • скрывает проблему, а не решает.

Правильно — вынести скрипт в отдельный файл. Тогда:
  • CSP остаётся строгим;
  • скрипт кэшируется отдельно от HTML;
  • с ним работает линтер (сейчас встроенный код он не видит).

═══════════ ЧТО ДЕЛАЕТ ═══════════

1. Извлекает содержимое `<script type="module">...</script>`.
2. Заменяет его в HTML на `<script type="module" src="/web/app.js"></script>`.
3. Пишет скрипт в `web/app.js`.
4. Добавляет `/web/app.js` в белый список статик-сервера.

Запуск: python src/tools/extract-inline-script.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
HTML = ROOT / "web" / "index.html"
APP = ROOT / "web" / "app.js"
SERVER = ROOT / "src" / "static-server.js"


def main() -> int:
    if not HTML.exists():
        print(f"нет файла: {HTML}")
        return 1

    html = HTML.read_text(encoding="utf-8")

    m = re.search(r'<script type="module">(.*?)</script>', html, re.DOTALL)
    if not m:
        print("встроенный <script type=\"module\"> не найден — возможно, уже вынесен")
        return 0

    script = m.group(1)
    # Убираем общий отступ первой строки, чтобы файл читался нормально
    print(f"извлечён скрипт: {len(script)} символов")

    # Записываем как отдельный модуль
    header = (
        "/**\n"
        " * КЛИЕНТ СТРАНИЦЫ (вынесен из index.html).\n"
        " *\n"
        " * ═══ ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ ═══\n"
        " *\n"
        " * Раньше весь этот код был встроен в <script type=\"module\">\n"
        " * внутри index.html. Это работало на dev-сервере, но на\n"
        " * продакшн-сервере CSP `script-src 'self'` блокирует инлайн-\n"
        " * скрипты, и страница не выполнялась вовсе.\n"
        " *\n"
        " * Вынос даёт ещё два плюса: файл кэшируется отдельно от HTML\n"
        " * и проверяется линтером (встроенный код ESLint не видит).\n"
        " */\n"
    )
    APP.write_text(header + script.lstrip("\n"), encoding="utf-8")
    print(f"записан: {APP.relative_to(ROOT)}")

    # Заменяем в HTML
    new_tag = '<script type="module" src="/web/app.js"></script>'
    html = html[: m.start()] + new_tag + html[m.end():]
    HTML.write_text(html, encoding="utf-8")
    print(f"обновлён: {HTML.relative_to(ROOT)}")

    # Добавляем в белый список сервера
    src = SERVER.read_text(encoding="utf-8")
    if "/web/app.js" not in src:
        marker = "['/web/scenes.js', 'web/scenes.js'],"
        if marker in src:
            src = src.replace(
                marker,
                marker + "\n  ['/web/app.js', 'web/app.js'],",
            )
            SERVER.write_text(src, encoding="utf-8")
            print(f"обновлён: {SERVER.relative_to(ROOT)} (+/web/app.js)")
        else:
            print("ВНИМАНИЕ: не нашёл место для вставки в белый список")
            print("добавьте вручную: ['/web/app.js', 'web/app.js'],")
    else:
        print("в белом списке уже есть /web/app.js")

    return 0


if __name__ == "__main__":
    sys.exit(main())
