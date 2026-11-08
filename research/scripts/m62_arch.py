import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("=== 1. dword histogram: address-like clusters ===")
c = collections.Counter()
for i in range(0, N-4, 4):
    c[struct.unpack_from("<I", d, i)[0]] += 1
# Look at the most common values that look like addresses (0x0080xxxx etc.)
addrlike = [(v,k) for k,v in c.items() if 0x00010000 <= v <= 0x40000000 and v % 4 == 0]
addrlike.sort(reverse=True)
print("  top address-like dwords (value, count):")
for v, k in addrlike[:25]:
    print("    0x%08x  x%d" % (v, k))

print("\n=== 2. which byte-range do address-like dwords fall into? ===")
buckets = collections.Counter()
for v, k in addrlike:
    buckets[v >> 20] += k
for b in sorted(buckets, key=lambda x: -buckets[x])[:12]:
    print("    0x%03x00000-0x%03xfffff : %d" % (b, b, buckets[b]))

print("\n=== 3. x86 call-target validation (E8 rel32) ===")
# collect all E8 with a plausible rel32
cands = []
for i in range(0, N-5):
    if d[i] == 0xE8:
        rel = struct.unpack_from("<i", d, i+1)[0]
        cands.append((i, rel))
print("  total E8:", len(cands))
for base in [0x0, 0x00800000, 0x08000000, 0x20000000, 0x40000000, 0x08048000, 0x08004000]:
    good = 0
    for off, rel in cands:
        tgt = base + off + 5 + rel
        if base <= tgt < base + N:
            good += 1
    print("  base 0x%08x : %d/%d = %.1f%% land in image" % (base, good, len(cands), 100.0*good/len(cands)))

print("\n=== 4. ARM64 prologue probes ===")
arm64 = {
 "stp x29,x30,[sp,#-N]!  fd 7b b? a9": re.compile(rb"\xfd\x7b[\xbb][\x9a]\xa9"),
 "stp x29,x30,[sp,#N]    fd 7b ?? a9": re.compile(rb"\xfd\x7b.{2}\xa9"),
 "mov x29,sp            fd 03 00 91": re.compile(rb"\xfd\x03\x00\x91"),
 "ret                   c0 03 5f d6": re.compile(rb"\xc0\x03\x5f\xd6"),
 "bl                    ?? ?? ?? 94": re.compile(rb"\x94"),
}
for k, rx in arm64.items():
    n = len(rx.findall(d))
    print("  %-42s %6d" % (k, n))

print("\n=== 5. x86-32 / x86-16 probes ===")
x86 = {
 "push ebp;mov ebp,esp  55 89 e5": b"\x55\x89\xe5",
 "push ebp;mov ebp,esp  55 8b ec": b"\x55\x8b\xec",
 "push esi/edi         56 57":     b"\x56\x57",
 "sub esp,imm8         83 ec xx":  b"\x83\xec",
 "mov eax,[esp+..]     8b 44 24":  b"\x8b\x44\x24",
 "mov eax,[ebp+..]     8b 45":     b"\x8b\x45",
 "int3                 cc":        b"\xcc",
 "nop 90":                         b"\x90",
 "0f 1f nop":                      b"\x0f\x1f",
}
for k, pat in x86.items():
    n = len(re.findall(re.escape(pat), d))
    print("  %-38s %6d  (%.2f/KB)" % (k, n, n*1024/N))

print("\n=== 6. is the file nibble-swapped / bit-reversed? ===")
def nibswap(b):
    out = bytearray(len(b))
    for i, x in enumerate(b):
        out[i] = ((x & 0x0F) << 4) | (x >> 4)
    return bytes(out)
def bitswap(b):
    tbl = bytes(int('{:08b}'.format(i)[::-1], 2) for i in range(256))
    return b.translate(tbl)
for name, t in [("original", d), ("nibble-swapped", nibswap(d)), ("bit-reversed", bitswap(d))]:
    n_ec = t.count(b"\x83\xec"); n_55 = t.count(b"\x55\x89\xe5")
    n_b5 = t.count(b"\x00\xb5"); n_e8 = t.count(b"\xe8")
    print("  %-16s 83ec:%-5d 5589e5:%-5d 00b5:%-5d e8:%d" % (name, n_ec, n_55, n_b5, n_e8))