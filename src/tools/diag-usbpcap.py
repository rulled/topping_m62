r"""Диагностика формата USBPcap: проверить разбор заголовка.

═══════════ ПРОБЛЕМА ═══════════

Захват снят (21776 пакетов), но HID-эндпоинтов 0x04/0x84 в нём нет вообще.
При этом M62 точно висит на этом корневом хабе.

Возможные причины:
  1. Смещения полей в USBPcap-заголовке прочитаны неверно (padding).
  2. M62 использует другие эндпоинты, чем мы думаем.
  3. Устройство не попало в захват (адрес/шина).

Этот скрипт печатает сырые байты заголовков и все поля как есть, чтобы
увидеть, где правда.

Запуск: python src/tools/diag-usbpcap.py <файл.pcap>
"""

from __future__ import annotations

import struct
import sys
from collections import Counter


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: diag-usbpcap.py <файл.pcap>")

    with open(sys.argv[1], "rb") as handle:
        blob = handle.read()

    magic = blob[:4]
    endian = "<" if magic == b"\xd4\xc3\xb2\xa1" else ">"
    linktype = struct.unpack(endian + "IHHiIII", blob[:24])[6]
    print(f"размер файла:   {len(blob):,} байт")
    print(f"сигнатура:      {magic.hex()}")
    print(f"linktype:       {linktype} (249 = USBPcap)")

    # --- первая запись целиком ---
    ts_sec, ts_usec, incl_len, orig_len = struct.unpack(endian + "IIII", blob[24:40])
    print(f"\nпервая запись: incl_len={incl_len} orig_len={orig_len}")
    data = blob[40 : 40 + incl_len]
    print(f"сырые первые 64 байта:")
    for row in range(0, min(64, len(data)), 16):
        chunk = data[row : row + 16]
        hexpart = " ".join(f"{b:02x}" for b in chunk)
        textpart = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        print(f"  {row:04x}  {hexpart:<47}  {textpart}")

    header_len = struct.unpack("<H", data[0:2])[0]
    print(f"\nheaderLen (LE): {header_len}")

    # --- гипотеза A: packed, без выравнивания (то, что использовал анализатор) ---
    print("\n=== гипотеза A: packed (смещения без padding) ===")
    print(f"  irpId     = {struct.unpack('<Q', data[2:10])[0]}")
    print(f"  status    = 0x{struct.unpack('<I', data[10:14])[0]:08x}")
    print(f"  function  = {struct.unpack('<H', data[14:16])[0]}")
    print(f"  info      = {data[16]}")
    print(f"  bus       = {struct.unpack('<H', data[17:19])[0]}")
    print(f"  device    = {struct.unpack('<H', data[19:21])[0]}")
    print(f"  endpoint  = 0x{data[21]:02x}")
    print(f"  transfer  = {data[22]}")
    print(f"  dataLen   = {struct.unpack('<I', data[23:27])[0]}")

    # --- гипотеза B: с выравниванием (irpId с offset 8) ---
    print("\n=== гипотеза B: с выравниванием (irpId по offset 8) ===")
    if len(data) >= 40:
        print(f"  irpId    @8  = {struct.unpack('<Q', data[8:16])[0]}")
        print(f"  headerLen проверка: data[0:2]={data[0:2].hex()}")

    # --- полная статистика по всем пакетам, packed ---
    print("\n=== статистика по всем пакетам (packed) ===")
    combos: Counter[tuple[int, int, int, int]] = Counter()
    offset = 24
    count = 0
    while offset + 16 <= len(blob):
        _, _, incl_len, _ = struct.unpack(endian + "IIII", blob[offset : offset + 16])
        offset += 16
        data = blob[offset : offset + incl_len]
        offset += incl_len
        count += 1
        if len(data) < 27:
            continue
        bus = struct.unpack("<H", data[17:19])[0]
        dev = struct.unpack("<H", data[19:21])[0]
        ep = data[21]
        tr = data[22]
        combos[(bus, dev, ep, tr)] += 1

    print(f"  всего пакетов: {count}")
    print(f"  уникальных (bus,device,endpoint,transfer): {len(combos)}")
    print("\n  bus  dev  ep    transfer            пакетов")
    for (bus, dev, ep, tr), n in combos.most_common(25):
        tname = {0: "isochronous", 1: "interrupt", 2: "control", 3: "bulk"}.get(tr, f"?{tr}")
        print(f"  {bus:4} {dev:4}  0x{ep:02x}  {tname:<19} {n:8}")

    # --- есть ли вообще устройство 1 (наш M62) ---
    print("\n=== устройства на шине ===")
    by_dev: Counter[int] = Counter()
    for (bus, dev, ep, tr), n in combos.items():
        by_dev[(bus, dev)] += n
    for (bus, dev), n in sorted(by_dev.items()):
        eps = sorted({f"0x{e:02x}" for (b, d, e, _) in combos if b == bus and d == dev})
        print(f"  bus {bus} device {dev:2}: {n:7} пакетов, endpoints {', '.join(eps)}")


if __name__ == "__main__":
    main()
