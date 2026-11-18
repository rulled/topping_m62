import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail=True
text = pe.sections[0]
code = pe.data[text['rawptr']:text['rawptr']+text['vsize']]
base = pe.imagebase + text['va']
target = pe.imagebase + 0x23F20
callers=[]
for ins in md.disasm(code, base):
    if ins.mnemonic in ('call','jmp'):
        for op in ins.operands:
            if op.type == 2 and op.imm == target:  # X86_OP_IMM
                callers.append(ins.address)
print('callers of 0x140023F20:', [hex(c) for c in callers])
# also function 0x23CF0 (referenced as 0x140023cf0)
target2 = pe.imagebase + 0x23CF0
c2=[]
for ins in md.disasm(code, base):
    if ins.mnemonic in ('call','jmp'):
        for op in ins.operands:
            if op.type == 2 and op.imm == target2:
                c2.append(ins.address)
print('callers of 0x140023CF0:', [hex(c) for c in c2])
