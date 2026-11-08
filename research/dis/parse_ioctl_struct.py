"""
Разбор структуры, которую DLL шлёт в IOCTL 0x80882086 (18 байт? 0x18=24).

Из дизассемблера (0x18000A07F..0x18000A0EE):

    mov  word  [rsp+0x65], r11w     ; +0x15..0x16
    mov  byte  [rsp+0x67], r11b     ; +0x17
    mov  dword [rsp+0x58], 1        ; +0x08..0x0B = 1
    mov  dword [rsp+0x60], edx      ; +0x10..0x13 = edx
    mov  byte  [rsp+0x64], r8b      ; +0x14
    mov  word  [rsp+0x68], r9w      ; +0x18..0x19
    lea  r8, [rsp+0x58]             ; inBuf
    mov  r9d, 0x18                  ; inSize = 24
    mov  edx, 0x80882086            ; IOCTL
    call 0x180003FB0                ; DeviceIoControl

База структуры = rsp+0x58, размер 24 (до rsp+0x70).

  off  size  содержимое
  0x00  4     ? (не видно в этом фрагменте)
  0x04  4     ?
  0x08  4     1                        <- константа
  0x0C  4     ?
  0x10  4     edx (параметр функции)
  0x14  1     r8b
  0x15  2     r11w
  0x17  1     r11b
  0x18  2     r9w   (выходит за 24? -> 0x18 = конец, значит 24 покрывает 0x00..0x17)

Нужно посмотреть НАЧАЛО функции, чтобы увидеть 0x00..0x07.

Только чтение файла.
"""

import sys

import capstone
import pefile

DLL = r"C:\Program Files\TOPPING Pro\USB Audio Device Driver\x64\ToppingProUsbAudioapi_x64.dll"


def main():
    pe = pefile.PE(DLL, fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXPORT"]]
    )
    base = pe.OPTIONAL_HEADER.ImageBase
    text = next(s for s in pe.sections if s.Name.rstrip(b"\x00") == b".text")
    code = text.get_data()
    tva = base + text.VirtualAddress

    # адрес функции, содержащей 0x18000A0DF — найдём её начало
    # (ближайший предшествующий int3-разделитель или push-пролог)
    target = 0x18000A0DF
    off = target - tva
    # ищем назад начало функции
    start_off = off
    for i in range(off, max(0, off - 0x600), -1):
        # int3 (0xCC) несколько подряд = граница функции
        if code[i] == 0xCC and code[i + 1] == 0xCC:
            start_off = i + 1
            break

    start_va = tva + start_off
    print(f"начало функции: 0x{start_va:X} (искали от 0x{target:X})")

    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True

    print("\n=== функция целиком (до 120 инструкций) ===")
    n = 0
    for ins in md.disasm(code[start_off: start_off + 0x300], start_va):
        mark = ""
        if "[rsp + 0x5" in ins.op_str or "[rsp + 0x6" in ins.op_str:
            mark = "   <-- структура inBuf"
        if "0x80882086" in ins.op_str:
            mark = "   <-- IOCTL"
        print(f"  0x{ins.address:X}: {ins.mnemonic:<8} {ins.op_str}{mark}")
        n += 1
        if n > 120:
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
