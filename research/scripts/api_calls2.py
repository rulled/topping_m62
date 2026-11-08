"""
Третий шаг: указатели TUSBAUDIO_* складываются в объект по смещениям
(таблица резолва @0x239xxx, `mov qword ptr [rbx+OFFSET], rax`).

Известно:
  GetDspProperty -> +0x240
  SetDspProperty -> +0x248

Ищем `call qword ptr [reg + OFFSET]` с этими смещениями по всему .text.
Это и есть реальные вызовы.
"""
import re
import capstone

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"

# смещения, вытащенные из таблицы резолва
OFFSETS = {
    0x230: "GetVolume?",
    0x238: "SetVolume?",
    0x240: "GetDspProperty",
    0x248: "SetDspProperty",
    0x250: "QueryDriverStatistics?",
    0x258: "ResetDriverStatistics?",
    0x268: "QueryDriverStatistics",
    0x270: "GetControlPanelOptions?",
    0x278: "GetExtendedInfo?",
}


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


def main():
    d, secs = parse_pe(PATH)
    text = next(s for s in secs if s["name"] == ".text")
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    lo, hi = text["raw"], text["raw"] + text["rawsz"]
    insns = list(md.disasm(d[lo:hi], text["va"]))

    # call qword ptr [reg + disp]
    hits = {}
    pat = re.compile(r"\[(r[a-z0-9]+) \+ (0x[0-9a-f]+)\]")
    for ins in insns:
        if ins.mnemonic != "call":
            continue
        m = pat.search(ins.op_str)
        if not m:
            continue
        off = int(m.group(2), 16)
        if off in OFFSETS:
            hits.setdefault(off, []).append(ins.address)

    print("=== вызовы через object+offset ===")
    for off in sorted(OFFSETS):
        c = hits.get(off, [])
        print("  +0x%-4x %-26s вызовов: %d %s"
              % (off, OFFSETS[off], len(c),
                 " ".join("0x%x" % x for x in c[:6])))

    print("\n=== ВЕРДИКТ ===")
    for off in (0x240, 0x248):
        n = len(hits.get(off, []))
        nm = OFFSETS[off]
        if n:
            print("  %-18s ВЫЗЫВАЕТСЯ (%d мест)" % (nm, n))
        else:
            print("  %-18s резолвится, но НЕ ВЫЗЫВАЕТСЯ" % nm)


if __name__ == "__main__":
    main()
