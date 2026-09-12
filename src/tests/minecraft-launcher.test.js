'use strict';

const test = require('node:test');
const assert = require('node:assert');
const launcher = require('../utils/minecraft-launcher');
const jogo = require('../utils/jogo');
const mouse = require('../controllers/mouse');

test('ATLauncher: detecta caminho real sem confundir launcher comum', () => {
  assert.strictEqual(launcher.ehAtLauncher('C:\\Users\\Admin\\AppData\\Roaming\\ATLauncher\\ATLauncher.exe'), true);
  assert.strictEqual(launcher.ehAtLauncher('C:\\Apps\\ATLauncher-3.exe'), true);
  assert.strictEqual(launcher.ehAtLauncher('C:\\Apps\\PrismLauncher.exe'), false);
});

test('ATLauncher: fallback usa coordenadas calibradas das referências', () => {
  assert.deepStrictEqual(launcher.coordenadaFallback('instances', 1188, 696), { x: 1107, y: 239 });
  assert.deepStrictEqual(launcher.coordenadaFallback('play', 1187, 696), { x: 427, y: 399 });
});

test('ATLauncher: prioriza UI Automation, captura fallback e apaga screenshot temporária', () => {
  const s = launcher.montarScriptAtLauncher('C:\\ATLauncher\\ATLauncher.exe', 'C:\\Temp\\cp-shot.png');
  assert.match(s, /UIAutomationClient/);
  assert.match(s, /Find-ByName \$root 'Instances'/);
  assert.match(s, /Find-ByName \$root 'Play'/);
  assert.match(s, /CopyFromScreen/);
  assert.match(s, /0\.932 0\.343/);
  assert.match(s, /0\.360 0\.573/);
  assert.match(s, /finally \{[\s\S]*Remove-Item -LiteralPath \$shot -Force/);
});

test('gerenciador: launcher customizado não vira falso Minecraft rodando', async () => {
  jogo.__resetTeste();
  let lancamentos = 0;
  try {
    jogo.configurar({
      exe: 'C:\\ATLauncher\\ATLauncher.exe',
      detector: async () => false,
      lancador: async () => { lancamentos++; return true; },
      startupGraceMs: 30000,
      nomeGerenciado: 'Minecraft',
      autoReiniciar: false,
    });
    const r = await jogo.iniciar();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.modo, 'launcher');
    assert.strictEqual(lancamentos, 1);
    assert.strictEqual(jogo.status().nome, 'Minecraft');
    assert.strictEqual(jogo.status().rodando, false);
  } finally {
    jogo.__resetTeste();
  }
});

test('gerenciador: Minecraft já rodando anexa sem clicar Play', async () => {
  jogo.__resetTeste();
  let lancamentos = 0;
  try {
    jogo.configurar({
      exe: 'C:\\ATLauncher\\ATLauncher.exe',
      detector: async () => true,
      lancador: async () => { lancamentos++; return true; },
      nomeGerenciado: 'Minecraft',
    });
    const r = await jogo.iniciar();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.modo, 'anexar');
    assert.strictEqual(lancamentos, 0);
  } finally {
    jogo.__resetTeste();
  }
});

test('mouse global: opera sem EMULADOR_EXE usando a janela em foco', () => {
  const antes = mouse.status();
  const linhas = [];
  try {
    mouse.configurar({ modo: 'global', alvoExe: null, passoPx: 40 });
    mouse.__test.simular({ plataforma: 'win32', linhas });
    assert.strictEqual(mouse.mover(1, 0), true);
    assert.deepStrictEqual(linhas, ['MG 40 0']);
    const fonte = mouse.__test.fonteWorker();
    assert.match(fonte, /GetForegroundWindow/);
    assert.match(fonte, /GetArea\(out hwnd, out rect, out origin, true\)/);
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: antes.modo, alvoExe: antes.alvoExe, passoPx: antes.passoPx });
  }
});

test('ATLauncher: Minecraft JÁ rodando não clica Play de novo (guarda anti-duplicado)', async () => {
  const scripts = [];
  launcher.__test.definirExecutor(async (script) => {
    scripts.push(script);
    return /Get-CimInstance/.test(script)
      ? { ok: true, codigo: 0, stdout: 'RUNNING=1', stderr: '', timeout: false }
      : { ok: true, codigo: 0, stdout: 'RESULT=ok;METHOD=uia', stderr: '', timeout: false };
  });
  launcher.__test.definirPlataforma('win32');
  try {
    const ok = await launcher.iniciarAtLauncher('C:\\ATLauncher\\ATLauncher.exe');
    assert.strictEqual(ok, true);
    assert.strictEqual(scripts.length, 1, 'só a detecção deve rodar; Instances → Play não pode ser acionado');
    assert.match(scripts[0], /Get-CimInstance/);
  } finally {
    launcher.__test.definirExecutor(null);
    launcher.__test.definirPlataforma(null);
  }
});

test('ATLauncher: Minecraft parado → detecção + automação normal (Instances → Play)', async () => {
  const scripts = [];
  launcher.__test.definirExecutor(async (script) => {
    scripts.push(script);
    return /Get-CimInstance/.test(script)
      ? { ok: true, codigo: 0, stdout: 'RUNNING=0', stderr: '', timeout: false }
      : { ok: true, codigo: 0, stdout: 'RESULT=ok;METHOD=uia', stderr: '', timeout: false };
  });
  launcher.__test.definirPlataforma('win32');
  try {
    const ok = await launcher.iniciarAtLauncher('C:\\ATLauncher\\ATLauncher.exe');
    assert.strictEqual(ok, true);
    assert.strictEqual(scripts.length, 2, 'detecção + automação');
    assert.match(scripts[1], /Find-ByName \$root 'Play'/);
  } finally {
    launcher.__test.definirExecutor(null);
    launcher.__test.definirPlataforma(null);
  }
});
