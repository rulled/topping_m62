import struct, binascii

p = r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping"
d = open(p, "rb").read()

print("total", len(d))
print("magic:", d[:16])
print()

# parse the header as a series of dwords
print("first 96 bytes as dwords:")
for i in range(0, 96, 4):
    v = struct.unpack_from("<I", d, i)[0]
    print("  +%02x  %08x  %d" % (i, v, v))

print()
# where does high entropy start / end
import collections, math
def entropy(b):
    c = collections.Counter(b); n = len(b)
    return -sum((v/n)*math.log2(v/n) for v in c.values())

# find transition points on 64k granularity
print("64K-block entropy:")
for off in range(0, len(d), 0x10000):
    e = entropy(d[off:off+0x10000])
    # trailing region
    print("  %08x  %.2f" % (off, e))
