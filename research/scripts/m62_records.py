import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()

b = d[0x105fc8:0x105fc8+0xc171]

print("="*76)
print("СТРУКТУРА ЗАПИСЕЙ (0x0F + кратный 0x10) — поиск длины записи")
print("="*76)

# позиции 0x0F
pos = [m.start() for m in re.finditer(rb"\x0f", b)]
odd = [x for x in pos if x % 2 == 1]
print("\n[1] 0x0F на нечётных позициях: %d из %d" % (len(odd), len(pos)))

print("\n[2] распределение (позиция 0x0F) по модулю N — ищем период записи")
for N in [16, 24, 32, 40, 48, 56, 64, 72, 80, 96]:
    c = collections.Counter(x % N for x in odd)
    tot = len(odd)
    # идеал: все в одном остатке
    top_share = max(c.values())/tot
    distinct = len(c)
    print("   N=%-3d : различных остатков %-3d, макс.доля %5.1f%%" % (N, distinct, 100*top_share))

print("\n[3] смотрим сырые записи по 32 байта (0x0F виден в каждой?)")
# найдём стартовое смещение, где 0x0F попадает в фиксированную позицию
best = None
for start in range(0, 64):
    for N in [16, 24, 32, 40, 48, 64]:
        cnt = collections.Counter()
        for x in odd:
            if x >= start:
                cnt[(x-start) % N] += 1
        if not cnt: continue
        # сколько записей имеют 0x0F ровно в одной позиции
        mx = max(cnt.values())
        if best is None or mx > best[0]:
            best = (mx, start, N, cnt.most_common(3))
print("   лучший: совпадений %d, start=%d, N=%d, топ-позиции %s" % best)

print("\n[4] дамп 8 «записей» по 24 байта от 0x105fc8")
for i in range(8):
    off = 0x105fc8 + i*24
    chunk = d[off:off+24]
    print("   %06x  %s" % (off, " ".join("%02x" % x for x in chunk)))

print("\n[5] дамп 8 «записей» по 32 байта от 0x105fc8")
for i in range(8):
    off = 0x105fc8 + i*32
    chunk = d[off:off+32]
    print("   %06x  %s" % (off, " ".join("%02x" % x for x in chunk)))

print("\n" + "="*76)
print("ПРОВЕРКА XOR С ПРАВИЛЬНОЙ БАЗОЙ (учёт частот байтов)")
print("="*76)
print("\n[6] для каждого XOR-ключа: счёт B5/BD на ЧЁТНЫХ минус на НЕЧЁТНЫХ,")
print("    нормированный на ожидание по частотам байтов")
freq = collections.Counter(b)
n = len(b)

def score(key):
    """Скор = наблюдаемое минус ожидаемое (по маргинальным частотам)."""
    # в XOR-потоке байт v приходит из исходного v^key
    p_b5 = freq[0xB5 ^ key] / n
    p_bd = freq[0xBD ^ key] / n
    p_bx = freq[0x70 ^ key] * freq[0x47 ^ key] / (n*n)   # пара
    obs_b5e = sum(1 for i in range(0, n-1, 2) if b[i] == (0xB5 ^ key))
    obs_bde = sum(1 for i in range(0, n-1, 2) if b[i] == (0xBD ^ key))
    exp_b5e = p_b5 * (n//2)
    exp_bde = p_bd * (n//2)
    return (obs_b5e - exp_b5e) + (obs_bde - exp_bde)

rows = [(score(k), k) for k in range(256)]
rows.sort(reverse=True)
print("   топ-10 (положительный = больше, чем случайно):")
for s, k in rows[:10]:
    print("     XOR 0x%02x : excess %+8.1f" % (k, s))
print("   худшие 3:", [(hex(k), round(s,1)) for s, k in rows[-3:]])

print("\n[7] контроль на настоящем ARM (KB22 0x408000) с тем же методом:")
kb = open(r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping","rb").read()
ctrl = kb[0x408000:0x418000]
fr = collections.Counter(ctrl); m = len(ctrl)
def score2(buf, freq, n, key):
    obs = sum(1 for i in range(0, n-1, 2) if buf[i] == (0xB5 ^ key))
    exp = (freq[0xB5 ^ key]/n) * (n//2)
    return obs - exp
print("   ключ 0x00 : excess %+8.1f" % score2(ctrl, fr, m, 0))
print("   (если настоящее ARM даёт большой плюс — метод верный)")