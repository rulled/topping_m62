"""Полный дизассемблер указанного диапазона VA в MCC (с метками тегов)."""
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
    magic = int.from_bytes(d[opt:opt + 2], "little")
    base = int.from_bytes(d[opt + 24:opt + 32], "little") if magic == 0x20B \
        else int.from_bytes(d[opt + 28:opt + 32], "little")
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
    return d, base, secs


def foff(secs, va):
    for s in secs:
        if s["va"] <= va < s["va"] + max(s["vsize"], s["rawsz"]):
            return s["raw"] + (va - s["va"])
    return None


def dump(lo_va, hi_va):
    data, base, secs = parse_pe(PATH)
    lo = foff(secs, lo_va)
    hi = foff(secs, hi_va)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True
    print("== 0x%08x..0x%08x ==" % (lo_va, hi_va))
    for ins in md.disasm(data[lo:hi], lo_va):
        note = ""
        if ins.mnemonic == "mov" and len(ins.operands) == 2:
            dst, src = ins.operands
            if src.type == capstone.x86.X86_OP_IMM and dst.type == capstone.x86.X86_OP_MEM:
                v = src.imm
                if 0 < v <= 0xFFFF:
                    note = "   ; TAG %04x" % v
        print("  0x%08x  %-8s %-44s%s" % (ins.address, ins.mnemonic, ins.op_str, note))


if __name__ == "__main__":
    lo = int(sys.argv[1], 16)
    hi = int(sys.argv[2], 16)
    dump(lo, hi)
