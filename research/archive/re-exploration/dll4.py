import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll")
md = Cs(CS_ARCH_X86, CS_MODE_64)
for name in ['TUSBAUDIO_ClassVendorRequestIn','TUSBAUDIO_ClassVendorRequestOut']:
    rva = pe.exports[name]
    o=pe.rva2off(rva)
    print('===== %s rva 0x%X' % (name, rva)); n=0
    for ins in md.disasm(pe.data[o:o+300], pe.imagebase+rva):
        print('  0x%X  %-9s %s' % (ins.address, ins.mnemonic, ins.op_str)); n+=1
        if n>40: break
    print()
