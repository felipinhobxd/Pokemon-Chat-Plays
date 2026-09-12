'use strict';

/**
 * Controle de mouse para o ChatPlays (Windows).
 *
 * Modos:
 *  - janela: usa PostMessage diretamente na janela do jogo. O cursor físico
 *    do streamer NÃO se move e o OBS pode continuar em foco.
 *  - global: usa SetCursorPos/SendInput. Funciona em mais jogos, mas mexe
 *    no cursor real do PC.
 *  - jogo: seleciona/foca a janela e usa SendInput com movimento relativo.
 *    É o modo para Minecraft/GLFW e outros jogos 3D que ignoram SetCursorPos.
 *  - off: desativa os comandos de mouse.
 *
 * Se MODO_MOUSE não estiver definido, acompanha MODO_TECLADO para a
 * configuração continuar simples. MOUSE_PASSO_PX define o passo relativo.
 * O alvo é EMULADOR_EXE, o mesmo executável já usado pelo modo janela.
 */

const { spawn } = require('child_process');
const logger = require('../utils/logger');
const { config } = require('../config');
const { limitarMs } = require('../utils/duracao');

const MODOS = new Set(['janela', 'jogo', 'global', 'off']);

/** Plataforma injetável para os testes do hold (produção: process.platform). */
let plataformaFake = null;
function plataformaAtual() {
  return plataformaFake || process.platform;
}

function normalizarModo(valor, fallback = 'janela') {
  const v = String(valor || '').trim().toLowerCase();
  if (MODOS.has(v)) return v;
  return MODOS.has(fallback) ? fallback : 'janela';
}

function limitar(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function lerPasso(valor) {
  const n = Number.parseInt(String(valor || ''), 10);
  return Number.isFinite(n) ? limitar(n, 5, 500) : 40;
}

let modo = normalizarModo(config.mouse?.modo, normalizarModo(config.teclado.modo, 'janela'));
let alvoExe = String(config.teclado.emuladorExe || '').trim() || null;
let alvoPid = 0;
let alvoTitulo = '';
let alvoProcesso = '';
let passoPx = lerPasso(config.mouse?.passoPx);
let ultimoAviso = 0;

const worker = {
  proc: null,
  alvo: null,
  stderrParcial: '',
};

function fonteWorker() {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

public static class ChatPlaysMouse {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
        public int dx; public int dy; public uint mouseData; public uint dwFlags;
        public uint time; public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
    }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT {
        public uint type; public INPUTUNION U;
    }

    [DllImport("user32.dll", SetLastError=true)] static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll", SetLastError=true)] static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll", SetLastError=true)] static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int maxCount);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    const uint WM_MOUSEMOVE = 0x0200;
    const uint WM_LBUTTONDOWN = 0x0201;
    const uint WM_LBUTTONUP = 0x0202;
    const uint WM_RBUTTONDOWN = 0x0204;
    const uint WM_RBUTTONUP = 0x0205;
    const int MK_LBUTTON = 0x0001;
    const int MK_RBUTTON = 0x0002;
    const uint INPUT_MOUSE = 0;
    const uint MOUSEEVENTF_MOVE = 0x0001;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MOVE_NOCOALESCE = 0x2000;
    const int SW_RESTORE = 9;

    static string Target = "";
    static int TargetPid = 0;
    static string TargetTitle = "";
    static string TargetProcess = "";
    static IntPtr CachedWindow = IntPtr.Zero;
    static uint CachedPid = 0;
    static int VirtualX = -1;
    static int VirtualY = -1;

    public static void Configure(string target, int pid, string title, string processName) {
        Target = target ?? "";
        TargetPid = pid > 0 ? pid : 0;
        TargetTitle = title ?? "";
        TargetProcess = processName ?? "";
        CachedWindow = IntPtr.Zero;
        CachedPid = 0;
        VirtualX = -1;
        VirtualY = -1;
    }

    static int Clamp(int value, int min, int max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    static IntPtr Pack(int x, int y) {
        int packed = ((y & 0xffff) << 16) | (x & 0xffff);
        return new IntPtr(packed);
    }

    static bool HasExplicitTarget() {
        return TargetPid > 0 || !String.IsNullOrWhiteSpace(Target) ||
            !String.IsNullOrWhiteSpace(TargetTitle) || !String.IsNullOrWhiteSpace(TargetProcess);
    }

    static string ProcessBaseName() {
        string value = !String.IsNullOrWhiteSpace(TargetProcess) ? TargetProcess : Target;
        try { return Path.GetFileNameWithoutExtension(value); }
        catch { return ""; }
    }

    static bool TitleMatches(string actual) {
        if (String.IsNullOrWhiteSpace(TargetTitle)) return true;
        actual = actual ?? "";
        if (String.IsNullOrWhiteSpace(actual)) return false;
        return String.Equals(actual, TargetTitle, StringComparison.OrdinalIgnoreCase) ||
            actual.IndexOf(TargetTitle, StringComparison.OrdinalIgnoreCase) >= 0 ||
            TargetTitle.IndexOf(actual, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    static bool ExactPath(Process p) {
        if (String.IsNullOrWhiteSpace(Target)) return false;
        try {
            string real = p.MainModule != null ? p.MainModule.FileName : "";
            return !String.IsNullOrWhiteSpace(real) &&
                String.Equals(Path.GetFullPath(real), Path.GetFullPath(Target), StringComparison.OrdinalIgnoreCase);
        } catch { return false; }
    }

    static bool ProcessMatches(Process p) {
        string wanted = ProcessBaseName();
        if (String.IsNullOrWhiteSpace(wanted)) return true;
        try { return String.Equals(p.ProcessName, wanted, StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    static IntPtr WindowForProcess(Process p) {
        try {
            IntPtr direct = p.MainWindowHandle;
            if (direct != IntPtr.Zero) return direct;
            int wantedPid = p.Id;
            IntPtr found = IntPtr.Zero;
            EnumWindows(delegate(IntPtr h, IntPtr l) {
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if (found == IntPtr.Zero && pid == (uint)wantedPid && IsWindowVisible(h)) {
                    var title = new System.Text.StringBuilder(512);
                    if (GetWindowText(h, title, title.Capacity) > 0) { found = h; return false; }
                }
                return true;
            }, IntPtr.Zero);
            return found;
        } catch { return IntPtr.Zero; }
    }

    static bool IsGenericJava(string name) {
        return String.Equals(name, "java", StringComparison.OrdinalIgnoreCase) ||
            String.Equals(name, "javaw", StringComparison.OrdinalIgnoreCase);
    }

    static IntPtr RememberWindow(IntPtr hwnd) {
        if (hwnd == IntPtr.Zero) return hwnd;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        CachedWindow = hwnd;
        CachedPid = pid;
        return hwnd;
    }

    static IntPtr FindWindow(bool allowForeground) {
        bool explicitTarget = HasExplicitTarget();
        string processName = ProcessBaseName();

        if (explicitTarget && CachedWindow != IntPtr.Zero) {
            uint currentPid;
            GetWindowThreadProcessId(CachedWindow, out currentPid);
            if (IsWindow(CachedWindow) && currentPid != 0 && currentPid == CachedPid) return CachedWindow;
            CachedWindow = IntPtr.Zero;
            CachedPid = 0;
        }

        if (TargetPid > 0) {
            try {
                using (Process p = Process.GetProcessById(TargetPid)) {
                    string title = p.MainWindowTitle ?? "";
                    if (ProcessMatches(p) && (!IsGenericJava(processName) || TitleMatches(title))) {
                        IntPtr exact = WindowForProcess(p);
                        if (exact != IntPtr.Zero) return RememberWindow(exact);
                    }
                }
            } catch { }
        }

        Process[] candidates;
        try {
            candidates = String.IsNullOrWhiteSpace(processName)
                ? Process.GetProcesses()
                : Process.GetProcessesByName(processName);
        } catch { candidates = new Process[0]; }

        IntPtr best = IntPtr.Zero;
        int bestScore = -1;
        foreach (Process p in candidates) {
            try {
                if (!ProcessMatches(p)) continue;
                string title = p.MainWindowTitle ?? "";
                bool titleMatches = TitleMatches(title);
                if (!String.IsNullOrWhiteSpace(TargetTitle) && !titleMatches &&
                    (IsGenericJava(processName) || String.IsNullOrWhiteSpace(processName))) continue;
                IntPtr h = WindowForProcess(p);
                if (h == IntPtr.Zero) continue;
                int score = 1;
                if (ExactPath(p)) score += 10;
                if (!String.IsNullOrWhiteSpace(TargetTitle) && titleMatches) score += 20;
                if (score > bestScore) { best = h; bestScore = score; }
            } catch { }
            finally { try { p.Dispose(); } catch { } }
        }
        if (best != IntPtr.Zero) return RememberWindow(best);
        return !explicitTarget && allowForeground ? GetForegroundWindow() : IntPtr.Zero;
    }

    static bool GetArea(out IntPtr hwnd, out RECT rect, out POINT origin, bool allowForeground = false) {
        hwnd = FindWindow(allowForeground);
        rect = new RECT();
        origin = new POINT();
        if (hwnd == IntPtr.Zero) return false;
        if (!GetClientRect(hwnd, out rect)) return false;
        if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return false;
        origin.X = 0; origin.Y = 0;
        if (!ClientToScreen(hwnd, ref origin)) return false;
        return true;
    }

    static bool Activate(IntPtr hwnd) {
        if (hwnd == IntPtr.Zero) return false;
        if (GetForegroundWindow() == hwnd) return true;
        try { if (IsIconic(hwnd)) ShowWindowAsync(hwnd, SW_RESTORE); } catch { }

        IntPtr foreground = GetForegroundWindow();
        uint ignored;
        uint foregroundThread = foreground == IntPtr.Zero ? 0u : GetWindowThreadProcessId(foreground, out ignored);
        uint targetThread = GetWindowThreadProcessId(hwnd, out ignored);
        uint currentThread = GetCurrentThreadId();
        bool attachedForeground = false;
        bool attachedTarget = false;
        try {
            if (foregroundThread != 0 && foregroundThread != currentThread) {
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            }
            if (targetThread != 0 && targetThread != currentThread) {
                attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            }
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
        } finally {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }
        if (GetForegroundWindow() == hwnd) return true;
        System.Threading.Thread.Sleep(15);
        return GetForegroundWindow() == hwnd;
    }

    static INPUT MouseInput(int dx, int dy, uint flags) {
        INPUT input = new INPUT();
        input.type = INPUT_MOUSE;
        input.U.mi.dx = dx;
        input.U.mi.dy = dy;
        input.U.mi.dwFlags = flags;
        return input;
    }

    static bool SendMouse(params INPUT[] inputs) {
        if (inputs == null || inputs.Length == 0) return false;
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) == (uint)inputs.Length;
    }

    static void EnsureVirtual(RECT rect) {
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (VirtualX < 0 || VirtualY < 0) {
            VirtualX = Math.Max(0, width / 2);
            VirtualY = Math.Max(0, height / 2);
        }
        VirtualX = Clamp(VirtualX, 0, Math.Max(0, width - 1));
        VirtualY = Clamp(VirtualY, 0, Math.Max(0, height - 1));
    }

    public static bool MoveWindow(int dx, int dy) {
        IntPtr hwnd; RECT rect; POINT origin;
        if (!GetArea(out hwnd, out rect, out origin)) return false;
        EnsureVirtual(rect);
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        VirtualX = Clamp(VirtualX + dx, 0, Math.Max(0, width - 1));
        VirtualY = Clamp(VirtualY + dy, 0, Math.Max(0, height - 1));
        return PostMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, Pack(VirtualX, VirtualY));
    }

    public static bool PosWindow(int xPct, int yPct) {
        IntPtr hwnd; RECT rect; POINT origin;
        if (!GetArea(out hwnd, out rect, out origin)) return false;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        VirtualX = Clamp((int)Math.Round((Math.Max(0, Math.Min(100, xPct)) / 100.0) * Math.Max(0, width - 1)), 0, Math.Max(0, width - 1));
        VirtualY = Clamp((int)Math.Round((Math.Max(0, Math.Min(100, yPct)) / 100.0) * Math.Max(0, height - 1)), 0, Math.Max(0, height - 1));
        return PostMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, Pack(VirtualX, VirtualY));
    }

    public static bool ClickWindow(bool right) {
        IntPtr hwnd; RECT rect; POINT origin;
        if (!GetArea(out hwnd, out rect, out origin)) return false;
        EnsureVirtual(rect);
        IntPtr lp = Pack(VirtualX, VirtualY);
        PostMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, lp);
        uint down = right ? WM_RBUTTONDOWN : WM_LBUTTONDOWN;
        uint up = right ? WM_RBUTTONUP : WM_LBUTTONUP;
        IntPtr wp = new IntPtr(right ? MK_RBUTTON : MK_LBUTTON);
        bool ok1 = PostMessage(hwnd, down, wp, lp);
        bool ok2 = PostMessage(hwnd, up, IntPtr.Zero, lp);
        return ok1 && ok2;
    }

    // v3.1: HOLD real de botão (down ... up separados no tempo — SEM cliques
    // repetidos). No modo janela mantém a coordenada virtual atual no lParam
    // e o estado do botão no wParam de cada mensagem.
    public static bool DownWindow(bool right) {
        IntPtr hwnd; RECT rect; POINT origin;
        if (!GetArea(out hwnd, out rect, out origin)) return false;
        EnsureVirtual(rect);
        IntPtr lp = Pack(VirtualX, VirtualY);
        PostMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, lp);
        uint down = right ? WM_RBUTTONDOWN : WM_LBUTTONDOWN;
        IntPtr wp = new IntPtr(right ? MK_RBUTTON : MK_LBUTTON);
        return PostMessage(hwnd, down, wp, lp);
    }

    public static bool UpWindow(bool right) {
        IntPtr hwnd; RECT rect; POINT origin;
        if (!GetArea(out hwnd, out rect, out origin)) return false;
        EnsureVirtual(rect);
        IntPtr lp = Pack(VirtualX, VirtualY);
        uint up = right ? WM_RBUTTONUP : WM_LBUTTONUP;
        return PostMessage(hwnd, up, IntPtr.Zero, lp);
    }

    public static bool DownGlobal(bool right) {
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (!GlobalPoint(out hwnd, out rect, out origin, out cursor)) return false;
        SetCursorPos(cursor.X, cursor.Y);
        return SendMouse(MouseInput(0, 0, right ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN));
    }

    public static bool UpGlobal(bool right) {
        return SendMouse(MouseInput(0, 0, right ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP));
    }

    static bool GlobalPoint(out IntPtr hwnd, out RECT rect, out POINT origin, out POINT cursor) {
        cursor = new POINT();
        if (!GetArea(out hwnd, out rect, out origin, true)) return false;
        GetCursorPos(out cursor);
        int left = origin.X;
        int top = origin.Y;
        int right = left + (rect.Right - rect.Left) - 1;
        int bottom = top + (rect.Bottom - rect.Top) - 1;
        if (cursor.X < left || cursor.X > right || cursor.Y < top || cursor.Y > bottom) {
            cursor.X = left + Math.Max(0, (right - left) / 2);
            cursor.Y = top + Math.Max(0, (bottom - top) / 2);
        }
        return true;
    }

    public static bool MoveGlobal(int dx, int dy) {
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (!GlobalPoint(out hwnd, out rect, out origin, out cursor)) return false;
        int left = origin.X;
        int top = origin.Y;
        int right = left + (rect.Right - rect.Left) - 1;
        int bottom = top + (rect.Bottom - rect.Top) - 1;
        int x = Clamp(cursor.X + dx, left, Math.Max(left, right));
        int y = Clamp(cursor.Y + dy, top, Math.Max(top, bottom));
        return SetCursorPos(x, y);
    }

    public static bool PosGlobal(int xPct, int yPct) {
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (!GlobalPoint(out hwnd, out rect, out origin, out cursor)) return false;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        int x = origin.X + (int)Math.Round((Math.Max(0, Math.Min(100, xPct)) / 100.0) * Math.Max(0, width - 1));
        int y = origin.Y + (int)Math.Round((Math.Max(0, Math.Min(100, yPct)) / 100.0) * Math.Max(0, height - 1));
        return SetCursorPos(x, y);
    }

    public static bool ClickGlobal(bool right) {
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (!GlobalPoint(out hwnd, out rect, out origin, out cursor)) return false;
        SetCursorPos(cursor.X, cursor.Y);
        uint down = right ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
        uint up = right ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
        return SendMouse(MouseInput(0, 0, down), MouseInput(0, 0, up));
    }

    static bool GamePoint(out IntPtr hwnd, out RECT rect, out POINT origin, out POINT cursor) {
        cursor = new POINT();
        if (!GetArea(out hwnd, out rect, out origin, true)) return false;
        if (!Activate(hwnd)) return false;
        GetCursorPos(out cursor);
        int left = origin.X;
        int top = origin.Y;
        int right = left + (rect.Right - rect.Left) - 1;
        int bottom = top + (rect.Bottom - rect.Top) - 1;
        if (cursor.X < left || cursor.X > right || cursor.Y < top || cursor.Y > bottom) {
            cursor.X = left + Math.Max(0, (right - left) / 2);
            cursor.Y = top + Math.Max(0, (bottom - top) / 2);
        }
        return true;
    }

    public static bool MoveGame(int dx, int dy) {
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (!GamePoint(out hwnd, out rect, out origin, out cursor)) return false;
        // Ao contrário de SetCursorPos, o deslocamento relativo entra no
        // fluxo de input do Windows que GLFW/jogos 3D observam.
        return SendMouse(MouseInput(dx, dy, MOUSEEVENTF_MOVE | MOUSEEVENTF_MOVE_NOCOALESCE));
    }

    public static bool PosGame(int xPct, int yPct) {
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (!GamePoint(out hwnd, out rect, out origin, out cursor)) return false;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        int x = origin.X + (int)Math.Round((Math.Max(0, Math.Min(100, xPct)) / 100.0) * Math.Max(0, width - 1));
        int y = origin.Y + (int)Math.Round((Math.Max(0, Math.Min(100, yPct)) / 100.0) * Math.Max(0, height - 1));
        return SetCursorPos(x, y);
    }

    public static bool ClickGame(bool right) {
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (!GamePoint(out hwnd, out rect, out origin, out cursor)) return false;
        SetCursorPos(cursor.X, cursor.Y);
        uint down = right ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
        uint up = right ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
        return SendMouse(MouseInput(0, 0, down), MouseInput(0, 0, up));
    }

    public static bool DownGame(bool right) {
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (!GamePoint(out hwnd, out rect, out origin, out cursor)) return false;
        SetCursorPos(cursor.X, cursor.Y);
        return SendMouse(MouseInput(0, 0, right ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN));
    }

    public static bool UpGame(bool right) {
        // O UP precisa ser enviado mesmo se o jogo fechou/perdeu foco no meio
        // do hold; liberar o botão global é sempre mais seguro que deixá-lo preso.
        IntPtr hwnd; RECT rect; POINT origin; POINT cursor;
        if (GamePoint(out hwnd, out rect, out origin, out cursor)) SetCursorPos(cursor.X, cursor.Y);
        return SendMouse(MouseInput(0, 0, right ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP));
    }
}
"@

$targetPid = 0
[int]::TryParse([Environment]::GetEnvironmentVariable('CHATPLAYS_MOUSE_TARGET_PID'), [ref]$targetPid) | Out-Null
[ChatPlaysMouse]::Configure(
    [Environment]::GetEnvironmentVariable('CHATPLAYS_MOUSE_TARGET'),
    $targetPid,
    [Environment]::GetEnvironmentVariable('CHATPLAYS_MOUSE_TARGET_TITLE'),
    [Environment]::GetEnvironmentVariable('CHATPLAYS_MOUSE_TARGET_PROCESS')
)
while (($line = [Console]::In.ReadLine()) -ne $null) {
    try {
        $p = $line.Trim().Split(' ')
        if ($p.Length -eq 0) { continue }
        $ok = $false
        switch ($p[0]) {
            'MW' { $ok = [ChatPlaysMouse]::MoveWindow([int]$p[1], [int]$p[2]) }
            'PW' { $ok = [ChatPlaysMouse]::PosWindow([int]$p[1], [int]$p[2]) }
            'CW' { $ok = [ChatPlaysMouse]::ClickWindow($p[1] -eq 'R') }
            'MG' { $ok = [ChatPlaysMouse]::MoveGlobal([int]$p[1], [int]$p[2]) }
            'PG' { $ok = [ChatPlaysMouse]::PosGlobal([int]$p[1], [int]$p[2]) }
            'CG' { $ok = [ChatPlaysMouse]::ClickGlobal($p[1] -eq 'R') }
            'MJ' { $ok = [ChatPlaysMouse]::MoveGame([int]$p[1], [int]$p[2]) }
            'PJ' { $ok = [ChatPlaysMouse]::PosGame([int]$p[1], [int]$p[2]) }
            'CJ' { $ok = [ChatPlaysMouse]::ClickGame($p[1] -eq 'R') }
            'DW' { $ok = [ChatPlaysMouse]::DownWindow($p[1] -eq 'R') }
            'UW' { $ok = [ChatPlaysMouse]::UpWindow($p[1] -eq 'R') }
            'DG' { $ok = [ChatPlaysMouse]::DownGlobal($p[1] -eq 'R') }
            'UG' { $ok = [ChatPlaysMouse]::UpGlobal($p[1] -eq 'R') }
            'DJ' { $ok = [ChatPlaysMouse]::DownGame($p[1] -eq 'R') }
            'UJ' { $ok = [ChatPlaysMouse]::UpGame($p[1] -eq 'R') }
        }
        if ($ok) { [Console]::Out.WriteLine('OK') } else { [Console]::Out.WriteLine('WARN TARGET') }
    } catch {
        [Console]::Out.WriteLine('WARN ' + $_.Exception.Message)
    }
}
`;
}

function pararWorker() {
  if (!worker.proc) return;
  try { worker.proc.kill(); } catch { /* já finalizado */ }
  worker.proc = null;
  worker.alvo = null;
}

function chaveAlvoWorker() {
  return JSON.stringify([alvoExe || '', alvoPid, alvoTitulo, alvoProcesso]);
}

function iniciarWorker() {
  if (plataformaAtual() !== 'win32' || modo === 'off' || (modo === 'janela' && !alvoExe && !alvoPid)) return false;
  const chaveAlvo = chaveAlvoWorker();
  if (worker.proc && worker.alvo === chaveAlvo && !worker.proc.killed) return true;

  pararWorker();
  try {
    const encoded = Buffer.from(fonteWorker(), 'utf16le').toString('base64');
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          CHATPLAYS_MOUSE_TARGET: alvoExe || '',
          CHATPLAYS_MOUSE_TARGET_PID: String(alvoPid || ''),
          CHATPLAYS_MOUSE_TARGET_TITLE: alvoTitulo,
          CHATPLAYS_MOUSE_TARGET_PROCESS: alvoProcesso,
        },
      }
    );
    worker.proc = proc;
    worker.alvo = chaveAlvo;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (dados) => {
      const linhas = String(dados).split(/\r?\n/).filter(Boolean);
      for (const linha of linhas) {
        if (!linha.startsWith('WARN')) continue;
        const detalhe = linha.replace(/^WARN\s*/, '');
        if (detalhe === 'TARGET') {
          avisar(modo === 'jogo'
            ? 'janela do jogo não encontrada ou sem foco; selecione o app aberto novamente e mantenha jogo/ChatPlays no mesmo nível de permissão.'
            : 'janela do jogo não encontrada.');
        } else {
          avisar(detalhe || 'janela do jogo não encontrada');
        }
      }
    });
    proc.stderr.on('data', (dados) => {
      worker.stderrParcial += String(dados);
      if (worker.stderrParcial.length > 2000) worker.stderrParcial = worker.stderrParcial.slice(-2000);
    });
    proc.on('exit', () => {
      if (worker.proc === proc) {
        worker.proc = null;
        worker.alvo = null;
      }
    });
    proc.on('error', (err) => {
      avisar(`PowerShell do mouse falhou: ${err.message}`);
    });
    return true;
  } catch (err) {
    avisar(`não foi possível iniciar o mouse: ${err.message}`);
    return false;
  }
}

function avisar(texto) {
  const agora = Date.now();
  if (agora - ultimoAviso < 10000) return;
  ultimoAviso = agora;
  logger.aviso(`[Mouse] ${texto}`);
}

function enviar(linha) {
  if (modo === 'off') {
    avisar('comandos de mouse estão desativados (MODO_MOUSE=off).');
    return false;
  }
  if (plataformaAtual() !== 'win32') {
    avisar('mouse em modo janela/jogo/global está disponível no Windows nesta versão.');
    return false;
  }
  if (modo === 'janela' && !alvoExe && !alvoPid) {
    avisar('configure EMULADOR_EXE para usar o mouse em modo janela.');
    return false;
  }
  if (!iniciarWorker() || !worker.proc || !worker.proc.stdin.writable) return false;
  try {
    worker.proc.stdin.write(`${linha}\n`);
    return true;
  } catch (err) {
    avisar(`falha ao enviar ação: ${err.message}`);
    return false;
  }
}

function mover(dxUnidade, dyUnidade) {
  const dx = Math.trunc(Number(dxUnidade) || 0) * passoPx;
  const dy = Math.trunc(Number(dyUnidade) || 0) * passoPx;
  if (dx === 0 && dy === 0) return false;
  const codigo = modo === 'janela' ? 'MW' : modo === 'jogo' ? 'MJ' : 'MG';
  return enviar(`${codigo} ${dx} ${dy}`);
}

function posicionarPercentual(xPct, yPct) {
  const x = limitar(Math.round(Number(xPct) || 0), 0, 100);
  const y = limitar(Math.round(Number(yPct) || 0), 0, 100);
  const codigo = modo === 'janela' ? 'PW' : modo === 'jogo' ? 'PJ' : 'PG';
  return enviar(`${codigo} ${x} ${y}`);
}

function clicar(botao = 'left') {
  const lado = String(botao).toLowerCase() === 'right' ? 'R' : 'L';
  const codigo = modo === 'janela' ? 'CW' : modo === 'jogo' ? 'CJ' : 'CG';
  return enviar(`${codigo} ${lado}`);
}

// ---------------------------------------------------------------------------
// v3.1: HOLD real de botão (down -> duração -> up), por botão
// ---------------------------------------------------------------------------

/**
 * Botões atualmente segurados: 'left' | 'right' -> { timer, dono }.
 * O timer é SEMPRE substituído ao re-segurar o mesmo botão (o timer antigo
 * nunca interfere no novo — proteção contra timers obsoletos). Se o worker
 * morrer no meio, o timer continua: o UP vai para um worker novo (no modo
 * global isso libera o botão físico; no janela é um UP inofensivo).
 * @type {Map<string, {timer: NodeJS.Timeout, dono: string|null}>}
 */
const botoesSegurados = new Map();

/**
 * HOLD de movimento contínuo. Cada direção tem timers próprios e um
 * token por identidade do objeto; timers velhos nunca afetam um hold novo.
 * Um passo acontece imediatamente e os próximos a cada 50ms.
 */
const movimentosSegurados = new Map();
const MOVIMENTO_HOLD_TICK_MS = 50;

function chaveMovimento(dxUnidade, dyUnidade) {
  const dx = Math.sign(Number(dxUnidade) || 0);
  const dy = Math.sign(Number(dyUnidade) || 0);
  return `${dx},${dy}`;
}

function segurarMovimento(dxUnidade, dyUnidade, duracaoMs = 1000, dono = null) {
  const dx = Math.sign(Number(dxUnidade) || 0);
  const dy = Math.sign(Number(dyUnidade) || 0);
  if (dx === 0 && dy === 0) return false;
  const duracao = limitarMs(duracaoMs) || 1000;
  const chave = chaveMovimento(dx, dy);

  const anterior = movimentosSegurados.get(chave);
  if (anterior) {
    clearInterval(anterior.intervalo);
    clearTimeout(anterior.timer);
    movimentosSegurados.delete(chave);
  }

  // Move já no instante do comando; isso também valida worker/alvo.
  if (!mover(dx, dy)) return false;

  const info = { intervalo: null, timer: null, dono, dx, dy };
  const intervalo = setInterval(() => {
    if (movimentosSegurados.get(chave) !== info) return;
    mover(dx, dy);
  }, MOVIMENTO_HOLD_TICK_MS);
  intervalo.unref?.();

  const timer = setTimeout(() => {
    if (movimentosSegurados.get(chave) !== info) return;
    clearInterval(info.intervalo);
    movimentosSegurados.delete(chave);
  }, duracao);
  timer.unref?.();

  info.intervalo = intervalo;
  info.timer = timer;
  movimentosSegurados.set(chave, info);
  logger.comando(`[Mouse] Hold movimento: ${dx},${dy} por ${duracao}ms${dono ? ` — @${dono}` : ''}`);
  return true;
}

function soltarMovimento(dxUnidade, dyUnidade) {
  const chave = chaveMovimento(dxUnidade, dyUnidade);
  const info = movimentosSegurados.get(chave);
  if (!info) return false;
  clearInterval(info.intervalo);
  clearTimeout(info.timer);
  movimentosSegurados.delete(chave);
  return true;
}

function soltarMovimentos() {
  let liberados = 0;
  for (const [chave, info] of [...movimentosSegurados.entries()]) {
    clearInterval(info.intervalo);
    clearTimeout(info.timer);
    movimentosSegurados.delete(chave);
    liberados++;
  }
  return liberados;
}


function linhaDown(lado) {
  return modo === 'janela' ? `DW ${lado}` : modo === 'jogo' ? `DJ ${lado}` : `DG ${lado}`;
}

function linhaUp(lado) {
  return modo === 'janela' ? `UW ${lado}` : modo === 'jogo' ? `UJ ${lado}` : `UG ${lado}`;
}

/**
 * Segura um botão do mouse por X ms (down AGORA, up pelo timer).
 * Re-segurar o mesmo botão substitui/estende a duração sem re-enviar o down
 * (mesma semântica do teclado — não gera "clique duplo" no jogo).
 * @param {'left'|'right'} botao
 * @param {number} duracaoMs - 1..10000 (limitado aqui)
 * @param {string|null} dono - quem pediu (logs)
 * @returns {boolean} true se o hold ficou ativo
 */
function segurar(botao = 'left', duracaoMs = 1000, dono = null) {
  const b = String(botao).toLowerCase() === 'right' ? 'right' : 'left';
  const duracao = limitarMs(duracaoMs) || 1000;
  if (modo === 'off') {
    avisar('comandos de mouse estão desativados (MODO_MOUSE=off).');
    return false;
  }
  if (plataformaAtual() !== 'win32') {
    avisar('mouse em modo janela/jogo/global está disponível no Windows nesta versão.');
    return false;
  }
  if (modo === 'janela' && !alvoExe && !alvoPid) {
    avisar('configure EMULADOR_EXE para usar o mouse em modo janela.');
    return false;
  }
  if (!iniciarWorker() || !worker.proc || !worker.proc.stdin.writable) return false;

  const lado = b === 'right' ? 'R' : 'L';
  const atual = botoesSegurados.get(b);
  if (atual) {
    // já pressionado: só troca o timer (o down não é re-enviado)
    clearTimeout(atual.timer);
  } else if (!enviar(linhaDown(lado))) {
    return false;
  }

  const timer = setTimeout(() => {
    botoesSegurados.delete(b);
    enviar(linhaUp(lado));
  }, duracao);
  timer.unref?.();
  botoesSegurados.set(b, { timer, dono });
  logger.comando(`[Mouse] Hold: clique ${b === 'right' ? 'direito' : 'esquerdo'} por ${duracao}ms${dono ? ` — @${dono}` : ''}`);
  return true;
}

/**
 * Solta UM botão específico (se estiver segurado).
 * @param {'left'|'right'} botao
 * @returns {boolean} true se havia hold ativo
 */
function soltarBotao(botao = 'left') {
  const b = String(botao).toLowerCase() === 'right' ? 'right' : 'left';
  const info = botoesSegurados.get(b);
  if (!info) return false;
  clearTimeout(info.timer);
  botoesSegurados.delete(b);
  enviar(linhaUp(b === 'right' ? 'R' : 'L'));
  return true;
}

/**
 * Solta TODOS os botões segurados (soltar do chat / pânico F9 / pausa /
 * troca de alvo / encerramento). O UP é best-effort: worker morto => o
 * próximo hold/comando re-sobe o worker.
 * @returns {number} quantos botões foram liberados
 */
function soltarTodos() {
  let liberados = 0;
  for (const b of [...botoesSegurados.keys()]) {
    if (soltarBotao(b)) liberados++;
  }
  liberados += soltarMovimentos();
  return liberados;
}

/** Quantos botões estão segurados agora (diagnóstico). */
function totalSegurando() {
  return botoesSegurados.size + movimentosSegurados.size;
}

function executar(comando) {
  if (!comando || typeof comando !== 'object') return false;
  if (comando.tipo === 'mouse-mover') return mover(comando.dx, comando.dy);
  if (comando.tipo === 'mouse-pos') return posicionarPercentual(comando.xPct, comando.yPct);
  if (comando.tipo === 'mouse-click') return clicar(comando.botao);
  return false;
}

function configurar(opcoes = {}) {
  const novoModo = opcoes.modo !== undefined
    ? normalizarModo(opcoes.modo, modo)
    : modo;
  const novoAlvo = opcoes.alvoExe !== undefined
    ? (String(opcoes.alvoExe || '').trim() || null)
    : alvoExe;
  const alvoMudou = Object.prototype.hasOwnProperty.call(opcoes, 'alvoExe') && novoAlvo !== alvoExe;
  const pidBase = opcoes.alvoPid !== undefined ? opcoes.alvoPid : alvoMudou ? 0 : alvoPid;
  const pidInformado = Number.parseInt(String(pidBase), 10);
  const novoPid = Number.isSafeInteger(pidInformado) && pidInformado > 0 ? pidInformado : 0;
  const limparTexto = (valor, limite) => String(valor || '').replace(/[\r\n\0]/g, ' ').trim().slice(0, limite);
  const novoTitulo = opcoes.alvoTitulo !== undefined
    ? limparTexto(opcoes.alvoTitulo, 512)
    : alvoMudou ? '' : alvoTitulo;
  const novoProcesso = opcoes.alvoProcesso !== undefined
    ? limparTexto(opcoes.alvoProcesso, 260)
    : alvoMudou ? '' : alvoProcesso;
  const novoPasso = opcoes.passoPx !== undefined ? lerPasso(opcoes.passoPx) : passoPx;

  const precisaReiniciar = novoModo !== modo || novoAlvo !== alvoExe || novoPid !== alvoPid ||
    novoTitulo !== alvoTitulo || novoProcesso !== alvoProcesso;
  if (precisaReiniciar) {
    // v3.1: trocar modo/alvo com um hold ATIVO deixaria o botão PRESO na
    // janela antiga — solta ANTES de derrubar o worker.
    soltarTodos();
  }
  modo = novoModo;
  alvoExe = novoAlvo;
  alvoPid = novoPid;
  alvoTitulo = novoTitulo;
  alvoProcesso = novoProcesso;
  passoPx = novoPasso;
  if (precisaReiniciar) pararWorker();
}

function status() {
  return {
    modo,
    alvoExe,
    alvoPid,
    alvoTitulo,
    alvoProcesso,
    passoPx,
    suportado: plataformaAtual() === 'win32',
    segurando: totalSegurando(),
    movimentosSegurando: movimentosSegurados.size,
  };
}

/**
 * Encerra o controlador: solta botões segurados (UP best-effort) ANTES de
 * derrubar o worker — nunca deixa botão preso no encerramento.
 */
function parar() {
  soltarTodos();
  pararWorker();
}

module.exports = {
  mover,
  posicionarPercentual,
  clicar,
  segurar,
  segurarMovimento,
  soltarBotao,
  soltarMovimento,
  soltarMovimentos,
  soltarTodos,
  totalSegurando,
  executar,
  configurar,
  status,
  parar,
  __test: {
    normalizarModo,
    limitar,
    lerPasso,
    fonteWorker,
    /** Injeta plataforma + worker falso p/ testar hold sem Windows. */
    simular({ plataforma = 'win32', linhas = null } = {}) {
      plataformaFake = plataforma;
      if (linhas) {
        worker.proc = {
          killed: false,
          stdin: { writable: true, write: (l) => linhas.push(String(l).trim()) },
        };
        worker.alvo = chaveAlvoWorker();
      }
    },
    restaurar() {
      plataformaFake = null;
      worker.proc = null;
      worker.alvo = null;
      soltarTodos();
    },
    linhasWorker: () => worker.proc,
  },
};
