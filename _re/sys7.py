import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)
# find prologue before 0x24690
o = pe.rva2off(0x24690)
# scan backwards for int3 run
i = o
while i > 0:
    if pe.data[i] == 0xCC and pe.data[i-1] == 0xCC and pe.data[i-2] == 0xCC:
        break
    i -= 1
start_rva = pe.off2rva(i+1)
print('function starts near rva 0x%X' % start_rva)
for ins in md.disasm(pe.data[i+1:i+120], pe.imagebase+start_rva):
    print('  0x%X  %-8s %s' % (ins.address, ins.mnemonic, ins.op_str))
    if ins.mnemonic == 'call' or ins.mnemonic=='jmp':
        pass
