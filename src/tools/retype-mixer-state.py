r"""Обновить JSDoc-типы в web/mixer-state.js на MixerMatrix/MixerState.

После введения typedef'ов ссылки вида `{object}` и длинные Record-
выражения заменяются на короткие имена. Проверяет синтаксис до записи.

Запуск: python src/tools/retype-mixer-state.py [--dry]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TARGET = ROOT / "web" / "mixer-state.js"

PAIRS: list[tuple[str, str]] = [
    (
        " * @returns {Record<string, Record<string, {l:number, r:number}>>}\n"
        " */\n"
        "export function emptyMatrix",
        " * @returns {MixerMatrix}\n */\nexport function emptyMatrix",
    ),
    (
        " * @param {object} buses  MIXER_BUSES\n"
        " * @param {object} sources MIXER_SOURCES",
        " * @param {Record<string,string>} buses  MIXER_BUSES\n"
        " * @param {Record<string,string>} sources MIXER_SOURCES",
    ),
    (
        " * @param {Storage} [storage]\n"
        " * @returns {object|null}\n"
        " */\n"
        "export function loadMixerState",
        " * @param {Storage} [storage]\n"
        " * @returns {MixerState|null}\n"
        " */\n"
        "export function loadMixerState",
    ),
    (
        " * @param {Record<string, Record<string, {l:number,r:number}>>} matrix",
        " * @param {MixerMatrix} matrix",
    ),
    (
        " * @param {object} matrix\n"
        " * @param {string} bus",
        " * @param {MixerMatrix} matrix\n * @param {string} bus",
    ),
    (" * @returns {object} новая матрица", " * @returns {MixerMatrix} новая матрица"),
    (
        " * @param {object} before\n * @param {object} after",
        " * @param {MixerMatrix} before\n * @param {MixerMatrix} after",
    ),
    (
        " * @param {object} matrix\n * @returns {{known:number, total:number}}",
        " * @param {MixerMatrix} matrix\n * @returns {{known:number, total:number}}",
    ),
]


def main() -> int:
    dry = "--dry" in sys.argv
    text = TARGET.read_text(encoding="utf-8")
    original = text
    applied = 0

    for old, new in PAIRS:
        if old in text:
            text = text.replace(old, new, 1)
            applied += 1
        else:
            print(f"НЕ НАЙДЕНО: {old.splitlines()[0].strip()[:60]}")

    print(f"применено {applied}/{len(PAIRS)}")

    if text == original:
        return 0
    if dry:
        return 0

    tmp = ROOT / "web" / "mixer-state.check.mjs"
    tmp.write_text(text, encoding="utf-8")
    r = subprocess.run(["node", "--check", str(tmp)], capture_output=True, text=True, timeout=30)
    tmp.unlink(missing_ok=True)
    if r.returncode != 0:
        print("ОШИБКА синтаксиса — не записано")
        print((r.stderr or "").strip()[:400])
        return 1

    TARGET.write_text(text, encoding="utf-8")
    print("записано")
    return 0


if __name__ == "__main__":
    sys.exit(main())
