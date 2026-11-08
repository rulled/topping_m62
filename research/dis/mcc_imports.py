"""
Полная таблица импорта M Control Center.

ЦЕЛЬ: понять, каким API MCC доставляет в устройство микшер/EQ/эффекты,
раз HID для них не принимает запись.

Особый интерес: SetupAPI (SetupDi*), kernel32 (CreateFile/DeviceIoControl/
WriteFile), а также любые экспорты Thesycon.

Только чтение файла.
"""

import sys

import pefile

EXE = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"

KEYS = (
    "setupdi", "createfile", "deviceio", "writefile", "readfile", "hid",
    "tusb", "thesycon", "ks", "wave", "dshow", "avrt", "winmm",
)


def main():
    pe = pefile.PE(EXE, fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]]
    )

    total = 0
    for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []):
        dll = entry.dll.decode("ascii", "replace")
        names = []
        for imp in entry.imports:
            if imp.name:
                names.append(imp.name.decode("ascii", "replace"))
            else:
                names.append(f"ord{imp.ordinal}")
        total += len(names)
        print(f"\n=== {dll} ({len(names)}) ===")
        # печатаем всё для «интересных» DLL, иначе только счётчик
        low = dll.lower()
        interesting = any(k in low for k in KEYS)
        if interesting or len(names) <= 40:
            for n in names:
                print(f"    {n}")
        else:
            print(f"    (первые 20) {', '.join(names[:20])}")

    print(f"\nвсего импортов: {total}")

    # отдельно — задержанная загрузка
    try:
        pe.parse_data_directories(
            directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT"]]
        )
        for entry in getattr(pe, "DIRECTORY_ENTRY_DELAY_IMPORT", []):
            dll = entry.dll.decode("ascii", "replace")
            names = [imp.name.decode("ascii", "replace") for imp in entry.imports if imp.name]
            print(f"\n=== [delay] {dll} ({len(names)}) ===")
            for n in names[:60]:
                print(f"    {n}")
    except Exception as exc:  # noqa: BLE001
        print(f"delay-import: {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
