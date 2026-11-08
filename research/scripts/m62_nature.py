import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("=" * 70)
print("ГИПОТЕЗА: файл — контейнер таблиц (коэффициенты/DSP), не код")
print("=" * 70)

# ---------- 1. float32 test ----------
print("\n=== 1. float32 в разумных диапазонах ===")
def f32(b):
    return struct.unpack("<f", b)[0]

buckets = collections.Counter()
tot = 0
good_audio = 0     # |x| <= 1  (нормированные коэффициенты)
good_param = 0     # 0..100    (dB, %, Hz-подобное)
good_small = 0     # 1e-6..1e6
nan_inf = 0
for i in range(0, N-4, 4):
    v = f32(d[i:i+4]); tot += 1
    if v != v or v in (float("inf"), float("-inf")):
        nan_inf += 1; continue
    a = abs(v)
    if a <= 1.0: good_audio += 1
    if 0.0 <= v <= 100.0: good_param += 1
    if 1e-6 <= a <= 1e6: good_small += 1
print("  всего aligned dword : %d" % tot)
print("  NaN/Inf             : %d  (%.3f%%)   случайно ~0.4%%" % (nan_inf, 100*nan_inf/tot))
print("  |v| <= 1.0          : %d  (%.2f%%)  случайно ~%.2f%%" % (
    good_audio, 100*good_audio/tot, 100*2*1.0/2**32*0 ))
print("  0 <= v <= 100       : %d  (%.2f%%)" % (good_param, 100*good_param/tot))
print("  1e-6 <= |v| <= 1e6  : %d  (%.2f%%)" % (good_small, 100*good_small/tot))

# random baseline
import os
rnd = os.urandom(400000)
rn = 0; rg = 0
for i in range(0, len(rnd)-4, 4):
    v = f32(rnd[i:i+4]); rn += 1
    if v == v and abs(v) <= 1.0: rg += 1
print("  БАЗА (случайные байты), |v| <= 1.0 : %.3f%%" % (100*rg/rn))

# ---------- 2. float64 test ----------
print("\n=== 2. float64 в разумных диапазонах ===")
g = 0; t = 0; ni = 0
for i in range(0, N-8, 8):
    v = struct.unpack("<d", d[i:i+8])[0]; t += 1
    if v != v or v in (float("inf"), float("-inf")):
        ni += 1; continue
    if 1e-9 <= abs(v) <= 1e9: g += 1
print("  всего: %d  NaN/Inf: %d (%.3f%%)  разумных: %d (%.3f%%)" % (t, ni, 100*ni/t, g, 100*g/t))

# ---------- 3. int16 sample-like test ----------
print("\n=== 3. int16-поток как аудио (проверка на «шум» vs «сигнал») ===")
for name, a, b in [("0x20000-0x30000", 0x20000, 0x30000),
                   ("0x60000-0x70000", 0x60000, 0x70000),
                   ("0xa0000-0xb0000", 0xa0000, 0xb0000),
                   ("0x60000-0x62000", 0x60000, 0x62000)]:
    s = [struct.unpack_from("<h", d, i)[0] for i in range(a, b-1, 2)]
    if not s: continue
    mean = sum(s)/len(s)
    var = sum((x-mean)**2 for x in s)/len(s)
    # zero crossing rate — для аудио обычно 1..30%
    zc = sum(1 for i in range(1, len(s)) if (s[i-1] < 0) != (s[i] < 0)) / len(s)
    print("  %-18s n=%-7d mean=%8.1f std=%8.1f zcr=%.1f%%" % (name, len(s), mean, math.sqrt(var), 100*zc))

# ---------- 4. repeated structure search ----------
print("\n=== 4. поиск повторяющихся блоков фиксированного размера ===")
for blk in [8, 12, 16, 20, 24, 32, 40, 48, 64]:
    seen = collections.Counter()
    for i in range(0, N-blk, blk):
        seen[d[i:i+blk]] += 1
    dups = sum(1 for v in seen.values() if v >= 8)
    print("  блок %2d Б : уникальных %6d, повторов>=8: %5d" % (blk, len(seen), dups))

# ---------- 5. search for float arrays (monotonic / smooth runs) ----------
print("\n=== 5. поиск «гладких» массивов float32 (признак таблицы коэффициентов) ===")
runs = []
i = 0
while i < N - 4*16:
    vals = []
    j = i
    ok = True
    while j < N - 4 and len(vals) < 64:
        v = f32(d[j:j+4])
        if v != v or abs(v) > 1e4:
            ok = False; break
        vals.append(v); j += 4
    if ok and len(vals) >= 16:
        # smoothness: соседние значения близки
        diffs = [abs(vals[k+1]-vals[k]) for k in range(len(vals)-1)]
        md = sum(diffs)/len(diffs)
        scale = sum(abs(x) for x in vals)/len(vals) + 1e-9
        if md/scale < 0.15:
            runs.append((i, len(vals), vals[:6]))
            i = j
            continue
    i += 4
print("  найдено гладких float-массивов (len>=16):", len(runs))
for off, ln, head in runs[:20]:
    print("    %08x  len=%d  head=%s" % (off, ln, ["%.5f" % x for x in head]))

# ---------- 6. what IS the 0x71FF pattern? ----------
print("\n=== 6. природа доминирующего слова 0x71FF ===")
pat = b"\x71\xff"
offs = [m.start() for m in re.finditer(re.escape(pat), d)]
print("  всего вхождений: %d" % len(offs))
print("  распределение стартовых адресов (по 64К):")
c = collections.Counter(o >> 16 for o in offs)
for k in sorted(c):
    print("    0x%05x0000 : %d" % (k, c[k]))
print("  примеры окружения:")
for o in offs[:8]:
    ctx = d[max(0,o-8):o+10]
    print("     %08x  %s" % (o, " ".join("%02x" % b for b in ctx)))