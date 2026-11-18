r"""Сверка нашей записи микшера с эталоном MCC.

═══════════ ЧТО СРАВНИВАЕМ ═══════════

    our.pcap   — что отправил наш код (src/tools/write-mixer-only.js)
    ref.pcap   — что отправляет MCC при старте

Для обоих извлекаем последовательность кадров микшера ВНУТРИ брекета
bulk push и сравниваем:

    1. Количество кадров.
    2. Порядок адресов (TT:PP) — должен совпасть кадр в кадр.
    3. Значения на разных местах — ожидаемо отличаются (мы писали другое).

Если 1 и 2 совпадают — структура нашего пакета идентична MCC, значит
устройство примет запись так же.

Запуск: python src/tools/verify-our-write.py <our.pcap> <ref.pcap> [dev]
"""

from __future__ import annotations

import struct
import sys

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25


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
    """Кадры микшера внутри брекета bulk push."""
    seq = []
    in_bracket = False
    found_bracket = False
    for ep, payload in read_packets(path, dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            if tt == 0x11 and pp == 0x20:
                in_bracket = value == 1
                found_bracket = True
                continue
            if in_bracket and 0x31 <= tt <= 0x3C:
                seq.append((tt, pp, value))
    return seq, found_bracket


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("использование: verify-our-write.py <our.pcap> <ref.pcap> [dev]")
    our_path, ref_path = sys.argv[1], sys.argv[2]
    dev = int(sys.argv[3]) if len(sys.argv) > 3 else 6

    our, our_br = mixer_sequence(our_path, dev)
    ref, ref_br = mixer_sequence(ref_path, dev)

    print(f"наша запись: {len(our)} кадров микшера (брекет: {'да' if our_br else 'НЕТ'})")
    print(f"эталон MCC:  {len(ref)} кадров микшера (брекет: {'да' if ref_br else 'НЕТ'})")

    if not our:
        print("\nОШИБКА: в нашей записи нет кадров микшера.")
        return
    if not ref:
        print("\nОШИБКА: в эталоне нет кадров микшера.")
        return

    # ─── 1. размер ───
    print("\n" + "=" * 68)
    print("1. РАЗМЕР")
    print("=" * 68)
    if len(our) == len(ref):
        print(f"  {len(our)} = {len(ref)}   OK")
    else:
        print(f"  {len(our)} != {len(ref)}   РАСХОЖДЕНИЕ")

    # ─── 2. порядок адресов ───
    print("\n" + "=" * 68)
    print("2. ПОРЯДОК АДРЕСОВ")
    print("=" * 68)

    our_addrs = [(t, p) for t, p, _ in our]
    ref_addrs = [(t, p) for t, p, _ in ref]
    n = min(len(our_addrs), len(ref_addrs))

    mismatch = []
    for i in range(n):
        if our_addrs[i] != ref_addrs[i]:
            mismatch.append(i)

    if not mismatch:
        print(f"  все {n} адресов совпадают по порядку   OK")
    else:
        print(f"  расхождений: {len(mismatch)} из {n}")
        for i in mismatch[:12]:
            ot, op = our_addrs[i]
            rt, rp = ref_addrs[i]
            print(f"    {i:3}: мы 0x{ot:02x}:0x{op:02x}   MCC 0x{rt:02x}:0x{rp:02x}")

    # ─── 3. значения ───
    print("\n" + "=" * 68)
    print("3. ЗНАЧЕНИЯ (ожидаемо различаются — мы писали другое)")
    print("=" * 68)

    diff = 0
    same = 0
    for i in range(n):
        ov = our[i][2]
        rv = ref[i][2]
        if ov == rv:
            same += 1
        else:
            diff += 1

    print(f"  совпало: {same}, различается: {diff}")

    # что именно мы поменяли
    print("\n  наши НЕнулевые кадры:")
    for t, p, v in our:
        if v:
            db = 20 * __import__("math").log10(v / Q25_UNITY) if v else -999
            print(f"    {t:02x}:{p:02x} = {v} ({db:+.2f} дБ)")

    print("\n  эталонные НЕнулевые (первые 12):")
    shown = 0
    for t, p, v in ref:
        if v and shown < 12:
            db = 20 * __import__("math").log10(v / Q25_UNITY) if v else -999
            print(f"    {t:02x}:{p:02x} = {v} ({db:+.2f} дБ)")
            shown += 1

    # ─── вердикт ───
    print("\n" + "=" * 68)
    print("ВЕРДИКТ")
    print("=" * 68)
    if len(our) == len(ref) and not mismatch:
        print("  СТРУКТУРА СОВПАДАЕТ с MCC: размер и порядок адресов идентичны.")
        print("  Значит устройство примет нашу запись так же, как запись MCC.")
        print("  Микшер управляется нашим кодом без M Control Center.")
    else:
        print("  Структура РАСХОДИТСЯ. Надо править buildMixerPacket.")
        if len(our) != len(ref):
            print(f"    размер: {len(our)} vs {len(ref)}")
        if mismatch:
            print(f"    первое расхождение на позиции {mismatch[0]}")
    print("=" * 68)


if __name__ == "__main__":
    main()
