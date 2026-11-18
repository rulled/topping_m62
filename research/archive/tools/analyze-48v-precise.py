r"""ТОЧНЫЙ РАЗБОР: что менялось в момент нажатий 48V.

══════════ ЧТО ВИДНО ИЗ ПЕРВОГО ПРОХОДА ══════════

Единственный кадр, встречавшийся ТРИ раза (а не один):

    0x21:0x03   3.867s=0, 27.666s=1, 34.712s=0

Остальные — по одному разу (стартовая синхронизация MCC).
Значит 0x21:03 менялся в моменты нажатий. Но прямая запись его
не включает 48V.

══════════ ПОЧЕМУ ══════════

Возможно:
  A. 0x21:03 — это НЕ 48V, а что-то ещё, менявшееся в те же моменты
     (например, состояние «MCC видит кнопку нажатой»).
  B. 48V требует ПОСЛЕДОВАТЕЛЬНОСТИ кадров, а не одного.
  C. 48V — это 0x21:02, который MCC шлёт один раз при старте,
     а 0x21:03 меняется как следствие.

══════════ ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ ══════════

Печатает ВСЕ кадры хоста в узких окнах вокруг нажатий
(±0.5 секунды), в порядке времени. Так видно не только сам
кадр, но и последовательность.

Запуск: python src/tools/analyze-48v-precise.py research/capture-48v.pcap
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

# Времена из первого прохода
PRESS_TIMES = [27.666, 34.712]
WINDOW = 1.5


def read_packets(path: Path):
    blob = path.read_bytes()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    off = 24
    first = None
    while off + 16 <= len(blob):
        sec, usec, incl, _ = struct.unpack(endian + "IIII", blob[off : off + 16])
        off += 16
        data = blob[off : off + incl]
        off += incl
        if len(data) < 27:
            continue
        hlen = struct.unpack("<H", data[0:2])[0]
        if hlen < 27 or hlen > len(data):
            continue
        t = sec + usec / 1_000_000
        if first is None:
            first = t
        yield t - first, data[21], data[hlen : hlen + struct.unpack("<I", data[23:27])[0]]


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
    if len(sys.argv) < 2:
        raise SystemExit("использование: analyze-48v-precise.py <файл.pcap>")
    path = Path(sys.argv[1])
    if not path.exists():
        raise SystemExit(f"нет файла: {path}")

    out: list[tuple[float, int, int, int]] = []
    inp: list[tuple[float, int, int, int]] = []

    for t, ep, payload in read_packets(path):
        is_in = bool(ep & 0x80)
        for tt, pp, val in frames(payload):
            if is_in:
                inp.append((t, tt, pp, val))
            else:
                out.append((t, tt, pp, val))

    print(f"кадров OUT: {len(out)}   IN: {len(inp)}")

    # --- окна вокруг нажатий ---
    for t_press in PRESS_TIMES:
        print("\n" + "=" * 74)
        print(f"ОКНО ±{WINDOW}с ВОКРУГ {t_press:.3f} с")
        print("=" * 74)

        window_out = sorted(
            [(t, tt, pp, v) for t, tt, pp, v in out if abs(t - t_press) <= WINDOW]
        )
        window_in = sorted(
            [(t, tt, pp, v) for t, tt, pp, v in inp if abs(t - t_press) <= WINDOW]
        )

        print(f"\n  ХОСТ -> УСТРОЙСТВО ({len(window_out)} кадров):")
        if not window_out:
            print("    ничего")
        for t, tt, pp, v in window_out[:60]:
            mark = ""
            if tt == 0x11 and pp in (0x24, 0x26):
                mark = "  (подписка/announce — периодика)"
            elif tt == 0x21:
                mark = "  <<< СЕМЕЙСТВО ВХОДА IN1"
            elif tt == 0x11 and pp == 0x19:
                mark = "  <<< СОСТОЯНИЕ 48V!"
            print(f"    {t:8.3f}   0x{tt:02x}:0x{pp:02x} = {v}{mark}")

        print(f"\n  УСТРОЙСТВО -> ХОСТ ({len(window_in)} кадров):")
        # показываем только НЕ метры, чтобы не засорять
        interesting = [
            (t, tt, pp, v) for t, tt, pp, v in window_in
            if pp != 0x15 and not (pp == 0x01 and (tt == 0x21 or tt == 0x25))
        ]
        if not interesting:
            print("    только метры")
        for t, tt, pp, v in interesting[:60]:
            mark = "  <<< 48V!" if (tt == 0x11 and pp in (0x19, 0x1A)) else ""
            print(f"    {t:8.3f}   0x{tt:02x}:0x{pp:02x} = {v}{mark}")

    # --- все кадры 0x21 за весь захват ---
    print("\n" + "=" * 74)
    print("ВСЕ КАДРЫ 0x21 (ВХОД IN1) ЗА ВЕСЬ ЗАХВАТ")
    print("=" * 74)
    all21 = sorted([(t, pp, v) for t, tt, pp, v in out if tt == 0x21])
    for t, pp, v in all21:
        print(f"  {t:8.3f}   0x21:0x{pp:02x} = {v}")

    print("\n" + "=" * 74)
    print("ВСЕ СОБЫТИЯ 0x11:0x19 / 0x11:0x1a (СОСТОЯНИЕ 48V)")
    print("=" * 74)
    st = sorted([(t, tt, pp, v) for t, tt, pp, v in inp if tt == 0x11 and pp in (0x19, 0x1A)])
    if not st:
        print("  ни одного")
    for t, tt, pp, v in st:
        print(f"  {t:8.3f}   0x{tt:02x}:0x{pp:02x} = {v}")


if __name__ == "__main__":
    main()
