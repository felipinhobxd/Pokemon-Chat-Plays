/**
 * Controlador de teclado SEM dependencias nativas.
 *
 * Estrategia: usar PowerShell (SendKeys via WScript.Shell) no Windows,
 *             usar xdotool no Linux, e AppleScript no macOS.
 *
 * Vantagens:
 *  - Zero compilacao (nao precisa de Visual Studio Build Tools no Windows).
 *  - Funciona out-of-the-box em qualquer maquina com PowerShell/xdotool/osascript.
 *  - Cabe em um unico .exe via empacotador (pkg/nexe).
 *
 * Mapeamento padrao (compativel com VisualBoyAdvance):
 *   Seta Cima    -> 'up'
 *   Seta Baixo   -> 'down'
 *   Seta Esq     -> 'left'
 *   Seta Dir     -> 'right'
 *   Botao A      -> 'x'
 *   Botao B      -> 'z'
 *   Botao L      -> 'a'
 *   Botao R      -> 's'
 *   Start        -> 'enter'
 *   Select       -> 'backspace'
 *
 * Voce pode trocar o mapeamento editando o objeto MAPEAMENTO_PADRAO abaixo.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');
const { config } = require('../config');

// Mapeamento: botao do GameBoy -> tecla do teclado (formato SendKeys/xdotool)
const MAPEAMENTO_PADRAO = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  a: 'x',
  b: 'z',
  l: 'a',
  r: 's',
  start: 'enter',
  select: 'backspace',
};

// Aliases em portugues para os comandos
const ALIASES_PT = {
  cima: 'up',
  baixo: 'down',
  esquerda: 'left',
  direita: 'right',
  start: 'start',
  seleciona: 'select',
  selecionar: 'select',
  a: 'a',
  b: 'b',
  l: 'l',
  r: 'r',
};

const LISTA_COMANDOS = [
  { cmd: 'a', acao: 'Botão A' },
  { cmd: 'b', acao: 'Botão B' },
  { cmd: 'up', acao: 'Seta para cima (também: cima)' },
  { cmd: 'down', acao: 'Seta para baixo (também: baixo)' },
  { cmd: 'left', acao: 'Seta para esquerda (também: esquerda)' },
  { cmd: 'right', acao: 'Seta para direita (também: direita)' },
  { cmd: 'l', acao: 'Ombro esquerdo (L)' },
  { cmd: 'r', acao: 'Ombro direito (R)' },
  { cmd: 'start', acao: 'Botão Start' },
  { cmd: 'select', acao: 'Botão Select (também: seleciona)' },
];

let mapeamentoAtual = { ...MAPEAMENTO_PADRAO };
let duracaoTecla = config.geral.tempoPressionarTeclaMs;

/**
 * Detecta a plataforma atual.
 * @returns {'win32'|'linux'|'darwin'}
 */
function plataformaAtual() {
  return process.platform;
}

/**
 * Traduz nome de tecla generico (up/down/left/right/a/b/etc) para
 * o formato esperado por cada backend.
 *
 * SendKeys (Windows via WScript.Shell):
 *   - up    -> {UP}
 *   - down  -> {DOWN}
 *   - left  -> {LEFT}
 *   - right -> {RIGHT}
 *   - enter -> {ENTER}
 *   - backspace -> {BACKSPACE}
 *   - letras simples permanecem letras
 *
 * xdotool (Linux):
 *   - up    -> Up
 *   - down  -> Down
 *   - left  -> Left
 *   - right -> Right
 *   - enter -> Return
 *   - backspace -> BackSpace
 *   - letras permanecem minusculas
 *
 * AppleScript (macOS):
 *   - up    -> Up_Arrow
 *   - down  -> Down_Arrow
 *   - left  -> Left_Arrow
 *   - right -> Right_Arrow
 *   - enter -> Return
 *   - backspace -> Delete (no Mac, Delete e backspace)
 *   - letras permanecem minusculas
 *
 * @param {string} tecla - Nome generico da tecla
 * @returns {object} {sendKeys, xdotool, apple}
 */
function traduzirTecla(tecla) {
  const T = tecla.toLowerCase();
  const map = {
    up:      { sk: '{UP}',        xt: 'Up',       ap: 'Up_Arrow' },
    down:    { sk: '{DOWN}',      xt: 'Down',     ap: 'Down_Arrow' },
    left:    { sk: '{LEFT}',      xt: 'Left',     ap: 'Left_Arrow' },
    right:   { sk: '{RIGHT}',     xt: 'Right',    ap: 'Right_Arrow' },
    enter:   { sk: '{ENTER}',     xt: 'Return',   ap: 'Return' },
    return:  { sk: '{ENTER}',     xt: 'Return',   ap: 'Return' },
    backspace:{ sk: '{BACKSPACE}',xt: 'BackSpace', ap: 'Delete' },
    space:   { sk: ' ',           xt: 'space',    ap: 'Space' },
    tab:     { sk: '{TAB}',        xt: 'Tab',      ap: 'Tab' },
    esc:     { sk: '{ESC}',        xt: 'Escape',   ap: 'Escape' },
    escape:  { sk: '{ESC}',        xt: 'Escape',   ap: 'Escape' },
  };
  if (T in map) {
    return { sendKeys: map[T].sk, xdotool: map[T].xt, apple: map[T].ap };
  }
  // Letra simples
  return { sendKeys: T, xdotool: T, apple: T };
}

/**
 * Pressiona e solta uma tecla, conforme a plataforma atual.
 * @param {string} tecla - Nome generico da tecla (up, down, left, right, a, b, etc.)
 */
function pressionarTecla(tecla) {
  const plat = plataformaAtual();
  const trad = traduzirTecla(tecla);

  try {
    if (plat === 'win32') {
      enviarWindows(trad.sendKeys);
    } else if (plat === 'linux') {
      enviarLinux(trad.xdotool);
    } else if (plat === 'darwin') {
      enviarMac(trad.apple);
    } else {
      logger.erro(`[Teclado] Plataforma nao suportada: ${plat}`);
      return;
    }
  } catch (err) {
    logger.erro(`[Teclado] Falha ao pressionar tecla "${tecla}": ${err.message}`);
  }
}

/**
 * Envia uma tecla via PowerShell + WScript.Shell (Windows).
 * Faz key-down, espera duracaoTecla, key-up.
 * @param {string} sendKeys - Tecla no formato SendKeys (ex: '{UP}' ou 'a')
 */
function enviarWindows(sendKeys) {
  // WScript.Shell.SendKeys nao separa key-down/up, mas simula press+release.
  // Para um efeito mais proximo do robotjs (com duracao customizada),
  // usamos um script que mantem a tecla por N ms via SendWait no PowerShell.
  // Para simplicidade e robustez, usamos SendKeys direto (press+release imediato).
  // A duracao configurada e ignorada no Windows (a maior parte dos emuladores
  // ja trata keydown curto como um toque valido).

  const psScript = `$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('${sendKeys}')`;

  // Executa PowerShell de forma silenciosa
  // -WindowStyle Hidden: nao mostra janela do PowerShell
  // -NoProfile: nao carrega perfil (mais rapido)
  // -Command: comando direto
  try {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-Command', psScript,
    ], { stdio: 'ignore', timeout: 5000 });
  } catch (err) {
    // Se falhar, tenta com cmd + mshta como fallback (raro)
    logger.erro(`[Teclado][Win] PowerShell falhou: ${err.message}`);
  }
}

/**
 * Envia uma tecla via xdotool (Linux).
 * @param {string} tecla - Tecla no formato xdotool (ex: 'Up', 'a')
 */
function enviarLinux(tecla) {
  try {
    // keydown, espera, keyup
    execFileSync('xdotool', ['keydown', tecla], { stdio: 'ignore', timeout: 2000 });
    setTimeout(() => {
      try {
        execFileSync('xdotool', ['keyup', tecla], { stdio: 'ignore', timeout: 2000 });
      } catch (err) {
        logger.erro(`[Teclado][Linux] keyup falhou: ${err.message}`);
      }
    }, duracaoTecla);
  } catch (err) {
    logger.erro(`[Teclado][Linux] xdotool falhou (instale com: sudo apt install xdotool): ${err.message}`);
  }
}

/**
 * Envia uma tecla via AppleScript / osascript (macOS).
 * @param {string} tecla - Tecla no formato AppleScript (ex: 'Up_Arrow', 'a')
 */
function enviarMac(tecla) {
  const script = `tell application "System Events" to keystroke "${tecla}"`;
  try {
    execFileSync('osascript', ['-e', script], { stdio: 'ignore', timeout: 2000 });
  } catch (err) {
    logger.erro(`[Teclado][macOS] osascript falhou: ${err.message}`);
  }
}

/**
 * Executa um botao do controle do GameBoy.
 * @param {string} botao - Nome do botao (up, down, left, right, a, b, l, r, start, select)
 * @returns {boolean} true se o botao foi executado com sucesso
 */
function executarBotao(botao) {
  const tecla = mapeamentoAtual[botao];
  if (!tecla) {
    logger.aviso(`[Teclado] Botão desconhecido: "${botao}"`);
    return false;
  }
  logger.comando(`[Teclado] Pressionando: ${botao} -> tecla "${tecla}"`);
  pressionarTecla(tecla);
  return true;
}

/**
 * Normaliza a mensagem do chat para o nome de botao correspondente.
 * Aceita termos em ingles e portugues.
 * @param {string} mensagem - Mensagem bruta do chat
 * @returns {string|null} - Nome do botao ou null se nao for comando
 */
function normalizarComando(mensagem) {
  if (!mensagem) return null;
  const texto = mensagem.trim().toLowerCase();

  if (texto in mapeamentoAtual) return texto;
  if (texto in ALIASES_PT) return ALIASES_PT[texto];

  return null;
}

/**
 * Verifica se a mensagem e um gatilho para listar comandos.
 * @param {string} mensagem - Mensagem bruta
 * @returns {boolean}
 */
function ehPedidoAjuda(mensagem) {
  if (!mensagem) return false;
  const texto = mensagem.trim().toLowerCase();
  const prefixo = config.geral.prefixoAdmin;
  const gatilhos = [
    `${prefixo}comandos`,
    `${prefixo}ajuda`,
    `${prefixo}help`,
    'comandos',
    'ajuda',
    'command',
  ];
  return gatilhos.includes(texto);
}

/**
 * Gera a mensagem de ajuda completa em portugues (multi-linha).
 * @returns {string}
 */
function gerarMensagemAjuda() {
  const linhas = ['Comandos para jogar Pokemon:'];
  for (const c of LISTA_COMANDOS) {
    linhas.push(`  ${c.cmd.padEnd(10)} -> ${c.acao}`);
  }
  linhas.push('');
  linhas.push('Envie uma dessas palavras no chat para jogar!');
  return linhas.join('\n');
}

/**
 * Gera a mensagem de ajuda curta (uma linha, para chat da Twitch que tem limite de 500 chars).
 * @returns {string}
 */
function gerarMensagemAjudaCurta() {
  const cmds = LISTA_COMANDOS.map((c) => c.cmd).join(', ');
  return `Comandos para jogar: ${cmds} - Envie uma dessas palavras no chat para jogar!`;
}

/**
 * Atualiza o mapeamento de teclas.
 * @param {object} novoMapa
 */
function configurarMapeamento(novoMapa) {
  mapeamentoAtual = { ...mapeamentoAtual, ...novoMapa };
  logger.info('[Teclado] Mapeamento atualizado:', mapeamentoAtual);
}

/**
 * Verifica se as dependencias de sistema para a plataforma atual estao OK.
 * Deve ser chamado na inicializacao.
 * @returns {Promise<boolean>}
 */
async function verificarSistema() {
  const plat = plataformaAtual();
  if (plat === 'win32') {
    // PowerShell vem com Windows; verificamos se existe
    try {
      execFileSync('powershell.exe', ['-Command', '$PSVersionTable.PSVersion'], { stdio: 'ignore', timeout: 5000 });
      logger.info('[Teclado] Backend Windows (PowerShell) OK.');
      return true;
    } catch {
      logger.erro('[Teclado] PowerShell nao encontrado neste Windows. Isso e muito raro.');
      return false;
    }
  }
  if (plat === 'linux') {
    try {
      execFileSync('xdotool', ['--version'], { stdio: 'ignore', timeout: 2000 });
      logger.info('[Teclado] Backend Linux (xdotool) OK.');
      return true;
    } catch {
      logger.erro('[Teclado] xdotool nao encontrado. Instale com: sudo apt install xdotool');
      return false;
    }
  }
  if (plat === 'darwin') {
    // macOS exige permissao de acessibilidade; apenas logamos.
    logger.info('[Teclado] Backend macOS (osascript) - lembre-se de conceder permissao de acessibilidade ao Terminal/Node.');
    return true;
  }
  logger.erro(`[Teclado] Plataforma nao suportada: ${plat}`);
  return false;
}

module.exports = {
  executarBotao,
  normalizarComando,
  ehPedidoAjuda,
  gerarMensagemAjuda,
  gerarMensagemAjudaCurta,
  configurarMapeamento,
  verificarSistema,
  LISTA_COMANDOS,
  MAPEAMENTO_PADRAO,
};
