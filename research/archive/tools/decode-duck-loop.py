r"""Ducking и Loopback — расшифровка по INI + захвату. Админ НЕ нужен.

═══════════ ОТКРЫТИЕ ═══════════

Секции [Ducking] и [Loopback_*] в workspace-INI содержат ВСЕ параметры
с человеческими именами. А в захвате есть их теги. Сопоставляем по
значениям — и получаем карту без единого нового захвата.

═══════════ ПРОВЕРКА ═══════════

Ducking (из INI и из захвата):
    Threshold=-30   Attack=200   Reduction=16   Release=1000
    DuckingSwitch=0

Loopback:
    LB12: AudioSource=FX,     GAIN=0,   MUTE=false
    LB34: AudioSource=Mix A,  GAIN=-90, MUTE=true

Запуск: python src/tools/decode-duck-loop.py <файл.pcap> [dev]
"""

from __future__ import annotations

import math
import re
import struct
import sys
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25

INI = Path(
    r"C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Live\M62_Live_main2.ini"
)


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


def read_ini() -> dict[str, dict[str, str]]:
    if not INI.exists():
        return {}
    txt = INI.read_text(encoding="utf-8-sig")
    out: dict[str, dict[str, str]] = {}
    cur = None
    for line in txt.splitlines():
        t = line.strip()
        if t.startswith("["):
            cur = t[1:-1]
            out[cur] = {}
            continue
        if not cur or not t:
            continue
        eq = t.find("=")
        if eq > 0:
            out[cur][t[:eq].strip()] = t[eq + 1 :].strip()
    return out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: decode-duck-loop.py <файл.pcap> [dev]")
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    frames_out: dict[int, dict[int, int]] = {}
    for ep, payload in read_packets(sys.argv[1], dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            frames_out.setdefault(tt, {})[pp] = value

    print("=" * 68)
    print("DUCKING (0x43)")
    print("=" * 68)

    duck = frames_out.get(0x43, {})
    ini = read_ini()
    ini_duck = ini.get("Ducking", {})

    print("\n  из захвата:")
    for prop in sorted(duck):
        print(f"    0x43:{prop:02x} = {duck[prop]}")

    print("\n  из INI:")
    for key in ("DuckingSwitch", "Threshold", "Attack", "Reduction", "Release"):
        if key in ini_duck:
            print(f"    {key:15} = {ini_duck[key]}")

    # сопоставление по значению
    print("\n  СОПОСТАВЛЕНИЕ ПО ЗНАЧЕНИЮ:")
    mapping_duck: dict[str, int] = {}
    for prop in sorted(duck):
        value = duck[prop]
        found = None
        for key in ("DuckingSwitch", "Threshold", "Attack", "Reduction", "Release"):
            try:
                if int(ini_duck.get(key, "x")) == value:
                    found = key
                    break
            except ValueError:
                continue
        mark = f"-> {found}" if found else "-> ? (маска каналов?)"
        print(f"    0x43:{prop:02x} = {value:6}  {mark}")
        if found:
            mapping_duck.setdefault(found, prop)

    print("\n" + "=" * 68)
    print("LOOPBACK (0x51..0x58)")
    print("=" * 68)

    # какие источники упоминаются в loopback-секциях
    sources = set()
    for sec, kv in ini.items():
        if sec.startswith("Loopback_"):
            sources.add(kv.get("AudioSource", "?"))

    print(f"\n  источники в INI: {sorted(sources)}")

    for group in (0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58):
        if group not in frames_out:
            continue
        vals = frames_out[group]
        pair = (group - 0x51) // 2
        sec = f"Loopback_LB{[12, 34, 56, 78][pair]}"
        kv = ini.get(sec, {})
        parts = " ".join(f"0x{p:02x}={vals[p]}" for p in sorted(vals))
        print(f"\n  0x{group:02x}  [{sec}]  {parts}")
        if kv:
            print(f"        INI: AudioSource={kv.get('AudioSource')} GAIN={kv.get('GAIN')} MUTE={kv.get('MUTE')}")

    # --- гипотеза о loopback ---
    print("\n" + "=" * 68)
    print("ГИПОТЕЗА ПО LOOPBACK")
    print("=" * 68)
    print("""
    В захвате у каждой пары два свойства: 0x02 и 0x03.
    LB12 имеет AudioSource=FX и GAIN=0 (unity), MUTE=false -> 0x51:0x02=17, 0x51:0x03=33554432
    LB34 имеет AudioSource=Mix A и GAIN=-90 (mute) -> 0x53:0x02=1,  0x53:0x03=0

    Значит:
        0x02 = КОД ИСТОЧНИКА   (Mix A = 1, FX = 17)
        0x03 = GAIN в Q25      (33554432 = 0 dB, 0 = mute)
    """)

    # --- карта кодов источников ---
    print("=" * 68)
    print("КОДЫ ИСТОЧНИКОВ (для селекторов выхода и loopback)")
    print("=" * 68)
    codes = {}
    for group in (0x51, 0x53, 0x55, 0x57):
        if group in frames_out and 0x02 in frames_out[group]:
            pair = (group - 0x51) // 2
            sec = f"Loopback_LB{[12, 34, 56, 78][pair]}"
            src = ini.get(sec, {}).get("AudioSource")
            if src:
                codes[src] = frames_out[group][0x02]
    for name, code in sorted(codes.items(), key=lambda x: x[1]):
        print(f"  {name:12} = {code}")

    # --- константа ---
    print("\n" + "=" * 68)
    print("КОНСТАНТЫ ДЛЯ КОДА")
    print("=" * 68)
    print("\n// Ducking: параметр -> свойство группы 0x43")
    print("export const DUCKING = {")
    for key, prop in mapping_duck.items():
        print(f"  {key.lower():14}: 0x{prop:02x},")
    print("};")

    print("\n// Loopback: 4 пары, группа 0x51+2n / 0x52+2n")
    print("//   0x02 = код источника, 0x03 = gain Q25")
    print("export const LOOPBACK = {")
    for i, name in enumerate(["lb12", "lb34", "lb56", "lb78"]):
        print(f"  {name}: {{ l: 0x{0x51 + i * 2:02x}, r: 0x{0x52 + i * 2:02x} }},")
    print("};")

    if codes:
        print("\n// Коды источников (loopback / выходы)")
        print("export const SOURCE_CODES = {")
        for name, code in sorted(codes.items(), key=lambda x: x[1]):
            key = re.sub(r"[^a-z0-9]", "", name.lower().replace(" ", ""))
            print(f"  {key:12}: {code},")
        print("};")


if __name__ == "__main__":
    main()
