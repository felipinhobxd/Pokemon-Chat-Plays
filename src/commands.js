/**
 * Parser central de comandos do chat (ChatPlays).
 *
 * v2.9: os BOTÕES não são mais uma lista fixa — vivem no REGISTRO de
 * controles (src/controles.js), alimentado pelo .env (compatibilidade com
 * as versões antigas) ou por dados/controles.json (assistente). O parser
 * consulta o registro na hora: controles personalizados do Minecraft (ou
 * de qualquer jogo) funcionam sem tocar em código.
 *
 * Converte uma mensagem bruta do chat em um comando estruturado:
 *      { tipo: 'botao',  botao: 'up' }            // id do controle
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
 * "hold salvar" (savestate, toque instantâneo) continua virando toque —
 * a regra agora é geral: qualquer controle NÃO segurável (combos tipo
 * shift+f5 e savestates) vira toque em vez de hold.
 */

const { config } = require('./config');
const controles = require('./controles');
const { parseDuracaoMs, duracaoEfetiva } = require('./utils/duracao');

// O vocabulário do sistema (verbos de hold, soltar, saudações e nomes dos
// comandos !) vive no registro — fonte única, também usada para validar
// aliases novos no assistente.
const HOLD_VERBOS = controles.VERBOS_HOLD;
const SOLTAR_PALAVRAS = controles.PALAVRAS_SOLTAR;
const OLA_PALAVRAS = controles.PALAVRAS_OLA;
const INFO_COMANDOS = {
  ...controles.NOMES_INFO,
  // v2.9.3: os comandos administrativos de modo também aceitam inglês.
  modo: [...controles.NOMES_INFO.modo, 'democracy', 'anarchy', 'vote', 'voting'],
};

/** Remove acentos de um texto (para aceitar "segurar címa", "olá" etc.). */
const removerAcentos = controles.removerAcentos;

/**
 * Aliases de compatibilidade PT-BR/EN para controles clássicos.
 *
 * O assistente permite editar aliases livremente e instalações antigas podem
 * ter salvo apenas a versão inglesa (ex.: "right"). Para não deixar uma live
 * quebrar depois de upgrade, estes pares continuam funcionando enquanto o
 * controle embutido correspondente estiver ATIVO.
 *
 * Importante: um alias configurado explicitamente pelo streamer sempre ganha.
 * Assim, se um controle custom usar "cima", não roubamos essa escolha.
 */
const ALIASES_BILINGUES = Object.freeze({
  up: ['cima', 'up'],
  down: ['baixo', 'down'],
  left: ['esquerda', 'left'],
  right: ['direita', 'right'],
  start: ['iniciar', 'start'],
  select: ['selecionar', 'select'],
  salvar: ['salvar', 'save'],
  carregar: ['carregar', 'load'],
});

/** Canoniza equivalentes em inglês dos comandos de modo. */
const MODO_INFO_CANONICO = Object.freeze({
  democracy: 'democracia',
  anarchy: 'anarquia',
  vote: 'votacao',
  voting: 'votacao',
});

/**
 * Resolve um texto para um controle ativo.
 *
 * Ordem:
 *  1. alias configurado pelo usuário (fonte de verdade);
 *  2. fallback bilíngue dos controles clássicos.
 *
 * Isso corrige configurações persistidas que perderam "cima/baixo/..."
 * sem sobrescrever aliases personalizados.
 * @param {string} alias
 * @returns {string|null}
 */
function resolverControle(alias) {
  const normalizado = controles.normalizarAlias(alias);
  if (!normalizado) return null;

  const configurado = controles.resolverAlias(normalizado);
  if (configurado) return configurado;

  const ativos = new Set(controles.ativos().map((c) => c.id));
  for (const [id, aliases] of Object.entries(ALIASES_BILINGUES)) {
    if (ativos.has(id) && aliases.includes(normalizado)) return id;
  }
  return null;
}

/**
 * Lista os aliases que REALMENTE funcionam para um controle agora.
 * Usado pelo !comandos para não esconder os fallbacks PT-BR/EN e, ao mesmo
 * tempo, não anunciar um fallback que foi explicitamente ocupado por outro
 * controle personalizado.
 * @param {object} controle
 * @returns {string[]}
 */
function aliasesEfetivos(controle) {
  if (!controle || !controle.id) return [];
  const candidatos = [
    ...(Array.isArray(controle.aliases) ? controle.aliases : []),
    ...(ALIASES_BILINGUES[controle.id] || []),
  ];
  const saida = [];
  const vistos = new Set();
  for (const alias of candidatos) {
    const n = controles.normalizarAlias(alias);
    if (!n || vistos.has(n)) continue;
    vistos.add(n);
    if (resolverControle(n) === controle.id) saida.push(n);
  }
  return saida;
}

/**
 * Interpreta a parte de trás de um comando de hold (controle + duração).
 * O alias pode ter VÁRIAS palavras ("barra de espaco"): casa o MAIOR
 * prefixo de palavras que resolve no registro; o que sobrar vira o
 * argumento de duração ("hold barra de espaco 2" → alias de 3 palavras
 * + duração 2s; "hold cima 3" → alias "cima" + 3s).
 * @param {string} resto - Texto após o verbo (ex: "cima", "up 500ms", "barra de espaco 2")
 * @returns {object|null}
 */
function parseHoldResto(resto) {
  const partes = resto.split(/\s+/).filter(Boolean);
  if (partes.length === 0) return { tipo: 'hold-invalido' };

  let botao = null;
  let fimDoAlias = 0;
  for (let n = partes.length; n >= 1; n--) {
    const id = resolverControle(partes.slice(0, n).join(' '));
    if (id) {
      botao = id;
      fimDoAlias = n;
      break;
    }
  }
  if (!botao) return { tipo: 'hold-invalido' };

  // controle não segurável (savestate, combo): "hold salvar" vira toque
  if (!controles.ehSeguravel(botao)) return { tipo: 'botao', botao };

  // v3.1: o parser de duração é COMPARTILHADO com mouse/gamepad (1ms–10s,
  // segundos decimais, compatibilidade de número puro "3" = 3s). Piso
  // artificial de 100ms removido — "hold w 1ms" é legítimo.
  let duracaoMs = null;
  const argDuracao = partes[fimDoAlias];
  if (argDuracao) duracaoMs = parseDuracaoMs(argDuracao);
  // sufixo inválido (ex: "hold cima abc") -> null -> usa o padrão

  duracaoMs = duracaoEfetiva(duracaoMs, config.geral);

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
      if (resolverControle(resto.split(/\s+/)[0])) {
        return parseHoldResto(resto);
      }
    }
  }

  return null;
}

/**
 * Converte uma mensagem bruta do chat em comando estruturado.
 * Consulta o REGISTRO de controles — Twitch e YouTube passam pelo MESMO
 * lugar (não existe lista de comandos por plataforma).
 * @param {string} mensagemBruta - Mensagem exatamente como enviada
 * @returns {object|null} Comando estruturado ou null se não for comando
 */
function parseComando(mensagemBruta) {
  if (typeof mensagemBruta !== 'string') return null;
  // normaliza: minúsculas + sem acentos + espaços colapsados (alias de
  // várias palavras tipo "barra de espaco" tem que casar mesmo se o chat
  // digitar espaços duplos — mesmas regras do normalizarAlias do registro)
  const texto = removerAcentos(mensagemBruta.trim().toLowerCase()).replace(/\s+/g, ' ');
  if (!texto || texto.length > 100) return null;

  // 1) Comandos de informação (com prefixo admin, ex: "!comandos")
  const prefixo = config.geral.prefixoAdmin;
  if (prefixo && texto.startsWith(prefixo)) {
    const nome = texto.slice(prefixo.length).trim().split(/\s+/)[0];
    if (!nome) return null;
    for (const [chave, nomes] of Object.entries(INFO_COMANDOS)) {
      if (nomes.includes(nome)) {
        const bruto = chave === 'modo' ? (MODO_INFO_CANONICO[nome] || nome) : nome;
        return { tipo: 'info', comando: chave, bruto };
      }
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

  // 5) Controle simples (alias configurado ou fallback PT-BR/EN)
  const botao = resolverControle(texto);
  if (botao) return { tipo: 'botao', botao };

  return null;
}

module.exports = {
  parseComando,
  removerAcentos,
  resolverControle,
  aliasesEfetivos,
  ALIASES_BILINGUES,
};
