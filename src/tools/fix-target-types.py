r"""ТИПИЗИРОВАННЫЙ ДОСТУП К e.target В app.js.

═══════════ ПРОБЛЕМА ═══════════

В DOM тип `Event.target` — это `EventTarget | null`, у которого НЕТ
свойства `.value`. Реальный тип известен только по контексту: если
слушатель повешен на `<input type=range>`, то target — всегда
`HTMLInputElement`.

Из-за этого TS выдавал ~33 замечания TS2339 вида
«Property 'value' does not exist on type 'EventTarget'» — по одному на
каждое обращение.

═══════════ РЕШЕНИЕ ═══════════

Два хелпера с приведением типа — и все обращения становятся явными:

    inputOf(e).value      — для input/textarea
    selectOf(e).value     — для select (там ещё нужны options)

Это НЕ подавление ошибки: тип действительно такой, потому что
слушатель навешен на конкретный элемент. Если когда-нибудь слушатель
переедет на другой элемент, приведение станет ложью — но это видно
по коду рядом (`$input('x').addEventListener`), а не спрятано.

Заменяет:
  e.target.value                          -> inputOf(e).value
  e.target.options[e.target.selectedIndex] -> selectOf(e).options[...]

Проверяет синтаксис ДО записи.
Запуск: python src/tools/fix-target-types.py [--dry]
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP = ROOT / "web" / "app.js"

HELPERS = '''
/**
 * Привести `Event.target` к полю ввода.
 *
 * Тип `Event.target` в DOM — `EventTarget | null`, а `.value` есть только
 * у `HTMLInputElement`. Приведение безопасно там, где слушатель навешен
 * на `<input>`: `$input('id').addEventListener(...)`.
 *
 * @param {Event} e
 * @returns {HTMLInputElement}
 */
const inputOf = (e) => /** @type {HTMLInputElement} */ (e.target);

/**
 * Привести `Event.target` к выпадающему списку.
 *
 * Нужен там, где читается не только `.value`, но и `.options` /
 * `.selectedIndex` — например, чтобы показать в логе текст выбранного
 * пункта, а не его код.
 *
 * @param {Event} e
 * @returns {HTMLSelectElement}
 */
const selectOf = (e) => /** @type {HTMLSelectElement} */ (e.target);
'''

ANCHOR = "const logEl = $('log');"


def main() -> int:
    dry = "--dry" in sys.argv
    text = APP.read_text(encoding="utf-8")
    original = text

    # 1) Хелперы — один раз, перед первым использованием.
    if "const inputOf = (e)" not in text:
        if ANCHOR not in text:
            print(f"ОШИБКА: не найден якорь {ANCHOR!r}")
            return 1
        text = text.replace(ANCHOR, HELPERS.strip() + "\n\n" + ANCHOR, 1)
        print("добавлены хелперы inputOf/selectOf")

    # 2) select — сначала, потому что внутри строки тоже есть `.target`.
    sel_old = "e.target.options[e.target.selectedIndex]"
    sel_new = "selectOf(e).options[selectOf(e).selectedIndex]"
    n_sel = text.count(sel_old)
    if n_sel:
        text = text.replace(sel_old, sel_new)
        print(f"select: заменено {n_sel}")

    # 3) input — все остальные `.target.value`.
    n_in = len(re.findall(r"e\.target\.value\b", text))
    if n_in:
        text = re.sub(r"e\.target\.value\b", "inputOf(e).value", text)
        print(f"input: заменено {n_in}")

    if text == original:
        print("нечего менять")
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
