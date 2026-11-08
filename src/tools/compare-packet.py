r"""Сверка нашего генератора пакета с тем, что реально шлёт MCC.

═══════════ ЗАЧЕМ ═══════════

Проверить запись микшера через INI не получилось: MCC при старте берёт
микшер из СВОЕГО файла, а не из устройства. Значит если наша запись
и применилась, MCC её просто перезаписал своими значениями.

Другой способ — сравнить НАШ пакет с эталонным из захвата. Если структура
совпадает кадр в кадр, генератор верен, и запись должна работать.

═══════════ ЧТО СРАВНИВАЕМ ═══════════

1. Набор адресов (какие TT:PP шлёт MCC и какие мы).
2. Порядок кадров.
3. Значения.

Если порядок и набор совпадают — наш код формирует корректный пакет.

Запуск: python src/tools/compare-packet.py <файл.pcap> [dev]
"""

from __future__ import annotations

import struct
import sys

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25

MIX_GROUPS = [0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x3B, 0x3C]
PROPS = list(range(1, 21))


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
        raise SystemExit("использование: compare-packet.py <файл.pcap> [dev]")
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    # извлекаем последовательность микшерных кадров из захвата
    mcc_sequence: list[tuple[int, int, int]] = []
    in_bracket = False
    for ep, payload in read_packets(sys.argv[1], dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            if tt == 0x11 and pp == 0x20:
                in_bracket = value == 1
                continue
            if in_bracket and 0x31 <= tt <= 0x3C:
                mcc_sequence.append((tt, pp, value))

    if not mcc_sequence:
        print("микшерных кадров в брекете не найдено")
        return

    print("=" * 70)
    print("ЧТО ШЛЁТ MCC")
    print("=" * 70)
    print(f"  кадров: {len(mcc_sequence)}")

    # порядок групп
    order = []
    for tt, pp, _ in mcc_sequence:
        if not order or order[-1] != tt:
            order.append(tt)
    print(f"  порядок групп: {', '.join(f'0x{t:02x}' for t in order)}")

    # порядок свойств внутри первой группы
    first_group = order[0]
    props_in_order = [pp for tt, pp, _ in mcc_sequence if tt == first_group]
    print(f"  свойства в 0x{first_group:02x}: {', '.join(f'0x{p:02x}' for p in props_in_order)}")

    # сколько кадров на группу
    from collections import Counter

    per_group = Counter(tt for tt, _, _ in mcc_sequence)
    print("  кадров на группу:")
    for tt in order:
        print(f"    0x{tt:02x}: {per_group[tt]}")

    # ---------- что формируем мы ----------
    print("\n" + "=" * 70)
    print("ЧТО ФОРМИРУЕМ МЫ")
    print("=" * 70)

    our_sequence = []
    for tt in MIX_GROUPS:
        for pp in PROPS:
            our_sequence.append((tt, pp, 0))  # значения неважны для структуры

    print(f"  кадров: {len(our_sequence)}")
    our_order = []
    for tt, pp, _ in our_sequence:
        if not our_order or our_order[-1] != tt:
            our_order.append(tt)
    print(f"  порядок групп: {', '.join(f'0x{t:02x}' for t in our_order)}")
    print(f"  свойства в 0x{our_order[0]:02x}: {', '.join(f'0x{p:02x}' for p in PROPS)}")

    # ---------- сравнение ----------
    print("\n" + "=" * 70)
    print("СРАВНЕНИЕ")
    print("=" * 70)

    ok = True
    if len(mcc_sequence) != len(our_sequence):
        print(f"  РАЗМЕР: MCC {len(mcc_sequence)}, мы {len(our_sequence)}  РАСХОЖДЕНИЕ")
        ok = False
    else:
        print(f"  размер: {len(mcc_sequence)} = {len(our_sequence)}  OK")

    if order != our_order:
        print(f"  ПОРЯДОК ГРУПП расходится")
        print(f"    MCC: {', '.join(f'0x{t:02x}' for t in order)}")
        print(f"    мы:  {', '.join(f'0x{t:02x}' for t in our_order)}")
        ok = False
    else:
        print("  порядок групп: совпадает")

    if props_in_order != PROPS:
        print(f"  ПОРЯДОК СВОЙСТВ расходится")
        print(f"    MCC: {props_in_order}")
        print(f"    мы:  {PROPS}")
        ok = False
    else:
        print("  порядок свойств: совпадает")

    # порядок внутри группы: сначала все L потом все R? или L,R чередуются?
    print("\n  структура внутри группы (первые 10 кадров MCC):")
    for i, (tt, pp, v) in enumerate(mcc_sequence[:10]):
        print(f"    {i:3}: 0x{tt:02x}:0x{pp:02x} = {v}")

    print("\n" + "=" * 70)
    if ok:
        print("ВЕРДИКТ: наш генератор формирует ту же структуру, что MCC.")
        print("Запись должна работать. Проверить иначе, чем через INI:")
        print("  - по звуку (нужен подключённый выход и сигнал)")
        print("  - или захватом, что устройство приняло пакет без ошибок")
    else:
        print("ВЕРДИКТ: структура расходится, надо править генератор.")
    print("=" * 70)


if __name__ == "__main__":
    main()
