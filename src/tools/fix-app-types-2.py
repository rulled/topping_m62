r"""ОСТАТОЧНЫЕ ИСПРАВЛЕНИЯ ТИПОВ В app.js.

═══════════ ЧТО ИМЕННО ═══════════

1. `$('id').value` для известных полей — у `$()` тип `HTMLElement`,
   у которого нет `.value`. Заменяем на `$input()` / `$select()`:
   это те же `document.getElementById`, но с точным типом.

2. Присваивание ЧИСЛА в `.value` — `.value` всегда строка. Пишем
   `String(...)`: результат тот же, намерение явное.

3. `/** @type */` перед `for (...)` TypeScript не применяет к
   элементам цикла (аннотация относится к оператору, а не к массиву).
   Переносим тип на отдельную `const` и итерируем её.

4. `Element` -> `HTMLElement` в `enableControls`.

Каждая замена — точная строка, проверена глазами по разметке.

Запуск: python src/tools/fix-app-types-2.py [--dry]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
APP = ROOT / "web" / "app.js"

REPLACEMENTS: list[tuple[str, str]] = [
    # ── 1. $() -> $input()/ $select() для известных полей ──
    ("const eqInput = () => $('eqInput').value || 'IN1';",
     "const eqInput = () => $select('eqInput').value || 'IN1';"),
    ("const hpChannel = () => $('eqHpChannel').value || 'l';",
     "const hpChannel = () => $select('eqHpChannel').value || 'l';"),
    ("const hpBand = () => Number($('eqHpBand').value) || 1;",
     "const hpBand = () => Number($select('eqHpBand').value) || 1;"),
    ("const mixerBus = () => $('mixerBus').value || 'a';",
     "const mixerBus = () => $select('mixerBus').value || 'a';"),
    ("    if (typeEl && b.type) typeEl.value = String(b.type);",
     "    if (typeEl && b.type) $select(`eq${band}type`).value = String(b.type);"),
    ("  if (cur.type) $('eqHpType').value = String(cur.type);",
     "  if (cur.type) $select('eqHpType').value = String(cur.type);"),
    ("  $('sceneList').value = name;", "  $select('sceneList').value = name;"),
    ("  const name = $('sceneList').value;",
     "  const name = $select('sceneList').value;"),
    ("  const name = $('sceneList').value;\n  if (!name) return;",
     "  const name = $select('sceneList').value;\n  if (!name) return;"),

    # ── 2. числа в .value -> String(...) ──
    ("    $input(id).value = v;", "    $input(id).value = String(v);"),
    ("      $input(`eq${band}gain`).value = b.gain;",
     "      $input(`eq${band}gain`).value = String(b.gain);"),
    ("      $input(`eq${band}freq`).value = sliderFromFreq(b.freq);",
     "      $input(`eq${band}freq`).value = String(sliderFromFreq(b.freq));"),
    ("      $input(`eq${band}q`).value = sliderFromQ(b.q);",
     "      $input(`eq${band}q`).value = String(sliderFromQ(b.q));"),
    ("    $input('eqHpGain').value = cur.gain;",
     "    $input('eqHpGain').value = String(cur.gain);"),
    ("    $input('eqHpFreq').value = sliderFromFreq(cur.freq);",
     "    $input('eqHpFreq').value = String(sliderFromFreq(cur.freq));"),
    ("    $input('eqHpQ').value = sliderFromQ(cur.q);",
     "    $input('eqHpQ').value = String(sliderFromQ(cur.q));"),

    # ── 3. аннотация с for(...) -> const ──
    (
        "/** @type {Array<[string, 'IN1' | 'IN2']>} */\n"
        "for (const [id, ch] of [['p48v1', 'IN1'], ['p48v2', 'IN2']]) {",
        "/** @type {Array<[string, 'IN1' | 'IN2']>} */\n"
        "const phantomButtons = [['p48v1', 'IN1'], ['p48v2', 'IN2']];\n"
        "for (const [id, ch] of phantomButtons) {",
    ),
    (
        "/** @type {Array<[string, string, number]>} */\n"
        "for (const [id, field, scale] of [['rvWet', 'dryWet', 1], ['rvRoom', 'room', 1], ['rvDecay', 'decay', 1], ['rvWidth', 'width', 100]]) {",
        "/** @type {Array<[string, string, number]>} */\n"
        "const reverbSliders = [['rvWet', 'dryWet', 1], ['rvRoom', 'room', 1], ['rvDecay', 'decay', 1], ['rvWidth', 'width', 100]];\n"
        "for (const [id, field, scale] of reverbSliders) {",
    ),

    # ── 4. Element -> HTMLElement ──
    (
        "  document.querySelectorAll('input[type=range], select, .card button').forEach((node) => {\n"
        "    const el = /** @type {HTMLElement} */ (node);\n"
        "    if (el.id === 'btnConnect' || el.id === 'btnDisconnect') return;\n"
        "    el.disabled = !on;\n"
        "  });",
        "  document.querySelectorAll('input[type=range], select, .card button').forEach((node) => {\n"
        "    const el = /** @type {HTMLInputElement} */ (node);\n"
        "    if (el.id === 'btnConnect' || el.id === 'btnDisconnect') return;\n"
        "    el.disabled = !on;\n"
        "  });",
    ),

    # ── 5. mixer: Number(el.value) при el = $() ──
    (
        "      const el = $(`mx_${key}_${ch}`);\n      if (!el) continue;",
        "      const el = $input(`mx_${key}_${ch}`);\n      if (!el) continue;",
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
        else:
            print(f"НЕ НАЙДЕНО: {old.splitlines()[0].strip()[:70]}")

    print(f"применено {applied}/{len(REPLACEMENTS)}")

    if text == original:
        return 0
    if dry:
        print("[dry]")
        return 0

    tmp = ROOT / "web" / "app.check.mjs"
    tmp.write_text(text, encoding="utf-8")
    r = subprocess.run(["node", "--check", str(tmp)], capture_output=True, text=True, timeout=30)
    tmp.unlink(missing_ok=True)
    if r.returncode != 0:
        print("ОШИБКА синтаксиса — не записано")
        print((r.stderr or "").strip()[:400])
        return 1

    APP.write_text(text, encoding="utf-8")
    print("записано")
    return 0


if __name__ == "__main__":
    sys.exit(main())
