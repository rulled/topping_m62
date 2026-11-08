"""
Точный порядок: какая строка "MixX" открывает блок и какие `or eax, 0xNN00`
идут ПОСЛЕ неё. Это решает вопрос смещения: база относится к предыдущей
или к следующей шине.
"""
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


def cstr(d, secs, va, lim=80):
    o = foff(secs, va)
    if o is None:
        return None
    e = d.find(b"\0", o, o + lim)
    if e < 0:
        return None
    try:
        s = d[o:e].decode("ascii")
    except UnicodeDecodeError:
        return None
    return s if s and all(32 <= ord(c) < 127 for c in s) else None


def main():
    lo, hi = 0x22e400, 0x22ec00
    d, secs = parse_pe(PATH)
    off = foff(secs, lo)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    cur_mix = None
    events = []
    for ins in md.disasm(d[off:off + (hi - lo)], lo):
        if ins.mnemonic == "lea" and len(ins.operands) == 2:
            m = ins.operands[1]
            if m.type == capstone.x86.X86_OP_MEM and m.mem.base == capstone.x86.X86_REG_RIP:
                s = cstr(d, secs, ins.address + ins.size + m.mem.disp)
                if s and (s.startswith("Mix") or s.startswith("Gain")):
                    if s.startswith("Mix"):
                        cur_mix = s
                        events.append((ins.address, "MIX", s))
                    else:
                        events.append((ins.address, "ATTR", s))
        if ins.mnemonic == "or" and ins.op_str.startswith("eax, 0x"):
            try:
                v = int(ins.op_str.split("0x")[1], 16)
            except ValueError:
                continue
            if 0x4000 <= v <= 0x5000:
                events.append((ins.address, "OR", "0x%04x" % v))

    print("порядок в коде (адрес, тип, значение):")
    for a, t, v in events:
        print("  0x%08x  %-4s %s" % (a, t, v))

    print("\n--- привязка: какие OR идут ПОСЛЕ какой шины ---")
    cur = None
    bucket = {}
    for a, t, v in events:
        if t == "MIX":
            cur = v
            bucket.setdefault(cur, [])
        elif t == "OR" and cur:
            bucket[cur].append(v)
    for k, v in bucket.items():
        print("  %-6s -> %s" % (k, ", ".join(v)))


if __name__ == "__main__":
    main()
