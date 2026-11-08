"""
Ищем МИКШЕР и EQ через ссылки на строки.

Идея: в Qt-приложении панель микшера инициализируется по именам объектов
("Mixer_IN12", "Mixer_AUX", "EQ_IN1"...). Код делает lea reg, [rip+disp] на
адрес строки, рядом кладёт тег и вызывает упаковщик кадра. Значит: находим
адрес строки в .rdata, находим lea, которая на неё указывает, и печатаем
функцию вокруг — вместе со всеми imm32-тегами в ней.
"""
import re
from collections import defaultdict
import capstone

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"

NAMES = [
    "Mixer_IN12", "Mixer_OTGIN", "Mixer_FX", "Mixer_PB12", "Mixer_PB34",
    "Mixer_PB56", "Mixer_PB78", "Mixer_PB910", "Mixer_AUX", "Mixer_BT",
    "Mixer_All", "Save_Mixer", "FieldMixer", "MixerBase", "MIXER",
    "EQ_IN1", "EQ_IN2", "EQ_HP", "EqualizerBase", "EqWidgetItemData",
    "PageProfFieldMixer", "PageLiveFieldMixer", "PageHiFiFieldMixer",
]


def parse_pe(path):
    d = open(path, "rb").read()
    e = int.from_bytes(d[0x3C:0x40], "little")
    coff = e + 4
    nsec = int.from_bytes(d[coff + 2:coff + 4], "little")
    optsz = int.from_bytes(d[coff + 16:coff + 18], "little")
    opt = coff + 20
    magic = int.from_bytes(d[opt:opt + 2], "little")
    if magic == 0x20B:
        base = int.from_bytes(d[opt + 24:opt + 32], "little")
    else:
        base = int.from_bytes(d[opt + 28:opt + 32], "little")
    sec0 = opt + optsz
    secs = []
    for k in range(nsec):
        s = sec0 + 40 * k
        secs.append(dict(
            name=d[s:s + 8].rstrip(b"\0").decode("latin1"),
            vsize=int.from_bytes(d[s + 8:s + 12], "little"),
            va=int.from_bytes(d[s + 12:s + 16], "little"),
            rawsz=int.from_bytes(d[s + 16:s + 20], "little"),
            raw=int.from_bytes(d[s + 20:s + 24], "little"),
        ))
    return d, base, secs


def main():
    data, base, secs = parse_pe(PATH)
    text = next(s for s in secs if s["name"] == ".text")
    rdata = next(s for s in secs if s["name"] == ".rdata")

    # 1. адреса строк
    targets = {}
    for nm in NAMES:
        needle = nm.encode() + b"\x00"
        pos = rdata["raw"]
        end = rdata["raw"] + rdata["rawsz"]
        while True:
            i = data.find(needle, pos, end)
            if i < 0:
                break
            va = rdata["va"] + (i - rdata["raw"])
            targets.setdefault(va, []).append(nm)
            pos = i + 1
    print("найдено строк из списка: %d уникальных VA" % len(targets))
    for va in sorted(targets):
        print("  0x%08x  %s" % (va, ", ".join(sorted(set(targets[va])))))

    # 2. lea rip-relative на эти адреса
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    # Без этого линейный проход обрывается на первом невалидном байте.
    md.skipdata = True
    lo = text["raw"]
    hi = text["raw"] + text["rawsz"]
    xrefs = defaultdict(list)     # string va -> [code addr]
    for ins in md.disasm(data[lo:hi], text["va"]):
        if ins.mnemonic != "lea" or len(ins.operands) != 2:
            continue
        m = ins.operands[1]
        if m.type != capstone.x86.X86_OP_MEM or m.mem.base != capstone.x86.X86_REG_RIP:
            continue
        tgt = ins.address + ins.size + m.mem.disp
        if tgt in targets:
            xrefs[tgt].append(ins.address)

    print("\nссылок на строки: %d" % sum(len(v) for v in xrefs.values()))
    for va in sorted(xrefs):
        print("  строка 0x%08x %-24s <- %s"
              % (va, ",".join(sorted(set(targets[va]))),
                 " ".join("0x%08x" % a for a in xrefs[va])))

    # 3. для каждой ссылки печатаем окно кода ±0x180 с тегами
    print("\n" + "=" * 76)
    for va in sorted(xrefs):
        for site in xrefs[va]:
            s = max(text["va"], site - 0x180)
            e = site + 0x180
            off = text["raw"] + (s - text["va"])
            print("\n### ссылка на %s в 0x%08x" % (",".join(sorted(set(targets[va]))), site))
            tags = []
            for ins in md.disasm(data[off:off + (e - s)], s):
                mark = " <<<" if ins.address == site else ""
                txt = "%s %s" % (ins.mnemonic, ins.op_str)
                if ("rip" in ins.op_str):
                    print("    0x%08x  %s%s" % (ins.address, txt, mark))
                if ins.mnemonic == "mov" and len(ins.operands) == 2:
                    d, src = ins.operands
                    if src.type == capstone.x86.X86_OP_IMM and d.type == capstone.x86.X86_OP_MEM:
                        v = src.imm
                        if 0 < v <= 0xFFFF:
                            tags.append((ins.address, v))
            if tags:
                print("    -- теги в окне: %s"
                      % " ".join("%04x@%08x" % (t, a) for a, t in tags))


if __name__ == "__main__":
    main()
