import ctypes
from ctypes import wintypes

hid = ctypes.WinDLL("hid.dll")

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
FILE_SHARE_READ = 0x1
FILE_SHARE_WRITE = 0x2
OPEN_EXISTING = 3

class HIDD_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("Size", wintypes.DWORD),
                ("VendorID", wintypes.WORD),
                ("ProductID", wintypes.WORD),
                ("VersionNumber", wintypes.WORD)]

class HIDP_CAPS(ctypes.Structure):
    _fields_ = [("Usage", wintypes.USHORT),
                ("UsagePage", wintypes.USHORT),
                ("InputReportByteLength", wintypes.USHORT),
                ("OutputReportByteLength", wintypes.USHORT),
                ("FeatureReportByteLength", wintypes.USHORT),
                ("Reserved", wintypes.USHORT * 17),
                ("NumberLinkCollectionNodes", wintypes.USHORT),
                ("NumberInputButtonCaps", wintypes.USHORT),
                ("NumberInputValueCaps", wintypes.USHORT),
                ("NumberInputDataIndices", wintypes.USHORT),
                ("NumberOutputButtonCaps", wintypes.USHORT),
                ("NumberOutputValueCaps", wintypes.USHORT),
                ("NumberOutputDataIndices", wintypes.USHORT),
                ("NumberFeatureButtonCaps", wintypes.USHORT),
                ("NumberFeatureValueCaps", wintypes.USHORT),
                ("NumberFeatureDataIndices", wintypes.USHORT)]

path = "\\\\?\\hid#vid_152a&pid_875c&rev_0248&mi_04#8&1443a3e4&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}"

k32 = ctypes.WinDLL("kernel32.dll")
k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                            ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                            ctypes.c_void_p]
k32.CreateFileW.restype = ctypes.c_void_p

h = k32.CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE,
                    None, OPEN_EXISTING, 0, None)
INVALID = ctypes.c_void_p(-1).value
print("CreateFileW (access=0) handle:", h if h != INVALID else "FAILED")

if h != INVALID:
    # атрибуты
    attr = HIDD_ATTRIBUTES()
    attr.Size = ctypes.sizeof(attr)
    hid.HidD_GetAttributes.argtypes = [ctypes.c_void_p, ctypes.POINTER(HIDD_ATTRIBUTES)]
    if hid.HidD_GetAttributes(ctypes.c_void_p(h), ctypes.byref(attr)):
        print("  VID=0x%04X PID=0x%04X Version=0x%04X" % (
            attr.VendorID, attr.ProductID, attr.VersionNumber))

    # preparsed data -> caps
    pp = ctypes.c_void_p()
    hid.HidD_GetPreparsedData.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    if hid.HidD_GetPreparsedData(ctypes.c_void_p(h), ctypes.byref(pp)):
        caps = HIDP_CAPS()
        hid.HidP_GetCaps.argtypes = [ctypes.c_void_p, ctypes.POINTER(HIDP_CAPS)]
        if hid.HidP_GetCaps(pp, ctypes.byref(caps)) == 0x110000:  # HIDP_STATUS_SUCCESS
            print("  UsagePage=0x%04X Usage=0x%04X" % (caps.UsagePage, caps.Usage))
            print("  InputReportByteLength : %d" % caps.InputReportByteLength)
            print("  OutputReportByteLength: %d" % caps.OutputReportByteLength)
            print("  FeatureReportByteLength: %d" % caps.FeatureReportByteLength)
            print("  NumberLinkCollectionNodes: %d" % caps.NumberLinkCollectionNodes)
            print("  InputValueCaps=%d InputDataIndices=%d" % (
                caps.NumberInputValueCaps, caps.NumberInputDataIndices))
            print("  OutputValueCaps=%d OutputDataIndices=%d" % (
                caps.NumberOutputValueCaps, caps.NumberOutputDataIndices))
        else:
            print("  HidP_GetCaps FAILED")
        hid.HidD_FreePreparsedData.argtypes = [ctypes.c_void_p]
        hid.HidD_FreePreparsedData(pp)

    # строки
    buf = ctypes.create_unicode_buffer(256)
    for fn, name in [("HidD_GetProductString", "Product"),
                     ("HidD_GetManufacturerString", "Manufacturer"),
                     ("HidD_GetSerialNumberString", "Serial")]:
        f = getattr(hid, fn)
        f.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.ULONG]
        try:
            if f(ctypes.c_void_p(h), buf, ctypes.sizeof(buf)):
                print("  %-13s: %r" % (name, buf.value))
        except Exception as e:
            print("  %-13s: error %s" % (name, e))

    k32.CloseHandle.argtypes = [ctypes.c_void_p]
    k32.CloseHandle(ctypes.c_void_p(h))

print("\n=== проверяю, открывается ли для записи (НЕ пишу!) ===")
h2 = k32.CreateFileW(path, GENERIC_READ | GENERIC_WRITE,
                     FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, 0, None)
if h2 != INVALID:
    print("  открыт с READ|WRITE — путь к устройству рабочий")
    k32.CloseHandle(ctypes.c_void_p(h2))
else:
    import ctypes as C
    print("  не открылся с READ|WRITE, GetLastError =", C.get_last_error())
    h3 = k32.CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                         None, OPEN_EXISTING, 0, None)
    if h3 != INVALID:
        print("  открыт только на READ")
        k32.CloseHandle(ctypes.c_void_p(h3))
    else:
        print("  даже READ не открылся")