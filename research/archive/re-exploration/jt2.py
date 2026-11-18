import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
pe = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
# second table: lea r8,[rip-0x26f06] at rva 0x26EFF, insn len 7 -> next 0x26F06
r8_2 = 0x26F06 - 0x26F06   # = 0
print('table2 base = 0x%X' % r8_2)
base_ioctl_2 = 0x80882210 - 0xFFFFFFFF + 0xFFFFFFFF  # placeholder
# edx > 0x80882104 ; lea eax,[rdx+0x7f77def8] => eax = edx - 0x80882108
base_ioctl_2 = 0x80882108
for i in range(0, 0xFD):
    ioctl = base_ioctl_2 + i
    ob = pe.rva2off(r8_2 + 0x28B10 + i)
    if ob is None: continue
    idx = pe.data[ob]
    ob2 = pe.rva2off(r8_2 + 0x28AC8 + idx*4)
    if ob2 is None: continue
    off = struct.unpack_from('<i', pe.data, ob2)[0]
    handler = r8_2 + off
    if ioctl in (0x80882200,0x80882204,0x80882208,0x8088220C,0x80882210,0x80882214,0x80882218):
        print('  0x%08X -> idx=%d handler rva 0x%X' % (ioctl, idx, handler))
