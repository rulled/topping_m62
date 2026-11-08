"""
Найти в MCC место вызова TUSBAUDIO_SetDspProperty и вытащить аргументы.

IAT-вызов выглядит как:  call qword ptr [rip + disp]
где disp указывает на слот в .rdata, содержащий указатель на строку имени.
Находим строку -> находим слот IAT -> находим call на этот слот ->
смотрим, что кладётся в rcx/rdx/r8/r9 перед вызовом.
"""
import struct
import capstone

PATH = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"
TARGET = "TUSBAUDIO_SetDspProperty"


def parse_pe(path):
    d = open(path, "rb").read()
    e = int.from_bytes(d[0x3C:0x40], "little")
    coff = e + 4
    nsec = int.from_bytes(d[coff + 2:coff + 4], "little")
    optsz = int.from_bytes(d[coff + 16:coff + 18], "little")
    opt = coff + 20
    magic = int.from_bytes(d[opt:opt + 2], "little")
    base = (int.from_bytes(d[opt + 24:opt + 32], "little") if magic == 0x20B
            else int.from_bytes(d[opt + 28:opt + 32], "little"))
    sec0 = opt + optsz
    secs = []
    for k in range(nsec):
        s = sec0 + 40 * k
        secs.append(dict(name=d[s:s + 8].rstrip(b"\0").decode("latin1"),
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


def va_from_off(secs, off):
    for s in secs:
        if s["raw"] <= off < s["raw"] + s["rawsz"]:
            return s["va"] + (off - s["raw"])
    return None


def cstr(d, secs, va, lim=100):
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
    d, base, secs = parse_pe(PATH)
    text = next(s for s in secs if s["name"] == ".text")

    # 1) где строка имени
    i = d.find(TARGET.encode())
    if i < 0:
        print("строка не найдена")
        return
    name_va = va_from_off(secs, i)
    print("строка %s @ файл 0x%x  VA 0x%x" % (TARGET, i, name_va))

    # 2) слот IAT: qword, равный name_va
    pat = struct.pack("<Q", name_va)
    slots = []
    p = 0
    while True:
        j = d.find(pat, p)
        if j < 0:
            break
        slots.append(j)
        p = j + 1
    print("слотов IAT со ссылкой на строку: %d" % len(slots))
    for j in slots:
        print("   слот @ файл 0x%x  VA 0x%x" % (j, va_from_off(secs, j)))

    if not slots:
        print("\nвывод: MCC НЕ импортирует SetDspProperty через IAT "
              "(строка есть, но не используется как импорт)")
        return

    slot_va = va_from_off(secs, slots[0])

    # 3) ищем call qword [rip+disp], указывающий на слот
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True
    lo = text["raw"]
    hi = text["raw"] + text["rawsz"]
    calls = []
    for ins in md.disasm(d[lo:hi], text["va"]):
        if ins.mnemonic != "call":
            continue
        if len(ins.operands) != 1:
            continue
        m = ins.operands[0]
        if m.type != capstone.x86.X86_OP_MEM or m.mem.base != capstone.x86.X86_REG_RIP:
            continue
        tgt = ins.address + ins.size + m.mem.disp
        if tgt == slot_va:
            calls.append(ins.address)

    print("\nвызовов SetDspProperty: %d" % len(calls))
    for c in calls:
        print("   call @ 0x%x" % c)


if __name__ == "__main__":
    main()
