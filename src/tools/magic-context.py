r"""КОНТЕКСТ МАГИИ 0xc07aaf11: в эталоне и у нас.

═══════════ ЗАЧЕМ ═══════════

Предыдущий скрипт нашёл магию в ОБОИХ образах и сделал вывод
«значит это не контейнер, а обычная константа XMOS».

Но это надо проверить по КОНТЕКСТУ: если в эталоне магия стоит
внутри кода/данных вперемешку, а у нас — в начале и на границах
разделов, то это РАЗНЫЕ вещи, и вывод ложный.

Запуск: python src/tools/magic-context.py
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

OURS = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")
REF = Path("research/xmos-samples/xu316-factory.bin")

MAGIC = 0xC07AAF11


def find_all(d: bytes) -> list:
    needle = struct.pack("<I", MAGIC)
    out = []
    s = 0
    while True:
        i = d.find(needle, s)
        if i < 0:
            break
        out.append(i)
        s = i + 1
    return out


def show(name: str, d: bytes, positions: list) -> None:
    print(f"\n{'=' * 72}")
    print(f"{name} — магия в {len(positions)} местах")
    print("=" * 72)
    for off in positions:
        aligned = (off % 4) == 0
        lo = max(0, off - 16)
        hi = min(len(d), off + 20)
        hx = " ".join(f"{b:02x}" for b in d[lo:hi])
        print(f"\n  0x{off:06x}  {'выровнено' if aligned else 'НЕ выровнено'}")
        print(f"    контекст: {hx}")
        # байты до магии
        before = d[lo:off]
        after = d[off + 4 : hi]
        print(f"    до:    {' '.join(f'{b:02x}' for b in before)}")
        print(f"    после: {' '.join(f'{b:02x}' for b in after)}")


def main() -> int:
    if not REF.exists() or not OURS.exists():
        print("нужны оба файла")
        return 1

    ref = REF.read_bytes()
    ours = OURS.read_bytes()

    ref_pos = find_all(ref)
    our_pos = find_all(ours)

    show("ЭТАЛОН XU316", ref, ref_pos)
    show("НАШ M62", ours, our_pos)

    # ─── анализ ───
    print("\n" + "=" * 72)
    print("АНАЛИЗ")
    print("=" * 72)

    def stats(name, d, pos):
        if not pos:
            print(f"\n  {name}: магии нет")
            return
        aligned = sum(1 for p in pos if p % 4 == 0)
        at_start = any(p == 0 for p in pos)
        print(f"\n  {name}:")
        print(f"    вхождений:      {len(pos)}")
        print(f"    выровненных:    {aligned} из {len(pos)}")
        print(f"    в самом начале: {'ДА' if at_start else 'нет'}")
        print(f"    плотность:      1 на {len(d) // max(1, len(pos))} байт")

    stats("эталон", ref, ref_pos)
    stats("наш", ours, our_pos)

    print("\n" + "=" * 72)
    print("ВЫВОД")
    print("=" * 72)

    ref_at_start = any(p == 0 for p in ref_pos)
    our_at_start = any(p == 0 for p in our_pos)

    if our_at_start and not ref_at_start:
        print(f"""
  ВАЖНОЕ РАЗЛИЧИЕ:

    эталон: магия НЕ в начале файла (первое вхождение 0x{ref_pos[0]:x}),
            это константа внутри кода/данных;
    наш:    магия СТОИТ ПЕРВЫМ СЛОВОМ файла (0x000000).

  Значит у нас магия — это ЗАГОЛОВОК КОНТЕЙНЕРА, а в эталоне —
  просто совпавшее значение внутри кода.

  Мой предыдущий вывод «магия в обоих -> это обычная константа» был
  НЕВЕРЕН. Совпадение значения само по себе ничего не доказывает:
  важно, ГДЕ оно стоит.

  Правильный вывод: наш образ — свой контейнер Topping, а не
  штатный образ xflash.
""")
    elif our_at_start and ref_at_start:
        print("\n  Магия в начале в обоих — формат может совпадать.")
    else:
        print("\n  Магия не в начале — контейнерных признаков нет.")

    # ─── структурное сравнение ───
    print("\n" + "-" * 72)
    print("СТРУКТУРНЫЕ ПРИЗНАКИ")
    print("-" * 72)
    for name, d in (("эталон", ref), ("наш", ours)):
        # повторяющиеся 512-байтовые блоки
        import hashlib
        blocks = {}
        for off in range(0, len(d) - 512, 512):
            h = hashlib.sha1(d[off : off + 512]).hexdigest()[:8]
            blocks.setdefault(h, []).append(off)
        dup = {h: o for h, o in blocks.items() if len(o) > 1}
        print(f"  {name:8} повторяющихся блоков 512: {len(dup)} из {len(blocks)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
