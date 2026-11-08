"""
Какие DLL MCC грузит динамически и какие функции резолвит.

MCC импортирует LoadLibraryW + GetProcAddress, но НЕ импортирует
CreateFileW/DeviceIoControl напрямую -> вендорский канал открывается
через отдельную DLL, загружаемую в рантайме.

Ищем:
  1. все строки, похожие на имя DLL;
  2. строки, похожие на имена функций (TUSBAUDIO_*, SetupDi*, ioctl...).

Только чтение файла.
"""

import re
import sys

import pefile

EXE = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"


def strings_of(data, minlen=4):
    out = []
    cur = bytearray()
    for b in data:
        if 32 <= b < 127:
            cur.append(b)
        else:
            if len(cur) >= minlen:
                out.append(cur.decode("ascii", "replace"))
            cur = bytearray()
    if len(cur) >= minlen:
        out.append(cur.decode("ascii", "replace"))
    return out


def main():
    pe = pefile.PE(EXE, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase

    all_strings = []
    for s in pe.sections:
        name = s.Name.rstrip(b"\x00").decode("ascii", "replace")
        va = base + s.VirtualAddress
        all_strings.extend(strings_of(s.get_data()))

    print(f"всего строк: {len(all_strings)}")

    # --- DLL ---
    print("\n=== кандидаты в имена DLL ===")
    dlls = sorted({s for s in all_strings if re.fullmatch(r"[\w\.\-]+\.dll", s, re.I)})
    for d in dlls:
        print(f"  {d}")

    # --- TUSBAUDIO / Thesycon ---
    print("\n=== TUSBAUDIO / Thesycon ===")
    tusb = sorted({s for s in all_strings if re.search(r"tusb|thesycon", s, re.I)})
    for t in tusb[:80]:
        print(f"  {t}")

    # --- другие подозрительные API ---
    print("\n=== прочие API-подобные строки ===")
    pat = re.compile(r"(SetupDi|CreateFile|DeviceIoControl|WriteFile|ReadFile|HidD_|hid_|IOCTL)", re.I)
    hits = sorted({s for s in all_strings if pat.search(s)})
    for h in hits[:80]:
        print(f"  {h}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
