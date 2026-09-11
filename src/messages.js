/**
 * Formatação central das mensagens que o bot envia no chat.
 *
 * v2.9: as listas de comandos não são mais fixas — são montadas a partir do
 * REGISTRO de controles (src/controles.js). Se o streamer configurou
 * Minecraft (Pular/Inventário/Agachar...), o !comandos e o anúncio
 * automático mostram exatamente isso, em vez de A/B/Start de Game Boy.
 *
 *  - Formato de LISTA: um comando por linha, com explicação curta.
 *  - Cada mensagem respeita o limite de ~500 caracteres do IRC — quando a
 *    lista de controles é grande, ela se divide em mais mensagens.
 *  - Sem hardcode espalhado: todo texto de chat do bot nasce aqui.
 */

const controles = require('./controles');
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
 * Palavra principal de um controle (a que o chat digita primeiro).
 * @param {object} c - controle do registro
 * @returns {string}
 */
function palavraPrincipal(c) {
  const rot = controles.removerAcentos(String(c.label || '').toLowerCase()).trim();
  return c.aliases.includes(rot) ? rot : (c.aliases[0] || rot);
}

/**
 * Linha de lista para um controle: "⬆ cima (ou up, subir, sobe)".
 * Cabe sempre em 45 caracteres (reduz os extras se precisar).
 * @param {object} c - controle do registro
 * @returns {string}
 */
function linhaControle(c) {
  const primaria = palavraPrincipal(c);
  const labelLimpo = controles.removerAcentos(String(c.label || '')).trim();
  const outros = c.aliases.filter((a) => a !== primaria);

  const base = labelLimpo.toLowerCase() === primaria
    ? `${c.icone} ${primaria}`
    : `${c.icone} ${labelLimpo}: ${primaria}`;

  for (const qtd of [4, 3, 2, 1, 0]) {
    const exibidos = outros.slice(0, qtd);
    const extras = exibidos.length
      ? ` (ou ${exibidos.join(', ')}${outros.length > qtd ? '…' : ''})`
      : '';
    const linha = `${base}${extras}`;
    if (linha.length <= 45) return linha;
  }
  return base.slice(0, 45);
}

/**
 * Divide linhas em blocos que caibam no limite do IRC.
 * @param {string[]} linhas
 * @returns {string[][]}
 */
function agruparLinhas(linhas) {
  const blocos = [];
  let atual = [];
  let tamanho = 0;
  for (const linha of linhas) {
    const custo = linha.length + 1; // + quebra de linha
    if (atual.length > 0 && tamanho + custo > LIMITE_CARACTERES - 30) {
      blocos.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(linha);
    tamanho += custo;
  }
  if (atual.length) blocos.push(atual);
  return blocos;
}

/**
 * Mensagem completa de comandos (resposta ao !comandos / !ajuda).
 * Montada a partir dos controles ATIVOS do registro: controles
 * personalizados aparecem aqui sem nenhum código extra.
 * @returns {string[]}
 */
function msgComandos() {
  const ativos = controles.ativos();

  const linhasControles = ativos.map(linhaControle);
  const blocos = agruparLinhas(linhasControles);

  // savestates continuam merecendo explicação própria (se estiverem ativos)
  const temSalvar = ativos.some((c) => c.id === 'salvar');
  const temCarregar = ativos.some((c) => c.id === 'carregar');

  const exemplosHold = exemploHold();

  const linhasHold = [
    '✊ SEGURAR TECLAS (hold)',
    ...exemplosHold.map((linha) => garantirLinhaCurta(linha)),
    `🔒 tempo máximo: ${formatarDuracao(config.geral.holdMaxMs)}`,
    '🔓 soltar — solta todas as teclas',
    ...(temSalvar ? ['💾 salvar — o chat salva o ponto do jogo'] : []),
    ...(temCarregar ? ['📂 carregar — volta ao ponto salvo'] : []),
  ];

  const linhasOutros = [
    '📊 OUTROS COMANDOS',
    '📊 !stats — estatísticas da live',
    '🏆 !top — ranking dos jogadores',
    '⏱ !uptime — há quanto tempo o bot está no ar',
    '👑 !recorde — maior jogador do histórico',
    '🗳️ !democracia — o chat vota no passo',
    '⚡ !anarquia — todos jogam de uma vez',
    '✊ !segurar — ajuda só do hold',
    '❓ !ajuda — o mesmo que !comandos',
  ];

  const total = blocos.length + 2;
  const cabecalhoHold = temSalvar || temCarregar
    ? '✊ SEGURAR E VOLTAR NO TEMPO'
    : '✊ SEGURAR TECLAS (hold)';
  const partes = [];
  blocos.forEach((bloco, i) => {
    partes.push(garantirLimite(['🎮 COMANDOS DO JOGO ' + `(${i + 1}/${total})`, ...bloco].join('\n')));
  });
  partes.push(garantirLimite([`${cabecalhoHold} (${blocos.length + 1}/${total})`, ...linhasHold.slice(1)].join('\n')));
  partes.push(garantirLimite([`📊 OUTROS COMANDOS (${total}/${total})`, ...linhasOutros.slice(1)].join('\n')));
  return partes;
}

/**
 * Linhas de exemplo do hold usando uma palavra REAL dos controles ativos.
 * @returns {string[]}
 */
function exemploHold() {
  const seguraveis = controles.ativos().filter((c) => c.holdable);
  const palavra = seguraveis.length ? palavraPrincipal(seguraveis[0]) : 'cima';
  return [
    `hold ${palavra} — segura ${formatarDuracao(config.geral.holdPadraoMs)} (padrão)`,
    `hold ${palavra} 3 — segura 3s`,
    `hold ${palavra} 500ms — meio segundo`,
  ];
}

/** Corta a linha em 45 caracteres sem quebrar no meio da palavra. */
function garantirLinhaCurta(linha) {
  if (linha.length <= 45) return linha;
  return `${linha.slice(0, 44)}…`;
}

/**
 * Mensagem de ajuda específica dos comandos de segurar (também em lista).
 * @returns {string}
 */
function msgHoldAjuda() {
  const [a, b, c] = exemploHold();
  const texto = [
    '✊ COMO SEGURAR TECLAS:',
    a,
    b,
    c,
    `🔒 tempo máximo: ${formatarDuracao(config.geral.holdMaxMs)}`,
    '🔓 soltar — solta tudo na hora',
  ].join('\n');
  return garantirLimite(texto);
}

/**
 * Anúncio automático periódico (curto e em lista) — reflete os controles
 * configurados (Minecraft? mostra pular, inventário...).
 * @returns {string}
 */
function msgAnuncio() {
  const primarias = controles.ativos().map(palavraPrincipal).filter(Boolean);
  const linhas = ['🎮 O CHAT CONTROLA O JOGO!'];

  // até 6 palavras, quebrando em linhas que caibam
  const palavras = primarias.slice(0, 6);
  if (palavras.length > 0) {
    let atual = 'digite: ';
    for (const p of palavras) {
      const pedaco = atual === 'digite: ' ? p : `, ${p}`;
      if ((atual + pedaco).length > 44 && atual !== 'digite: ') {
        linhas.push(atual);
        atual = `        ${p}`;
      } else {
        atual += pedaco;
      }
    }
    if (atual.trim()) linhas.push(atual);
    if (primarias.length > 6) linhas.push(`        (e mais — !comandos)`);
  }

  linhas.push('✊ hold <palavra> [tempo] · 🔓 soltar');
  linhas.push('🗳️ !democracia / ⚡ !anarquia');
  linhas.push('📜 !comandos — lista completa');
  return garantirLimite(linhas.join('\n'));
}

/**
 * Boas-vindas personalizada.
 * @param {string} usuario
 * @returns {string}
 */
function msgBoasVindas(usuario) {
  const primarias = controles.ativos().map(palavraPrincipal).filter(Boolean).slice(0, 4);
  const palavras = primarias.length ? primarias.join(', ') : '!comandos';
  return garantirLimite(
    [
      `👋 Bem-vindo, @${usuario}!`,
      'O chat está no controle do jogo!',
      `Mande: ${palavras}... ou !comandos para ver tudo`,
    ].join('\n')
  );
}

/**
 * Confirmação de hold iniciado.
 * @param {string} usuario - Quem pediu
 * @param {string} botao - Id do controle
 * @param {number} duracaoMs - Duração
 * @returns {string}
 */
function msgHoldConfirmado(usuario, botao, duracaoMs) {
  const info = controles.meta(botao) || { icone: '⌨', rotulo: String(botao || '?').toUpperCase() };
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
      `@${usuario} uso: hold <controle> [tempo]`,
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
    'Vote como nos comandos normais — vale o último voto',
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
 * @param {string} botao - Id do controle vencedor
 * @param {number} votos - Votos do vencedor
 * @param {number} votantes - Total de pessoas que votaram
 * @returns {string}
 */
function msgVencedor(botao, votos, votantes) {
  const info = controles.meta(botao) || { icone: '🎮', rotulo: String(botao || '?').toUpperCase() };
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
