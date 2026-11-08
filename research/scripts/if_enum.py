import ctypes as C
from ctypes import wintypes as W
import uuid

setupapi = C.WinDLL("setupapi")

class GUID_S(C.Structure):
    _fields_ = [("Data1", W.DWORD), ("Data2", W.WORD), ("Data3", W.WORD),
                ("Data4", C.c_ubyte * 8)]

class SP_DEVICE_INTERFACE_DATA(C.Structure):
    _fields_ = [("cbSize", W.DWORD), ("InterfaceClassGuid", GUID_S),
                ("Flags", W.DWORD), ("Reserved", C.c_void_p)]

DIGCF_PRESENT = 0x2
DIGCF_DEVICEINTERFACE = 0x10

def make_guid(s):
    u = uuid.UUID(s.strip("{}"))
    g = GUID_S()
    g.Data1, g.Data2, g.Data3 = u.time_low, u.time_mid, u.time_hi_version
    for i, b in enumerate(u.bytes[8:]):
        g.Data4[i] = b
    return g

def du(g):
    return "{%08X-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X}" % (
        g.Data1, g.Data2, g.Data3, *g.Data4)

def enum(g):
    h = setupapi.SetupDiGetClassDevsW(C.byref(g), None, None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)
    res = []
    if h in (None, -1, 0xFFFFFFFFFFFFFFFF):
        return res
    i = 0
    while True:
        did = SP_DEVICE_INTERFACE_DATA()
        did.cbSize = C.sizeof(did)
        if not setupapi.SetupDiEnumDeviceInterfaces(h, None, C.byref(g), i, C.byref(did)):
            break
        req = W.DWORD(0)
        setupapi.SetupDiGetDeviceInterfaceDetailW(h, C.byref(did), None, 0, C.byref(req), None)
        buf = C.create_string_buffer(req.value)
        # cbSize field of SP_DEVICE_INTERFACE_DETAIL_DATA_W
        C.cast(buf, C.POINTER(W.DWORD))[0] = 8 if C.sizeof(C.c_void_p) == 8 else 6
        spi = C.c_void_p()
        if setupapi.SetupDiGetDeviceInterfaceDetailW(h, C.byref(did), buf, req.value,
                                                     C.byref(req), C.byref(spi)):
            path = C.wstring_at(C.addressof(buf) + (8 if C.sizeof(C.c_void_p) == 8 else 6))
            res.append((du(did.InterfaceClassGuid), path, did.Flags, spi.value))
        i += 1
    setupapi.SetupDiDestroyDeviceInfoList(h)
    return res

G = "{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}"
print("GUID:", G, "->", du(make_guid(G)))
for cls, path, flags, devinst in enum(make_guid(G)):
    print("IF class=%s flags=%d devinst=0x%X" % (cls, flags, devinst or 0))
    print("   path:", path)
