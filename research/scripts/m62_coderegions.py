import re, struct, collections, math, os

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()

# CODE-регионы по классификации
CODE_REGIONS = [
    (0x4b000, 0x62000), (0x64000, 0x6a000), (0x6b000, 0x78000),
    (0xb5000, 0xcd000), (0xce000, 0xd4000), (0xd5000, 0xe2000),
]
ctrl = open(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll","rb").read()[0x2000:0x30000]
rnd = os.urandom(0x20000)

def sample(regs, name):
    return name, b"".join(d[a:b] for a, b in regs)

samples = [
    sample(CODE_REGIONS, "M62 CODE-регионы"),
    ("x86-64 .text (контроль)", ctrl),
    ("случайные байты (контроль)", rnd),
]

print("="*78)
print("АНАЛИЗ КОД-РЕГИОНОВ: какая архитектура?")
print("="*78)

# ---- 1. ARM Thumb-2 detection via BL/BLX encoding ----
print("\n[1] Thumb-2 BL (F000 F800 pattern: 0xF0xx 0xF8xx) — главный признак Thumb")
for name, b in samples:
    n = sum(1 for i in range(len(b)-3)
            if b[i] == 0xF0 and 0xF8 <= b[i+3] <= 0xFF and b[i+2] in range(0x00, 0x100))
    n2 = sum(1 for i in range(len(b)-3) if b[i] == 0xF0)
    print("  %-28s F0xx F8xx: %5d   (F0xx всего: %d)" % (name, n, n2))

# ---- 2. Thumb push/pop with LR ----
print("\n[2] Thumb push {..,lr} = 0xB5xx ; pop {..,pc} = 0xBDxx")
for name, b in samples:
    push = sum(1 for i in range(len(b)-1) if b[i] == 0xB5)
    pop  = sum(1 for i in range(len(b)-1) if b[i] == 0xBD)
    pushw = len(re.findall(rb"\x2d\xe9", b))
    popw  = len(re.findall(rb"\xbd\xe8", b))
    print("  %-28s B5xx:%5d  BDxx:%5d   2de9:%4d  bde8:%4d" % (name, push, pop, pushw, popw))

# ---- 3. Xtensa ----
print("\n[3] Xtensa: entry=0x36 0x41, retw.n, 16-бит окно")
for name, b in samples:
    print("  %-28s entry:%4d  retw.n:%4d  rsync:%4d" % (
        name,
        len(re.findall(rb"\x36\x41", b)),
        len(re.findall(rb"\x0d\xf0", b)),
        len(re.findall(rb"\x10\xf0", b))))

# ---- 4. C-SKY / ARC / OpenRISC ----
print("\n[4] ARC / OpenRISC / C-SKY probes")
for name, b in samples:
    print("  %-28s ARC 'j [blink]' 0x2020:%4d  'lr r0,[sp]' 0x1400:%4d" % (
        name, len(re.findall(rb"\x20\x20", b)), len(re.findall(rb"\x14\x00", b))))

# ---- 5. RISC-V: 32-бит инструкции, много 0x13/0x23/0x03/0x63 ----
print("\n[5] RISC-V opcode census (bits 6:0 of aligned words)")
for name, b in samples:
    ops = collections.Counter()
    for i in range(0, len(b)-4, 4):
        w = struct.unpack_from("<I", b, i)[0]
        ops[w & 0x7F] += 1
    tot = sum(ops.values())
    top = ops.most_common(5)
    print("  %-28s %s" % (name, " ".join("0x%02x:%.1f%%" % (k, 100*v/tot) for k, v in top)))

# ---- 6. КЛЮЧЕВОЕ: проверим наличие таблицы векторов ARM Cortex-M ----
print("\n[6] Cortex-M векторная таблица (SP=0x2000xxxx, Reset=0x0000xxxx или 0x08xxxxxx)")
for base in [0x0, 0x1000, 0x2000, 0x8000, 0x10000, 0x20000, 0x4b000, 0x50000,
             0xb5000, 0xc0000, 0xe0000, 0x100000, 0x120000]:
    if base + 16 > len(d): continue
    sp  = struct.unpack_from("<I", d, base)[0]
    rst = struct.unpack_from("<I", d, base+4)[0]
    ok_sp = 0x20000000 <= sp < 0x20100000
    ok_rst = (0x00000000 <= rst < 0x00200000) or (0x08000000 <= rst < 0x09000000)
    if ok_sp or ok_rst:
        print("   @%08x  SP=%08x rst=%08x  %s%s" % (base, sp, rst,
              "SP-OK " if ok_sp else "", "RST-OK" if ok_rst else ""))

# ---- 7. массовый скан на Cortex-M вектора ----
print("\n[7] массовый скан SP-подобных значений (0x2000xxxx) в начале блоков")
hits = 0
for i in range(0, len(d)-8, 4):
    sp = struct.unpack_from("<I", d, i)[0]
    rst = struct.unpack_from("<I", d, i+4)[0]
    if 0x20000000 <= sp <= 0x20040000 and (0x00000000 <= rst <= 0x00100000) and rst % 4 == 0:
        print("   @%08x  SP=%08x  rst=%08x" % (i, sp, rst))
        hits += 1
        if hits > 12: break
if hits == 0:
    print("   не найдено")

# ---- 8. сравнение распределения старшего бита (ARM Thumb часто 0xE/0xF) ----
print("\n[8] распределение старших нибблов 16-битных слов (top-6)")
for name, b in samples[:1] + [("ARM-загрузчик KB22", open(
        r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping","rb").read()[0x408000:0x418000]),
        ("случайные", rnd)]:
    c = collections.Counter()
    for i in range(0, len(b)-1, 2):
        w = struct.unpack_from("<H", b, i)[0]
        c[w >> 12] += 1
    tot = sum(c.values())
    print("  %-28s %s" % (name, " ".join("%x:%.1f%%" % (k, 100*v/tot) for k, v in c.most_common(6))))