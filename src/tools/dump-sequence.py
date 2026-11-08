r"""Дамп точной последовательности кадров микшера — чтобы понять вложенность.

═══════════ ЗАЧЕМ ═══════════

Наш пакет структурно расходится с MCC на 180 позициях из 200. Мои догадки
о вложенности циклов не сходятся с данными, поэтому надо просто ПОСМОТРЕТЬ
на реальную последовательность и вывести закономерность из неё.

Выводит:
  - первые 30 кадров с номерами позиций;
  - какие свойства идут подряд в одной группе;
  - переходы: после какого кадра меняется группа / свойство.

Запуск: python src/tools/dump-sequence.py <файл.pcap> [dev]
"""

from __future__ import annotations

import struct
import sys

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15


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


def mixer_sequence(path: str, dev: int):
    seq = []
    in_bracket = False
    for ep, payload in read_packets(path, dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            if tt == 0x11 and pp == 0x20:
                in_bracket = value == 1
                continue
            if in_bracket and 0x31 <= tt <= 0x3C:
                seq.append((tt, pp, value))
    return seq


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: dump-sequence.py <файл.pcap> [dev]")
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    seq = mixer_sequence(sys.argv[1], dev)
    if not seq:
        print("кадров микшера нет")
        return

    print(f"всего кадров: {len(seq)}\n")

    print("=" * 60)
    print("ПЕРВЫЕ 40 КАДРОВ")
    print("=" * 60)
    for i, (tt, pp, v) in enumerate(seq[:40]):
        print(f"  {i:3}: tt=0x{tt:02x} pp=0x{pp:02x}  v={v}")

    print("\n" + "=" * 60)
    print("КАКИЕ СВОЙСТВА ИДУТ ПОДРЯД (по кадрам, где группа не меняется)")
    print("=" * 60)
    runs = []
    cur_tt = None
    cur_pp_run = []
    for tt, pp, _ in seq:
        if tt != cur_tt:
            if cur_tt is not None:
                runs.append((cur_tt, cur_pp_run))
            cur_tt = tt
            cur_pp_run = [pp]
        else:
            cur_pp_run.append(pp)
    if cur_tt is not None:
        runs.append((cur_tt, cur_pp_run))

    for tt, pps in runs[:14]:
        print(f"  0x{tt:02x}: {len(pps)} кадров, свойства {', '.join(f'0x{p:02x}' for p in pps)}")

    print("\n" + "=" * 60)
    print("ПЕРЕХОДЫ: когда меняется свойство (группы идут подряд?)")
    print("=" * 60)
    # найдём индексы, где меняется PP
    pp_changes = []
    for i in range(1, len(seq)):
        if seq[i][1] != seq[i - 1][1]:
            pp_changes.append(i)
    print(f"  свойство меняется на позициях: {pp_changes[:14]}")
    print(f"  это {len(pp_changes)} смен на {len(seq)} кадров")

    if pp_changes:
        first = pp_changes[0]
        print(f"\n  первый блок свойства 0x{seq[0][1]:02x}: позиции 0..{first - 1}")
        groups_in_block = [f"0x{t:02x}" for t, _, _ in seq[:first]]
        print(f"    группы в блоке: {', '.join(groups_in_block)}")

        if len(pp_changes) > 1:
            second = pp_changes[1]
            print(f"  второй блок (0x{seq[first][1]:02x}): позиции {first}..{second - 1}")
            groups2 = [f"0x{t:02x}" for t, _, _ in seq[first:second]]
            print(f"    группы в блоке: {', '.join(groups2)}")

    print("\n" + "=" * 60)
    print("УНИКАЛЬНЫЕ ПОСЛЕДОВАТЕЛЬНОСТИ")
    print("=" * 60)
    props_order = []
    seen_p = set()
    for _, pp, _ in seq:
        if pp not in seen_p:
            seen_p.add(pp)
            props_order.append(pp)
    print(f"  порядок первого появления свойств: {', '.join(f'0x{p:02x}' for p in props_order)}")

    groups_order = []
    seen_g = set()
    for tt, _, _ in seq:
        if tt not in seen_g:
            seen_g.add(tt)
            groups_order.append(tt)
    print(f"  порядок первого появления групп:   {', '.join(f'0x{g:02x}' for g in groups_order)}")


if __name__ == "__main__":
    main()
