import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail=True
text=pe.sections[0]
code=pe.data[text['rawptr']:text['rawptr']+text['vsize']]
base=pe.imagebase+text['va']
targets = {0x23F20:'streamcfg', 0x25BAF:'ioctl-dispatch'}
for tgt,lab in targets.items():
    T=pe.imagebase+tgt; found=[]
    for ins in md.disasm(code, base):
        if ins.mnemonic in ('call','jmp'):
            for op in ins.operands:
                if op.type==2 and op.imm==T: found.append(ins.address)
    print('%s (rva 0x%X): %d refs %s' % (lab,tgt,len(found),[hex(x-pe.imagebase) for x in found]))
