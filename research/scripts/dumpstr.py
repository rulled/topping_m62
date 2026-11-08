"""Дамп строк в заданном диапазоне VA через корректный разбор PE."""
import sys

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"


def parse_pe(path):
    d = open(path, "rb").read()
    e = int.from_bytes(d[0x3C:0x40], "little")
    coff = e + 4
    nsec = int.from_bytes(d[coff + 2:coff + 4], "little")
    optsz = int.from_bytes(d[coff + 16:coff + 18], "little")
    opt = coff + 20
    sec0 = opt + optsz
    secs = []
    for k in range(nsec):
        s = sec0 + 40 * k
        secs.append(dict(name=d[s:s + 8].rstrip(b"\0").decode("latin1"),
                         vsize=int.from_bytes(d[s + 8:s + 12], "little"),
                         va=int.from_bytes(d[s + 12:s + 16], "little"),
                         rawsz=int.from_bytes(d[s + 16:s + 20], "little"),
                         raw=int.from_bytes(d[s + 20:s + 24], "little")))
    return d, secs


def foff(secs, va):
    for s in secs:
        if s["va"] <= va < s["va"] + max(s["vsize"], s["rawsz"]):
            return s["raw"] + (va - s["va"])
    return None


def main():
    lo = int(sys.argv[1], 16)
    hi = int(sys.argv[2], 16)
    minlen = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    d, secs = parse_pe(PATH)
    o = foff(secs, lo)
    if o is None:
        print("VA вне секций")
        return
    raw = d[o:o + (hi - lo)]
    va = lo
    cur = b""
    cur_va = lo
    out = []
    for ch in raw:
        if 32 <= ch < 127:
            if not cur:
                cur_va = va
            cur += bytes([ch])
        else:
            if len(cur) >= minlen:
                out.append((cur_va, cur.decode("latin1")))
            cur = b""
        va += 1
    if len(cur) >= minlen:
        out.append((cur_va, cur.decode("latin1")))
    for a, s in out:
        print("  0x%06x  %s" % (a, s))


if __name__ == "__main__":
    main()
