"""Разрешение rip-relative строк внутри диапазона — чтобы прочитать имена."""
import sys
import capstone

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
        secs.append(dict(
            name=d[s:s + 8].rstrip(b"\0").decode("latin1"),
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


def cstr(data, secs, va, limit=120):
    o = foff(secs, va)
    if o is None:
        return None
    e = data.find(b"\x00", o, o + limit)
    if e < 0:
        return None
    raw = data[o:e]
    if not raw:
        return None
    s = "".join(chr(c) if 32 <= c < 127 else "." for c in raw)
    return s if s.strip(".") else None


def main():
    lo_va = int(sys.argv[1], 16)
    hi_va = int(sys.argv[2], 16)
    data, secs = parse_pe(PATH)
    lo = foff(secs, lo_va)
    hi = foff(secs, hi_va)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True
    pend = None      # (адрес инструкции, строка)
    for ins in md.disasm(data[lo:hi], lo_va):
        desc = "%s %s" % (ins.mnemonic, ins.op_str)
        extra = ""
        if ins.mnemonic == "lea" and len(ins.operands) == 2:
            m = ins.operands[1]
            if m.type == capstone.x86.X86_OP_MEM and m.mem.base == capstone.x86.X86_REG_RIP:
                tgt = ins.address + ins.size + m.mem.disp
                s = cstr(data, secs, tgt)
                if s:
                    extra = '   ; "%s" @0x%08x' % (s, tgt)
                    pend = s
        if ins.mnemonic in ("cmovne", "mov") and pend is not None:
            if "ecx" in ins.op_str or ", " in ins.op_str:
                extra += "   <= после \"%s\"" % pend
                pend = None
        print("  0x%08x  %-34s%s" % (ins.address, desc, extra))


if __name__ == "__main__":
    main()
