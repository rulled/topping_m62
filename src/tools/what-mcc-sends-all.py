r"""ЧТО MCC ОТПРАВЛЯЕТ ВООБЩЕ — полный список адресов в захватах.

══════════ ЧЕМ ЭТО ПОМОЖЕТ С 48V ══════════

Установлено: MCC НИКОГДА не отправляет 0x11:0x19 (проверено по
5 захватам). Значит 48V управляется не этим адресом.

Чтобы найти настоящий, надо увидеть ВЕСЬ список того, что MCC
отправляет, и поискать там что-то, чего мы ещё не расшифровали.

══════════ ЧТО ДЕЛАЕТ ══════════

Собирает из всех захватов:
  - все адреса, которые хост ОТПРАВЛЯЛ (с набором значений);
  - все адреса, которые устройство ПРИСЫЛАЛО.

Печатает те, что отправлялись, но в нашей карте НЕ расшифрованы —
это и есть кандидаты.

Запуск: python src/tools/what-mcc-sends-all.py
"""

from __future__ import annotations

import struct
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

# Известные адреса: что уже расшифровано.
KNOWN = {
    (0x11, 0x01): "handshake",
    (0x11, 0x04): "? настройка",
    (0x11, 0x05): "save to device",
    (0x11, 0x08): "save preset",
    (0x11, 0x0e): "load preset",
    (0x11, 0x18): "счётчик сессий",
    (0x11, 0x1d): "смена режима",
    (0x11, 0x20): "bulk push",
    (0x11, 0x22): "MainButtonSingle",
    (0x11, 0x23): "MainButtonDouble",
    (0x11, 0x24): "subscribe",
    (0x11, 0x26): "announce",
    (0x21, 0x02): "IN1 ?",
    (0x21, 0x03): "IN1 ?",
    (0x21, 0x04): "громкость MIC-1",
    (0x21, 0x05): "IN1 ?",
    (0x21, 0x06): "джек IN1",
    (0x22, 0x02): "IN2 ?",
    (0x22, 0x03): "IN2 ?",
    (0x22, 0x04): "громкость MIC-2",
    (0x22, 0x05): "IN2 ?",
    (0x23, 0x04): "громкость AUX",
    (0x25, 0x04): "громкость BT",
    (0x27, 0x04): "громкость OTG",
    (0x43, 0x01): "ducking threshold",
    (0x43, 0x07): "ducking switch",
    (0x44, 0x01): "FX IN1",
    (0x44, 0x06): "NC уровень",
    (0x44, 0x07): "NC тип",
    (0x44, 0x08): "Reverb DryWet",
    (0x44, 0x09): "Reverb Room",
    (0x44, 0x0a): "Reverb Decay",
    (0x44, 0x0b): "Reverb тип",
    (0x44, 0x0c): "MuteFX",
    (0x44, 0x0f): "Reverb Width",
    (0x45, 0x01): "сцена Chat",
    (0x45, 0x02): "сцена Vocal",
    (0x46, 0x01): "компрессор switch",
    (0x46, 0x02): "threshold",
    (0x46, 0x03): "ratio",
    (0x46, 0x04): "attack",
    (0x46, 0x05): "release",
    (0x46, 0x06): "gain",
    (0x46, 0x07): "gainAuto",
    (0x46, 0x08): "mix",
    (0x51, 0x02): "LB12 источник",
    (0x51, 0x03): "LB12 gain",
    (0x61, 0x03): "громкость OTG out",
    (0x62, 0x02): "селектор OTG",
    (0x62, 0x03): "громкость OTG",
    (0x62, 0x04): "mute OTG",
    (0x63, 0x03): "громкость HP",
    (0x64, 0x02): "селектор HP",
    (0x64, 0x03): "громкость HP",
    (0x64, 0x04): "mute HP",
    (0x9b, 0x0f): "EQ IN1 switch",
    (0x9b, 0x10): "EQ IN2 switch",
}

# микшер 0x31..0x3c — все свойства это кросспойнты
def is_mixer(tt: int, pp: int) -> bool:
    return 0x31 <= tt <= 0x3C and pp != 0x15


# EQ входов 0x91..0x94 и наушников 0xa1..0xaa
def is_eq(tt: int, pp: int) -> bool:
    return (0x91 <= tt <= 0x94 or 0xA1 <= tt <= 0xAA) and 0x01 <= pp <= 0x0A


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
    sent: dict[tuple[int, int], set[int]] = {}
    recv: dict[tuple[int, int], set[int]] = {}

    for pcap in sorted(Path("research").glob("*.pcap")):
        for ep, payload in read_packets(pcap):
            is_in = bool(ep & 0x80)
            for tt, pp, val in frames(payload):
                target = recv if is_in else sent
                target.setdefault((tt, pp), set()).add(val)

    print("=" * 74)
    print("ЧТО ХОСТ ОТПРАВЛЯЕТ — ВСЁ, ЧТО ЕСТЬ В ЗАХВАТАХ")
    print("=" * 74)

    unknown_sent = []
    for (tt, pp), vals in sorted(sent.items()):
        if is_mixer(tt, pp) or is_eq(tt, pp):
            continue
        name = KNOWN.get((tt, pp))
        marks = "?" if name is None else " "
        shown = sorted(vals)[:4]
        more = f" …{len(vals)}" if len(vals) > 4 else ""
        print(f"{marks} 0x{tt:02x}:0x{pp:02x}  {str(shown):<26}{more:<6} {name or 'НЕИЗВЕСТНО'}")
        if name is None:
            unknown_sent.append((tt, pp, vals))

    print(f"\n  микшер и EQ не перечислены (их адреса都知道).")
    print(f"  НЕИЗВЕСТНЫХ адресов, которые хост ОТПРАВЛЯЕТ: {len(unknown_sent)}")

    if unknown_sent:
        print("\n" + "=" * 74)
        print("КАНДИДАТЫ: отправляются, но не расшифрованы")
        print("=" * 74)
        for tt, pp, vals in unknown_sent:
            print(f"  0x{tt:02x}:0x{pp:02x}  значения: {sorted(vals)}")

    print("\n" + "=" * 74)
    print("ЧТО УСТРОЙСТВО ПРИСЫЛАЕТ, НО ХОСТ НЕ ОТПРАВЛЯЕТ")
    print("=" * 74)
    print("  (такие адреса — только состояние, писать в них бессмысленно)")

    only_recv = []
    for (tt, pp), vals in sorted(recv.items()):
        if (tt, pp) in sent:
            continue
        if is_mixer(tt, pp) or is_eq(tt, pp):
            continue
        if pp == 0x15 or pp == 0x01:
            continue  # метры
        only_recv.append((tt, pp, vals))

    for tt, pp, vals in only_recv[:40]:
        name = KNOWN.get((tt, pp), "")
        print(f"  0x{tt:02x}:0x{pp:02x}  значения: {str(sorted(vals))[:30]:<32} {name}")
    if len(only_recv) > 40:
        print(f"  … ещё {len(only_recv) - 40}")


if __name__ == "__main__":
    main()
