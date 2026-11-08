"""
Вторая таблица диспетчера IOCTL — там живут DSP-свойства.

Из первой таблицы: `cmp edx, 0x80882104; ja 0x140026EDC`.
Значит для IOCTL > 0x80882104 управление уходит в 0x140026EDC,
где найдено `cmp edx, 0x80882210`.

Нас интересуют 0x80882200 (GetDspProperty) и 0x80882204 (SetDspProperty).

Разбираем:
  1. дизассемблер 0x140026EDC — какие IOCTL там перечислены;
  2. для 0x80882200 — какой обработчик;
  3. структуру inBuf/outBuf из обработчика.

Только чтение файла.
"""

import struct
import sys

import capstone
import pefile

SYS = r"C:\Windows\System32\DriverStore\FileRepository\toppingprousbaudio.inf_amd64_aa32a3c602bee5d4\ToppingProUsbAudio.sys"


def main():
    pe = pefile.PE(SYS, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    text = next(s for s in pe.sections if s.Name.rstrip(b"\x00") == b".text")
    code = text.get_data()
    tva = base + text.VirtualAddress

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    # --- 1. дизассемблер второй ветки ---
    print("=== вторая ветка диспетчера 0x140026EDC ===")
    va = 0x140026EDC
    off = va - tva
    n = 0
    for ins in md.disasm(code[off: off + 0x300], va):
        print(f"  0x{ins.address:X}: {ins.mnemonic:<8} {ins.op_str}")
        n += 1
        if n > 40:
            break

    # --- 2. все cmp с 0x8088xxxx в этом диапазоне адресов ---
    print("\n=== все cmp edx/eax с 0x8088xxxx в области 0x140025B00..0x140029000 ===")
    found = []
    for ins in md.disasm(code[0x140025B00 - tva: 0x140029000 - tva], 0x140025B00):
        if ins.mnemonic == "cmp" and len(ins.operands) == 2:
            for op in ins.operands:
                if op.type == capstone.x86.X86_OP_IMM:
                    v = op.imm & 0xFFFFFFFF
                    if 0x80882000 <= v <= 0x808823FF:
                        found.append((ins.address, v, ins.op_str))
    for a, v, s in found:
        print(f"  0x{a:X}: cmp {s}   (0x{v:08X})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
