import struct

# Сопоставление: то, что я нашёл в MCC/KBCC, против таблицы из mainline-драйвера
print("="*78)
print("СОПОСТАВЛЕНИЕ: теги из приложения vs таблица mainline-драйвера")
print("="*78)

# Из mainline-драйвера (TT, PP) -> имя
driver = {
    (0x21, 0x04): "Mic-1 Capture Volume",
    (0x22, 0x04): "Mic-2 Capture Volume",
    (0x23, 0x04): "Aux Capture Volume",
    (0x25, 0x04): "Bluetooth Capture Volume",
    (0x27, 0x04): "OTG Capture Volume",
    (0x64, 0x03): "Headphone Playback Volume (reports)",
    (0x63, 0x03): "Headphone Playback Volume (pair)",
    (0x62, 0x03): "OTG Playback Volume (reports)",
    (0x61, 0x03): "OTG Playback Volume (pair)",
    (0x64, 0x02): "Headphone Playback Source",
    (0x62, 0x02): "OTG Playback Source",
    (0x11, 0x24): "SUBSCRIBE (keepalive)",
    (0x11, 0x26): "ANNOUNCE (report all)",
}

# То, что я нашёл в MCC (case 7: Effect_Integration / Effect_NC / Effect_Reverb)
mcc = {
    0x4401: "Effect_Integration / Input1Level",
    0x4402: "Effect_Integration / Input2Level",
    0x4403: "Effect_Integration / AuxLevel",
    0x4404: "Effect_Integration / BluetoothLevel",
    0x4405: "Effect_Integration / OtgLevel",
    0x4406: "Effect_NC / NoiseReduction",
    0x4407: "Effect_NC / NoiseReductionType",
    0x4408: "Effect_Reverb / DryWet",
    0x4409: "Effect_Reverb / Room",
    0x440a: "Effect_Reverb / Decay",
    0x440b: "Effect_Reverb / ReverbType",
    0x440c: "Effect_Reverb / MuteFX",
    0x440f: "Effect_Reverb / Width",
}

print("\n[1] Таблица mainline-драйвера (TT, PP):")
for (tt, pp), name in sorted(driver.items()):
    print("   TT=0x%02x PP=0x%02x  %s" % (tt, pp, name))

print("\n[2] То, что нашёл я в MCC (tag3 = 0x44xx):")
for t, name in sorted(mcc.items()):
    print("   0x%04x  %s" % (t, name))

print("\n[3] КЛЮЧЕВОЕ: как соотносятся 0x44xx (моё) и TT/PP (драйвер)?")
print("""
   В драйвере кадр:  22 33 | 20 01 01 | TT | PP | value | CRC | 66 77
   В приложении:     XX XX | XX XX XX | t3 | t8 | value | ... | XX XX

   Я разобрал кадр приложения как:
       байт3 = tag3, байт8 = tag8, байт9 = tag9, тег = (tag8<<8)|tag9

   НО в драйвере ПОСЛЕ 20 01 01 идут СРАЗУ TT и PP (по одному байту),
   потом 4 байта значения и 2 байта CRC.

   Значит моя разметка была СДВИНУТА. Пересобираю:
       приложение: 00 22 33 20 01 01 TT PP v v v v c c 66 77
                     ^report ID (usbhid отбрасывает)
""")

print("\n[4] ПРОВЕРКА на реальных байтах из MCC")
# Из моего анализа: FUN_14022ba00 строит local_30:
#   [0]=0x00 [1]=0x22 [2]=0x33 [3]=param[0xc] [4..7]=BE int32
#   [8]=param[8] [9]=param[9] [10]=0 [11]=0x66 [12]=0 [13]=0x77
print("   Wait — размер был 16 байт, а не 15. Пересчитываю структуру.")
print("""
   Из декомпиляции FUN_14022ba00 (MCC) буфер local_30[16]:
     local_30[0] = 0x00
     local_30[1] = 0x22
     local_30[2] = 0x33
     local_30[3] = param[0xc]
     local_28..local_25 = BE int32 (из param[4..7])
     local_2c = param[8]
     local_2b = param[9]
     local_24 = 0x77660000  -> байты 0x00,0x66,0x00,0x77

   Итого 16 байт. Но параметр-структура param[] — 13 байт.

   В драйвере кадр 15 байт:
     22 33 20 01 01 TT PP <4 value> <2 crc> 66 77

   Сопоставляю позиции:
     драйвер[0..1]  = 22 33        <-> приложение[1..2] = 22 33   OK
     драйвер[2..4]  = 20 01 01     <-> приложение[3..5] = param[0xc], param[0], param[1]?
     драйвер[5]     = TT           <-> приложение[6] = param[?]
     драйвер[6]     = PP           <-> приложение[7] = param[?]
     драйвер[7..10] = value BE     <-> приложение[8..11]? — НЕ совпадает
""")

print("\n[5] ВЫВОД: нужно перечитать декомпиляцию внимательнее.")
print("""
   Скорее всего приложение строит кадр ИНАЧЕ, либо я неверно
   определил границы param[]. Требуется повторная проверка FUN_14022ba00
   с учётом того, что мы теперь ЗНАЕМ точный формат 15 байт.
""")