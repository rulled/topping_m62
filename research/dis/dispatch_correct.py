"""
ПРАВИЛЬНЫЙ разбор диспетчера: двойная индексация.

Код (ветка 2, 0x140026EFF):
    lea   r8, [rip - 0x26f06]              ; r8 = 0x140000000
    movzx eax, byte [r8 + rax + 0x28B10]   ; eax = БАЙТ по индексу (IOCTL-base)
    mov   ecx, dword [r8 + rax*4 + 0x28AC8]; ecx = СМЕЩЕНИЕ по индексу = eax
    add   rcx, r8
    jmp   rcx

То есть:
    idx  = IOCTL - base
    grp  = bytes_table[idx]          <- номер группы
    off  = dwords_table[grp]         <- относительное смещение обработчика
    handler = 0x140000000 + off

Раньше я ошибочно брал dwords_table[idx] — отсюда абсурдные адреса.

Только чтение файла.
"""

import struct
import sys

import pefile

SYS = r"C:\Windows\System32\DriverStore\FileRepository\toppingprousbaudio.inf_amd64_aa32a3c602bee5d4\ToppingProUsbAudio.sys"

BASE = 0x140000000

# (название, база IOCTL, SPAN, смещение байтовой таблицы, смещение dword-таблицы)
TABLES = [
    ("ветка 1", 0x80882004, 0xFC, 0x289C8, 0x28968),
    ("ветка 2", 0x80882108, 0xFC, 0x28B10, 0x28AC8),
    ("ветка 3", 0x8088210C, 0x58, 0x28C50, 0x28C10),
]


def va_to_data(pe, va):
    for s in pe.sections:
        start = pe.OPTIONAL_HEADER.ImageBase + s.VirtualAddress
        size = max(s.Misc_VirtualSize, s.SizeOfRawData)
        if start <= va < start + size:
            return s.get_data(), va - start
    return None, None


def main():
    pe = pefile.PE(SYS, fast_load=True)

    for name, base_ioctl, span, boff_rel, doff_rel in TABLES:
        bva = BASE + boff_rel
        dva = BASE + doff_rel
        bdata, bo = va_to_data(pe, bva)
        ddata, do = va_to_data(pe, dva)
        if bdata is None or ddata is None:
            print(f"{name}: таблицы вне секций")
            continue

        print(f"\n=== {name}: IOCTL 0x{base_ioctl:08X}..0x{base_ioctl + span:08X} ===")
        print(f"  байты @0x{bva:X}  dwords @0x{dva:X}")

        for idx in range(span + 1):
            ioc = base_ioctl + idx
            if idx >= len(bdata) - bo:
                break
            grp = bdata[bo + idx]
            if grp * 4 + 4 > len(ddata) - do:
                continue
            off = struct.unpack_from("<i", ddata, do + grp * 4)[0]
            handler = BASE + off
            mark = ""
            if ioc in (0x80882200, 0x80882204, 0x80882086):
                mark = "   <<<< DSP"
            # печатаем только «содержательные» (не default) либо интересные
            if grp != 0x17 and grp != 0x0F or mark:
                print(f"  0x{ioc:08X} idx={idx:>3} grp={grp:>2} -> 0x{handler:X}{mark}")

    # --- отдельно: наши DSP ---
    print("\n=== ИТОГ: DSP-обработчики ===")
    for want in (0x80882200, 0x80882204):
        done = False
        for name, base_ioctl, span, boff_rel, doff_rel in TABLES:
            if not (base_ioctl <= want <= base_ioctl + span):
                continue
            idx = want - base_ioctl
            bdata, bo = va_to_data(pe, BASE + boff_rel)
            ddata, do = va_to_data(pe, BASE + doff_rel)
            grp = bdata[bo + idx]
            off = struct.unpack_from("<i", ddata, do + grp * 4)[0]
            print(f"  0x{want:08X}: {name} idx={idx} grp={grp} -> 0x{BASE + off:X}")
            done = True
            break
        if not done:
            print(f"  0x{want:08X}: не найдено ни в одной ветке")

    return 0


if __name__ == "__main__":
    sys.exit(main())
