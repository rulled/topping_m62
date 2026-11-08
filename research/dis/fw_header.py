"""
Разбор заголовка контейнера M62.

НАБЛЮДЕНИЯ:
  +0x44  0x08200020    <- похоже на ARM-адрес: 0x08200020
  +0x64  0x08300020    <- 0x08300020
  0x00200000 и 0x00300000 в старших 16 битах...

Если читать как BE: 08 20 00 20 -> 0x08200020
Или как пару: 0x0820 и 0x0020.

ГИПОТЕЗА: контейнер содержит НЕСКОЛЬКО образов (для разных чипов):
  - STM32G070R (Cortex-M0+)
  - Topping DSP01
Каждый образ имеет свой адрес загрузки и размер.

Структура записи может быть: {адрес_загрузки, размер, смещение}.

Проверяем: ищем пары (addr, size) где addr выглядит как код-адрес.

Только чтение.
"""

import struct
import sys

BIN = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"


def main():
    with open(BIN, "rb") as f:
        data = f.read()
    n = len(data)
    print(f"файл: {n} (0x{n:X})\n")

    print("=== все dword, похожие на адреса кода (0x080xxxxx / 0x082xxxxx) ===")
    for i in range(0, min(n, 0x1000), 4):
        v = struct.unpack_from("<I", data, i)[0]
        if 0x08000000 <= v <= 0x09FFFFFF:
            print(f"  +0x{i:03X}  0x{v:08X}")

    print("\n=== все dword, похожие на РАЗМЕР (0x100..0x200000) ===")
    for i in range(0, min(n, 0x1000), 4):
        v = struct.unpack_from("<I", data, i)[0]
        if 0x100 <= v <= 0x200000:
            print(f"  +0x{i:03X}  {v:10d}  0x{v:06X}")

    # --- проверим: может, данные закодированы XOR/ADD ---
    print("\n=== проверка простых преобразований на 0x80..0x90 ===")
    sample = data[0x80:0x90]
    print(f"  сырые:        {sample.hex()}")
    for name, fn in [
        ("XOR 0xFF", lambda b: bytes(x ^ 0xFF for x in b)),
        ("XOR 0x55", lambda b: bytes(x ^ 0x55 for x in b)),
        ("побитовый NOT", lambda b: bytes(x ^ 0xFF for x in b)),
        ("реверс байт", lambda b: b[::-1]),
        ("+1", lambda b: bytes((x + 1) & 0xFF for x in b)),
        ("-1", lambda b: bytes((x - 1) & 0xFF for x in b)),
    ]:
        print(f"  {name:<16}{fn(sample).hex()}")

    # --- ищем Thumb POP {PC} (0xBDxx) по всему файлу ---
    print("\n=== плотность 0xBDxx (Thumb POP{PC}) по блокам 64 КБ ===")
    B = 0x10000
    for off in range(0, n, B):
        chunk = data[off:off + B]
        cnt = 0
        for i in range(0, len(chunk) - 1, 2):
            if chunk[i] == 0xBD:
                cnt += 1
        if cnt > 0:
            print(f"  0x{off:06X}: BD-байт (чётн) = {cnt}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
