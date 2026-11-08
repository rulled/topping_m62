import re, struct, collections

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

def dump(off, n=128, label=""):
    print("--- %s @ 0x%06x ---" % (label, off))
    for i in range(0, n, 16):
        if off+i >= N: break
        print("  %06x  %s  |%s|" % (off+i,
            " ".join("%02x" % b for b in d[off+i:off+i+16]),
            "".join(chr(b) if 32 <= b < 127 else "." for b in d[off+i:off+i+16])))

# sub-image candidates from header entries
for off, size, label in [
    (0x00f18a, 0x5797, "entry A  (0xf18a, len 0x5797)"),
    (0x105fc8, 0xc171, "entry B  (0x105fc8, len 0xc171)"),
    (0x002000, 0x100,  "low region"),
    (0x008000, 0x100,  "0x8000 (looked like 16-bit code)"),
    (0x0129000-0x100, 0x100, "very end"),
]:
    if off + 16 <= N:
        dump(off, 64, label)

print("\n=== what is at 0x20568e? (beyond EOF, so it's an address) ===")
print("  file size =", hex(N), " 0x20568e =", 0x20568e)

# Look for a 16-bit-looking code stream: print opcode-pair histogram of region
print("\n=== 16-bit word histogram, region 0x8000-0x20000 ===")
c = collections.Counter()
for i in range(0x8000, min(0x20000, N-2), 2):
    c[struct.unpack_from("<H", d, i)[0]] += 1
for v, k in c.most_common(20):
    print("   %04x : %d" % (v, k))

print("\n=== 16-bit word histogram, region 0x20000-0x40000 ===")
c = collections.Counter()
for i in range(0x20000, min(0x40000, N-2), 2):
    c[struct.unpack_from("<H", d, i)[0]] += 1
for v, k in c.most_common(20):
    print("   %04x : %d" % (v, k))

# RISC-V probe: compressed instructions have (b0 & 3) != 3
print("\n=== RISC-V-ish probe: fraction of 16-bit units with low2 != 11 ===")
for name, a, b in [("0x8000", 0x8000, 0x20000), ("0x20000", 0x20000, 0x40000),
                   ("0x60000", 0x60000, 0x90000), ("0xa0000", 0xa0000, 0xe0000)]:
    tot = 0; ok = 0
    for i in range(a, min(b, N-2), 2):
        w = struct.unpack_from("<H", d, i)[0]
        tot += 1
        if (w & 3) != 3:
            ok += 1
    print("   %s  %d/%d = %.1f%%" % (name, ok, tot, 100.0*ok/tot if tot else 0))