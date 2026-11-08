import re, struct, collections

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

# ---------------------------------------------------------
# Look for a TABLE of parameter ids: consecutive ascending ids
# in a limited range, adjacent in memory (16 or 32 bit cells).
# ---------------------------------------------------------
print("=== 1. ascending 16-bit runs (>=4 consecutive ids, delta 1) ===")
hits = []
i = 0
while i < N - 8:
    a = struct.unpack_from("<H", d, i)[0]
    b = struct.unpack_from("<H", d, i+2)[0]
    if b == a + 1:
        run = [a, b]
        j = i + 4
        while j < N - 2:
            c = struct.unpack_from("<H", d, j)[0]
            if c == run[-1] + 1:
                run.append(c); j += 2
            else:
                break
        if len(run) >= 4:
            hits.append((i, run))
        i = j
    else:
        i += 2
print("  runs found:", len(hits))
for off, run in hits[:25]:
    print("   %08x  len=%d  %s" % (off, len(run), " ".join("%04x" % x for x in run[:12])))

print("\n=== 2. ascending 32-bit runs (>=4 consecutive ids, delta 1) ===")
hits32 = []
i = 0
while i < N - 16:
    a = struct.unpack_from("<I", d, i)[0]
    b = struct.unpack_from("<I", d, i+4)[0]
    if b == a + 1 and 0 < a < 0x10000:
        run = [a, b]
        j = i + 8
        while j < N - 4:
            c = struct.unpack_from("<I", d, j)[0]
            if c == run[-1] + 1:
                run.append(c); j += 4
            else:
                break
        if len(run) >= 4:
            hits32.append((i, run))
        i = j
    else:
        i += 4
print("  runs found:", len(hits32))
for off, run in hits32[:25]:
    print("   %08x  len=%d  %s" % (off, len(run), " ".join("%04x" % x for x in run[:12])))

# ---------------------------------------------------------
# 3. the 0x44xx family: how many DISTINCT 0x44xx values appear as aligned dwords?
# ---------------------------------------------------------
print("\n=== 3. 0x000044xx family as aligned dwords ===")
found = collections.Counter()
for i in range(0, N-4, 4):
    v = struct.unpack_from("<I", d, i)[0]
    if 0x4400 <= v <= 0x44FF:
        found[v] += 1
if found:
    for v in sorted(found):
        print("   %04x x%d" % (v, found[v]))
else:
    print("   none")

print("\n=== 4. any 0x44xx as aligned 16-bit ===")
found = collections.Counter()
for i in range(0, N-2, 2):
    v = struct.unpack_from("<H", d, i)[0]
    if 0x4400 <= v <= 0x44FF:
        found[v] += 1
print("   distinct values:", len(found), "  total:", sum(found.values()))
for v in sorted(found)[:40]:
    print("     %04x x%d" % (v, found[v]))

# ---------------------------------------------------------
# 5. pointer table: consecutive dwords all pointing into image
# ---------------------------------------------------------
print("\n=== 5. dword values in 0x08000000-0x09000000 range (possible XIP/SDRAM addrs) ===")
c = collections.Counter()
for i in range(0, N-4, 4):
    v = struct.unpack_from("<I", d, i)[0]
    if 0x08000000 <= v < 0x09000000:
        c[v] += 1
print("   distinct:", len(c), " total:", sum(c.values()))
for v, k in c.most_common(15):
    print("     %08x x%d" % (v, k))

print("\n=== 6. dword values in 0x20000000-0x20100000 (RAM addrs) ===")
c = collections.Counter()
for i in range(0, N-4, 4):
    v = struct.unpack_from("<I", d, i)[0]
    if 0x20000000 <= v < 0x20100000:
        c[v] += 1
print("   distinct:", len(c), " total:", sum(c.values()))
for v, k in c.most_common(10):
    print("     %08x x%d" % (v, k))

print("\n=== 7. dword values in 0x00000000-0x00200000 (internal flash) ===")
c = collections.Counter()
for i in range(0, N-4, 4):
    v = struct.unpack_from("<I", d, i)[0]
    if 0 < v < 0x00200000 and v % 4 == 0:
        c[v] += 1
print("   distinct:", len(c), " total:", sum(c.values()))
for v, k in c.most_common(10):
    print("     %08x x%d" % (v, k))