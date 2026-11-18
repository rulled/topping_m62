r"""ПРОВЕРКА КАЖДОГО КОДА ИСТОЧНИКА НА ЖИВЫХ ЗАХВАТАХ.

══════════ ЗАЧЕМ ══════════

Таблица из патча драйвера даёт коды, но их надо подтвердить на нашем
железе. У loopback и выходов есть пара «код источника + значение»,
и если в каком-то захвате INI говорил «AudioSource = X», а в кадре
0x51:0x02 (или 0x64:0x02) стоял код C — это прямое подтверждение.

Учитываем: INI и захват должны быть из ОДНОГО режима и желательно
одного прогона. Поэтому сверяем по имени файла/режиму.

Запуск: python src/tools/confirm-source-codes.py
"""

from __future__ import annotations

import struct
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

DRIVER = {
    0: "Unknown", 1: "Mix A", 2: "Mix B", 3: "Mix C",
    6: "IN 1", 7: "IN 2", 8: "IN 1+2", 9: "AUX", 10: "BT",
    11: "OTG IN", 12: "Playback 1/2", 13: "Playback 3/4",
    14: "Playback 5/6", 15: "Playback 7/8", 16: "Playback 9/10",
    17: "FX",
}

WS = Path(r"C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62")


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


def read_ini(path: Path) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    cur = None
    try:
        text = path.read_text(encoding="utf-8-sig")
    except Exception:
        return out
    for line in text.splitlines():
        t = line.strip()
        if t.startswith("[") and t.endswith("]"):
            cur = t[1:-1]
            out[cur] = {}
        elif cur and t and "=" in t:
            k, _, v = t.partition("=")
            out[cur][k.strip()] = v.strip()
    return out


def main() -> None:
    # все INI, где есть AudioSource
    ini_by_section: dict[str, list[tuple[str, str]]] = {}
    for p in WS.rglob("*.ini"):
        secs = read_ini(p)
        for name, kv in secs.items():
            src = kv.get("AudioSource")
            if src:
                ini_by_section.setdefault(name, []).append((p.name, src))

    confirmed: dict[int, set[str]] = {}
    contradicted: list[str] = []

    print("=" * 76)
    print("КАДРЫ В ЗАХВАТАХ  (0x51..0x58 / 0x62 / 0x64, свойство 0x02)")
    print("=" * 76)

    for pcap in sorted(Path("research").glob("*.pcap")):
        found: dict[int, set[int]] = {}
        for ep, payload in read_packets(pcap):
            if ep & 0x80:
                continue  # только хост -> устройство
            for tt, pp, v in frames(payload):
                if pp != 0x02:
                    continue
                if 0x51 <= tt <= 0x58 or tt in (0x62, 0x64):
                    found.setdefault(tt, set()).add(v)
        if not found:
            continue
        print(f"\n{pcap.name}:")
        for tt in sorted(found):
            for code in sorted(found[tt]):
                name = DRIVER.get(code, f"?{code}")
                print(f"  0x{tt:02x}:0x02 = {code:2}  ({name})")
                if code in DRIVER:
                    confirmed.setdefault(code, set()).add(f"{pcap.name}:0x{tt:02x}")

    # --- сверка с INI ---
    print("\n" + "=" * 76)
    print("СВЕРКА С INI: если для секции известен AudioSource, код должен совпасть")
    print("=" * 76)

    checks = [
        (0x51, "Loopback_LB12"),
        (0x53, "Loopback_LB34"),
        (0x55, "Loopback_LB56"),
        (0x57, "Loopback_LB78"),
        (0x64, "Output_HP"),
        (0x62, "Output_OTGOUT"),
    ]
    ok = 0
    bad = 0
    for code, refs in sorted(confirmed.items()):
        mapped = DRIVER.get(code)
        if not mapped:
            continue
        for ref in sorted(refs):
            pname, addr = ref.split(":0x")
            tt = int(addr, 16)
            sec = dict((t, s) for t, s in checks).get(tt)
            if not sec:
                continue
            candidates = ini_by_section.get(sec, [])
            if not candidates:
                continue
            for fname, src in candidates:
                # сравниваем только однопрофильные совпадения по режиму
                same_run = "main" in fname and "main" in pname or fname not in pname
                if not same_run:
                    continue
                match = src == mapped
                mark = "OK" if match else "РАСХОЖДЕНИЕ"
                print(f"  {pname:<26} 0x{tt:02x}:0x02={code:<2} {mapped:<14}"
                      f" INI {sec}.AudioSource={src:<14} {mark}")
                if match:
                    ok += 1
                else:
                    bad += 1

    print("\n" + "=" * 76)
    print("ИТОГ")
    print("=" * 76)
    for code in sorted(DRIVER):
        refs = confirmed.get(code)
        mark = "подтверждён на железе" if refs else "только из таблицы драйвера"
        print(f"  {code:>2}  {DRIVER[code]:<14} {mark}")
    print(f"\nсовпало с INI: {ok}, расхождений: {bad}")


if __name__ == "__main__":
    main()
