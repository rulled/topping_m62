import re, struct, collections, math, os

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("="*78)
print("ГИПОТЕЗА: M62-регионы насыщены микрокодом / таблицами фильтров")
print("         с ПОВТОРЯЮЩЕЙСЯ структурой коротких опкодов")
print("="*78)

# ------------------------------------------------------------------
# 1. Проверим периодичность: автокорреляция по 4К (ищем повтор периода)
# ------------------------------------------------------------------
print("\n[1] автокорреляция 4К-блока с самим собой (поиск повторов внутри блока)")
def autocorr(b, maxlag=256):
    n = len(b)
    res = []
    for lag in range(4, maxlag, 4):
        s = 0
        for i in range(0, n-lag, 7):   # прореживаем для скорости
            s += 1 if b[i] == b[i+lag] else 0
        cnt = len(range(0, n-lag, 7))
        res.append((s/cnt, lag))
    res.sort(reverse=True)
    return res[:5]

for off in [0x20000, 0x22000, 0x30000, 0x4e000, 0x60000, 0x80000, 0x90000, 0xe0000, 0x110000]:
    b = d[off:off+4096]
    top = autocorr(b)
    print("  @%08x  топ-лаги: %s" % (off, " ".join("%.3f@%d" % (v, l) for v, l in top)))

# ------------------------------------------------------------------
# 2. Ищем ОПКОД-подобные повторы: частые короткие паттерны (2-6 байт)
# ------------------------------------------------------------------
print("\n[2] частые байтовые паттерны (длина 2..6) в CODE-регионах")
CODE = [(0x4b000,0x62000),(0x64000,0x6a000),(0x6b000,0x78000),
        (0xb5000,0xcd000),(0xce000,0xd4000),(0xd5000,0xe2000)]
cb = b"".join(d[a:z] for a, z in CODE)
for L in range(2, 7):
    c = collections.Counter(cb[i:i+L] for i in range(len(cb)-L))
    top = c.most_common(6)
    tot = sum(c.values())
    print("  L=%d : %s" % (L, "  ".join("%s:%d(%.1f%%)" % (k.hex(), v, 100*v/tot) for k, v in top[:4])))

# ------------------------------------------------------------------
# 3. КЛЮЧЕВОЕ: ищем таблицу переходов (jump table) — массив близких адресов
# ------------------------------------------------------------------
print("\n[3] поиск таблиц переходов (массивы dword с малой дельтой)")
found = 0
i = 0
while i < N - 64:
    vals = [struct.unpack_from("<I", d, i+4*k)[0] for k in range(16)]
    # все значения в узком диапазоне и монотонно близки
    mn, mx = min(vals), max(vals)
    if mn > 0x1000 and (mx - mn) < 0x20000 and all(v % 2 == 0 or v % 4 == 0 for v in vals):
        # проверим что это не мусор: значения должны быть "плотными"
        if len(set(vals)) >= 12:
            print("   @%08x  %s" % (i, " ".join("%08x" % v for v in vals[:8])))
            found += 1
            if found >= 10: break
            i += 64; continue
    i += 4
if not found: print("   не найдено")

# ------------------------------------------------------------------
# 4. Ищем ОБРАБОТЧИК КАДРА: константы 0x22, 0x33, 0x66, 0x77 рядом
# ------------------------------------------------------------------
print("\n[4] поиск сигнатуры обработчика кадра (байты 0x22,0x33 + 0x66,0x77 рядом)")
hits = []
for i in range(N - 32):
    win = d[i:i+32]
    if 0x22 in win and 0x33 in win and 0x66 in win and 0x77 in win:
        # нужен определённый порядок: 22..33 ... 66..77
        try:
            i22 = win.index(0x22); i33 = win.index(0x33)
            i66 = win.index(0x66); i77 = win.index(0x77)
            if i22 < i33 < i66 < i77 and (i77 - i22) <= 20:
                hits.append((i, win.hex()))
        except ValueError:
            pass
print("   найдено окон:", len(hits))
for i, h in hits[:15]:
    print("     %08x  %s" % (i, h))

# ------------------------------------------------------------------
# 5. Что если это НЕ одна прошивка, а НЕСКОЛЬКО образов подряд?
#    Ищем точки, где начинается заново "чистый" регион
# ------------------------------------------------------------------
print("\n[5] поиск границ подобразов (резкая смена статистики)")
prev_sig = None
for off in range(0, N-4096, 4096):
    b = d[off:off+4096]
    c = collections.Counter(b)
    e = -sum((v/len(b))*math.log2(v/len(b)) for v in c.values())
    zero = b.count(0)/len(b)
    ff = b.count(0xFF)/len(b)
    sig = (round(e,1), round(zero*10), round(ff*10))
    if prev_sig is not None and sig != prev_sig:
        # резкое изменение?
        if abs(sig[0]-prev_sig[0]) >= 1.5:
            print("   смена @%08x  entropy %.2f -> %.2f   zero %.0f%% -> %.0f%%" % (
                off, prev_sig[0], sig[0], prev_sig[1]*10, sig[1]*10))
    prev_sig = sig

# ------------------------------------------------------------------
# 6. энтропия по 256-байтовым окнам в CODE-регионе (если код — будет ровная)
# ------------------------------------------------------------------
print("\n[6] энтропия 256-байт окон в CODE-регионе 0x4b000-0x62000")
vals = []
for off in range(0x4b000, 0x62000, 256):
    b = d[off:off+256]
    c = collections.Counter(b)
    e = -sum((v/256)*math.log2(v/256) for v in c.values())
    vals.append(e)
print("   min=%.2f max=%.2f mean=%.2f std=%.2f" % (
    min(vals), max(vals), sum(vals)/len(vals),
    math.sqrt(sum((x-sum(vals)/len(vals))**2 for x in vals)/len(vals))))

# ------------------------------------------------------------------
# 7. Сравним с настоящим ARM-кодом по тому же показателю
# ------------------------------------------------------------------
kb = open(r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping","rb").read()
print("\n[7] контроль: энтропия 256-байт окон ARM-загрузчика KB22")
vals2 = []
for off in range(0x408000, 0x418000, 256):
    b = kb[off:off+256]
    c = collections.Counter(b)
    e = -sum((v/256)*math.log2(v/256) for v in c.values())
    vals2.append(e)
print("   min=%.2f max=%.2f mean=%.2f std=%.2f" % (
    min(vals2), max(vals2), sum(vals2)/len(vals2),
    math.sqrt(sum((x-sum(vals2)/len(vals2))**2 for x in vals2)/len(vals2))))