r"""РАЗБОР ЗАХВАТА: что MCC отправил при нажатии 48V.

══════════ ЗАЧЕМ ══════════

Известно: 0x11:0x19 — состояние фантома, но MCC его не отправляет.
Значит команда — другой кадр. В захвате видно ВСЁ, что уходит наружу,
с временными метками, — можно найти кадр, попавший в момент нажатия.

══════════ КАК ИЩЕМ ══════════

1. Собираем ВСЕ кадры хоста (OUT) с временем.
2. Смотрим на кадры, которые встречаются РЕДКО (1-2 раза) —
   нажатие кнопки даёт как раз редкий кадр.
3. Ищем изменение состояния 0x11:0x19 в потоке IN — оно
   обозначает момент, когда 48V реально переключился.
4. Печатаем все OUT-кадры в окне ±3 секунды от этого момента.

Запуск: python src/tools/analyze-48v-capture.py research/capture-48v.pcap
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15


def read_packets(path: Path):
    """Отдаёт (время_сек, ep, payload)."""
    blob = path.read_bytes()
    endian = "<" if blob[:4] == b"\xd4\xc3\xb2\xa1" else ">"
    off = 24
    first_ts = None
    while off + 16 <= len(blob):
        ts_sec, ts_usec, incl, _ = struct.unpack(endian + "IIII", blob[off : off + 16])
        off += 16
        data = blob[off : off + incl]
        off += incl
        if len(data) < 27:
            continue
        hlen = struct.unpack("<H", data[0:2])[0]
        if hlen < 27 or hlen > len(data):
            continue

        t = ts_sec + ts_usec / 1_000_000
        if first_ts is None:
            first_ts = t
        yield t - first_ts, data[21], data[hlen : hlen + struct.unpack("<I", data[23:27])[0]]


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
        raise SystemExit("использование: analyze-48v-capture.py <файл.pcap>")
    path = Path(sys.argv[1])
    if not path.exists():
        raise SystemExit(f"нет файла: {path}")

    # --- собираем всё ---
    out_frames: list[tuple[float, int, int, int]] = []   # (t, tt, pp, val)
    state_events: list[tuple[float, int]] = []           # (t, значение 0x11:19)

    for t, ep, payload in read_packets(path):
        is_in = bool(ep & 0x80)
        for tt, pp, val in frames(payload):
            if is_in:
                if tt == 0x11 and pp == 0x19:
                    state_events.append((t, val))
            else:
                out_frames.append((t, tt, pp, val))

    print(f"кадров от хоста: {len(out_frames)}")
    print(f"событий 0x11:0x19 (состояние 48V): {len(state_events)}")

    if not out_frames:
        print("\nХост ничего не отправил — захват не поймал трафик.")
        return

    print("\n" + "=" * 70)
    print("СОСТОЯНИЕ 48V (0x11:0x19) ПО ВРЕМЕНИ")
    print("=" * 70)
    if not state_events:
        print("  не приходило ни разу")
    else:
        for t, v in state_events:
            print(f"  {t:8.3f} с   значение = {v}")

    # --- ищем переключения ---
    switches = []
    prev = None
    for t, v in state_events:
        if prev is not None and v != prev:
            switches.append((t, prev, v))
        prev = v

    print("\n" + "=" * 70)
    print("ПЕРЕКЛЮЧЕНИЯ 48V")
    print("=" * 70)
    if not switches:
        print("  переключений не было (кнопка не нажалась или не отразилась)")
    else:
        for t, a, b in switches:
            print(f"  {t:8.3f} с   {a} -> {b}")

    # --- редкие OUT-кадры ---
    counts: dict[tuple[int, int], list[tuple[float, int]]] = {}
    for t, tt, pp, val in out_frames:
        counts.setdefault((tt, pp), []).append((t, val))

    print("\n" + "=" * 70)
    print("РЕДКИЕ КАДРЫ ОТ ХОСТА (1-3 раза за захват)")
    print("=" * 70)
    rare = []
    for (tt, pp), items in sorted(counts.items()):
        if len(items) <= 3:
            rare.append((tt, pp, items))
            vals = ", ".join(f"{t:.3f}s={v}" for t, v in items)
            print(f"  0x{tt:02x}:0x{pp:02x}  ({len(items)} раз)  {vals}")

    # --- окно вокруг переключений ---
    if switches:
        print("\n" + "=" * 70)
        print("ЧТО ХОСТ ОТПРАВЛЯЛ ВОКРУГ ПЕРЕКЛЮЧЕНИЯ (±3 с)")
        print("=" * 70)
        for t_sw, a, b in switches:
            print(f"\n--- переключение {a} -> {b} на {t_sw:.3f} с ---")
            window = [
                (t, tt, pp, val) for t, tt, pp, val in out_frames
                if abs(t - t_sw) <= 3.0
            ]
            if not window:
                print("  в этом окне хост ничего не отправлял")
                continue
            # показываем только НЕ-периодические (не subscribe/keepalive)
            for t, tt, pp, val in window[:40]:
                tag = ""
                if tt == 0x11 and pp in (0x24, 0x26):
                    tag = "  (keepalive/announce)"
                elif tt == 0x11 and pp == 0x20:
                    tag = "  (bulk bracket)"
                print(f"  {t:8.3f} с   0x{tt:02x}:0x{pp:02x} = {val}{tag}")

    # --- вывод ---
    print("\n" + "=" * 70)
    print("ЧТО ИСКАТЬ")
    print("=" * 70)
    print("""
  В окне вокруг переключения ищи кадр, которого НЕТ в списке
  периодических. Он и будет командой 48V.

  Кандидаты по смыслу:
    - 0x11:0x19  — если MCC всё-таки его шлёт (мы раньше не видели)
    - 0x21:0x0x  — свойства входа IN1
    - любой адрес, встречающийся ровно 1-2 раза

  Напиши, какой адрес нашёлся — проверю его прямой записью.
""")


if __name__ == "__main__":
    main()
