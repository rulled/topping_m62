r"""ОПРЕДЕЛЕНИЕ АРХИТЕКТУРЫ ПРОШИВКИ ДЕКОДЕРОМ.

═══════════ ГЛАВНАЯ ЗАЦЕПКА ═══════════

Capstone 5.x знает архитектуру **XMOS xCORE** (`CS_ARCH_XCORE`).
Это важно: USB-интерфейсы TOPPING собраны на XMOS (XU208/XU316),
и именно xCORE отвечает за USB + DSP в таких картах.

Если образ декодируется как xCORE — архитектура найдена, и дальше
можно идти в Ghidra (у неё есть расширение для xCORE) или разбирать
код напрямую капстоном.

═══════════ ПОЧЕМУ ДЕКОДЕР, А НЕ ПОДПИСИ ═══════════

Поиск подписей дал противоречивое: ARM Thumb push/pop нашлись, но
асимметрично (197/485), ARM stmdb — 0, x86 — 0. Это признак
случайных совпадений.

Правильный способ: прогнать реальный декодер и посчитать долю
успешно декодированных байт. Верная архитектура даст 85%+, неверная
— мусор и обрывы.

Запуск: python src/tools/firmware-arch.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import capstone
except ImportError:
    print("нет capstone: pip install capstone")
    sys.exit(3)

FW = Path("research/firmware/M62_FW87.05.45.48.27/M62_FW87.05.45.48.27.bin")

# Начала образов, найденные по повторам заголовков
BASES = [0x000000, 0x027000, 0x08f000, 0x0fc000]

# Сколько байт от начала образа пробовать
SAMPLE = 64 * 1024


def probe(data: bytes, cs_arch, cs_mode) -> tuple:
    """Декодировать образец.

    @returns (инструкций, байт покрыто, доля покрытия)
    """
    md = capstone.Cs(cs_arch, cs_mode)
    md.detail = False
    md.skipdata = False

    total = 0
    covered = 0
    for ins in md.disasm(data, 0x1000):
        total += 1
        covered += ins.size
        if total > 20000:
            break

    return total, covered, covered / max(1, len(data))


def main() -> int:
    if not FW.exists():
        print(f"нет файла: {FW}")
        return 1

    d = FW.read_bytes()

    print("=" * 76)
    print("ОПРЕДЕЛЕНИЕ АРХИТЕКТУРЫ ПРОШИВКИ M62")
    print("=" * 76)
    print(f"\nфайл: {len(d)} байт, образцов: {len(BASES)}, "
          f"по {SAMPLE // 1024} КБ от каждого\n")

    candidates = [
        # XMOS xCORE — главный кандидат: на нём собраны USB-интерфейсы
        # XU208/XU316, и capstone 5.x умеет его декодировать.
        ("XMOS xCORE (LE)", capstone.CS_ARCH_XCORE,
         capstone.CS_MODE_LITTLE_ENDIAN),
        ("XMOS xCORE (BE)", capstone.CS_ARCH_XCORE,
         capstone.CS_MODE_BIG_ENDIAN),
        ("ARM Thumb (LE)", capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB),
        ("ARM (LE, ARM mode)", capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM),
        ("ARM Thumb (BE)", capstone.CS_ARCH_ARM,
         capstone.CS_MODE_THUMB | capstone.CS_MODE_BIG_ENDIAN),
        ("AArch64 (LE)", capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM),
        ("x86-32", capstone.CS_ARCH_X86, capstone.CS_MODE_32),
        ("MIPS32 (LE)", capstone.CS_ARCH_MIPS,
         capstone.CS_MODE_MIPS32 | capstone.CS_MODE_LITTLE_ENDIAN),
        ("RISC-V (32)", capstone.CS_ARCH_RISCV, capstone.CS_MODE_RISCV32),
    ]

    results = []
    for name, arch, mode in candidates:
        try:
            per_image = []
            for base in BASES:
                sample = d[base : base + SAMPLE]
                if not sample:
                    continue
                total, covered, ratio = probe(sample, arch, mode)
                per_image.append((total, ratio))
            if not per_image:
                continue
            avg_ratio = sum(r for _, r in per_image) / len(per_image)
            total_ins = sum(t for t, _ in per_image)
            results.append((name, total_ins, avg_ratio))
        except Exception as e:  # noqa: BLE001
            print(f"  {name:24} ошибка декодера: {type(e).__name__}: {e}")
            continue

    print("-" * 76)
    print("ДОЛЯ УСПЕШНО ДЕКОДИРОВАННЫХ БАЙТ")
    print("-" * 76)
    print("  архитектура              инструкций   покрытие")
    print("  " + "-" * 66)

    results.sort(key=lambda x: -x[2])
    for name, total_ins, ratio in results:
        bar = "#" * int(ratio * 40)
        print(f"  {name:24} {total_ins:9}   {ratio * 100:5.1f}%  {bar}")

    # ─── вывод ───
    print("\n" + "=" * 76)
    print("ВЫВОД")
    print("=" * 76)

    if not results:
        print("  ни один декодер не отработал")
        return 2

    best_name, _, best_ratio = results[0]
    print(f"\n  лучший кандидат: {best_name} — {best_ratio * 100:.1f}% покрытия")

    if best_ratio > 0.85:
        print(f"""
  Уверенное совпадение: образ написан под {best_name}.
  Дальше: грузить в Ghidra (для xCORE нужно расширение) либо
  разбирать капстоном напрямую.
""")
    elif best_ratio > 0.6:
        print(f"""
  Умеренное совпадение ({best_name}). Возможно, часть образца —
  таблицы данных, которые декодер пропускает. Стоит взять участок
  без нулей и повторить.
""")
    else:
        print(f"""
  НИ ОДНА архитектура не даёт чистого декодирования (лучшая
  {best_ratio * 100:.1f}%).

  Вероятные объяснения:
    1. образ сжат/зашифрован внутри контейнера;
    2. блоки имеют свою структуру (не сплошной код);
    3. нужен образец из середины, а не с начала (там заголовок).
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
