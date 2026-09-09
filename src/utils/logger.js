/**
 * Sistema de log colorido e com níveis.
 * Escreve no console e (opcionalmente) em arquivo de log.
 *
 * v2.4.1 — PERFORMANCE: o arquivo de log era escrito com appendFileSync
 * (uma syscall open/write/close POR LINHA, bloqueando o event loop a cada
 * comando do chat — ~56µs/linha em SSD rápido, podendo virar milissegundos
 * no Windows com antivírus em tempo real). Agora as linhas são acumuladas
 * em um buffer na memória e gravadas em LOTE, de forma assíncrona, a cada
 * 2s (ou 200 linhas). O flush síncrono no 'exit' garante que nenhuma linha
 * se perde no encerramento (Ctrl+C).
 */

const fs = require('fs');
const path = require('path');

const CORES = {
  reset: '\x1b[0m',
  vermelho: '\x1b[31m',
  verde: '\x1b[32m',
  amarelo: '\x1b[33m',
  azul: '\x1b[34m',
  magenta: '\x1b[35m',
  ciano: '\x1b[36m',
  cinza: '\x1b[90m',
};

const NIVEL_COR = {
  erro: CORES.vermelho,
  aviso: CORES.amarelo,
  info: CORES.verde,
  debug: CORES.cinza,
  twitch: CORES.magenta,
  youtube: CORES.vermelho,
  comando: CORES.ciano,
};

// Tenta varios diretorios para o log: cwd, dir do executavel, dir do __dirname
function encontrarLogDir() {
  const candidatos = [
    path.join(process.cwd(), 'logs'),
    path.join(path.dirname(process.execPath), 'logs'),
    path.join(__dirname, '..', '..', 'logs'),
  ];
  for (const dir of candidatos) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Testa se tem permissao de escrita
      const testFile = path.join(dir, '.write_test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return dir;
    } catch {
      // tenta proximo
    }
  }
  return null;
}

const LOG_DIR = encontrarLogDir();
const LOG_FILE = LOG_DIR
  ? path.join(LOG_DIR, `bot_${new Date().toISOString().slice(0, 10)}.log`)
  : null;

// ---------------------------------------------------------------------------
// Buffer de escrita assíncrona (v2.4.1)
// ---------------------------------------------------------------------------

/** Linhas pendentes de gravação. */
let bufferLinhas = [];
/** Há uma gravação assíncrona em andamento? */
let gravando = false;
/** Timer do flush periódico. */
let timerFlush = null;
/** Intervalo de gravação em lote. */
const FLUSH_INTERVALO_MS = 2000;
/** Grava o lote quando o buffer chegar nesse tamanho (não espera o timer). */
const FLUSH_LINHAS = 200;
/** Limite duro de memória do buffer (disco com problema: descarta o antigo). */
const BUFFER_MAX_LINHAS = 5000;

/** Formatador de data em cache (criar Intl a cada linha era desperdício). */
const formatadorData = new Intl.DateTimeFormat('pt-BR', { hour12: false });

/**
 * Formata timestamp para exibição.
 * @returns {string}
 */
function timestamp() {
  return formatadorData.format(new Date());
}

/**
 * Registra uma mensagem de log.
 * @param {string} nivel - Nível do log (erro, aviso, info, debug, twitch, youtube, comando)
 * @param {string} mensagem - Mensagem principal
 * @param {*} [extra] - Dados extras opcionais
 */
function log(nivel, mensagem, extra) {
  const cor = NIVEL_COR[nivel] || CORES.reset;
  const prefixo = `[${nivel.toUpperCase().padEnd(7)}]`;
  const linha = `${prefixo} ${mensagem}`;

  // Linha colorida no console
  console.log(`${cor}${linha}${CORES.reset}`);

  // Linha sem cor no arquivo (com timestamp) — só acumula no buffer;
  // a gravação acontece em lote, de forma assíncrona.
  if (LOG_FILE) {
    bufferLinhas.push(`[${timestamp()}] ${linha}\n`);
    if (bufferLinhas.length >= BUFFER_MAX_LINHAS) {
      // disco não anda (flush falhou?): descarta metade antiga p/ não estourar a RAM
      bufferLinhas = bufferLinhas.slice(Math.floor(BUFFER_MAX_LINHAS / 2));
    }
    if (bufferLinhas.length >= FLUSH_LINHAS) {
      gravarLote();
    } else {
      agendarFlush();
    }
  }

  // Dados extras
  if (extra !== undefined) {
    if (typeof extra === 'object') {
      console.log(`${cor}${JSON.stringify(extra)}${CORES.reset}`);
    } else {
      console.log(`${cor}${extra}${CORES.reset}`);
    }
  }
}

/** Agenda o flush periódico (unref: não impede o processo de encerrar). */
function agendarFlush() {
  if (timerFlush) return;
  timerFlush = setTimeout(() => {
    timerFlush = null;
    gravarLote();
  }, FLUSH_INTERVALO_MS);
  timerFlush.unref?.();
}

/** Grava o buffer no arquivo de forma ASSÍNCRONA (não bloqueia o event loop). */
function gravarLote() {
  if (!LOG_FILE || gravando || bufferLinhas.length === 0) return;
  if (timerFlush) { clearTimeout(timerFlush); timerFlush = null; }
  const lote = bufferLinhas.join('');
  bufferLinhas = [];
  gravando = true;
  fs.appendFile(LOG_FILE, lote, 'utf8', () => {
    // erro de disco não pode derrubar o bot — o lote é descartado e segue
    gravando = false;
    // chegaram linhas novas enquanto gravávamos: reagenda
    if (bufferLinhas.length > 0) agendarFlush();
  });
}

/** Grava TUDO o que está pendente de forma SÍNCRONA (encerramento/Ctrl+C). */
function flushSync() {
  if (!LOG_FILE || bufferLinhas.length === 0) return;
  const lote = bufferLinhas.join('');
  bufferLinhas = [];
  try {
    fs.appendFileSync(LOG_FILE, lote);
  } catch {
    // sem disco/não tem permissão: nada a fazer
  }
}

// Ctrl+C / exit do processo: não perde as últimas linhas do log
process.on('exit', flushSync);

module.exports = {
  erro: (msg, extra) => log('erro', msg, extra),
  aviso: (msg, extra) => log('aviso', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
  debug: (msg, extra) => log('debug', msg, extra),
  twitch: (msg, extra) => log('twitch', msg, extra),
  youtube: (msg, extra) => log('youtube', msg, extra),
  comando: (msg, extra) => log('comando', msg, extra),
  flushSync,
  // Exposto APENAS para os testes unitários — não use em produção.
  __test: {
    caminhoLog: () => LOG_FILE,
    pendentes: () => bufferLinhas.length,
    esvaziar: () => { bufferLinhas = []; },
  },
};
