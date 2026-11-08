"""
Перепись базовых тегов, задаваемых через `or eax, imm32` (и `or r32, imm32`).

Микшер собирает тег как `база | номер_канала`, где база — константа в `or`.
Кодировка:
   0D <imm32>      or eax, imm32
   0D /r ib          or r/m32, imm32 (C1? нет) — здесь только 0D
   81 C8 <imm32>   or eax, imm32
   81 C9 <imm32>   or ecx, imm32
   81 CA/CB/...    другие регистры
   D1 /1, C1 /1     сдвиги, не интересуют
"""
import re
from collections import Counter

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"


def main():
    d = open(PATH, "rb").read()
    n = len(d)
    found = Counter()

    # 0D <imm32>  — короткая форма or eax, imm32
    for m in re.finditer(rb"\x0d(....)", d, re.S):
        v = int.from_bytes(m.group(1), "little")
        if 0x1000 <= v <= 0xFFFF:
            found[v] += 1

    # 81 C8..CF <imm32> — or r32, imm32
    for m in re.finditer(rb"\x81[\xc8-\xcf](....)", d, re.S):
        v = int.from_bytes(m.group(1), "little")
        if 0x1000 <= v <= 0xFFFF:
            found[v] += 1

    print("базовых значений через or: %d уникальных" % len(found))
    fams = {}
    for v, c in found.items():
        fams.setdefault(v >> 8, []).append((v & 0xFF, c))
    for fam in sorted(fams):
        items = sorted(fams[fam])
        print("  TT=0x%02x  базы: %s"
              % (fam, " ".join("%04x(%d)" % (fam << 8 | p, c) for p, c in items)))


if __name__ == "__main__":
    main()
