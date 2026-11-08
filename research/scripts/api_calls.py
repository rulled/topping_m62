"""
Второй шаг: MCC резолвит ВСЕ имена через GetProcAddress (таблица @0x239xxx),
но это не значит, что функции вызываются.

Ищем реальные вызовы: `call qword ptr [rip+X]`, где цель — слот в таблице
указателей. Таблица указателей лежит в .data или рядом с .rdata.

Практический путь: для каждой строки TUSBAUDIO_* находим её lea (место
резолва), затем ищем, в какой глобальный слот сохраняется результат
(обычно `mov [rip+disp], rax` сразу после GetProcAddress), и считаем
`call qword [rip+disp]` на этот слот.
"""
import capstone
import re
from collections import defaultdict

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"

WANT = {
    "TUSBAUDIO_SetDspProperty",
    "TUSBAUDIO_GetDspProperty",
    "TUSBAUDIO_AudioControlRequestSet",
    "TUSBAUDIO_ClassVendorRequestOut",
    "TUSBAUDIO_GetPeakMeters",
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


def foff(secs, va):
    for s in secs:
        if s["va"] <= va < s["va"] + max(s["vsize"], s["rawsz"]):
            return s["raw"] + (va - s["va"])
    return None


def main():
    d, secs = parse_pe(PATH)
    text = next(s for s in secs if s["name"] == ".text")

    names = {}
    i = 0
    while True:
        i = d.find(b"TUSBAUDIO_", i)
        if i < 0:
            break
        z = d.find(b"\0", i, i + 80)
        s = d[i:z].decode("latin1")
        for sec in secs:
            if sec["raw"] <= i < sec["raw"] + sec["rawsz"]:
                names[sec["va"] + (i - sec["raw"])] = s
                break
        i = z

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    # проходим .text и запоминаем:
    #  - lea на строку TUSBAUDIO_*
    #  - следующие несколько инструкций, чтобы увидеть mov [rip+X], rax
    lo, hi = text["raw"], text["raw"] + text["rawsz"]
    insns = list(md.disasm(d[lo:hi], text["va"]))
    print("инструкций в .text: %d" % len(insns))

    # для каждой строки: адрес места резолва
    resolve_site = {}
    for idx, ins in enumerate(insns):
        if ins.mnemonic != "lea" or len(ins.operands) != 2:
            continue
        m = ins.operands[1]
        if m.type != capstone.x86.X86_OP_MEM or m.mem.base != capstone.x86.X86_REG_RIP:
            continue
        t = ins.address + ins.size + m.mem.disp
        if t in names:
            resolve_site[names[t]] = (ins.address, idx)

    # ищем слот: после GetProcAddress обычно mov [rip+disp], rax/reg
    # берём окно +0x40 байт после резолва
    slot_of = {}
    for nm, (addr, idx) in resolve_site.items():
        for j in range(idx, min(idx + 12, len(insns))):
            ins = insns[j]
            if ins.mnemonic in ("mov", "movups", "movaps") and "[rip" in ins.op_str:
                m = re.search(r"\[rip \+ (0x[0-9a-f]+)\]", ins.op_str)
                if m:
                    tgt = ins.address + ins.size + int(m.group(1), 16)
                    slot_of.setdefault(nm, tgt)
                    break

    print("\n=== слоты, куда сохраняется указатель ===")
    for nm in sorted(WANT):
        if nm in slot_of:
            print("  %-42s слот 0x%x" % (nm, slot_of[nm]))
        else:
            print("  %-42s слот не определён" % nm)

    # считаем вызовы call qword [rip+X] на эти слоты
    print("\n=== реальные вызовы (call qword [slot]) ===")
    for nm in sorted(WANT):
        slot = slot_of.get(nm)
        if slot is None:
            print("  %-42s ?" % nm)
            continue
        calls = []
        for ins in insns:
            if ins.mnemonic != "call" or len(ins.operands) != 1:
                continue
            m = ins.operands[0]
            if m.type != capstone.x86.X86_OP_MEM or m.mem.base != capstone.x86.X86_REG_RIP:
                continue
            t = ins.address + ins.size + m.mem.disp
            if t == slot:
                calls.append(ins.address)
        print("  %-42s вызовов: %d %s"
              % (nm, len(calls), " ".join("0x%x" % c for c in calls[:5])))


if __name__ == "__main__":
    main()
