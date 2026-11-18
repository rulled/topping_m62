r"""Какие теги менялись в IN-потоке во время действий в UI.

═══════════ ЛОГИКА ═══════════

В захвате MCC отправил 0x44:0x01 = 5 и затем = 0 — это ровно моё движение
слайдера 0->5->0. Значит движение слайдера в MCC порождает HID-кадр, и по
нему можно опознать тег.

Задача: взять ВСЕ IN-кадры, сгруппировать по тегу, и показать, какие теги
меняли значение ВО ВРЕМЯ движения, а не постоянно (метры флуктуируют
постоянно и нам не нужны).

Признак «наш» тег: значение меняется 1-3 раза за захват, ступенькой,
и остаётся стабильным до и после.

Запуск: python src/tools/in-changes.py <файл.pcap> [dev]
"""

from __future__ import annotations

import struct
import sys
from collections import defaultdict

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


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: in-changes.py <файл.pcap> [dev]")
    path = sys.argv[1]
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    series: dict[str, list[tuple[float, int]]] = defaultdict(list)
    t_first = None

    for ts, ep, payload in read_packets(path, dev):
        if not (ep & 0x80):
            continue
        if t_first is None:
            t_first = ts
        for tt, pp, value in frames(payload):
            series[f"0x{tt:02x}:0x{pp:02x}"].append((ts, value))

    print(f"тегов в IN-потоке: {len(series)}\n")

    interesting = []
    noisy = []

    for tag, points in series.items():
        values = [v for _, v in points]
        uniq = sorted(set(values))
        # сколько раз значение реально менялось
        changes = sum(1 for i in range(1, len(values)) if values[i] != values[i - 1])
        if changes <= 4 and len(uniq) <= 5:
            interesting.append((tag, points, uniq, changes))
        else:
            noisy.append((tag, len(points), len(uniq), changes))

    print("=== СТАБИЛЬНЫЕ ТЕГИ (мало изменений) — кандидаты ===")
    if not interesting:
        print("  нет")
    for tag, points, uniq, changes in sorted(interesting):
        t_start = (points[0][0] - t_first) * 1000
        print(f"  {tag}  точек {len(points):5}  значения {uniq}  изменений {changes}  первое в {t_start:.0f} мс")

    print("\n=== ШУМНЫЕ (метры и прочее) ===")
    for tag, n, u, ch in sorted(noisy, key=lambda x: -x[1])[:15]:
        print(f"  {tag}  точек {n:5}  уникальных {u:4}  изменений {ch}")

    # --- история изменения кандидатов ---
    print("\n=== ИСТОРИЯ КАНДИДАТОВ (моменты смены значения) ===")
    for tag, points, uniq, changes in sorted(interesting):
        if changes == 0:
            continue
        print(f"\n  {tag}:")
        prev = None
        for ts, value in points:
            if value != prev:
                rel = (ts - t_first) * 1000
                print(f"    {rel:9.1f} мс -> {value}")
                prev = value


if __name__ == "__main__":
    main()
