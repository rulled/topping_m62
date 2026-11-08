import re, os, collections

bins = {
    "MCC (M62 app)": r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe",
    "KBCC (KB22 app)": r"C:\Program Files\TOPPING Pro\KB Control Center\KB Control Center.exe",
}

def strings(data):
    out = set()
    for m in re.finditer(rb"[\x20-\x7e]{4,}", data):
        out.add(m.group().decode("ascii"))
    # utf16le
    for m in re.finditer(rb"(?:[\x20-\x7e]\x00){4,}", data):
        out.add(m.group().decode("utf-16-le", errors="ignore"))
    return out

S = {}
for k, p in bins.items():
    S[k] = strings(open(p, "rb").read())
    print(k, "unique strings:", len(S[k]))

mcc, kbcc = S["MCC (M62 app)"], S["KBCC (KB22 app)"]

# ---------- decisive: device class / model handling ----------
print("\n=== device-model identifiers ===")
for kw in ["DeviceM62", "DeviceKB22", "DeviceUM1", "DeviceE1x2", "DeviceE2x2", "DeviceE4x4",
           "DeviceE8x8", "DeviceMble", "DeviceM62Pro",
           "MainWindow_M62", "MainWindow_KB22", "MainWindowM62", "MainWindowKB22",
           "KB22", "M62", "UM1"]:
    a = sum(1 for s in mcc if kw in s)
    b = sum(1 for s in kbcc if kw in s)
    if a or b:
        print("  %-22s MCC=%3d  KBCC=%3d" % (kw, a, b))

print("\n=== exact matches of Device* classes ===")
devs = sorted({s for s in (mcc | kbcc) if re.fullmatch(r"Device[A-Za-z0-9_]+", s)})
for s in devs:
    print("   %-28s MCC=%s KBCC=%s" % (s, "Y" if s in mcc else "-", "Y" if s in kbcc else "-"))

print("\n=== KB22-only windows/classes that appear in MCC ===")
kbonly = sorted(s for s in kbcc if s not in mcc and len(s) > 6 and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", s))
print("  total KBCC-only identifier-like strings:", len(kbonly))
for s in kbonly[:60]:
    print("   ", s)

print("\n=== M62-only identifiers (in MCC, not KBCC) ===")
mcconly = sorted(s for s in mcc if s not in kbcc and len(s) > 6 and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", s))
print("  total:", len(mcconly))
for s in mcconly[:60]:
    print("   ", s)

# ---------- workspace paths ----------
print("\n=== workspace path strings ===")
for s in sorted(x for x in (mcc | kbcc) if "Workspace" in x and len(x) < 90):
    print("   M62 " if s in mcc else "   --- ", end="")
    print("KB22" if s in kbcc else "----", " ", s)