r"""Разбор трафика M62 из USBPcap: найти кадры микшера.

═══════════ ЧТО ИСПРАВЛЕНО ═══════════

Первая версия анализатора искала эндпоинты 0x04/0x84 и не находила
ничего. Оказалось, M62 использует ДРУГИЕ эндпоинты:

    ep 0x02 OUT  interrupt    22 пакета   (наши записи в устройство)
    ep 0x83 IN   interrupt 16598 пакетов (поток от устройства)

Вероятно, Windows перенумеровала их при композитной сборке — номера
эндпоинтов не совпадают с тем, что в дескрипторе интерфейса 4.

═══════════ ЧТО ИЩЕМ ═══════════

Кадр M62: 22 33 20 01 01 TT PP <s32 BE> <crc16> 66 77

OUT-кадров всего 22 — это и есть то, что MCC отправил за время захвата.
Надо посмотреть их ВСЕ и найти среди них микшер (0x31..0x36).

Запуск: python src/tools/analyze-m62.py <файл.pcap> [dev=6]
"""

from __future__ import annotations

import struct
import sys
from collections import Counter

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15


def read_packets(path: str, want_dev: int):
    with open(path, "rb") as handle:
        blob = handle.read()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    offset = 24
    while offset + 16 <= len(blob):
        ts_sec, ts_usec, incl_len, _ = struct.unpack(
            endian + "IIII", blob[offset : offset + 16]
        )
        offset += 16
        data = blob[offset : offset + incl_len]
        offset += incl_len
        if len(data) < 27:
            continue
        header_len = struct.unpack("<H", data[0:2])[0]
        if header_len < 27 or header_len > len(data):
            continue
        dev = struct.unpack("<H", data[19:21])[0]
        if dev != want_dev:
            continue
        ep = data[21]
        transfer = data[22]
        data_len = struct.unpack("<I", data[23:27])[0]
        payload = data[header_len : header_len + data_len]
        yield (ts_sec + ts_usec / 1e6, ep, transfer, payload)


def extract_frames(payload: bytes):
    out = []
    start = 0
    while True:
        pos = payload.find(MAGIC_HEAD, start)
        if pos < 0:
            break
        chunk = payload[pos : pos + FRAME_LEN]
        if len(chunk) == FRAME_LEN and chunk[13:15] == MAGIC_TAIL:
            tt = chunk[5]
            pp = chunk[6]
            value = struct.unpack(">i", chunk[7:11])[0]
            out.append((tt, pp, value))
        start = pos + 1
    return out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: analyze-m62.py <файл.pcap> [dev]")
    path = sys.argv[1]
    want_dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    outs = []
    ins = []
    raw_out_payloads = []

    for ts, ep, transfer, payload in read_packets(path, want_dev):
        frames = extract_frames(payload)
        if ep & 0x80:
            for tt, pp, value in frames:
                ins.append((ts, tt, pp, value))
        else:
            raw_out_payloads.append((ts, ep, payload))
            for tt, pp, value in frames:
                outs.append((ts, tt, pp, value))

    print(f"устройство dev {want_dev}")
    print(f"OUT-пакетов: {len(raw_out_payloads)}")
    print(f"кадров M62 в OUT: {len(outs)}")
    print(f"кадров M62 в IN:  {len(ins)}")

    if not outs:
        print("\n=== сырые OUT-payload'ы (кадров не нашлось) ===")
        for ts, ep, payload in raw_out_payloads[:25]:
            print(f"  ep 0x{ep:02x}  {len(payload):3} байт  {payload[:40].hex()}")
        return

    print("\n=== ВСЕ OUT-КАДРЫ (то, что MCC пишет) ===")
    t0 = outs[0][0]
    for ts, tt, pp, value in outs:
        mark = "  <-- МИКШЕР" if 0x31 <= tt <= 0x36 else ""
        print(f"  {(ts - t0) * 1000:9.1f} мс  0x{tt:02x}:0x{pp:02x} = {value}{mark}")

    fam = Counter(tt for _, tt, _, _ in outs)
    print("\n=== семейства OUT ===")
    for tt, n in fam.most_common():
        print(f"  0x{tt:02x}: {n}")

    mixer = [f for f in outs if 0x31 <= f[1] <= 0x36]
    print(f"\n=== МИКШЕР (0x31..0x36): {len(mixer)} кадров ===")
    if mixer:
        by_tag: dict[str, list[int]] = {}
        for _, tt, pp, value in mixer:
            by_tag.setdefault(f"0x{tt:02x}:0x{pp:02x}", []).append(value)
        for tag in sorted(by_tag):
            print(f"  {tag}  значения: {sorted(set(by_tag[tag]))[:15]}")
    else:
        print("  кадров микшера нет")
        print("  => MCC не шлёт 0x31..0x36 вовсе. Микшер идёт другим путём.")

    # все семейства из IN, для полноты
    fam_in = Counter(tt for _, tt, _, _ in ins)
    print("\n=== семейства IN (первые 15) ===")
    for tt, n in fam_in.most_common(15):
        print(f"  0x{tt:02x}: {n}")


if __name__ == "__main__":
    main()
