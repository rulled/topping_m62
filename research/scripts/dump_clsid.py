import winreg, os

def dump(root, path, lines, depth=0, maxdepth=3):
    try:
        k = winreg.OpenKey(root, path)
    except OSError:
        return
    i = 0
    while True:
        try:
            name = winreg.EnumKey(k, i)
        except OSError:
            break
        i += 1
        full = path + "\\" + name
        lines.append("  " * depth + "[" + name + "]")
        # values
        j = 0
        while True:
            try:
                vn, vv, vt = winreg.EnumValue(k, i - 1) if False else (None, None, None)
                break
            except Exception:
                break
        if depth < maxdepth:
            dump(root, full, lines, depth + 1, maxdepth)

def dump2(root, path, out, depth=0, maxdepth=4):
    try:
        k = winreg.OpenKey(root, path)
    except OSError:
        return
    nsub, nval, _ = winreg.QueryInfoKey(k)
    for j in range(nval):
        try:
            vn, vv, vt = winreg.EnumValue(k, j)
        except OSError:
            continue
        out.append("  " * depth + path.split("\\")[-1] + " :: " + repr(vn) + " = " + repr(vv) + " (type %d)" % vt)
    for j in range(nsub):
        try:
            name = winreg.EnumKey(k, j)
        except OSError:
            continue
        if depth < maxdepth:
            dump2(root, path + "\\" + name, out, depth + 1, maxdepth)

out = []
for root, base in [
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\CLSID\{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}"),
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\Wow6432Node\CLSID\{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}"),
]:
    out.append("### " + base)
    dump2(root, base, out)
for line in out:
    print(line)
