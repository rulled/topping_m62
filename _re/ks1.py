import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
for f in [r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioks.sys"]:
    pe = PE(f)
    print('==', f, 'size 0x%X' % len(pe.data))
    for s in pe.sections: print('   %-8s va=0x%-6X vsize=0x%X' % (s['name'], s['va'], s['vsize']))
    for const in [0x80882200,0x80882204,0x808820C4,0x80882004,0x808820D8]:
        pat = struct.pack('<I', const)
        hits=[]; i=0
        while True:
            i = pe.data.find(pat,i)
            if i<0: break
            hits.append(i); i+=1
        print('   0x%X -> %d %s' % (const, len(hits), [hex(h) for h in hits[:5]]))
