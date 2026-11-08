import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)
o=pe.rva2off(0x26EDC)
print('===== branch for ioctl > 0x80882104 (rva 0x26EDC)')
n=0
for ins in md.disasm(pe.data[o:o+300], pe.imagebase+0x26EDC):
    print('  0x%X  %-9s %s' % (ins.address, ins.mnemonic, ins.op_str)); n+=1
    if n>55: break
