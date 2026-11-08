import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("="*78)
print("РАЗБОР ТАБЛИЦЫ @0x1c7d4 — похоже на карту адресов/разделов")
print("="*78)

# Читаем как 32-битные значения
print("\n[1] @0x1c7d4 как dwords (64 значения)")
for i in range(32):
    v = struct.unpack_from("<I", d, 0x1c7d4 + 4*i)[0]
    print("   [%2d] %08x  = %d" % (i, v, v))

print("\n[2] закономерность: значения вида 0xNN14 и 0xNN24")
for i in range(0, 18, 2):
    a = struct.unpack_from("<I", d, 0x1c7d4 + 4*i)[0]
    b = struct.unpack_from("<I", d, 0x1c7d4 + 4*(i+1))[0]
    print("   пара %2d: %08x %08x   -> ниббл=%x  дельта=%d" % (i//2, a, b, (a>>12)&0xF, b-a))

print("\n[3] смотрим ШИРЕ: что перед таблицей @0x1c7d4 (0x1c700-0x1c7e0)")
for i in range(0x1c700, 0x1c7e0, 16):
    print("   %06x  %s  |%s|" % (i,
        " ".join("%02x" % b for b in d[i:i+16]),
        "".join(chr(b) if 32<=b<127 else "." for b in d[i:i+16])))

print("\n" + "="*78)
print("РЕГИОН 0x128000 — данные фильтров (значения 0x55/0xAA/0xFF/0x00)")
print("="*78)
print("\n[4] @0x128000 как int16")
vals = [struct.unpack_from("<h", d, 0x128000 + 2*i)[0] for i in range(48)]
print("   ", vals)
print("\n[5] @0x128000 как uint16 (hex)")
vals = [struct.unpack_from("<H", d, 0x128000 + 2*i)[0] for i in range(48)]
print("   ", " ".join("%04x" % v for v in vals))

print("\n[6] уникальные 16-битные значения в 0x128000-0x128160")
c = collections.Counter(struct.unpack_from("<H", d, 0x128000 + 2*i)[0] for i in range(0xB0))
for v, k in c.most_common(20):
    print("     %04x : %d" % (v, k))

print("\n[7] МАСШТАБ: где начинается и кончается этот регион?")
# ищем регион с высокой долей значений 0x55AA/0xAA55/0xFFFF/0x0000
start = None
for off in range(0, N-256, 256):
    b = d[off:off+256]
    w = [struct.unpack_from("<H", b, i)[0] for i in range(0, 256, 2)]
    special = sum(1 for v in w if v in (0x0000, 0xFFFF, 0x55AA, 0xAA55, 0x00FF, 0xFF00))
    if special > 60:
        if start is None: start = off
    else:
        if start is not None:
            print("   регион %08x - %08x  (%d байт)" % (start, off, off-start))
            start = None
if start is not None:
    print("   регион %08x - %08x  (%d байт)" % (start, N, N-start))

print("\n[8] конец данных и начало 0xFF-заливки")
# найдём где начинается сплошной 0xFF
run = 0
for i in range(N-1, 0, -1):
    if d[i] == 0xFF: run += 1
    else: break
print("   сплошной 0xFF с конца: %d байт (с %08x)" % (run, N-run))

print("\n[9] Проверка: может это образ SPI-flash с разделами? Ищем 'ff ff 00 00' паттерн")
# Классический признак пустой/стёртой flash и таблиц
c = collections.Counter()
for i in range(0, N-4, 4):
    c[struct.unpack_from("<I", d, i)[0]] += 1
print("   топ-12 dword:")
for v, k in c.most_common(12):
    print("     %08x : %d" % (v, k))