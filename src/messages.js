/**
 * Formatação central das mensagens que o bot envia no chat.
 *
 * Objetivos:
 *  - Formato de LISTA: um comando por linha, com explicação curta após
 *    o travessão — muito mais legível no chat da Twitch (e YouTube).
 *  - Cada mensagem respeita o limite de ~500 caracteres por linha do IRC.
 *  - Sem hardcode espalhado: todo texto de chat do bot nasce aqui.
 */

const { BOTOES, DIRECOES, BOTOES_ACAO } = require('./commands');
const { config } = require('./config');

/** Limite prático de caracteres por mensagem (Twitch = 500). */
const LIMITE_CARACTERES = 480;

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
 * Mensagem completa de comandos (resposta ao !comandos / !ajuda).
 * São 3 mensagens em formato de LISTA — um comando por linha, com
 * explicação curta após o travessão — muito mais legível no chat.
 * @returns {string[]}
 */
function msgComandos() {
  const aliasEN = { up: 'up', down: 'down', left: 'left', right: 'right' };
  const linhasMovimento = DIRECOES.map(
    (d) => `${BOTOES[d].icone} ${BOTOES[d].rotulo.toLowerCase()} (ou ${aliasEN[d]})`
  );

  const acoes = {
    a: 'confirmar / interagir',
    b: 'cancelar / correr',
    l: 'ombro esquerdo',
    r: 'ombro direito',
    start: 'abrir o menu',
    select: 'trocar item',
  };
  const linhasBotoes = BOTOES_ACAO.map((b) => `${BOTOES[b].icone} ${b} — ${acoes[b]}`);

  const parte1 = [
    '🎮 COMANDOS DO JOGO (1/3)',
    ...linhasMovimento,
    ...linhasBotoes,
  ].join('\n');

  const parte2 = [
    '✊ SEGURAR E VOLTAR NO TEMPO (2/3)',
    `hold cima — segura ${formatarDuracao(config.geral.holdPadraoMs)}`,
    'hold baixo 3 — segura 3s',
    'hold up 500ms — meio segundo',
    `🔒 tempo máximo: ${formatarDuracao(config.geral.holdMaxMs)}`,
    '🔓 soltar — solta todas as teclas',
    '💾 salvar — o chat salva o ponto do jogo',
    '📂 carregar — volta ao ponto salvo',
  ].join('\n');

  const parte3 = [
    '📊 OUTROS COMANDOS (3/3)',
    '📊 !stats — estatísticas da live',
    '🏆 !top — ranking dos jogadores',
    '⏱ !uptime — há quanto tempo o bot está no ar',
    '👑 !recorde — maior jogador do histórico',
    '🗳️ !democracia — o chat vota no passo',
    '⚡ !anarquia — todos jogam de uma vez',
    '✊ !segurar — ajuda só do hold',
    '❓ !ajuda — o mesmo que !comandos',
  ].join('\n');

  return [garantirLimite(parte1), garantirLimite(parte2), garantirLimite(parte3)];
}

/**
 * Mensagem de ajuda específica dos comandos de segurar (também em lista).
 * @returns {string}
 */
function msgHoldAjuda() {
  const texto = [
    '✊ COMO SEGURAR TECLAS:',
    `hold cima — segura ${formatarDuracao(config.geral.holdPadraoMs)} (padrão)`,
    'hold cima 3 — segura 3s',
    'hold cima 500ms — meio segundo',
    'hold left 2s — sufixos s e ms valem',
    `🔒 tempo máximo: ${formatarDuracao(config.geral.holdMaxMs)}`,
    '🔓 soltar — solta tudo na hora',
  ].join('\n');
  return garantirLimite(texto);
}

/**
 * Anúncio automático periódico (curto e em lista).
 * @returns {string}
 */
function msgAnuncio() {
  const texto = [
    '🎮 O CHAT CONTROLA O JOGO!',
    'mova: cima, baixo, esquerda, direita',
    'aperte: a, b, l, r, start, select',
    '💾 salvar / 📂 carregar — volta no tempo',
    '✊ hold cima [tempo] · 🔓 soltar',
    '🗳️ !democracia / ⚡ !anarquia',
    '📜 !comandos — lista completa',
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
 * Aviso quando o streamer PAUSA o chat (tecla F9).
 * @returns {string}
 */
function msgChatPausado() {
  return garantirLimite('⛔ O chat está PAUSADO — o streamer assumiu o controle! Voltamos já');
}

/**
 * Aviso quando o streamer LIBERA o chat (tecla F9 de novo).
 * @returns {string}
 */
function msgChatLiberado() {
  return garantirLimite('✅ Chat liberado! Manda os comandos! 🎮');
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
    ].join('\n')
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
 * v2.5: tempo de vida do bot (resposta ao !uptime).
 * @param {object} resumo - Saída de stats.resumo()
 * @returns {string}
 */
function msgUptime(resumo) {
  const min = resumo && resumo.uptimeMin ? resumo.uptimeMin : 0;
  return garantirLimite(
    [
      '⏱️ UPTIME DO BOT',
      `No ar há ${formatarUptime(min)} (somando todas as lives)`,
      `Comandos executados no total: ${resumo && resumo.total ? resumo.total : 0}`,
    ].join('\n')
  );
}

/**
 * v2.5: recorde individual do chat (resposta ao !recorde).
 * @param {object} resumo - Saída de stats.resumo()
 * @returns {string}
 */
function msgRecorde(resumo) {
  const top = resumo && Array.isArray(resumo.topUsuarios) ? resumo.topUsuarios[0] : null;
  if (!top) {
    return garantirLimite('👑 Ninguém jogou ainda — manda um comando e vira o primeiro recordista!');
  }
  return garantirLimite(
    `👑 Recorde do chat: @${top.nome} com ${top.comandos} ${top.comandos === 1 ? 'comando' : 'comandos'}! Alguém desbanca?`
  );
}

/**
 * v2.5: modo democracia ativado (anúncio no chat).
 * @returns {string}
 */
function msgModoDemocracia() {
  const texto = [
    '🗳️ MODO DEMOCRACIA ATIVADO!',
    `A cada ${formatarDuracao(config.votacao.intervaloMs)} vale o comando mais votado`,
    'Vote como nos comandos normais: cima, a, start...',
    'Trocar de voto vale — só vale o último',
    '⚡ !anarquia devolve o caos',
  ].join('\n');
  return garantirLimite(texto);
}

/**
 * v2.5: modo anarquia ativado (anúncio no chat).
 * @returns {string}
 */
function msgModoAnarquia() {
  const texto = [
    '⚡ MODO ANARQUIA ATIVADO!',
    'Todo comando executa na hora — o caos clássico',
    '🗳️ !democracia para voltar a votar',
  ].join('\n');
  return garantirLimite(texto);
}

/**
 * v2.5: resultado de uma janela de votação.
 * @param {string} botao - Botão canônico vencedor
 * @param {number} votos - Votos do vencedor
 * @param {number} votantes - Total de pessoas que votaram
 * @returns {string}
 */
function msgVencedor(botao, votos, votantes) {
  const info = BOTOES[botao] || { icone: '🎮', rotulo: String(botao || '?').toUpperCase() };
  const v = votos || 0;
  return garantirLimite(
    `🗳️ O CHAT decidiu: ${info.icone} ${info.rotulo} — ${v} ${v === 1 ? 'voto' : 'votos'}${votantes ? ` (de ${votantes} ${votantes === 1 ? 'pessoa' : 'pessoas'})` : ''}`
  );
}

/**
 * v2.5: troca de modo pedida pelo chat antes do intervalo mínimo.
 * @param {number} segundos
 * @returns {string}
 */
function msgModoTrocaBloqueada(segundos) {
  return garantirLimite(`⏳ Modo trocado há pouco — aguarde ${Math.max(1, Math.ceil(segundos))}s para trocar de novo`);
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
  msgChatPausado,
  msgChatLiberado,
  msgUsoHold,
  msgStats,
  msgTop,
  // --- v2.5 ---
  msgUptime,
  msgRecorde,
  msgModoDemocracia,
  msgModoAnarquia,
  msgVencedor,
  msgModoTrocaBloqueada,
  formatarDuracao,
  formatarUptime,
  garantirLimite,
};
