"""
Найти, каким IOCTL драйвер отдаёт ТАБЛИЦУ DSP-свойств.

Логика: SetDspProperty проверяет propId по таблице в контексте
(ctx+0x70 .. ctx+0x78), элемент 16 байт, [elem+0] == id.
Значит таблицу кто-то заполняет. Ищем запись в +0x70/+0x78
или цикл, который её строит.

Дополнительно: в DLL есть IOCTL 0x80882086 (6 вхождений) —
похоже на «получить список».

Только чтение файла.
"""

import sys

import capstone
import pefile

DLL = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"


def main():
    pe = pefile.PE(DLL, fast_load=True)
    pe.parse_data_directories(
        directories=[
            pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXPORT"],
            pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"],
        ]
    )
    base = pe.OPTIONAL_HEADER.ImageBase
    text = next(s for s in pe.sections if s.Name.rstrip(b"\x00") == b".text")
    code = text.get_data()
    tva = base + text.VirtualAddress

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    # --- кто пишет в смещение +0x70 / +0x78 (таблица свойств) ---
    print("=== инструкции, затрагивающие [reg+0x70]/[reg+0x78] ===")
    hits = []
    for ins in md.disasm(code, tva):
        s = ins.op_str
        if ("+ 0x70]" in s or "+ 0x78]" in s) and ins.mnemonic in (
            "mov", "lea", "add", "sub", "cmp"
        ):
            hits.append((ins.address, ins.mnemonic, s))
    for a, m, s in hits[:60]:
        print(f"  0x{a:X}: {m:<6} {s}")
    print(f"  всего: {len(hits)}")

    # --- области вокруг IOCTL 0x80882086 ---
    print("\n=== контекст IOCTL 0x80882086 (возможно, получение списка) ===")
    targets = [0x18000A0DF, 0x18000A329, 0x18000AE96, 0x18000AF6E]
    for t in targets[:2]:
        start = max(tva, t - 0x60)
        print(f"\n  --- вокруг 0x{t:X} ---")
        n = 0
        for ins in md.disasm(code[start - tva: t - tva + 0x90], start):
            mark = " <<<" if abs(ins.address - t) < 8 else ""
            print(f"    0x{ins.address:X}: {ins.mnemonic:<8} {ins.op_str}{mark}")
            n += 1
            if n > 45:
                break

    return 0


if __name__ == "__main__":
    sys.exit(main())
