r"""ПОВТОРЫ В ПРОШИВКЕ M62: сколько копий образа?

═══════════ ЗАЧЕМ ═══════════

Карта энтропии показала, что ряды нулей повторяются на смещениях
0x000e98, 0x027e98, 0x08fe98, 0x0fce98 — то есть с шагом ~0x28000.
Это может значить, что в файле лежит НЕСКОЛЬКО копий одного образа
(например, прошивки для разных чипов или A/B-слоты обновления).

Если так, то:
  • читать надо одну копию, а не весь файл;
  • «1216512 байт» — не размер прошивки;
  • искать надо по границам образов.

═══════════ МЕТОД ═══════════

1. Нарезать файл окнами по 512 байт с шагом 512.
2. Хэшировать каждое окно.
3. Сгруппировать окна по хэшу: где одна и та же последовательность
   встречается больше одного раза.
4. Для крупных групп вывести смещения и посчитать сдвиг между ними.

Запуск: python src/tools/firmware-copies.py
"""

from __future__ import annotations

import hashlib
import sys
from collections import defaultdict
from pathlib import Path

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")

WINDOW = 512


def main() -> int:
    if not FW.exists():
        print(f"нет файла: {FW}")
        return 1

    d = FW.read_bytes()
    n = len(d)

    print("=" * 72)
    print("ПОВТОРЫ В ПРОШИВКЕ: СКОЛЬКО КОПИЙ ОБРАЗА")
    print("=" * 72)
    print(f"\nразмер: {n} (0x{n:x}), окно {WINDOW} байт\n")

    # ─── хэши окон ───
    windows = []
    for off in range(0, n - WINDOW + 1, WINDOW):
        h = hashlib.sha1(d[off : off + WINDOW]).hexdigest()[:12]
        windows.append((off, h))

    by_hash = defaultdict(list)
    for off, h in windows:
        by_hash[h].append(off)

    dup = {h: offs for h, offs in by_hash.items() if len(offs) > 1}

    print("-" * 72)
    print("ИТОГ")
    print("-" * 72)
    print(f"  окон всего:            {len(windows)}")
    print(f"  уникальных последоват.: {len(by_hash)}")
    print(f"  повторяющихся:         {len(dup)}  "
          f"({len(dup) / max(1, len(by_hash)) * 100:.1f}% уникальных)")

    # ─── крупнейшие группы ───
    groups = sorted(dup.items(), key=lambda kv: -len(kv[1]))[:12]
    print("\n" + "-" * 72)
    print("КРУПНЕЙШИЕ ПОВТОРЯЮЩИЕСЯ БЛОКИ")
    print("-" * 72)
    print("  копий  смещения (первые 6)                    сдвиги")
    print("  " + "-" * 66)
    for h, offs in groups:
        shown = ", ".join(f"0x{o:06x}" for o in offs[:6])
        deltas = [offs[i + 1] - offs[i] for i in range(min(4, len(offs) - 1))]
        dtxt = ", ".join(f"0x{x:x}" for x in deltas) if deltas else "—"
        print(f"  {len(offs):5}  {shown:40} {dtxt}")

    # ─── карта покрытия: где уникально ───
    #
    # Считаем для каждой страницы 4 КБ, сколько раз она встречается.
    PAGE = 4096
    page_hash = {}
    for off in range(0, n - PAGE + 1, PAGE):
        page_hash[off] = hashlib.sha1(d[off : off + PAGE]).hexdigest()[:12]

    inv = defaultdict(list)
    for off, h in page_hash.items():
        inv[h].append(off)

    print("\n" + "-" * 72)
    print("КАРТА СТРАНИЦ 4 КБ (только повторяющиеся)")
    print("-" * 72)
    rep = [(h, offs) for h, offs in inv.items() if len(offs) > 1]
    rep.sort(key=lambda kv: kv[1][0])
    if not rep:
        print("  повторяющихся страниц нет — образ уникален целиком")
    else:
        for h, offs in rep[:20]:
            print(f"  страница 0x{offs[0]:06x} повторена {len(offs)} раз: "
                  + ", ".join(f"0x{o:06x}" for o in offs))
        if len(rep) > 20:
            print(f"  ... ещё {len(rep) - 20} групп")

    # ─── вывод ───
    print("\n" + "=" * 72)
    print("ВЫВОД")
    print("=" * 72)

    total_dup = sum(len(o) - 1 for o in dup.values())
    if total_dup > len(windows) * 0.2:
        print(f"""
  {total_dup} окон из {len(windows)} — повторы. В файле ДЕЙСТВИТЕЛЬНО
  несколько копий (или крупные общие блоки). Читать надо одну копию.
""")
    elif rep:
        print(f"""
  Повторяются {len(rep)} страниц — это общие библиотечные блоки,
  а не копии образа целиком.
""")
    else:
        print("""
  Образ уникален: каждая страница встречается один раз.
  Значит 1216512 байт — это одна прошивка, и повтор рядов нулей
  на смещениях 0x000e98/0x027e98/... объясняется структурой данных
  (например, одинаковые таблицы), а не копиями.
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
