import ctypes as C
from ctypes import wintypes as W
import winreg

cfgmgr32 = C.WinDLL("cfgmgr32")

CM_GET_DEVICE_INTERFACE_LIST_PRESENT = 0x0
CR_SUCCESS = 0
MAX = 4096

def get_interfaces(instance):
    size = W.ULONG(0)
    r = cfgmgr32.CM_Get_Device_Interface_List_SizeW(C.byref(size), None, instance,
                                                    CM_GET_DEVICE_INTERFACE_LIST_PRESENT)
    print("size query rc=%d size=%d" % (r, size.value))
    if r != CR_SUCCESS or size.value == 0:
        return []
    buf = C.create_unicode_buffer(size.value + 2)
    r = cfgmgr32.CM_Get_Device_Interface_ListW(None, instance, buf, size.value,
                                               CM_GET_DEVICE_INTERFACE_LIST_PRESENT)
    print("list rc=%d err=%d" % (r, ctypes_get_last_error()))
    if r != CR_SUCCESS:
        return []
    out, cur = [], []
    for ch in buf:
        if ch == "\0":
            if cur:
                out.append("".join(cur))
                cur = []
        else:
            cur.append(ch)
    return out

def ctypes_get_last_error():
    return C.get_last_error()

inst = r"USB\VID_152A&PID_875C\6&715F466&0&1"
print("=== interfaces of", inst)
for p in get_interfaces(inst):
    print("  ", p)

print()
print("=== device property keys (control interface GUIDs) ===")
for k in (r"SYSTEM\CurrentControlSet\Enum\%s" % inst,):
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, k)
    except OSError as e:
        print("open failed", e); continue
    for j in range(winreg.QueryInfoKey(key)[1]):
        name, val, typ = winreg.EnumValue(key, j)
        if isinstance(val, str) and val.startswith("{"):
            print("  %-30s %s" % (name, val))
        elif len(name) < 40:
            print("  %-30s %s" % (name, val if not isinstance(val, bytes) else "bytes[%d]" % len(val)))
