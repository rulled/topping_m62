"""
Найти в MCC место, где используется наш вендорский интерфейс
{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}, и что делается с открытым handle.

ПОДХОД:
  1. найти в бинаре GUID интерфейса (структура GUID: 4+2+2+8 байт);
  2. найти ссылки (lea reg, [rip+disp]) на это место в .text;
  3. вокруг ссылки — дизассемблировать окно и посмотреть вызовы.

Только чтение файла.
"""

import struct
import sys

import capstone
import pefile

EXE = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"

# {E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}
GUID_BYTES = struct.pack("<IHH8B",
                         0xE97E1508, 0x2A66, 0x4DF8,
                         0xB7, 0xA7, 0x32, 0xD6, 0xE5, 0xFC, 0xBA, 0x46)


def main():
    pe = pefile.PE(EXE, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase

    sections = []
    for s in pe.sections:
        name = s.Name.rstrip(b"\x00").decode("ascii", "replace")
        sections.append((name, s.get_data(), base + s.VirtualAddress))
        print(f"{name:<10} va=0x{base + s.VirtualAddress:08X} size=0x{len(s.get_data()):X}")

    # --- ищем GUID в любом виде ---
    print("\n=== поиск GUID интерфейса ===")
    guid_vas = []
    for name, data, va in sections:
        off = 0
        while True:
            i = data.find(GUID_BYTES, off)
            if i < 0:
                break
            guid_vas.append(va + i)
            print(f"  найден в {name} по VA 0x{va + i:X}")
            off = i + 1
    # ascii-форма
    ascii_forms = [
        b"E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46",
        b"e97e1508-2a66-4df8-b7a7-32d6e5fcba46",
        b"{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}",
        b"{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}",
    ]
    for name, data, va in sections:
        for f in ascii_forms:
            off = 0
            while True:
                i = data.find(f, off)
                if i < 0:
                    break
                print(f"  ascii {f[:12]!r}... в {name} по VA 0x{va + i:X}")
                off = i + 1

    if not guid_vas:
        print("\nGUID как структура НЕ найден — возможно, собирается из строки")

    # --- ссылки на найденные GUID из кода ---
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    text = next((d for n, d, v in sections if n == ".text"), None)
    tva = next((v for n, d, v in sections if n == ".text"), None)
    if text is None:
        print("нет .text")
        return 1

    print("\n=== ссылки (lea/mov) на GUID-структуры из .text ===")
    targets = set(guid_vas)
    refs = []
    for ins in md.disasm(text, tva):
        if ins.mnemonic not in ("lea", "mov"):
            continue
        for op in ins.operands:
            if op.type == capstone.x86.X86_OP_MEM and op.mem.base == capstone.x86.X86_REG_RIP:
                t = ins.address + ins.size + op.mem.disp
                if t in targets:
                    refs.append((ins.address, t, ins.mnemonic))
    for a, t, m in refs:
        print(f"  0x{a:X}  {m} -> 0x{t:X}")

    # --- окно дизассемблера вокруг каждой ссылки ---
    for a, t, m in refs[:6]:
        print(f"\n===== контекст вокруг 0x{a:X} =====")
        start = max(tva, a - 0xE0)
        window = text[start - tva: a - tva + 0x100]
        for ins in md.disasm(window, start):
            mark = " <<<" if ins.address == a else ""
            line = f"  0x{ins.address:X}: {ins.mnemonic:<8} {ins.op_str}{mark}"
            print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
