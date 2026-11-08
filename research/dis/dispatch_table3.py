"""
ТРЕТЬЯ таблица диспетчера — диапазон IOCTL 0x8088210C..0x80882804.

Из 0x140027809:
    cmp  edx, 0x80882804
    ja   <default>
    je   <handler 0x80882804>
    lea  eax, [rdx + 0x7f77ddec]    ; eax = IOCTL - 0x8088210C
    cmp  eax, 0x58                  ; 89 значений
    lea  r8, [rip - 0x27831]        ; база
    movzx eax, byte [r8 + rax + 0x28c50]
    mov  ecx, [r8 + rax*4 + 0x28c10]
    add  rcx, r8
    jmp  rcx

rax = IOCTL - 0x8088210C.
база r8 = 0x140027831 - 0x27831 = 0x140000000
  байтовая таблица: 0x140000000 + 0x28C50 = 0x140028C50
  dword-таблица   : 0x140000000 + 0x28C10 = 0x140028C10

Только чтение файла.
"""

import struct
import sys

import pefile

SYS = r"C:\Windows\System32\DriverStore\FileRepository\toppingprousbaudio.inf_amd64_aa32a3c602bee5d4\ToppingProUsbAudio.sys"

BASE_OFF = 0x8088210C
SPAN = 0x58


def va_to_data(pe, va):
    for s in pe.sections:
        start = pe.OPTIONAL_HEADER.ImageBase + s.VirtualAddress
        size = max(s.Misc_VirtualSize, s.SizeOfRawData)
        if start <= va < start + size:
            return s.get_data(), va - start
    return None, None


def main():
    pe = pefile.PE(SYS, fast_load=True)
    r8 = 0x140000000

    bytes_va = r8 + 0x28C50
    dword_va = r8 + 0x28C10
    print(f"байтовая таблица : 0x{bytes_va:X}")
    print(f"dword-таблица    : 0x{dword_va:X}")

    bdata, boff = va_to_data(pe, bytes_va)
    ddata, doff = va_to_data(pe, dword_va)
    bt = bdata[boff: boff + SPAN + 1]
    dt = ddata[doff: doff + (SPAN + 1) * 4]
    print(f"  байт: {bt.hex()}")

    print("\n=== полная карта 0x8088210C..0x80882804 ===")
    for idx in range(SPAN + 1):
        ioc = BASE_OFF + idx
        rel = struct.unpack_from("<i", dt, idx * 4)[0]
        target = r8 + rel
        mark = ""
        if ioc in (0x80882200, 0x80882204):
            mark = "  <<<< DSP"
        print(f"  0x{ioc:08X}  byte={bt[idx]:>3}  handler=0x{target:X}{mark}")

    print("\n=== ИТОГ по DSP ===")
    for want in (0x80882200, 0x80882204):
        idx = want - BASE_OFF
        rel = struct.unpack_from("<i", dt, idx * 4)[0]
        print(f"  0x{want:08X}: idx={idx} byte={bt[idx]} handler=0x{r8 + rel:X}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
