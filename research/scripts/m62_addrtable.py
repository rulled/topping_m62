import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("="*78)
print("РАЗБОР АДРЕСНОЙ ТАБЛИЦЫ @0x124600")
print("="*78)

print("\n[1] контекст 0x1245c0-0x124700")
for i in range(0x1245c0, 0x124700, 16):
    print("   %06x  %s  |%s|" % (i,
        " ".join("%02x" % b for b in d[i:i+16]),
        "".join(chr(b) if 32<=b<127 else "." for b in d[i:i+16])))

print("\n[2] сколько элементов в таблице (шаг 0x1000)?")
i = 0x124600
vals = []
while i < N-4:
    v = struct.unpack_from("<I", d, i)[0]
    if v == 0x1000 * (len(vals)+1):
        vals.append(v); i += 4
    else:
        break
print("   элементов:", len(vals), " значения:", [hex(v) for v in vals])
print("   следующий dword после таблицы: %08x" % struct.unpack_from("<I", d, i)[0])

print("\n[3] ЧТО ПОСЛЕ таблицы — может это список размеров?")
for k in range(12):
    off = i + 4*k
    v = struct.unpack_from("<I", d, off)[0]
    print("     +%02x  %08x = %d" % (4*k, v, v))

print("\n" + "="*78)
print("ИТОГОВАЯ ГИПОТЕЗА: структура образа")
print("="*78)

print("\n[4] Проверим: 8 блоков по 0x1000 = 0x8000. А что в начале файла?")
print("   Заголовок говорит: два подобраза")
print("     offset=0x00f18a size=0x05797")
print("     offset=0x105fc8 size=0x0c171")
print("   Сумма: 0xf18a+0x5797 = %08x ; 0x105fc8+0xc171 = %08x" % (0xf18a+0x5797, 0x105fc8+0xc171))

print("\n[5] 0x20000 (размер образа?) vs размер файла 0x129000")
print("   заголовок @0x10: 0x0020568e = %d" % 0x20568e)
print("   заголовок @0x18: 0x0020568e = %d" % 0x20568e)
print("   файл: %d байт = 0x%x" % (N, N))

print("\n[6] РЕШАЮЩЕЕ: найдём в файле паттерн, отличающий КОД от ДАННЫХ")
print("   Для НАСТОЯЩЕГО кода: длина инструкций варьируется, есть выравнивание.")
print("   Проверим распределение позиций байта C3 (x86 ret) — в коде они кластеризуются")
CODE = [(0x4b000,0x62000),(0x64000,0x6a000),(0x6b000,0x78000),
        (0xb5000,0xcd000),(0xce000,0xd4000),(0xd5000,0xe2000)]
cb = b"".join(d[a:z] for a, z in CODE)
pos = [m.start() for m in re.finditer(rb"\xc3", cb)]
if len(pos) > 2:
    gaps = [pos[k+1]-pos[k] for k in range(len(pos)-1)]
    print("   C3 найдено: %d, средний интервал %.1f байт" % (len(pos), sum(gaps)/len(gaps)))
print("   ожидание для случайных данных: 1/256 = 0.39%% -> %d шт на %d байт" % (len(cb)//256, len(cb)))
print("   фактически: %d" % cb.count(b"\xc3"))

print("\n[7] Гистограмма смещений байта 0x0F (префикс SSE/AVX) по модулю 16")
c = collections.Counter(m.start() % 16 for m in re.finditer(rb"\x0f", cb))
for k in sorted(c):
    print("     %%16==%-2d : %6d" % (k, c[k]))
print("   (в коде x86 с выравниванием будут пики на 0/4/8/12)")

print("\n[8] То же для байта 0xE8 (call rel32)")
c = collections.Counter(m.start() % 16 for m in re.finditer(rb"\xe8", cb))
for k in sorted(c):
    print("     %%16==%-2d : %6d" % (k, c[k]))