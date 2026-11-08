import sys, struct
sys.path.insert(0, r"E:\Programming shit\Topping\_re")
from pe import PE
dll = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll")
drv = PE(r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudio.sys")
# license feature-bit test in get: mov eax,[rsi+0x120]; shr rax,0x13; test al,1
print('DLL exports with Dsp:', [n for n in dll.exports if 'Dsp' in n])
print('DLL exports with Vendor:', [n for n in dll.exports if 'Vendor' in n])
print('DLL exports with Extended:', [n for n in dll.exports if 'Extended' in n])
# confirm ioctl immediates in DLL text
for con in (0x80882200,0x80882204,0x80882086,0x80882081,0x808820C4,0x808820D8):
    pat = struct.pack('<I', con)
    print('  DLL 0x%08X hits: %d' % (con, dll.data.count(pat)))
