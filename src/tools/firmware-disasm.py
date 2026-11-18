r"""ПОДТВЕРЖДЕНИЕ АРХИТЕКТУРЫ: дизассемблируем лучшие окна.

═══════════ ГДЕ МЫ СЕЙЧАС ═══════════

Метрика непрерывного прогона (`firmware-metric.py`) откалибрована:
  • сгенерированный x86 -> 99.2% на x86-64;
  • сгенерированный Thumb -> 100% на ARM Thumb;
  • случайные данные -> 4.7% / 8.6% (шум).

Прошивка M62:
    XCORE      10.2%   (но xCORE декодирует ВСЁ, включая x86-код и
                        нули -> как признак бесполезен)
    ARM Thumb  33.6%   (шум 8.6%)  <- единственный значимый сигнал
    ARM LE     15.6%
    x86-64      6.2%

33.6% против 8.6% — это сигнал, но не «чистый код». Значит образ
содержит код ВПЕРЕМЕЖКУ с данными.

═══════════ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══════════

1. Скользит окнами 4 КБ по всему образу.
2. Для каждого окна считает долю непрерывного прогона ARM Thumb.
3. Берёт лучшие окна и печатает их ДИЗАССЕМБЛЕР.
4. Если инструкции выглядят осмысленно (push/pop, mov, bl, ldr) —
   архитектура подтверждена.

═══════════ ПОЧЕМУ ДИЗАССЕМБЛЕР, А НЕ ЧИСЛО ═══════════

Число «33.6%» можно трактовать по-разному. Дизассемблер показывает
ГЛАЗАМИ: если это код, видно прологи функций, вызовы, обращения к
памяти. Если мусор — видно мусор.

Запуск: python src/tools/firmware-disasm.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import capstone

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")

WINDOW = 4096
TOP_N = 3


def run_ratio(data: bytes, md) -> float:
    """Доля байт в первом непрерывном прогоне."""
    covered = 0
    for ins in md.disasm(data, 0x1000):
        covered += ins.size
        if covered > len(data):
            break
    return covered / max(1, len(data))


def main() -> int:
    if not FW.exists():
        print(f"нет файла: {FW}")
        return 1

    d = FW.read_bytes()

    print("=" * 78)
    print("ПОДТВЕРЖДЕНИЕ АРХИТЕКТУРЫ ПРОШИВКИ M62")
    print("=" * 78)

    md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
    md.detail = True

    # ─── 1. карта окон ───
    windows = []
    for off in range(0, len(d) - WINDOW, WINDOW):
        r = run_ratio(d[off : off + WINDOW], md)
        windows.append((off, r))

    good = [w for w in windows if w[1] > 0.5]
    print(f"\nокон 4 КБ всего: {len(windows)}")
    print(f"окон с прогоном >50%: {len(good)}")

    if not windows:
        print("нет данных")
        return 1

    best = sorted(windows, key=lambda x: -x[1])[:TOP_N]

    print("\n" + "-" * 78)
    print("ЛУЧШИЕ ОКНА")
    print("-" * 78)
    for off, r in best:
        print(f"  0x{off:06x}  прогон {r * 100:5.1f}%")

    # ─── 2. дизассемблер лучшего окна ───
    off, r = best[0]
    code = d[off : off + WINDOW]

    print("\n" + "-" * 78)
    print(f"ДИЗАССЕМБЛЕР ОКНА 0x{off:06x} (ARM Thumb, первые 40 инструкций)")
    print("-" * 78)

    count = 0
    for ins in md.disasm(code, off):
        print(f"  0x{ins.address:06x}  {ins.bytes.hex():16}  "
              f"{ins.mnemonic:8} {ins.op_str}")
        count += 1
        if count >= 40:
            break

    if count == 0:
        print("  ДИЗАССЕМБЛЕР НЕ ВЫДАЛ НИ ОДНОЙ ИНСТРУКЦИИ")
        print("  Значит окно начинается с данных, а не с кода.")

    # ─── 3. оценка осмысленности ───
    print("\n" + "-" * 78)
    print("ОЦЕНКА ОСМЫСЛЕННОСТИ")
    print("-" * 78)

    # Собираем мнемоники по всему образу (окна с высоким прогоном)
    from collections import Counter
    mnems = Counter()
    for woff, wr in sorted(windows, key=lambda x: -x[1])[:40]:
        n = 0
        for ins in md.disasm(d[woff : woff + WINDOW], woff):
            mnems[ins.mnemonic] += 1
            n += 1
            if n > 3000:
                break

    print(f"  всего инструкций в 40 лучших окнах: {sum(mnems.values())}")
    print(f"  уникальных мнемоник: {len(mnems)}")
    print("\n  топ-15 мнемоник:")
    for m, c in mnems.most_common(15):
        print(f"    {m:12} {c:6}")

    # Признаки настоящего ARM Thumb кода:
    #   • push/pop (прологи/эпилоги)
    #   • bl (вызовы)
    #   • ldr/str (память)
    #   • b/bne/beq (ветвления)
    markers = {
        "push": mnems.get("push", 0),
        "pop": mnems.get("pop", 0),
        "bl": mnems.get("bl", 0),
        "ldr": mnems.get("ldr", 0),
        "str": mnems.get("str", 0),
        "b": mnems.get("b", 0),
        "bx": mnems.get("bx", 0),
    }

    print("\n  маркеры кода:")
    for k, v in markers.items():
        print(f"    {k:6} {v:6}")

    has_structure = (
        markers["push"] > 5 and markers["pop"] > 5
        and markers["bl"] + markers["b"] > 10
        and markers["ldr"] + markers["str"] > 20
    )

    print("\n" + "=" * 78)
    print("ВЫВОД")
    print("=" * 78)

    if has_structure:
        print(f"""
  АРХИТЕКТУРА ПОДТВЕРЖДЕНА: ARM Thumb (little-endian).

  Признаки настоящего кода в лучших окнах:
    push {markers['push']}, pop {markers['pop']} — прологи и эпилоги функций
    bl {markers['bl']}, b {markers['b']} — вызовы и переходы
    ldr {markers['ldr']}, str {markers['str']} — обращения к памяти

  Дальше: грузить в Ghidra как ARM Cortex-M / Thumb, либо разбирать
  капстоном. Начать стоит с окна 0x{best[0][0] if False else off:06x}.

  ВАЖНО: покрытие 33.6% значит, что код перемежается с данными
  (таблицы, строки, константы). Это нормально для прошивки.
""")
    else:
        print(f"""
  Архитектура НЕ подтверждена. В лучших окнах нет структуры
  настоящего кода: мало прологов (push {markers['push']}),
  мало вызовов (bl {markers['bl']}).

  Значит 33.6% — это совпадения, а не код.
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
