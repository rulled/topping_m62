import os, re, collections, math

files = [
    r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin",
    r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping",
]

def entropy(b):
    if not b:
        return 0.0
    c = collections.Counter(b)
    n = len(b)
    return -sum((v / n) * math.log2(v / n) for v in c.values())

for p in files:
    d = open(p, "rb").read()
    print("=" * 72)
    print(os.path.basename(p), len(d))
    step = 4096
    print("offset      entropy  preview")
    for off in range(0, len(d), step):
        chunk = d[off:off + step]
        e = entropy(chunk)
        bar = "#" * int(e * 4)
        print("%08x  %5.2f  %s" % (off, e, bar))
    print()
