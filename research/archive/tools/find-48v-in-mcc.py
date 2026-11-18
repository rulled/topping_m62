r"""НАЙТИ В MCC ОБРАБОТКУ 48V — какой тег он шлёт.

══════════ ЗАЧЕМ ══════════

Мы знаем:
  - кнопка 48V есть в UI (PushButton48V, Input_IN1/IN2);
  - в INI есть ключ 48V;
  - но прямая запись в 0x11:0x19 не работает, и какой тег
    соответствует 48V — не установлено.

Кнопка в Live-режиме показывает Off всегда, значит она либо
неактивна, либо управляет чем-то, что не отражается в 0x11:19.

══════════ МЕТОД ══════════

Ищем в бинарнике MCC строку "48V" / "Phantom" и смотрим, что рядом:
какой числовой тег, какая функция-упаковщик.

Тот же приём, которым найдена карта реверба (NOTES §11.5,
функция FUN_140230b20).

Запуск: python src/tools/find-48v-in-mcc.py
"""

from __future__ import annotations

import re
from pathlib import Path

EXE = Path(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe")

NEEDLES = [
    "48V",
    "PushButton48V",
    "Phantom",
    "phantom",
    "InputPower",
    "inputPower",
]


def printable(blob: bytes, start: int, end: int) -> str:
    seg = blob[max(0, start) : min(len(blob), end)]
    return "".join(chr(b) if 32 <= b < 127 else "|" for b in seg)


def main() -> None:
    if not EXE.exists():
        raise SystemExit(f"нет файла: {EXE}")
    blob = EXE.read_bytes()
    print(f"файл: {EXE.name}, {len(blob) / 1024 / 1024:.1f} МБ\n")

    print("=" * 72)
    print("1. ГДЕ ЛЕЖАТ СТРОКИ")
    print("=" * 72)

    positions = {}
    for n in NEEDLES:
        needle = n.encode("ascii")
        hits = [m.start() for m in re.finditer(re.escape(needle), blob)]
        positions[n] = hits
        shown = ", ".join(str(h) for h in hits[:8]) or "нет"
        print(f"  {n:<16} {len(hits):>3} вхожд.  {shown}")

    print("\n" + "=" * 72)
    print("2. ОКРЕСТНОСТИ КАЖДОГО ВХОЖДЕНИЯ (ищем соседние теги)")
    print("=" * 72)

    for n in ["48V", "PushButton48V", "Phantom", "InputPower"]:
        for pos in positions.get(n, [])[:4]:
            print(f"\n--- {n} @ {pos} ---")
            print("  " + printable(blob, pos - 300, pos + 200))

    print("\n" + "=" * 72)
    print("3. ПОИСК ЧИСЛОВЫХ КОНСТАНТ РЯДОМ")
    print("=" * 72)
    print("""
  Ищем в окрестностях строки '48V' байты, которые могут быть
  target/prop: 0x11, 0x19, 0x21, 0x22 и т.п.

  Печатаем все вхождения одиночных байт 0x11 и 0x19 в радиусе
  2 КБ от строки, чтобы увидеть, есть ли там упаковка кадра.
""")

    for pos in positions.get("48V", [])[:4]:
        window = blob[max(0, pos - 2048) : pos + 2048]
        # ищем последовательности, похожие на пару (target, prop)
        pairs = []
        for i in range(len(window) - 1):
            a, b = window[i], window[i + 1]
            if a == 0x11 and b in (0x19, 0x1A, 0x1B, 0x1E):
                pairs.append((pos - 2048 + i, a, b))
        print(f"\n  окрестность {pos}: найдено пар (0x11, 0x19/1a/1b/1e): {len(pairs)}")
        for off, a, b in pairs[:10]:
            print(f"    offset {off}: 0x{a:02x} 0x{b:02x}")

    print("\n" + "=" * 72)
    print("4. ВЫВОД")
    print("=" * 72)
    has = {n: len(v) for n, v in positions.items()}
    if has.get("48V"):
        print("  Строка 48V в бинарнике есть — можно искать связь с тегом.")
        print("  Смотри окрестности выше: если рядом есть 0x11 0x19 или")
        print("  0x11 0x1a — это и есть адрес.")
    else:
        print("  Строки 48V нет — возможно, строка в Qt-ресурсе или")
        print("  собирается из перевода.")


if __name__ == "__main__":
    main()
