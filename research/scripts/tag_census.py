"""
Полная перепись тегоподобных 32-битных констант в MCC и KBCC.

Один проход по файлу (numpy, скользящее окно u32), без 256 итераций на семейство.
Тег по протоколу = (TT << 8) | PP, где TT — старший байт.
Ищем все u32, у которых байт (u32 >> 8) & 0xFF попадает в набор «семейств».
"""
import sys
import numpy as np

FAMILIES = {
    0x11: "device", 0x12: "device2", 0x13: "device3",
    0x21: "in1", 0x22: "in2", 0x23: "aux", 0x25: "bt", 0x27: "otgin",
    0x31: "out?", 0x32: "out?", 0x33: "out?", 0x34: "out?", 0x35: "out?", 0x36: "out?",
    0x41: "?", 0x42: "?", 0x43: "?", 0x44: "EFFECT", 0x45: "?", 0x46: "?",
    0x51: "loop", 0x52: "loop", 0x53: "loop", 0x54: "loop", 0x55: "loop", 0x56: "loop",
    0x57: "loop", 0x58: "loop", 0x59: "loop", 0x5a: "loop", 0x5b: "loop", 0x5c: "loop",
    0x60: "MIXER", 0x61: "outotg?", 0x62: "outotg", 0x63: "outhp?", 0x64: "outhp",
    0x90: "EQ", 0x91: "EQ", 0x92: "EQ", 0x93: "EQ", 0x94: "EQ", 0x95: "EQ",
    0x96: "EQ?", 0x97: "EQ?", 0x98: "EQ?", 0x99: "EQ?", 0x9a: "EQ?", 0x9b: "EQFX?",
    0xa0: "EQHP", 0xa1: "EQHP", 0xa8: "EQHP?", 0xa9: "EQHP?", 0xaa: "EQHP?", 0xab: "EQHP",
    0xb1: "?", 0xb3: "comp", 0xb7: "duck", 0xb8: "duck",
    0xc1: "?", 0xc5: "echo", 0xc6: "reverb",
}


def census(path, label):
    data = np.fromfile(path, dtype=np.uint8)
    n = data.size
    counts = {}
    first_off = {}
    CH = 1 << 22
    for start in range(0, n - 4, CH):
        end = min(start + CH + 3, n)
        a = data[start:end].astype(np.uint32)
        u = a[:-3] | (a[1:-2] << 8) | (a[2:-1] << 16) | (a[3:] << 24)
        fam = (u >> 8) & 0xFF
        mask = np.isin(fam, np.fromiter(FAMILIES.keys(), dtype=np.uint32, count=len(FAMILIES)))
        idx = np.nonzero(mask)[0]
        for i in idx:
            key = int(u[i])
            counts[key] = counts.get(key, 0) + 1
            first_off.setdefault(key, start + int(i))
    print("=" * 78)
    print(label, " size=", n)
    print("=" * 78)
    by_fam = {}
    for tag, c in counts.items():
        by_fam.setdefault(tag >> 8, []).append((tag & 0xFF, c, first_off[tag]))
    for fam in sorted(by_fam):
        items = sorted(by_fam[fam])
        name = FAMILIES.get(fam, "?")
        print("\n-- TT=0x%02x  (%s)  тегов: %d" % (fam, name, len(items)))
        line = []
        for pp, c, off in items:
            line.append("%02x:%d@%x" % (pp, c, off))
        for i in range(0, len(line), 8):
            print("     " + "  ".join(line[i:i + 8]))
    return counts


if __name__ == "__main__":
    targets = [
        (r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe", "MCC"),
        (r"C:\Program Files\TOPPING Pro\KB Control Center\KB Control Center.exe", "KBCC"),
    ]
    for p, l in targets:
        try:
            census(p, l)
        except FileNotFoundError:
            print("нет файла:", p)
