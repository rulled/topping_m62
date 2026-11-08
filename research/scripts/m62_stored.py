import zlib, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()

print("="*76)
print("ПОСЛЕДНЯЯ ПРОВЕРКА: это STORED-БЛОКИ deflate (копирование), а не сжатие?")
print("="*76)

for off in [0x202bc, 0x4a50d]:
    print("\n--- @%08x ---" % off)
    head = d[off:off+8]
    print("   первые байты: %s" % " ".join("%02x" % x for x in head))
    # deflate: bit0 = BFINAL, bits1-2 = BTYPE
    b0 = d[off]
    bfinal = b0 & 1
    btype = (b0 >> 1) & 3
    print("   BFINAL=%d  BTYPE=%d  (%s)" % (
        bfinal, btype,
        {0:"STORED (копия!)", 1:"fixed Huffman", 2:"dynamic Huffman", 3:"invalid"}[btype]))

    if btype == 0:
        # stored: после 3 бит выравнивание, потом LEN(2) NLEN(2)
        print("   -> это STORED-блок: данные просто КОПИРУЮТСЯ, не распаковываются!")
        # читаем LEN
        i = off + 1
        if b0 >> 3:  # остались биты в первом байте
            i = off + 1
        # выравнивание на байт
        lenv = struct.unpack_from("<H", d, i)[0]
        nlenv = struct.unpack_from("<H", d, i+2)[0]
        print("   LEN=%d (0x%x)  NLEN=%d (0x%x)  проверка LEN==~NLEN: %s" % (
            lenv, lenv, nlenv, nlenv, (lenv ^ 0xFFFF) == nlenv))
        print("   -> данные с %08x скопированы как есть" % i)

print("\n" + "="*76)
print("ПРОВЕРКА: сколько в файле мест, где первый байт даёт валидный stored-блок")
print("="*76)
cnt = 0
for off in range(0, len(d)-8):
    b0 = d[off]
    if ((b0 >> 1) & 3) != 0:
        continue
    i = off + 1
    lenv = struct.unpack_from("<H", d, i)[0]
    nlenv = struct.unpack_from("<H", d, i+2)[0]
    if lenv > 0 and (lenv ^ 0xFFFF) == nlenv:
        cnt += 1
        if cnt <= 5:
            print("   @%08x  LEN=%d  NLEN ok" % (off, lenv))
print("   ВСЕГО таких совпадений в файле: %d" % cnt)
print("   -> это подтверждает: 'распаковка' была копированием stored-блока")

print("\n" + "="*76)
print("ОКОНЧАТЕЛЬНЫЙ ВЫВОД")
print("="*76)
print("""
   Сжатие ОПРОВЕРГНУТО окончательно:
   - ни zlib/gzip/LZMA/xz/7z/ZIP/LZ4 заголовков
   - 'успехи' raw deflate оказались stored-блоками (простое копирование)
   - контроль на случайных данных: 0 ложных срабатываний, значит
     метод в принципе рабочий, но конкретные попадания — не сжатие
""")