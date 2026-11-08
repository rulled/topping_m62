"""
Извлечение карты настроек M62 — правильная привязка метки к значению.

Компилятор оптимизирует и грузит адрес СЛЕДУЮЩЕЙ строки ДО cmovne:

    lea rax, "Discharge"
    mov [rbp-0x30], rax
    call 0x2d330            <- сравнение С "Discharge"
    test al, al
    lea rax, "Disabled"     <- уже готовит следующую!
    mov ecx, 2
    cmovne ebx, ecx         <- но это значение ДЛЯ "Discharge"

Поэтому привязка такая:
  метка = строка, загруженная в стек-слот ПЕРЕД `call 0x2d330`
  значение = то, что в ecx/r12d на момент cmovne ПОСЛЕ этого call

То есть идём по вызовам сравнения, а не по строкам.
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


def main():
    d, secs = parse_pe(PATH)
    off = foff(secs, LO)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True
    insns = list(md.disasm(d[off:off + (HI - LO)], LO))
    X = capstone.x86

    # 1) все строки с их адресами
    str_at = {}
    for ins in insns:
        if ins.mnemonic == "lea" and len(ins.operands) == 2:
            m = ins.operands[1]
            if m.type == X.X86_OP_MEM and m.mem.base == X.X86_REG_RIP:
                s = cstr(d, secs, ins.address + ins.size + m.mem.disp)
                if s:
                    str_at[ins.address] = s

    blocks = []
    cur = None
    pending_str = None      # строка, загруженная до call
    pending_val = None      # значение для следующего cmovne
    last_cmp = None         # строка ПОСЛЕДНЕГО сравнения (это имя параметра)

    # индекс по адресу, чтобы следовать jmp на общие хвосты
    by_addr = {ins.address: i for i, ins in enumerate(insns)}

    jmp_seen = set()
    i = 0
    while i < len(insns):
        ins = insns[i]
        addr = ins.address
        i += 1

        # запомнить загружаемую строку
        if addr in str_at:
            pending_str = str_at[addr]
            continue

        # тег
        if ins.mnemonic == "mov" and len(ins.operands) == 2:
            dst, src = ins.operands
            if (src.type == X.X86_OP_IMM and dst.type == X.X86_OP_MEM
                    and dst.mem.base == X.X86_REG_RBP and dst.mem.disp == -0x20):
                v = src.imm
                if 0x1000 <= v <= 0xFFFF:
                    if cur:
                        blocks.append(cur)
                    # ИМЯ — последняя строка сравнения ДО тега
                    cur = {"tag": v, "name": last_cmp, "items": []}
                    pending_val = None
                    continue

        # сравнение
        if ins.mnemonic == "call" and ins.op_str.strip() == hex(CMP_FUNC):
            if pending_str:
                last_cmp = pending_str
                if cur is not None:
                    cur["_cmp"] = pending_str
            pending_str = None
            continue

        # jmp: если это переход на общий хвост ВНУТРИ функции — следуем,
        # иначе просто продолжаем линейно (capstone уже потерял выравнивание
        # после такого jmp, поэтому пере-дизассемблируем с адреса за jmp)
        if ins.mnemonic == "jmp" and ins.op_str.startswith("0x"):
            try:
                tgt = int(ins.op_str, 16)
            except ValueError:
                tgt = None
            if (tgt is not None and tgt in by_addr and tgt > addr
                    and tgt <= HI and (addr, tgt) not in jmp_seen):
                jmp_seen.add((addr, tgt))
                i = by_addr[tgt]
                continue
            # линейное продолжение с правильного места
            nxt = addr + ins.size
            if nxt in by_addr:
                i = by_addr[nxt]
            continue

        # xor ecx, ecx
        if ins.mnemonic == "xor" and len(ins.operands) == 2:
            a, b = ins.operands
            if (a.type == X.X86_OP_REG and b.type == X.X86_OP_REG
                    and a.reg == b.reg == X.X86_REG_ECX):
                pending_val = 0
            continue

        # mov ecx, N
        if ins.mnemonic == "mov" and len(ins.operands) == 2:
            a, b = ins.operands
            if (a.type == X.X86_OP_REG and a.reg == X.X86_REG_ECX
                    and b.type == X.X86_OP_IMM):
                pending_val = b.imm
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
            if cur is not None and val is not None and cur.get("_cmp"):
                cur["items"].append((cur["_cmp"], val))
            pending_val = None
            continue

    if cur:
        blocks.append(cur)

    print("DEBUG: инструкций %d, блоков %d" % (len(insns), len(blocks)), file=sys.stderr)

    print("=== НАСТРОЙКИ M62: тег, имя, перечисление ===")
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


