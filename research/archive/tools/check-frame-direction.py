r"""НАПРАВЛЕНИЕ КАДРОВ 0x51..0x58 — читается ли loopback обратно.

══════════ ЗАЧЕМ ══════════

Проба через HID (probe-loopback-read.js) показала, что 0x51..0x58 в IN
не приходят. Но она выполнялась в Prof-режиме, где loopback вообще
не существует. Значит вывод мог быть ложным.

Проверяем на захватах: в каком направлении идут кадры 0x51..0x58.
Если только OUT (хост -> устройство) — loopback правда write-only.
Если есть IN — читать можно, и коды источников проверяемы без админа.

Запуск: python src/tools/check-frame-direction.py
"""

from __future__ import annotations

import struct
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15


def read_packets(path: Path):
    blob = path.read_bytes()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    offset = 24
    while offset + 16 <= len(blob):
        _, _, incl_len, _ = struct.unpack(endian + "IIII", blob[offset : offset + 16])
        offset += 16
        data = blob[offset : offset + incl_len]
        offset += incl_len
        if len(data) < 27:
            continue
        hlen = struct.unpack("<H", data[0:2])[0]
        if hlen < 27 or hlen > len(data):
            continue
        # 0 = host->device, 1 = device->host
        yield data[21], data[hlen : hlen + struct.unpack("<I", data[23:27])[0]]


def frames(payload: bytes):
    start = 0
    while True:
        pos = payload.find(MAGIC_HEAD, start)
        if pos < 0:
            return
        chunk = payload[pos : pos + FRAME_LEN]
        if len(chunk) == FRAME_LEN and chunk[13:15] == MAGIC_TAIL:
            yield chunk[5], chunk[6], struct.unpack(">i", chunk[7:11])[0]
        start = pos + 1


INTERESTING = {
    "loopback 0x51..0x58": lambda tt: 0x51 <= tt <= 0x58,
    "селектор HP 0x64": lambda tt: tt == 0x64,
    "селектор OTG 0x62": lambda tt: tt == 0x62,
    "микшер 0x31..0x3c": lambda tt: 0x31 <= tt <= 0x3C,
    "EQ 0xa1..0xaa": lambda tt: 0xA1 <= tt <= 0xAA,
    "EQ входов 0x91": lambda tt: tt == 0x91,
    "ducking 0x43": lambda tt: tt == 0x43,
    "эффекты 0x44": lambda tt: tt == 0x44,
}


def main() -> None:
    pcaps = sorted(Path("research").glob("*.pcap"))
    if not pcaps:
        raise SystemExit("нет .pcap в research/")

    grand: dict[str, dict[str, int]] = {}

    for pcap in pcaps:
        per: dict[str, dict[str, int]] = {}
        for ep, payload in read_packets(pcap):
            direction = "IN (dev->host)" if ep & 0x80 else "OUT (host->dev)"
            for tt, _pp, _v in frames(payload):
                for label, pred in INTERESTING.items():
                    if pred(tt):
                        d = per.setdefault(label, {})
                        d[direction] = d.get(direction, 0) + 1
                        g = grand.setdefault(label, {})
                        g[direction] = g.get(direction, 0) + 1
        if not per:
            print(f"\n{pcap.name}: ничего из интересного")
            continue
        print(f"\n{pcap.name}:")
        for label in INTERESTING:
            if label not in per:
                continue
            counts = per[label]
            out_n = counts.get("OUT (host->dev)", 0)
            in_n = counts.get("IN (dev->host)", 0)
            verdict = "write-only" if in_n == 0 else "читается"
            print(f"  {label:<22} OUT={out_n:<7} IN={in_n:<7} {verdict}")

    print("\n" + "=" * 68)
    print("ИТОГ ПО ВСЕМ ЗАХВАТАМ")
    print("=" * 68)
    for label in INTERESTING:
        if label not in grand:
            print(f"  {label:<22} не встречалось ни разу")
            continue
        out_n = grand[label].get("OUT (host->dev)", 0)
        in_n = grand[label].get("IN (dev->host)", 0)
        verdict = "WRITE-ONLY" if in_n == 0 else "ЧИТАЕТСЯ"
        print(f"  {label:<22} OUT={out_n:<8} IN={in_n:<8} {verdict}")


if __name__ == "__main__":
    main()
