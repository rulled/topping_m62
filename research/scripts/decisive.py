import re

bins = {
    "MCC": r"C:\Program Files\TOPPING Pro\M Control Center\M Control Center.exe",
    "KBCC": r"C:\Program Files\TOPPING Pro\KB Control Center\KB Control Center.exe",
}
S = {}
D = {}
for k, p in bins.items():
    d = open(p, "rb").read(); D[k] = d
    st = set()
    for m in re.finditer(rb"[\x20-\x7e]{4,}", d):
        st.add(m.group().decode("ascii"))
    for m in re.finditer(rb"(?:[\x20-\x7e]\x00){4,}", d):
        st.add(m.group().decode("utf-16-le", errors="ignore"))
    S[k] = st

print("=== EXACT effect-module / parameter strings ===")
print("  %-26s %-6s %-6s" % ("string", "MCC", "KBCC"))
kw = ["Effect_DSP_Expand","Effect_DSP_Close","DSP effect","DSP Effects",
      "Compressor_FX","Echo_FX","Rever_FX","EQ_FX","EQ_HP","Ducking","NoiseReduction",
      "Crossfeed","Expander","Expand","PingPong","Feedback","DirectionLeft",
      "DuckingSwitchIN1","DuckingSwitchIN2","MapIN1","MapIN2",
      "Mixer_IN1L","Mixer_IN1R","Mixer_OTGINL","Mixer_OTGINR","Mixer_FXL","Mixer_FXR",
      "Mixer_PB12L","Mixer_PB78R","GainML","GainMR",
      "DryWet","ReverbType","MuteFX","DecayRate","Width","Room","Decay",
      "Effect_Integration","Effect_NC","Effect_Reverb","Effect_Compressor",
      "VocalEnhance","SpatialEnhance","OutputEnhance",
      "Threshold","Ratio","Attack","Release","Reduction","GainAuto",
      "Shelf","Peak","LowPass","HighPass","AllPass","Notch","BandPass",
      "software_eq","HIFI","Game","ProAudio","Pro Audio"]
for s in kw:
    a = "Y" if s in S["MCC"] else "-"
    b = "Y" if s in S["KBCC"] else "-"
    mark = "   <<<" if (a=="-" and b=="Y") else ""
    print("  %-26s %-6s %-6s%s" % (s, a, b, mark))

print("\n=== tag constant check as 2-byte LE (exact, with context sanity) ===")
import struct
def count_tag(d, tag):
    pat = struct.pack("<H", tag)
    return len(re.findall(re.escape(pat), d))

tags = {
 0x4401:"Input1Level",0x4402:"Input2Level",0x4403:"AuxLevel",0x4404:"BluetoothLevel",
 0x4405:"OtgLevel",0x4406:"NoiseReduction",0x4407:"NRType",
 0x4408:"DryWet",0x4409:"Room",0x440a:"Decay",0x440b:"ReverbType",0x440c:"MuteFX",0x440f:"Width",
 0xb701:"Duck.Threshold",0xb702:"Duck.Attack",0xb703:"Duck.Reduction",0xb704:"Duck.Release",
 0xb705:"Duck.MapIN1",0xb706:"Duck.MapIN2",0xb707:"DuckSwIN1",0xb807:"DuckSwIN2",
 0xb301:"Comp.Switch",0xb302:"Comp.Thresh",0xb303:"Comp.Ratio",0xb304:"Comp.Attack",
 0xb305:"Comp.Release",0xb306:"Comp.Gain",0xb307:"Comp.GainAuto",0xb308:"Comp.Mix",
 0xc501:"Echo.PingPong",0xc502:"Echo.Mix",0xc503:"Echo.Output",0xc504:"Echo.Delay",
 0xc507:"Echo.Feedback",0xc508:"Echo.DirLeft",0xc103:"Bypass",0xc601:"ReverbType2",
 0xc602:"Space",0xc603:"Mix",0xc604:"DecayRate",0xc605:"Width2",
 0x9103:"EQ.lo1",0x9108:"EQ.lo2",0x9403:"EQ.mid1",0x9408:"EQ.mid2",
 0x9b0f:"EQFX.Switch",0x9b0d:"EQFX.Gain",0xab0f:"EQHP.Switch",0xab14:"EQHP.GainInL",
 0x3103:"OutL.gain1",0x3203:"OutR.gain1",0x3303:"OTGL.gain1",0x3403:"OTGR.gain1",
 0x5103:"LB12.GL",0x5203:"LB12.GR",0x5701:"LB12.src",
 0x2101:"IN1.x",0x2102:"IN1.48V",0x2103:"IN1.INST",0x2105:"IN1.GAIN",0x2106:"IN1.MUTE",
 0x2305:"OTGIN.GAIN",0x2306:"OTGIN.MUTE",0x2501:"IN1.MIX",0x2502:"IN1.LCUT",
 0x1101:"Auth",0x1104:"Luminance",0x1105:"WsDownload",0x1107:"HeartBeat",
 0x1109:"ModeSelect",0x110c:"SyncApplied",0x110d:"NeedSync",0x1110:"UpdateFw",
}
print("  %-6s %-16s %8s %8s  %s" % ("tag","name","MCC","KBCC","note"))
interesting = []
for t, name in sorted(tags.items()):
    a = count_tag(D["MCC"], t); b = count_tag(D["KBCC"], t)
    note = ""
    if a > 0:
        note = "present in MCC!"
        interesting.append((t, name, a, b))
    print("  0x%04x %-16s %8d %8d  %s" % (t, name, a, b, note))

print("\n=== tags with nonzero MCC hits (would prove M62 knows them) ===")
for t,name,a,b in interesting:
    print("   0x%04x %-16s MCC=%d KBCC=%d" % (t,name,a,b))