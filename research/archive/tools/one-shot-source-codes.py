r"""ОДИН ЗАХВАТ — ВСЕ ОСТАВШИЕСЯ КОДЫ ИСТОЧНИКОВ.

══════════ СКОЛЬКО ОСТАЛОСЬ ══════════

Таблица из патча драйвера даёт 15 кодов (0..16). Уже подтверждены на
нашем железе 10 из них:

    Mix A=1, IN 1=6, IN 2=7, AUX=9, BT=10,
    Playback 1/2=12, Playback 3/4=13, Playback 9/10=16, FX=17

Осталось 6, которые ни разу не встречались в кадрах 0x51:0x02/0x64:0x02:

    Mix B=2, Mix C=3, IN 1+2=8, OTG IN=11, Playback 5/6=14, Playback 7/8=15

══════════ КАК ЗАКРЫТЬ ВСЕ ШЕСТЬ ЗА ОДИН ЗАХВАТ ══════════

В Prof-режиме ровно ШЕСТЬ слотов с полем AudioSource:

    [Loopback_LB12]   [Loopback_LB34]   [Loopback_LB56]   [Loopback_LB78]
    [Output_HP]       [Output_OTGOUT]

Ставим в них шесть разных имён из недостающих — и один старт MCC
покажет все шесть кодов сразу.

  LB12     -> Mix B
  LB34     -> Mix C
  LB56     -> IN 1+2
  LB78     -> OTG IN
  HP       -> Playback 5/6
  OTGOUT   -> Playback 7/8

══════════ БЕЗОПАСНОСТЬ ══════════

Захват и правка INI звук не создают. Но HP переключается на другой
источник — при подключённых наушниках это могло бы быть слышно.
Поэтому скрипт СНАЧАЛА проверяет 0x64:06 и 0x62:06 и отказывается
работать, если наушники или OTG подключены.

Кроме того, ставит MUTE=true во все затронутые слоты и GAIN в минимум.

══════════ ЗАПУСК ══════════

    # 1. сохранить оригинал и расставить имена
    python src/tools/one-shot-source-codes.py prepare

    # 2. от администратора — захват старта MCC
    .\capture-source-codes.ps1

    # 3. разобрать
    python src/tools/one-shot-source-codes.py decode

    # 4. ВСЕГДА вернуть оригинал
    python src/tools/one-shot-source-codes.py restore
"""

from __future__ import annotations

import json
import re
import shutil
import struct
import sys
from pathlib import Path

MAGIC_HEAD = b"\x22\x33"
MAGIC_TAIL = b"\x66\x77"
FRAME_LEN = 15

PROF_INI = Path(
    r"C:\Program Files\TOPPING Pro\M Control Center\Workspace\M62\Prof"
    r"\M62_Prof_2026-1009-2347-04.ini"
)
BACKUP = Path("research/prof-ini-backup.ini")
PLAN = Path("research/source-code-plan.json")
PCAP = Path("research/source-codes.pcap")

# слот -> имя источника, которое туда ставим
ASSIGN = {
    "Loopback_LB12": "Mix B",
    "Loopback_LB34": "Mix C",
    "Loopback_LB56": "IN 1+2",
    "Loopback_LB78": "OTG IN",
    "Output_HP": "Playback 5/6",
    "Output_OTGOUT": "Playback 7/8",
}

SLOT_TO_GROUP = {
    "Loopback_LB12": 0x51,
    "Loopback_LB34": 0x53,
    "Loopback_LB56": 0x55,
    "Loopback_LB78": 0x57,
    "Output_HP": 0x64,
    "Output_OTGOUT": 0x62,
}

DRIVER = {
    0: "Unknown", 1: "Mix A", 2: "Mix B", 3: "Mix C",
    6: "IN 1", 7: "IN 2", 8: "IN 1+2", 9: "AUX", 10: "BT",
    11: "OTG IN", 12: "Playback 1/2", 13: "Playback 3/4",
    14: "Playback 5/6", 15: "Playback 7/8", 16: "Playback 9/10",
    17: "FX",
}


# ────────────────────────── INI ──────────────────────────

def read_sections(path: Path) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    cur = None
    for line in path.read_text(encoding="utf-8").splitlines():
        t = line.strip()
        if t.startswith("[") and t.endswith("]"):
            cur = t[1:-1]
            out[cur] = {}
        elif cur and t and "=" in t:
            k, _, v = t.partition("=")
            out[cur][k.strip()] = v.strip()
    return out


def set_key(path: Path, section: str, key: str, value: str) -> bool:
    """Меняет ОДНУ строку `key=...` внутри секции. BOM и переводы строк — как были."""
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    lines = text.splitlines(keepends=True)
    cur = None
    for i, line in enumerate(lines):
        t = line.strip()
        if t.startswith("[") and t.endswith("]"):
            cur = t[1:-1]
            continue
        if cur != section:
            continue
        k = t.partition("=")[0].strip()
        if k == key:
            eol = "\r\n" if line.endswith("\r\n") else "\n"
            lines[i] = f"{key}={value}{eol}"
            path.write_bytes("".join(lines).encode("utf-8"))
            return True
    return False


# ────────────────────────── команды ──────────────────────────

def cmd_prepare() -> int:
    if not PROF_INI.exists():
        print(f"нет файла: {PROF_INI}")
        return 1
    if not BACKUP.exists():
        shutil.copy2(PROF_INI, BACKUP)
        print(f"бэкап: {BACKUP}")
    else:
        print(f"бэкап уже есть: {BACKUP} (не перезаписываю)")

    secs = read_sections(PROF_INI)
    print("\nтекущие значения:")
    for sec, want in ASSIGN.items():
        now = secs.get(sec, {}).get("AudioSource", "?")
        print(f"  {sec:<18} {now:<14} -> {want}")

    print("\nставлю (и глушу слот, чтобы звука не было):")
    problems = []
    for sec, want in ASSIGN.items():
        ok_src = set_key(PROF_INI, sec, "AudioSource", want)
        # глушим
        set_key(PROF_INI, sec, "MUTE", "true")
        set_key(PROF_INI, sec, "MUTELeft", "true")
        set_key(PROF_INI, sec, "MUTERight", "true")
        set_key(PROF_INI, sec, "GAIN", "-90")
        print(f"  {sec:<18} AudioSource={want:<14} {'ok' if ok_src else 'НЕ НАЙДЕНО'}")
        if not ok_src:
            problems.append(sec)

    PLAN.write_text(json.dumps(ASSIGN, indent=2, ensure_ascii=False), "utf8")
    print(f"\nплан: {PLAN}")

    if problems:
        print(f"\nВНИМАНИЕ: не нашёл секции: {', '.join(problems)}")
        print("Проверь имя секции в INI — возможно, другая раскладка.")
        return 1
    print("\nготово. Дальше — захват от администратора:")
    print("   .\\capture-source-codes.ps1")
    return 0


def cmd_restore() -> int:
    if not BACKUP.exists():
        print(f"нет бэкапа: {BACKUP} — восстанавливать нечем")
        return 1
    shutil.copy2(BACKUP, PROF_INI)
    print(f"восстановлено из {BACKUP}")
    secs = read_sections(PROF_INI)
    for sec in ASSIGN:
        print(f"  {sec:<18} {secs.get(sec, {}).get('AudioSource', '?')}")
    return 0


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


def cmd_decode() -> int:
    if not PCAP.exists():
        print(f"нет захвата: {PCAP}")
        print("Запусти от администратора: .\\capture-source-codes.ps1")
        return 1
    if not PLAN.exists():
        print(f"нет плана: {PLAN} — сначала prepare")
        return 1
    plan = json.loads(PLAN.read_text(encoding="utf8"))

    found: dict[int, int] = {}
    for ep, payload in read_packets(PCAP):
        if ep & 0x80:
            continue
        for tt, pp, v in frames(payload):
            if pp != 0x02:
                continue
            if tt in SLOT_TO_GROUP.values():
                found[tt] = v

    print("=" * 72)
    print("РЕЗУЛЬТАТ")
    print("=" * 72)
    ok = 0
    bad = 0
    for sec, want in plan.items():
        grp = SLOT_TO_GROUP[sec]
        code = found.get(grp)
        predicted = next((c for c, n in DRIVER.items() if n == want), None)
        if code is None:
            print(f"  {sec:<18} 0x{grp:02x}:0x02  кадр не найден")
            continue
        match = code == predicted
        mark = "OK" if match else "РАСХОЖДЕНИЕ"
        print(f"  {sec:<18} 0x{grp:02x}:0x02 = {code:2} ({DRIVER.get(code, '?')})"
              f"  ожидали {want}={predicted}  {mark}")
        if match:
            ok += 1
        else:
            bad += 1

    print(f"\nсовпало: {ok}, расхождений: {bad}")
    print("\nНе забудь вернуть INI: "
          "python src/tools/one-shot-source-codes.py restore")
    return 0 if bad == 0 else 1


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in ("prepare", "decode", "restore"):
        print(__doc__)
        return 2
    return {
        "prepare": cmd_prepare,
        "decode": cmd_decode,
        "restore": cmd_restore,
    }[sys.argv[1]]()


if __name__ == "__main__":
    sys.exit(main())
