import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)
text = pe.sections[0]
code = pe.data[text['rawptr']:text['rawptr']+text['vsize']]
base = pe.imagebase + text['va']
hits=[]
for ins in md.disasm(code, base):
    if '0x4c4' in ins.op_str:
        hits.append(ins)
print('instructions mentioning 0x4c4:', len(hits))
for i in hits:
    print('  0x%X  %-9s %s' % (i.address, i.mnemonic, i.op_str))
