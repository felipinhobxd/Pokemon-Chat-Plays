/**
 * Gerenciador de jogo (v2.7) — abre, vigia e REABRE o jogo do stream.
 *
 * Pedido do streamer: "ele pergunta o PATH do jogo, não só o emulador,
 * porque assim pode usar VÁRIOS emuladores, ou até jogos como Minecraft.
 * E faz com que ele cheque se o jogo fechou e tente abrir de novo com a
 * ROM que estava antes."
 *
 * Como funciona:
 *  1. No boot (com EMULADOR_EXE no .env/assistente):
 *     - jogo JÁ RODANDO?  -> modo ANEXAR: só vigia (não abre 2ª instância)
 *     - jogo PARADO?      -> ABRE: spawn(exe, [rom, ...args])
 *  2. Watchdog:
 *     - modo spawn: o evento 'exit' do filho avisa NA HORA que fechou
 *     - modo anexar: ping a cada 5s (tasklist no Win, pgrep no Linux/Mac)
 *  3. Jogo fechou?  -> espera JOGO_REINICIAR_DELAY_MS e reabre com a MESMA
 *     ROM. Anti crash-loop: se o jogo morrer rápido (< JOGO_VIDA_MINIMA_MS)
 *     JOGO_TENTATIVAS_MAX vezes seguidas, o bot DESISTE e avisa (ROM errada,
 *     exe quebrado... reabrir pra sempre só leria lixo no terminal).
 *
 * O processo do jogo NUNCA é morto pelo bot — é do streamer. O Ctrl+C do
 * bot encerra só a vigilância.
 *
 * Tudo que decide reinício é função PURA (avaliarQueda) — testável sem
 * processo de verdade.
 */

const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

/** Intervalo do ping de vigilância no modo anexar (ms). */
const INTERVALO_PING_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers puros (testáveis)
// ---------------------------------------------------------------------------

/**
 * Limpa um caminho colado pelo usuário: aspas do "Copiar como caminho"
 * do Windows, espaços das pontas, quebras de linha acidentais (colagem do
 * chat/terminal) e barras duplicadas.
 * @param {string} entrada
 * @returns {string}
 */
function normalizarCaminhoJogo(entrada) {
  let t = String(entrada || '').trim();
  if (!t) return '';
  const aspas = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  if (aspas && t.length >= 2) t = t.slice(1, -1).trim();
  t = t.replace(/[\r\n]+/g, '');
  t = t.replace(/\\\\+/g, '\\');
  return t.trim();
}

/**
 * Divide uma string de argumentos respeitando aspas ("a b" = um argumento).
 * @param {string} argsTexto
 * @returns {string[]}
 */
function dividirArgs(argsTexto) {
  const bruto = String(argsTexto || '').trim();
  if (!bruto) return [];
  const partes = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(bruto)) !== null) {
    partes.push(m[1] ?? m[2] ?? m[3]);
  }
  return partes;
}

/**
 * Linha de comando final do jogo (PURO — teste não executa nada).
 * @param {object} p - { exe, rom, args }
 * @returns {{file: string, args: string[], cwd: string|null}}
 */
function montarLinhaComando({ exe, rom, args } = {}) {
  const file = normalizarCaminhoJogo(exe);
  const lista = [];
  const romLimpa = normalizarCaminhoJogo(rom);
  if (romLimpa) lista.push(romLimpa);
  lista.push(...dividirArgs(args));
  let cwd = null;
  try {
    if (file) cwd = path.dirname(path.resolve(file));
  } catch { /* caminho esquisito — cwd fica null */ }
  return { file, args: lista, cwd };
}

/**
 * Decide o que fazer quando o jogo fecha (PURO — núcleo do watchdog).
 * @param {object} p
 * @param {boolean} p.autoReiniciar - vigília ligada?
 * @param {boolean} p.encerrando    - o próprio BOT está encerrando? (não reabre)
 * @param {boolean} p.desistiu      - já bateu o limite de tentativas?
 * @param {number}  p.viveuMs       - quanto tempo esta rodada viveu
 * @param {number}  p.tentativas    - quedas rápidas consecutivas ATÉ AGORA
 * @param {number}  p.tentativasMax - teto de quedas rápidas
 * @param {number}  p.vidaMinimaMs  - abaixo disto a queda é "rápida"
 * @returns {{acao: 'reabrir'|'nada'|'desistir', tentativas: number, motivo: string}}
 */
function avaliarQueda({ autoReiniciar, encerrando, desistiu, viveuMs, tentativas, tentativasMax, vidaMinimaMs } = {}) {
  if (encerrando) return { acao: 'nada', tentativas, motivo: 'bot encerrando' };
  if (!autoReiniciar) return { acao: 'nada', tentativas, motivo: 'reinício automático desligado' };
  if (desistiu) return { acao: 'nada', tentativas, motivo: 'desistiu (crash loop)' };

  const rapida = Number(viveuMs || 0) < Number(vidaMinimaMs || 0);
  const novoContador = rapida ? tentativas + 1 : 0;
  if (novoContador >= Number(tentativasMax || 0)) {
    return { acao: 'desistir', tentativas: novoContador, motivo: 'crash loop' };
  }
  return {
    acao: 'reabrir',
    tentativas: novoContador,
    motivo: rapida ? 'queda rápida' : 'fechou depois de rodar',
  };
}

/** Nome base do executável em qualquer formato de barra. */
function nomeDoProcesso(exe) {
  const limpo = normalizarCaminhoJogo(exe);
  if (!limpo) return '';
  return limpo.replace(/\\/g, '/').split('/').filter(Boolean).pop() || limpo;
}

/**
 * Conta quantas linhas de CSV do tasklist são registros de processo
 * (linhas começando com aspas; o cabeçalho também é uma — 2+ = rodando).
 * @param {string} saida
 * @returns {number}
 */
function contarLinhasDeProcesso(saida) {
  return String(saida || '')
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('"')).length;
}

// ---------------------------------------------------------------------------
// Estado do gerenciador
// ---------------------------------------------------------------------------

let cfg = {
  exe: '',
  rom: '',
  args: '',
  autoReiniciar: true,
  delayMs: 3000,
  tentativasMax: 5,
  vidaMinimaMs: 15000,
};

let procAtual = null;      // child process quando o bot abriu o jogo
let inicioDaVida = 0;      // quando esta rodada nasceu (p/ vida da rodada)
let timerReabrir = null;
let timerPing = null;
let modoOperacao = 'off';  // 'spawn' | 'anexar' | 'off'
let rodando = false;
let reinicios = 0;
let tentativasRapidas = 0;
let desistiu = false;
let encerrando = false;
let aoEvento = () => {};

/**
 * Detector de "o jogo está rodando?" — injetável para os testes (em
 * produção é o jogoEstaRodando real: tasklist/pgrep).
 */
let detectorDeProcesso = null;

/** Notifica o index.js (log + overlay) do que aconteceu. */
function notificar(tipo, detalhes = {}) {
  try {
    aoEvento({
      tipo,
      rodando,
      reinicios,
      tentativas: tentativasRapidas,
      desistiu,
      modo: modoOperacao,
      ...detalhes,
    });
  } catch { /* listener do index nunca pode derrubar o watchdog */ }
}

// ---------------------------------------------------------------------------
// Detecção de processo rodando (modo anexar)
// ---------------------------------------------------------------------------

/**
 * O jogo está rodando neste PC? (best-effort por plataforma)
 * Windows: tasklist /fo csv /fi "IMAGENAME eq nome.exe" — o filtro é por
 * NOME (não caminho) porque o tasklist não aceita caminho; se o streamer
 * tem outro exe com o mesmo nome, no pior caso ele "anexa" errado e não
 * abre 2ª instância — cenário inofensivo.
 * Linux/macOS: pgrep -f caminho.
 * @returns {Promise<boolean|null>} true/false; null = não sei (plataforma
 *   sem suporte — o watchdog de anexo fica desligado)
 */
function jogoEstaRodando() {
  if (detectorDeProcesso) return Promise.resolve().then(detectorDeProcesso);
  return new Promise((resolve) => {
    const nome = nomeDoProcesso(cfg.exe);
    if (!nome) { resolve(false); return; }

    let proc;
    try {
      if (process.platform === 'win32') {
        proc = spawn('tasklist', ['/fo', 'csv', '/fi', `IMAGENAME eq ${nome}`], { stdio: ['ignore', 'pipe', 'ignore'] });
      } else if (process.platform === 'linux' || process.platform === 'darwin') {
        proc = spawn('pgrep', ['-f', normalizarCaminhoJogo(cfg.exe)], { stdio: ['ignore', 'ignore', 'ignore'] });
      } else {
        resolve(null);
        return;
      }
    } catch {
      resolve(null);
      return;
    }

    let saida = '';
    const concluir = (valor) => {
      proc.removeAllListeners?.();
      resolve(valor);
    };
    proc.on('error', () => concluir(null));
    proc.stdout?.on('data', (chunk) => { saida += String(chunk); });
    proc.on('close', (code) => {
      if (process.platform === 'win32') {
        concluir(contarLinhasDeProcesso(saida) >= 2);
      } else {
        concluir(code === 0);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Lançamento + watchdog
// ---------------------------------------------------------------------------

/** Abre o jogo (exe + ROM + args). Resolve true se o processo nasceu. */
function lancar() {
  const { file, args, cwd } = montarLinhaComando(cfg);
  if (!file) return false;

  try {
    const filho = spawn(file, args, {
      cwd: cwd || undefined,
      stdio: 'ignore',       // a saída do jogo não polui o terminal do bot
      detached: false,       // filho morde o mesmo console (sem flash de cmd)
    });
    procAtual = filho;
    inicioDaVida = Date.now();
    rodando = true;
    modoOperacao = 'spawn';

    const ehAtual = () => filho === procAtual;

    filho.on('error', (err) => {
      // spawn falhou (exe não existe etc.) — o 'exit' pode nem chegar
      logger.erro(`[Jogo] Não consegui abrir "${file}" (${err.message}).`);
      if (ehAtual()) tratarFechamento();
    });
    filho.on('exit', (codigo) => {
      if (!ehAtual()) return; // notícia de processo velho — ignora
      logger.info(`[Jogo] Processo terminou (código ${codigo}).`);
      tratarFechamento();
    });
    return true;
  } catch (err) {
    logger.erro(`[Jogo] Erro ao abrir "${file}": ${err.message}`);
    tratarFechamento();
    return false;
  }
}

/** O jogo fechou — decide reabrir / desistir / nada. */
function tratarFechamento() {
  procAtual = null;
  rodando = false;
  const viveuMs = inicioDaVida ? Date.now() - inicioDaVida : 0;
  inicioDaVida = 0;

  const decisao = avaliarQueda({
    autoReiniciar: cfg.autoReiniciar,
    encerrando,
    desistiu,
    viveuMs,
    tentativas: tentativasRapidas,
    tentativasMax: cfg.tentativasMax,
    vidaMinimaMs: cfg.vidaMinimaMs,
  });
  tentativasRapidas = decisao.tentativas;

  if (decisao.acao === 'desistir') {
    desistiu = true;
    notificar('desistiu');
    logger.erro(
      `[Jogo] ⛔ O jogo fechou rápido ${tentativasRapidas}x seguidas — desisti de reabrir. ` +
      'Confira se a ROM existe, se o caminho do .exe está certo e se o emulador abre na mão.'
    );
    pararPing();
    return;
  }

  if (decisao.acao !== 'reabrir') {
    notificar('fechou');
    logger.info('[Jogo] Jogo fechado — reinício automático desligado (JOGO_AUTO_REINICIAR=false).');
    pararPing();
    return;
  }

  // v2.7.1: reinicios conta reaberturas REAIS (incrementa no relançamento,
  // não na decisão — parar() antes do delay não deixa contagem fantasma)
  notificar('reabrindo');
  logger.aviso(
    `[Jogo] 🔄 Jogo fechou (${decisao.motivo}). Reabrindo em ${Math.round(cfg.delayMs / 1000)}s` +
    `${cfg.rom ? ` com a ROM ${nomeDoProcesso(cfg.rom)}` : ''} — tentativa rápida ${tentativasRapidas}/${cfg.tentativasMax}.`
  );
  timerReabrir = setTimeout(() => {
    timerReabrir = null;
    if (encerrando || desistiu) return;
    const nasceu = lancar();
    if (nasceu) {
      reinicios++;
      notificar('reaberto');
    }
  }, Math.max(0, Number(cfg.delayMs) || 0));
}

// ---------------------------------------------------------------------------
// Ping de vigilância (modo anexar — jogo aberto pelo próprio streamer)
// ---------------------------------------------------------------------------

function iniciarPing() {
  pararPing();
  timerPing = setInterval(async () => {
    if (encerrando || desistiu || procAtual) { if (procAtual) pararPing(); return; }
    const vivo = await jogoEstaRodando();
    if (vivo === null || vivo) return;      // null = não sei vigiar — desiste do ping
    if (vivo === false) {
      pararPing();
      logger.info('[Jogo] Detectei que o jogo foi fechado (vigília por ping).');
      inicioDaVida = inicioDaVida || (Date.now() - INTERVALO_PING_MS * 2); // ~vida estimada
      tratarFechamento();
    }
  }, INTERVALO_PING_MS);
  timerPing.unref?.();
}

function pararPing() {
  if (timerPing) { clearInterval(timerPing); timerPing = null; }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Define os parâmetros do gerenciador.
 * @param {object} opts - { exe, rom, args, autoReiniciar, delayMs,
 *   tentativasMax, vidaMinimaMs, aoEvento, detector (testes) }
 */
function configurar(opts = {}) {
  cfg = {
    exe: normalizarCaminhoJogo(opts.exe),
    rom: normalizarCaminhoJogo(opts.rom),
    args: String(opts.args || ''),
    autoReiniciar: opts.autoReiniciar !== false,
    delayMs: Number.isFinite(Number(opts.delayMs)) ? Number(opts.delayMs) : 3000,
    tentativasMax: Number(opts.tentativasMax) > 0 ? Number(opts.tentativasMax) : 5,
    vidaMinimaMs: Number(opts.vidaMinimaMs) >= 0 ? Number(opts.vidaMinimaMs) : 15000,
  };
  if (typeof opts.aoEvento === 'function') aoEvento = opts.aoEvento;
  detectorDeProcesso = typeof opts.detector === 'function' ? opts.detector : null;
}

/**
 * Sobe a vigilância (e abre o jogo se não estiver rodando).
 * @returns {Promise<{ok: boolean, modo: string}>}
 */
async function iniciar() {
  if (!cfg.exe) return { ok: false, modo: 'off' };
  encerrando = false;

  const jaRodando = await jogoEstaRodando();
  if (jaRodando === true) {
    // o streamer já abriu o jogo — só vigia (não abre 2ª instância)
    modoOperacao = 'anexar';
    rodando = true;
    inicioDaVida = Date.now();
    reinicios = 0;
    tentativasRapidas = 0;
    desistiu = false;
    notificar('anexado');
    logger.info(`[Jogo] 🎮 "${nomeDoProcesso(cfg.exe)}" já está rodando — só vigiando (reabro se fechar).`);
    iniciarPing();
    return { ok: true, modo: 'anexar' };
  }

  reinicios = 0;
  tentativasRapidas = 0;
  desistiu = false;
  const nasceu = lancar();
  if (nasceu) {
    notificar('aberto');
    const romTxt = cfg.rom ? ` com ${nomeDoProcesso(cfg.rom)}` : '';
    logger.info(`[Jogo] 🚀 Abri o jogo "${nomeDoProcesso(cfg.exe)}"${romTxt} — reabro sozinho se fechar (JOGO_AUTO_REINICIAR=${cfg.autoReiniciar ? 'on' : 'off'}).`);
  }
  return { ok: nasceu, modo: nasceu ? 'spawn' : 'off' };
}

/** Encerra a vigilância (NÃO mata o jogo — ele é do streamer). */
function parar() {
  encerrando = true;
  if (timerReabrir) { clearTimeout(timerReabrir); timerReabrir = null; }
  pararPing();
  procAtual = null;
  rodando = false;
}

/** Estado atual (overlay/log). */
function status() {
  return {
    ativo: modoOperacao !== 'off' || Boolean(cfg.exe),
    exe: cfg.exe,
    rom: cfg.rom,
    romNome: cfg.rom ? nomeDoProcesso(cfg.rom) : '',
    nome: nomeDoProcesso(cfg.exe),
    modo: modoOperacao,
    rodando: rodando || Boolean(procAtual),
    reabrindo: Boolean(timerReabrir),
    reinicios,
    tentativas: tentativasRapidas,
    tentativasMax: cfg.tentativasMax,
    desistiu,
  };
}

/** Reinicia o módulo inteiro (testes). */
function __resetTeste() {
  parar();
  encerrando = false;
  modoOperacao = 'off';
  rodando = false;
  reinicios = 0;
  tentativasRapidas = 0;
  desistiu = false;
  inicioDaVida = 0;
  aoEvento = () => {};
  detectorDeProcesso = null;
  cfg = {
    exe: '', rom: '', args: '', autoReiniciar: true,
    delayMs: 3000, tentativasMax: 5, vidaMinimaMs: 15000,
  };
}

module.exports = {
  // puros (testes)
  normalizarCaminhoJogo,
  dividirArgs,
  montarLinhaComando,
  avaliarQueda,
  nomeDoProcesso,
  contarLinhasDeProcesso,
  // gerenciador
  configurar,
  iniciar,
  parar,
  status,
  __resetTeste,
};
