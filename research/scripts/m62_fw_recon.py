import re, struct, collections, math, os

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
print("size", len(d), hex(len(d)))

# ---------- 1. frame magic search ----------
print("\n=== FRAME MAGIC SEARCH ===")
pats = {
    "00 22 33        (frame start)": b"\x00\x22\x33",
    "00 66 00 77     (frame tail)":  b"\x00\x66\x00\x77",
    "22 33           ":               b"\x22\x33",
    "66 00 77        ":               b"\x66\x00\x77",
}
for name, pat in pats.items():
    offs = [m.start() for m in re.finditer(re.escape(pat), d)]
    print("  %-30s %4d hits  %s" % (name, len(offs), [hex(o) for o in offs[:10]]))

# ---------- 2. tag constants ----------
print("\n=== TAG CONSTANT SEARCH (16-bit LE) ===")
tags = {
    0x4401:"Input1Level",0x4402:"Input2Level",0x4403:"AuxLevel",0x4404:"BluetoothLevel",
    0x4405:"OtgLevel",0x4406:"NoiseReduction",0x4407:"NoiseReductionType",
    0x4408:"DryWet",0x4409:"Room",0x440a:"Decay",0x440b:"ReverbType",
    0x440c:"MuteFX",0x440f:"Width",
    0xb701:"Ducking.Threshold",0xb702:"Ducking.Attack",0xb703:"Ducking.Reduction",
    0xb704:"Ducking.Release",0xb705:"Ducking.MapIN1",0xb706:"Ducking.MapIN2",
    0xb707:"DuckingSwitchIN1",0xb807:"DuckingSwitchIN2",
    0xb301:"Comp.Switch",0xb302:"Comp.Threshold",0xb303:"Comp.Ratio",
    0xc501:"Echo.PingPong",0xc502:"Echo.Mix",0xc504:"Echo.Delay",
    0xc507:"Echo.Feedback",0xc508:"Echo.DirectionLeft",
    0x9b0f:"EQ_FX.Switch",0x9b0d:"EQ_FX.Gain",0xab0f:"EQ_HP.Switch",
    0xab14:"EQ_HP.GainInputLeft",
}
for t in sorted(tags):
    pat = struct.pack("<H", t)
    offs = [m.start() for m in re.finditer(re.escape(pat), d)]
    if offs:
        print("  0x%04x %-22s %4d hits %s" % (t, tags[t], len(offs), [hex(o) for o in offs[:6]]))

# ---------- 3. architecture probes ----------
print("\n=== ARCH PROBES ===")
probes_arm = {
    "Thumb push {lr}  00 b5": b"\x00\xb5",
    "Thumb push.w     2d e9": b"\x2d\xe9",
    "Thumb bx lr      70 47": b"\x70\x47",
    "ARM  push {lr}  .. .. .. e9": None,
}
for name, pat in probes_arm.items():
    if pat is None: continue
    n = len(re.findall(re.escape(pat), d))
    print("  %-34s %6d  (%.2f per KB)" % (name, n, n*1024/len(d)))

probes_x86 = {
    "push rbp; mov rbp,rsp  55 48 89 e5": b"\x55\x48\x89\xe5",
    "sub rsp, imm8         48 83 ec xx":  b"\x48\x83\xec",
    "endbr64               f3 0f 1e fa": b"\xf3\x0f\x1e\xfa",
    "call rel32            e8":           b"\xe8",
    "ret                   c3":           b"\xc3",
}
for name, pat in probes_x86.items():
    n = len(re.findall(re.escape(pat), d))
    print("  %-34s %6d  (%.2f per KB)" % (name, n, n*1024/len(d)))

# ---------- 4. meaningful strings ----------
print("\n=== MEANINGFUL ASCII STRINGS (len>=6, wordlike) ===")
def wordlike(s):
    if len(s) < 6: return False
    if sum(c.isalpha() or c in " _-./:" for c in s) < len(s)*0.85: return False
    if sum(c in "aeiouAEIOU" for c in s) < 2: return False
    top = collections.Counter(s).most_common(1)[0][1]
    return top <= len(s)*0.35
seen=set(); hits=[]
for m in re.finditer(rb"[\x20-\x7e]{6,}", d):
    s=m.group().decode("ascii")
    if wordlike(s) and s not in seen:
        seen.add(s); hits.append((m.start(),s))
print("  count:", len(hits))
for off,s in hits[:80]:
    print("   %08x  %r" % (off, s[:95]))

# ---------- 5. UTF-16 strings ----------
print("\n=== UTF-16LE STRINGS ===")
seen=set(); hits16=[]
for m in re.finditer(rb"(?:[\x20-\x7e]\x00){5,}", d):
    s=m.group().decode("utf-16-le", errors="ignore")
    if wordlike(s) and s not in seen:
        seen.add(s); hits16.append((m.start(),s))
print("  count:", len(hits16))
for off,s in hits16[:50]:
    print("   %08x  %r" % (off, s[:95]))