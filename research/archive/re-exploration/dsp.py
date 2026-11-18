import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll")
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = True

def disasm_rva(rva, maxlen=400, label=''):
    off = pe.rva2off(rva)
    print('===== %s  RVA=0x%X (file 0x%X)' % (label, rva, off))
    code = pe.data[off:off+maxlen]
    for ins in md.disasm(code, pe.imagebase + rva):
        print('  0x%X  %-8s %s' % (ins.address, ins.mnemonic, ins.op_str))
        if ins.mnemonic == 'ret' or ins.mnemonic=='jmp' and ins.op_str.startswith('0x'):
            break

for name in ['TUSBAUDIO_GetDspProperty','TUSBAUDIO_SetDspProperty','TUSBAUDIO_GetExtendedInfo']:
    rva = pe.exports.get(name)
    if rva:
        disasm_rva(rva, 500, name)
    else:
        print(name, 'not exported')
