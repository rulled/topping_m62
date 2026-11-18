import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
# .pdata is array of RUNTIME_FUNCTION {BeginRVA, EndRVA, UnwindRVA}
s = [x for x in pe.sections if x['name']=='.pdata'][0]
n = s['vsize']//12
funcs=[]
for i in range(n):
    o = s['rawptr']+i*12
    b,e,u = struct.unpack_from('<III', pe.data, o)
    funcs.append((b,e))
funcs.sort()
# find function containing 0x24812
target=0x24812
for b,e in funcs:
    if b <= target < e:
        print('function containing 0x%X: 0x%X - 0x%X  (%d bytes)' % (target,b,e,e-b))
        break
# list functions containing each 0x4c4 reference
import bisect
starts=[f[0] for f in funcs]
for t in [0x22980,0x22DB5,0x247B2,0x2480F,0x2481C,0x24836,0x2483F,0x251BA,0x252B7,0x265EB,0x2668B,0x26C9B,0x27C05,0x334C4]:
    idx=bisect.bisect_right(starts,t)-1
    if idx>=0:
        b,e=funcs[idx]
        print('0x%-6X in func 0x%-6X-0x%-6X' % (t,b,e))
