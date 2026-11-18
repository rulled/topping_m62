import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")

def decode(c):
    return (c >> 16) & 0xFFFF, (c >> 2) & 0xFFF

# table 1: at 0x25BF1 base = (rip after lea). lea r8,[rip-0x25bf8] at 0x25BF1, insn len 7 -> next 0x25BF8
# r8 = 0x25BF8 - 0x25BF8 = 0x... actually rip-relative: target = next_insn + disp
def rel(nextrva, disp): return nextrva + disp
r8_1 = rel(0x25BF8, -0x25BF8)
print('table1 base rva 0x%X' % r8_1)
# eax = (ioctl + 0x7f77dffc); cmp eax,0xfc ; index byte at r8+rax+0x289c8 ; then dword at r8+idx*4+0x28968 added to r8
lo1 = -0x7f77dffc & 0xFFFFFFFF
print('ioctl low bound = 0x%X' % ((0x80882104+1) & 0xFFFFFFFF))
# eax = edx + 0x7f77dffc  => edx = eax - 0x7f77dffc = eax + 0x80882004
base_ioctl_1 = 0x80882004
for i in range(0, 0xFD):
    ioctl = base_ioctl_1 + i
    ob = pe.rva2off(r8_1 + 0x289C8 + i)
    if ob is None: continue
    idx = pe.data[ob]
    ob2 = pe.rva2off(r8_1 + 0x28968 + idx*4)
    if ob2 is None: continue
    off = struct.unpack_from('<i', pe.data, ob2)[0]
    handler = r8_1 + off
    if ioctl in (0x80882200,0x80882204,0x808820C4,0x80882004,0x808820D8,0x808820DC,0x80882214,0x80882044):
        print('  0x%08X -> idx=%d handler rva 0x%X' % (ioctl, idx, handler))
