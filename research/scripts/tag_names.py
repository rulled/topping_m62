"""
Дамп функции «имя параметра -> тег» в MCC с разрешением строк по rip-relative lea.

Функция в районе 0x22be00..0x22e600: цепочки вида
    lea rax, [rip+disp]      ; адрес строки-имени
    mov [rbp-0x20], rax
    call сравнения
    test al, al
    je  next
    mov dword [rbp-0x10], 0xNNNN   ; тег
    jmp out
Значит, каждая пара «строка + тег» — это элемент таблицы соответствия.
"""
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


def read_cstr(data, secs, va, limit=200):
    o = foff(secs, va)
    if o is None:
        return None
    end = data.find(b"\x00", o, o + limit)
    if end < 0:
        return None
    raw = data[o:end]
    if not raw:
        return None
    try:
        s = raw.decode("ascii")
    except UnicodeDecodeError:
        return None
    if not all(32 <= ord(c) < 127 for c in s):
        return None
    return s


def main():
    lo_va = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0x22b000
    hi_va = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x232000
    data, base, secs = parse_pe(PATH)
    lo = foff(secs, lo_va)
    hi = foff(secs, hi_va)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True

    last_lea = None
    rows = []
    for ins in md.disasm(data[lo:hi], lo_va):
        if ins.mnemonic == "lea" and len(ins.operands) == 2:
            m = ins.operands[1]
            if m.type == capstone.x86.X86_OP_MEM and m.mem.base == capstone.x86.X86_REG_RIP:
                tgt = ins.address + ins.size + m.mem.disp
                s = read_cstr(data, secs, tgt)
                last_lea = s if s else None
        elif ins.mnemonic == "mov" and len(ins.operands) == 2:
            dst, src = ins.operands
            if src.type == capstone.x86.X86_OP_IMM and dst.type == capstone.x86.X86_OP_MEM:
                v = src.imm
                if 0x1000 <= v <= 0xFFFF:
                    rows.append((ins.address, v, last_lea))
                    last_lea = None
        elif ins.mnemonic in ("call", "jmp"):
            pass

    print("пар «имя -> тег»: %d" % len(rows))
    named = [r for r in rows if r[2]]
    print("из них с разрешённым именем: %d" % len(named))
    print()
    print("%-10s %-6s %s" % ("адрес", "тег", "имя"))
    for addr, tag, nm in rows:
        print("0x%08x   %04x   %s" % (addr, tag, nm if nm else "?"))


if __name__ == "__main__":
    main()
