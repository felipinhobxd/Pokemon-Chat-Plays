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

// O vocabulário do sistema (verbos de hold, soltar, saudações e nomes dos
// comandos !) vive no registro — fonte única, também usada para validar
// aliases novos no assistente.
const HOLD_VERBOS = controles.VERBOS_HOLD;
const SOLTAR_PALAVRAS = controles.PALAVRAS_SOLTAR;
const OLA_PALAVRAS = controles.PALAVRAS_OLA;
const INFO_COMANDOS = controles.NOMES_INFO;

/** Remove acentos de um texto (para aceitar "segurar címa", "olá" etc.). */
const removerAcentos = controles.removerAcentos;

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
    const id = controles.resolverAlias(partes.slice(0, n).join(' '));
    if (id) {
      botao = id;
      fimDoAlias = n;
      break;
    }
  }
  if (!botao) return { tipo: 'hold-invalido' };

  // controle não segurável (savestate, combo): "hold salvar" vira toque
  if (!controles.ehSeguravel(botao)) return { tipo: 'botao', botao };

  let duracaoMs = config.geral.holdPadraoMs;
  const argDuracao = partes[fimDoAlias];

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
      if (controles.resolverAlias(resto.split(/\s+/)[0])) {
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

  // 5) Controle simples (alias do registro ativo)
  const botao = controles.resolverAlias(texto);
  if (botao) return { tipo: 'botao', botao };

  return null;
}

module.exports = {
  parseComando,
  removerAcentos,
};
