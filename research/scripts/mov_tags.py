"""
Поиск тегов в MCC/KBCC по ФОРМЕ ИНСТРУКЦИИ (mov dword [mem], imm32), а не по
«любому u32 в файле» — так отсекается шум из данных и кода с другими константами.

imm32 = lo hi 00 00 (little-endian) для тега (TT<<8)|PP, т.к. tag < 0x10000.
Формы записи imm32 в x64:
  C7 45 <disp8>        imm32   mov dword [rbp+disp8], imm32
  C7 44 24 <disp8>     imm32   mov dword [rsp+disp8], imm32
  C7 40/41/42/43 <d8>  imm32   mov dword [reg+disp8], imm32
  C7 00/01/..          imm32   mov dword [reg], imm32
  B8..BF               imm32   mov r32, imm32
  68                   imm32   push imm32
  C6 45 <disp8> <imm8>         mov byte [rbp+d8], imm8   (не тег, но учтём отдельно)
"""
import sys
from collections import defaultdict

MCC = r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe"
KBCC = r"C:\Program Files\TOPPING Pro\KB Control Center\KB Control Center.exe"

# (имя формы, префикс байт, длина префикса)  -> imm32 начинается сразу после префикса
FORMS = [
    ("mov [rbp+d8]",  b"\xc7\x45", 3),
    ("mov [rsp+d8]",  b"\xc7\x44\x24", 4),
    ("mov [reg+d8]",  None, 0),   # отдельно
    ("mov [reg]",     None, 0),   # отдельно
    ("mov r32",       None, 0),   # отдельно
    ("push imm32",    b"\x68", 1),
]

REG_D8 = [b"\xc7\x40", b"\xc7\x41", b"\xc7\x42", b"\xc7\x43"]
REG_00 = [b"\xc7\x00", b"\xc7\x01", b"\xc7\x02", b"\xc7\x03",
          b"\xc7\x06", b"\xc7\x07"]
MOV_R32 = [bytes([b]) for b in range(0xB8, 0xC0)]


def imm32_forms(data):
    """Отдаёт (form_name, offset_начала_imm32)."""
    out = []
    for name, pre, plen in FORMS:
        if pre is None:
            continue
        start = 0
        while True:
            i = data.find(pre, start)
            if i < 0:
                break
            out.append((name, i + plen))
            start = i + 1
    for pre in REG_D8:
        start = 0
        while True:
            i = data.find(pre, start)
            if i < 0:
                break
            out.append(("mov [reg+d8]", i + 3))
            start = i + 1
    for pre in REG_00:
        start = 0
        while True:
            i = data.find(pre, start)
            if i < 0:
                break
            out.append(("mov [reg]", i + 2))
            start = i + 1
    for pre in MOV_R32:
        start = 0
        while True:
            i = data.find(pre, start)
            if i < 0:
                break
            out.append(("mov r32", i + 1))
            start = i + 1
    return out


def main(which):
    path = MCC if which == "mcc" else KBCC
    data = open(path, "rb").read()
    n = len(data)
    fams = defaultdict(lambda: defaultdict(lambda: [0, None]))
    total = 0
    for name, i in imm32_forms(data):
        if i + 4 > n:
            continue
        lo, hi, z2, z3 = data[i], data[i + 1], data[i + 2], data[i + 3]
        if z2 or z3:
            continue                     # старшие два байта должны быть нули
        tag = (hi << 8) | lo
        if tag < 0x1000:
            continue                     # мелочь — не тег
        total += 1
        rec = fams[tag >> 8][tag & 0xFF]
        rec[0] += 1
        if rec[1] is None:
            rec[1] = i
    print("=" * 76)
    print("%s: файл %d байт, тегоподобных imm32: %d, семейств: %d"
          % (which.upper(), n, total, len(fams)))
    print("=" * 76)
    for fam in sorted(fams):
        items = fams[fam]
        print("\nTT=0x%02x  (%d свойств)" % (fam, len(items)))
        line = []
        for pp in sorted(items):
            c, off = items[pp]
            line.append("%02x:%d@%05x" % (pp, c, off))
        for k in range(0, len(line), 7):
            print("    " + "  ".join(line[k:k + 7]))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "mcc")
