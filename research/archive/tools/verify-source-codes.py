r"""СЕЛЕКТОРЫ И LOOPBACK — сверка кодов со всеми захватами.

══════════ ЗАЧЕМ ══════════

Коды источников (name -> code) частично были выведены из
последовательности, а не проверены. В mainline-патче драйвера
(drivers/hid/hid-topping-m62.c, VID 0x152a / PID 0x875c — наше
устройство) есть таблица topping_source_value[]:

    "Unknown", "Mix A", "Mix B", "Mix C", "IN 1", "IN 2", "IN 1+2",
    "AUX", "BT", "OTG IN", "Playback 1/2", "Playback 3/4",
    "Playback 5/6", "Playback 7/8", "Playback 9/10"

    0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16

Дыра на 4 и 5 — там, где были бы Mix D и Mix E. То есть как
источник для выхода/loopback они НЕ выбираются.

Этот скрипт проверяет таблицу на всех уже снятых захватах: находит
кадры 0x51..0x58:0x02 (loopback) и 0x62/0x64:0x02 (селекторы
выходов) и сопоставляет код с AudioSource из INI.

══════════ ЗАПУСК ══════════

    python src/tools/verify-source-codes.py
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

RESEARCH = Path("research")

# таблица из mainline-патча
DRIVER_TABLE = {
    "Unknown": 0,
    "Mix A": 1,
    "Mix B": 2,
    "Mix C": 3,
    "IN 1": 6,
    "IN 2": 7,
    "IN 1+2": 8,
    "AUX": 9,
    "BT": 10,
    "OTG IN": 11,
    "Playback 1/2": 12,
    "Playback 3/4": 13,
    "Playback 5/6": 14,
    "Playback 7/8": 15,
    "Playback 9/10": 16,
}
CODE_TO_NAME = {v: k for k, v in DRIVER_TABLE.items()}

# что наш код считал раньше
OUR_TABLE = {
    "mixA": 1, "mixB": 2, "mixC": 3, "mixD": 4, "mixE": 5,
    "in1": 6, "in2": 7, "otgin": 8, "aux": 9, "bt": 10,
    "unknown11": 11, "pb12": 12, "pb34": 13, "pb56": 14,
    "pb78": 15, "pb910": 16, "fx": 17,
}


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


def read_ini(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    out: dict[str, dict[str, str]] = {}
    cur = None
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        t = line.strip()
        if t.startswith("["):
            cur = t[1:-1]
            out[cur] = {}
        elif cur is not None and t and "=" in t:
            k, _, v = t.partition("=")
            out[cur][k.strip()] = v.strip()
    return out


def scan(path: Path) -> dict[int, set[int]]:
    """TT -> множество значений PP=0x02 (и PP=0x03 для 0x51..0x58)."""
    seen: dict[int, dict[int, set[int]]] = {}
    for _ep, payload in read_packets(path):
        for tt, pp, value in frames(payload):
            if pp not in (0x02, 0x03):
                continue
            if not (0x51 <= tt <= 0x58 or tt in (0x62, 0x64)):
                continue
            seen.setdefault(tt, {}).setdefault(pp, set()).add(value)
    return seen


def main() -> None:
    ws_root = Path(
        r"C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62"
    )
    inis = sorted(ws_root.rglob("*.ini")) if ws_root.exists() else []
    ini_data = {p.name: read_ini(p) for p in inis}

    pcaps = sorted(RESEARCH.glob("*.pcap"))
    if not pcaps:
        raise SystemExit("нет .pcap в research/")

    observed: dict[int, set[int]] = {}

    for pcap in pcaps:
        seen = scan(pcap)
        if not seen:
            print(f"\n{pcap.name}: кадров 0x51..0x58 / 0x62 / 0x64 нет")
            continue
        print(f"\n{pcap.name}:")
        for tt in sorted(seen):
            for pp in sorted(seen[tt]):
                vals = sorted(seen[tt][pp])
                shown = ", ".join(
                    f"{v} ({CODE_TO_NAME.get(v, '?')})" if pp == 0x02 else str(v)
                    for v in vals
                )
                print(f"  0x{tt:02x}:0x{pp:02x} = {shown}")
                if pp == 0x02:
                    observed.setdefault(tt, set()).update(vals)

    # ---- сопоставление с INI ----
    print("\n" + "=" * 70)
    print("СОПОСТАВЛЕНИЕ: loopback 0x51..0x58:0x02 <-> INI AudioSource")
    print("=" * 70)

    lb_pairs = [(0x51, "Loopback_LB12"), (0x53, "Loopback_LB34"),
                (0x55, "Loopback_LB56"), (0x57, "Loopback_LB78")]

    hits = 0
    for grp, sec in lb_pairs:
        if grp not in observed:
            continue
        for code in sorted(observed[grp]):
            names = []
            for fname, secs in ini_data.items():
                src = secs.get(sec, {}).get("AudioSource")
                if src:
                    names.append(f"{fname}:{src}")
            pred = CODE_TO_NAME.get(code, "?")
            mark = "OK" if any(f":{pred}" in n for n in names) else "?"
            print(f"  0x{grp:02x}:0x02 = {code:2}  -> предсказано {pred:14} "
                  f"INI: {names or 'нет секции'}   [{mark}]")
            if mark == "OK":
                hits += 1

    print("\n" + "=" * 70)
    print("ИТОГ: наша таблица против таблицы драйвера")
    print("=" * 70)
    print(f"{'код':>4}  {'наш код':<12} {'драйвер':<14} вердикт")
    for name, code in sorted(OUR_TABLE.items(), key=lambda x: x[1]):
        drv = CODE_TO_NAME.get(code, "—")
        if code == 17:
            verdict = "FX — проверено нами вживую, в таблице драйвера нет"
        elif name.lower().replace("unknow", "unknow") in ("mixd", "mixe"):
            verdict = "ОШИБКА: кода 4 и 5 не существует (дыра)"
        elif drv == "—":
            verdict = "?"
        else:
            verdict = f"совпадает с {drv}"
        print(f"{code:>4}  {name:<12} {drv:<14} {verdict}")

    print("\nДыра 4/5 и OTG IN = 11 означают, что наша таблица неверна как минимум")
    print("в двух местах: mixD/mixE не выбираются вообще, а otgin = 11, не 8.")


if __name__ == "__main__":
    sys.exit(main())
