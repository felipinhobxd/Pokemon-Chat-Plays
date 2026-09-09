/**
 * Alvo do controle (v2.4): qual .exe do emulador vai receber as teclas.
 *
 * O streamer pediu: "digitou up, mas estou no OBS — ele controla o jogo
 * mesmo assim". Para isso o bot manda as teclas DIRETO para a janela do
 * emulador (PostMessage, sem precisar de foco) — e para saber qual janela
 * é a certa, ele pergunta o caminho do .exe ANTES de iniciar
 * (ou usa o EMULADOR_EXE do .env).
 *
 * Fluxo de decisão:
 *  1. EMULADOR_EXE definido no .env  -> usa direto (nem pergunta)
 *  2. Senão, pergunta no terminal no boot:
 *     - cola um caminho        -> modo JANELA (salva para o próximo boot)
 *     - responde "global"      -> modo GLOBAL (teclas vão p/ janela em foco)
 *     - Enter                  -> mantém o salvo (ou global se não há salvo)
 *
 * O último caminho usado fica salvo em dados/emulador.json — o Enter do
 * próximo boot mantém o salvo, então só precisa colar UMA vez.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const logger = require('./logger');

/**
 * Limpa a resposta do usuário: tira espaços e aspas (o Windows "Copiar
 * como caminho" cola com aspas) e aceita caminho vazio.
 * @param {string} resposta
 * @returns {string} caminho limpo ('' = vazio)
 */
function normalizarCaminhoExe(resposta) {
  let t = String(resposta || '').trim();
  if (!t) return '';
  const aspas = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  if (aspas && t.length >= 2) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Carrega o último caminho salvo (dados/emulador.json).
 * @param {string} arquivo
 * @returns {string|null} caminho salvo ou null
 */
function carregarSalvo(arquivo) {
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    const exe = normalizarCaminhoExe(dados && dados.exe);
    return exe || null;
  } catch {
    return null; // não existe / corrompido — sem drama
  }
}

/**
 * Salva o último caminho usado (vazio = usuário escolheu modo global).
 * @param {string} arquivo
 * @param {string|null} exe
 * @returns {boolean}
 */
function salvarAlvo(arquivo, exe) {
  try {
    fs.mkdirSync(path.dirname(path.resolve(arquivo)), { recursive: true });
    const corpo = JSON.stringify({ exe: exe || '', salvoEm: new Date().toISOString() }, null, 2);
    fs.writeFileSync(arquivo, corpo);
    return true;
  } catch (err) {
    logger.aviso(`[Emulador] Não foi possível salvar o caminho (${err.message}).`);
    return false;
  }
}

/** Arquivo .exe existe neste PC? (só para avisar — não bloqueia) */
function arquivoExiste(exe) {
  try {
    return Boolean(exe) && fs.existsSync(exe) && fs.statSync(exe).isFile();
  } catch {
    return false;
  }
}

/**
 * Decisão PURA de qual alvo usar (fácil de testar sem terminal).
 * @param {object} p
 * @param {string} [p.envExe] - valor do EMULADOR_EXE do .env
 * @param {string|null} [p.salvo] - último caminho salvo
 * @param {string} [p.resposta] - o que o usuário digitou no prompt
 * @returns {{exe: string|null, origem: string, salvar: boolean}}
 *   exe=null significa modo GLOBAL (janela em foco, como antes)
 */
function decidirAlvo({ envExe, salvo, resposta } = {}) {
  const env = normalizarCaminhoExe(envExe);
  if (env) return { exe: env, origem: 'env', salvar: false };

  const resp = normalizarCaminhoExe(resposta);
  if (resp) {
    if (/^(global|globar|nenhum|off|nao|no)$/.test(resp.toLowerCase())) {
      return { exe: null, origem: 'global', salvar: true };
    }
    return { exe: resp, origem: 'digitado', salvar: true };
  }

  if (salvo) return { exe: salvo, origem: 'salvo', salvar: false };
  return { exe: null, origem: 'padrao', salvar: false };
}

/**
 * Faz uma pergunta no terminal e resolve com a resposta.
 * Streams injetáveis para os testes usarem PassThrough.
 * @param {string} pergunta
 * @param {object} [opcoes] - { entrada, saida } para testes
 * @returns {Promise<string>}
 */
function perguntar(pergunta, opcoes = {}) {
  const entrada = opcoes.entrada || process.stdin;
  const saida = opcoes.saida || process.stdout;
  return new Promise((resolve) => {
    let rl;
    try {
      rl = readline.createInterface({ input: entrada, output: saida, terminal: false });
    } catch (err) {
      logger.aviso(`[Emulador] Terminal indisponível para perguntas (${err.message}).`);
      resolve('');
      return;
    }
    rl.question(String(pergunta), (resposta) => {
      try { rl.close(); } catch { /* já fechado */ }
      resolve(String(resposta || ''));
    });
  });
}

module.exports = {
  normalizarCaminhoExe,
  carregarSalvo,
  salvarAlvo,
  arquivoExiste,
  decidirAlvo,
  perguntar,
};
