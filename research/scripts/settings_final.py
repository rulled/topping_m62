"""
ФИНАЛЬНЫЙ извлекатель карты настроек M62.

Ключевая проблема: после `jmp` на общий хвост capstone теряет выравнивание.
Решение: дизассемблировать кусками, перезапуская с адреса за `jmp`.

Структура блока (проверено дизассемблером):
    lea rax, "Brightness"     <- ИМЯ ПАРАМЕТРА
    mov [rbp-0x30], rax
    mov rcx, rdi              <- сравнение с ИМЕНЕМ
    call 0x2d330
    test al, al
    je   next
    mov [rbp-0x20], 0x1104    <- ТЕГ
    lea rax, "Dim"            <- МЕТКА ЗНАЧЕНИЯ
    mov [rbp-0x30], rax
    mov rcx, r14              <- сравнение со ЗНАЧЕНИЕМ
    call 0x2d330
    mov ebx, [rbp-0x1c]
    xor ecx, ecx              <- значение 0
    test al, al
    cmovne ebx, ecx
    ...
    mov [rbp-0x1c], ebx
    jmp 0x230ad6
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


def disasm_linear(d, secs, md, start, end):
    """Линейный проход с перезапуском после jmp (чтобы не терять выравнивание)."""
    out = []
    pc = start
    guard = 0
    while pc < end and guard < 5000:
        guard += 1
        off = foff(secs, pc)
        if off is None:
            break
        got = False
        for ins in md.disasm(d[off:off + 16], pc):
            out.append(ins)
            pc = ins.address + ins.size
            got = True
            break
        if not got:
            pc += 1
    return out


def main():
    d, secs = parse_pe(PATH)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True
    X = capstone.x86

    insns = disasm_linear(d, secs, md, LO, HI)
    print("DEBUG: инструкций %d" % len(insns), file=sys.stderr)

    blocks = []
    cur = None
    pending_str = None
    pending_reg = None
    pending_val = None
    cmp_name = None     # строка, сравнённая с rdi (имя параметра)
    cmp_val = None      # строка, сравнённая с r14 (метка значения)

    for ins in insns:
        # строка
        if ins.mnemonic == "lea" and len(ins.operands) == 2:
            m = ins.operands[1]
            if m.type == X.X86_OP_MEM and m.mem.base == X.X86_REG_RIP:
                s = cstr(d, secs, ins.address + ins.size + m.mem.disp)
                if s:
                    pending_str = s
            continue

        # mov rcx, rXX  (какой регистр сравниваем)
        if ins.mnemonic == "mov" and len(ins.operands) == 2:
            a, b = ins.operands
            if (a.type == X.X86_OP_REG and a.reg == X.X86_REG_RCX
                    and b.type == X.X86_OP_REG):
                pending_reg = b.reg
                continue
            # mov [rbp-0x20], imm16 -> ТЕГ
            if (b.type == X.X86_OP_IMM and a.type == X.X86_OP_MEM
                    and a.mem.base == X.X86_REG_RBP and a.mem.disp == -0x20):
                v = b.imm
                if 0x1000 <= v <= 0xFFFF:
                    if cur:
                        blocks.append(cur)
                    cur = {"tag": v, "name": cmp_name, "items": []}
                    pending_val = None
                    continue
            # mov ecx, N
            if (a.type == X.X86_OP_REG and a.reg == X.X86_REG_ECX
                    and b.type == X.X86_OP_IMM):
                pending_val = b.imm
                continue

        # xor ecx, ecx
        if ins.mnemonic == "xor" and len(ins.operands) == 2:
            a, b = ins.operands
            if (a.type == X.X86_OP_REG and b.type == X.X86_OP_REG
                    and a.reg == b.reg == X.X86_REG_ECX):
                pending_val = 0
            continue

        # сравнение
        if ins.mnemonic == "call" and ins.op_str.strip() == hex(CMP_FUNC):
            if pending_str:
                if pending_reg == X.X86_REG_RDI:
                    cmp_name = pending_str
                elif pending_reg == X.X86_REG_R14:
                    cmp_val = pending_str
            pending_str = None
            pending_reg = None
            continue

        # cmovne ebx, X
        if ins.mnemonic == "cmovne" and len(ins.operands) == 2:
            src = ins.operands[1]
            val = None
            if src.type == X.X86_OP_REG:
                if src.reg in (X.X86_REG_R12D, X.X86_REG_R12):
                    val = R12D
                elif src.reg == X.X86_REG_ECX:
                    val = pending_val
            if cur is not None and val is not None and cmp_val:
                cur["items"].append((cmp_val, val))
            pending_val = None
            continue

    if cur:
        blocks.append(cur)

    print("DEBUG: блоков %d" % len(blocks), file=sys.stderr)
    print()
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
