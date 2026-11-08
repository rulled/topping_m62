import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)

def show(fileoff, before=48, after=48, label=''):
    rva = pe.off2rva(fileoff)
    print('===== %s file=0x%X rva=0x%X' % (label, fileoff, rva))
    start = fileoff - before
    if start < 0: start = 0
    code = pe.data[start:fileoff+after]
    for ins in md.disasm(code, pe.imagebase + pe.off2rva(start)):
        mark = '  <== ' if ins.address == pe.imagebase + rva else '      '
        print('%s0x%X  %-8s %s' % (mark, ins.address, ins.mnemonic, ins.op_str))

for off,lab in [(0x23cbd,'hit1'),(0x25dad,'hit2'),(0x2609d,'hit3'),(0x27007,'hit4'),(0x328c5,'hit5')]:
    show(off, 56, 24, lab)
    print()
