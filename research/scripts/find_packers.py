import re, json

# Ищем в MCC ВСЕ упаковщики кадров и их теги, чтобы понять полную карту.
# Упаковщик имеет характерный вид: он пишет байты 0x22, 0x33, ..., 0x66,
# 0x00, 0x77 и формирует tag из двух байт.

mcc = open(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe", "rb").read()

print("="*78)
print("ПОИСК ВСЕХ УПАКОВЩИКОВ КАДРОВ В MCC")
print("="*78)

# Упаковщик в MCC (FUN_14022ba00) содержит:
#   local_30[0]='\0'; local_30[1]='"'; local_30[2]=0x33
#   ...
#   local_24 = 0x77660000
# То есть последовательность байтов: 00 22 33 .. .. .. .. .. .. .. .. 00 66 00 77
# Ищем в коде инструкции mov с этими константами.

print("\n[1] поиск константы 0x77660000 (хвост кадра) как u32 immediate")
pat = bytes([0x00, 0x00, 0x66, 0x77])
for m in re.finditer(re.escape(pat), mcc):
    i = m.start()
    print("   @%08x  ctx: %s" % (i, " ".join("%02x" % b for b in mcc[max(0,i-24):i+8])))

print("\n[2] поиск mov dword [rbp-X], 0x77660000  (C7 45 XX 00 00 66 77)")
for m in re.finditer(rb"\xc7\x45[\x00-\xff]\x00\x00\x66\x77", mcc):
    i = m.start()
    off = mcc[i+2]
    print("   @%08x  mov dword [rbp-0x%02x], 0x77660000" % (i, off))

print("\n[3] поиск mov dword [rsp+X], 0x77660000  (C7 44 24 XX 00 00 66 77)")
for m in re.finditer(rb"\xc7\x44\x24[\x00-\xff]\x00\x00\x66\x77", mcc):
    i = m.start()
    print("   @%08x  mov dword [rsp+0x%02x], 0x77660000" % (i, mcc[i+3]))

print("\n[4] поиск байтовой последовательности 22 33 в начале буфера")
# упаковщик пишет: local[1]='"'(0x22), local[2]=0x33 -> ищем mov byte
for m in re.finditer(rb"\xc6\x45[\x00-\xff]\x22\xc6\x45", mcc):
    i = m.start()
    print("   @%08x  mov byte [rbp-0x%02x], 0x22 ..." % (i, mcc[i+2]))

print("\n[5] ВСЕ 16-битные теги вида 0x44NN, 0x9bNN, 0xabNN, 0xbNNN, 0xcNNN в MCC")
# Собираем константы, которые встречаются в коде как immediate
fams = {
    "0x11": "device",       "0x12": "device2",
    "0x21": "input1",       "0x22": "input2",   "0x23": "aux",
    "0x25": "bt",           "0x27": "otgin",
    "0x31": "out?",         "0x32": "out?",     "0x33": "out?",
    "0x34": "out?",         "0x35": "out?",     "0x36": "out?",
    "0x41": "?",            "0x42": "?",        "0x43": "?",
    "0x44": "EFFECT",       "0x45": "?",        "0x46": "?",
    "0x51": "loopback",     "0x52": "loopback", "0x53": "loopback",
    "0x54": "loopback",     "0x55": "loopback", "0x56": "loopback",
    "0x57": "loopback",     "0x58": "loopback", "0x59": "loopback",
    "0x5a": "loopback",     "0x5b": "loopback", "0x5c": "loopback",
    "0x60": "mixer",        "0x61": "out otg?", "0x62": "out otg",
    "0x63": "out hp?",      "0x64": "out hp",
    "0x90": "EQ",           "0x91": "EQ",       "0x92": "EQ",
    "0x93": "EQ",           "0x94": "EQ",       "0x95": "EQ",
    "0x9b": "?",            "0xa0": "EQ HP",    "0xab": "EQ HP",
    "0xb1": "?",            "0xb3": "comp",     "0xb7": "ducking",
    "0xb8": "ducking",      "0xc1": "?",        "0xc5": "echo",
    "0xc6": "reverb",
}

print(f"\n  {'tag':<8} {'семейство':<12} {'встреч как u32':<16} описание")
for f in sorted(fams):
    lo = int(f, 16) << 8
    cnt = 0
    for pp in range(256):
        tag = lo | pp
        cnt += len(re.findall(re.escape(tag.to_bytes(4, "little")), mcc))
    if cnt:
        print(f"  {f}xx    {fams[f]:<12} {cnt:<16}")