import re, struct

mcc = open(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe","rb").read()

print("="*78)
print("УТОЧНЕНИЕ: как MCC общается с устройством")
print("="*78)

print("\n[1] hid.dll грузится динамически (LoadLibrary) — ищем имя в UTF-16")
for enc, name in [("utf-16le", "hid.dll"), ("ascii", "hid.dll")]:
    pat = name.encode(enc)
    offs = [m.start() for m in re.finditer(re.escape(pat), mcc)]
    print("   %-10s '%s': %d  %s" % (enc, name, len(offs), [hex(o) for o in offs[:5]]))

print("\n[2] имена HidD_* функций (для GetProcAddress)")
hid_funcs = set()
for m in re.finditer(rb"HidD_[A-Za-z]{3,}", mcc):
    hid_funcs.add(m.group().decode())
for f in sorted(hid_funcs):
    print("   ", f)

print("\n[3] другие HID-функции")
for pat in [rb"HidP_", rb"CreateFileW", rb"WriteFile", rb"ReadFile",
            rb"SetupDi", rb"CM_Get_Device_Interface"]:
    n = len(re.findall(pat, mcc))
    print("   %-28s %d" % (pat.decode(), n))

print("\n[4] device interface GUID из INF (для пути к HID)")
guid_ascii = b"{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}"
guid_upper = b"{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}"
for g, nm in [(guid_ascii,"lower ascii"), (guid_upper,"upper ascii")]:
    print("   %-14s %d" % (nm, mcc.count(g)))
# utf-16
gu16 = "{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}".encode("utf-16-le")
gu16l = "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}".encode("utf-16-le")
print("   utf-16 upper   %d" % mcc.count(gu16))
print("   utf-16 lower   %d" % mcc.count(gu16l))

print("\n[5] ВАЖНО: ищем, что MCC грузит ПЕРВЫМ — hid или tusbaudio")
print("   строки TUSBAUDIO_*:")
tu = sorted(set(m.group().decode() for m in re.finditer(rb"TUSBAUDIO_[A-Za-z]+", mcc)))
print("   всего:", len(tu))
dsp = [s for s in tu if "Dsp" in s or "Vendor" in s or "Class" in s]
print("   DSP/vendor-related:", dsp)

print("\n[6] ищем имена DLL, которые грузит MCC")
for m in re.finditer(rb"[\x20-\x7e]{4,}\.dll", mcc):
    pass
dlls = set()
for m in re.finditer(rb"[\x20-\x7e]{3,40}\.dll", mcc):
    s = m.group().decode("ascii")
    if "/" not in s and "\\" not in s:
        dlls.add(s)
print("   найдено уникальных .dll имён:", len(dlls))
for d in sorted(dlls)[:40]:
    print("     ", d)

print("\n[7] UTF-16 .dll имена")
dlls16 = set()
for m in re.finditer(rb"(?:[\x20-\x7e]\x00){3,40}\.\x00d\x00l\x00l\x00", mcc):
    s = m.group().decode("utf-16-le")
    dlls16.add(s)
for d in sorted(dlls16):
    print("     ", d)