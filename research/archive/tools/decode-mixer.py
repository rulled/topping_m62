r"""Полный разбор bulk push из захвата MCC.

═══════════ ЧТО ОБНАРУЖЕНО ═══════════

При старте MCC отправляет ВСЁ состояние между двумя кадрами:

    0x11:0x20 = 1      <- открыть bulk push
    ... 269 кадров состояния ...
    0x11:0x20 = 0      <- закрыть

Внутри:
    0x43:0x01..0x07    ducking        (7)
    0x21..0x27:0x02..05 входы
    0x31..0x3c:0x01..14 МИКШЕР       (10 групп x 20 свойств = 200)
    0x51..0x58:0x02..03 loopback
    0x61..0x64:0x02..04 выходы

Это и есть «bulk push bracket» — механизм, которым MCC выгружает свою
модель состояния в устройство. Раньше §3.0a PROTOCOL.md описывал его
предположительно; теперь он подтверждён захватом.

═══════════ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ═══════════

1. Достаёт из pcap все OUT-кадры M62.
2. Проверяет, приходят ли те же адреса в IN (обратное чтение).
3. Печатает матрицу микшера в виде таблицы: группа x свойство.
4. Пробует восстановить структуру: какие группы = один микс (L/R),
   какие свойства = один источник (L/R).
5. Сверяет с workspace-INI.

Запуск: python src/tools/decode-mixer.py <файл.pcap> [dev]
"""

from __future__ import annotations

import struct
import sys
from collections import defaultdict

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

Q25_UNITY = 2**25  # 33554432 = 0 dB


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
        data_len = struct.unpack("<I", data[23:27])[0]
        payload = data[header_len : header_len + data_len]
        yield (ts_sec + ts_usec / 1e6, ep, payload)


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


def q25_to_db(value: int) -> str:
    if value == 0:
        return "-inf"
    import math

    return f"{20 * math.log10(value / Q25_UNITY):+.1f}"


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: decode-mixer.py <файл.pcap> [dev]")
    path = sys.argv[1]
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    out_frames: list[tuple[float, int, int, int]] = []
    in_frames: list[tuple[float, int, int, int]] = []

    for ts, ep, payload in read_packets(path, dev):
        target = in_frames if ep & 0x80 else out_frames
        for tt, pp, value in frames(payload):
            target.append((ts, tt, pp, value))

    print(f"OUT-кадров: {len(out_frames)}   IN-кадров: {len(in_frames)}")

    # ---------- 1. bulk bracket ----------
    print("\n=== 1. BULK PUSH BRACKET ===")
    begin_at = None
    end_at = None
    for i, (ts, tt, pp, value) in enumerate(out_frames):
        if tt == 0x11 and pp == 0x20:
            if value == 1 and begin_at is None:
                begin_at = i
            elif value == 0 and begin_at is not None and end_at is None:
                end_at = i
    if begin_at is None:
        print("  брекет не найден")
        return
    print(f"  кадр {begin_at} = 0x11:0x20=1, кадр {end_at} = 0x11:0x20=0")
    if end_at:
        print(f"  внутри: {end_at - begin_at - 1} кадров состояния")
        dt = (out_frames[end_at][0] - out_frames[begin_at][0]) * 1000
        print(f"  длительность: {dt:.0f} мс")

    inner = out_frames[begin_at + 1 : end_at if end_at else len(out_frames)]

    # ---------- 2. что вообще пишется ----------
    print("\n=== 2. ЧТО ПИШЕТСЯ В БРЕКЕТЕ (по семействам) ===")
    by_family: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for _, tt, pp, value in inner:
        by_family[tt].append((pp, value))

    for tt in sorted(by_family):
        props = by_family[tt]
        uniq_props = sorted({p for p, _ in props})
        span = f"0x{uniq_props[0]:02x}..0x{uniq_props[-1]:02x}"
        print(f"  0x{tt:02x}: {len(props):4} кадров, свойства {span} ({len(uniq_props)} шт)")

    # ---------- 3. матрица микшера ----------
    MIX_MIN, MIX_MAX = 0x31, 0x3C
    mixer = [(tt, pp, value) for _, tt, pp, value in inner if MIX_MIN <= tt <= MIX_MAX]

    print(f"\n=== 3. МАТРИЦА МИКШЕРА (0x31..0x3c), {len(mixer)} кадров ===")
    groups = sorted({tt for tt, _, _ in mixer})
    props = sorted({pp for _, pp, _ in mixer})
    print(f"  групп: {len(groups)} -> {', '.join(f'0x{g:02x}' for g in groups)}")
    print(f"  свойств на группу: {len(props)} -> 0x{props[0]:02x}..0x{props[-1]:02x}")

    grid: dict[int, dict[int, int]] = {g: {} for g in groups}
    for tt, pp, value in mixer:
        grid[tt][pp] = value

    print("\n  матрица (значение в Q25, в скобках dB):")
    header = "        " + "".join(f"{p:>8x}" for p in props)
    print(header)
    for g in groups:
        row = f"  0x{g:02x} "
        for p in props:
            v = grid[g].get(p)
            if v is None:
                row += f"{'--':>8}"
            elif v == 0:
                row += f"{'0':>8}"
            else:
                row += f"{v // 1000000:>8}"
        print(row)

    print("\n  то же в дБ (0 = mute):")
    print(header)
    for g in groups:
        row = f"  0x{g:02x} "
        for p in props:
            v = grid[g].get(p)
            if v is None:
                row += f"{'--':>8}"
            else:
                row += f"{q25_to_db(v):>8}"
        print(row)

    # ---------- 4. гипотеза L/R ----------
    print("\n=== 4. ГИПОТЕЗА: нечётные свойства = L, чётные = R ===")
    for g in groups:
        odd = [grid[g].get(p) for p in props if p % 2 == 1]
        even = [grid[g].get(p) for p in props if p % 2 == 0]
        odd_nz = sum(1 for v in odd if v)
        even_nz = sum(1 for v in even if v)
        print(f"  0x{g:02x}: нечётных с сигналом {odd_nz:2}, чётных {even_nz:2}")

    # ---------- 5. есть ли обратное чтение ----------
    print("\n=== 5. ОБРАТНОЕ ЧТЕНИЕ: приходят ли те же адреса в IN? ===")
    in_tags = {(tt, pp) for _, tt, pp, _ in in_frames}
    out_tags = {(tt, pp) for _, tt, pp, _ in inner}
    overlap = out_tags & in_tags
    only_out = out_tags - in_tags
    print(f"  адресов в OUT: {len(out_tags)}")
    print(f"  из них приходят в IN: {len(overlap)}")
    print(f"  только в OUT: {len(only_out)}")
    if only_out:
        sample = sorted(only_out)[:20]
        print(f"  примеры только-OUT: {', '.join(f'0x{t:02x}:0x{p:02x}' for t, p in sample)}")

    # ---------- 6. что в IN по микшеру ----------
    print("\n=== 6. МИКШЕР В IN-ПОТОКЕ ===")
    in_mix = [(tt, pp) for tt, pp in in_tags if MIX_MIN <= tt <= MIX_MAX]
    print(f"  микшерных адресов в IN: {len(in_mix)}")
    for tt, pp in sorted(in_mix):
        print(f"    0x{tt:02x}:0x{pp:02x}")


if __name__ == "__main__":
    main()
