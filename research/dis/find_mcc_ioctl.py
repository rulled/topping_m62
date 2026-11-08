"""
Найти вызовы DeviceIoControl в M Control Center и коды, которые в них передаются.

ИДЕЯ: MCC — единственный, кто знает правильный IOCTL. Вместо того чтобы
угадывать по драйверу, ищем в MCC:
    mov edx, <IOCTL>        ; 2-й аргумент DeviceIoControl
    ...
    call qword ptr [<IAT DeviceIoControl>]

Для x64: аргументы в rcx, rdx, r8, r9 -> код операции в edx.

Только чтение файла, ничего не запускается.
"""

import sys
from collections import Counter

import capstone
import pefile

EXE = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"


def get_import_iat(pe, dll_substr, func_name):
    """Адрес IAT-слота для импортируемой функции."""
    slots = []
    for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
        dll = entry.dll.decode("ascii", "replace").lower()
        if dll_substr.lower() not in dll:
            continue
        for imp in entry.imports:
            if imp.name and imp.name.decode("ascii", "replace") == func_name:
                slots.append(imp.address)
    return slots


def main():
    pe = pefile.PE(EXE, fast_load=True)
    pe.parse_data_directories(
        directories=[
            pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"],
            pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXCEPTION"],
        ]
    )
    base = pe.OPTIONAL_HEADER.ImageBase
    print(f"ImageBase = 0x{base:X}")

    slots = get_import_iat(pe, "kernel32", "DeviceIoControl")
    print(f"IAT-слотов DeviceIoControl: {len(slots)}")
    for s in slots:
        print(f"  0x{s:X}")
    if not slots:
        print("не найден импорт — возможно, грузится динамически")
        return 1

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    text = None
    for s in pe.sections:
        name = s.Name.rstrip(b"\x00").decode("ascii", "replace")
        if name == ".text":
            text = (s.get_data(), base + s.VirtualAddress)
            print(f".text: va=0x{text[1]:X} size=0x{len(text[0]):X}")
            break
    if text is None:
        print("нет .text")
        return 1

    code, va = text
    slot_set = set(slots)

    # Собираем инструкции в список, чтобы можно было смотреть назад.
    insns = []
    for ins in md.disasm(code, va):
        insns.append(ins)
    print(f"инструкций: {len(insns)}")

    calls = []
    for i, ins in enumerate(insns):
        if ins.mnemonic != "call":
            continue
        # call qword ptr [rip + disp]  -> operand mem
        if len(ins.operands) != 1:
            continue
        op = ins.operands[0]
        if op.type != capstone.x86.X86_OP_MEM:
            continue
        mem = op.mem
        if mem.base == capstone.x86.X86_REG_RIP:
            target = ins.address + ins.size + mem.disp
        elif mem.base == 0 and mem.index == 0:
            target = mem.disp
        else:
            continue
        if target not in slot_set:
            continue

        # Смотрим назад до 40 инструкций: ищем mov edx, imm32
        ioc = None
        for j in range(i - 1, max(-1, i - 41), -1):
            p = insns[j]
            if p.mnemonic == "mov" and len(p.operands) == 2:
                d, s2 = p.operands
                if d.type == capstone.x86.X86_OP_REG and d.reg in (
                    capstone.x86.X86_REG_EDX, capstone.x86.X86_REG_RDX
                ) and s2.type == capstone.x86.X86_OP_IMM:
                    ioc = s2.imm & 0xFFFFFFFF
                    break
            # если наткнулись на другой вызов — прекращаем поиск
            if p.mnemonic == "call":
                break
        if ioc is not None:
            calls.append((ioc, ins.address))

    print(f"\nвызовов DeviceIoControl с найденным кодом: {len(calls)}")
    c = Counter(v for v, _ in calls)
    print("\n=== коды операций ===")
    for v, n in c.most_common(50):
        print(f"  0x{v:08X}  x{n}   (Dev=0x{v>>16:04X} Acc={(v>>14)&3} Func=0x{(v>>2)&0xFFF:03X} M={v&3})")

    if calls:
        print("\n=== адреса вызовов (первые 30) ===")
        for v, a in calls[:30]:
            print(f"  0x{a:X}  code=0x{v:08X}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
