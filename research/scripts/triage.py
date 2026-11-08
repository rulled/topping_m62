import re, os, struct, sys, json

OUT = r"E:\Programming shit\Topping\research\static"
os.makedirs(OUT, exist_ok=True)

TARGETS = {
    "mcc": r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe",
    "kbcc": r"C:\Program Files\TOPPING Pro\KB Control Center\KB Control Center.exe",
}

def strings_from(data, minlen=5):
    # ASCII
    for m in re.finditer(rb"[\x20-\x7e]{%d,}" % minlen, data):
        yield ("ascii", m.start(), m.group().decode("latin-1"))
    # UTF-16LE
    for m in re.finditer(rb"(?:[\x20-\x7e]\x00){%d,}" % minlen, data):
        yield ("utf16", m.start(), m.group().decode("utf-16-le", "replace"))

def pe_imports(data):
    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    assert data[e_lfanew:e_lfanew+4] == b"PE\0\0"
    coff = e_lfanew + 4
    machine, nsecs = struct.unpack_from("<HH", data, coff)
    opt_size = struct.unpack_from("<H", data, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from("<H", data, opt)[0]
    is64 = magic == 0x20b
    nrva_off = opt + (108 if is64 else 92)
    nrva = struct.unpack_from("<I", data, nrva_off)[0]
    dirs = [struct.unpack_from("<II", data, nrva_off + 4 + 8*i) for i in range(nrva)]
    sec_off = opt + opt_size
    secs = []
    for i in range(nsecs):
        s = sec_off + 40*i
        name = data[s:s+8].rstrip(b"\0").decode("latin-1")
        vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", data, s+8)
        secs.append((name, vaddr, vsize, raddr, rsize))
    def rva2off(rva):
        for name, vaddr, vsize, raddr, rsize in secs:
            if vaddr <= rva < vaddr + max(vsize, rsize):
                d = rva - vaddr
                if d < rsize:
                    return raddr + d
        return None
    res = {}
    imp_rva, imp_sz = dirs[1]
    if imp_rva:
        off = rva2off(imp_rva)
        while off and off + 20 <= len(data):
            oft, ts, fwd, name_rva, ft = struct.unpack_from("<IIIII", data, off)
            if name_rva == 0:
                break
            noff = rva2off(name_rva)
            dll = data[noff:data.index(b"\0", noff)].decode("latin-1")
            funcs = []
            thunk_rva = oft or ft
            toff = rva2off(thunk_rva)
            step = 8 if is64 else 4
            fmt = "<Q" if is64 else "<I"
            while toff:
                v = struct.unpack_from(fmt, data, toff)[0]
                if v == 0:
                    break
                if v & (1 << (63 if is64 else 31)):
                    funcs.append("ord#%d" % (v & 0xffff))
                else:
                    fo = rva2off(v & 0x7fffffff)
                    if fo:
                        funcs.append(data[fo+2:data.index(b"\0", fo+2)].decode("latin-1"))
                toff += step
            res[dll] = funcs
            off += 20
    return res

for key, path in TARGETS.items():
    data = open(path, "rb").read()
    print("=== %s  size=%d" % (path, len(data)))
    imps = pe_imports(data)
    with open(os.path.join(OUT, key + "_imports.txt"), "w", encoding="utf-8") as f:
        for dll, funcs in sorted(imps.items()):
            f.write("[%s] (%d)\n" % (dll, len(funcs)))
            for fn in funcs:
                f.write("    %s\n" % fn)
    print("  DLLs:", len(imps), "funcs:", sum(len(v) for v in imps.values()))
    with open(os.path.join(OUT, key + "_strings.txt"), "w", encoding="utf-8") as f:
        n = 0
        for kind, off, s in strings_from(data, 4):
            f.write("%s\t0x%08x\t%s\n" % (kind, off, s))
            n += 1
    print("  strings:", n)
