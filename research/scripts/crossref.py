import json, re, struct

d = json.load(open(r"E:\Programming shit\Topping\research\protocol-deep.json", encoding="utf-8"))

print("="*78)
print("СОПОСТАВЛЕНИЕ: живое устройство vs то, что я нашёл в MCC")
print("="*78)

# Что я извлёк из MCC (упаковщики) в самом начале
print("""
Из MCC я извлёк упаковщики, которые строят кадры:
  case 7  FUN_140230b20 : Effect_Integration / Effect_NC / Effect_Reverb
           -> tag3 = 0x44xx
  case 9  (KBCC)        : Effect_DSP_Expand
  ...

Теперь у нас есть ЖИВОЙ поток. Сверяем.
""")

live = {f"{e['tt_hex']}:{e['pp_hex']}": e for e in d["entries"]}

print("=== семейство 0x44 (Effect_*) на живом устройстве ===")
for e in d["entries"]:
    if e["tt"] == 0x44:
        vals = ", ".join(f"{v['value']}(x{v['seen']})" for v in e["sample_values"][:5])
        print(f"  0x44:{e['pp_hex']}  {e['type']:<8} min={e['min']:<6} max={e['max']:<6} uniq={e['distinct']:<4} {vals}")

print("\n=== семейство 0x46 ===")
for e in d["entries"]:
    if e["tt"] == 0x46:
        vals = ", ".join(f"{v['value']}(x{v['seen']})" for v in e["sample_values"][:5])
        print(f"  0x46:{e['pp_hex']}  {e['type']:<8} min={e['min']:<6} max={e['max']:<6} uniq={e['distinct']:<4} {vals}")

print("\n=== семейство 0x12 ===")
for e in d["entries"]:
    if e["tt"] == 0x12:
        vals = ", ".join(f"{v['value']}" for v in e["sample_values"][:5])
        print(f"  0x12:{e['pp_hex']}  {e['type']:<8} value={vals}")

print("\n=== семейство 0x11 (device scope) ===")
for e in d["entries"]:
    if e["tt"] == 0x11:
        vals = ", ".join(f"{v['value']}" for v in e["sample_values"][:5])
        print(f"  0x11:{e['pp_hex']}  {e['type']:<8} value={vals}")

print("\n=== семейство 0x21 / 0x23 (вход 1 / aux) ===")
for e in d["entries"]:
    if e["tt"] in (0x21, 0x22, 0x23, 0x25, 0x27):
        vals = ", ".join(f"{v['value']}(x{v['seen']})" for v in e["sample_values"][:5])
        print(f"  0x{e['tt']:02x}:{e['pp_hex']}  {e['type']:<8} min={e['min']:<6} max={e['max']:<6} {vals}")

print("\n=== семейство 0x62 / 0x64 (выход otg / hp) ===")
for e in d["entries"]:
    if e["tt"] in (0x61, 0x62, 0x63, 0x64):
        vals = ", ".join(f"{v['value']}(x{v['seen']})" for v in e["sample_values"][:5])
        print(f"  0x{e['tt']:02x}:{e['pp_hex']}  {e['type']:<8} min={e['min']:<6} max={e['max']:<6} {vals}")

print("\n" + "="*78)
print("КЛЮЧЕВОЕ СОПОСТАВЛЕНИЕ")
print("="*78)
print("""
Из MCC (case 7, FUN_140230b20) я извлёк такие tag3:
  0x4401 Effect_Integration/Input1Level
  0x4402 .../Input2Level
  0x4403 .../AuxLevel
  0x4404 .../BluetoothLevel
  0x4405 .../OtgLevel
  0x4406 Effect_NC/NoiseReduction
  0x4407 Effect_NC/NoiseReductionType
  0x4408 Effect_Reverb/DryWet
  0x4409 .../Room
  0x440a .../Decay
  0x440b .../ReverbType
  0x440c .../MuteFX
  0x440f .../Width

ЖИВОЕ устройство отдаёт 0x44:0x01..0x0e!

НО: в кадре tag3 = БАЙТ, а в MCC "tag3" — это 16-битное слово.
Значит соответствие: MCC tag 0x44NN  <->  HID TT=0x44, PP=0xNN.
""")

print("\n=== ТОЧНОЕ СОПОСТАВЛЕНИЕ ===")
mcc_tags = {
    0x4401: "Effect_Integration/Input1Level",
    0x4402: "Effect_Integration/Input2Level",
    0x4403: "Effect_Integration/AuxLevel",
    0x4404: "Effect_Integration/BluetoothLevel",
    0x4405: "Effect_Integration/OtgLevel",
    0x4406: "Effect_NC/NoiseReduction",
    0x4407: "Effect_NC/NoiseReductionType",
    0x4408: "Effect_Reverb/DryWet",
    0x4409: "Effect_Reverb/Room",
    0x440a: "Effect_Reverb/Decay",
    0x440b: "Effect_Reverb/ReverbType",
    0x440c: "Effect_Reverb/MuteFX",
    0x440f: "Effect_Reverb/Width",
}
print(f"  {'MCC tag':<10} {'-> TT:PP':<12} {'живое значение':<28} совпало?")
for tag, name in sorted(mcc_tags.items()):
    tt = (tag >> 8) & 0xff
    pp = tag & 0xff
    key = f"0x{tt:02x}:0x{pp:02x}"
    e = live.get(key)
    if e:
        vals = ", ".join(f"{v['value']}" for v in e["sample_values"][:3])
        print(f"  0x{tag:04x}   {key:<12} {vals:<28} ДА  ({name})")
    else:
        print(f"  0x{tag:04x}   {key:<12} {'НЕ ПРИШЛО':<28} —   ({name})")