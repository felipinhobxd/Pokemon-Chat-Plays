'use strict';

/**
 * Automação do launcher do Minecraft (Windows).
 *
 * Fluxo ATLauncher:
 *   1. detecta e reutiliza uma janela já aberta do ATLauncher;
 *   2. se não houver, abre o launcher configurado e espera a janela real;
 *   3. tenta Instances -> Play via Windows UI Automation com timeout curto;
 *   4. se UI Automation travar/não expuser os controles (comum em UIs Java),
 *      roda um SEGUNDO processo PowerShell independente que usa os pontos
 *      relativos calibrados das referências do repo;
 *   5. o fallback captura uma PNG TEMPORÁRIA da janela e a remove no finally
 *      (e o Node remove de novo como segurança).
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

/**
 * Bloco PowerShell compartilhado pelos dois estágios.
 * A detecção é deliberadamente mais ampla que só ProcessName=ATLauncher:
 * algumas instalações usam um bootstrap .exe e deixam a janela em javaw.exe.
 */
function montarBlocoComum(launcherExe) {
  const launcher = psQuote(launcherExe);
  return String.raw`
$launcher = ${launcher}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class ChatPlaysAtLauncherWindow {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@ -Language CSharp

function Get-AtLauncherProcess {
  # 1) Caminho normal: nome/título da janela.
  $visible = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowHandle -ne 0 -and (
      $_.MainWindowTitle -match '(?i)ATLauncher' -or
      $_.ProcessName -match '(?i)^ATLauncher'
    )
  } | Select-Object -First 1)
  if ($visible.Count -gt 0) { return $visible[0] }

  # 2) Bootstrap Java: procura processos cuja linha de comando/caminho
  # menciona ATLauncher e depois pega a janela real correspondente.
  try {
    $ids = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      ([string]$_.ExecutablePath -match '(?i)ATLauncher') -or
      ([string]$_.CommandLine -match '(?i)ATLauncher')
    } | Select-Object -ExpandProperty ProcessId)
    foreach ($pidCandidate in $ids) {
      try {
        $p = Get-Process -Id $pidCandidate -ErrorAction Stop
        if ($p.MainWindowHandle -ne 0) { return $p }
      } catch { }
    }
  } catch { }

  return $null
}

function Focus-Launcher($proc) {
  if (-not $proc -or $proc.MainWindowHandle -eq 0) { return }
  [void][ChatPlaysAtLauncherWindow]::ShowWindow([IntPtr]$proc.MainWindowHandle, 9)
  [void][ChatPlaysAtLauncherWindow]::BringWindowToTop([IntPtr]$proc.MainWindowHandle)
  [void][ChatPlaysAtLauncherWindow]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle)
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($proc.Id)
  } catch { }
  Start-Sleep -Milliseconds 350
}

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  Write-Output 'RESULT=launcher-not-found'
  exit 2
}

$proc = Get-AtLauncherProcess
$reused = if ($proc) { '1' } else { '0' }
if (-not $proc) {
  Start-Process -FilePath $launcher | Out-Null
  for ($i = 0; $i -lt 80 -and -not $proc; $i++) {
    Start-Sleep -Milliseconds 500
    $proc = Get-AtLauncherProcess
  }
}
if (-not $proc) {
  Write-Output 'RESULT=launcher-window-not-found'
  exit 3
}

Focus-Launcher $proc
`;
}

/**
 * Estágio 1: UI Automation. Fica em processo separado e recebe timeout curto
 * no Node, porque certas versões Java/Swing podem bloquear a enumeração UIA.
 */
function montarScriptAtLauncher(launcherExe) {
  const comum = montarBlocoComum(launcherExe);
  return String.raw`
$ErrorActionPreference = 'Stop'
${comum}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-Root($proc) {
  if (-not $proc -or $proc.MainWindowHandle -eq 0) { return $null }
  try { return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$proc.MainWindowHandle) }
  catch { return $null }
}

function Find-ByName($root, [string]$name) {
  if (-not $root) { return $null }

  # Primeiro tenta a busca exata (normalmente mais barata).
  try {
    $cond = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $name
    )
    $found = $root.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      $cond
    )
    if ($found) { return $found }
  } catch { }

  # Compatibilidade com nomes do tipo "Play <instância>".
  try {
    $nodes = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    for ($i = 0; $i -lt $nodes.Count; $i++) {
      $el = $nodes.Item($i)
      try { $n = [string]$el.Current.Name } catch { continue }
      if ($n.StartsWith($name + ' ', [System.StringComparison]::OrdinalIgnoreCase)) { return $el }
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
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]$pt.X, [int]$pt.Y)
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ChatPlaysAtLauncherClick {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@ -Language CSharp -ErrorAction SilentlyContinue
    [ChatPlaysAtLauncherClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [ChatPlaysAtLauncherClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    return $true
  } catch { }
  return $false
}

try {
  $root = Get-Root $proc
  $play = Find-ByName $root 'Play'

  # Se já está na aba Instances, não navega de novo.
  if ($play -and (Invoke-Element $play)) {
    Write-Output ('RESULT=ok;METHOD=uia-play-visible;REUSED=' + $reused)
    exit 0
  }

  $instances = Find-ByName $root 'Instances'
  if (-not $instances -or -not (Invoke-Element $instances)) {
    Write-Output ('RESULT=uia-instances-not-found;REUSED=' + $reused)
    exit 4
  }

  Start-Sleep -Milliseconds 1000
  for ($i = 0; $i -lt 12; $i++) {
    $proc = Get-AtLauncherProcess
    $root = Get-Root $proc
    $play = Find-ByName $root 'Play'
    if ($play -and (Invoke-Element $play)) {
      Write-Output ('RESULT=ok;METHOD=uia;REUSED=' + $reused)
      exit 0
    }
    Start-Sleep -Milliseconds 200
  }

  Write-Output ('RESULT=uia-play-not-found;REUSED=' + $reused)
  exit 5
} catch {
  Write-Output ('RESULT=error;DETAIL=' + $_.Exception.Message + ';REUSED=' + $reused)
  exit 6
}
`;
}

/**
 * Estágio 2: fallback isolado. Não carrega UI Automation, portanto continua
 * funcionando mesmo quando o estágio 1 ficou preso dentro da API de acesso.
 */
function montarScriptAtLauncherFallback(launcherExe, screenshotPath) {
  const comum = montarBlocoComum(launcherExe);
  const shot = psQuote(screenshotPath);
  return String.raw`
$ErrorActionPreference = 'Stop'
$shot = ${shot}
${comum}

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class ChatPlaysAtLauncherFallback {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

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

function Capture-And-ClickRelative($proc, [double]$fx, [double]$fy) {
  if (-not $proc -or $proc.MainWindowHandle -eq 0) { return $false }
  $rect = New-Object ChatPlaysAtLauncherFallback+RECT
  if (-not [ChatPlaysAtLauncherFallback]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) { return $false }
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
  [ChatPlaysAtLauncherFallback]::Click($x, $y)
  return $true
}

try {
  # Clicar em Instances mesmo se ela já estiver ativa é seguro e deixa o
  # layout conhecido antes de procurar o primeiro Play.
  if (-not (Capture-And-ClickRelative $proc 0.932 0.343)) {
    Write-Output ('RESULT=instances-failed;REUSED=' + $reused)
    exit 4
  }

  Start-Sleep -Milliseconds 1700
  $proc = Get-AtLauncherProcess
  if (-not $proc) {
    Write-Output ('RESULT=launcher-window-lost;REUSED=' + $reused)
    exit 5
  }
  Focus-Launcher $proc

  if (-not (Capture-And-ClickRelative $proc 0.360 0.573)) {
    Write-Output ('RESULT=play-failed;REUSED=' + $reused)
    exit 6
  }

  Write-Output ('RESULT=ok;METHOD=screenshot-relative;REUSED=' + $reused)
  exit 0
} catch {
  Write-Output ('RESULT=error;DETAIL=' + $_.Exception.Message + ';REUSED=' + $reused)
  exit 7
} finally {
  Remove-Item -LiteralPath $shot -Force -ErrorAction SilentlyContinue
}
`;
}

function extrairMetodo(res, padrao = 'uia') {
  return (String(res?.stdout || '').match(/METHOD=([^\r\n;]+)/i) || [])[1] || padrao;
}

function extrairReuso(res) {
  return /REUSED=1/i.test(String(res?.stdout || ''));
}

function detalheFalha(res) {
  if (!res) return 'sem resposta';
  if (res.timeout) return 'timeout da automação';
  const bruto = String(res.stdout || res.stderr || res.erro || '').trim();
  if (bruto) return bruto.split(/\r?\n/).filter(Boolean).slice(-1)[0];
  if (res.codigo !== null && res.codigo !== undefined) return `PowerShell saiu com código ${res.codigo}`;
  return 'falha desconhecida';
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

  // UI Automation em Java/Swing pode bloquear. Mantemos a tentativa porque é
  // mais precisa, mas nunca deixamos ela impedir o fallback calibrado.
  const resUia = await executorPowerShell(
    montarScriptAtLauncher(launcherExe),
    { timeoutMs: 9000 }
  );

  if (resUia.ok && /RESULT=ok/i.test(resUia.stdout)) {
    const metodo = extrairMetodo(resUia);
    const reuso = extrairReuso(resUia) ? ' (launcher já estava aberto)' : '';
    logger.info(`[Minecraft] ✅ ATLauncher acionado (Instances → Play; método: ${metodo})${reuso}.`);
    return true;
  }

  // Caminho inválido não é um problema de UI: não vale clicar fallback.
  if (/RESULT=launcher-not-found/i.test(String(resUia.stdout || ''))) {
    logger.aviso(`[Minecraft] ⚠️ ATLauncher não encontrado no caminho configurado: ${launcherExe}`);
    return false;
  }

  if (resUia.timeout) {
    logger.info('[Minecraft] UI Automation do ATLauncher não respondeu a tempo — tentando fallback visual temporário.');
  }

  let resFallback;
  try {
    resFallback = await executorPowerShell(
      montarScriptAtLauncherFallback(launcherExe, screenshotPath),
      { timeoutMs: 45000 }
    );
  } finally {
    try { fs.rmSync(screenshotPath, { force: true }); } catch { /* best effort */ }
  }

  if (resFallback?.ok && /RESULT=ok/i.test(resFallback.stdout)) {
    const metodo = extrairMetodo(resFallback, 'screenshot-relative');
    const reuso = extrairReuso(resFallback) ? ' (launcher já estava aberto)' : '';
    logger.info(`[Minecraft] ✅ ATLauncher acionado (Instances → Play; método: ${metodo})${reuso}.`);
    return true;
  }

  const detalheFallback = detalheFalha(resFallback);
  const detalheUia = detalheFalha(resUia);
  logger.aviso(
    `[Minecraft] ⚠️ Não consegui acionar Instances → Play no ATLauncher ` +
    `(fallback: ${detalheFallback}; UIA: ${detalheUia}).`
  );
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
  montarScriptAtLauncherFallback,
  executarPowerShell,
  iniciarAtLauncher,
  minecraftEstaRodando,
  __test: { definirExecutor: __definirExecutor, definirPlataforma: __definirPlataforma },
};
