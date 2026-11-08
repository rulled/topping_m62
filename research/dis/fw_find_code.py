"""
Поиск НАСТОЯЩЕГО ARM-кода в прошивке.

НАБЛЮДЕНИЯ:
  +0x0E70: 524288 = 0x080000  (512 КБ)
  +0x0E80: 1048608 = 0x100020 (1 МБ + 32)
  +0x044: 0x08200020
  +0x064: 0x08300020

ПЛОТНОСТЬ 0xBD (Thumb POP{PC}) высокая по всему файлу (14..84 на 64 КБ),
но у случайных данных было бы ~128 на 64 КБ (2 байта из 65536).
То есть 0xBD встречается РЕЖЕ случайного => это не Thumb-код напрямую,
а что-то сжатое или закодированное.

СТРАТЕГИЯ: проверить, является ли файл образом с ЗАШИФРОВАННЫМИ
секциями. Ищем структуру ELF/raw-сегментов. Пробуем найти
последовательности, которые дизассемблируются в осмысленный Thumb.

Метод: скользящее окно, ищем позиции, где >70% байт декодируются
как валидные Thumb-инструкции с осмысленными мнемониками.

Только чтение.
"""

import sys
from collections import Counter

import capstone

BIN = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"

# «мусорные» мнемоники, которые часто появляются при неверном выравнивании
JUNK = {"udf", "b", "bl", "svc", "it", "cpsie", "cpsid"}


def score_thumb(data, off, mode, window=512):
    md = capstone.Cs(capstone.CS_ARCH_ARM, mode)
    md.detail = False
    chunk = data[off:off + window]
    if len(chunk) < 64:
        return 0.0, 0
    total = 0
    good = 0
    n = 0
    for ins in md.disasm(chunk, 0x08000000):
        n += 1
        total += ins.size
        if ins.mnemonic not in JUNK:
            good += ins.size
        if total > window * 0.9:
            break
    if n < 20:
        return 0.0, n
    return 100.0 * total / window, n


def main():
    with open(BIN, "rb") as f:
        data = f.read()
    print(f"файл: {len(data)} (0x{len(data):X})\n")

    modes = [
        ("ARMv6-M (M0+)", capstone.CS_MODE_THUMB + capstone.CS_MODE_MCLASS),
        ("ARMv7-M", capstone.CS_MODE_THUMB + capstone.CS_MODE_MCLASS),
    ]

    print("=== карта покрытия Thumb-дизассемблированием (окна 4 КБ) ===")
    for label, mode in modes[:1]:
        print(f"\n  {label}:")
        B = 0x1000
        best = []
        for off in range(0, len(data), B):
            pct, n = score_thumb(data, off, mode, B)
            if pct > 30:
                best.append((off, pct, n))
        if not best:
            print("    ни одного окна с покрытием >30%")
        else:
            print(f"    окон >30%: {len(best)}")
            for off, pct, n in best[:25]:
                print(f"      0x{off:06X}  покрытие {pct:.0f}%  инстр {n}")

    # --- проверим гипотезу: 512 КБ блок с 0x080000 ---
    print("\n=== проверка блока 512 КБ (0x0E70 = 524288) ===")
    if len(data) >= 0x80000:
        pct, n = score_thumb(data, 0, modes[0][1], 0x80000)
        print(f"  первые 512 КБ: покрытие {pct:.1f}%, инструкций {n}")

    # --- и блок 1 МБ ---
    if len(data) >= 0x100020:
        pct, n = score_thumb(data, 0, modes[0][1], 0x100020)
        print(f"  первые 1 МБ:    покрытие {pct:.1f}%, инструкций {n}")

    # --- что за магия в начале? ---
    print("\n=== магия 0x00..0x0C ===")
    print(f"  {data[0:12].hex()}")
    print("  как ASCII:", "".join(chr(b) if 32 <= b < 127 else "." for b in data[0:12]))
    # может быть, это зашифрованный заголовок с ключом позже

    return 0


if __name__ == "__main__":
    sys.exit(main())
