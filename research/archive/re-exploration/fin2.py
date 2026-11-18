import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)
def dis(rva, ln, lab):
    o=pe.rva2off(rva); print('===== %s rva 0x%X' % (lab,rva)); n=0
    for ins in md.disasm(pe.data[o:o+ln], pe.imagebase+rva):
        print('  0x%X  %-8s %s' % (ins.address, ins.mnemonic, ins.op_str)); n+=1
        if n>24: break
    print()
dis(0x288F6, 0x2A, 'epilogue after success')
dis(0x28908, 0x2A, 'branch when DSP-plugin feature bit CLEAR')
dis(0x269AB, 0x30, 'branch when state != 1')
