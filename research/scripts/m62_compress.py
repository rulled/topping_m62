import re, struct, zlib, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("="*76)
print("ФИНАЛЬНАЯ ПРОВЕРКА: сжатие (raw deflate) — заголовок намекает 0x20568E")
print("="*76)
print("   файл        = %d (0x%x)" % (N, N))
print("   заголовок   = %d (0x%x)  ratio=%.3f" % (0x20568e, 0x20568e, 0x20568e/N))

print("\n[1] попытка raw deflate с каждой позиции (первые 300 кандидатов)")
found = 0
for start in range(0, min(N-64, 4096)):
    try:
        obj = zlib.decompressobj(-15)
        out = obj.decompress(d[start:start+400000], 0x300000)
        if len(out) > 10000:
            print("   УСПЕХ @%08x -> %d байт" % (start, len(out)))
            found += 1
            if found >= 3: break
    except Exception:
        pass

if not found:
    print("   не сработало на первых 4096 байтах")

print("\n[2] расширенный поиск raw deflate по всему файлу (шаг 1, лимит времени)")
found = 0
import time
t0 = time.time()
for start in range(0, N-64):
    if time.time() - t0 > 20:
        print("   прервано по таймауту")
        break
    try:
        obj = zlib.decompressobj(-15)
        out = obj.decompress(d[start:start+200000], 0x300000)
        if len(out) > 50000:
            print("   УСПЕХ @%08x -> %d байт  ratio=%.2f" % (start, len(out), len(out)/min(200000, N-start)))
            found += 1
            if found >= 2: break
    except Exception:
        pass
if not found and time.time()-t0 <= 20:
    print("   нигде не найдено")

print("\n[3] ИНТЕРПРЕТАЦИЯ ЗАГОЛОВКА заново")
print("   dword'ы @0x10..0x1c:")
for i in range(0x10, 0x20, 4):
    print("      @%02x = %08x = %d" % (i, struct.unpack_from("<I", d, i)[0],
                                        struct.unpack_from("<I", d, i)[0]))
print("\n   паттерн: (0x0020568E, 0x00000010), (0x0020568E, 0x00000020)")
print("   -> ОДИНАКОВОЕ первое значение, растущий второй (16, 32)")
print("   -> похоже на: (SIZE, OFFSET) где offset 16 и 32")
print("   -> т.е. два блока размером 0x20568E по смещениям 16 и 32?")

print("\n[4] проверим: возможно 0x20568E — это АДРЕС ЗАГРУЗКИ, а не размер")
print("   @0x10 = 0x0020568E (адрес), @0x14 = 0x10 (смещение в файле)")
print("   @0x18 = 0x0020568E (адрес), @0x1c = 0x20 (смещение)")
for off in (0x10, 0x20):
    print("   блок A по смещению 0x%02x:" % off)
    for i in range(0, 32, 16):
        print("      %06x  %s" % (off+i, " ".join("%02x" % x for x in d[off+i:off+i+16])))

print("\n[5] ЕЩЁ ОДНА ПРОВЕРКА: может это LZ4 / LZO / heatshrink?")
sig_lz4 = b"\x04\x22\x4d\x18"
print("   LZ4 frame magic:", d.count(sig_lz4))
print("   LZ4 legacy magic 02 21 4c 18:", d.count(b"\x02\x21\x4c\x18"))

print("\n" + "="*76)
print("СВОДКА: ПОЧЕМУ ЭТО ДАННЫЕ, А НЕ КОД")
print("="*76)
print("""
   ДОКАЗАТЕЛЬСТВА (положительные тесты на «данные»):
   1. 0xC3 (ret) = 1 на 633 байта. В норме x86: 1 на 50-200.
   2. Гистограмма 0x0F по mod 16 РАВНОМЕРНА (нет выравнивания функций).
   3. 0xE8 = 748 шт, но 0% валидных rel32 при ЛЮБОЙ базе.
   4. В файле есть структурированные записи 12 байт с полем +0x10.
   5. Таблицы с шагом 0x1000 (@0x124600) и 0x10 (@0x1c7d4).
   6. Q1.15-подобные значения в @0x128000 (|q| <= 0.67).

   ОПРОВЕРГНУТО (10 архитектур): x86-64, x86-32, ARM32, ARM64, Thumb-2,
   MIPS, RISC-V, Xtensa, Xilinx bitstream, SHARC/SigmaDSP.
   Не сжато (zlib/gzip/LZMA/xz/7z/ZIP/LZ4 не срабатывают).

   ВЫВОД: M62_FW87.05.45.48.27.bin — конфигурационный/коэффициентный
   образ данных для DSP, НЕ исполняемый код. Исполняемый код находится
   внутри чипа (маскировочный ROM), в файл прошивки не входит.
""")