import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()

SUBS = [("подобраз A", 0x00f18a, 0x05797), ("подобраз B", 0x0105fc8, 0x0c171)]

print("="*76)
print("ТЕСТ: планарный / деинтерливинг формат")
print("="*76)

def ent(b):
    if not b: return 0
    c = collections.Counter(b); n = len(b)
    return -sum((v/n)*math.log2(v/n) for v in c.values())

def mod16(b, byte):
    c = [0]*16
    for m in re.finditer(re.escape(bytes([byte])), b):
        c[m.start() % 16] += 1
    return c

def report(name, b):
    e = ent(b)
    # ARM Thumb probes on this stream
    push = sum(1 for i in range(len(b)-1) if b[i] == 0xB5)
    pop  = sum(1 for i in range(len(b)-1) if b[i] == 0xBD)
    bl   = sum(1 for i in range(len(b)-3) if b[i] == 0xF0 and 0xF8 <= b[i+3] <= 0xFF)
    bx_lr = len(re.findall(rb"\x70\x47", b))
    bx_lr32 = len(re.findall(rb"\x1e\xff\x2f\xe1", b))
    h = mod16(b, 0x0F)
    tot = sum(h) or 1
    even = sum(h[0::2]); odd = sum(h[1::2])
    print("  %-26s len=%-6d ent=%.2f  B5:%-4d BD:%-4d BL:%-4d 70_47:%-3d 1eff2fe1:%-3d  0F even/odd=%d/%d" % (
        name, len(b), e, push, pop, bl, bx_lr, bx_lr32, even, odd))

for nm, off, ln in SUBS:
    b = d[off:off+ln]
    print("\n--- %s ---" % nm)
    report("как есть", b)
    # swap bytes in 16-bit words
    sw = bytearray(b)
    for i in range(0, len(sw)-1, 2):
        sw[i], sw[i+1] = sw[i+1], sw[i]
    report("16-bit byte-swap", bytes(sw))
    # de-interleave even / odd bytes
    ev = b[0::2]; od = b[1::2]
    report("только чётные байты", ev)
    report("только нечётные байты", od)
    # 4-plane
    for k in range(4):
        report("плоскость %%4==%d" % k, b[k::4])

print("\n" + "="*76)
print("ЧТО ТАКОЕ 0x0F НА НЕЧЁТНЫХ ПОЗИЦИЯХ?")
print("="*76)
nm, off, ln = SUBS[1]
b = d[off:off+ln]
print("\n[1] гистограмма 16-битных слов подобраза B (top-24):")
w = [struct.unpack_from("<H", b, i)[0] for i in range(0, len(b)-1, 2)]
c = collections.Counter(w)
for v, k in c.most_common(24):
    print("     %04x : %5d  (hi=0x%02x lo=0x%02x)" % (v, k, v >> 8, v & 0xFF))

print("\n[2] доля слов с hi=0x0F:")
hi0f = sum(1 for v in w if (v >> 8) == 0x0F)
print("     %d из %d = %.1f%%" % (hi0f, len(w), 100*hi0f/len(w)))

print("\n[3] распределение ВТОРОГО байта (lo) для слов с hi=0x0F:")
lo = collections.Counter(v & 0xFF for v in w if (v >> 8) == 0x0F)
for v, k in lo.most_common(16):
    print("     lo=0x%02x : %d" % (v, k))

print("\n[4] гипотеза: hi=0x0F — это не опкод, а старшая часть коэффициента?")
print("    Проверим: слова с hi=0x0F идут регулярно?")
idxs = [i for i, v in enumerate(w) if (v >> 8) == 0x0F]
if len(idxs) > 2:
    gaps = [idxs[k+1]-idxs[k] for k in range(len(idxs)-1)]
    gc = collections.Counter(gaps)
    print("    интервалы между ними (top-10):", gc.most_common(10))
    print("    средний интервал: %.1f" % (sum(gaps)/len(gaps)))

print("\n[5] СРАВНЕНИЕ с контрольным реальным ARM Thumb-кодом")
# возьмём Cortex-M код из KB22 загрузчика если есть, иначе используем
# синтетику: проверим, как выглядит 0x0F в настоящем ARM
kb = open(r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping","rb").read()
for name, blk in [("KB22 ldr 0x408000", kb[0x408000:0x418000]),
                  ("KB22 ldr 0x418000", kb[0x418000:0x41a000])]:
    h = mod16(blk, 0x0F)
    tot = sum(h) or 1
    print("  %-22s 0F even/odd = %d/%d  (n=%d)" % (name, sum(h[0::2]), sum(h[1::2]), tot))

print("\n[6] ЕСТЬ ЛИ В ФАЙЛЕ ХОТЬ ОДИН РЕГИОН С ПРАВИЛЬНЫМ ARM-ВЫРАВНИВАНИЕМ?")
print("    Ищем: 0xB5 (push) на ЧЁТНЫХ ИЛИ НЕЧЁТНЫХ позициях кластером")
best = []
for off in range(0, len(d)-4096, 4096):
    blk = d[off:off+4096]
    h = mod16(blk, 0xB5)
    tot = sum(h)
    if tot >= 8:
        even = sum(h[0::2]); odd = sum(h[1::2])
        ratio = max(even, odd) / max(1, min(even, odd))
        if ratio > 3:
            best.append((ratio, off, even, odd))
best.sort(reverse=True)
print("    кандидатов с сильной чётностью у 0xB5:", len(best))
for r, o, e, od in best[:12]:
    print("       @%08x  B5 чёт/нечёт = %d/%d  ratio=%.1f" % (o, e, od, r))