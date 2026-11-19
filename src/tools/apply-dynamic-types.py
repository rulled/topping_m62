r"""ТИПИЗИРОВАТЬ ДИНАМИЧЕСКИЕ id В app.js.

═══════════ ЗАЧЕМ ═══════════

После первой замены осталось 87 замечаний — все на ДИНАМИЧЕСКИХ id
вида `$(`eq${band}gain`)`. Статически тип такого элемента неизвестен.

Но по СУФФИКСУ id он однозначен, потому что имена строятся по
шаблону в `buildEqControls()`, `buildMixerRows()` и т.п.:

    ...gain, ...freq, ...q     -> ползунок   (HTMLInputElement)
    ...gv, ...fv, ...qv, ...V  -> текст      (HTMLElement.textContent)
    ...type, ..._src           -> select     (HTMLSelectElement)
    ...en                      -> кнопка     (HTMLButtonElement)

═══════════ ЧТО ДЕЛАЕТ ═══════════

Заменяет обращения по суффиксу:
    $(`X`).value        -> $input(`X`).value
    $(`X`).textContent  -> setText(`X`, ...) или $(`X`).textContent
    $(`X`).disabled     -> $button(`X`).disabled

Проверяет синтаксис ДО записи.

Запуск: python src/tools/apply-dynamic-types.py [--dry]
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP = ROOT / "web" / "app.js"

# Суффикс id -> тип элемента. Проверено по buildEqControls(),
# buildMixerRows(), buildMuteRows(), buildLoopbackRows().
INPUT_SUFFIXES = ("gain", "freq", "q", "Vol", "en_gain")
TEXT_SUFFIXES = ("V", "gv", "fv", "qv", "_v")
SELECT_SUFFIXES = ("type", "_src")
BUTTON_SUFFIXES = ("en",)


def choose_helper(template: str, prop: str) -> str | None:
    """Подобрать хелпер по шаблону id и свойству.

    @param template внутренность `...` (например, "eq${band}gain")
    @param prop     какое свойство читается (.value, .textContent, ...)
    """
    # Убираем выражения ${...}, чтобы получить «скелет» имени.
    skeleton = re.sub(r"\$\{[^}]*\}", "", template)

    if prop == "textContent":
        return "setText"

    if prop == "value":
        # Ползунок, если имя кончается на gain/freq/q.
        if skeleton.endswith(INPUT_SUFFIXES):
            return "$input"
        return None

    if prop in ("disabled",):
        if skeleton.endswith(BUTTON_SUFFIXES):
            return "$button"
        if skeleton.endswith(INPUT_SUFFIXES):
            return "$input"
        return None

    if prop in ("selectedIndex", "options", "value"):
        if skeleton.endswith(SELECT_SUFFIXES):
            return "$select"

    return None


def main() -> int:
    dry = "--dry" in sys.argv
    app = APP.read_text(encoding="utf-8")
    original = app
    counts: dict[str, int] = {}

    # ─── .value на динамическом id ───
    def repl_value(m: re.Match) -> str:
        template = m.group(1)
        # Если уже обёрнуто в хелпер — не трогаем.
        before = m.string[max(0, m.start() - 12) : m.start()]
        if before.rstrip().endswith(("$input", "$select", "$button")):
            return m.group(0)
        helper = choose_helper(template, "value")
        if not helper:
            return m.group(0)
        counts[helper] = counts.get(helper, 0) + 1
        return f"{helper}(`{template}`).value"

    app = re.sub(r"\$\(`([^`]+)`\)\.value", repl_value, app)

    # ─── .selectedIndex / .options ───
    def repl_select(m: re.Match) -> str:
        template, prop = m.group(1), m.group(2)
        helper = choose_helper(template, prop)
        if not helper:
            return m.group(0)
        counts[helper] = counts.get(helper, 0) + 1
        return f"{helper}(`{template}`).{prop}"

    app = re.sub(r"\$\(`([^`]+)`\)\.(selectedIndex|options)", repl_select, app)

    # ─── .disabled ───
    def repl_disabled(m: re.Match) -> str:
        template = m.group(1)
        helper = choose_helper(template, "disabled")
        if not helper:
            return m.group(0)
        counts[helper] = counts.get(helper, 0) + 1
        return f"{helper}(`{template}`).disabled"

    app = re.sub(r"\$\(`([^`]+)`\)\.disabled", repl_disabled, app)

    # ─── .textContent = <значение> -> setText ───
    def repl_text(m: re.Match) -> str:
        template = m.group(1)
        value = m.group(2)
        counts["setText"] = counts.get("setText", 0) + 1
        return f"setText(`{template}`, {value})"

    app = re.sub(
        r"\$\(`([^`]+)`\)\.textContent = ([^;\n]+);",
        repl_text, app,
    )

    total = sum(counts.values())
    print(f"заменено: {total}")
    for k, v in sorted(counts.items()):
        print(f"  {k}: {v}")

    if app == original:
        print("\nнечего менять")
        return 0

    if dry:
        print("\n[dry] не записано")
        return 0

    # Синтаксис ДО записи.
    tmp = ROOT / "web" / "app.check.mjs"
    tmp.write_text(app, encoding="utf-8")
    r = subprocess.run(
        ["node", "--check", str(tmp)],
        capture_output=True, text=True, timeout=30,
    )
    tmp.unlink(missing_ok=True)

    if r.returncode != 0:
        print("\nОШИБКА: синтаксис сломан — ничего не записано")
        print((r.stderr or "").strip()[:400])
        return 1

    APP.write_text(app, encoding="utf-8")
    print("\nзаписано, синтаксис проверен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
