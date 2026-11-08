import re, struct

mcc = open(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe","rb").read()

print("="*78)
print("ПОИСК: полный 15/16-байтовый кадр в MCC.exe")
print("="*78)

# Формат из mainline: 22 33 20 01 01 TT PP vvvv cccc 66 77
# В приложении: кадр строится в рантайме, но проверки/парсеры могут
# содержать константы. Ищем шаблоны.

print("\n[1] прямой поиск байтов '22 33 20 01 01'")
for m in re.finditer(rb"\x22\x33\x20\x01\x01", mcc):
    i = m.start()
    print("   @%08x  ctx: %s" % (i, " ".join("%02x" % b for b in mcc[max(0,i-8):i+20])))

print("\n[2] поиск '66 77' (хвост кадра)")
n = len(re.findall(rb"\x66\x77", mcc))
print("   всего вхождений '66 77':", n)
for m in list(re.finditer(rb"\x66\x77", mcc))[:20]:
    i = m.start()
    print("   @%08x  ctx: %s" % (i, " ".join("%02x" % b for b in mcc[max(0,i-20):i+6])))

print("\n[3] поиск '00 66 00 77' (то, что я видел в упаковщике)")
for m in list(re.finditer(rb"\x00\x66\x00\x77", mcc))[:10]:
    i = m.start()
    print("   @%08x  ctx: %s" % (i, " ".join("%02x" % b for b in mcc[max(0,i-16):i+12])))

print("\n[4] поиск CRC-16/MODBUS таблицы (poly 0xA001)")
# таблица CRC16 обычно 512 байт (256 x u16)
print("   ищем таблицу из 256 последовательных u16 (возрастающие?)")
# Это сложно; вместо этого поищем характерное начало таблицы CRC16/Modbus
# Первые элементы стандартной таблицы: 0x0000, 0xC0C1, 0xC181, 0x0140, ...
crc_tbl_start = bytes([0x00,0x00, 0xC1,0xC0, 0x81,0xC1, 0x40,0x01])
print("   стандартная таблица CRC16 (LE u16):", mcc.count(crc_tbl_start), "совпадений")
crc_tbl_start_be = bytes([0x00,0x00, 0xC0,0xC1, 0xC1,0x81, 0x01,0x40])
print("   стандартная таблица CRC16 (BE u16):", mcc.count(crc_tbl_start_be), "совпадений")

# ищем саму константу 0xA001 (полином)
print("   полином 0xA001 как u32:", len(re.findall(re.escape(struct.pack('<I',0xA001)), mcc)))
print("   полином 0xA001 как u16:", len(re.findall(re.escape(struct.pack('<H',0xA001)), mcc)))
print("   полином 0x8005 (MODBUS нормальный):", mcc.count(struct.pack('<H',0x8005)))

print("\n[5] поиск константы init 0xFFFF рядом с полиномом")
pat = struct.pack('<H', 0xFFFF)
print("   0xFFFF как u16:", len(re.findall(re.escape(pat), mcc)))

print("\n[6] ИЩЕМ hid.dll использование — теперь понятно зачем")
for s in [b"hid.dll", b"HidD_", b"WriteFile", b"ReadFile", b"CreateFileW",
          b"\\\\?\\hid#", b"hid#vid_", b"DeviceInterface"]:
    n = len(re.findall(re.escape(s), mcc))
    print("   %-24s %d" % (s.decode('ascii','replace'), n))

print("\n[7] ASCII-строки, относящиеся к HID-пути")
seen=set()
for m in re.finditer(rb"[\x20-\x7e]{6,}", mcc):
    s = m.group().decode("ascii")
    if any(k in s for k in ["hid#", "HID", "Hid", "\\\\?\\", "DevicePath",
                             "VID_", "VID&", "MI_0", "Col"]):
        if s not in seen:
            seen.add(s)
print("   найдено уникальных:", len(seen))
for s in sorted(seen)[:40]:
    print("     ", s[:100])