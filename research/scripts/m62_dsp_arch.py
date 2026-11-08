import re, struct, collections, math, os

p = r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin"
d = open(p, "rb").read()
N = len(d)

# ============================================================
# ГИПОТЕЗА: это код, но НЕ той архитектуры, что мы проверяли.
# Проверим DSP-ядра и экзотику.
# ============================================================

print("="*74)
print("ПРОВЕРКА DSP-ЯДЕР И ЭКЗОТИЧЕСКИХ АРХИТЕКТУР")
print("="*74)

def cnt(pat, buf=None):
    b = buf if buf is not None else d
    return len(re.findall(re.escape(pat), b))

# --- Analog Devices SHARC / SigmaDSP: 48-bit and 32-bit instructions ---
print("\n--- Analog Devices (SHARC / SigmaDSP / ADAU) ---")
# SHARC: 48-битные инструкции; частый опкод "modify" = 0x20.., "compute" = 0x40..
# SigmaDSP: 32-битные слова, часто 0x00.. в старшем байте
# Прокси: проверим, кратны ли dword типичным маскам
"""
ADAU SigmaDSP инструкции: старшие 5 бит = опкод. Часто встречаются
               0x00, 0x01, 0x02 (NOP, load, etc.)
"""
sig = collections.Counter()
for i in range(0, N-4, 4):
    w = struct.unpack_from("<I", d, i)[0]
    sig[w >> 27] += 1
tot = sum(sig.values())
print("  распределение старших 5 бит dword (SigmaDSP-подобное):")
for k in sorted(sig, key=lambda x: -sig[x])[:8]:
    print("    op[%02d] (0x%02x..) : %6d  %.2f%%" % (k, k << 27 if k else 0, sig[k], 100*sig[k]/tot))

# --- CEVA / Cadence (HiFi DSP) ---
print("\n--- HiFi / CEVA (16/24/32-bit VLIW) ---")
print("  'nop' 16-бит 0x0000 :", d.count(b"\x00\x00"))
print("  'ret' 16-бит 0x0000 варианты уникальны, см. ниже")

# --- Tensilica Xtensa (ESP32) ---
print("\n--- Tensilica Xtensa (ESP32/ESP32-S3) ---")
# Xtensa: entry a1, N  = 0x36 0x41 (16-bit 'entry' = 0x36xx)
#          retw.n = 0xf00d, rsync
xt = {
 "entry (16-bit) 36 xx": re.compile(rb"\x36[\x00-\xff]"),
 "retw.n 0d f0":        re.compile(rb"\x0d\xf0"),
 "rsync 10 f0 / nop.n 3d f0": re.compile(rb"\x10\xf0"),
 "l32i.n 20-2f":        re.compile(rb"[\x20-\x2f][\x00-\xff]"),
}
for k, rx in xt.items():
    print("  %-34s %6d" % (k, len(rx.findall(d))))

# --- Xtensa: the 'entry' instruction is extremely common in real code ---
print("\n  ВАЖНО: ищем именно Xtensa `entry` (0x36 0x41 = a1,32) :",
      cnt(b"\x36\x41"))

# --- Qualcomm Kalimba (audio DSP!) ---
print("\n--- Qualcomm Kalimba (используется в аудио) ---")
# Kalimba: 32-бит слова, но часто 16-бит opcode + 16-бит operand
for name, pat in [("0x0000", b"\x00\x00"), ("0xFFFF", b"\xff\xff"),
                  ("jump 0x20..", b"\x20\x00")]:
    print("  %-16s %d" % (name, cnt(pat)))

# --- Bela/other: check 24-bit packed words ---
print("\n--- 24-битные упакованные слова (часто у DSP) ---")
c24 = collections.Counter()
for i in range(0, N-3, 3):
    w = d[i] | (d[i+1] << 8) | (d[i+2] << 16)
    c24[w >> 16] += 1
tot24 = sum(c24.values())
print("  распределение старшего байта 24-бит слова:")
for k in sorted(c24, key=lambda x: -c24[x])[:8]:
    print("    hi=0x%02x : %6d  %.2f%%" % (k, c24[k], 100*c24[k]/tot24))

# ============================================================
# РЕШАЮЩИЙ ТЕСТ: 16-битная инструкционная статистика
#   Для 16/32-бит RISC (Xtensa, Kalimba, HiFi) верхние биты 16-бит
#   единиц распределены НЕравномерно, но с узкими пиками.
# ============================================================
print("\n" + "="*74)
print("РЕШАЮЩИЙ ТЕСТ: 16-битные пики (top-16 слов) по регионам")
print("="*74)
for name, a, b in [("0x00000-0x10000", 0x00000, 0x10000),
                   ("0x20000-0x30000", 0x20000, 0x30000),
                   ("0x40000-0x50000", 0x40000, 0x50000),
                   ("0x60000-0x70000", 0x60000, 0x70000),
                   ("0x80000-0x90000", 0x80000, 0x90000),
                   ("0xa0000-0xb0000", 0xa0000, 0xb0000),
                   ("0xe0000-0xf0000", 0xe0000, 0xf0000),
                   ("0x100000-0x110000", 0x100000, 0x110000)]:
    w = [struct.unpack_from("<H", d, i)[0] for i in range(a, min(b, N-1), 2)]
    c = collections.Counter(w)
    top = c.most_common(6)
    share = sum(v for _, v in c.most_common(16)) / len(w)
    print("  %-18s уник=%5d  top16=%.1f%%  %s" % (
        name, len(c), 100*share, " ".join("%04x:%d" % (k, v) for k, v in top)))

# ============================================================
# Сравнение с РЕАЛЬНЫМ ARM-кодом (загрузчик KB22)
# ============================================================
print("\n--- контроль: ARM-загрузчик KB22 ---")
kb = open(r"E:\Programming shit\Topping\research\firmware\KB22_FW49_07_19_20_20\KB22_FW49_07_19_20_20.Topping","rb").read()
kb_ldr = kb[0x408000:0x418000]
w = [struct.unpack_from("<H", kb_ldr, i)[0] for i in range(0, len(kb_ldr)-1, 2)]
c = collections.Counter(w)
print("  уник=%d  top16=%.1f%%" % (len(c), 100*sum(v for _, v in c.most_common(16))/len(w)))

print("\n--- контроль: случайные байты ---")
rnd = os.urandom(65536)
w = [struct.unpack_from("<H", rnd, i)[0] for i in range(0, len(rnd)-1, 2)]
c = collections.Counter(w)
print("  уник=%d  top16=%.1f%%" % (len(c), 100*sum(v for _, v in c.most_common(16))/len(w)))