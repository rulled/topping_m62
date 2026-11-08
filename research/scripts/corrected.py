import re, struct, collections

mcc  = open(r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe","rb").read()
kbcc = open(r"C:\Program Files\TOPPING Pro\KB Control Center\KB Control Center.exe","rb").read()
fw   = open(r"E:\Programming shit\Topping\research\firmware\M62_FW87.05.45.48.27\M62_FW87.05.45.48.27.bin","rb").read()

def c32(d, tag):
    return len(re.findall(re.escape(struct.pack("<I", tag)), d))

print("=== CORRECTED: 32-bit immediate occurrences (x86 `C7 45 e0 <imm32>` form) ===")
print("  %-6s %-18s %8s %8s %8s" % ("tag","name","MCC","KBCC","M62FW"))

tags = [
 (0x4401,"Input1Level"),(0x4402,"Input2Level"),(0x4403,"AuxLevel"),(0x4404,"BluetoothLevel"),
 (0x4405,"OtgLevel"),(0x4406,"NoiseReduction"),(0x4407,"NRType"),(0x4408,"DryWet"),
 (0x4409,"Room"),(0x440a,"Decay"),(0x440b,"ReverbType"),(0x440c,"MuteFX"),(0x440f,"Width"),
 (0xb701,"Duck.Thresh"),(0xb702,"Duck.Attack"),(0xb703,"Duck.Reduc"),(0xb704,"Duck.Release"),
 (0xb705,"Duck.MapIN1"),(0xb706,"Duck.MapIN2"),(0xb707,"DuckSwIN1"),(0xb807,"DuckSwIN2"),
 (0xb301,"Comp.Switch"),(0xb302,"Comp.Thresh"),(0xb303,"Comp.Ratio"),(0xb304,"Comp.Attack"),
 (0xb305,"Comp.Release"),(0xb306,"Comp.Gain"),(0xb307,"Comp.GainAuto"),(0xb308,"Comp.Mix"),
 (0xc501,"Echo.PingPong"),(0xc502,"Echo.Mix"),(0xc503,"Echo.Output"),(0xc504,"Echo.Delay"),
 (0xc505,"Echo.?"),(0xc507,"Echo.Feedback"),(0xc508,"Echo.DirLeft"),
 (0xc601,"ReverbType2"),(0xc602,"Space"),(0xc603,"Mix2"),(0xc604,"DecayRate"),(0xc605,"Width2"),
 (0xc103,"Bypass"),
 (0x9103,"EQ.1"),(0x9108,"EQ.2"),(0x9403,"EQ.3"),(0x9408,"EQ.4"),
 (0x9b0f,"EQFX.Switch"),(0x9b0d,"EQFX.Gain"),(0xab0f,"EQHP.Switch"),(0xab14,"EQHP.GainInL"),
 (0x3103,"OutL.g1"),(0x3104,"OutL.g2"),(0x3203,"OutR.g1"),(0x3204,"OutR.g2"),
 (0x3303,"OTGL.g1"),(0x3403,"OTGR.g1"),(0x3501,"OutHP.MUTE"),(0x3601,"OutOTG.MUTE"),
 (0x5103,"LB12.GL"),(0x5104,"LB12.GL2"),(0x5203,"LB12.GR"),(0x5701,"LB12.src"),
 (0x5303,"LB34.GL"),(0x5403,"LB34.GR"),(0x5801,"LB34.src"),
 (0x5a03,"LB78.GL"),(0x5b03,"LB78.GR"),(0x5c01,"LB78.src"),
 (0x2102,"IN1.48V"),(0x2103,"IN1.INST"),(0x2105,"IN1.GAIN"),(0x2106,"IN1.MUTE"),
 (0x2305,"OTGIN.GAIN"),(0x2306,"OTGIN.MUTE"),(0x2501,"IN1.MIX"),(0x2502,"IN1.LCUT"),
]
present_in_fw = []
for t, name in tags:
    a, b, c = c32(mcc, t), c32(kbcc, t), c32(fw, t)
    flag = ""
    if c > 0:
        flag = "  <<< IN FIRMWARE"
        present_in_fw.append((t, name, a, b, c))
    elif b > 0 and a == 0:
        flag = "  (KB22 app only)"
    print("  0x%04x %-16s %8d %8d %8d%s" % (t, name, a, b, c, flag))

print("\n=== TAGS FOUND IN M62 FIRMWARE AS 32-BIT IMMEDIATES ===")
if present_in_fw:
    for t, name, a, b, c in present_in_fw:
        print("   0x%04x %-16s fw_hits=%d  (MCC=%d KBCC=%d)" % (t, name, c, a, b))
else:
    print("   NONE")

# ---------- show context of every fw hit to judge if it's a real tag ----------
print("\n=== context of each 32-bit hit in M62 firmware ===")
for t, name in tags:
    pat = struct.pack("<I", t)
    for m in re.finditer(re.escape(pat), fw):
        i = m.start()
        ctx = fw[max(0,i-8):i+8]
        print("   0x%04x %-16s @%08x  %s" % (t, name, i, " ".join("%02x" % b for b in ctx)))