"""
Поиск IOCTL-кодов в драйвере ToppingProUsbAudio.sys.

ЗАДАЧА: найти, каким кодом операции MCC передаёт данные в драйвер
(микшер, EQ, эффекты идут НЕ через HID, а через вендорский интерфейс
{E97E1508-2A66-4DF8-B7A7-32D6E5FCBA46}).

МЕТОД:
  1. разобрать PE, найти секцию кода;
  2. найти в дизассемблере места сравнения управляющего кода
     (cmp eax/ecx/edx, <imm32>) — так драйверы обычно диспетчеризуют IOCTL;
  3. отдельно найти switch по таблице переходов (jmp [rax*4+...]) —
     типичный паттерн для большого числа IOCTL;
  4. собрать все imm32 в диапазоне, характерном для IOCTL
     (FILE_DEVICE_* << 16 | ...).

НИЧЕГО не пишет в устройство. Только читает файл.
"""

import struct
import sys

import capstone
import pefile

SYS = r"C:\Windows\System32\DriverStore\FileRepository\toppingprousbaudio.inf_amd64_aa32a3c602bee5d4\ToppingProUsbAudio.sys"


def load_code():
    pe = pefile.PE(SYS, fast_load=True)
    image_base = pe.OPTIONAL_HEADER.ImageBase
    sections = []
    for s in pe.sections:
        name = s.Name.rstrip(b"\x00").decode("ascii", "replace")
        data = s.get_data()
        va = image_base + s.VirtualAddress
        sections.append({"name": name, "data": data, "va": va})
    return pe, image_base, sections


def main():
    pe, image_base, sections = load_code()
    print(f"ImageBase = 0x{image_base:X}")
    machine = pe.FILE_HEADER.Machine
    is64 = machine == 0x8664
    print(f"Machine = 0x{machine:X} ({'x64' if is64 else 'x86'})")
    for s in sections:
        print(f"  {s['name']:<10} va=0x{s['va']:08X} size=0x{len(s['data']):X}")

    md = capstone.Cs(
        capstone.CS_ARCH_X86,
        capstone.CS_MODE_64 if is64 else capstone.CS_MODE_32,
    )
    md.detail = True
    md.skipdata = True  # КРИТИЧНО: без этого обход обрывается на первом мусоре

    # --- 1. сравнения с imm32 в правдоподобном диапазоне IOCTL ---
    # IOCTL = (DeviceType << 16) | (Access << 14) | (Function << 2) | Method
    # DeviceType для вендорских драйверов часто 0x22 (FILE_DEVICE_UNKNOWN),
    # но встречаются и другие. Ищем диапазон 0x00002000..0x0000FFFF
    # по старшему слову, плюс бит 0x8000 (buffered/in/out в старом стиле).
    cmp_hits = []
    code_section = None
    for s in sections:
        if s["name"] in (".text", "PAGE", "INIT"):
            code_section = s
            break
    if code_section is None:
        code_section = max(sections, key=lambda x: len(x["data"]))
    print(f"\nосновная секция кода: {code_section['name']}")

    code = code_section["data"]
    va = code_section["va"]
    count = 0
    for ins in md.disasm(code, va):
        count += 1
        if ins.mnemonic == "cmp" and len(ins.operands) == 2:
            op = ins.operands[1]
            if op.type == capstone.x86.X86_OP_IMM:
                v = op.imm & 0xFFFFFFFF
                # правдоподобный IOCTL: старшее слово задаёт устройство
                high = v >> 16
                if 0x0001 <= high <= 0x00FF and (v & 0x3) in (0, 1, 2, 3):
                    if v >= 0x1000 and v <= 0x00FFFFFF:
                        cmp_hits.append((v, ins.address))
    print(f"инструкций разобрано: {count}")
    print(f"cmp с imm32 в диапазоне, похожем на IOCTL: {len(cmp_hits)}")

    # группируем по значению
    from collections import Counter

    c = Counter(v for v, _ in cmp_hits)
    print("\n=== наиболее частые значения в cmp (кандидаты в IOCTL) ===")
    for v, n in c.most_common(40):
        print(f"  0x{v:08X}  x{n}   (DeviceType=0x{v>>16:04X} Func=0x{(v>>2)&0xFFF:03X} Method={v&3})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
