"""
Поиск IOCTL-констант 0x8088xxxx в ДРАЙВЕРЕ ToppingProUsbAudio.sys.

ВАЖНО: в прошлый раз фильтр в find_ioctl.py отбрасывал эти значения,
потому что проверял (v >> 16) <= 0xFF, а у 0x80882204 старшее слово
равно 0x8088. Поэтому раньше «ничего не нашли».

Теперь ищем точное вхождение нужных констант как imm32 (LE) и
показываем контекст дизассемблера.

Только чтение файла.
"""

import struct
import sys

import capstone
import pefile

SYS = r"C:\Windows\System32\DriverStore\FileRepository\toppingprousbaudio.inf_amd64_aa32a3c602bee5d4\ToppingProUsbAudio.sys"

WANTED = [0x80882200, 0x80882204, 0x80882086, 0x80882004]


def main():
    pe = pefile.PE(SYS, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    secs = []
    for s in pe.sections:
        name = s.Name.rstrip(b"\x00").decode("ascii", "replace")
        secs.append((name, s.get_data(), base + s.VirtualAddress))
        print(f"  {name:<8} va=0x{base + s.VirtualAddress:08X} size=0x{len(s.get_data()):X}")

    print("\n=== поиск констант как сырых dword (LE) ===")
    hits = {}
    for name, data, va in secs:
        for want in WANTED:
            pat = struct.pack("<I", want)
            off = 0
            while True:
                i = data.find(pat, off)
                if i < 0:
                    break
                hits.setdefault(want, []).append((name, va + i))
                off = i + 1

    for want in WANTED:
        lst = hits.get(want, [])
        print(f"  0x{want:08X}: {len(lst)} вхождений")
        for name, a in lst[:8]:
            print(f"      {name} @ 0x{a:X}")

    if not any(hits.values()):
        print("\n  константы НЕ найдены как данные — драйвер собирает IOCTL")
        print("  из базового значения и индекса функции (сдвиги/OR).")

    # --- поиск любых 0x8088xxxx в .text как imm ---
    print("\n=== любые 0x8088xxxx в .text (imm32) ===")
    text = next((d for n, d, v in secs if n == ".text"), None)
    tva = next((v for n, d, v in secs if n == ".text"), None)
    if text is None:
        print("  нет .text")
        return 1

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    found = []
    for ins in md.disasm(text, tva):
        if ins.mnemonic not in ("mov", "cmp", "or", "and", "lea", "add", "sub"):
            continue
        for op in ins.operands:
            if op.type == capstone.x86.X86_OP_IMM:
                v = op.imm & 0xFFFFFFFF
                if 0x80882000 <= v <= 0x808823FF:
                    found.append((ins.address, v, ins.mnemonic, ins.op_str))
    print(f"  найдено: {len(found)}")
    seen = set()
    for a, v, m, s in found:
        key = (v, m)
        if key in seen:
            continue
        seen.add(key)
        print(f"    0x{a:X}: {m:<6} {s}")

    # --- дизассемблируем вокруг найденных ---
    if found:
        print("\n=== контекст вокруг первого вхождения ===")
        a0 = found[0][0]
        start = max(tva, a0 - 0x60)
        n = 0
        for ins in md.disasm(text[start - tva: a0 - tva + 0x80], start):
            mark = " <<<" if ins.address == a0 else ""
            print(f"    0x{ins.address:X}: {ins.mnemonic:<8} {ins.op_str}{mark}")
            n += 1
            if n > 50:
                break

    return 0


if __name__ == "__main__":
    sys.exit(main())
