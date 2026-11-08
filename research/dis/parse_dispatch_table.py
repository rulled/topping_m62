"""
Разбор таблицы переходов диспетчера IOCTL в драйвере.

Найдено (0x140025BCE):
    cmp  edx, 0x80882104     ; верхняя граница диапазона
    ja   <default>
    je   <handler 0x80882104>
    lea  eax, [rdx + 0x7f77dffc]   ; eax = IOCTL - 0x80882004
    cmp  eax, 0xfc                 ; 252 допустимых значения
    ja   <default>
    lea  r8, [rip - 0x25bf8]       ; база таблицы
    movzx eax, byte [r8 + rax + 0x289c8]   ; смещение из байтовой таблицы
    mov  ecx, [r8 + rax*4 + 0x28968]       ; смещение из dword-таблицы
    add  rcx, r8
    jmp  rcx                       ; переход

Разбираем обе таблицы: база = 0x140025BF1 + (-0x25bf8) + ... — вычисляем
точные адреса и печатаем, какой обработчик соответствует какому IOCTL.

Только чтение файла.
"""

import struct
import sys

import pefile

SYS = r"C:\Windows\System32\DriverStore\FileRepository\toppingprousbaudio.inf_amd64_aa32a3c602bee5d4\ToppingProUsbAudio.sys"

IOCTL_MIN = 0x80882004
SPAN = 0xFC


def va_to_off(pe, va):
    for s in pe.sections:
        start = pe.OPTIONAL_HEADER.ImageBase + s.VirtualAddress
        size = max(s.Misc_VirtualSize, s.SizeOfRawData)
        if start <= va < start + size:
            return s.get_data(), va - start
    return None, None


def main():
    pe = pefile.PE(SYS, fast_load=True)

    # из дизассемблера: lea r8, [rip - 0x25bf8] при адресе 0x140025BF1
    # rip после инструкции = 0x140025BF8
    r8 = 0x140025BF8 - 0x25BF8
    print(f"база таблиц r8 = 0x{r8:X}")

    # байтовая таблица: [r8 + rax + 0x289c8]
    bytes_tbl_va = r8 + 0x289C8
    # dword-таблица: [r8 + rax*4 + 0x28968]
    dword_tbl_va = r8 + 0x28968
    print(f"байтовая таблица : 0x{bytes_tbl_va:X}")
    print(f"dword-таблица    : 0x{dword_tbl_va:X}")

    data, off = va_to_off(pe, bytes_tbl_va)
    if data is None:
        print("байтовая таблица вне секций")
        return 1
    bt = data[off: off + SPAN + 1]

    data2, off2 = va_to_off(pe, dword_tbl_va)
    if data2 is None:
        print("dword-таблица вне секций")
        return 1
    dt = data2[off2: off2 + (SPAN + 1) * 4]

    print(f"\nбайтовая таблица: {len(bt)} байт, первые: {bt[:16].hex()}")
    print(f"dword-таблица: {len(dt)} байт")

    print("\n=== карта IOCTL -> обработчик ===")
    entries = []
    for idx in range(SPAN + 1):
        ioc = IOCTL_MIN + idx
        rel = struct.unpack_from("<i", dt, idx * 4)[0]
        target = r8 + rel
        entries.append((ioc, bt[idx] if idx < len(bt) else -1, target))
        print(f"  0x{ioc:08X}  byte={bt[idx]:>3}  handler=0x{target:X}")

    # группируем по обработчику
    print("\n=== группировка по обработчику ===")
    from collections import defaultdict

    groups = defaultdict(list)
    for ioc, b, t in entries:
        groups[t].append(ioc)
    for t in sorted(groups):
        lst = groups[t]
        if len(lst) > 6:
            print(f"  0x{t:X}: {len(lst)} IOCTL ({len(lst)} шт., первый 0x{lst[0]:08X}, последний 0x{lst[-1]:08X})")
        else:
            print(f"  0x{t:X}: {', '.join(f'0x{i:08X}' for i in lst)}")

    # отдельно: интересующие нас
    print("\n=== интересующие IOCTL ===")
    want = [0x80882200, 0x80882204, 0x80882086, 0x80882004]
    for w in want:
        rel = w - 0x80882004
        if 0 <= rel <= 0xFC:
            target = entries[rel][2]
            print(f"  0x{w:08X}: idx={rel} -> обработчик 0x{target:X}")
        else:
            print(f"  0x{w:08X}: вне диапазона таблицы (rel={rel})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
