/**
 * ЧТЕНИЕ HID REPORT DESCRIPTOR устройства.
 *
 * Нужно, чтобы ответить на ключевой вопрос:
 * сможет ли Chrome WebHID работать с M62 напрямую из браузера?
 *
 * WebHID требует:
 *   - валидный report descriptor;
 *   - usagePage/usage, по которым можно запросить разрешение;
 *   - input/output reports через interrupt endpoints (не feature).
 */
import { execFileSync } from 'node:child_process';

const PS = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public class Hid {
  [StructLayout(LayoutKind.Sequential)]
  public struct HIDD_ATTRIBUTES {
    public int Size; public ushort VendorID; public ushort ProductID; public ushort VersionNumber;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct HIDP_CAPS {
    public ushort Usage; public ushort UsagePage;
    public ushort InputReportByteLength; public ushort OutputReportByteLength;
    public ushort FeatureReportByteLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort NumberLinkCollectionNodes;
    public ushort NumberInputButtonCaps; public ushort NumberInputValueCaps;
    public ushort NumberInputDataIndices;
    public ushort NumberOutputButtonCaps; public ushort NumberOutputValueCaps;
    public ushort NumberOutputDataIndices;
    public ushort NumberFeatureButtonCaps; public ushort NumberFeatureValueCaps;
    public ushort NumberFeatureDataIndices;
  }

  [DllImport("hid.dll")] public static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("hid.dll")] public static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES a);
  [DllImport("hid.dll")] public static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr p);
  [DllImport("hid.dll")] public static extern bool HidD_FreePreparsedData(IntPtr p);
  [DllImport("hid.dll", CharSet = CharSet.Unicode)]
  public static extern bool HidD_GetProductString(SafeFileHandle h, System.Text.StringBuilder b, int len);
  [DllImport("hid.dll")]
  public static extern int HidP_GetCaps(IntPtr p, ref HIDP_CAPS c);

  [DllImport("setupapi.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr h, int f);
  [DllImport("setupapi.dll", CharSet = CharSet.Auto)]
  public static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, int i, ref SP_DEVICE_INTERFACE_DATA data);
  [DllImport("setupapi.dll", CharSet = CharSet.Auto)]
  public static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref SP_DEVICE_INTERFACE_DATA d, IntPtr detail, int size, out int needed, IntPtr info);

  [StructLayout(LayoutKind.Sequential)]
  public struct SP_DEVICE_INTERFACE_DATA {
    public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
}

public class Probe {
  public static string Run() {
    Guid hidGuid;
    Hid.HidD_GetHidGuid(out hidGuid);
    IntPtr set = Hid.SetupDiGetClassDevs(ref hidGuid, IntPtr.Zero, IntPtr.Zero, 0x12);
    if (set == (IntPtr)(-1)) return "ERR setupdi";

    var sb = new System.Text.StringBuilder();
    int idx = 0;
    var ifd = new Hid.SP_DEVICE_INTERFACE_DATA();
    ifd.cbSize = Marshal.SizeOf(ifd);

    while (Hid.SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref hidGuid, idx, ref ifd)) {
      idx++;
      int needed = 0;
      Hid.SetupDiGetDeviceInterfaceDetail(set, ref ifd, IntPtr.Zero, 0, out needed, IntPtr.Zero);
      if (needed <= 0) continue;
      IntPtr detail = Marshal.AllocHGlobal(needed);
      Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
      if (!Hid.SetupDiGetDeviceInterfaceDetail(set, ref ifd, detail, needed, out needed, IntPtr.Zero)) {
        Marshal.FreeHGlobal(detail);
        continue;
      }
      IntPtr pathPtr = (IntPtr)((long)detail + 4);
      string path = Marshal.PtrToStringUni(pathPtr);
      Marshal.FreeHGlobal(detail);

      if (path == null || path.IndexOf("vid_152a", StringComparison.OrdinalIgnoreCase) < 0) continue;

      var h = Hid.CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
      if (h.IsInvalid) { sb.AppendLine(path + " | OPEN FAIL"); continue; }

      var attr = new Hid.HIDD_ATTRIBUTES();
      attr.Size = Marshal.SizeOf(attr);
      Hid.HidD_GetAttributes(h, ref attr);

      var caps = new Hid.HIDP_CAPS();
      caps.Reserved = new ushort[17];
      IntPtr pp = IntPtr.Zero;
      string capsStr = "no-caps";
      if (Hid.HidD_GetPreparsedData(h, out pp)) {
        if (Hid.HidP_GetCaps(pp, ref caps) == 0x110000) {
          capsStr = string.Format("UsagePage=0x{0:X2} Usage=0x{1:X2} In={2} Out={3} Feat={4}",
            caps.UsagePage, caps.Usage, caps.InputReportByteLength, caps.OutputReportByteLength, caps.FeatureReportByteLength);
        }
        Hid.HidD_FreePreparsedData(pp);
      }

      var prod = new System.Text.StringBuilder(260);
      Hid.HidD_GetProductString(h, prod, 260);

      sb.AppendLine(string.Format("VID={0:X4} PID={1:X4} ver={2:X4} product='{3}'",
        attr.VendorID, attr.ProductID, attr.VersionNumber, prod.ToString()));
      sb.AppendLine("  " + capsStr);
      sb.AppendLine("  path=" + path);
      h.Close();
    }
    return sb.ToString();
  }
}
'@
[Probe]::Run()
`;

try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', PS], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  console.log(out.trim());
} catch (e) {
  console.error('ошибка:', e.message);
  if (e.stdout) console.log(e.stdout.toString());
}
