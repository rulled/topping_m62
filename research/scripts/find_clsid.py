import winreg, sys

# Find the CLSID whose InprocServer32 points at ToppingProUsbAudioapi*.dll
found = []

def scan(root, subkey_path, depth=0, maxdepth=1):
    try:
        k = winreg.OpenKey(root, subkey_path)
    except OSError:
        return
    i = 0
    while True:
        try:
            name = winreg.EnumKey(k, i)
        except OSError:
            break
        i += 1
        full = subkey_path + "\\" + name
        if depth < maxdepth:
            scan(root, full, depth + 1, maxdepth)
        # try to read InprocServer32 directly
        try:
            k2 = winreg.OpenKey(root, full + "\\InprocServer32")
            val, _ = winreg.QueryValueEx(k2, "")
            winreg.CloseKey(k2)
            if "Topping" in val or "tusb" in val.lower():
                found.append((name, val))
        except OSError:
            pass

scan(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\CLSID", 0, 1)

for n, v in found:
    print(n, "->", v)

print("total", len(found))
