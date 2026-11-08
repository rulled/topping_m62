"""
Разбор ВТОРОЙ таблицы диспетчера (для IOCTL > 0x80882104).

Из дизассемблера 0x140026EDC:
    cmp  edx, 0x80882210
    ja   <default>
    je   <handler>
    lea  eax, [rdx + 0x7f77def8]     ; eax = IOCTL - 0x80882108
    cmp  eax, 0xfc
    lea  r8, [rip - 0x26f06]         ; база
    movzx eax, byte [r8 + rax + 0x28b10]   ; байтовая таблица
    mov  ecx, [r8 + rax*4 + 0x28ac8]       ; dword-таблица
    add  rcx, r8
    jmp  rcx

rax = IOCTL - 0x80882108.
База r8 = (0x140026F06) - 0x26F06 = 0x140000000.

Значит:
  байтовая таблица : 0x140000000 + 0x28B10 = 0x140028B10
  dword-таблица    : 0x140000000 + 0x28AC8 = 0x140028AC8

Только чтение файла.
"""

import struct
import sys

import pefile

SYS = r"C:\Windows\System32\DriverStore\FileRepository\toppingprousbaudio.inf_amd64_aa32a3c602bee5d4\ToppingProUsbAudio.sys"

BASE_OFF = 0x80882108
SPAN = 0xFC


def va_to_data(pe, va):
    for s in pe.sections:
        start = pe.OPTIONAL_HEADER.ImageBase + s.VirtualAddress
        size = max(s.Misc_VirtualSize, s.SizeOfRawData)
        if start <= va < start + size:
            return s.get_data(), va - start
    return None, None


def main():
    pe = pefile.PE(SYS, fast_load=True)
    r8 = 0x140000000  # (0x140026F06) - 0x26F06

    bytes_va = r8 + 0x28B10
    dword_va = r8 + 0x28AC8
    print(f"байтовая таблица : 0x{bytes_va:X}")
    print(f"dword-таблица    : 0x{dword_va:X}")

    bdata, boff = va_to_data(pe, bytes_va)
    ddata, doff = va_to_data(pe, dword_va)
    if bdata is None or ddata is None:
        print("таблицы вне секций")
        return 1

    bt = bdata[boff: boff + SPAN + 1]
    dt = ddata[doff: doff + (SPAN + 1) * 4]
    print(f"  байт: {bt[:20].hex()}")
    print(f"  dword: {dt[:20].hex()}")

    print("\n=== карта (только ненулевые/интересные) ===")
    rows = []
    for idx in range(SPAN + 1):
        ioc = BASE_OFF + idx
        rel = struct.unpack_from("<i", dt, idx * 4)[0]
        target = r8 + rel
        rows.append((ioc, bt[idx], target))

    # печатаем всё, но компактно
    for ioc, b, t in rows:
        # нас интересуют области DSP: 0x80882200, 0x80882204, 0x80882210
        if ioc in (0x80882200, 0x80882204, 0x80882208, 0x8088220C, 0x80882210):
            print(f"  *0x{ioc:08X}  byte={b:>3}  handler=0x{t:X}")
        elif b != 23:
            print(f"   0x{ioc:08X}  byte={b:>3}  handler=0x{t:X}")

    # сводка по обработчикам для 0x80882200/0x80882204
    print("\n=== ВЫВОД ===")
    for want in (0x80882200, 0x80882204, 0x80882210):
        idx = want - BASE_OFF
        if 0 <= idx <= SPAN:
            rel = struct.unpack_from("<i", dt, idx * 4)[0]
            print(f"  0x{want:08X}: idx={idx}, byte={bt[idx]}, handler=0x{r8 + rel:X}")
        else:
            print(f"  0x{want:08X}: вне диапазона (idx={idx})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
