import re, sys, os

paths = [
    r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe",
    r"C:\Program Files\TOPPING Pro\KB Control Center\KB Control Center.exe",
]

pat = re.compile(rb"\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}")

for p in paths:
    data = open(p, "rb").read()
    print("=== " + os.path.basename(p))
    seen = {}
    for m in pat.finditer(data):
        s = m.group().decode("ascii").lower()
        seen.setdefault(s, []).append(m.start())
    # utf-16
    wide = pat.pattern.decode("ascii").encode("utf-16-le")
    wpat = re.compile(re.escape(wide[:1]) + b"[\x00-\xff]{0,200}")
    # simpler: decode whole file as utf-16le in chunks is heavy; do targeted scan
    for m in re.finditer(rb"(?:\{[0-9A-Fa-f]\x00){1}", data):
        pass
    # find utf-16le {} guid by scanning for '{' 0x7b 0x00
    i = 0
    while True:
        i = data.find(b"{\x00", i)
        if i < 0:
            break
        chunk = data[i:i + 80]
        try:
            s = chunk.decode("utf-16-le", errors="ignore")
        except Exception:
            i += 2
            continue
        mm = re.match(r"\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}", s)
        if mm:
            seen.setdefault(mm.group().lower(), []).append(i)
        i += 2
    for k in sorted(seen):
        print("  %s count=%d" % (k, len(seen[k])))
