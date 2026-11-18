r"""СТРОКИ И АРХИТЕКТУРА В ПОДОБРАЗАХ ПРОШИВКИ M62.

═══════════ ЗАЧЕМ ═══════════

Найдено 4 подобраза с общим магическим числом 0xc07aaf11.
Энтропия 90% блоков — «полоса кода» (5-7.5). Но ни одной строки
XMOS/ARM/Topping в файле нет.

Надо понять:
  • есть ли вообще читаемые строки (если да — код не сжат);
  • какая архитектура (по сигнатурам команд).

Запуск: python src/tools/firmware-strings.py
"""

from __future__ import annotations

import re
import struct
import sys
from collections import Counter
from pathlib import Path

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")
BASES = [0x000000, 0x027000, 0x08f000, 0x0fc000]
MAGIC = 0xC07AAF11


def ascii_strings(data: bytes, minlen: int = 6):
    """Найти читаемые ASCII-строки."""
    pattern = rb"[\x20-\x7e]{%d,}" % minlen
    return [(m.start(), m.group().decode("ascii")) for m in re.finditer(pattern, data)]


def main() -> int:
    if not FW.exists():
        print(f"нет файла: {FW}")
        return 1

    d = FW.read_bytes()

    print("=" * 72)
    print("СТРОКИ И АРХИТЕКТУРА ПРОШИВКИ M62")
    print("=" * 72)

    # ─── сколько строк всего ───
    strings = ascii_strings(d, 6)
    print(f"\nASCII-строк (>=6 символов): {len(strings)}")
    total_chars = sum(len(s) for _, s in strings)
    print(f"суммарно символов:          {total_chars}")
    print(f"доля от файла:              {total_chars / len(d) * 100:.2f}%")

    if strings:
        print("\n" + "-" * 72)
        print("ПЕРВЫЕ 40 СТРОК")
        print("-" * 72)
        for off, s in strings[:40]:
            print(f"  0x{off:06x}  {s[:70]}")

        # строки, похожие на осмысленные (слова >4 букв)
        words = [s for _, s in strings if re.search(r"[A-Za-z]{5,}", s)]
        print(f"\nстрок с осмысленными словами: {len(words)}")
        if words:
            print("примеры:")
            for s in words[:25]:
                print(f"  {s[:70]}")
    else:
        print("\n  СТРОК НЕТ ВООБЩЕ — образ либо сжат, либо это не код с данными.")

    # ─── поиск магии во всём файле ───
    print("\n" + "-" * 72)
    print("МАГИЧЕСКОЕ ЧИСЛО 0xc07aaf11")
    print("-" * 72)
    needle = struct.pack("<I", MAGIC)
    positions = []
    start = 0
    while True:
        idx = d.find(needle, start)
        if idx < 0:
            break
        positions.append(idx)
        start = idx + 1
    print(f"  найдено вхождений: {len(positions)}")
    for p in positions:
        print(f"    0x{p:06x}")

    # ─── проверка на архитектуры по сигнатурам ───
    print("\n" + "-" * 72)
    print("ПРОВЕРКА АРХИТЕКТУР")
    print("-" * 72)

    # ARM Thumb: частые пролога push {r4-r7,lr} = 0xb5f0..0xb5ff
    # и epilog pop {r4-r7,pc} = 0xbdf0..0xbdff, в парах little-endian
    thumb_push = 0
    thumb_pop = 0
    for i in range(0, len(d) - 1, 2):
        v = d[i] | (d[i + 1] << 8)
        if 0xB500 <= v <= 0xB5FF:
            thumb_push += 1
        if 0xBD00 <= v <= 0xBDFF:
            thumb_pop += 1
    print(f"  ARM Thumb push {{..}} кандидатов: {thumb_push}")
    print(f"  ARM Thumb pop  {{..pc}}:         {thumb_pop}")

    # ARM 32-bit: слово в диапазоне 0xE92Dxxxx (stmdb sp!) — прологи
    arm_stmdb = 0
    for i in range(0, len(d) - 3, 4):
        if d[i + 3] == 0xE9 and (d[i + 2] & 0xF0) == 0x20:
            arm_stmdb += 1
    print(f"  ARM stmdb sp! кандидатов:        {arm_stmdb}")

    # x86: частые прологи 55 8B EC / 55 89 E5
    x86_pro = d.count(b"\x55\x8b\xec") + d.count(b"\x55\x89\xe5")
    print(f"  x86 push ebp;mov ebp,esp:        {x86_pro}")

    # Xtensa: entry a1, N = 0x36/0x004136
    xtensa_entry = 0
    for i in range(0, len(d) - 1):
        if d[i] == 0x36 and (d[i + 1] & 0xF0) == 0x40:
            xtensa_entry += 1
    print(f"  Xtensa 'entry' кандидатов:       {xtensa_entry}")

    # ─── вывод ───
    print("\n" + "=" * 72)
    print("ВЫВОД")
    print("=" * 72)
    print(f"""
  строк: {len(strings)}, из них осмысленных: {len(words) if strings else 0}
  магия 0xc07aaf11 найдена: {len(positions)} раз

  {'Образ содержит читаемый код с данными — можно грузить в дизассемблер.' if len(strings) > 200 else 'Строк почти нет — образ, вероятно, сжат или это не текстовая прошивка.'}
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
