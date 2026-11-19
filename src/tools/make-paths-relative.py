r"""ПЕРЕВЕСТИ ИМПОРТЫ НА ОТНОСИТЕЛЬНЫЕ ПУТИ (исправленная версия).

═══════════ ЗАЧЕМ ═══════════

Сейчас используются абсолютные пути:

    import { X } from '/src/x.js';
    <script type="module" src="/web/app.js"></script>

Это работает только в КОРНЕ домена. GitHub Pages размещает сайт в
подкаталоге (`user.github.io/repo/`), и `/src/x.js` даёт 404.
А GitHub Pages — самый простой бесплатный хостинг с HTTPS, а HTTPS
для WebHID обязателен.

Относительные пути работают и в корне, и в подкаталоге.

═══════════ ОШИБКА ПЕРВОЙ ВЕРСИИ ═══════════

Первая версия заменяла `'/src/x.js'` на `'..' + spec`, то есть
`'../src/x.js'` — но ЗАКРЫВАЮЩАЯ кавычка терялась, потому что она
не входила в capture group. Результат:

    from '../src/transport-core.js;     <- нет закрывающей кавычки

Файлы пришлось откатить из git.

═══════════ ЧТО ДЕЛАЕТ ЭТА ВЕРСИЯ ═══════════

Заменяет ПОЛНЫЙ литерал вместе с кавычками: `'/src/x.js'` ->
`'../src/x.js'`. И проверяет результат через `node --check` ПЕРЕД
записью — если синтаксис сломан, ничего не пишем.

Запуск: python src/tools/make-paths-relative.py [--dry]
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
HTML = ROOT / "web" / "index.html"
APP = ROOT / "web" / "app.js"


def convert_imports(text: str) -> tuple[str, int]:
    """'/src/x.js' -> '../src/x.js', '/web/x.js' -> './x.js'.

    Заменяется ВЕСЬ литерал с кавычками, поэтому кавычки не теряются.
    """
    n = 0

    def repl(m: re.Match) -> str:
        nonlocal n
        quote = m.group(1)
        spec = m.group(2)
        n += 1
        if spec.startswith("/src/"):
            new = f"..{spec}"
        elif spec.startswith("/web/"):
            new = f".{spec[4:]}"
        else:
            return m.group(0)
        return f"{quote}{new}{quote}"

    # Только в строках импорта: from '<путь>' или from "<путь>"
    out = re.sub(
        r"(?<=from\s)(['\"])(\/(?:src|web)\/[^'\"]+)\1",
        lambda m: repl(m),
        text,
    )
    return out, n


def convert_html(text: str) -> tuple[str, int]:
    """src="/web/app.js" -> src="./app.js" """
    new, n = re.subn(r'src="/web/app\.js"', 'src="./app.js"', text)
    return new, n


def check_syntax(path: Path) -> tuple[bool, str]:
    """Проверить синтаксис JS-модуля через node --check."""
    r = subprocess.run(
        ["node", "--check", str(path)],
        capture_output=True, text=True, timeout=30,
    )
    return r.returncode == 0, (r.stderr or "").strip()[:300]


def main() -> int:
    dry = "--dry" in sys.argv

    if not HTML.exists() or not APP.exists():
        print("нет web/index.html или web/app.js")
        return 1

    html = HTML.read_text(encoding="utf-8")
    app = APP.read_text(encoding="utf-8")

    new_html, n_html = convert_html(html)
    new_app, n_app = convert_imports(app)

    print(f"путей в index.html: {n_html}")
    print(f"путей в app.js:     {n_app}")

    if n_html == 0 and n_app == 0:
        print("\nнечего менять — пути уже относительные")
        return 0

    if dry:
        print("\n[dry] изменения не записаны")
        return 0

    # Пишем во временный файл и проверяем синтаксис ДО записи.
    tmp = APP.with_name("app.check.mjs")
    tmp.write_text(new_app, encoding="utf-8")
    good, err = check_syntax(tmp)
    if not good:
        tmp.unlink(missing_ok=True)
        print("\nОШИБКА: после конвертации сломан синтаксис — ничего не записано")
        print(err)
        return 1
    tmp.unlink(missing_ok=True)

    APP.write_text(new_app, encoding="utf-8")
    HTML.write_text(new_html, encoding="utf-8")
    print("\nфайлы обновлены, синтаксис проверен")

    # Проверяем, что все относительные импорты резолвятся.
    problems = []
    for m in re.finditer(r"from\s+'(\.[^']+)'", new_app):
        spec = m.group(1)
        target = (APP.parent / spec).resolve()
        if not target.exists():
            problems.append(f"{spec} -> {target}")

    if problems:
        print("\nОШИБКИ: пути не резолвятся:")
        for p in problems:
            print(f"  {p}")
        return 1

    print("все относительные пути ведут к существующим файлам")
    return 0


if __name__ == "__main__":
    sys.exit(main())
