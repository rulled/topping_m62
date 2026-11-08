import re, struct, collections, math, os

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("="*76)
print("ПРОВЕРКА ДВУХ ПОДОБРАЗОВ ИЗ ЗАГОЛОВКА — отдельно")
print("="*76)

subs = [
    ("подобраз A", 0x00f18a, 0x05797),
    ("подобраз B", 0x0105fc8, 0x0c171),
]
ctrl = open(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll","rb").read()[0x2000:0x20000]
rnd = os.urandom(0x10000)

def align_hist(b):
    c = collections.Counter(m.start() % 16 for m in re.finditer(rb".", b))
    return c

def mod_hist(b, byte):
    c = collections.Counter(0 for _ in range(16))
    for m in re.finditer(re.escape(bytes([byte])), b):
        c[m.start() % 16] += 1
    return [c.get(k, 0) for k in range(16)]

def entropy(b):
    c = collections.Counter(b); n = len(b)
    return -sum((v/n)*math.log2(v/n) for v in c.values())

print("\n[1] базовые метрики")
print("  %-22s %8s %8s %8s %8s" % ("образец","размер","энтроп","C3","уник16"))
for name, off, ln in subs:
    b = d[off:off+ln]
    w = set(struct.unpack_from("<H", b, i)[0] for i in range(0, len(b)-1, 2))
    print("  %-22s %8d %8.3f %8d %8d" % (name, len(b), entropy(b), b.count(b"\xc3"), len(w)))
for name, b in [("x86-64 .text", ctrl), ("случайные", rnd)]:
    w = set(struct.unpack_from("<H", b, i)[0] for i in range(0, len(b)-1, 2))
    print("  %-22s %8d %8.3f %8d %8d" % (name, len(b), entropy(b), b.count(b"\xc3"), len(w)))

print("\n[2] ТЕСТ ВЫРАВНИВАНИЯ: распределение 0x0F по mod 16")
print("  (в коде будут пики на 0/4/8/12; в данных — ровно)")
for name, off, ln in subs:
    b = d[off:off+ln]
    h = mod_hist(b, 0x0F)
    tot = sum(h) or 1
    print("  %-14s n=%-6d %s" % (name, tot, " ".join("%3d" % (100*x/tot) for x in h)))
h = mod_hist(ctrl, 0x0F); tot = sum(h)
print("  %-14s n=%-6d %s" % ("x86-64 .text", tot, " ".join("%3d" % (100*x/tot) for x in h)))

print("\n[3] диагностика: ищем ЛЮБОЙ выровненный повторяющийся опкод")
for name, off, ln in subs:
    b = d[off:off+ln]
    best = None
    for byt in range(256):
        h = mod_hist(b, byt)
        tot = sum(h)
        if tot < 200: continue
        mx = max(h); mn = min(h)
        if mn > 0:
            score = mx/mn
            if best is None or score > best[0]:
                best = (score, byt, h)
    if best:
        print("  %-14s лучший байт 0x%02x: пик/мин = %.2f  %s" % (
            name, best[1], best[0], best[2]))
    else:
        print("  %-14s нет кандидатов" % name)

print("\n[4] Первые 96 байт каждого подобраза")
for name, off, ln in subs:
    print("  --- %s @%08x ---" % (name, off))
    for i in range(0, 96, 16):
        print("      %06x  %s  |%s|" % (off+i,
            " ".join("%02x" % x for x in d[off+i:off+i+16]),
            "".join(chr(x) if 32<=x<127 else "." for x in d[off+i:off+i+16])))

print("\n[5] ВЫВОД: если пик/мин ~1.0 → выравнивания нет → данные")