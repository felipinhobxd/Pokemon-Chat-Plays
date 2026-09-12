'use strict';

/**
 * Automação do launcher do Minecraft (Windows).
 *
 * Fluxo ATLauncher:
 *   1. abre/reutiliza o ATLauncher;
 *   2. tenta achar "Instances" e "Play" via Windows UI Automation;
 *   3. se a UI não expuser esses elementos, tira uma captura TEMPORÁRIA
 *      da janela e usa os pontos relativos medidos das referências do repo;
 *   4. apaga a captura no finally (e o Node apaga de novo como segurança).
 *
 * Nenhuma captura feita no PC do usuário é persistida.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

/** Executor de PowerShell usado internamente (substituível só em testes). */
let executorPowerShell = executarPowerShell;

/** Plataforma atual (substituível só em testes). */
let plataformaAtual = () => process.platform;

function nomeBase(exe) {
  return String(exe || '').trim().replace(/\\/g, '/').split('/').pop().toLowerCase();
}

function tipoLauncher(exe) {
  const base = nomeBase(exe);
  if (/^atlauncher(?:[-_.].*)?\.exe$/.test(base) || base === 'atlauncher') return 'atlauncher';
  return null;
}

function ehAtLauncher(exe) {
  return tipoLauncher(exe) === 'atlauncher';
}

function psQuote(valor) {
  return `'${String(valor || '').replace(/'/g, "''")}'`;
}

/** Coordenadas relativas calibradas com as capturas em docs/minecraft-atlauncher/. */
function coordenadaFallback(etapa, largura, altura) {
  const w = Math.max(1, Number(largura) || 1);
  const h = Math.max(1, Number(altura) || 1);
  const pontos = {
    instances: { x: 0.932, y: 0.343 },
    play: { x: 0.360, y: 0.573 },
  };
  const p = pontos[etapa];
  if (!p) return null;
  return { x: Math.round(w * p.x), y: Math.round(h * p.y) };
}

function executarPowerShell(script, { timeoutMs = 60000 } = {}) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, codigo: null, stdout: '', stderr: 'Windows required', timeout: false });
  }

  return new Promise((resolve) => {
    let proc;
    let stdout = '';
    let stderr = '';
    let finalizado = false;
    let timer = null;

    const concluir = (res) => {
      if (finalizado) return;
      finalizado = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, ...res });
    };

    try {
      proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );
    } catch (err) {
      resolve({ ok: false, codigo: null, stdout: '', stderr: err.message, timeout: false });
      return;
    }

    timer = setTimeout(() => {
      try { proc.kill(); } catch { /* best effort */ }
      concluir({ ok: false, codigo: null, timeout: true });
    }, Math.max(1000, Number(timeoutMs) || 60000));
    timer.unref?.();

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => { stdout = (stdout + String(d)).slice(-12000); });
    proc.stderr.on('data', (d) => { stderr = (stderr + String(d)).slice(-12000); });
    proc.on('error', (err) => concluir({ ok: false, codigo: null, timeout: false, erro: err.message }));
    proc.on('close', (codigo) => concluir({ ok: codigo === 0, codigo, timeout: false }));

    try {
      proc.stdin.end(script);
    } catch (err) {
      concluir({ ok: false, codigo: null, timeout: false, erro: err.message });
    }
  });
}

function montarScriptAtLauncher(launcherExe, screenshotPath) {
  const launcher = psQuote(launcherExe);
  const shot = psQuote(screenshotPath);
  return String.raw`
$ErrorActionPreference = 'Stop'
$launcher = ${launcher}
$shot = ${shot}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class ChatPlaysAtLauncher {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(60);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    }
}
"@ -Language CSharp

function Get-AtLauncherProcess {
  return @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowHandle -ne 0 -and (
      $_.MainWindowTitle -match '(?i)ATLauncher' -or $_.ProcessName -match '(?i)^ATLauncher'
    )
  } | Select-Object -First 1)[0]
}

function Get-Root($proc) {
  if (-not $proc -or $proc.MainWindowHandle -eq 0) { return $null }
  try { return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$proc.MainWindowHandle) }
  catch { return $null }
}

function Find-ByName($root, [string]$name) {
  if (-not $root) { return $null }
  try {
    $nodes = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    for ($i = 0; $i -lt $nodes.Count; $i++) {
      $el = $nodes.Item($i)
      try { $n = [string]$el.Current.Name } catch { continue }
      if ([string]::Equals($n, $name, [System.StringComparison]::OrdinalIgnoreCase) -or
          $n.StartsWith($name + ' ', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $el
      }
    }
  } catch { }
  return $null
}

function Invoke-Element($el) {
  if (-not $el) { return $false }
  try {
    $pattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($pattern) { $pattern.Invoke(); return $true }
  } catch { }
  try {
    $pt = $el.GetClickablePoint()
    [ChatPlaysAtLauncher]::Click([int]$pt.X, [int]$pt.Y)
    return $true
  } catch { }
  return $false
}

function Focus-Launcher($proc) {
  if (-not $proc -or $proc.MainWindowHandle -eq 0) { return }
  [void][ChatPlaysAtLauncher]::ShowWindow([IntPtr]$proc.MainWindowHandle, 9)
  [void][ChatPlaysAtLauncher]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle)
  Start-Sleep -Milliseconds 350
}

function Capture-And-ClickRelative($proc, [double]$fx, [double]$fy) {
  if (-not $proc -or $proc.MainWindowHandle -eq 0) { return $false }
  $rect = New-Object ChatPlaysAtLauncher+RECT
  if (-not [ChatPlaysAtLauncher]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) { return $false }
  $w = [Math]::Max(1, $rect.Right - $rect.Left)
  $h = [Math]::Max(1, $rect.Bottom - $rect.Top)

  try {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
      $bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $g.Dispose()
      $bmp.Dispose()
    }
  } catch { }

  $x = $rect.Left + [int][Math]::Round($w * $fx)
  $y = $rect.Top + [int][Math]::Round($h * $fy)
  [ChatPlaysAtLauncher]::Click($x, $y)
  return $true
}

try {
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    Write-Output 'RESULT=launcher-not-found'
    exit 2
  }

  $proc = Get-AtLauncherProcess
  if (-not $proc) {
    Start-Process -FilePath $launcher | Out-Null
    for ($i = 0; $i -lt 60 -and -not $proc; $i++) {
      Start-Sleep -Milliseconds 500
      $proc = Get-AtLauncherProcess
    }
  }
  if (-not $proc) {
    Write-Output 'RESULT=launcher-window-not-found'
    exit 3
  }

  Focus-Launcher $proc
  $method = 'uia'
  $root = Get-Root $proc
  $play = Find-ByName $root 'Play'

  if (-not $play) {
    $instances = Find-ByName $root 'Instances'
    if ($instances -and (Invoke-Element $instances)) {
      $method = 'uia'
    } else {
      $method = 'screenshot-relative'
      if (-not (Capture-And-ClickRelative $proc 0.932 0.343)) {
        Write-Output 'RESULT=instances-failed'
        exit 4
      }
    }
    Start-Sleep -Milliseconds 1500
  }

  $play = $null
  for ($i = 0; $i -lt 24 -and -not $play; $i++) {
    $proc = Get-AtLauncherProcess
    $root = Get-Root $proc
    $play = Find-ByName $root 'Play'
    if (-not $play) { Start-Sleep -Milliseconds 250 }
  }

  if ($play -and (Invoke-Element $play)) {
    if ($method -eq 'screenshot-relative') { $method = 'screenshot-relative+uia' }
  } else {
    $method = 'screenshot-relative'
    $proc = Get-AtLauncherProcess
    if (-not (Capture-And-ClickRelative $proc 0.360 0.573)) {
      Write-Output 'RESULT=play-failed'
      exit 5
    }
  }

  Write-Output ('RESULT=ok;METHOD=' + $method)
  exit 0
} catch {
  Write-Output ('RESULT=error;DETAIL=' + $_.Exception.Message)
  exit 6
} finally {
  Remove-Item -LiteralPath $shot -Force -ErrorAction SilentlyContinue
}
`;
}

async function iniciarAtLauncher(launcherExe) {
  if (!ehAtLauncher(launcherExe)) {
    logger.aviso('[Minecraft] Launcher ainda não suportado automaticamente; por enquanto o fluxo automático é para ATLauncher.');
    return false;
  }
  if (plataformaAtual() !== 'win32') {
    logger.aviso('[Minecraft] Automação do ATLauncher está disponível no Windows.');
    return false;
  }

  // Guarda anti-clique-duplo: se o Minecraft JÁ está de pé (ex.: corrida
  // entre o watchdog decidir reabrir e o Java terminar de subir), clicar em
  // Play de novo poderia abrir uma 2ª instância. Nesse caso só retomamos
  // a vigília — o detector do gerenciador cuida do resto.
  if (await minecraftEstaRodando() === true) {
    logger.info('[Minecraft] ✅ Minecraft já está rodando — Instances → Play desnecessário.');
    return true;
  }

  const screenshotPath = path.join(
    os.tmpdir(),
    `chatplays-atlauncher-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`
  );

  const res = await executorPowerShell(
    montarScriptAtLauncher(launcherExe, screenshotPath),
    { timeoutMs: 60000 }
  );

  try { fs.rmSync(screenshotPath, { force: true }); } catch { /* best effort */ }

  if (res.ok && /RESULT=ok/i.test(res.stdout)) {
    const metodo = (res.stdout.match(/METHOD=([^\r\n;]+)/i) || [])[1] || 'uia';
    logger.info(`[Minecraft] ✅ ATLauncher acionado (Instances → Play; método: ${metodo}).`);
    return true;
  }

  const detalhe = String(res.stdout || res.stderr || res.erro || 'falha desconhecida')
    .trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'falha desconhecida';
  logger.aviso(`[Minecraft] ⚠️ Não consegui acionar Instances → Play no ATLauncher (${detalhe}).`);
  return false;
}

async function minecraftEstaRodando() {
  if (plataformaAtual() !== 'win32') return null;
  const script = String.raw`
$found = $null
try {
  $found = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -eq 'javaw.exe' -or $_.Name -eq 'java.exe') -and
    ([string]$_.CommandLine -match '(?i)(net\\.minecraft|fabricmc|neoforge|minecraftforge|\\.minecraft)')
  } | Select-Object -First 1
} catch { }

if (-not $found) {
  try {
    $found = Get-Process javaw,java -ErrorAction SilentlyContinue | Where-Object {
      $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match '(?i)minecraft'
    } | Select-Object -First 1
  } catch { }
}

if ($found) { Write-Output 'RUNNING=1' } else { Write-Output 'RUNNING=0' }
`;
  const res = await executorPowerShell(script, { timeoutMs: 6000 });
  if (!res.ok) return null;
  return /RUNNING=1/.test(res.stdout);
}

/** Substitui o executor de PowerShell (exclusivo para testes). */
function __definirExecutor(fn) {
  executorPowerShell = typeof fn === 'function' ? fn : executarPowerShell;
}

/** Substitui a plataforma vista pelo módulo (exclusivo para testes). */
function __definirPlataforma(p) {
  plataformaAtual = typeof p === 'string' ? () => p : () => process.platform;
}

module.exports = {
  tipoLauncher,
  ehAtLauncher,
  coordenadaFallback,
  psQuote,
  montarScriptAtLauncher,
  executarPowerShell,
  iniciarAtLauncher,
  minecraftEstaRodando,
  __test: { definirExecutor: __definirExecutor, definirPlataforma: __definirPlataforma },
};
