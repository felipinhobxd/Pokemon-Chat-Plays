/**
 * Testes do MODO JANELA (v2.4): as teclas do chat vão SOMENTE para a
 * janela do emulador (PostMessage) — o OBS e o resto do PC não são mais
 * afetados pelo foco.
 *
 * O pedido veio do streamer: "digitou up, mas estou no OBS — o jogo é
 * controlado mesmo assim" (e sem vazar tecla para o OBS) + "antes de
 * iniciar o programa ele pede o .exe do programa".
 *
 * O que estes testes garantem:
 *  1. O modo GLOBAL continua gerando EXATAMENTE o script antigo (zero risco
 *     de regressão para quem usa MODO_TECLADO=global).
 *  2. No modo janela, o worker compila a classe PCP (PostMessage) e fixa o
 *     alvo; as linhas de tecla chamam [PCP]::Env(vk, down).
 *  3. A fonte C# não quebra a string PowerShell (sem aspas simples) e
 *     monta o lParam com scan code + bit estendido + release (0xC0000000).
 *  4. O utilitário emulador.js decide/persiste o caminho do .exe direito.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const teclado = require('../controllers/keyboard');
const { configurarAlvoJanela, modoJanela, __test } = teclado;
const emulador = require('../utils/emulador');
const overlay = require('../overlay');

const EXE = 'C:\\Emuladores\\visualboyadvance-m.exe';

/** Volta ao estado global e limpa a overlay depois de cada teste. */
function resetar() {
  configurarAlvoJanela(null);
  overlay.setAlvo(null);
}

// ---------------------------------------------------------------------------
// Boot do worker: global (antigo) vs janela (PCP + PostMessage)
// ---------------------------------------------------------------------------

test('boot GLOBAL não contém PostMessage/PCP — comportamento antigo intacto', () => {
  resetar();
  const boot = __test.montarBootPS();
  assert.ok(boot.includes('keybd_event'), 'boot global compila a KB (keybd_event)');
  assert.ok(boot.includes('READY'), 'protocolo READY presente');
  assert.ok(!boot.includes('PostMessage'), 'boot global NÃO deve ter PostMessage');
  assert.ok(!boot.includes('PCP'), 'boot global NÃO deve ter a classe PCP');
});

test('configurarAlvoJanela ativa o modo janela e o boot ganha PCP + PostMessage', () => {
  resetar();
  assert.strictEqual(modoJanela(), false, 'padrão é global até definir alvo');

  configurarAlvoJanela(EXE);
  assert.strictEqual(modoJanela(), true, 'com alvo definido, modo janela ativo');

  const boot = __test.montarBootPS();
  assert.ok(boot.includes('Add-Type -TypeDefinition $sig'), 'compila a classe');
  assert.ok(boot.includes('PostMessage'), 'boot janela tem PostMessage (tecla na janela)');
  assert.ok(boot.includes(`[PCP]::DefinirAlvo('${EXE}');`), 'alvo fixado no boot');
  assert.ok(boot.includes('keybd_event'), 'mantém keybd_event (fallback do modo global)');
  assert.ok(boot.includes('READY'), 'protocolo READY presente');
  assert.ok(boot.includes('EMULADOR_OFF'), 'aviso de emulador não encontrado presente');

  resetar();
});

test("boot janela escapa apóstrofo do caminho (pasta com nome \"Emu's\")", () => {
  resetar();
  configurarAlvoJanela("C:\\Emu's\\vba.exe");
  const boot = __test.montarBootPS();
  assert.ok(boot.includes("[PCP]::DefinirAlvo('C:\\Emu''s\\vba.exe');"),
    'aspas simples do caminho viram duas (escape do PowerShell)');
  resetar();
});

test('configurarAlvoJanela(null) volta ao modo global', () => {
  configurarAlvoJanela(EXE);
  assert.strictEqual(modoJanela(), true);
  configurarAlvoJanela(null);
  assert.strictEqual(modoJanela(), false);
  assert.ok(!__test.montarBootPS().includes('PostMessage'));
});

// ---------------------------------------------------------------------------
// Linhas de tecla do modo janela ([PCP]::Env)
// ---------------------------------------------------------------------------

test('linhaKeyJanela chama [PCP]::Env(vk, down) com 1/0', () => {
  assert.strictEqual(__test.linhaKeyJanela(0x26, true), '[PCP]::Env(38,1)');
  assert.strictEqual(__test.linhaKeyJanela(0x26, false), '[PCP]::Env(38,0)');
  assert.strictEqual(__test.linhaKeyJanela(0x58, true), '[PCP]::Env(88,1)');
});

test('linhaTapJanela: Env down → Sleep → Env up, nessa ordem (toque existe)', () => {
  const tap = __test.linhaTapJanela(0x25, 230);
  const idxDown = tap.indexOf('[PCP]::Env(37,1)');
  const idxSleep = tap.indexOf('[System.Threading.Thread]::Sleep(230)');
  const idxUp = tap.indexOf('[PCP]::Env(37,0)');
  assert.ok(idxDown >= 0, 'começa com o keydown na janela');
  assert.ok(idxSleep > idxDown, 'sleep ENTRE down e up (regressão da v2.2.0)');
  assert.ok(idxUp > idxSleep, 'keyup por último');
});

test('scriptWindowsJanela: PCP + alvo + Env em ordem (modo compatível/encerramento)', () => {
  resetar();
  const script = __test.scriptWindowsJanela(
    [{ vk: 0x26, down: true }, { vk: 0x26, down: false }],
    120,
    EXE
  );
  const idxPcp = script.indexOf('Add-Type -TypeDefinition $sig');
  const idxAlvo = script.indexOf(`[PCP]::DefinirAlvo('${EXE}');`);
  const idxDown = script.indexOf('[PCP]::Env(38,1)');
  const idxSleep = script.indexOf('Start-Sleep -Milliseconds 120');
  const idxUp = script.indexOf('[PCP]::Env(38,0)');
  assert.ok(idxPcp >= 0, 'compila a PCP');
  assert.ok(idxAlvo > idxPcp, 'define o alvo depois de compilar');
  assert.ok(idxDown > idxAlvo, 'keydown depois do alvo');
  assert.ok(idxSleep > idxDown, 'sleep entre down e up');
  assert.ok(idxUp > idxSleep, 'keyup por último');
});

// ---------------------------------------------------------------------------
// Fonte C# (PCP):-safe para embutir em string PowerShell + lParam certo
// ---------------------------------------------------------------------------

test('fontePCP não tem aspas simples (não quebra a string PS do $sig)', () => {
  assert.ok(!__test.fontePCP.includes("'"), 'nenhuma aspa simples na fonte C#');
});

test('fontePCP monta lParam com scan, bit estendido e release', () => {
  // seta: scan 0x48 + EXTENDED (bit 24)  -> down: 0x01480001 / up: 0xC1480001
  assert.ok(__test.fontePCP.includes('uint lp = 1u | (scan << 16);'), 'base: repeat=1 + scan<<16');
  assert.ok(__test.fontePCP.includes('lp |= 0x01000000u;'), 'bit 24 = tecla estendida (setas!)');
  assert.ok(__test.fontePCP.includes('lp |= 0xC0000000u;'), 'bits 30/31 = previous state + release');
  assert.ok(__test.fontePCP.includes('const uint WM_KEYDOWN = 0x0100;'), 'WM_KEYDOWN');
  assert.ok(__test.fontePCP.includes('const uint WM_KEYUP = 0x0101;'), 'WM_KEYUP');
});

test('fontePCP: EhEstendido cobre exatamente o VK_ESTENDIDOS do JS (paridade)', () => {
  // mesmos hex da fonte C# — o validador pwsh (validar_modo_janela.js)
  // executa a comparação REAL 0..255 contra o VK_ESTENDIDOS
  for (const hex of ['0x21', '0x22', '0x23', '0x24', '0x2D', '0x2E', '0x5C', '0x5D', '0x6F', '0x90']) {
    assert.ok(__test.fontePCP.includes(hex), `VK ${hex} presente no EhEstendido C#`);
  }
  assert.ok(__test.fontePCP.includes('vk >= 0x25 && vk <= 0x28'), 'range das 4 setas');
  // e o conjunto JS continua igual (espelho da v2.2.3)
  for (const vk of [0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0x5c, 0x5d, 0x6f, 0x90]) {
    assert.ok(__test.VK_ESTENDIDOS.has(vk), `VK 0x${vk.toString(16)} no set JS`);
  }
});

test('normalizarCaminhoAlvo: aspas, espaços e barras duplas', () => {
  assert.strictEqual(__test.normalizarCaminhoAlvo(` "${EXE}" `), EXE, 'aspas + espaços somem');
  assert.strictEqual(__test.normalizarCaminhoAlvo("'C:\\x\\a.exe'"), 'C:\\x\\a.exe');
  assert.strictEqual(__test.normalizarCaminhoAlvo('C:\\\\Emu\\\\vba.exe'), 'C:\\Emu\\vba.exe', 'barras duplas viram simples');
  assert.strictEqual(__test.normalizarCaminhoAlvo(''), '');
});

// ---------------------------------------------------------------------------
// emulador.js: decisão do alvo, persistência e prompt
// ---------------------------------------------------------------------------

test('normalizarCaminhoExe: tira aspas do "Copiar como caminho" do Windows', () => {
  assert.strictEqual(emulador.normalizarCaminhoExe(`"${EXE}"`), EXE);
  assert.strictEqual(emulador.normalizarCaminhoExe(`  ${EXE}  `), EXE);
  assert.strictEqual(emulador.normalizarCaminhoExe(''), '');
  assert.strictEqual(emulador.normalizarCaminhoExe(null), '');
});

test('decidirAlvo: prioridade env > resposta > salvo > padrão', () => {
  // .env manda
  assert.deepStrictEqual(
    emulador.decidirAlvo({ envExe: EXE, salvo: 'C:\\outro.exe', resposta: 'C:\\terceiro.exe' }),
    { exe: EXE, origem: 'env', salvar: false }
  );
  // resposta digitada (com aspas coladas)
  assert.deepStrictEqual(
    emulador.decidirAlvo({ resposta: `"${EXE}"` }),
    { exe: EXE, origem: 'digitado', salvar: true }
  );
  // "global" desliga o modo janela de propósito
  assert.deepStrictEqual(
    emulador.decidirAlvo({ resposta: 'global' }),
    { exe: null, origem: 'global', salvar: true }
  );
  // Enter vazio mantém o salvo
  assert.deepStrictEqual(
    emulador.decidirAlvo({ salvo: EXE, resposta: '' }),
    { exe: EXE, origem: 'salvo', salvar: false }
  );
  // Enter vazio sem salvo: modo global
  assert.deepStrictEqual(
    emulador.decidirAlvo({ salvo: null, resposta: '' }),
    { exe: null, origem: 'padrao', salvar: false }
  );
});

test('emulador: salvar e carregar o último caminho usado (dados/emulador.json)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-emulador-'));
  const arquivo = path.join(dir, 'emulador.json');

  assert.strictEqual(emulador.salvarAlvo(arquivo, EXE), true);
  assert.strictEqual(emulador.carregarSalvo(arquivo), EXE, 'salva e recarrega igual');

  // salvar "global" (exe null) = lembrar a escolha do modo antigo
  emulador.salvarAlvo(arquivo, null);
  assert.strictEqual(emulador.carregarSalvo(arquivo), null);

  // JSON corrompido não derruba o bot
  fs.writeFileSync(arquivo, '{corrompido...');
  assert.strictEqual(emulador.carregarSalvo(arquivo), null);

  // arquivo inexistente
  assert.strictEqual(emulador.carregarSalvo(path.join(dir, 'nao-existe.json')), null);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('emulador: persiste PID e identidade da janela sem quebrar o formato antigo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-emulador-alvo-'));
  const arquivo = path.join(dir, 'emulador.json');
  const alvo = {
    exe: 'C:\\Java\\bin\\javaw.exe',
    pid: 4242,
    titulo: 'Minecraft* 26.2',
    processo: 'javaw',
  };

  assert.strictEqual(emulador.salvarAlvo(arquivo, alvo), true);
  assert.deepStrictEqual(emulador.carregarAlvo(arquivo), {
    ...alvo,
    processo: 'javaw.exe',
  });
  assert.strictEqual(emulador.carregarAlvo(arquivo, 'C:\\Outro\\javaw.exe'), null);
  assert.strictEqual(fs.existsSync(`${arquivo}.tmp`), false);

  fs.writeFileSync(arquivo, JSON.stringify({ exe: EXE }));
  assert.deepStrictEqual(emulador.carregarAlvo(arquivo), {
    exe: EXE,
    pid: 0,
    titulo: '',
    processo: '',
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('perguntar: resolve com a resposta digitada (streams falsos)', async () => {
  const entrada = new PassThrough();
  const saida = new PassThrough();
  const promessa = emulador.perguntar('Caminho do .exe: ', { entrada, saida });
  entrada.write(`"${EXE}"\n`);
  const resposta = await promessa;
  assert.strictEqual(resposta, `"${EXE}"`, 'resposta crua (normalização fica com decidirAlvo)');
});

// ---------------------------------------------------------------------------
// Overlay: mostra para onde as teclas estão indo
// ---------------------------------------------------------------------------

test('overlay.setAlvo reflete no snapshot (modo janela visível na live)', () => {
  resetar();
  assert.deepStrictEqual(overlay.snapshot().alvo, { ativo: false, nome: '' });

  overlay.setAlvo(EXE);
  const snap = overlay.snapshot();
  assert.deepStrictEqual(snap.alvo, { ativo: true, nome: 'visualboyadvance-m.exe' });

  // caminho relativo sem barra: basename = tudo
  overlay.setAlvo('mgba.exe');
  assert.strictEqual(overlay.snapshot().alvo.nome, 'mgba.exe');

  resetar();
});

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

test('API pública: configurarAlvoJanela e modoJanela exportadas', () => {
  assert.strictEqual(typeof teclado.configurarAlvoJanela, 'function');
  assert.strictEqual(typeof teclado.modoJanela, 'function');
  assert.strictEqual(typeof overlay.setAlvo, 'function');
});
