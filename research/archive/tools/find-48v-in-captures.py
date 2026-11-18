r"""ЧТО MCC ШЛЁТ ПО 0x11:0x19 И 0x11:0x1a — из готовых захватов.

══════════ ЗАЧЕМ ══════════

48V читается из HID (0x11:0x19 меняется 0 -> 1 при нажатии кнопки
в MCC), но прямая запись в него не применяется. Значит либо:

  A. 0x11:0x19 — только состояние, а управление другим адресом;
  B. запись идёт в составе пакета, а не отдельным кадром.

В готовых захватах USBPcap видно ВСЁ, что MCC отправляет наружу.
Если он шлёт 0x11:0x19 (или 0x1a) — увидим это и поймём контекст.

══════════ ВАЖНО ══════════

Захваты снимались при разных состояниях 48V, но нам важно не
значение, а САМ ФАКТ отправки и соседние кадры вокруг.

Запуск: python src/tools/find-48v-in-captures.py
"""

from __future__ import annotations

import struct
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

# что ищем: свойства 0x19, 0x1a, 0x1b, 0x1e в семействе 0x11
WATCH_TT = 0x11
WATCH_PP = {0x19, 0x1A, 0x1B, 0x1E}


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
    """Отдаёт (offset, tt, pp, value) для каждого кадра в payload."""
    start = 0
    while True:
        pos = payload.find(MAGIC_HEAD, start)
        if pos < 0:
            return
        chunk = payload[pos : pos + FRAME_LEN]
        if len(chunk) == FRAME_LEN and chunk[13:15] == MAGIC_TAIL:
            yield pos, chunk[5], chunk[6], struct.unpack(">i", chunk[7:11])[0]
        start = pos + 1


def main() -> None:
    pcaps = sorted(Path("research").glob("*.pcap"))
    if not pcaps:
        raise SystemExit("нет .pcap в research/")

    grand_out: dict[int, set[int]] = {}
    grand_in: dict[int, set[int]] = {}

    for pcap in pcaps:
        out_hits: list[tuple[int, int, int]] = []
        in_hits: list[tuple[int, int, int]] = []

        for ep, payload in read_packets(pcap):
            is_in = bool(ep & 0x80)
            for off, tt, pp, val in frames(payload):
                if tt != WATCH_TT or pp not in WATCH_PP:
                    continue
                if is_in:
                    in_hits.append((pp, val, off))
                    grand_in.setdefault(pp, set()).add(val)
                else:
                    out_hits.append((pp, val, off))
                    grand_out.setdefault(pp, set()).add(val)

        if not out_hits and not in_hits:
            continue

        print(f"\n{'=' * 66}")
        print(f"{pcap.name}")
        print("=" * 66)

        if out_hits:
            print(f"  ОТПРАВЛЕНО ХОСТОМ ({len(out_hits)}):")
            for pp, val, off in out_hits[:25]:
                print(f"    0x11:0x{pp:02x} = {val}")
            if len(out_hits) > 25:
                print(f"    … ещё {len(out_hits) - 25}")
        else:
            print("  хост НЕ отправлял 0x11:0x19/1a/1b/1e")

        if in_hits:
            print(f"  ПРИШЛО ОТ УСТРОЙСТВА ({len(in_hits)}):")
            for pp, val, off in in_hits[:25]:
                print(f"    0x11:0x{pp:02x} = {val}")
            if len(in_hits) > 25:
                print(f"    … ещё {len(in_hits) - 25}")

    print("\n" + "=" * 66)
    print("ИТОГ ПО ВСЕМ ЗАХВАТАМ")
    print("=" * 66)

    all_pp = sorted(set(grand_out) | set(grand_in))
    if not all_pp:
        print("  ни в одном захвате нет 0x11:0x19/1a/1b/1e")
        print("\n  Это значит: MCC НЕ отправляет эти адреса кадрами.")
        print("  Либо 48V управляется другим адресом, либо")
        print("  приходит только как состояние (что мы и наблюдали).")
        return

    print(f"\n  {'свойство':<12} {'отправлено (значения)':<30} {'пришло (значения)'}")
    print(f"  {'-' * 12} {'-' * 30} {'-' * 20}")
    for pp in all_pp:
        o = sorted(grand_out.get(pp, set()))
        i = sorted(grand_in.get(pp, set()))
        print(f"  0x{pp:02x}         {str(o)[:28]:<30} {str(i)[:18]}")

    print("\n  Если какое-то свойство отправлялось с 0 и 1 — это кандидат")
    print("  на управление 48V. Если только приходило — это состояние.")


if __name__ == "__main__":
    main()
