import re, struct, collections

mcc = open(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe","rb").read()
kbcc = open(r"C:\Program Files\TOPPING Pro\KB Control Center\KB Control Center.exe","rb").read()
fw = open(r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin","rb").read()

def count2(d, tag):
    return len(re.findall(re.escape(struct.pack("<H", tag)), d))

def count32(d, tag):
    return len(re.findall(re.escape(struct.pack("<I", tag)), d))

# ---------- CONTROL: tags we KNOW are in MCC code ----------
known_mcc = [0x4401,0x4407,0x440b,0x440f,0x4406,0x4408]
print("=== CONTROL: tags known to be compiled into MCC (16-bit LE occurrences) ===")
for t in known_mcc:
    print("   0x%04x   2-byte:%-5d  4-byte:%-5d" % (t, count2(mcc,t), count32(mcc,t)))

print("\n=== Same tags in M62 firmware ===")
for t in known_mcc:
    print("   0x%04x   2-byte:%-5d  4-byte:%-5d" % (t, count2(fw,t), count32(fw,t)))

# ---------- How are immediates encoded in MCC? ----------
print("\n=== immediate encodings of 0x4407 in MCC (with surrounding bytes) ===")
pat = struct.pack("<I", 0x4407)
cnt = 0
for m in re.finditer(re.escape(pat), mcc):
    i = m.start()
    ctx = mcc[max(0,i-6):i+6]
    print("   %08x  %s" % (i, " ".join("%02x" % b for b in ctx)))
    cnt += 1
    if cnt >= 12: break

print("\n=== immediate encodings of 0xb701 (Ducking.Threshold) in KBCC ===")
pat = struct.pack("<I", 0xb701)
cnt = 0
for m in re.finditer(re.escape(pat), kbcc):
    i = m.start()
    ctx = kbcc[max(0,i-6):i+6]
    print("   %08x  %s" % (i, " ".join("%02x" % b for b in ctx)))
    cnt += 1
    if cnt >= 10: break
print("   total 4-byte occurrences in KBCC:", count32(kbcc, 0xb701))

print("\n=== 0xb701 in MCC ===")
print("   4-byte:", count32(mcc, 0xb701), "  2-byte:", count2(mcc, 0xb701))

# ---------- KEY: which 0xNNxx tag families appear as 32-bit immediates near code? ----------
print("\n=== tag-family census: count of 32-bit immediates in range 0xXXXX where high byte in {0x11,0x21,0x23,0x25,0x31,0x32,0x33,0x34,0x35,0x36,0x44,0x51..0x5c,0x60,0x90,0x91,0x94,0x9b,0xa0,0xab,0xb1,0xb3,0xb7,0xb8,0xc1,0xc5,0xc6} ===")
fams = [0x11,0x21,0x23,0x25,0x31,0x32,0x33,0x34,0x35,0x36,0x44,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x5b,0x5c,0x60,0x90,0x91,0x94,0x9b,0xa0,0xab,0xb1,0xb3,0xb7,0xb8,0xc1,0xc5,0xc6]
print("  %-8s %10s %10s %10s" % ("family","MCC","KBCC","M62FW"))
for f in fams:
    lo = f << 8
    a = sum(1 for i in range(0, len(mcc)-4, 4) if lo <= struct.unpack_from("<I", mcc, i)[0] <= lo+0xff)
    b = sum(1 for i in range(0, len(kbcc)-4, 4) if lo <= struct.unpack_from("<I", kbcc, i)[0] <= lo+0xff)
    c = sum(1 for i in range(0, len(fw)-4, 4) if lo <= struct.unpack_from("<I", fw, i)[0] <= lo+0xff)
    if a or b or c:
        print("  0x%02x..   %10d %10d %10d" % (f, a, b, c))