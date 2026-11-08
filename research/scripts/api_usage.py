"""
Проверка: использует ли MCC функции DspProperty.

Имена TUSBAUDIO_* лежат в .rdata плотным блоком (0x29d888..0x29e0xx).
MCC резолвит их через GetProcAddress и складывает указатели в массив.
Значит: если рядом с блоком имён есть массив указателей, и в него
пишется результат GetProcAddress, то функции ИСПОЛЬЗУЮТСЯ.

Считаем: для каждой строки TUSBAUDIO_* — есть ли ссылка на неё из .text
(lea rip-relative). Если ссылка есть, имя передаётся в GetProcAddress.
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


def main():
    d, secs = parse_pe(PATH)
    text = next(s for s in secs if s["name"] == ".text")

    # все адреса строк TUSBAUDIO_*
    names = {}
    seen = set()
    i = 0
    while True:
        i = d.find(b"TUSBAUDIO_", i)
        if i < 0:
            break
        z = d.find(b"\0", i, i + 80)
        if z < 0:
            break
        s = d[i:z].decode("latin1")
        for sec in secs:
            if sec["raw"] <= i < sec["raw"] + sec["rawsz"]:
                va = sec["va"] + (i - sec["raw"])
                names[va] = s
                break
        i = z

    print("строк TUSBAUDIO_*: %d" % len(names))

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True
    refs = {va: [] for va in names}

    lo, hi = text["raw"], text["raw"] + text["rawsz"]
    for ins in md.disasm(d[lo:hi], text["va"]):
        if ins.mnemonic != "lea" or len(ins.operands) != 2:
            continue
        m = ins.operands[1]
        if m.type != capstone.x86.X86_OP_MEM or m.mem.base != capstone.x86.X86_REG_RIP:
            continue
        t = ins.address + ins.size + m.mem.disp
        if t in refs:
            refs[t].append(ins.address)

    used, unused = [], []
    for va, s in sorted(names.items()):
        (used if refs[va] else unused).append((s, refs[va]))

    print("\n=== ИСПОЛЬЗУЮТСЯ (есть lea на строку) : %d ===" % len(used))
    for s, r in used:
        print("  %-44s <- %s" % (s, ", ".join("0x%x" % x for x in r[:3])))

    print("\n=== НЕ ИСПОЛЬЗУЮТСЯ : %d ===" % len(unused))
    for s, _ in unused:
        print("  %s" % s)

    print("\n=== ВЕРДИКТ ===")
    for target in ("TUSBAUDIO_SetDspProperty", "TUSBAUDIO_GetDspProperty",
                   "TUSBAUDIO_AudioControlRequestSet", "TUSBAUDIO_ClassVendorRequestOut"):
        st = "ИСПОЛЬЗУЕТСЯ" if any(s == target for s, _ in used) else "не используется"
        print("  %-44s %s" % (target, st))


if __name__ == "__main__":
    main()
