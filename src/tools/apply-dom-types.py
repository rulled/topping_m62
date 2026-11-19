r"""ПРИМЕНИТЬ ТИПИЗИРОВАННЫЕ ХЕЛПЕРЫ В app.js.

═══════════ ЗАЧЕМ ═══════════

TypeScript нашёл 92 замечания в `app.js`:
  • `.value` на `HTMLElement` — у него нет этого свойства;
  • `.disabled` на `HTMLElement` / `Element`;
  • `textContent = число` — принимает только строку.

Это не ложные срабатывания: если id в разметке перепутать, код
упадёт в браузере с `Cannot read properties of null`.

Добавлены хелперы `$input`, `$select`, `$button`, `setText`. Этот
скрипт применяет их по местам использования.

═══════════ КАК РАБОТАЕТ ═══════════

Заменяет ТОЛЬКО очевидные случаи по контексту:
  • `$('id').value`        -> `$input('id').value`
  • `$('id').checked`      -> `$input('id').checked`
  • `$('id').selectedIndex`-> `$select('id').selectedIndex`
  • `$('id').options`      -> `$select('id').options`
  • `$('id').disabled`     -> `$button('id').disabled` (если кнопка)
                            -> `$input('id').disabled`  (если поле)

Проверяет синтаксис через `node --check` ДО записи — если сломалось,
ничего не пишется.

Запуск: python src/tools/apply-dom-types.py [--dry]
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP = ROOT / "web" / "app.js"
HTML = ROOT / "web" / "index.html"


def build_id_kinds(html: str) -> dict[str, str]:
    """Определить по разметке, какой тип у каждого id.

    Возвращает {id: 'input' | 'select' | 'button' | 'other'}.

    Это надёжнее, чем угадывать по имени переменной: разметка — это
    фактический источник правды о том, какой там элемент.
    """
    kinds: dict[str, str] = {}

    # <input ... id="xxx">
    for m in re.finditer(r"<input\b[^>]*\bid=\"([^\"]+)\"", html):
        kinds[m.group(1)] = "input"
    # id может стоять до типа
    for m in re.finditer(r"<input\b[^>]*>", html):
        tag = m.group(0)
        idm = re.search(r'\bid="([^"]+)"', tag)
        if idm:
            kinds[idm.group(1)] = "input"

    for m in re.finditer(r"<select\b[^>]*>", html):
        idm = re.search(r'\bid="([^"]+)"', m.group(0))
        if idm:
            kinds[idm.group(1)] = "select"

    for m in re.finditer(r"<button\b[^>]*>", html):
        idm = re.search(r'\bid="([^"]+)"', m.group(0))
        if idm:
            kinds[idm.group(1)] = "button"

    return kinds


def main() -> int:
    dry = "--dry" in sys.argv

    app = APP.read_text(encoding="utf-8")
    html = HTML.read_text(encoding="utf-8")
    kinds = build_id_kinds(html)

    print(f"элементов в разметке: {len(kinds)}")
    print(f"  input:  {sum(1 for k in kinds.values() if k == 'input')}")
    print(f"  select: {sum(1 for k in kinds.values() if k == 'select')}")
    print(f"  button: {sum(1 for k in kinds.values() if k == 'button')}")

    original = app
    counts = {"input": 0, "select": 0, "button": 0, "setText": 0}

    # ─── $('id').value -> $input('id').value ───
    def repl_value(m: re.Match) -> str:
        q, ident = m.group(1), m.group(2)
        if kinds.get(ident) != "input":
            return m.group(0)
        counts["input"] += 1
        return f"$input({q}{ident}{q}).value"

    app = re.sub(r"\$\((['\"])([A-Za-z][\w-]*)\1\)\.value", repl_value, app)

    # ─── $('id').checked / .selectedIndex / .options ───
    def repl_checked(m: re.Match) -> str:
        q, ident = m.group(1), m.group(2)
        if kinds.get(ident) != "input":
            return m.group(0)
        counts["input"] += 1
        return f"$input({q}{ident}{q}).checked"

    app = re.sub(r"\$\((['\"])([A-Za-z][\w-]*)\1\)\.checked", repl_checked, app)

    def repl_select(m: re.Match) -> str:
        q, ident, prop = m.group(1), m.group(2), m.group(3)
        if kinds.get(ident) != "select":
            return m.group(0)
        counts["select"] += 1
        return f"$select({q}{ident}{q}).{prop}"

    app = re.sub(
        r"\$\((['\"])([A-Za-z][\w-]*)\1\)\.(selectedIndex|options)",
        repl_select, app,
    )

    # ─── $('id').disabled ───
    def repl_disabled(m: re.Match) -> str:
        q, ident = m.group(1), m.group(2)
        kind = kinds.get(ident)
        if kind == "input":
            counts["input"] += 1
            return f"$input({q}{ident}{q}).disabled"
        if kind == "button":
            counts["button"] += 1
            return f"$button({q}{ident}{q}).disabled"
        if kind == "select":
            counts["select"] += 1
            return f"$select({q}{ident}{q}).disabled"
        return m.group(0)

    app = re.sub(r"\$\((['\"])([A-Za-z][\w-]*)\1\)\.disabled", repl_disabled, app)

    # ─── textContent = <не строка> -> setText ───
    #
    # Заменяем только случаи, где справа явно не строка:
    # число, шаблон с выражением, вызов функции.
    def repl_text(m: re.Match) -> str:
        q, ident, value = m.group(1), m.group(2), m.group(3)
        counts["setText"] += 1
        return f"setText({q}{ident}{q}, {value})"

    app = re.sub(
        r"\$\((['\"])([A-Za-z][\w-]*)\1\)\.textContent = "
        r"((?:[0-9]+|[A-Za-z_$][\w$.]*(?:\([^;]*?\))?(?:\.\w+|\([^;]*?\))*));",
        repl_text, app,
    )

    changed = app != original
    total = sum(counts.values())
    print(f"\nзаменено: {total}")
    for k, v in counts.items():
        if v:
            print(f"  {k}: {v}")

    if not changed:
        print("\nнечего менять")
        return 0

    if dry:
        print("\n[dry] не записано")
        return 0

    # Проверяем синтаксис ДО записи.
    tmp = ROOT / "web" / "app.check.mjs"
    tmp.write_text(app, encoding="utf-8")
    r = subprocess.run(
        ["node", "--check", str(tmp)],
        capture_output=True, text=True, timeout=30,
    )
    tmp.unlink(missing_ok=True)

    if r.returncode != 0:
        print("\nОШИБКА: после замен сломан синтаксис — ничего не записано")
        print((r.stderr or "").strip()[:400])
        return 1

    APP.write_text(app, encoding="utf-8")
    print("\nзаписано, синтаксис проверен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
