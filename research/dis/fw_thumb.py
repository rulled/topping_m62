"""
ДИЗАССЕМБЛИРОВАНИЕ ARM Thumb с правильного смещения 0x80.

НАБЛЮДЕНИЕ: с +0x80 идут характерные Thumb-паттерны:
    +0x8C: AD4E0F10   -> 0x0F10 = ... 
    +0x94: 73BEBD10   -> 0xBD10 = POP {PC}   <== ТОЧНО Thumb!
    +0xD4: F524F510   -> F5xx = Thumb-2
    +0xDC: 0000770C

Значит: файл = контейнер (заголовок 0x80 байт) + плоский образ,
где код начинается с 0x80. Заголовок содержит размеры/адреса.

М1: STM32G070R = Cortex-M0+ = ARMv6-M Thumb (без Thumb-2!).
Но здесь видно Thumb-2 (F5xx) => возможно, есть второй чип
(Topping DSP01) с более мощным ядром, или это другой код.

Проверяем оба варианта: ARMv6-M (M0+) и ARMv7-M (M3/M4).

Только чтение.
"""

import struct
import sys
from collections import Counter

import capstone

BIN = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
CODE_START = 0x80

MODES = [
    ("ARMv6-M (Cortex-M0+)", capstone.CS_MODE_THUMB + capstone.CS_MODE_MCLASS),
    ("ARMv7-M (Cortex-M3/M4)", capstone.CS_MODE_THUMB + capstone.CS_MODE_MCLASS),
]


def main():
    with open(BIN, "rb") as f:
        data = f.read()
    print(f"файл: {len(data)} байт (0x{len(data):X})")
    print(f"код начинается с: 0x{CODE_START:X}\n")

    code = data[CODE_START:]

    for label, mode in MODES:
        md = capstone.Cs(capstone.CS_ARCH_ARM, mode)
        md.detail = False
        print(f"=== {label} ===")
        n = 0
        total = 0
        for ins in md.disasm(code, 0x08000000):
            n += 1
            total += ins.size
            if n >= 4000:
                break
        pct = 100.0 * total / (n and code[:total] and len(code[:total]) or 1)
        print(f"  инструкций: {n}, покрыто байт: {total} из {len(code)} "
              f"({100.0 * total / len(code):.1f}%)")
        md2 = capstone.Cs(capstone.CS_ARCH_ARM, mode)
        md2.detail = False
        shown = 0
        for ins in md2.disasm(code[:256], 0x08000000):
            print(f"    0x{0x08000000 + ins.address - 0x08000000:X}: "
                  f"{ins.mnemonic:<8} {ins.op_str}")
            shown += 1
            if shown > 25:
                break
        print()

    # --- заголовок как структура ---
    print("=== заголовок (0x00..0x80) как массив dword ===")
    for i in range(0, 0x80, 4):
        v = struct.unpack_from("<I", data, i)[0]
        note = ""
        if 0x80 <= v <= len(data):
            note = f"  (возможно смещение, файл {len(data)})"
        elif v < 0x100000:
            note = f"  ({v} = 0x{v:X})"
        print(f"  +0x{i:02X}  {v:10d}  0x{v:08X}{note}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
