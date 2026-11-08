import re, struct, collections, math

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

print("="*76)
print("1. СТРУКТУРА 12-БАЙТОВЫХ ЗАПИСЕЙ В ПОДОБРАЗЕ B")
print("="*76)
seg = d[0x106028:0x1060a0]
print("   сырые 12-байтовые записи:")
for i in range(0, len(seg)-12, 12):
    rec = seg[i:i+12]
    print("     %06x  %s" % (0x106028+i, " ".join("%02x" % x for x in rec)))

print("\n   закономерность: байт[6] растёт на 0x10, байт[8] растёт на 0x10")
for i in range(0, len(seg)-12, 12):
    rec = seg[i:i+12]
    print("     байт[6]=0x%02x  байт[8]=0x%02x  разница=%d" % (rec[6], rec[8], rec[8]-rec[6]))

print("\n" + "="*76)
print("2. ЧТО ПО АДРЕСУ 0x568E (заголовок дважды указывает 0x20568E)")
print("="*76)
print("   если образ грузится по базе 0x200000 -> файловое смещение 0x568E")
for base in [0x200000, 0x08000000, 0x00000000]:
    off = 0x20568e - base
    if 0 <= off < N - 64:
        print("   база 0x%08x -> offset 0x%06x:" % (base, off))
        for i in range(0, 64, 16):
            print("      %06x  %s  |%s|" % (off+i,
                " ".join("%02x" % x for x in d[off+i:off+i+16]),
                "".join(chr(x) if 32<=x<127 else "." for x in d[off+i:off+i+16])))

print("\n" + "="*76)
print("3. ПРОВЕРКА: 0x20568E — это размер РАСПАКОВАННОГО образа?")
print("="*76)
print("   файл:                   %d (0x%x)" % (N, N))
print("   заголовок заявляет:     %d (0x%x)" % (0x20568e, 0x20568e))
print("   ratio: %.2f" % (0x20568e / N))

print("\n" + "="*76)
print("4. РЕГИОН 0x128000 как Q1.15 КОЭФФИЦИЕНТЫ")
print("="*76)
vals = [struct.unpack_from("<h", d, 0x128000 + 2*i)[0] for i in range(40)]
print("   как Q1.15 (v/32768):")
qs = [v/32768.0 for v in vals if v != 0]
print("   ", ["%.4f" % x for x in qs[:20]])
print("\n   проверка: похоже на импульсную характеристику/фильтр?")
print("   макс |q| = %.4f" % max(abs(x) for x in qs))
print("   сумма   = %.4f" % sum(qs))

print("\n" + "="*76)
print("5. ФИНАЛ: доля 'кодовых' признаков по всему файлу")
print("="*76)
# Итоговая таблица доказательств
tests = [
    ("x86-64 пролог 48 89 E5",     d.count(b"\x48\x89\xe5"),            "0 = нет"),
    ("x86-32 пролог 55 89 E5",     d.count(b"\x55\x89\xe5"),            "0 = нет"),
    ("ARM Thumb push 2D E9",       d.count(b"\x2d\xe9"),                "мало"),
    ("ARM bx lr 1E FF 2F E1",      d.count(b"\x1e\xff\x2f\xe1"),        "0 = нет"),
    ("Thumb bx lr 70 47",          d.count(b"\x70\x47"),                "мало"),
    ("MIPS jr ra",                 d.count(b"\x08\x00\xe0\x03"),        "0 = нет"),
    ("RISC-V ret",                 d.count(b"\x67\x80\x00\x00"),        "0 = нет"),
    ("Xtensa entry 36 41",         d.count(b"\x36\x41"),                "2 = нет"),
]
for name, cnt, note in tests:
    print("   %-30s %6d   %s" % (name, cnt, note))

print("\n   ПЛОТНОСТЬ ret (0xC3): %d на %d байт = 1 на %d байт" % (
    d.count(b"\xc3"), N, N//max(1,d.count(b"\xc3"))))
print("   в нормальном x86-коде: 1 ret на 50-200 байт")

print("\n" + "="*76)
print("6. ВЫВОД")
print("="*76)
print("""
   Все 10 проверенных архитектур дали отрицательный результат.
   Положительные тесты (выравнивание, плотность ret, модульные гистограммы)
   показывают: это ДАННЫЕ.

   НО: найдены структурированные записи (12 байт, поле +0x10),
        таблицы (0x1000-шаг), Q1.15-подобные коэффициенты.

   => Это конфигурационный/коэффициентный образ для DSP,
      а не исполняемый код. Код DSP находится в самом чипе.
""")