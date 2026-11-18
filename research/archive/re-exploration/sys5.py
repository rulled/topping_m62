import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)
pat = struct.pack('<I', 0x4c4)
hits=[]
i=0
while True:
    i = pe.data.find(pat, i)
    if i<0: break
    hits.append(i); i+=1
print('disp32 0x4c4 byte hits:', len(hits))
for h in hits:
    rva = pe.off2rva(h-4)
    # disassemble a window starting a bit earlier
    start = h-12
    rva2 = pe.off2rva(start)
    print('--- file 0x%X rva 0x%X' % (h, pe.off2rva(h)))
    for ins in md.disasm(pe.data[start:h+16], pe.imagebase+rva2):
        mark=' <==' if ins.address <= pe.imagebase+pe.off2rva(h) < ins.address+ins.size else '    '
        print('%s0x%X  %-8s %s' % (mark, ins.address, ins.mnemonic, ins.op_str))
