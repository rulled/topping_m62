r"""Разбор USBPcap-дампа: вытащить наши HID-кадры и найти микшер.

═══════════ ЗАЧЕМ ═══════════

Микшер (0x31..0x36) — единственное крупное белое пятно. Устройство не
отдаёт кросспоины ни в дампе состояния, ни эхом после записи. Значит
узнать настоящие адреса можно только подсмотрев, что шлёт сам MCC, когда
пользователь двигает слайдер.

USBPcap пишет pcap (не pcapng) с собственным заголовком пакета.
Формат: pcap global header (24 байта) + записи (16 байт заголовок +
данные). В данных — USBPcap header:
    uint16 headerLen
    uint64 irpId
    uint32 status
    uint16 function
    uint8  info
    uint16 bus
    uint16 device
    uint8  endpoint
    uint8  transfer
    uint32 dataLength
    ... (опционально: iso/isoc)

transfer: 0=isochronous, 1=interrupt, 2=control, 3=bulk
Нас интересуют interrupt/control на endpoint 0x04 (OUT) и 0x84 (IN).

═══════════ ЧТО ИЩЕМ ═══════════

Кадр M62: 22 33 20 01 01 TT PP <s32 BE> <crc16> 66 77

Собираем все кадры, где TT в 0x31..0x36 (микшер) ИЛИ которые встретились
рядом с ними по времени. Это даст пары «действие -> значения».

Запуск: python src/tools/analyze-usbpcap.py <файл.pcap>
"""

from __future__ import annotations

import struct
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass


MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15


@dataclass
class UsbPacket:
    """Один USB-пакет из захвата."""

    index: int
    timestamp: float
    endpoint: int
    transfer: int
    direction: str
    payload: bytes


def read_pcap(path: str) -> tuple[list[UsbPacket], int]:
    """Читает pcap и возвращает список пакетов и номер шины USB."""
    with open(path, "rb") as handle:
        blob = handle.read()

    if len(blob) < 24:
        raise SystemExit("файл слишком мал для pcap")

    magic = blob[:4]
    if magic == b"\xd4\xc3\xb2\xa1":
        endian = "<"
    elif magic == b"\xa1\xb2\xc3\xd4":
        endian = ">"
    elif magic == b"\x4d\x3c\xb2\xa1":
        raise SystemExit("это pcapng, а не pcap — USBPcapCMD пишет pcap")
    else:
        raise SystemExit(f"неизвестная сигнатура pcap: {magic.hex()}")

    _, _, _, _, _, _, linktype = struct.unpack(endian + "IHHiIII", blob[:24])
    if linktype != 249:
        print(f"предупреждение: linktype={linktype}, ожидался 249 (USBPcap)")

    packets: list[UsbPacket] = []
    offset = 24
    index = 0
    while offset + 16 <= len(blob):
        ts_sec, ts_usec, incl_len, _ = struct.unpack(
            endian + "IIII", blob[offset : offset + 16]
        )
        offset += 16
        data = blob[offset : offset + incl_len]
        offset += incl_len
        index += 1

        if len(data) < 27:
            continue

        header_len = struct.unpack("<H", data[0:2])[0]
        if header_len < 27 or header_len > len(data):
            continue

        # irpId(8) status(4) function(2) info(1) bus(2) device(2) endpoint(1)
        # transfer(1) dataLength(4)
        endpoint = data[21]
        transfer = data[22]
        data_len = struct.unpack("<I", data[23:27])[0]

        payload = data[header_len : header_len + data_len]
        direction = "in" if endpoint & 0x80 else "out"

        packets.append(
            UsbPacket(
                index=index,
                timestamp=ts_sec + ts_usec / 1e6,
                endpoint=endpoint,
                transfer=transfer,
                direction=direction,
                payload=payload,
            )
        )

    return packets, linktype


def extract_frames(payload: bytes) -> list[tuple[int, int, int]]:
    """Ищет в payload кадры M62. Возвращает (TT, PP, value)."""
    found: list[tuple[int, int, int]] = []
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
            found.append((tt, pp, value))
        start = pos + 1
    return found


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: analyze-usbpcap.py <файл.pcap>")

    path = sys.argv[1]
    packets, _ = read_pcap(path)
    print(f"пакетов в файле: {len(packets)}")

    # только HID-интерфейс 4: endpoint 0x04 (OUT) и 0x84 (IN)
    hid = [p for p in packets if p.endpoint in (0x04, 0x84)]
    print(f"пакетов HID (ep 0x04/0x84): {len(hid)}")

    if not hid:
        eps = Counter(p.endpoint for p in packets)
        print("HID-пакетов нет. Все endpoint'ы в файле:")
        for ep, count in eps.most_common(12):
            print(f"  0x{ep:02x}: {count}")
        return

    out_frames: list[tuple[float, int, int, int]] = []
    in_frames: list[tuple[float, int, int, int]] = []

    for packet in hid:
        for tt, pp, value in extract_frames(packet.payload):
            target = out_frames if packet.direction == "out" else in_frames
            target.append((packet.timestamp, tt, pp, value))

    print(f"кадров M62 наружу (OUT): {len(out_frames)}")
    print(f"кадров M62 внутрь (IN):  {len(in_frames)}")

    # --- какие семейства слал MCC ---
    fam_out = Counter(tt for _, tt, _, _ in out_frames)
    fam_in = Counter(tt for _, tt, _, _ in in_frames)
    print("\nсемейства OUT (что MCC пишет):")
    for tt, count in fam_out.most_common():
        print(f"  0x{tt:02x}: {count}")
    print("\nсемейства IN (что устройство отдаёт):")
    for tt, count in fam_in.most_common():
        print(f"  0x{tt:02x}: {count}")

    # --- микшер ---
    mixer = [(t, tt, pp, v) for t, tt, pp, v in out_frames if 0x31 <= tt <= 0x36]
    print(f"\n=== МИКШЕР: {len(mixer)} кадров 0x31..0x36 ===")
    if mixer:
        by_tag: dict[str, list[int]] = defaultdict(list)
        for _, tt, pp, value in mixer:
            by_tag[f"0x{tt:02x}:0x{pp:02x}"].append(value)
        for tag in sorted(by_tag):
            values = by_tag[tag]
            uniq = sorted(set(values))
            print(f"  {tag}  n={len(values):4}  значения: {uniq[:12]}")
    else:
        print("  кадров микшера НЕТ в этом захвате")

    # --- контекст вокруг микшера ---
    if mixer:
        print("\n=== контекст: что шло в те же 50 мс ===")
        first = mixer[0][0]
        nearby = [f for f in out_frames if abs(f[0] - first) < 0.05]
        print(f"  всего кадров в окне: {len(nearby)}")
        for t, tt, pp, value in nearby[:40]:
            rel = (t - first) * 1000
            print(f"    {rel:+7.1f} мс  OUT 0x{tt:02x}:0x{pp:02x} = {value}")

    # --- все OUT-кадры подряд (для diff) ---
    print("\n=== все OUT-кадры (первые 80) ===")
    t0 = out_frames[0][0] if out_frames else 0
    for t, tt, pp, value in out_frames[:80]:
        print(f"  {(t - t0) * 1000:9.1f} мс  0x{tt:02x}:0x{pp:02x} = {value}")


if __name__ == "__main__":
    main()
