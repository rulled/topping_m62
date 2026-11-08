import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()

print("="*76)
print("РЕШАЮЩИЙ ТЕСТ: обфускация (XOR) и экзотические форматы инструкций")
print("="*76)

# ---------------------------------------------------------------
# Метрика "похоже на ARM Thumb код":
#  - 0xB5xx (push) и 0xBDxx (pop) с ОДИНАКОВОЙ чётностью
#  - 0xF0xx ... 0xF8xx (BL)
#  - 0x4770 (bx lr)
# ---------------------------------------------------------------
def thumb_score(b):
    n = len(b)
    if n < 100: return 0
    # B5 at even, BD at even
    b5e = sum(1 for i in range(0, n-1, 2) if b[i] == 0xB5)
    b5o = sum(1 for i in range(1, n-1, 2) if b[i] == 0xB5)
    bde = sum(1 for i in range(0, n-1, 2) if b[i] == 0xBD)
    bdo = sum(1 for i in range(1, n-1, 2) if b[i] == 0xBD)
    bx  = len(re.findall(rb"\x70\x47", b))
    bl  = sum(1 for i in range(0, n-3, 2) if b[i] == 0xF0 and 0xF8 <= b[i+3] <= 0xFF)
    return (b5e+bde+bx+bl) - (b5o+bdo)

print("\n[1] XOR-перебор: ищем ключ, превращающий образ в ARM Thumb")
best = []
for key in range(256):
    if key == 0:
        x = d
    else:
        x = bytes(b ^ key for b in d) if len(d) < 300000 else None
        if x is None:
            # для больших данных берём выборку
            sample = d[0x4b000:0x62000]
            x = bytes(b ^ key for b in sample)
    if key == 0:
        sample = d[0x4b000:0x62000]
    else:
        sample = bytes(b ^ key for b in d[0x4b000:0x62000])
    sc = thumb_score(sample)
    best.append((sc, key))
best.sort(reverse=True)
print("   топ-10 ключей по Thumb-скору:")
for sc, k in best[:10]:
    print("     XOR 0x%02x : score %d" % (k, sc))
print("   (score 0 = нет сигнала; настоящее ARM даёт десятки)")

# контроль: настоящий ARM
kb = open(r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping","rb").read()
print("   контроль ARM-загрузчик KB22: score =", thumb_score(kb[0x408000:0x418000]))

# ---------------------------------------------------------------
# 2. Может это 24-битные инструкции (SHARC-like / 24-bit DSP)?
# ---------------------------------------------------------------
print("\n[2] тест 24-битного выравнивания (SHARC / 24-bit DSP)")
for name, a, z in [("M62 0x4b000-0x62000", 0x4b000, 0x62000),
                   ("подобраз B", 0x105fc8, 0x105fc8+0xc171)]:
    b = d[a:z]
    for stride in [3, 6]:
        hs = [0]*stride
        # ищем байт, чья позиция стабильна по модулю stride
        bestb = None
        for byt in range(256):
            c = [0]*stride
            for m in re.finditer(re.escape(bytes([byt])), b):
                c[m.start() % stride] += 1
            tot = sum(c)
            if tot < 100: continue
            mx, mn = max(c), min(c)
            r = mx/max(1, mn)
            if bestb is None or r > bestb[0]:
                bestb = (r, byt, c)
        if bestb:
            print("   %-24s stride=%d  лучший байт 0x%02x ratio=%.2f  %s" % (
                name, stride, bestb[1], bestb[0], bestb[2]))

# ---------------------------------------------------------------
# 3. Проверка: может это 32-бит слова, где старший байт всегда 0x0F?
# ---------------------------------------------------------------
print("\n[3] гипотеза: 32-битные слова с фиксированным полем")
b = d[0x105fc8:0x105fc8+0xc171]
for shift in [0, 8, 16, 24]:
    c = collections.Counter()
    for i in range(0, len(b)-4, 4):
        w = struct.unpack_from("<I", b, i)[0]
        c[(w >> shift) & 0xFF] += 1
    top = c.most_common(3)
    tot = sum(c.values())
    print("   байт по сдвигу %2d: top %s" % (shift, " ".join("0x%02x:%.1f%%" % (k, 100*v/tot) for k, v in top)))

# ---------------------------------------------------------------
# 4. КЛЮЧЕВОЕ: 0x0F в старшем байте 16-бит слова, lo кратен 0x10
#    -> это похоже на АДРЕС внутри 256-байтовой страницы с шагом 16?
# ---------------------------------------------------------------
print("\n[4] анализ слов с hi=0x0F: lo кратен 0x10?")
w = [struct.unpack_from("<H", b, i)[0] for i in range(0, len(b)-1, 2)]
sel = [v for v in w if (v >> 8) == 0x0F]
mult = sum(1 for v in sel if (v & 0x0F) == 0)
print("   всего с hi=0x0F: %d, из них lo кратен 0x10: %d (%.1f%%)" % (
    len(sel), mult, 100*mult/len(sel) if sel else 0))

print("\n[5] а если lo — это НЕ кратный: посмотрим полный список lo")
c = collections.Counter(v & 0xFF for v in sel)
print("   уникальных lo:", len(c))
print("   топ-20:", [("%02x" % k, v) for k, v in c.most_common(20)])

# ---------------------------------------------------------------
# 6. Проверим: может 0x0F — это разделитель записей фиксированной длины?
# ---------------------------------------------------------------
print("\n[6] позиции 0x0F в потоке: фиксированный шаг?")
pos = [m.start() for m in re.finditer(rb"\x0f", b)]
print("   всего вхождений 0x0F:", len(pos))
on_odd = sum(1 for x in pos if x % 2 == 1)
print("   на нечётных позициях: %d (%.1f%%)" % (on_odd, 100*on_odd/len(pos)))
gaps = [pos[k+1]-pos[k] for k in range(len(pos)-1)]
gc = collections.Counter(gaps)
print("   топ-12 интервалов:", gc.most_common(12))

# ---------------------------------------------------------------
# 7. Сравнение с KB22 (там тоже 0F?)
# ---------------------------------------------------------------
print("\n[7] для сравнения — те же метрики у KB22-загрузчика (настоящий ARM)")
for nm, blk in [("KB22 0x408000", kb[0x408000:0x418000])]:
    pos2 = [m.start() for m in re.finditer(rb"\x0f", blk)]
    on_odd2 = sum(1 for x in pos2 if x % 2 == 1)
    print("   %-16s 0x0F всего %d, на нечётных %.1f%%" % (
        nm, len(pos2), 100*on_odd2/len(pos2) if pos2 else 0))