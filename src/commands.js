/**
 * Registro central de comandos do Pokemon Chat Plays.
 *
 * Responsabilidades:
 *  - Definir os botões do controle, seus aliases (PT/EN) e ícones de exibição.
 *  - Converter uma mensagem bruta do chat em um comando estruturado:
 *      { tipo: 'botao',  botao: 'up' }
 *      { tipo: 'hold',   botao: 'up', duracaoMs: 3000 }
 *      { tipo: 'soltar' }
 *      { tipo: 'info',   comando: 'comandos', bruto: 'comandos' }
 *      { tipo: 'ola' }
 *      { tipo: 'hold-invalido' }
 *      null  (não é comando)
 *
 * Regras de duração do hold:
 *  - "hold cima"        -> segura pelo tempo padrão (HOLD_DEFAULT_MS, 1s)
 *  - "hold cima 3"      -> número <= 30 é interpretado como SEGUNDOS
 *  - "hold cima 500"    -> número >  30 é interpretado como MILISSEGUNDOS
 *  - "hold cima 500ms"  -> sufixo explícito em milissegundos
 *  - "hold cima 2s"     -> sufixo explícito em segundos
 *  - O valor é limitado a HOLD_MAX_MS (padrão 10s) por segurança.
 *
 * Novidade da v2.5 (SAVES):
 *  - "salvar" e "carregar" são botões (savestates do emulador, ex.: F5).
 *  - "hold salvar" não faz sentido (o save é instantâneo): vira toque.
 */

const { config } = require('./config');

/** Aliases aceitos no chat -> botão canônico do controle. */
const ALIASES = {
  // Botões de ação
  a: 'a',
  b: 'b',
  l: 'l',
  r: 'r',
  start: 'start',
  select: 'select',
  seleciona: 'select',
  selecionar: 'select',

  // Savestates (v2.5) — o chat salva o ponto e volta no tempo
  salvar: 'salvar',
  salva: 'salvar',
  save: 'salvar',
  carregar: 'carregar',
  carrega: 'carregar',
  load: 'carregar',

  // Direções (EN + PT + variações comuns)
  up: 'up',
  cima: 'up',
  subir: 'up',
  sobe: 'up',
  down: 'down',
  baixo: 'down',
  descer: 'down',
  desce: 'down',
  left: 'left',
  esquerda: 'left',
  esq: 'left',
  right: 'right',
  direita: 'right',
  dir: 'right',
};

/** Botões canônicos com rótulo e ícone para exibição no chat. */
const BOTOES = {
  up: { rotulo: 'CIMA', icone: '⬆' },
  down: { rotulo: 'BAIXO', icone: '⬇' },
  left: { rotulo: 'ESQUERDA', icone: '⬅' },
  right: { rotulo: 'DIREITA', icone: '➡' },
  a: { rotulo: 'A', icone: '🅰' },
  b: { rotulo: 'B', icone: '🅱' },
  l: { rotulo: 'L', icone: '🔵' },
  r: { rotulo: 'R', icone: '🔴' },
  start: { rotulo: 'START', icone: '▶' },
  select: { rotulo: 'SELECT', icone: '▦' },
  // v2.5: savestates
  salvar: { rotulo: 'SALVAR', icone: '💾' },
  carregar: { rotulo: 'CARREGAR', icone: '📂' },
};

/** Direções na ordem de exibição. */
const DIRECOES = ['up', 'down', 'left', 'right'];

/** Botões de ação na ordem de exibição. */
const BOTOES_ACAO = ['a', 'b', 'l', 'r', 'start', 'select'];

/** Botões de savestate (v2.5) — o toque é instantâneo, nunca hold. */
const SAVES = ['salvar', 'carregar'];

/** Verbos que iniciam um comando de segurar tecla. */
const HOLD_VERBOS = ['hold', 'segurar', 'segura', 'segure', 'segurando'];

/** Palavras que soltam todas as teclas presas. */
const SOLTAR_PALAVRAS = [
  'soltar',
  'solta',
  'solte',
  'soltando',
  'release',
  'relaxa',
  'largar',
  'largue',
  'solteira',
];

/** Saudações reconhecidas. */
const OLA_PALAVRAS = ['ola', 'oi', 'oie', 'hello', 'hey', 'hi', 'eae', 'salve'];

/** Nomes aceitos para cada comando de informação (após o prefixo admin). */
const INFO_COMANDOS = {
  comandos: ['comandos', 'commands', 'cmd'],
  ajuda: ['ajuda', 'help', 'socorro'],
  hold: ['hold', 'segurar', 'segura'],
  stats: ['stats', 'estatisticas', 'status', 'stat'],
  top: ['top', 'ranking', 'rank', 'placar'],
  // v2.5
  uptime: ['uptime', 'tempo'],
  recorde: ['recorde', 'record', 'maior'],
  modo: ['democracia', 'anarquia', 'votacao'],
};

/**
 * Remove acentos de um texto (para aceitar "segurar címa", "olá" etc.).
 * @param {string} texto
 * @returns {string}
 */
function removerAcentos(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Interpreta a parte de trás de um comando de hold (botão + duração opcional).
 * @param {string} resto - Texto após o verbo (ex: "cima", "up 500ms", "a 3")
 * @returns {object|null}
 */
function parseHoldResto(resto) {
  const partes = resto.split(/\s+/).filter(Boolean);
  if (partes.length === 0) return { tipo: 'hold-invalido' };

  const botao = ALIASES[partes[0]];
  if (!botao) return { tipo: 'hold-invalido' };

  // v2.5: "hold salvar" não faz sentido — o save é um toque instantâneo
  if (SAVES.includes(botao)) return { tipo: 'botao', botao };

  let duracaoMs = config.geral.holdPadraoMs;
  const argDuracao = partes[1];

  if (argDuracao) {
    const m = argDuracao.match(/^(\d{1,7})(ms|s|seg|segs|segundo|segundos)?$/);
    if (m) {
      const num = parseInt(m[1], 10);
      const sufixo = m[2] || null;
      if (sufixo === 'ms') {
        duracaoMs = num;
      } else if (sufixo) {
        duracaoMs = num * 1000; // s, seg, segundos...
      } else if (num <= 30) {
        duracaoMs = num * 1000; // número pequeno: segundos
      } else {
        duracaoMs = num; // número grande: milissegundos
      }
    }
    // sufixo inválido (ex: "hold cima abc") -> usa o padrão
  }

  // Limita a duração máxima por segurança
  duracaoMs = Math.min(Math.max(duracaoMs, 100), config.geral.holdMaxMs);

  return { tipo: 'hold', botao, duracaoMs };
}

/**
 * Tenta extrair um comando de hold de um texto normalizado.
 * Aceita "hold cima", "holdcima", "segurar up 3", "holdup 500ms" etc.
 * @param {string} texto - Texto já normalizado (sem acentos, minúsculo)
 * @returns {object|null}
 */
function extrairHold(texto) {
  const palavras = texto.split(/\s+/);

  // Caso 1: verbo separado por espaço -> "hold cima 3"
  for (const verbo of HOLD_VERBOS) {
    if (palavras[0] === verbo) {
      return parseHoldResto(palavras.slice(1).join(' '));
    }
  }

  // Caso 2: verbo colado no botão -> "holdcima", "holdup"
  // (só se o que vem depois é um botão/alias válido)
  for (const verbo of HOLD_VERBOS) {
    if (texto.startsWith(verbo) && texto.length > verbo.length) {
      const resto = texto.slice(verbo.length);
      if (ALIASES[resto.split(/\s+/)[0]]) {
        return parseHoldResto(resto);
      }
    }
  }

  return null;
}

/**
 * Converte uma mensagem bruta do chat em comando estruturado.
 * @param {string} mensagemBruta - Mensagem exatamente como enviada
 * @returns {object|null} Comando estruturado ou null se não for comando
 */
function parseComando(mensagemBruta) {
  if (typeof mensagemBruta !== 'string') return null;
  const texto = removerAcentos(mensagemBruta.trim().toLowerCase());
  if (!texto || texto.length > 100) return null;

  // 1) Comandos de informação (com prefixo admin, ex: "!comandos")
  const prefixo = config.geral.prefixoAdmin;
  if (prefixo && texto.startsWith(prefixo)) {
    const nome = texto.slice(prefixo.length).trim().split(/\s+/)[0];
    if (!nome) return null;
    for (const [chave, nomes] of Object.entries(INFO_COMANDOS)) {
      if (nomes.includes(nome)) return { tipo: 'info', comando: chave, bruto: nome };
    }
    return null;
  }

  // 2) Soltar todas as teclas
  if (SOLTAR_PALAVRAS.includes(texto)) {
    return { tipo: 'soltar' };
  }

  // 3) Comandos de segurar tecla (hold)
  const hold = extrairHold(texto);
  if (hold) return hold;

  // 4) Saudação
  if (OLA_PALAVRAS.includes(texto)) {
    return { tipo: 'ola' };
  }

  // 5) Botão simples
  const botao = ALIASES[texto];
  if (botao) return { tipo: 'botao', botao };

  return null;
}

module.exports = {
  ALIASES,
  BOTOES,
  DIRECOES,
  BOTOES_ACAO,
  SAVES,
  parseComando,
  removerAcentos,
};
