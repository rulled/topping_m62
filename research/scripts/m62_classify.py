import re, struct, collections, math, os

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("="*76)
print("ГИПОТЕЗА: файл = [код-регионы] + [табличные регионы], НЕ шифр")
print("="*76)

# Идея: в табличных регионах доминируют несколько 16-битных слов.
# В кодовых — распределение широкое. Меряем по 4К блокам.

def top16_share(b):
    w = [struct.unpack_from("<H", b, i)[0] for i in range(0, len(b)-1, 2)]
    c = collections.Counter(w)
    return sum(v for _, v in c.most_common(16)) / len(w), len(c)

print("\n=== классификация 4К-блоков ===")
classes = []
for off in range(0, N - 4096, 4096):
    b = d[off:off+4096]
    share, uniq = top16_share(b)
    # энтропия
    c = collections.Counter(b); n = len(b)
    e = -sum((v/n)*math.log2(v/n) for v in c.values())
    if e > 7.5:      cls = "RANDOM/ENC"
    elif share > 0.35: cls = "TABLE"
    elif share < 0.12: cls = "CODE"
    else:            cls = "MIXED"
    classes.append((off, e, share, uniq, cls))

agg = collections.Counter(c[4] for c in classes)
print("  итого блоков:", len(classes))
for k, v in agg.most_common():
    print("   %-12s %4d  (%.1f%%)" % (k, v, 100*v/len(classes)))

print("\n=== карта по 64К ===")
print("  %-10s %-11s %s" % ("offset", "тип(доля)", "раскладка 16 блоков по 4К (°=plt)"))
for base in range(0, N, 0x10000):
    sub = [c for c in classes if base <= c[0] < base+0x10000]
    if not sub: continue
    cnt = collections.Counter(c[4] for c in sub)
    dom = cnt.most_common(1)[0][0]
    bar = ""
    for c in sub:
        bar += {"CODE":"C","TABLE":"T","MIXED":"m","RANDOM/ENC":"R"}[c[4]]
    print("  %08x  %-11s %s" % (base, dom, bar))

print("\n=== границы регионов ===")
prev = None
start = 0
for off, e, share, uniq, cls in classes:
    if cls != prev:
        if prev is not None:
            print("  %08x - %08x   %s" % (start, off, prev))
        prev = cls; start = off
print("  %08x - %08x   %s" % (start, N, prev))

print("\n=== первые 4 блока каждого класса (пример) ===")
shown = set()
for off, e, share, uniq, cls in classes:
    if cls in shown: continue
    shown.add(cls)
    print("  %s @%08x  entropy=%.2f top16=%.1f%% uniq16=%d" % (cls, off, e, 100*share, uniq))
    for i in range(0, 64, 16):
        print("      %06x  %s  |%s|" % (off+i,
            " ".join("%02x" % x for x in d[off+i:off+i+16]),
            "".join(chr(x) if 32<=x<127 else "." for x in d[off+i:off+i+16])))