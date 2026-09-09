/**
 * Controlador de teclado usando robotjs.
 * Simula as teclas que um GameBoy Advance (ou outro emulador) espera.
 *
 * Mapeamento padrão (compatível com VisualBoyAdvance):
 *   Seta Cima    -> 'up'
 *   Seta Baixo   -> 'down'
 *   Seta Esquerda-> 'left'
 *   Seta Direita -> 'right'
 *   Botão A      -> 'x'
 *   Botão B      -> 'z'
 *   Botão L      -> 'a'
 *   Botão R      -> 's'
 *   Start        -> 'enter'
 *   Select       -> 'backspace'
 *
 * Você pode trocar o mapeamento editando o objeto MAPEAMENTO_TECLAS abaixo
 * ou passando uma configuração customizada.
 */

const robot = require('robotjs');
const logger = require('../utils/logger');
const { config } = require('../config');

// Mapeamento de botão do GameBoy -> tecla do teclado
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

// Aliases em português para os comandos
const ALIASES_PT = {
  // direcionais
  cima: 'up',
  baixo: 'down',
  esquerda: 'left',
  direita: 'right',
  // botões GBA
  start: 'start',
  seleciona: 'select',
  selecionar: 'select',
  // mantemos a/b/l/r em minúsculas
  a: 'a',
  b: 'b',
  l: 'l',
  r: 'r',
};

// Lista de comandos para a mensagem de ajuda
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
 * Atualiza o mapeamento de teclas (para uso futuro com config customizada).
 * @param {object} novoMapa
 */
function configurarMapeamento(novoMapa) {
  mapeamentoAtual = { ...mapeamentoAtual, ...novoMapa };
  logger.info('[Teclado] Mapeamento atualizado:', mapeamentoAtual);
}

/**
 * Pressiona e solta uma tecla.
 * @param {string} tecla - Nome da tecla no formato robotjs
 */
function pressionarTecla(tecla) {
  try {
    robot.keyToggle(tecla, 'down');
    setTimeout(() => {
      try {
        robot.keyToggle(tecla, 'up');
      } catch (err) {
        logger.erro(`[Teclado] Falha ao soltar tecla "${tecla}": ${err.message}`);
      }
    }, duracaoTecla);
  } catch (err) {
    logger.erro(`[Teclado] Falha ao pressionar tecla "${tecla}": ${err.message}`);
  }
}

/**
 * Executa um botão do controle do GameBoy.
 * @param {string} botao - Nome do botão (up, down, left, right, a, b, l, r, start, select)
 * @returns {boolean} true se o botão foi executado com sucesso
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
 * Normaliza a mensagem do chat para o nome de botão correspondente.
 * Aceita termos em inglês e português.
 * @param {string} mensagem - Mensagem bruta do chat
 * @returns {string|null} - Nome do botão ou null se não for comando
 */
function normalizarComando(mensagem) {
  if (!mensagem) return null;
  const texto = mensagem.trim().toLowerCase();

  // Tentativa direta no mapeamento
  if (texto in mapeamentoAtual) return texto;

  // Tentativa nos aliases em português
  if (texto in ALIASES_PT) return ALIASES_PT[texto];

  return null;
}

/**
 * Verifica se a mensagem é um gatilho para listar comandos.
 * Aceita: !comandos, !ajuda, !help, comandos, ajuda, command
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
 * Gera a mensagem de ajuda em português.
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

module.exports = {
  executarBotao,
  normalizarComando,
  ehPedidoAjuda,
  gerarMensagemAjuda,
  configurarMapeamento,
  LISTA_COMANDOS,
  MAPEAMENTO_PADRAO,
};
