r"""ТИПЫ ДЛЯ МАССИВОВ-ТАБЛИЦ И DOM-СПИСКОВ В app.js.

═══════════ ПОЧЕМУ ТАК ═══════════

В файле есть «таблицы» вида

    const gains = [[0x21, 'gIn1', 'mic'], ...];
    for (const [tt, id, curve] of gains) { ... }

Без аннотации TS выводит тип элемента как `(string | number)[]`.
При деструктуризации `tt` и `id` получают `string | number`, и дальше:

  * `$input(id)` — ругается, что нужен `string`;
  * `formatGain(v, curve)` — curve тоже `string | number`;
  * `tt.toString(16)` работает, но `send({ target: tt })` уже нет.

Достаточно поставить `@type` на массив — TS начнёт выводить
кортежи поэлементно, и все эти ошибки исчезнут разом, без
приведения типов в каждом месте использования.

Заодно:
  * `enableControls()` — `querySelectorAll` возвращает `Element`,
    у которого нет `.disabled`; приводим к `HTMLElement`.
  * `ch` в цикле 48V сужается до `'IN1' | 'IN2'` (так требует
    `buildPhantomFrames`).

Запуск: python src/tools/annotate-app-arrays.py [--dry]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP = ROOT / "web" / "app.js"

# (искать, заменить) — пары точные, по одной строке.
REPLACEMENTS: list[tuple[str, str]] = [
    # 1) таблица усилений в render()
    (
        """  const gains = [
    [0x21, 'gIn1', 'mic'], [0x22, 'gIn2', 'mic'],
    [0x23, 'gAux', 'out9'], [0x25, 'gBt', 'out0'], [0x27, 'gOtg', 'out0'],
  ];""",
        """  /** @type {Array<[number, string, string]>} */
  const gains = [
    [0x21, 'gIn1', 'mic'], [0x22, 'gIn2', 'mic'],
    [0x23, 'gAux', 'out9'], [0x25, 'gBt', 'out0'], [0x27, 'gOtg', 'out0'],
  ];""",
    ),
    # 2) таблица усилений в обработчиках
    (
        """const gainMap = [
  ['gIn1', 0x21, 'mic'], ['gIn2', 0x22, 'mic'],
  ['gAux', 0x23, 'out9'], ['gBt', 0x25, 'out0'], ['gOtg', 0x27, 'out0'],
];""",
        """/** @type {Array<[string, number, string]>} */
const gainMap = [
  ['gIn1', 0x21, 'mic'], ['gIn2', 0x22, 'mic'],
  ['gAux', 0x23, 'out9'], ['gBt', 0x25, 'out0'], ['gOtg', 0x27, 'out0'],
];""",
    ),
    # 3) 48V: ch должен быть 'IN1' | 'IN2'
    (
        """for (const [id, ch] of [['p48v1', 'IN1'], ['p48v2', 'IN2']]) {""",
        """/** @type {Array<[string, 'IN1' | 'IN2']>} */
for (const [id, ch] of [['p48v1', 'IN1'], ['p48v2', 'IN2']]) {""",
    ),
    # 4) параметры реверба
    (
        """for (const [k, id] of [['dryWet', 'rvWet'], ['room', 'rvRoom'], ['decay', 'rvDecay'], ['width', 'rvWidth']]) {""",
        """/** @type {Array<[string, string]>} */
  for (const [k, id] of [['dryWet', 'rvWet'], ['room', 'rvRoom'], ['decay', 'rvDecay'], ['width', 'rvWidth']]) {""",
    ),
    # 5) параметры компрессора (render)
    (
        """    const map = [['threshold', 'cpThr'], ['ratio', 'cpRatio'], ['attack', 'cpAtk'], ['release', 'cpRel'], ['mix', 'cpMix']];""",
        """    /** @type {Array<[string, string]>} */
    const map = [['threshold', 'cpThr'], ['ratio', 'cpRatio'], ['attack', 'cpAtk'], ['release', 'cpRel'], ['mix', 'cpMix']];""",
    ),
    # 6) параметры реверба (обработчики)
    (
        """for (const [id, field, scale] of [['rvWet', 'dryWet', 1], ['rvRoom', 'room', 1], ['rvDecay', 'decay', 1], ['rvWidth', 'width', 100]]) {""",
        """/** @type {Array<[string, string, number]>} */
for (const [id, field, scale] of [['rvWet', 'dryWet', 1], ['rvRoom', 'room', 1], ['rvDecay', 'decay', 1], ['rvWidth', 'width', 100]]) {""",
    ),
    # 7) параметры компрессора (обработчики)
    (
        """for (const [id, field] of [['cpThr', 'threshold'], ['cpRatio', 'ratio'], ['cpAtk', 'attack'], ['cpRel', 'release'], ['cpMix', 'mix']]) {""",
        """/** @type {Array<[string, string]>} */
for (const [id, field] of [['cpThr', 'threshold'], ['cpRatio', 'ratio'], ['cpAtk', 'attack'], ['cpRel', 'release'], ['cpMix', 'mix']]) {""",
    ),
    # 8) enableControls: Element -> HTMLElement (у Element нет .disabled)
    (
        """  document.querySelectorAll('input[type=range], select, .card button').forEach((el) => {
    if (el.id === 'btnConnect' || el.id === 'btnDisconnect') return;
    el.disabled = !on;
  });""",
        """  document.querySelectorAll('input[type=range], select, .card button').forEach((node) => {
    const el = /** @type {HTMLElement} */ (node);
    if (el.id === 'btnConnect' || el.id === 'btnDisconnect') return;
    el.disabled = !on;
  });""",
    ),
]


def main() -> int:
    dry = "--dry" in sys.argv
    text = APP.read_text(encoding="utf-8")
    original = text
    applied = 0

    for old, new in REPLACEMENTS:
        if old in text:
            text = text.replace(old, new, 1)
            applied += 1
            print(f"ок: {old.splitlines()[0].strip()[:60]}")
        else:
            print(f"НЕ НАЙДЕНО: {old.splitlines()[0].strip()[:60]}")

    print(f"\nприменено {applied}/{len(REPLACEMENTS)}")

    if text == original:
        return 0
    if dry:
        print("[dry] не записано")
        return 0

    tmp = ROOT / "web" / "app.check.mjs"
    tmp.write_text(text, encoding="utf-8")
    r = subprocess.run(["node", "--check", str(tmp)], capture_output=True, text=True, timeout=30)
    tmp.unlink(missing_ok=True)

    if r.returncode != 0:
        print("\nОШИБКА: синтаксис сломан — ничего не записано")
        print((r.stderr or "").strip()[:400])
        return 1

    APP.write_text(text, encoding="utf-8")
    print("записано")
    return 0


if __name__ == "__main__":
    sys.exit(main())
