import os, re

roots = [
    r"C:\Program Files\TOPPING Pro\M Control Center",
    r"C:\Program Files\TOPPING Pro\KB Control Center",
]

clsids = {
    "{e97e1508-2a66-4df8-b7a7-32d6e5fcba46}": "InterfaceGUID (from INF)",
    "{6a942ad1-d658-43dd-9d73-9b0f2ea89708}": "Device transport",
}

# find keys named exactly like a GUID, or subkeys
for r in roots:
    print("=== " + r)
    for sub in ("", ):
        pass
    import winreg
    for hive, path in [(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\CLSID")]:
        pass
