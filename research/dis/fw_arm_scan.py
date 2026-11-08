"""
Анализ прошивки M62 как ARM Cortex-M (Thumb-2).

НОВАЯ ИНФОРМАЦИЯ ОТ ПОЛЬЗОВАТЕЛЯ (разбор устройства):
    - два ADC  ESS ES9821Q
    - AKM AK7604 (DAC для наушников)
    - Topping DSP01  (кастомный DSP)
    - STM32G070R    <== ARM Cortex-M0+ MCU
    - LM393 x2, LM258 (операционники)
    - батарея 5000 mAh JS 954292

ПРЕДЫДУЩИЙ ВЫВОД БЫЛ НЕВЕРЕН: я искал x86-64 и не нашёл.
Правильная ISA — ARM Thumb (Cortex-M0+).

М1: STM32G070 = Cortex-M0+, flash по адресу 0x08000000, SRAM 0x20000000.
Но файл прошивки — это НЕ raw flash, а контейнер (заголовки, блоки).

Стратегия: сканируем файл на предмет валидных Thumb-последовательностей
и находим регионы кода.

Только чтение файла.
"""

import sys
from collections import Counter

import capstone

BIN = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"

# Cortex-M0+ = ARMv6-M = Thumb только
md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB + capstone.CS_MODE_MCLASS)
md.detail = False


def main():
    with open(BIN, "rb") as f:
        data = f.read()
    print(f"размер файла: {len(data)} байт (0x{len(data):X})")

    # --- энтропия по блокам 4 КБ: код обычно 5.5..6.5, данные ниже/выше ---
    print("\n=== карта: доля успешно дизассемблированных Thumb-инструкций ===")
    print("(по блокам 16 КБ; высокий % = код)")

    BLOCK = 0x4000
    regions = []
    for off in range(0, len(data), BLOCK):
        chunk = data[off:off + BLOCK]
        if len(chunk) < 64:
            continue
        n = 0
        total = 0
        for ins in md.disasm(chunk, 0x08000000 + off):
            n += 1
            total += ins.size
            if total > len(chunk) * 0.5:
                break
        pct = 100.0 * total / len(chunk) if chunk else 0
        # эвристика: код, если покрыто >40%
        if pct > 40:
            regions.append((off, pct))

    # группируем смежные
    print(f"\nрегионов с покрытием >40%: {len(regions)}")
    merged = []
    for off, pct in regions:
        if merged and off - merged[-1][1] <= BLOCK:
            merged[-1] = (merged[-1][0], off + BLOCK, max(merged[-1][2], pct))
        else:
            merged.append((off, off + BLOCK, pct))
    for a, b, pct in merged[:30]:
        print(f"  0x{a:06X} .. 0x{b:06X}  ({b - a} байт, покрытие {pct:.0f}%)")

    # --- ищем vector table по всему файлу ---
    print("\n=== поиск Cortex-M векторной таблицы ===")
    import struct
    found = []
    for off in range(0, len(data) - 8, 4):
        sp = struct.unpack_from("<I", data, off)[0]
        rv = struct.unpack_from("<I", data, off + 4)[0]
        # SRAM STM32G070: 0x20000000 + до 36 КБ => 0x20000000..0x20009000
        sp_ok = 0x20000000 <= sp <= 0x20009000 and (sp & 3) == 0
        rv_ok = (rv & 1) == 1 and 0x08000000 <= rv < 0x08040000
        if sp_ok and rv_ok:
            found.append((off, sp, rv))
    print(f"  кандидатов: {len(found)}")
    for off, sp, rv in found[:10]:
        print(f"    +0x{off:06X}: SP=0x{sp:08X} Reset=0x{rv:08X}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
