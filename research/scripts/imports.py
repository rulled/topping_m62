"""Разбор таблицы импорта MCC: какие функции какой DLL реально используются."""
import struct

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"


def main():
    d = open(PATH, "rb").read()
    e = int.from_bytes(d[0x3C:0x40], "little")
    coff = e + 4
    nsec = int.from_bytes(d[coff + 2:coff + 4], "little")
    optsz = int.from_bytes(d[coff + 16:coff + 18], "little")
    opt = coff + 20
    magic = int.from_bytes(d[opt:opt + 2], "little")
    if magic == 0x20B:
        base = int.from_bytes(d[opt + 24:opt + 32], "little")
        dd = opt + 112
    else:
        base = int.from_bytes(d[opt + 28:opt + 32], "little")
        dd = opt + 96
    sec0 = opt + optsz
    secs = []
    for k in range(nsec):
        s = sec0 + 40 * k
        secs.append(dict(name=d[s:s + 8].rstrip(b"\0").decode("latin1"),
                         vsize=int.from_bytes(d[s + 8:s + 12], "little"),
                         va=int.from_bytes(d[s + 12:s + 16], "little"),
                         rawsz=int.from_bytes(d[s + 16:s + 20], "little"),
                         raw=int.from_bytes(d[s + 20:s + 24], "little")))

    def foff(va):
        for s in secs:
            if s["va"] <= va < s["va"] + max(s["vsize"], s["rawsz"]):
                return s["raw"] + (va - s["va"])
        return None

    def rd(va, n):
        o = foff(va)
        return d[o:o + n] if o is not None else b""

    def cstr(va):
        o = foff(va)
        if o is None:
            return None
        z = d.find(b"\0", o, o + 200)
        return d[o:z].decode("latin1") if z > o else None

    imp_rva = int.from_bytes(d[dd + 8:dd + 12], "little")
    imp_va = imp_rva
    print("import directory RVA=0x%x VA=0x%x\n" % (imp_rva, imp_va))

    total = 0
    va = imp_va
    while True:
        desc = rd(va, 20)
        if len(desc) < 20 or desc == b"\0" * 20:
            break
        oft, ts, fc, name_rva, ft = struct.unpack("<IIIII", desc[:20])
        dll = cstr(name_rva)
        funcs = []
        thunk = (oft or ft)
        while True:
            t = struct.unpack("<Q", rd(thunk, 8))[0]
            if t == 0:
                break
            if t & (1 << 63):
                funcs.append("ord#%d" % (t & 0xFFFF))
            else:
                nm = cstr((t & 0x7FFFFFFF) + 2)
                funcs.append(nm or "?")
            thunk += 8
        total += len(funcs)
        interesting = [f for f in funcs if "Dsp" in f or "Vendor" in f or "AudioControl" in f or "Peak" in f]
        print("%-46s %3d функций" % (dll, len(funcs)))
        if interesting:
            for f in interesting:
                print("      * %s" % f)
        va += 20

    print("\nвсего импортов: %d" % total)
    print("\n=== ИТОГ ===")
    print("Если TUSBAUDIO_SetDspProperty НЕ появился выше — MCC его не импортирует,")
    print("то есть НЕ ВЫЗЫВАЕТ. Строка в бинарнике может быть просто из заголовка API.")


if __name__ == "__main__":
    main()

