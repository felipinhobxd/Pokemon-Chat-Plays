/**
 * Sistema de log colorido e com níveis.
 * Escreve no console e (opcionalmente) em arquivo de log.
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

/**
 * Formata timestamp para exibição.
 * @returns {string}
 */
function timestamp() {
  return new Date().toLocaleString('pt-BR', { hour12: false });
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

  // Linha sem cor no arquivo (com timestamp)
  if (LOG_FILE) {
    const linhaArquivo = `[${timestamp()}] ${linha}\n`;
    try {
      fs.appendFileSync(LOG_FILE, linhaArquivo);
    } catch {
      // Ignora erros de escrita em arquivo
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

module.exports = {
  erro: (msg, extra) => log('erro', msg, extra),
  aviso: (msg, extra) => log('aviso', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
  debug: (msg, extra) => log('debug', msg, extra),
  twitch: (msg, extra) => log('twitch', msg, extra),
  youtube: (msg, extra) => log('youtube', msg, extra),
  comando: (msg, extra) => log('comando', msg, extra),
};
