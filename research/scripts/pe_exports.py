import re, os, struct

def pe_exports(path):
    data = open(path, "rb").read()
    e = struct.unpack_from("<I", data, 0x3C)[0]
    coff = e + 4
    nsecs = struct.unpack_from("<H", data, coff + 2)[0]
    opt_size = struct.unpack_from("<H", data, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from("<H", data, opt)[0]
    is64 = magic == 0x20B
    nrva_off = opt + (108 if is64 else 92)
    nrva = struct.unpack_from("<I", data, nrva_off)[0]
    dirs = [struct.unpack_from("<II", data, nrva_off + 4 + 8*i) for i in range(nrva)]
    sec_off = opt + opt_size
    secs = []
    for i in range(nsecs):
        s = sec_off + 40*i
        vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", data, s+8)
        secs.append((vaddr, vsize, raddr, rsize))
    def r2o(rva):
        for vaddr, vsize, raddr, rsize in secs:
            if vaddr <= rva < vaddr + max(vsize, rsize):
                d = rva - vaddr
                if d < rsize:
                    return raddr + d
        return None
    erva, esz = dirs[0]
    if not erva:
        return []
    off = r2o(erva)
    nfun, nname = struct.unpack_from("<II", data, off + 20)
    names_rva = struct.unpack_from("<I", data, off + 32)[0]
    noff = r2o(names_rva)
    out = []
    for i in range(nname):
        nr = struct.unpack_from("<I", data, noff + 4*i)[0]
        o = r2o(nr)
        out.append(data[o:data.index(b"\0", o)].decode("latin-1"))
    return sorted(out)

for p in (r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll",
          r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioasio_x64.dll"):
    print("===", os.path.basename(p))
    ex = pe_exports(p)
    print("exports:", len(ex))
    for n in ex:
        print("   ", n)
