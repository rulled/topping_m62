"""
Извлечение карты настроек M62 — через сканирование ЦЕЛЕЙ переходов.

Проблема линейного прохода: после `jmp` capstone теряет выравнивание и
выдаёт мусор (`.byte 0xc7`). Поэтому дизассемблируем НЕЗАВИСИМО от каждой
цели `je` — там всегда начинается корректный блок сравнения.

Алгоритм:
  1. Линейно находим все `mov [rbp-0x20], imm16` (теги) и все `je 0x...`.
  2. Для каждой цели `je` дизассемблируем блок до `jmp`/`ret` и разбираем
     сравнения: строка -> значение.
  3. Имя параметра — строка сравнения, стоящая ПЕРЕД тегом.
"""
import sys
import capstone

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"
LO, HI = 0x230400, 0x230b00
CMP_FUNC = 0x2d330
R12D = 1


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


def make_md():
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True
    return md


def disasm_block(d, secs, md, start, limit=0x400):
    """Дизассемблировать от start до jmp/ret (или лимита)."""
    off = foff(secs, start)
    out = []
    for ins in md.disasm(d[off:off + limit], start):
        out.append(ins)
        if ins.mnemonic in ("jmp", "ret"):
            break
    return out


def main():
    d, secs = parse_pe(PATH)
    md = make_md()
    X = capstone.x86

    # 1) линейный проход по всему диапазону — ищем теги и цели je
    off = foff(secs, LO)
    linear = list(md.disasm(d[off:off + (HI - LO)], LO))

    tags = []      # (addr, tag)
    je_targets = []
    for ins in linear:
        if ins.mnemonic == "mov" and len(ins.operands) == 2:
            dst, src = ins.operands
            if (src.type == X.X86_OP_IMM and dst.type == X.X86_OP_MEM
                    and dst.mem.base == X.X86_REG_RBP and dst.mem.disp == -0x20):
                v = src.imm
                if 0x1000 <= v <= 0xFFFF:
                    tags.append((ins.address, v))
        if ins.mnemonic == "je" and ins.op_str.startswith("0x"):
            try:
                je_targets.append(int(ins.op_str, 16))
            except ValueError:
                pass

    print("DEBUG: тегов %d, целей je %d" % (len(tags), len(je_targets)), file=sys.stderr)

    # 2) для каждого тега — блок сравнений, идущий СРАЗУ после него
    blocks = []
    for addr, tag in tags:
        # блок начинается после инструкции записи тега
        nxt = addr
        # найдём конец инструкции тега
        for ins in linear:
            if ins.address == addr:
                nxt = addr + ins.size
                break
        blk = disasm_block(d, secs, md, nxt)

        items = []
        pending_str = None
        pending_val = None
        cmp_str = None
        for ins in blk:
            if ins.mnemonic == "lea" and len(ins.operands) == 2:
                m = ins.operands[1]
                if m.type == X.X86_OP_MEM and m.mem.base == X.X86_REG_RIP:
                    s = cstr(d, secs, ins.address + ins.size + m.mem.disp)
                    if s:
                        pending_str = s
                continue
            if ins.mnemonic == "call" and ins.op_str.strip() == hex(CMP_FUNC):
                if pending_str:
                    cmp_str = pending_str
                pending_str = None
                continue
            if ins.mnemonic == "xor" and len(ins.operands) == 2:
                a, b = ins.operands
                if (a.type == X.X86_OP_REG and b.type == X.X86_OP_REG
                        and a.reg == b.reg == X.X86_REG_ECX):
                    pending_val = 0
                continue
            if ins.mnemonic == "mov" and len(ins.operands) == 2:
                a, b = ins.operands
                if (a.type == X.X86_OP_REG and a.reg == X.X86_REG_ECX
                        and b.type == X.X86_OP_IMM):
                    pending_val = b.imm
                continue
            if ins.mnemonic == "cmovne" and len(ins.operands) == 2:
                src = ins.operands[1]
                val = None
                if src.type == X.X86_OP_REG:
                    if src.reg in (X.X86_REG_R12D, X.X86_REG_R12):
                        val = R12D
                    elif src.reg == X.X86_REG_ECX:
                        val = pending_val
                if val is not None and cmp_str:
                    items.append((cmp_str, val))
                pending_val = None
                continue
            if ins.mnemonic == "jmp":
                break

        blocks.append({"tag": tag, "items": items})

    # 3) имя параметра: последняя строка, сравнённая с rdi ДО тега.
    #    В диспетчере два вида сравнений:
    #       mov rcx, rdi  -> сравнение ИМЕНИ параметра
    #       mov rcx, r14  -> сравнение ЗНАЧЕНИЯ перечисления
    for b in blocks:
        addr = next(a for a, t in tags if t == b["tag"])
        start = max(LO, addr - 0x80)
        blk = disasm_block(d, secs, md, start, limit=0x80)
        pending_str = None
        pending_reg = None
        last_name = None
        for ins in blk:
            if ins.mnemonic == "lea" and len(ins.operands) == 2:
                m = ins.operands[1]
                if m.type == X.X86_OP_MEM and m.mem.base == X.X86_REG_RIP:
                    s = cstr(d, secs, ins.address + ins.size + m.mem.disp)
                    if s:
                        pending_str = s
                continue
            if ins.mnemonic == "mov" and len(ins.operands) == 2:
                a, o = ins.operands
                if a.type == X.X86_OP_REG and a.reg == X.X86_REG_RCX and o.type == X.X86_OP_REG:
                    pending_reg = o.reg
                continue
            if ins.mnemonic == "call" and ins.op_str.strip() == hex(CMP_FUNC):
                if pending_str and pending_reg == X.X86_REG_RDI:
                    last_name = pending_str
                pending_str = None
                pending_reg = None
                continue
        b["name"] = last_name

    print("=== НАСТРОЙКИ M62 ===")
    print()
    for b in blocks:
        tag = b["tag"]
        print("0x%04x  TT=0x%02x PP=0x%02x   %s" % (tag, tag >> 8, tag & 0xFF, b["name"] or "?"))
        seen = set()
        for s, v in b["items"]:
            if (s, v) in seen:
                continue
            seen.add((s, v))
            print("            %-28s = %d" % (s, v))
        if not b["items"]:
            print("            (числовое/флаговое)")
        print()


if __name__ == "__main__":
    main()
