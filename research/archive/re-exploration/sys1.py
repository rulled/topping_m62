import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

sysf = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys"
pe = PE(sysf)
print('imagebase 0x%X size 0x%X' % (pe.imagebase, len(pe.data)))
for s in pe.sections:
    print('  %-10s va=0x%-7X vsize=0x%-7X rawptr=0x%X' % (s['name'], s['va'], s['vsize'], s['rawptr']))

# search for 0xEE000053 immediate (53 00 00 EE) and 0xEE000033
for const in [0xEE000053, 0xEE000033, 0xEE000041, 0xEE000048]:
    pat = struct.pack('<I', const)
    hits = []
    i = 0
    while True:
        i = pe.data.find(pat, i)
        if i < 0: break
        hits.append(i); i += 1
    print('const 0x%X -> %d hits: %s' % (const, len(hits), [hex(h) for h in hits[:8]]))
