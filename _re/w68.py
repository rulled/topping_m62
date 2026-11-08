import sys, struct, bisect
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll")
md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail=True
text=pe.sections[0]
code=pe.data[text['rawptr']:text['rawptr']+text['vsize']]
base=pe.imagebase+text['va']
hits=[]
for ins in md.disasm(code, base):
    if ins.mnemonic in ('mov','lea','add') and '+ 0x68]' in ins.op_str and ins.mnemonic=='mov':
        # only writes: first operand mem
        if ins.op_str.startswith('qword ptr [') or ins.op_str.startswith('dword ptr ['):
            hits.append(ins)
print('potential writes to [reg+0x68]:', len(hits))
for i in hits[:25]:
    print('  rva 0x%-6X %-8s %s' % (i.address-pe.imagebase, i.mnemonic, i.op_str))
