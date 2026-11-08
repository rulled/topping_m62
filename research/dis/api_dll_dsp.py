"""
Разбор ToppingProUsbAudioapi_x64.dll: как работает SetDspProperty.

ЦЕЛЬ: понять, каким способом DLL доставляет DSP-свойства в устройство
(микшер, EQ, эффекты). Если это тот же открытый вендорский интерфейс
{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46} + DeviceIoControl, мы сможем
повторить это сами, без MCC и без Thesycon SDK.

Шаги:
  1. экспорты + импорты DLL;
  2. найти адрес TUSBAUDIO_SetDspProperty / GetDspProperty;
  3. дизассемблировать их и проследить вызовы до DeviceIoControl.

Только чтение файла.
"""

import sys

import capstone
import pefile

DLL = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"

TARGETS = ("TUSBAUDIO_SetDspProperty", "TUSBAUDIO_GetDspProperty")


def main():
    pe = pefile.PE(DLL, fast_load=True)
    pe.parse_data_directories(
        directories=[
            pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"],
            pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXPORT"],
        ]
    )
    base = pe.OPTIONAL_HEADER.ImageBase
    print(f"ImageBase = 0x{base:X}")
    print(f"Machine = 0x{pe.FILE_HEADER.Machine:X}")
    for s in pe.sections:
        name = s.Name.rstrip(b"\x00").decode("ascii", "replace")
        print(f"  {name:<10} va=0x{base + s.VirtualAddress:08X} size=0x{len(s.get_data()):X}")

    # --- импорты ---
    print("\n=== импорты ===")
    iat = {}
    for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
        dll = entry.dll.decode("ascii", "replace")
        names = []
        for imp in entry.imports:
            nm = imp.name.decode("ascii", "replace") if imp.name else f"ord{imp.ordinal}"
            names.append(nm)
            iat[imp.address] = f"{dll}!{nm}"
        print(f"\n {dll} ({len(names)})")
        for n in names:
            print(f"    {n}")

    # --- экспорты: адреса наших целей ---
    print("\n=== наши цели в таблице экспорта ===")
    exp_addr = {}
    for exp in getattr(pe, "DIRECTORY_ENTRY_EXPORT", []).symbols:
        nm = exp.name.decode("ascii", "replace") if exp.name else f"ord{exp.ordinal}"
        if nm in TARGETS or "DspProperty" in nm:
            va = base + exp.address
            exp_addr[nm] = va
            print(f"  {nm:<40} 0x{va:X}")

    if not exp_addr:
        print("  не найдено по имени — возможно, экспорт по ординалу")

    # --- дизассемблер ---
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    text = next((s for s in pe.sections
                 if s.Name.rstrip(b"\x00") == b".text"), None)
    if text is None:
        print("нет .text")
        return 1
    code = text.get_data()
    tva = base + text.VirtualAddress

    # индексируем инструкции по адресу
    insns = {}
    order = []
    for ins in md.disasm(code, tva):
        insns[ins.address] = ins
        order.append(ins.address)

    for nm, va in exp_addr.items():
        if nm not in TARGETS:
            continue
        print(f"\n===== {nm} @ 0x{va:X} (первые 60 инструкций) =====")
        # дизассемблируем от va
        off = va - tva
        if off < 0 or off >= len(code):
            print("  адрес вне .text")
            continue
        n = 0
        for ins in md.disasm(code[off:], va):
            note = ""
            if ins.mnemonic == "call":
                op = ins.operands[0] if ins.operands else None
                if op and op.type == capstone.x86.X86_OP_MEM and op.mem.base == capstone.x86.X86_REG_RIP:
                    tgt = ins.address + ins.size + op.mem.disp
                    note = f"  ; IAT -> {iat.get(tgt, hex(tgt))}"
                elif op and op.type == capstone.x86.X86_OP_IMM:
                    note = f"  ; -> 0x{op.imm:X}"
            print(f"  0x{ins.address:X}: {ins.mnemonic:<8} {ins.op_str}{note}")
            n += 1
            if n >= 60 or (n > 3 and ins.mnemonic == "ret"):
                break

    return 0


if __name__ == "__main__":
    sys.exit(main())
