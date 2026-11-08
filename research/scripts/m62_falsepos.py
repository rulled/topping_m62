import zlib, struct, re, collections, math, os

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()

print("="*76)
print("ПРОВЕРКА ЛОЖНЫХ СРАБАТЫВАНИЙ RAW DEFLATE")
print("="*76)

def check(off):
    try:
        obj = zlib.decompressobj(-15)
        out = obj.decompress(d[off:off+400000], 0x300000)
        return out
    except Exception as e:
        return None

# контроль: сколько раз raw deflate "срабатывает" на СЛУЧАЙНЫХ данных?
rnd = os.urandom(300000)
hits_rand = 0
for start in range(0, 2000):
    try:
        obj = zlib.decompressobj(-15)
        out = obj.decompress(rnd[start:start+200000], 0x300000)
        if len(out) > 50000:
            hits_rand += 1
    except Exception:
        pass
print("\n[1] КОНТРОЛЬ: 2000 попыток на случайных данных -> %d 'успехов'" % hits_rand)
print("    (если >0, значит метод даёт ложные срабатывания)")

print("\n[2] проверяем найденные позиции в прошивке")
for off in [0x202bc, 0x4a50d]:
    out = check(off)
    if out is None:
        print("   @%08x : ошибка" % off)
        continue
    print("\n   @%08x -> %d байт" % (off, len(out)))
    c = collections.Counter(out)
    if out:
        e = -sum((v/len(out))*math.log2(v/len(out)) for v in c.values())
        print("      энтропия результата: %.3f" % e)
    print("      первые 64 Б: %s" % " ".join("%02x" % x for x in out[:64]))
    print("      как ASCII  : %r" % out[:64].decode("ascii", "replace"))
    # структура?
    zeros = out.count(0)/len(out)
    print("      доля нулей: %.1f%%" % (100*zeros))

print("\n[3] ВЫВОД по сжатию")
print("""
   Если контроль на случайных данных тоже даёт «успехи» —
   метод непригоден, это ложные срабатывания (raw deflate без
   заголовка может «распаковать» произвольные байты в мусор).
""")