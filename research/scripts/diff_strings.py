import re, os, collections

def load(path):
    s = set()
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3:
                s.add(parts[2])
    return s

base = r"E:\Programming shit\Topping\research\static"
m = load(os.path.join(base, "mcc_strings.txt"))
k = load(os.path.join(base, "kbcc_strings.txt"))
print("MCC unique strings:", len(m), " KBCC:", len(k))
print("common:", len(m & k))

def interesting(s):
    if len(s) < 4 or len(s) > 60:
        return False
    if re.fullmatch(r"[0-9a-fA-FxX]+", s):
        return False
    return bool(re.search(r"[A-Za-z]{3}", s))

only_k = sorted(x for x in (k - m) if interesting(x))
only_m = sorted(x for x in (m - k) if interesting(x))

with open(os.path.join(base, "diff_only_kbcc.txt"), "w", encoding="utf-8") as f:
    for x in only_k:
        f.write(x + "\n")
with open(os.path.join(base, "diff_only_mcc.txt"), "w", encoding="utf-8") as f:
    for x in only_m:
        f.write(x + "\n")
print("only KBCC:", len(only_k), " only MCC:", len(only_m))

KEY = re.compile(r"(?i)(effect|dsp|reverb|delay|echo|expand|compress|duck|noise|vocal|enhanc|crossfeed|spatial|eq|peq|filter|ducker|gate|mix|route|routing|loopback|sample|asio|buffer|firmware|update|version|device|chip|model|kb22|m62|hifi|game|pro|vendor|cmd)")
for name, lst in (("KBCC-only", only_k), ("MCC-only", only_m)):
    hits = [x for x in lst if KEY.search(x)]
    print("\n===== %s interesting (%d of %d) =====" % (name, len(hits), len(lst)))
    for x in hits[:200]:
        print("  ", x)
