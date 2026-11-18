r"""ЧТО MCC ОТПРАВИЛ В УСТРОЙСТВО при тестовом захвате.

══════════ ЗАЧЕМ ══════════

После capture-source-codes.ps1 в INI были тестовые значения
(шесть слотов с другими источниками, все заглушены). INI восстановлен,
но устройство могло остаться с тем, что в него записал MCC.

Скрипт печатает из захвата ВСЁ, что хост отправил по адресам выходов
и loopback — чтобы понять, в каком состоянии устройство осталось.

Запуск: python src/tools/what-mcc-sent.py
"""

from __future__ import annotations

import struct
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25

PCAP = Path("research/source-codes.pcap")

SOURCE_NAMES = {
    0: "Unknown", 1: "Mix A", 2: "Mix B", 3: "Mix C",
    6: "IN 1", 7: "IN 2", 8: "IN 1+2", 9: "AUX", 10: "BT",
    11: "OTG IN", 12: "Playback 1/2", 13: "Playback 3/4",
    14: "Playback 5/6", 15: "Playback 7/8", 16: "Playback 9/10",
    17: "FX",
}

LABELS = {
    (0x51, 0x02): "LB12 источник",
    (0x51, 0x03): "LB12 gain",
    (0x51, 0x04): "LB12 mute?",
    (0x52, 0x03): "LB12R gain",
    (0x53, 0x02): "LB34 источник",
    (0x53, 0x03): "LB34 gain",
    (0x54, 0x03): "LB34R gain",
    (0x55, 0x02): "LB56 источник",
    (0x55, 0x03): "LB56 gain",
    (0x56, 0x03): "LB56R gain",
    (0x57, 0x02): "LB78 источник",
    (0x57, 0x03): "LB78 gain",
    (0x58, 0x03): "LB78R gain",
    (0x64, 0x02): "HP источник",
    (0x64, 0x03): "HP громкость",
    (0x64, 0x04): "HP mute",
    (0x62, 0x02): "OTG источник",
    (0x62, 0x03): "OTG громкость",
    (0x62, 0x04): "OTG mute",
}


def read_packets(path: Path):
    blob = path.read_bytes()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    off = 24
    while off + 16 <= len(blob):
        _, _, incl, _ = struct.unpack(endian + "IIII", blob[off : off + 16])
        off += 16
        data = blob[off : off + incl]
        off += incl
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
    if not PCAP.exists():
        raise SystemExit(f"нет файла: {PCAP}")

    # последнее значение, которое ХОСТ отправил (OUT) по каждому адресу
    sent: dict[tuple[int, int], int] = {}
    read_back: dict[tuple[int, int], int] = {}

    for ep, payload in read_packets(PCAP):
        is_in = bool(ep & 0x80)
        for tt, pp, v in frames(payload):
            if 0x51 <= tt <= 0x58 or tt in (0x61, 0x62, 0x63, 0x64):
                if is_in:
                    read_back[(tt, pp)] = v
                else:
                    sent[(tt, pp)] = v

    print("=" * 74)
    print("ЧТО ХОСТ ОТПРАВИЛ (OUT) — это и есть состояние устройства после теста")
    print("=" * 74)
    for (tt, pp), v in sorted(sent.items()):
        label = LABELS.get((tt, pp), "?")
        extra = ""
        if pp == 0x02:
            extra = f"  -> {SOURCE_NAMES.get(v, f'?{v}')}"
        elif pp == 0x03:
            extra = "  (Q25 gain)"
        print(f"  0x{tt:02x}:0x{pp:02x}  {label:<18} = {v}{extra}")

    print()
    print("=" * 74)
    print("ЧТО УСТРОЙСТВО СООБЩИЛО ОБРАТНО (IN)")
    print("=" * 74)
    if not read_back:
        print("  ничего — эти адреса write-only (подтверждено)")
    for (tt, pp), v in sorted(read_back.items()):
        print(f"  0x{tt:02x}:0x{pp:02x} = {v}")

    print()
    print("=" * 74)
    print("ВЫВОД")
    print("=" * 74)
    muted = [k for k, v in sent.items() if k[1] == 0x04 and v == 1]
    if muted:
        print("  Тест ГЛУШИЛ слоты (mute=1):")
        for tt, pp in muted:
            print(f"    0x{tt:02x}:0x{pp:02x}")
        print("  -> устройство осталось с заглушёнными выходами,")
        print("     пока MCC не получит восстановленный INI заново.")
    else:
        print("  Тест не оставил mute=1 — слоты не заглушены.")


if __name__ == "__main__":
    main()
