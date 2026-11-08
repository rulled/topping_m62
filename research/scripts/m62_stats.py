import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

# ============================================================
# A. STATISTICAL TAG TEST
#   expected hits under "random bytes with same marginal freq"
# ============================================================
hist = collections.Counter(d)
pbyte = {b: hist[b] / N for b in range(256)}

tags = {
    0x4401:"Input1Level",0x4402:"Input2Level",0x4403:"AuxLevel",0x4404:"BluetoothLevel",
    0x4405:"OtgLevel",0x4406:"NoiseReduction",0x4407:"NoiseReductionType",
    0x4408:"DryWet",0x4409:"Room",0x440a:"Decay",0x440b:"ReverbType",
    0x440c:"MuteFX",0x440f:"Width",
    0xb701:"Duck.Threshold",0xb702:"Duck.Attack",0xb703:"Duck.Reduction",0xb704:"Duck.Release",
    0xb705:"Duck.MapIN1",0xb706:"Duck.MapIN2",0xb707:"DuckSwitchIN1",0xb807:"DuckSwitchIN2",
    0xb301:"Comp.Switch",0xb302:"Comp.Threshold",0xb303:"Comp.Ratio",
    0xc501:"Echo.PingPong",0xc502:"Echo.Mix",0xc504:"Echo.Delay",
    0xc507:"Echo.Feedback",0xc508:"Echo.DirectionLeft",
    0x9b0f:"EQFX.Switch",0x9b0d:"EQFX.Gain",0xab0f:"EQHP.Switch",0xab14:"EQHP.GainInputLeft",
}
print("=== A. tag statistics in M62 firmware (2-byte LE) ===")
print("  %-6s %-18s %6s %8s %8s" % ("tag","name","hits","expected","ratio"))
rows = []
for t, name in sorted(tags.items()):
    lo, hi = t & 0xFF, t >> 8
    pat = bytes([lo, hi])
    n = len(re.findall(re.escape(pat), d))
    exp = pbyte[lo] * pbyte[hi] * N
    ratio = n / exp if exp > 0 else 0
    rows.append((ratio, t, name, n, exp))
for ratio, t, name, n, exp in sorted(rows, reverse=True):
    flag = "  <<<" if ratio > 3 else ""
    print("  0x%04x %-18s %6d %8.1f %7.2fx%s" % (t, name, n, exp, ratio, flag))

# same test for the byte triplet 22 33 and 66 00 77
print("\n  frame-ish patterns:")
for name, pat in [("22 33", b"\x22\x33"), ("66 00 77", b"\x66\x00\x77"),
                  ("33", b"\x33")]:
    n = len(re.findall(re.escape(pat), d))
    exp = 1.0
    for b in pat:
        exp *= pbyte[b]
    exp *= N
    print("   %-10s hits=%-5d expected=%.2f ratio=%.2fx" % (name, n, exp, n/exp if exp else 0))

# ============================================================
# B. SUB-IMAGE DUMP
# ============================================================
print("\n=== B. declared sub-images ===")
for off, ln, tag in [(0x00f18a, 0x5797, "0x08200020"), (0x0105fc8, 0xc171, "0x08300020")]:
    print("  --- off=0x%06x len=0x%05x tag=%s  end=0x%06x %s" %
          (off, ln, tag, off+ln, "(OK)" if off+ln <= N else "(OVERFLOW)"))
    for i in range(0, 48, 16):
        print("      %06x  %s" % (off+i, " ".join("%02x" % b for b in d[off+i:off+i+16])))

# ============================================================
# C. ARCHITECTURE: opcode-plausibility scoring
# ============================================================
print("\n=== C. architecture probes (counts) ===")
def cnt(pat):
    return len(re.findall(re.escape(pat), d))

probes = [
 ("Thumb2:  push {r4-r7,lr}  b5 xx",  lambda: sum(1 for i in range(N-1) if d[i]==0xB5 and 0x00<=d[i+1]<=0xFF)),
 ("Thumb2:  stmdb sp!,{..}   2d e9",  lambda: cnt(b"\x2d\xe9")),
 ("Thumb2:  ldmia sp!,{..pc} bd e8",  lambda: cnt(b"\xbd\xe8")),
 ("Thumb2:  bl                00 f0 xx f8", lambda: sum(1 for i in range(N-3) if d[i]==0x00 and d[i+1]==0xF0)),
 ("MIPS32:  addiu sp,sp,-N    27 bd xx", lambda: cnt(b"\x27\xbd")),
 ("MIPS32:  sw ra,N(sp)       af bf",   lambda: cnt(b"\xaf\xbf")),
 ("MIPS:    jr ra             08 00 e0 03", lambda: cnt(b"\x08\x00\xe0\x03")),
 ("RISC-V:  addi sp,sp,-N     13 01 .. ..", lambda: sum(1 for i in range(N-3) if d[i]==0x13 and d[i+1]==0x01)),
 ("RISC-V:  ret               67 80 00 00", lambda: cnt(b"\x67\x80\x00\x00")),
 ("XMOS xCore: bl               .. .. ..          (n/a)"),
 ("8051:    mov a,#imm         74 xx", lambda: cnt(b"\x74")),
 ("Cortex-M vector table-ish  .. .. 00 20", lambda: sum(1 for i in range(N-4) if d[i+2]==0x00 and d[i+3]==0x20)),
]
for item in probes:
    if len(item) == 2:
        name, fn = item
        print("  %-46s %6d" % (name, fn()))

# ============================================================
# D. 32-bit word view: are there valid ARM/MIPS branch words?
# ============================================================
print("\n=== D. 32-bit branch-word validity (aligned words) ===")
def arm_b(word):
    # ARM B/BL: bits 27:25 = 101
    return (word >> 25) & 0x7 == 0x5
def mips_b(word):
    op = word >> 26
    return op in (2, 3)  # j / jal
def riscv_jal(word):
    return (word & 0x7F) == 0x6F
wa = [struct.unpack_from("<I", d, i)[0] for i in range(0, N-4, 4)]
print("  aligned words:", len(wa))
print("  ARM  B/BL-like : %6d (%.1f%%)  random=%.1f%%" % (
    sum(map(arm_b, wa)), 100.0*sum(map(arm_b, wa))/len(wa), 100*1/8))
print("  MIPS j/jal-like: %6d (%.1f%%)  random=%.1f%%" % (
    sum(map(mips_b, wa)), 100.0*sum(map(mips_b, wa))/len(wa), 100*2/64))
print("  RISC-V JAL-like: %6d (%.1f%%)  random=%.1f%%" % (
    sum(map(riscv_jal, wa)), 100.0*sum(map(riscv_jal, wa))/len(wa), 100*1/128))

# ============================================================
# E. does it look like a Zynq boot image / FPGA bitstream?
# ============================================================
print("\n=== E. bitstream / boot image probes ===")
print("  Xilinx bitstream hdr 00 00 00 BB 11 22 00 44 :", cnt(b"\x00\x00\x00\xbb\x11\x22\x00\x44"))
print("  Xilinx Zynq 66 55 99 AA                        :", cnt(b"\x66\x55\x99\xaa"))
print("  Zynq boot ROM 0xAA995566                       :", cnt(b"\x66\x55\x99\xaa"))
print("  eMMC/SD/SPI markers                            : none probed")

# ============================================================
# F. header struct decode attempt
# ============================================================
print("\n=== F. header triplets (offset, count/tag, size) ===")
for base in range(0x30, 0x80, 0x10):
    a = struct.unpack_from("<I", d, base)[0]
    b = struct.unpack_from("<I", d, base+4)[0]
    c = struct.unpack_from("<I", d, base+8)[0]
    print("  @%02x: %08x %08x %08x   -> A=%d B=%d C=%d" % (base, a, b, c, a, b, c))