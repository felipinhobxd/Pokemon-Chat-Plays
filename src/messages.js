/**
 * Formatação central das mensagens que o bot envia no chat.
 *
 * Objetivos:
 *  - Texto bonito, organizado e fácil de ler na Twitch (e YouTube).
 *  - Cada mensagem respeita o limite de ~500 caracteres por linha do IRC.
 *  - Sem hardcode espalhado: todo texto de chat do bot nasce aqui.
 */

const { BOTOES, DIRECOES, BOTOES_ACAO } = require('./commands');

/** Limite prático de caracteres por mensagem (Twitch = 500). */
const LIMITE_CARACTERES = 480;

const SEPARADOR = '━━━━━━━━━━━━━━';

/**
 * Formata duração em texto amigável.
 * @param {number} ms - Duração em milissegundos
 * @returns {string} ex: "1s", "2,5s", "500ms"
 */
function formatarDuracao(ms) {
  if (ms >= 1000) {
    const seg = ms / 1000;
    const texto = Number.isInteger(seg) ? `${seg}s` : `${seg.toFixed(1).replace('.', ',')}s`;
    return texto;
  }
  return `${ms}ms`;
}

/**
 * Garante que a mensagem não estoura o limite do chat.
 * @param {string} texto
 * @returns {string}
 */
function garantirLimite(texto) {
  return texto.length > LIMITE_CARACTERES
    ? `${texto.slice(0, LIMITE_CARACTERES - 3)}...`
    : texto;
}

/**
 * Linha de direções formatada: "⬆ cima · ⬇ baixo · ⬅ esquerda · ➡ direita"
 * (mostra só os nomes em português para economizar caracteres;
 *  os nomes em inglês também funcionam e aparecem na ajuda detalhada)
 */
function linhaDirecoes() {
  return DIRECOES.map((d) => `${BOTOES[d].icone} ${BOTOES[d].rotulo}`).join(' · ');
}

/**
 * Linha de botões de ação formatada: "🅰 A · 🅱 B · 🔵 L · 🔴 R · ▶ START · ▦ SELECT"
 */
function linhaBotoesAcao() {
  return BOTOES_ACAO.map((b) => `${BOTOES[b].icone} ${BOTOES[b].rotulo}`).join(' · ');
}

/**
 * Mensagem completa de comandos (resposta ao !comandos / !ajuda).
 * São 2 mensagens para caber tudo com folga e ficar legível.
 * @returns {string[]}
 */
function msgComandos() {
  const parte1 = [
    '🎮 POKÉMON CHAT PLAYS — COMANDOS 🎮',
    SEPARADOR,
    `DIREÇÕES: ${linhaDirecoes()}`,
    `TAMBÉM VALE: up · down · left · right`,
    `AÇÕES: ${linhaBotoesAcao()}`,
    'TAMBÉM VALE: start · select · seleciona',
  ].join('\n');

  const parte2 = [
    '✊ SEGURAR TECLA (hold):',
    'hold <direção/botão> [tempo]',
    'ex: hold cima = 1s · hold baixo 3 = 3s · hold up 500ms',
    `máximo de ${formatarDuracao(10000)} por segurança`,
    '🔓 soltar → solta TODAS as teclas presas',
    SEPARADOR,
    '📊 !stats · 🏆 !top · ✊ !segurar',
  ].join('\n');

  return [garantirLimite(parte1), garantirLimite(parte2)];
}

/**
 * Mensagem de ajuda específica dos comandos de segurar.
 * @returns {string}
 */
function msgHoldAjuda() {
  const texto = [
    '✊ COMO SEGURAR TECLAS:',
    `hold <direção/botão> → segura ${formatarDuracao(1000)}`,
    'hold cima 3 → segura 3s (número ≤30 = segundos)',
    'hold up 500ms → segura meio segundo',
    'hold left 2s → aceita sufixo s ou ms',
    `🔐 tempo máximo: ${formatarDuracao(10000)}`,
    '🔓 soltar → solta todas as teclas na hora',
  ].join('\n');
  return garantirLimite(texto);
}

/**
 * Anúncio automático periódico (curto e chamativo).
 * @returns {string}
 */
function msgAnuncio() {
  const texto = [
    '🎮 O CHAT CONTROLA O JOGO! 🎮',
    `digite: ${DIRECOES.map((d) => BOTOES[d].rotulo.toLowerCase()).join(', ')}, ${BOTOES_ACAO.join(', ')}`,
    '✊ segurar: hold cima [tempo] · 🔓 soltar · 📜 !comandos',
  ].join('\n');
  return garantirLimite(texto);
}

/**
 * Boas-vindas personalizada.
 * @param {string} usuario
 * @returns {string}
 */
function msgBoasVindas(usuario) {
  return garantirLimite(
    [
      `👋 Bem-vindo, @${usuario}!`,
      'O chat está no controle do jogo!',
      'Mande: a, b, cima, baixo... ou !comandos para ver tudo',
    ].join('\n')
  );
}

/**
 * Confirmação de hold iniciado.
 * @param {string} usuario - Quem pediu
 * @param {string} botao - Botão canônico
 * @param {number} duracaoMs - Duração
 * @returns {string}
 */
function msgHoldConfirmado(usuario, botao, duracaoMs) {
  const info = BOTOES[botao] || { icone: '⌨', rotulo: botao.toUpperCase() };
  return garantirLimite(
    `🔒 @${usuario} segurou ${info.icone} ${info.rotulo} por ${formatarDuracao(duracaoMs)} — digite "soltar" para liberar antes`
  );
}

/**
 * Confirmação de teclas soltas.
 * @param {string} usuario - Quem pediu
 * @param {number} quantidade - Quantas teclas estavam presas
 * @returns {string}
 */
function msgSoltarConfirmado(usuario, quantidade) {
  if (quantidade > 0) {
    return garantirLimite(
      `🔓 @${usuario} soltou ${quantidade} ${quantidade === 1 ? 'tecla presa' : 'teclas presas'}! Controle liberado`
    );
  }
  return garantirLimite(`✔ @${usuario}, nenhuma tecla estava presa!`);
}

/**
 * Dica de uso quando mandam "hold" sem botão válido.
 * @param {string} usuario
 * @returns {string}
 */
function msgUsoHold(usuario) {
  return garantirLimite(
    [
      `@${usuario} uso: hold <direção/botão> [tempo]`,
      'ex: hold cima · hold baixo 3 · hold up 500ms',
    ].join(' — ')
  );
}

/**
 * Estatísticas do bot para o chat.
 * @param {object} resumo - Saída de stats.resumo()
 * @returns {string}
 */
function msgStats(resumo) {
  const linhas = [
    '📊 ESTATÍSTICAS DA LIVE 📊',
    `Comandos executados: ${resumo.total}`,
    `Bot ativo há: ${formatarUptime(resumo.uptimeMin)}`,
  ];
  const plataformas = Object.entries(resumo.porPlataforma || {})
    .map(([p, n]) => `${p}: ${n}`)
    .join(' · ');
  if (plataformas) linhas.push(plataformas);
  const holdTotal = resumo.holds || 0;
  if (holdTotal > 0) linhas.push(`✊ teclas seguradas: ${holdTotal}`);
  return garantirLimite(linhas.join('\n'));
}

/**
 * Ranking dos top jogadores.
 * @param {object} resumo - Saída de stats.resumo()
 * @returns {string}
 */
function msgTop(resumo) {
  const top = (resumo.topUsuarios || []).slice(0, 5);
  if (top.length === 0) {
    return garantirLimite('🏆 Ranking vazio — ninguém jogou ainda! Mande um comando no chat 😉');
  }
  const medalhas = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const linhas = ['🏆 TOP JOGADORES DO CHAT 🏆'];
  top.forEach((item, i) => {
    linhas.push(`${medalhas[i] || '▫'} @${item.nome} — ${item.comandos} comandos`);
  });
  return garantirLimite(linhas.join('\n'));
}

/**
 * Formata uptime em texto amigável.
 * @param {number} uptimeMin - Minutos ativos
 * @returns {string}
 */
function formatarUptime(uptimeMin) {
  if (uptimeMin < 60) return `${uptimeMin} min`;
  const horas = Math.floor(uptimeMin / 60);
  const min = uptimeMin % 60;
  if (horas < 24) return `${horas}h ${min}min`;
  const dias = Math.floor(horas / 24);
  return `${dias}d ${horas % 24}h`;
}

module.exports = {
  msgComandos,
  msgHoldAjuda,
  msgAnuncio,
  msgBoasVindas,
  msgHoldConfirmado,
  msgSoltarConfirmado,
  msgUsoHold,
  msgStats,
  msgTop,
  formatarDuracao,
  formatarUptime,
  garantirLimite,
};
