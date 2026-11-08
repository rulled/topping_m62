import re, struct, collections, math, zlib

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("=== header 160 bytes hex ===")
for i in range(0, 160, 16):
    print("  %04x  %s  |%s|" % (i,
        " ".join("%02x" % b for b in d[i:i+16]),
        "".join(chr(b) if 32 <= b < 127 else "." for b in d[i:i+16])))

print("\n=== dword table at 0x00 ===")
for i in range(0, 0x80, 4):
    v = struct.unpack_from("<I", d, i)[0]
    print("  +%02x  %10d  0x%08x" % (i, v, v))

# ---- compression / container signatures ----
print("\n=== container signatures ===")
sigs = {
 "zlib 78 9c": b"\x78\x9c", "zlib 78 da": b"\x78\xda", "zlib 78 01": b"\x78\x01",
 "gzip 1f 8b": b"\x1f\x8b", "LZMA 5d 00 00": b"\x5d\x00\x00",
 "7z 37 7a bc af": b"\x37\x7a\xbc\xaf", "ZIP PK": b"PK\x03\x04",
 "ZDPTTTTTI": b"ZDPTTTTTI", "xz fd 37 7a": b"\xfd7zXZ",
 "lz4 04 22 4d 18": b"\x04\x22\x4d\x18",
 "U-Boot uImage 27 05 19 56": b"\x27\x05\x19\x56",
}
for k, s in sigs.items():
    offs = [m.start() for m in re.finditer(re.escape(s), d)]
    if offs:
        print("  %-26s %4d  %s" % (k, len(offs), [hex(o) for o in offs[:8]]))
    else:
        print("  %-26s %4d" % (k, 0))

# ---- try zlib decompression at every offset in high-entropy regions ----
print("\n=== zlib inflate attempts (first 200 hits of 78 9c / 78 da / 78 01) ===")
found = 0
for m in re.finditer(rb"\x78[\x9c\xda\x01]", d):
    if found >= 8: break
    try:
        obj = zlib.decompressobj()
        out = obj.decompress(d[m.start():m.start()+200000], 100000)
        if len(out) > 512:
            print("   DECOMPRESSED at %08x -> %d bytes" % (m.start(), len(out)))
            print("   ", out[:120])
            found += 1
    except Exception:
        pass
if not found:
    print("   none")

# ---- block repetition analysis (is it compressed?) ----
print("\n=== repeated 16-byte blocks ===")
c = collections.Counter(d[i:i+16] for i in range(0, N-16, 16))
dupes = [(k,v) for k,v in c.items() if v > 3]
print("  blocks repeated >3 times:", len(dupes))
for k, v in sorted(dupes, key=lambda x:-x[1])[:8]:
    print("   x%-4d %s" % (v, k.hex()))

# ---- byte histogram ----
print("\n=== byte histogram (top/bottom 8) ===")
h = collections.Counter(d)
items = sorted(h.items(), key=lambda x:-x[1])
print("  top:", [(hex(b), v) for b, v in items[:8]])
print("  bottom:", [(hex(b), v) for b, v in items[-8:]])

# ---- highest entropy 4K blocks ----
def ent(b):
    cc = collections.Counter(b); n = len(b)
    return -sum((v/n)*math.log2(v/n) for v in cc.values())
blocks = [(ent(d[o:o+4096]), o) for o in range(0, N-4096, 4096)]
blocks.sort(reverse=True)
print("\n=== top-10 highest entropy 4K blocks ===")
for e, o in blocks[:10]:
    print("   %08x  %.3f" % (o, e))
print("=== bottom-10 ===")
for e, o in blocks[-10:]:
    print("   %08x  %.3f" % (o, e))