import ctypes as C
from ctypes import wintypes as W

# ---------- setupapi ----------
setupapi = C.WinDLL("setupapi")
hid = C.WinDLL("hid")
cfgmgr32 = C.WinDLL("cfgmgr32")

GUID = C.c_ubyte * 16

class GUID_S(C.Structure):
    _fields_ = [("Data1", W.DWORD), ("Data2", W.WORD), ("Data3", W.WORD),
                ("Data4", C.c_ubyte * 8)]

class SP_DEVICE_INTERFACE_DATA(C.Structure):
    _fields_ = [("cbSize", W.DWORD), ("InterfaceClassGuid", GUID_S),
                ("Flags", W.DWORD), ("Reserved", C.c_void_p)]

class HIDD_ATTRIBUTES(C.Structure):
    _fields_ = [("Size", W.ULONG), ("VendorID", C.c_ushort),
                ("ProductID", C.c_ushort), ("VersionNumber", C.c_ushort)]

class HIDP_CAPS(C.Structure):
    _fields_ = [("Usage", C.c_ushort), ("UsagePage", C.c_ushort),
                ("InputReportByteLength", C.c_ushort),
                ("OutputReportByteLength", C.c_ushort),
                ("FeatureReportByteLength", C.c_ushort),
                ("Reserved", C.c_ushort * 17),
                ("NumberLinkCollectionNodes", C.c_ushort),
                ("NumberInputButtonCaps", C.c_ushort),
                ("NumberInputValueCaps", C.c_ushort),
                ("NumberInputDataIndices", C.c_ushort),
                ("NumberOutputButtonCaps", C.c_ushort),
                ("NumberOutputValueCaps", C.c_ushort),
                ("NumberOutputDataIndices", C.c_ushort),
                ("NumberFeatureButtonCaps", C.c_ushort),
                ("NumberFeatureValueCaps", C.c_ushort),
                ("NumberFeatureDataIndices", C.c_ushort)]

DIGCF_PRESENT = 0x2
DIGCF_DEVICEINTERFACE = 0x10

DIGCF_DEFAULT = 0x1
DIGCF_ALLCLASSES = 0x4

def hid_guid():
    g = GUID_S()
    hid.HidD_GetHidGuid(C.byref(g))
    return g

def guid_str(g):
    d4 = "".join("%02x" % b for b in g.Data4)
    return "{%08X-%04X-%04X-%s-%s}" % (g.Data1, g.Data2, g.Data3, d4[:4], d4[4:])

def enum_interface(guid_struct, flags=DIGCF_PRESENT | DIGCF_DEVICEINTERFACE):
    h = setupapi.SetupDiGetClassDevsW(C.byref(guid_struct), None, None, flags)
    out = []
    if h in (None, -1, 0xFFFFFFFFFFFFFFFF):
        return out
    i = 0
    while True:
        did = SP_DEVICE_INTERFACE_DATA()
        did.cbSize = C.sizeof(did)
        ok = setupapi.SetupDiEnumDeviceInterfaces(h, None, C.byref(guid_struct), i, C.byref(did))
        if not ok:
            break
        req = W.DWORD(0)
        setupapi.SetupDiGetDeviceInterfaceDetailW(h, C.byref(did), None, 0, C.byref(req), None)
        buf = C.create_string_buffer(req.value)
        C.cast(buf, C.POINTER(W.DWORD))[0] = C.sizeof(W.DWORD) * 2 if C.sizeof(C.c_void_p) == 8 else 6
        if setupapi.SetupDiGetDeviceInterfaceDetailW(h, C.byref(did), buf, req.value, C.byref(req), None):
            path = C.wstring_at(C.addressof(buf) + (C.sizeof(W.DWORD) if C.sizeof(C.c_void_p) == 8 else 6))
            out.append((guid_str(did.InterfaceClassGuid), path, did.Flags))
        i += 1
    setupapi.SetupDiDestroyDeviceInfoList(h)
    return out

def probe(path):
    info = {"path": path}
    GENERIC_READ = 0x80000000
    GENERIC_WRITE = 0x40000000
    FILE_SHARE_RW = 0x3
    OPEN_EXISTING = 3
    k32 = C.WinDLL("kernel32", use_last_error=True)
    k32.CreateFileW.restype = W.HANDLE
    k32.CreateFileW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD, C.c_void_p, W.DWORD, W.DWORD, W.HANDLE]
    h = k32.CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_RW, None, OPEN_EXISTING, 0, None)
    if h == W.HANDLE(-1).value or h is None:
        h = k32.CreateFileW(path, 0, FILE_SHARE_RW, None, OPEN_EXISTING, 0, None)
        info["open_mode"] = "0-access"
    else:
        info["open_mode"] = "r/w"
    if h == W.HANDLE(-1).value or h is None:
        info["open"] = "FAILED err=%d" % C.get_last_error()
        return info
    info["open"] = "ok"
    attrs = HIDD_ATTRIBUTES()
    attrs.Size = C.sizeof(attrs)
    if hid.HidD_GetAttributes(h, C.byref(attrs)):
        info["vid"] = "0x%04X" % attrs.VendorID
        info["pid"] = "0x%04X" % attrs.ProductID
        info["ver"] = "0x%04X" % attrs.VersionNumber
    for fn, key, maxlen in ((hid.HidD_GetProductString, "product", 260),
                            (hid.HidD_GetManufacturerString, "manufacturer", 260),
                            (hid.HidD_GetSerialNumberString, "serial", 260)):
        b = C.create_unicode_buffer(maxlen)
        if fn(h, b, C.sizeof(b)):
            info[key] = b.value
    pp = C.c_void_p()
    if hid.HidD_GetPreparsedData(h, C.byref(pp)):
        caps = HIDP_CAPS()
        r = hid.HidP_GetCaps(pp, C.byref(caps))
        if r == 0x110000:
            info["usage"] = "0x%04X" % caps.Usage
            info["usage_page"] = "0x%04X" % caps.UsagePage
            info["in_report_len"] = caps.InputReportByteLength
            info["out_report_len"] = caps.OutputReportByteLength
            info["feature_report_len"] = caps.FeatureReportByteLength
        else:
            info["HidP_GetCaps"] = "failed 0x%X" % (r & 0xFFFFFFFF)
        hid.HidD_FreePreparsedData(pp)
    k32.CloseHandle(h)
    return info

print("HID GUID:", guid_str(hid_guid()))
print()
targets = []
for g, p, fl in enum_interface(hid_guid()):
    if "152a" in p.lower() or "VID_152A" in p.upper():
        targets.append((g, p, fl))
for g, p, fl in targets:
    print("HID IF:", g, "flags=%d" % fl)
    print("  ", p)
    info = probe(p)
    for k, v in info.items():
        print("     %-18s %s" % (k, v))
    print()

print("=== any other interface enumerations for this device ===")
# walk all classes? Instead use CM_Get_Device_Interface_List for the device instance
CM_GET_DEVICE_INTERFACE_LIST_PRESENT = 0x0
instance = r"USB\VID_152A&PID_875C\6&715F466&0&1"
for gname in ["{A5DCBF10-6530-11D2-901F-00C04FB951ED}",  # USB device
              "{4D36E96C-E325-11CE-BFC1-08002BE10318}",  # MEDIA
              "{3C0D501A-140B-11D1-B40F-00A0C9223196}"]:  # MEDIA interface
    pass

# generic: enumerate every GUID seen in registry Interfaces key
import winreg
print("\n=== registry-listed device interfaces mentioning M62/152A ===")
base = r"SYSTEM\CurrentControlSet\Control\DeviceClasses"
try:
    root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, base)
except OSError as e:
    print("no DeviceClasses:", e)
    root = None
if root:
    n = winreg.QueryInfoKey(root)[0]
    for i in range(n):
        cls = winreg.EnumKey(root, i)
        try:
            k2 = winreg.OpenKey(root, cls + r"##?#USB#VID_152A&PID_875C#6&715f466&0&1")
        except OSError:
            continue
        print(" class", cls)
        for j in range(winreg.QueryInfoKey(k2)[0]):
            print("   instance:", winreg.EnumKey(k2, j))
