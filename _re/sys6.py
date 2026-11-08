import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)
def dis(rva_start, rva_end, label):
    o1 = pe.rva2off(rva_start); o2 = pe.rva2off(rva_end)
    print('===== %s  0x%X..0x%X' % (label, rva_start, rva_end))
    for ins in md.disasm(pe.data[o1:o2], pe.imagebase+rva_start):
        print('  0x%X  %-8s %s' % (ins.address, ins.mnemonic, ins.op_str))
dis(0x24690, 0x24900, 'state machine')
