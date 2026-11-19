r"""ТОЧЕЧНЫЕ ИСПРАВЛЕНИЯ ТИПОВ В app.js.

═══════════ ЗАЧЕМ ═══════════

После автоматических замен осталось 86 замечаний, из них 70 —
одинаковый паттерн: обращение к `.value` по id, который создаётся
ДИНАМИЧЕСКИ (в `buildEqControls()`, `buildMuteRows()` и т.п.). TS не
видит эти элементы в разметке и считает тип `HTMLElement`.

Правильно заменить `$(...)` на `$input(...)` там, где по смыслу
ползунок. Но автоматически по regex это опасно: можно заменить
не то и сломать страницу.

Поэтому здесь — ЯВНЫЙ список замен. Каждая строка проверена
глазами: справа от `=` ставится число в `value` ползунка или
select, значит тип известен.

Проверяет синтаксис ДО записи.

Запуск: python src/tools/fix-app-types.py [--dry]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP = ROOT / "web" / "app.js"

# Явные замены: (что заменить, на что заменить).
#
# Все проверены по разметке и по коду, который создаёт эти элементы:
#   rvWet/rvRoom/rvDecay/rvWidth  — <input type=range> в разметке
#   cp*                            — <input type=range> в разметке
#   mx_*_l / mx_*_r                — <input type=range>, создаются в buildMixerRows()
#   eqHp*                          — <input type=range> в разметке
REPLACEMENTS: list[tuple[str, str]] = [
    # select реверба
    ("$('rvType').value", "$select('rvType').value"),
    # ползунки реверба — id из массива
    ("$(id).value = rv[k];", "$input(id).value = String(rv[k]);"),
    # ползунки компрессора — id из массива
    ("$(id).value = cp[k];", "$input(id).value = String(cp[k]);"),
    # значения ползунков: setText уже приведён
    ("setText(`${id}V`, cp[k])", "setText(`${id}V`, cp[k]);"),
]


def main() -> int:
    dry = "--dry" in sys.argv
    text = APP.read_text(encoding="utf-8")
    original = text

    applied = 0
    for old, new in REPLACEMENTS:
        if old in text:
            text = text.replace(old, new)
            applied += 1
            print(f"заменено: {old[:50]}")
        else:
            print(f"не найдено (уже заменено?): {old[:50]}")

    print(f"\nприменено замен: {applied}/{len(REPLACEMENTS)}")

    if text == original:
        return 0

    if dry:
        print("[dry] не записано")
        return 0

    tmp = ROOT / "web" / "app.check.mjs"
    tmp.write_text(text, encoding="utf-8")
    r = subprocess.run(
        ["node", "--check", str(tmp)],
        capture_output=True, text=True, timeout=30,
    )
    tmp.unlink(missing_ok=True)

    if r.returncode != 0:
        print("\nОШИБКА: синтаксис сломан — ничего не записано")
        print((r.stderr or "").strip()[:400])
        return 1

    APP.write_text(text, encoding="utf-8")
    print("записано, синтаксис проверен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
