r"""Probe for USBPcap control devices on Windows.

USBPcap creates \Device\USBPcap<N> for every root hub it attaches to, and a
\DosDevices\USBPcap<N> symlink so user mode can open \\.\USBPcap<N>.

If the driver is RUNNING but no device exists, the filter never bound to a hub.
That is not a permission problem: ERROR_PATH_NOT_FOUND (161) from CreateFileW
means the device object does not exist at all, while ERROR_ACCESS_DENIED (5)
would mean it exists but we lack rights.
"""
import ctypes
import ctypes.wintypes as w

ERROR_ACCESS_DENIED = 5
ERROR_PATH_NOT_FOUND = 3
ERROR_BAD_PATHNAME = 161

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.CreateFileW.restype = w.HANDLE
k32.CreateFileW.argtypes = [
    w.LPCWSTR, w.DWORD, w.DWORD, ctypes.c_void_p, w.DWORD, w.DWORD, w.HANDLE,
]


def probe(index: int) -> str:
    path = "\\\\.\\USBPcap%d" % index
    handle = k32.CreateFileW(
        path, GENERIC_READ | GENERIC_WRITE, 3, None, 3, 0, None
    )
    err = ctypes.get_last_error()
    if handle not in (None, -1, w.HANDLE(-1).value):
        k32.CloseHandle(handle)
        return "OPENED"
    if err in (ERROR_PATH_NOT_FOUND, ERROR_BAD_PATHNAME):
        return "absent (%d)" % err
    return "error %d: %s" % (err, ctypes.FormatError(err).strip())


def main() -> None:
    opened = []
    denied = []
    for index in range(1, 17):
        result = probe(index)
        if result == "OPENED":
            opened.append(index)
        elif result.startswith("error 5"):
            denied.append(index)
        print("USBPcap%-2d  %s" % (index, result))
    print()
    if opened:
        print("Openable: %s" % opened)
    if denied:
        # ERROR_ACCESS_DENIED means the device object EXISTS; only admin can
        # open it. This is the normal state when not running elevated.
        print("Present but need admin: %s" % denied)
    if not opened and not denied:
        print("No USBPcap device exists -> the filter is not bound to any hub.")


if __name__ == "__main__":
    main()
