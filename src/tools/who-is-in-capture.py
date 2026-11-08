r"""Какие устройства попали в захват: VID/PID по control-транзакциям.

═══════════ ЗАЧЕМ ═══════════

В захвате 8 устройств на шине 1, но ни одного с HID-эндпоинтом 0x04/0x84.
При этом M62 висит ЗА внешним USB-хабом (ASMedia VID_174C&PID_2074,
адрес 2), а не напрямую на корневом хабе.

Гипотеза: USBPcap на корневом хабе либо не видит трафик за хабом, либо
M62 всё-таки в захвате, но под другим адресом и с другими эндпоинтами.

Этот скрипт читает control-транзакции GET_DESCRIPTOR и вытаскивает
VID/PID каждого адреса — так устройства опознаются точно.

Запуск: python src/tools/who-is-in-capture.py <файл.pcap>
"""

from __future__ import annotations

import struct
import sys
from collections import Counter, defaultdict


def read_packets(path: str):
    with open(path, "rb") as handle:
        blob = handle.read()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    offset = 24
    while offset + 16 <= len(blob):
        _, _, incl_len, _ = struct.unpack(endian + "IIII", blob[offset : offset + 16])
        offset += 16
        data = blob[offset : offset + incl_len]
        offset += incl_len
        if len(data) < 27:
            continue
        header_len = struct.unpack("<H", data[0:2])[0]
        if header_len < 27 or header_len > len(data):
            continue
        bus = struct.unpack("<H", data[17:19])[0]
        dev = struct.unpack("<H", data[19:21])[0]
        ep = data[21]
        transfer = data[22]
        data_len = struct.unpack("<I", data[23:27])[0]
        payload = data[header_len : header_len + data_len]
        yield bus, dev, ep, transfer, payload


def describe_device_descriptor(payload: bytes) -> str | None:
    """Пытается опознать дескриптор устройства USB (18 байт)."""
    if len(payload) < 18:
        return None
    if payload[1] != 0x01:  # bDescriptorType == DEVICE
        return None
    vid = struct.unpack("<H", payload[8:10])[0]
    pid = struct.unpack("<H", payload[10:12])[0]
    bcd = struct.unpack("<H", payload[12:14])[0]
    return f"VID_{vid:04X}&PID_{pid:04X} rev {bcd >> 8}.{bcd & 0xff:02x}"


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: who-is-in-capture.py <файл.pcap>")

    identity: dict[tuple[int, int], str] = {}
    stats: Counter[tuple[int, int, int, int]] = Counter()

    for bus, dev, ep, transfer, payload in read_packets(sys.argv[1]):
        stats[(bus, dev, ep, transfer)] += 1
        if ep in (0x00, 0x80) and transfer == 2:
            name = describe_device_descriptor(payload)
            if name:
                identity[(bus, dev)] = name

    print("=== ОПОЗНАННЫЕ УСТРОЙСТВА ===")
    if not identity:
        print("  не удалось прочитать ни одного дескриптора")
    for (bus, dev), name in sorted(identity.items()):
        eps = sorted(
            {f"0x{e:02x}" for (b, d, e, _) in stats if b == bus and d == dev}
        )
        total = sum(n for (b, d, _, _), n in stats.items() if b == bus and d == dev)
        print(f"  bus {bus} dev {dev:2}  {name:<34} пакетов {total:6}  ep {', '.join(eps)}")

    print("\n=== ЕСТЬ ЛИ M62 (152A:875C)? ===")
    hit = [(k, v) for k, v in identity.items() if "152A" in v.upper()]
    if hit:
        for (bus, dev), name in hit:
            print(f"  ДА: bus {bus} dev {dev} -> {name}")
    else:
        print("  НЕТ. M62 в захват не попал.")
        print("  Причина: он висит за внешним хабом (не на корневом напрямую).")

    print("\n=== HID-подобные эндпоинты (interrupt) ===")
    for (bus, dev, ep, transfer), n in sorted(stats.items()):
        if transfer == 1:
            kind = "IN" if ep & 0x80 else "OUT"
            print(f"  bus {bus} dev {dev:2}  ep 0x{ep:02x} {kind}  interrupt  {n:6} пакетов")


if __name__ == "__main__":
    main()
