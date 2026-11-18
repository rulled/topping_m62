import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll")
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = True

def disasm_rva(rva, maxlen, label):
    off = pe.rva2off(rva)
    print('===== %s  RVA=0x%X' % (label, rva))
    code = pe.data[off:off+maxlen]
    n=0
    for ins in md.disasm(code, pe.imagebase + rva):
        print('  0x%X  %-9s %s' % (ins.address, ins.mnemonic, ins.op_str))
        n+=1
        if n>120: 
            print('   ...')
            break

disasm_rva(0x0E0A0, 700, 'worker_get (called from GetDspProperty)')
