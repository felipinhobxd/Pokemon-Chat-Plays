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
const { aliasesEfetivos, ALIASES_BILINGUES } = require('./commands');
const { config } = require('./config');

/** Limite prático de caracteres por mensagem (Twitch = 500; margem). */
const LIMITE_CARACTERES = 480;

/**
 * Alvo de legibilidade por mensagem do !comandos (v3.1.x): cabe numa linha
 * de chat sem virar parede de texto. Acima disso a geração compacta
 * (sinônimos fora) ou divide a lista em mais partes.
 */
const ALVO_IDEAL = 430;

/** Custo estimado do cabeçalho "🎮 JOGO (i/N)" ao dividir listas grandes. */
const CUSTO_CABECALHO = 16;

/** Custo da dica "💬 sem ! nos controles" anexada à PRIMEIRA parte. */
const CUSTO_DICA = 25;

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
 * Prefere o nome PT-BR do rótulo quando ele é um alias realmente válido;
 * caso contrário usa o primeiro alias efetivo configurado/fallback.
 * @param {object} c - controle do registro
 * @returns {string}
 */
function palavraPrincipal(c) {
  const aliases = aliasesEfetivos(c);
  const rot = controles.removerAcentos(String(c.label || '').toLowerCase()).trim();
  return aliases.includes(rot) ? rot : (aliases[0] || rot);
}

/**
 * Complemento de alias "mais útil" para exibir junto da primária (v3.1.x).
 *
 * Controles clássicos: usa o par PT/EN oficial da tabela bilíngue
 * ("cima/up", "salvar/save", "select/selecionar"...). Controles
 * personalizados: o primeiro alias que não é mera variação da primária
 * (evita "salvar/salva"; prefere "salvar/save"). Determinístico: mesma
 * lista de aliases produz sempre o mesmo complemento.
 * @param {object} c - controle do registro
 * @param {string} primaria
 * @returns {string|null} alias complementar ou null (só a primária)
 */
function complementoAlias(c, primaria) {
  const aliases = aliasesEfetivos(c);
  const par = ALIASES_BILINGUES[c.id];
  if (Array.isArray(par)) {
    const outro = par.find((a) => a !== primaria && aliases.includes(a));
    if (outro) return outro;
  }
  for (const candidato of aliases) {
    if (candidato === primaria || candidato.length < 2) continue;
    // variação da mesma palavra ("salva" p/ "salvar", "abrir" p/ "a")
    // não ajuda ninguém — é prefixo da primária (ou o contrário)
    if (candidato.startsWith(primaria) || primaria.startsWith(candidato)) continue;
    return candidato;
  }
  return null;
}

/** Item de controle para a parte 1: "⬆ cima/up" (complemento opcional). */
function itemControle(c, comComplemento) {
  const primaria = palavraPrincipal(c);
  let texto = primaria;
  if (comComplemento) {
    const complemento = complementoAlias(c, primaria);
    if (complemento && `${primaria}/${complemento}`.length <= 24) {
      texto = `${primaria}/${complemento}`;
    }
  }
  return `${c.icone} ${texto}`;
}

/** Custo de uma linha "título • itens..." (sem montar a string). */
function custoLinha(itens) {
  let total = 0;
  for (const item of itens) total += item.length + 3; // " • " entre todos
  return total;
}

/** Monta "TITULO (i/total) • item • item ...". */
function montarLinha(titulo, indice, total, itens) {
  return [`${titulo} (${indice}/${total})`, ...itens].join(' • ');
}

/**
 * Divide os controles em partes que cabem no ALVO_IDEAL (v3.1.x).
 * Cada parte usa os pares de alias quando cabem; quando não cabem, cai
 * para só a primária (sinônimos são opcional — controles, nunca).
 * @param {object[]} ativos - controles ativos do registro
 * @returns {string[][]} listas de itens por parte
 */
function partesJogo(ativos) {
  const completos = ativos.map((c) => itemControle(c, true));
  const primarios = ativos.map((c) => itemControle(c, false));
  // a primeira parte carrega a dica "sem !" — o orçamento dela é menor
  const orcamento = ALVO_IDEAL - CUSTO_CABECALHO;
  const orcamentoPrimeira = orcamento - CUSTO_DICA;

  // 1) tudo numa parte só, com os pares PT/EN
  if (custoLinha(completos) <= orcamentoPrimeira) return [completos];
  // 2) tudo numa parte só, só palavras principais (sinônimos fora)
  if (custoLinha(primarios) <= orcamentoPrimeira) return [primarios];

  // 3) divide: empacota por primárias (garante que cabe) e tenta subir
  //    para a versão com pares em cada parte que sobrar espaço
  const grupos = [];
  let atual = [];
  let gasto = 0;
  for (let i = 0; i < primarios.length; i++) {
    const custo = primarios[i].length + 3;
    const limite = grupos.length === 0 ? orcamentoPrimeira : orcamento;
    if (atual.length > 0 && gasto + custo > limite) {
      grupos.push(atual);
      atual = [];
      gasto = 0;
    }
    atual.push(i);
    gasto += custo;
  }
  if (atual.length) grupos.push(atual);

  return grupos.map((indices, g) => {
    const comPares = indices.map((i) => completos[i]);
    const teto = g === 0 ? orcamentoPrimeira : orcamento;
    return custoLinha(comPares) <= teto ? comPares : indices.map((i) => primarios[i]);
  });
}

/** Mouse está ativo na configuração atual? (MODO_MOUSE=off desliga tudo). */
function mouseAtivo() {
  return String(config.mouse?.modo || 'janela').trim().toLowerCase() !== 'off';
}

/** Gamepad está ativo na configuração atual? (GAMEPAD_ENABLED=off/false). */
function gamepadAtivo() {
  const modo = String(config.gamepad?.enabled ?? 'auto').trim().toLowerCase();
  return !['off', 'false', 'no', 'nao', '0', 'desligado'].includes(modo);
}

/**
 * Parte 2 — comandos avançados de input direto: HOLD (1ms–10s), mouse,
 * gamepad e soltar. Só anuncia o que ESTÁ ativo e o que o parser de fato
 * aceita — sem sintaxe inventada.
 * @returns {string[]} itens da linha
 */
function itensAvancados() {
  const itens = [];
  const seguraveis = controles.ativos().filter((c) => c.holdable);

  let faixaHold = false;
  if (seguraveis.length > 0) {
    // exemplos curtos de palavra única são mais fáceis de ler E digitar;
    // sem nenhuma, usa as palavras reais do registro (sintaxe continua
    // válida mesmo para alias de várias palavras)
    const palavras = seguraveis.map((c) => palavraPrincipal(c));
    const curtas = palavras.filter((p) => !p.includes(' ') && p.length <= 12);
    const primeira = curtas[0] || palavras[0];
    let curta = primeira;
    for (const palavra of (curtas.length ? curtas : palavras)) {
      if (palavra.length < curta.length) curta = palavra;
    }
    itens.push(`⏱ hold ${primeira} 3s`);
    itens.push(`hold ${curta} 250ms`);
    faixaHold = true;
  }

  if (mouseAtivo()) {
    itens.push('🖱 hold clique esquerdo 2s');
    itens.push('hold clique direito 1s');
  }

  if (gamepadAtivo()) {
    itens.push('🎮 pad a');
    itens.push('pad ls direita');
    itens.push('pad rt 75');
  }

  itens.push('🔓 soltar/release libera tudo');
  if (faixaHold) itens.push(`⏱ HOLD: 1ms–${formatarDuracao(config.geral.holdMaxMs)}`);
  return itens;
}

/**
 * Parte 3 — comandos de informação/modo (não são input direto de jogo).
 * democracia/anarquia são descritos como VOTO porque é isso que fazem
 * desde v2.9.4 (o chat não troca o modo sozinho).
 * @returns {string[]}
 */
function itensOutros() {
  return [
    '💬 dialogo/dialogue — A repetido 5s',
    '📊 !stats',
    '🏆 !top',
    '⏱ !uptime',
    '👑 !recorde',
    '🗳 !democracia / !anarquia — votar no modo',
    '✊ !hold — ajuda do HOLD',
    '❓ !ajuda / !help / !commands',
  ];
}

/**
 * Mensagem completa de comandos (resposta ao !comandos / !commands /
 * !ajuda / !help) — v3.1.x: 3 partes curtas e legíveis no chat, em UMA
 * linha cada (sem depender de o cliente renderizar quebras de linha):
 *
 *   1. 🎮 JOGO — controles ATIVOS do registro (dinâmico: Minecraft mostra
 *      Minecraft), com pares compactos de alias PT/EN;
 *   2. ✊ AVANÇADO — hold/mouse/gamepad/soltar, só o que está ativo;
 *   3. 📊 OUTROS — comandos com ! , modos por voto e ajuda.
 *
 * Listas enormes de controles continuam dinâmicas: a parte 1 se divide
 * em mais mensagens numeradas (i/N) sem esconder controle ativo nenhum.
 * @returns {string[]}
 */
function msgComandos() {
  const ativos = controles.ativos();
  const gruposJogo = partesJogo(ativos);
  const total = gruposJogo.length + 2;

  const partes = [];
  gruposJogo.forEach((itens, i) => {
    const linha = montarLinha('🎮 JOGO', i + 1, total, itens);
    // a dica "sem !" vai na primeira parte (a mais lida)
    partes.push(garantirLimite(i === 0 ? `${linha} • 💬 sem ! nos controles` : linha));
  });
  partes.push(garantirLimite(montarLinha('✊ AVANÇADO', gruposJogo.length + 1, total, itensAvancados())));
  partes.push(garantirLimite(montarLinha('📊 OUTROS', total, total, itensOutros())));
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
    '🔓 soltar / release — solta tudo',
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

  linhas.push('🌐 PT-BR + EN · controles sem !');
  linhas.push('✊ hold <palavra> [tempo] · 🔓 soltar');
  linhas.push('🗳️ !democracia / ⚡ !anarquia');
  linhas.push('📜 !comandos / !commands — lista');
  return garantirLimite(linhas.join('\n'));
}

/**
 * Boas-vindas personalizada.
 * @param {string} usuario - Nome do usuário
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
 * Usa uma palavra REAL dos controles ativos (Minecraft? sugere "pular",
 * não "cima" — a dica tem que funcionar no jogo configurado).
 * @param {string} usuario
 * @returns {string}
 */
function msgUsoHold(usuario) {
  const seguraveis = controles.ativos().filter((c) => c.holdable);
  const palavra = seguraveis.length ? palavraPrincipal(seguraveis[0]) : 'cima';
  return garantirLimite(
    [
      `@${usuario} uso: hold <controle|clique|pad> [1ms a 10s]`,
      `ex: hold ${palavra} 3 · hold ${palavra} 500ms · hold clique direito 2s · hold pad a 250ms`,
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
