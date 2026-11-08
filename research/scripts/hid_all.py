import ctypes
from ctypes import wintypes
import sys

# Перечисление ВСЕХ HID-устройств в системе с полным путём и VID/PID.
# Схема повторяет то, что делает mainline-драйвер и M Control Center:
#   HidD_GetHidGuid -> SetupDiGetClassDevs -> SetupDiEnumDeviceInterfaces
#   -> SetupDiGetDeviceInterfaceDetail -> путь
# Плюс CM_Get_Device_Interface_List для сравнения.

hid = ctypes.WinDLL("hid.dll")
setupapi = ctypes.WinDLL("setupapi.dll")

GUID = ctypes.c_ubyte * 16

class GUIDSTRUCT(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD),
                ("Data2", wintypes.WORD),
                ("Data3", wintypes.WORD),
                ("Data4", ctypes.c_ubyte * 8)]

class SP_DEVICE_INTERFACE_DATA(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD),
                ("InterfaceClassGuid", GUIDSTRUCT),
                ("Flags", wintypes.DWORD),
                ("Reserved", ctypes.POINTER(ctypes.c_ulong))]

class SP_DEVICE_INTERFACE_DETAIL_DATA_W(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD),
                ("DevicePath", ctypes.c_wchar * 512)]

DIGCF_PRESENT = 0x02
DIGCF_DEVICEINTERFACE = 0x10

hid.HidD_GetHidGuid.argtypes = [ctypes.POINTER(GUIDSTRUCT)]
setupapi.SetupDiGetClassDevsW.argtypes = [ctypes.POINTER(GUIDSTRUCT), wintypes.LPCWSTR,
                                          wintypes.HWND, wintypes.DWORD]
setupapi.SetupDiGetClassDevsW.restype = ctypes.c_void_p
setupapi.SetupDiEnumDeviceInterfaces.argtypes = [ctypes.c_void_p, ctypes.c_void_p,
                                                 ctypes.POINTER(GUIDSTRUCT),
                                                 wintypes.DWORD,
                                                 ctypes.POINTER(SP_DEVICE_INTERFACE_DATA)]
setupapi.SetupDiGetDeviceInterfaceDetailW.argtypes = [
    ctypes.c_void_p, ctypes.POINTER(SP_DEVICE_INTERFACE_DATA),
    ctypes.POINTER(SP_DEVICE_INTERFACE_DETAIL_DATA_W),
    wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
setupapi.SetupDiDestroyDeviceInfoList.argtypes = [ctypes.c_void_p]

guid = GUIDSTRUCT()
hid.HidD_GetHidGuid(ctypes.byref(guid))
print("HID class GUID: {%08X-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X}" % (
    guid.Data1, guid.Data2, guid.Data3,
    guid.Data4[0], guid.Data4[1], guid.Data4[2], guid.Data4[3],
    guid.Data4[4], guid.Data4[5], guid.Data4[6], guid.Data4[7]))

hdev = setupapi.SetupDiGetClassDevsW(ctypes.byref(guid), None, None,
                                     DIGCF_PRESENT | DIGCF_DEVICEINTERFACE)
if hdev == ctypes.c_void_p(-1).value or not hdev:
    print("SetupDiGetClassDevs FAILED")
    sys.exit(1)

print("\n=== ВСЕ HID-устройства в системе ===")
found_topping = []
idx = 0
total = 0
while True:
    did = SP_DEVICE_INTERFACE_DATA()
    did.cbSize = ctypes.sizeof(did)
    ok = setupapi.SetupDiEnumDeviceInterfaces(hdev, None, ctypes.byref(guid),
                                              idx, ctypes.byref(did))
    if not ok:
        break
    idx += 1
    total += 1
    detail = SP_DEVICE_INTERFACE_DETAIL_DATA_W()
    detail.cbSize = 8 if ctypes.sizeof(ctypes.c_void_p) == 8 else 6
    need = wintypes.DWORD()
    ok2 = setupapi.SetupDiGetDeviceInterfaceDetailW(hdev, ctypes.byref(did),
                                                    ctypes.byref(detail),
                                                    ctypes.sizeof(detail),
                                                    ctypes.byref(need), None)
    path = detail.DevicePath if ok2 else "<no detail>"
    low = path.lower()
    mark = ""
    if "vid_152a" in low or "875c" in low or "875e" in low:
        mark = "   <<<<< TOPPING"
        found_topping.append(path)
    if mark or "topping" in low:
        print("  %s%s" % (path, mark))

setupapi.SetupDiDestroyDeviceInfoList(hdev)

print("\nвсего HID-интерфейсов: %d" % total)
print("найдено TOPPING-подобных: %d" % len(found_topping))
for p in found_topping:
    print("   ", p)

if not found_topping:
    print("\n=> у M62 НЕТ HID-интерфейса в данный момент")
    print("   (проверить: устройство подключено? в каком режиме?)")
