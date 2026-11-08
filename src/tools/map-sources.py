r"""Восстановить карту «источник -> свойство» из захвата с уникальными значениями.

═══════════ ИДЕЯ ═══════════

Каждому источнику присвоено уникальное значение в Mix B и Mix C:

    Mix B:  IN12=-11  AUX=-12  BT=-13  FX=-14  PB12=-15
            PB34=-16  PB56=-17  PB78=-18  PB910=-19
    Mix C:  IN12=-21  AUX=-22  BT=-23

В bulk push каждое свойство получает своё значение. Находим значение ->
узнаём источник. Пересечение Mix B и Mix C даёт перекрёстную проверку:
IN/AUX/BT должны попасть в ОДНИ И ТЕ ЖЕ свойства в обоих миксах.

═══════════ ЧТО ИЩЕМ ═══════════

    -11 дБ в Q25 = round(10^(-11/20) * 2^25) = 9463823
    ...
Вычисляем на месте, а не хардкодим.

Запуск: python src/tools/map-sources.py <файл.pcap> [dev]
"""

from __future__ import annotations

import math
import struct
import sys

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25

# ожидаемые значения: источник -> дБ
MIX_B = {
    "IN12": -11,
    "AUX": -12,
    "BT": -13,
    "FX": -14,
    "PB12": -15,
    "PB34": -16,
    "PB56": -17,
    "PB78": -18,
    "PB910": -19,
}
MIX_C = {"IN12": -21, "AUX": -22, "BT": -23}


def db_to_q25(db: float) -> int:
    return round(math.pow(10, db / 20) * Q25_UNITY)


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
        if struct.unpack("<H", data[19:21])[0] != want_dev:
            continue
        yield data[21], data[header_len : header_len + struct.unpack("<I", data[23:27])[0]]


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
        raise SystemExit("использование: map-sources.py <файл.pcap> [dev]")
    path = sys.argv[1]
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    # --- собираем OUT-кадры микшера ---
    mixer: dict[int, dict[int, int]] = {}
    for ep, payload in read_packets(path, dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            if 0x31 <= tt <= 0x3C:
                mixer.setdefault(tt, {})[pp] = value

    if not mixer:
        print("микшера в OUT не найдено")
        return

    print(f"групп: {len(mixer)}")

    # --- обратные таблицы: значение -> источник ---
    rev_b = {db_to_q25(db): name for name, db in MIX_B.items()}
    rev_c = {db_to_q25(db): name for name, db in MIX_C.items()}

    print("\nожидаемые Q25:")
    for name, db in MIX_B.items():
        print(f"  {name:7} {db:+4} дБ -> {db_to_q25(db)}")

    # --- Mix B: 0x33 (L) и 0x34 (R) ---
    print("\n" + "=" * 60)
    print("MIX B (группы 0x33 L / 0x34 R)")
    print("=" * 60)
    found_b: dict[str, tuple[int, int]] = {}  # имя -> (свойство, сторона)

    for group, side in ((0x33, "L"), (0x34, "R")):
        if group not in mixer:
            print(f"  0x{group:02x}: нет в захвате")
            continue
        print(f"\n  0x{group:02x} ({side}):")
        for prop in sorted(mixer[group]):
            value = mixer[group][prop]
            name = rev_b.get(value)
            if name:
                print(f"    0x{prop:02x} = {value}  -> {name}")
                found_b[name] = (prop, side)
            elif value:
                db = 20 * math.log10(value / Q25_UNITY) if value else -999
                print(f"    0x{prop:02x} = {value}  ({db:+.2f} дБ) — не наше значение")

    # --- Mix C ---
    print("\n" + "=" * 60)
    print("MIX C (группы 0x35 L / 0x36 R) — перекрёстная проверка")
    print("=" * 60)
    found_c: dict[str, tuple[int, int]] = {}

    for group, side in ((0x35, "L"), (0x36, "R")):
        if group not in mixer:
            print(f"  0x{group:02x}: нет в захвате")
            continue
        print(f"\n  0x{group:02x} ({side}):")
        for prop in sorted(mixer[group]):
            value = mixer[group][prop]
            name = rev_c.get(value)
            if name:
                print(f"    0x{prop:02x} = {value}  -> {name}")
                found_c[name] = (prop, side)
            elif value:
                db = 20 * math.log10(value / Q25_UNITY) if value else -999
                print(f"    0x{prop:02x} = {value}  ({db:+.2f} дБ) — не наше значение")

    # --- итоговая карта ---
    print("\n" + "=" * 60)
    print("КАРТА ИСТОЧНИКОВ")
    print("=" * 60)

    if not found_b:
        print("  Mix B: ничего не опознано")
        print("  Возможные причины:")
        print("    - MCC не прочитал INI (был запущен до правки)")
        print("    - значения не доехали до устройства")
        print("    - микшер пишется не из INI, а из своей памяти")
    else:
        print("\n  источник     Mix B L      Mix B R")
        for name in MIX_B:
            if name in found_b:
                p, s = found_b[name]
                print(f"  {name:10}  свойство 0x{p:02x} ({s})")
            else:
                print(f"  {name:10}  HE НАЙДЕНО")

    if found_c:
        print("\n  ПЕРЕКРЁСТНАЯ ПРОВЕРКА (Mix C):")
        for name in MIX_C:
            if name in found_c and name in found_b:
                pc, sc = found_c[name]
                pb, sb = found_b[name]
                ok = "СОВПАЛО" if pc == pb else f"РАСХОЖДЕНИЕ (B=0x{pb:02x}, C=0x{pc:02x})"
                print(f"    {name:7}: свойство 0x{pc:02x} ({sc})  {ok}")
            elif name in found_c:
                pc, sc = found_c[name]
                print(f"    {name:7}: свойство 0x{pc:02x} ({sc}) в C, но не в B")

    # --- вывод в виде готовой константы ---
    if found_b:
        print("\n" + "=" * 60)
        print("ГОТОВАЯ КОНСТАНТА ДЛЯ КОДА")
        print("=" * 60)
        print("\n// Источники микшера: имя -> номер свойства (нечёт L, чёт R)")
        print("export const MIXER_SOURCES = {")
        for name in MIX_B:
            if name in found_b:
                p = found_b[name][0]
                # приводим к нечётному (L)
                pl = p if p % 2 == 1 else p - 1
                print(f"  {name.lower():8}: 0x{pl:02x},  // L=0x{pl:02x}, R=0x{pl + 1:02x}")
        print("};")


if __name__ == "__main__":
    main()
