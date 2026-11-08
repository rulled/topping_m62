import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = True
text = pe.sections[0]
off = text['rawptr']; size = text['vsize']
code = pe.data[off:off+size]
base = pe.imagebase + text['va']
writes=[]
reads=[]
for ins in md.disasm(code, base):
    for op in ins.operands:
        if op.type == 3:  # X86_OP_MEM
            m = op.mem
            if m.disp == 0x4c4 and m.base != 0:
                if op.access and op.access & 2:  # write
                    writes.append(ins)
                else:
                    reads.append(ins)
print('WRITES to [reg+0x4c4]:', len(writes))
for i in writes[:40]:
    print('  0x%X  %-8s %s' % (i.address, i.mnemonic, i.op_str))
print()
print('READS/cmp of [reg+0x4c4]:', len(reads))
for i in reads[:40]:
    print('  0x%X  %-8s %s' % (i.address, i.mnemonic, i.op_str))
