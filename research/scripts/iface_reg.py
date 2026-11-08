import winreg, sys

G = "{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}"
paths = [
    r"SYSTEM\CurrentControlSet\Control\DeviceClasses\%s" % G,
    r"SYSTEM\CurrentControlSet\Control\DeviceClasses\%s##?#USB#VID_152A&PID_875C#6&715f466&0&1" % G,
]
for p in paths:
    print("===", p)
    try:
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, p)
    except OSError as e:
        print("   MISSING:", e)
        continue
    nsub, nval, _ = winreg.QueryInfoKey(k)
    print("   subkeys=%d values=%d" % (nsub, nval))
    for i in range(nsub):
        print("   sub:", winreg.EnumKey(k, i))
    for i in range(nval):
        name, val, typ = winreg.EnumValue(k, i)
        print("   val: %s = %r" % (name, val))
