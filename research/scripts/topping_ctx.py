import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping"
d = open(p, "rb").read()

print("=== context around 0x12a179 (PEQ) ===")
sub = d[0x12a100:0x12a420]
for m in re.finditer(rb"[\x20-\x7e]{3,}", sub):
    print("   %08x  %r" % (0x12a100 + m.start(), m.group().decode("ascii")))

print()
print("=== tail region 0x414000-0x41c000 strings ===")
sub = d[0x414000:0x41c000]
seen = set()
for m in re.finditer(rb"[\x20-\x7e]{5,}", sub):
    s = m.group().decode("ascii")
    if s in seen:
        continue
    seen.add(s)
    print("   %08x  %r" % (0x414000 + m.start(), s[:110]))

print()
print("=== is there a checksum/signature tail? last 256 bytes ===")
print(" ".join("%02x" % b for b in d[-256:]))
