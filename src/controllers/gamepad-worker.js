'use strict';

/** PowerShell/C# bridge do gamepad virtual Xbox 360 (ViGEm). */

function fonteWorker() {
  return String.raw`
$ErrorActionPreference = 'Stop'
$sig = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class ChatPlaysGamepad {
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct XUSB_REPORT {
        public ushort wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    const uint VIGEM_ERROR_NONE = 0x20000000;
    static IntPtr Client = IntPtr.Zero;
    static IntPtr Target = IntPtr.Zero;
    static XUSB_REPORT Report;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetDllDirectory(string lpPathName);

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr vigem_alloc();
    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void vigem_free(IntPtr client);
    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern uint vigem_connect(IntPtr client);
    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void vigem_disconnect(IntPtr client);
    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr vigem_target_x360_alloc();
    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void vigem_target_free(IntPtr target);
    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern uint vigem_target_add(IntPtr client, IntPtr target);
    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern uint vigem_target_remove(IntPtr client, IntPtr target);
    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern uint vigem_target_x360_update(IntPtr client, IntPtr target, XUSB_REPORT report);

    static void EnsureOk(uint code, string step) {
        if (code != VIGEM_ERROR_NONE) {
            throw new InvalidOperationException(step + " falhou (ViGEm 0x" + code.ToString("X8") + ")");
        }
    }

    public static void Init(string dllPath) {
        if (!String.IsNullOrWhiteSpace(dllPath) && !dllPath.Equals("ViGEmClient.dll", StringComparison.OrdinalIgnoreCase)) {
            string full = Path.GetFullPath(dllPath);
            string dir = Path.GetDirectoryName(full);
            if (!String.IsNullOrWhiteSpace(dir)) SetDllDirectory(dir);
        }

        Client = vigem_alloc();
        if (Client == IntPtr.Zero) throw new InvalidOperationException("vigem_alloc retornou NULL");
        EnsureOk(vigem_connect(Client), "vigem_connect");

        Target = vigem_target_x360_alloc();
        if (Target == IntPtr.Zero) throw new InvalidOperationException("vigem_target_x360_alloc retornou NULL");
        EnsureOk(vigem_target_add(Client, Target), "vigem_target_add");

        Report = new XUSB_REPORT();
        EnsureOk(vigem_target_x360_update(Client, Target, Report), "primeiro update");
    }

    static ushort Mask(string name) {
        switch ((name ?? "").ToUpperInvariant()) {
            case "DPAD_UP": return 0x0001;
            case "DPAD_DOWN": return 0x0002;
            case "DPAD_LEFT": return 0x0004;
            case "DPAD_RIGHT": return 0x0008;
            case "START": return 0x0010;
            case "BACK": return 0x0020;
            case "L3": return 0x0040;
            case "R3": return 0x0080;
            case "LB": return 0x0100;
            case "RB": return 0x0200;
            case "A": return 0x1000;
            case "B": return 0x2000;
            case "X": return 0x4000;
            case "Y": return 0x8000;
            default: return 0;
        }
    }

    static short Axis(int value) {
        int v = Math.Max(-100, Math.Min(100, value));
        if (v >= 0) return (short)Math.Round(v * 32767.0 / 100.0);
        return (short)Math.Round(v * 32768.0 / 100.0);
    }

    static void Update() {
        EnsureOk(vigem_target_x360_update(Client, Target, Report), "update");
    }

    public static void Button(string name, bool down) {
        ushort mask = Mask(name);
        if (mask == 0) throw new ArgumentException("botao desconhecido: " + name);
        if (down) Report.wButtons = (ushort)(Report.wButtons | mask);
        else Report.wButtons = (ushort)(Report.wButtons & ~mask);
        Update();
    }

    public static void Stick(string side, int x, int y) {
        short sx = Axis(x);
        short sy = Axis(y);
        if (String.Equals(side, "L", StringComparison.OrdinalIgnoreCase)) {
            Report.sThumbLX = sx; Report.sThumbLY = sy;
        } else if (String.Equals(side, "R", StringComparison.OrdinalIgnoreCase)) {
            Report.sThumbRX = sx; Report.sThumbRY = sy;
        } else throw new ArgumentException("stick desconhecido: " + side);
        Update();
    }

    public static void Trigger(string side, int percent) {
        byte value = (byte)Math.Round(Math.Max(0, Math.Min(100, percent)) * 255.0 / 100.0);
        if (String.Equals(side, "L", StringComparison.OrdinalIgnoreCase)) Report.bLeftTrigger = value;
        else if (String.Equals(side, "R", StringComparison.OrdinalIgnoreCase)) Report.bRightTrigger = value;
        else throw new ArgumentException("trigger desconhecido: " + side);
        Update();
    }

    public static void Reset() {
        Report = new XUSB_REPORT();
        if (Client != IntPtr.Zero && Target != IntPtr.Zero) Update();
    }

    public static void Close() {
        try { if (Client != IntPtr.Zero && Target != IntPtr.Zero) vigem_target_remove(Client, Target); } catch { }
        try { if (Target != IntPtr.Zero) vigem_target_free(Target); } catch { }
        try { if (Client != IntPtr.Zero) vigem_disconnect(Client); } catch { }
        try { if (Client != IntPtr.Zero) vigem_free(Client); } catch { }
        Target = IntPtr.Zero; Client = IntPtr.Zero;
    }
}
"@

try {
    Add-Type -TypeDefinition $sig -ErrorAction Stop
    $dll = [Environment]::GetEnvironmentVariable('CHATPLAYS_VIGEM_DLL')
    [ChatPlaysGamepad]::Init($dll)
    [Console]::Out.WriteLine('READY')
    [Console]::Out.Flush()

    while (($line = [Console]::In.ReadLine()) -ne $null) {
        $p = $line.Trim().Split(' ')
        if ($p.Length -eq 0) { continue }
        switch ($p[0]) {
            'B' { [ChatPlaysGamepad]::Button($p[1], $p[2] -eq '1') }
            'S' { [ChatPlaysGamepad]::Stick($p[1], [int]$p[2], [int]$p[3]) }
            'T' { [ChatPlaysGamepad]::Trigger($p[1], [int]$p[2]) }
            'RESET' { [ChatPlaysGamepad]::Reset() }
            'QUIT' { break }
            default { throw ('comando desconhecido: ' + $p[0]) }
        }
        [Console]::Out.WriteLine('OK')
        [Console]::Out.Flush()
        if ($p[0] -eq 'QUIT') { break }
    }
} catch {
    [Console]::Out.WriteLine('ERROR ' + $_.Exception.Message)
    [Console]::Out.Flush()
} finally {
    try { [ChatPlaysGamepad]::Close() } catch { }
}
`;
}

module.exports = { fonteWorker };
