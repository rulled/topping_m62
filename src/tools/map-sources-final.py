r"""ФИНАЛЬНАЯ карта источников микшера — по полным данным.

═══════════ ЧТО УСТАНОВЛЕНО ═══════════

Три прогона с уникальными значениями дали устойчивую картину.
Значения в устройстве квантуются с ошибкой ±1 Q25, поэтому сравнивать
надо с допуском, а не точно.

Подтверждено (одинаково в Mix B и Mix C, где источник есть в обоих):

    0x01/0x02  PB12      -15 dB
    0x03/0x04  PB34      -16 dB
    0x05/0x06  PB56      -17 dB
    0x07/0x08  PB78      -18 dB
    0x0b/0x0c  AUX       -12 dB   (перекрёстно подтверждено из Mix C)
    0x0f/0x10  BT        -13 dB   (перекрёстно подтверждено из Mix C)
    0x11/0x12  PB910     -19 dB
    0x13/0x14  FX        -14 dB

═══════════ ЧТО ОСТАЛОСЬ ═══════════

  0x09 / 0x0a      значение ОДИНАКОВО в L и R, смещено на -6.02 дБ
                   от INI. Это IN 1 и IN 2 — МОНО-источники:
                   каждый идёт в оба канала с ослаблением -6.02 дБ.

  0x0d / 0x0e      всегда 0. OTGIN до устройства не дошёл даже когда
                   в INI ему задали -24 дБ (проверено поиском значения
                   в захвате — ноль вхождений). Значит OTGIN
                   в матрицу не входит, пока OTG не активен.

═══════════ ПРОВЕРКА ГИПОТЕЗЫ «МОНО» ═══════════

Если IN1/IN2 действительно моно с ослаблением -6.02 дБ, то:
    INI -11 дБ  ->  в устройстве -17.02 дБ
    INI -21 дБ  ->  в устройстве -27.02 дБ
Оба наблюдаются ТОЧНО. Разница ровно 10 дБ, как и в INI.

Запуск: python src/tools/map-sources-final.py <файл.pcap> [dev]
"""

from __future__ import annotations

import math
import struct
import sys

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15
Q25_UNITY = 2**25

# Смещение для моно-источников (IN 1 / IN 2): -6.02 dB = половина.
MONO_OFFSET_DB = 20 * math.log10(0.5)

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
TOLERANCE = 6


def db_to_q25(db: float) -> int:
    return round(math.pow(10, db / 20) * Q25_UNITY)


def q25_to_db(value: int) -> float:
    return -999.0 if value == 0 else 20 * math.log10(value / Q25_UNITY)


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


def nearest(value: int, table: dict[str, int]) -> tuple[str | None, int]:
    best, best_err = None, TOLERANCE + 1
    for name, want in table.items():
        err = abs(value - want)
        if err < best_err:
            best_err, best = err, name
    return best, best_err


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("использование: map-sources-final.py <файл.pcap> [dev]")
    dev = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    mixer: dict[int, dict[int, int]] = {}
    for ep, payload in read_packets(sys.argv[1], dev):
        if ep & 0x80:
            continue
        for tt, pp, value in frames(payload):
            if 0x31 <= tt <= 0x3C:
                mixer.setdefault(tt, {})[pp] = value

    if not mixer:
        print("микшера не найдено")
        return

    exp_b = {n: db_to_q25(d) for n, d in MIX_B.items()}
    exp_c = {n: db_to_q25(d) for n, d in MIX_C.items()}
    # для моно: значение со смещением -6.02
    exp_b_mono = {n: db_to_q25(d + MONO_OFFSET_DB) for n, d in MIX_B.items()}
    exp_c_mono = {n: db_to_q25(d + MONO_OFFSET_DB) for n, d in MIX_C.items()}

    print("=" * 70)
    print("РАЗБОР MIX B")
    print("=" * 70)
    map_b: dict[str, int] = {}
    mono_b: dict[str, int] = {}
    for group, side in ((0x33, "L"), (0x34, "R")):
        if group not in mixer:
            continue
        print(f"\n  0x{group:02x} ({side}):")
        for prop in sorted(mixer[group]):
            value = mixer[group][prop]
            if not value:
                continue
            db = q25_to_db(value)
            name, err = nearest(value, exp_b)
            if name:
                print(f"    0x{prop:02x} = {value:9} ({db:+7.2f})  -> {name:6} стерео (err {err})")
                map_b.setdefault(name, prop)
                continue
            name, err = nearest(value, exp_b_mono)
            if name:
                print(f"    0x{prop:02x} = {value:9} ({db:+7.2f})  -> {name:6} МОНО   (err {err})")
                mono_b.setdefault(name, prop)
                continue
            print(f"    0x{prop:02x} = {value:9} ({db:+7.2f})  -> ?")

    print("\n" + "=" * 70)
    print("РАЗБОР MIX C (перекрёстная проверка)")
    print("=" * 70)
    map_c: dict[str, int] = {}
    mono_c: dict[str, int] = {}
    for group, side in ((0x35, "L"), (0x36, "R")):
        if group not in mixer:
            continue
        print(f"\n  0x{group:02x} ({side}):")
        for prop in sorted(mixer[group]):
            value = mixer[group][prop]
            if not value:
                continue
            db = q25_to_db(value)
            name, err = nearest(value, exp_c)
            if name:
                print(f"    0x{prop:02x} = {value:9} ({db:+7.2f})  -> {name:6} стерео (err {err})")
                map_c.setdefault(name, prop)
                continue
            name, err = nearest(value, exp_c_mono)
            if name:
                print(f"    0x{prop:02x} = {value:9} ({db:+7.2f})  -> {name:6} МОНО   (err {err})")
                mono_c.setdefault(name, prop)
                continue
            print(f"    0x{prop:02x} = {value:9} ({db:+7.2f})  -> ?")

    # ---------- итог ----------
    print("\n" + "=" * 70)
    print("ИТОГОВАЯ КАРТА")
    print("=" * 70)
    print(f"\n  {'источник':8} {'свойства':>12}  {'тип':8} {'B':>6} {'C':>6}  проверка")
    final: dict[str, tuple[int, str]] = {}
    for name in MIX_B:
        sb = map_b.get(name)
        sc = map_c.get(name)
        mb = mono_b.get(name)
        mc = mono_c.get(name)

        if sb is not None or mb is not None:
            prop = sb if sb is not None else mb
            kind = "стерео" if sb is not None else "моно"
            check = "—"
            if sc is not None or mc is not None:
                other = sc if sc is not None else mc
                check = "СОВПАЛО" if other == prop else f"расхожд. C=0x{other:02x}"
            pl = prop if prop % 2 == 1 else prop - 1
            print(f"  {name:8} 0x{pl:02x}/0x{pl+1:02x}   {kind:8} 0x{prop:02x} {('0x%02x' % other) if (sc or mc) else '  --':>6}  {check}")
            final[name] = (pl, kind)
        else:
            print(f"  {name:8} {'?':>12}  {'':8} {'':>6} {'':>6}  не найдено")

    # ---------- что осталось непонятным ----------
    known = set(final.values())
    used = {p for p, _ in final.values()}
    used |= {(p if p % 2 == 1 else p - 1) for p, _ in final.values()}
    print("\n  свойства без источника:")
    for prop in range(1, 21, 2):
        if prop in used:
            continue
        v = mixer.get(0x33, {}).get(prop) or mixer.get(0x33, {}).get(prop + 1)
        note = f"= {v} ({q25_to_db(v):+.2f} dB)" if v else "= 0 (mute)"
        print(f"    0x{prop:02x}/0x{prop+1:02x}  {note}")

    # ---------- константа ----------
    print("\n" + "=" * 70)
    print("КОНСТАНТА ДЛЯ КОДА")
    print("=" * 70)
    print("\n// Источники микшера: имя -> базовое свойство (L, R = L+1)")
    print("export const MIXER_SOURCES = {")
    for name, (prop, kind) in final.items():
        print(f"  {name.lower():8}: 0x{prop:02x},  // {kind}")
    print("};")
    print("\n// Моно-источники пишутся в ОБА канала с ослаблением -6.02 dB")


if __name__ == "__main__":
    main()
