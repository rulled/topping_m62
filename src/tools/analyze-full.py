r"""Полный разбор одного захвата: источники, выходы, ducking, OTGIN.

═══════════ ЧТО ИЗВЛЕКАЕТ ═══════════

1. КОДЫ ИСТОЧНИКОВ из loopback-слотов (свойство 0x02 = код).
2. КОДЫ ИСТОЧНИКОВ из выходов (0x61/0x63 OTG, 0x62/0x64 HP).
3. МАСКИ DUCKING (какие из 0x43:05/06 меняются).
4. МАТРИЦА МИКШЕРА (подтверждение известной карты).
5. GAIN выходов и loopback в Q25.

Запуск: python src/tools/analyze-full.py <файл.pcap> [dev]
"""

from __future__ import annotations

import math
import struct
import sys

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25

# что мы подставили в слоты (из run-full.ps1)
LOOPBACK_EXPECT = {
    0x51: "IN 1",
    0x53: "IN 2",
    0x55: "Playback 3/4",
    0x57: "Playback 9/10",
}
OUTPUT_EXPECT = {
    "OTG OUT": "BT",
    "HP": "AUX",
}

MIX_B_EXPECT = {
    "IN12": -11, "AUX": -12, "BT": -13, "FX": -14, "PB12": -15,
    "PB34": -16, "PB56": -17, "PB78": -18, "PB910": -19,
}


def q25_to_db(v: int) -> float:
    return -999.0 if v == 0 else 20 * math.log10(v / Q25_UNITY)


def db_to_q25(db: float) -> int:
    return round(math.pow(10, db / 20) * Q25_UNITY)


def read_packets(path: str, want_dev: int):
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
        hlen = struct.unpack("<H", data[0:2])[0]
        if hlen < 27 or hlen > len(data):
            continue
        if struct.unpack("<H", data[19:21])[0] != want_dev:
            continue
        yield data[21], data[hlen : hlen + struct.unpack("<I", data[23:27])[0]]


def frames(payload: bytes):
    out = []
    start = 0
    while True:
        pos = payload.find(MAGIC_HEAD, start)
        if pos < 0:
            break
        chunk = payload[pos : pos + FRAME_LEN]
        if len(chunk) == FRAME_LEN and chunk[13:15] == MAGIC_TAIL:
            out.append((chunk[5], chunk[6], struct.unpack(">i", chunk[7:11])[0]))
        start = pos + 1
    return out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: analyze-full.py <файл.pcap> [dev]")
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    out: dict[int, dict[int, int]] = {}
    for ep, payload in read_packets(sys.argv[1], dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            out.setdefault(tt, {})[pp] = value

    if not out:
        print("кадров M62 не найдено")
        return

    print(f"групп с данными: {len(out)}")

    # ═══ 1. КОДЫ ИСТОЧНИКОВ ИЗ LOOPBACK ═══
    print("\n" + "=" * 70)
    print("1. КОДЫ ИСТОЧНИКОВ (loopback)")
    print("=" * 70)
    codes: dict[str, int] = {}
    for group, name in LOOPBACK_EXPECT.items():
        d = out.get(group, {})
        code = d.get(0x02)
        gain = d.get(0x03)
        if code is None and gain is None:
            print(f"\n  0x{group:02x} [{name}]: данных нет")
            continue
        print(f"\n  0x{group:02x}  подставили: {name}")
        if code is not None:
            print(f"       0x02 = {code}  -> КОД ИСТОЧНИКА")
            codes[name] = code
        if gain is not None:
            print(f"       0x03 = {gain}  ({q25_to_db(gain):+.2f} дБ)")

    # ═══ 2. ВЫХОДЫ ═══
    print("\n" + "=" * 70)
    print("2. ВЫХОДЫ (HP, OTG OUT)")
    print("=" * 70)
    output_tags = {
        "OTG OUT": (0x61, 0x62),
        "HP": (0x63, 0x64),
    }
    for name, groups in output_tags.items():
        print(f"\n  {name}  (подставили: {OUTPUT_EXPECT[name]})")
        for g in groups:
            d = out.get(g, {})
            if not d:
                continue
            parts = " ".join(f"0x{p:02x}={d[p]}" for p in sorted(d))
            print(f"       0x{g:02x}: {parts}")

    # ═══ 3. DUCKING ═══
    print("\n" + "=" * 70)
    print("3. DUCKING (0x43)")
    print("=" * 70)
    duck = out.get(0x43, {})
    if duck:
        known = {1: "Threshold", 2: "Attack", 3: "Reduction", 4: "Release",
                 5: "маска ?", 6: "маска ?", 7: "DuckingSwitch"}
        for p in sorted(duck):
            lbl = known.get(p, "?")
            print(f"     0x43:{p:02x} = {duck[p]:6}  {lbl}")
    else:
        print("  нет данных")

    # ═══ 4. МИКШЕР ═══
    print("\n" + "=" * 70)
    print("4. МИКШЕР — подтверждение карты")
    print("=" * 70)
    exp = {n: db_to_q25(d) for n, d in MIX_B_EXPECT.items()}
    found: dict[str, int] = {}
    for group in (0x33, 0x34):
        d = out.get(group, {})
        if not d:
            continue
        print(f"\n  0x{group:02x}:")
        for p in sorted(d):
            v = d[p]
            if not v:
                continue
            best, berr = None, 7
            for nm, want in exp.items():
                e = abs(v - want)
                if e < berr:
                    berr, best = e, nm
            db = q25_to_db(v)
            if best:
                print(f"     0x{p:02x} = {v:9} ({db:+7.2f})  -> {best}")
                found.setdefault(best, p)
            else:
                print(f"     0x{p:02x} = {v:9} ({db:+7.2f})  -> ?")

    # ═══ 5. ИТОГ ═══
    print("\n" + "=" * 70)
    print("ИТОГ: КОНСТАНТЫ")
    print("=" * 70)

    if codes:
        print("\n// Коды источников")
        print("export const SOURCE_CODES = {")
        for name, code in sorted(codes.items(), key=lambda x: x[1]):
            key = "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")
            key = key.replace("__", "_")
            print(f"  {key:16}: {code},")
        print("};")
    else:
        print("\n  коды источников не получены")

    if found:
        print("\n// Микшер: источник -> свойство (подтверждено)")
        print("export const MIXER_SOURCES = {")
        for n in MIX_B_EXPECT:
            if n in found:
                p = found[n]
                pl = p if p % 2 == 1 else p - 1
                print(f"  {n.lower():8}: 0x{pl:02x},")
        print("};")

    # ═══ 6. что осталось ═══
    print("\n" + "=" * 70)
    print("ЧЕГО ЕЩЁ НЕТ")
    print("=" * 70)
    missing = [n for n in MIX_B_EXPECT if n not in found]
    if missing:
        print(f"  источники без подтверждения в микшере: {', '.join(missing)}")
    slots = set(LOOPBACK_EXPECT.values())
    print(f"  кодов получено: {len(codes)} из {len(LOOPBACK_EXPECT)}")
    print("  для остальных источников нужен ещё один прогон с другими значениями")


if __name__ == "__main__":
    main()
