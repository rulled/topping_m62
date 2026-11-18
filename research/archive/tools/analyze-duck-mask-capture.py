r"""РАЗБОР ЗАХВАТА: биты маски ducking.

══════════ ЗАЧЕМ ══════════

Известно:
  0x43:0x05 = маска входов для IN1 (8 бит)
  0x43:0x06 = маска входов для IN2 (8 бит)

В INI 16 флагов (IN1AUX, IN1BT, ... IN2Playback9_10). В захвате
скрипт выключил РОВНО ОДИН: IN1AUX=false.

══════════ ЧТО ИЩЕМ ══════════

Кадр 0x43:0x05 от хоста. Его значение должно отличаться от 255
(все включены) на ОДИН бит. Этот бит и есть AUX.

Если значение всё ещё 255 — значит маска не зависит от этого флага,
и надо смотреть другие кадры.

Запуск: python src/tools/analyze-duck-mask-capture.py research/capture-48v.pcap
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

# Порядок источников по гипотезе (для печати названий битов).
BIT_NAMES = [
    "PB12", "PB34", "PB56", "PB78",
    "AUX", "BT", "OTG IN", "PB910",
]


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


def bits_str(v: int) -> str:
    if not (0 <= v <= 255):
        return "?"
    out = []
    for i in range(8):
        if v & (1 << i):
            out.append(f"{i}:{BIT_NAMES[i]}")
    return " ".join(out) if out else "(пусто)"


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: analyze-duck-mask-capture.py <файл.pcap>")
    path = Path(sys.argv[1])
    if not path.exists():
        raise SystemExit(f"нет файла: {path}")

    # --- все кадры 0x43 от хоста ---
    sent: list[tuple[int, int, int]] = []   # (tt, pp, value) в порядке появления
    all_43: set[tuple[int, int]] = set()

    for ep, payload in read_packets(path):
        if ep & 0x80:
            continue
        for tt, pp, val in frames(payload):
            if tt != 0x43:
                continue
            sent.append((tt, pp, val))
            all_43.add((tt, pp))

    print("=" * 70)
    print("КАДРЫ DUCKING (0x43), ОТПРАВЛЕННЫЕ ХОСТОМ")
    print("=" * 70)

    if not sent:
        print("  хост НЕ отправлял ни одного кадра 0x43")
        print("  Возможно, MCC не тронул ducking при старте.")
        print("  Тогда маску надо ловить, меняя настройку в UI MCC.")
        return

    print(f"  всего кадров: {len(sent)}")
    print(f"  адресов: {sorted('0x%02x' % pp for _, pp, _ in sent)}")

    print("\n" + "=" * 70)
    print("ПО АДРЕСАМ")
    print("=" * 70)
    for pp in sorted({pp for _, pp, _ in sent}):
        vals = [v for _, p, v in sent if p == pp]
        uniq = sorted(set(vals))
        extra = ""
        if pp in (0x05, 0x06):
            extra = "   <-- МАСКА"
        print(f"  0x43:0x{pp:02x}  значений: {len(vals)}, уникальных: {len(uniq)}{extra}")
        for u in uniq[:6]:
            b = f"  = {bits_str(u)}" if pp in (0x05, 0x06) else ""
            print(f"      {u}{b}")

    # --- разбор маски ---
    print("\n" + "=" * 70)
    print("РАСШИФРОВКА МАСКИ")
    print("=" * 70)

    mask5 = sorted({v for _, p, v in sent if p == 0x05})
    mask6 = sorted({v for _, p, v in sent if p == 0x06})

    print(f"  0x43:0x05 (IN1): {mask5}")
    print(f"  0x43:0x06 (IN2): {mask6}")

    if not mask5 and not mask6:
        print("\n  маска в захвате не встречалась")
        return

    # сравнение с 255
    for label, vals in (("IN1", mask5), ("IN2", mask6)):
        if not vals:
            continue
        print(f"\n  {label}:")
        for v in vals:
            diff = 255 ^ v
            if diff == 0:
                print(f"    {v} = все биты включены")
            else:
                off_bits = [i for i in range(8) if diff & (1 << i)]
                names = ", ".join(f"бит {i} ({BIT_NAMES[i]})" for i in off_bits)
                print(f"    {v} = выключены: {names}")

    print("\n" + "=" * 70)
    print("ВЫВОД")
    print("=" * 70)

    if mask5 and mask5 != [255]:
        v = mask5[0]
        diff = 255 ^ v
        off = [i for i in range(8) if diff & (1 << i)]
        if len(off) == 1:
            print(f"""
  В INI был выключен РОВНО ОДИН флаг: IN1AUX=false.
  Маска IN1 = {v}, отличается от 255 на ОДИН бит: {off[0]}.

  ЗНАЧИТ: AUX = бит {off[0]}.
  По аналогии сдвигом получаем остальные (проверить повторным
  захватом с другим флагом).
""")
        else:
            print(f"""
  Маска IN1 = {v}. Отличается от 255 на {len(off)} бит: {off}.
  Ожидался один бит (выключали только IN1AUX).
  Возможно, MCC при старте сбросил ещё что-то, либо маска
  кодирует не то, что мы думали.
""")
    else:
        print("""
  Маска IN1 = 255 (все биты) или отсутствует.

  Значит IN1AUX в INI не влияет на маску напрямую — вероятно,
  MCC держит настройки ducking в памяти и берёт их не из файла,
  либо маска кодирует другое.

  Следующий шаг: выключить флаг ЧЕРЕЗ UI MCC (клик по чекбоксу)
  под захватом, а не через файл.
""")


if __name__ == "__main__":
    main()
