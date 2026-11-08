r"""ЧТО ИМЕННО ПРИХОДИТ ОТ УСТРОЙСТВА — по TT:PP, без агрегации.

══════════ ЗАЧЕМ ══════════

Предыдущая проверка агрегировала по семейству TT и дала ложную картину:
«микшер 0x31..0x3c читается, IN=6753». На самом деле в IN приходят
МЕТРЫ (PP=0x15), а не кросспойнты. Надо смотреть по конкретным TT:PP.

Задача: понять, читается ли 0x51:0x02 (код источника loopback) и
0x64:0x02 / 0x62:0x02 (селекторы выходов) от устройства к хосту.

Запуск: python src/tools/check-exact-direction.py
"""

from __future__ import annotations

import struct
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

WATCH = [
    (0x51, 0x02, "loopback LB12 источник"),
    (0x51, 0x03, "loopback LB12 gain"),
    (0x53, 0x02, "loopback LB34 источник"),
    (0x64, 0x02, "селектор HP"),
    (0x64, 0x03, "громкость HP"),
    (0x62, 0x02, "селектор OTG"),
    (0x62, 0x03, "громкость OTG"),
    (0x33, 0x15, "метр Mix B L"),
    (0x31, 0x01, "кросспойнт PB12 -> Mix A"),
    (0x9B, 0x01, "0x9b:01"),
]


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


def main() -> None:
    counts: dict[tuple[int, int], dict[str, int]] = {}

    for pcap in sorted(Path("research").glob("*.pcap")):
        for ep, payload in read_packets(pcap):
            direction = "IN" if ep & 0x80 else "OUT"
            for tt, pp, _v in frames(payload):
                key = (tt, pp)
                if key not in {(t, p) for t, p, _ in WATCH}:
                    continue
                d = counts.setdefault(key, {})
                d[direction] = d.get(direction, 0) + 1

    print("=" * 74)
    print(f"{'адрес':<12} {'что это':<28} {'OUT':>6} {'IN':>6}  вердикт")
    print("=" * 74)
    for tt, pp, label in WATCH:
        d = counts.get((tt, pp), {})
        out_n = d.get("OUT", 0)
        in_n = d.get("IN", 0)
        if not d:
            verdict = "не встречалось"
        elif in_n and out_n:
            verdict = "читается и пишется"
        elif in_n:
            verdict = "ТОЛЬКО ЧИТАЕТСЯ"
        else:
            verdict = "ТОЛЬКО ПИШЕТСЯ"
        print(f"0x{tt:02x}:0x{pp:02x}   {label:<28} {out_n:>6} {in_n:>6}  {verdict}")

    print()
    print("Вывод: если у 0x51:0x02 IN=0 — код источника loopback прочитать")
    print("нельзя ни при каких условиях, только записать.")


if __name__ == "__main__":
    main()
