import re, binascii, struct

p = r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping"
d = open(p, "rb").read()

# region labels (from entropy map, 64K blocks)
regions = [
    (0x000000, 0x060000, "HIGH 8.00  (encrypted/compressed)"),
    (0x060000, 0x070000, "6.95       transition"),
    (0x070000, 0x0a0000, "0.15-1.06  near-zero / padding"),
    (0x0a0000, 0x330000, "1.5-5.2    structured, low entropy"),
    (0x330000, 0x410000, "7.9-8.00   HIGH again"),
    (0x410000, 0x41c000, "5.5-7.6    tail"),
]
for a, b, label in regions:
    print("%08x - %08x  %s" % (a, b, label))

print()
print("=== search for ZDPTTTTTI repeats ===")
for m in re.finditer(rb"ZDPTTTTTI", d):
    print("  offset %08x" % m.start())

print()
print("=== ascii strings >= 8 chars in low-entropy region 0x0a0000-0x330000 ===")
sub = d[0x0a0000:0x330000]
seen = set()
n = 0
for m in re.finditer(rb"[\x20-\x7e]{8,}", sub):
    s = m.group().decode("ascii")
    if s in seen:
        continue
    seen.add(s)
    n += 1
    if n <= 60:
        print("   %08x  %s" % (0x0a0000 + m.start(), s[:90]))
print("   ... total unique:", n)

print()
print("=== dword histogram of the near-zero region (0x070000-0x0a0000) ===")
import collections
c = collections.Counter()
for i in range(0x070000, 0x0a0000, 4):
    c[struct.unpack_from("<I", d, i)[0]] += 1
for v, k in c.most_common(8):
    print("   %08x : %d" % (v, k))
