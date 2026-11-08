"""
Дизассемблирование «региона тегов» MCC и группировка констант по функциям.

Регион 0x22b000..0x232000 содержит все известные теги M62 (0x11xx device,
0x21xx in1, 0x44xx эффекты, 0x51..0x5c loopback, 0x61..0x64 выхода).
Задача: восстановить, какая функция какой тег шлёт, и увидеть теги, которых
мы ещё не знаем (EQ, микшер).
"""
import sys
from collections import defaultdict, Counter
import capstone

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"

FILE_ALIGN = 0x200
SECTIONS = []


def parse_pe_sections(path):
    d = open(path, "rb").read()
    e_lfanew = int.from_bytes(d[0x3C:0x40], "little")
    assert d[e_lfanew:e_lfanew + 4] == b"PE\0\0", "не PE"
    coff = e_lfanew + 4
    nsec = int.from_bytes(d[coff + 2:coff + 4], "little")
    optsz = int.from_bytes(d[coff + 16:coff + 18], "little")
    opt = coff + 20
    magic = int.from_bytes(d[opt:opt + 2], "little")
    if magic == 0x20B:      # PE32+
        image_base = int.from_bytes(d[opt + 24:opt + 32], "little")
        dd = opt + 112
    else:
        image_base = int.from_bytes(d[opt + 28:opt + 32], "little")
        dd = opt + 96
    sec0 = opt + optsz
    secs = []
    for k in range(nsec):
        s = sec0 + 40 * k
        name = d[s:s + 8].rstrip(b"\0").decode("latin1")
        vsize = int.from_bytes(d[s + 8:s + 12], "little")
        vaddr = int.from_bytes(d[s + 12:s + 16], "little")
        rawsz = int.from_bytes(d[s + 16:s + 20], "little")
        rawpt = int.from_bytes(d[s + 20:s + 24], "little")
        secs.append(dict(name=name, va=vaddr, vsize=vsize, raw=rawpt, rawsz=rawsz))
    return d, image_base, secs, dd


def foff(secs, va):
    for s in secs:
        if s["va"] <= va < s["va"] + max(s["vsize"], s["rawsz"]):
            return s["raw"] + (va - s["va"])
    return None


def fva(secs, off):
    for s in secs:
        if s["raw"] <= off < s["raw"] + s["rawsz"]:
            return s["va"] + (off - s["raw"])
    return None


KNOWN = {
    0x1101: "Sel?", 0x1102: "Dev?", 0x1124: "SUBSCRIBE", 0x1126: "ANNOUNCE",
    0x2101: "IN1.METER", 0x2102: "IN1.gain?", 0x2104: "IN1.x4",
    0x2105: "IN1.x5", 0x2109: "IN1.x9", 0x210a: "IN1.xa",
    0x4401: "Input1Level", 0x4402: "Input2Level", 0x4403: "x3",
    0x4406: "NoiseReduction", 0x4407: "NoiseReductionType", 0x4408: "DryWet",
    0x4409: "x9", 0x440a: "xa", 0x440b: "ReverbType", 0x440c: "xc",
    0x440f: "Width", 0x9b0f: "EQ_FX.Switch", 0xab0f: "EQ_HP.Switch",
    0x3103: "Output.L.gain", 0x5103: "Loopback12.L", 0x2501: "Input1.MIX",
}

FAMS = {
    0x11: "device", 0x21: "in1", 0x22: "in2", 0x23: "aux", 0x25: "bt", 0x27: "otgin",
    0x31: "out31", 0x32: "out32", 0x33: "out33", 0x34: "out34", 0x35: "out35", 0x36: "out36",
    0x43: "?43", 0x44: "EFFECT", 0x45: "?45", 0x46: "?46",
    0x51: "loop51", 0x52: "loop52", 0x53: "loop53", 0x54: "loop54", 0x55: "loop55",
    0x56: "loop56", 0x57: "loop57", 0x58: "loop58", 0x5b: "?5b",
    0x61: "out61", 0x62: "out62", 0x63: "out63", 0x64: "out64",
    0x71: "?71", 0x72: "?72", 0x73: "?73", 0x74: "?74", 0x75: "?75", 0x76: "?76",
    0x77: "?77", 0x78: "?78",
    0x81: "?81", 0x82: "?82", 0x83: "?83", 0x85: "?85", 0x86: "?86",
    0x91: "?91", 0x92: "?92", 0x93: "?93", 0x94: "?94", 0x95: "?95",
    0x96: "?96", 0x97: "?97", 0x98: "?98",
    0x9b: "EQFX", 0xab: "EQHP",
}


def main():
    data, base, secs, _ = parse_pe_sections(PATH)
    print("image base = 0x%x" % base)
    for s in secs:
        print("  %-10s va=0x%08x vsize=0x%06x raw=0x%08x rawsz=0x%06x"
              % (s["name"], s["va"], s["vsize"], s["raw"], s["rawsz"]))

    lo_va = 0x22b000
    hi_va = 0x232000
    lo = foff(secs, lo_va)
    hi = foff(secs, hi_va)
    print("\nрегион 0x%x..0x%x  ->  файл 0x%x..0x%x" % (lo_va, hi_va, lo, hi))

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True

    # прогоняем линейно, собираем mov imm32 в памяти/регистры
    per_func = defaultdict(list)
    events = []
    for ins in md.disasm(data[lo:hi], lo_va):
        if ins.mnemonic == "mov" and len(ins.operands) == 2:
            dst, src = ins.operands
            if src.type == capstone.x86.X86_OP_IMM and dst.type == capstone.x86.X86_OP_MEM:
                v = src.imm & 0xFFFFFFFF
                tag = v & 0xFFFF
                if 0x1000 <= tag < 0x10000 and v <= 0xFFFF:
                    events.append((ins.address, tag, ins.op_str))
        elif ins.mnemonic in ("ret", "int3"):
            events.append((ins.address, None, ins.mnemonic))

    # группируем по ближайшему «ret» после
    cur = []
    groups = []
    for addr, tag, txt in events:
        if tag is None:
            if cur:
                groups.append(cur)
                cur = []
        else:
            cur.append((addr, tag, txt))
    if cur:
        groups.append(cur)

    print("\nгрупп (фрагментов функций) с тегами: %d" % len(groups))
    for g in groups:
        if len(g) < 2:
            continue
        fams = Counter(FAMS.get(t >> 8, "?%02x" % (t >> 8)) for _, t, _ in g)
        print("\n--- 0x%08x..0x%08x  (%d тегов)  %s"
              % (g[0][0], g[-1][0], len(g), dict(fams)))
        for addr, tag, txt in g:
            print("     0x%08x  %04x  %-14s %s"
                  % (addr, tag, KNOWN.get(tag, FAMS.get(tag >> 8, "?")), txt))


if __name__ == "__main__":
    main()
