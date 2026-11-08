import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("="*78)
print("РАЗБОР НАЙДЕННОЙ СТРУКТУРЫ @0x1c7d4 и региона 0x90000")
print("="*78)

print("\n[1] контекст таблицы @0x1c7d4 (64 байта до и 256 после)")
for i in range(0x1c7d4-64, 0x1c7d4+256, 16):
    print("   %06x  %s  |%s|" % (i,
        " ".join("%02x" % b for b in d[i:i+16]),
        "".join(chr(b) if 32<=b<127 else "." for b in d[i:i+16])))

print("\n[2] интерпретация: 16-битные значения в @0x1c7d4")
vals16 = [struct.unpack_from("<H", d, 0x1c7d4 + 2*i)[0] for i in range(40)]
print("   ", " ".join("%04x" % v for v in vals16))

print("\n[3] регион 0x90000-0x91000 — почему автокорреляция 0.939?")
for i in range(0x90000, 0x90000+256, 16):
    print("   %06x  %s  |%s|" % (i,
        " ".join("%02x" % b for b in d[i:i+16]),
        "".join(chr(b) if 32<=b<127 else "." for b in d[i:i+16])))

print("\n[4] что за структура: длина записи? ищем период")
seg = d[0x90000:0x92000]
best = []
for period in range(2, 300):
    if len(seg) < period*4: continue
    match = sum(1 for i in range(0, len(seg)-period, 3) if seg[i] == seg[i+period])
    cnt = len(range(0, len(seg)-period, 3))
    best.append((match/cnt, period))
best.sort(reverse=True)
print("   топ-10 периодов:")
for r, p_ in best[:10]:
    print("     период %3d  совпадение %.3f" % (p_, r))

print("\n[5] регион 0x90000: повторяющийся элемент по найденному периоду")
per = best[0][1]
print("   период =", per)
c = collections.Counter(seg[i:i+per] for i in range(0, len(seg)-per, per))
print("   уникальных элементов:", len(c))
for k, v in c.most_common(5):
    print("     x%-4d %s" % (v, k.hex()))

print("\n[6] ВСЕ регионы с энтропией ~0.7 (нулевые заливки) — маркеры разделов")
runs = []
i = 0
while i < N-4096:
    b = d[i:i+4096]
    z = b.count(0)/len(b)
    if z > 0.8:
        j = i
        while j < N-4096:
            if d[j:j+4096].count(0)/4096 > 0.8: j += 4096
            else: break
        runs.append((i, j))
        i = j
    else:
        i += 4096
print("   найдено", len(runs), "нулевых регионов:")
for a, z in runs:
    print("     %08x - %08x  (%d байт)" % (a, z, z-a))

print("\n[7] ищем ASCII-заголовки/маркеры разделов рядом с нулевыми регионами")
for a, z in runs:
    for probe in [a-64, a-32, z, z+32]:
        if 0 <= probe < N-32:
            chunk = d[probe:probe+32]
            printable = sum(1 for b in chunk if 32 <= b < 127)
            if printable > 20:
                print("     @%08x  %r" % (probe, chunk.decode('ascii','replace')))

print("\n[8] конец файла: 0x129000. Что в последних 64К?")
for i in range(N-0x1000, N, 32):
    print("   %06x  %s" % (i, " ".join("%02x" % b for b in d[i:i+32])))