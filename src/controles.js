/**
 * Registro central de CONTROLES DO CHAT (v2.9).
 *
 * Um "controle" liga três coisas:
 *   label     — nome amigável ("Pular", "Cima")
 *   key       — tecla física do teclado ("space", "up", "shift+f5")
 *   aliases   — palavras que o chat digita para disparar ("pular", "jump"...)
 *
 * O registro é a FONTE ÚNICA usada por Twitch E YouTube (o parser consulta
 * ele), pelo teclado (mapa id → tecla), pelo !comandos (lista dinâmica),
 * pelo anúncio automático, overlay e votação. Controles personalizados não
 * exigem mais alteração no código.
 *
 * Origens do registro (nessa ordem):
 *   1. dados/controles.json  — salvo pelo assistente (vale para sempre,
 *      sobrevive a reinstalações: o desinstalador preserva dados/);
 *   2. .env — EMULADOR_PRESET + TECLA_* (compatibilidade total com as
 *      versões anteriores: sem o arquivo, nada muda para quem já usa o bot).
 *
 * Estrutura de cada controle:
 *   { id, label, icone, key, aliases[], holdable, builtin, enabled }
 */

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const { config } = require('./config');
const { montarMapeamento } = require('./presets');

// ---------------------------------------------------------------------------
// Vocabulário do sistema — palavras que NUNCA podem virar alias de controle
// (moram aqui para o commands.js importar sem criar dependência circular)
// ---------------------------------------------------------------------------

/** Verbos que iniciam um comando de segurar tecla. */
const VERBOS_HOLD = ['hold', 'segurar', 'segura', 'segure', 'segurando'];

/** Palavras que soltam todas as teclas presas. */
const PALAVRAS_SOLTAR = [
  'soltar', 'solta', 'solte', 'soltando', 'release', 'relaxa', 'largar',
  'largue', 'solteira',
];

/** Saudações reconhecidas. */
const PALAVRAS_OLA = ['ola', 'oi', 'oie', 'hello', 'hey', 'hi', 'eae', 'salve'];

/** Nomes aceitos para cada comando de informação (após o prefixo admin). */
const NOMES_INFO = {
  comandos: ['comandos', 'commands', 'cmd'],
  ajuda: ['ajuda', 'help', 'socorro'],
  hold: ['hold', 'segurar', 'segura'],
  stats: ['stats', 'estatisticas', 'status', 'stat'],
  top: ['top', 'ranking', 'rank', 'placar'],
  uptime: ['uptime', 'tempo'],
  recorde: ['recorde', 'record', 'maior'],
  modo: ['democracia', 'anarquia', 'votacao'],
};

/** Todas as palavras reservadas do sistema (alias de controle não pode ser). */
const RESERVADOS = new Set([
  ...VERBOS_HOLD,
  ...PALAVRAS_SOLTAR,
  ...PALAVRAS_OLA,
  ...Object.values(NOMES_INFO).flat(),
  // v3: comandos exatos dos namespaces de mouse/macro. O runtime resolve
  // esses parsers ANTES do registro de controles — um alias assim seria
  // silenciosamente sombreado (o chat clicaria o mouse em vez de apertar a
  // tecla configurada), então o assistente precisa recusá-los na origem.
  'dialogo', 'dialogue',
  'clique', 'click', 'clicar', 'rightclick',
  'clique esquerdo', 'click esquerdo', 'left click',
  'mouse clique', 'mouse click',
  'clique direito', 'click direito', 'right click',
  'mouse clique direito', 'mouse click direito',
]);

// ---------------------------------------------------------------------------
// Controles embutidos (o "controle de Game Boy" clássico do projeto)
// ---------------------------------------------------------------------------

/** Aliases PADRÃO de cada botão embutido — iguais aos das versões <= 2.8. */
const ALIASES_PADRAO = {
  up: ['up', 'cima', 'subir', 'sobe'],
  down: ['down', 'baixo', 'descer', 'desce'],
  left: ['left', 'esquerda', 'esq'],
  right: ['right', 'direita', 'dir'],
  a: ['a'],
  b: ['b'],
  l: ['l'],
  r: ['r'],
  start: ['start'],
  select: ['select', 'seleciona', 'selecionar'],
  salvar: ['salvar', 'salva', 'save'],
  carregar: ['carregar', 'carrega', 'load'],
};

/** Metadados de exibição de cada botão embutido. */
const BUILTINS = [
  { id: 'up', label: 'Cima', icone: '⬆' },
  { id: 'down', label: 'Baixo', icone: '⬇' },
  { id: 'left', label: 'Esquerda', icone: '⬅' },
  { id: 'right', label: 'Direita', icone: '➡' },
  { id: 'a', label: 'A', icone: '🅰' },
  { id: 'b', label: 'B', icone: '🅱' },
  { id: 'l', label: 'L', icone: '🔵' },
  { id: 'r', label: 'R', icone: '🔴' },
  { id: 'start', label: 'Start', icone: '▶' },
  { id: 'select', label: 'Select', icone: '▦' },
  // savestates: toque instantâneo — nunca segurável
  { id: 'salvar', label: 'Salvar', icone: '💾', holdable: false },
  { id: 'carregar', label: 'Carregar', icone: '📂', holdable: false },
];

const IDS_BUILTIN = new Set(BUILTINS.map((b) => b.id));

// ---------------------------------------------------------------------------
// Normalização (mesmas regras do parser: minúsculas + sem acentos)
// ---------------------------------------------------------------------------

/**
 * Remove acentos de um texto ("espaço" → "espaco").
 * @param {string} texto
 * @returns {string}
 */
function removerAcentos(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normaliza UMA palavra do chat para uso como alias:
 * minúsculas, sem acentos, espaços colapsados, sem espaços nas pontas.
 * @param {string} bruto
 * @returns {string}
 */
function normalizarAlias(bruto) {
  return removerAcentos(String(bruto || '').toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gera o id (slug interno) a partir do label: "Inventário" → "inventario".
 * @param {string} label
 * @returns {string}
 */
function slugificar(label) {
  return normalizarAlias(label).replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, ' ');
}

// ---------------------------------------------------------------------------
// Geração automática de aliases a partir da TECLA (PT-BR + EN)
// ---------------------------------------------------------------------------

/** Traduções de tecla física → palavras úteis no chat. */
const TRADUCOES_TECLA = {
  space: ['space', 'espaco', 'barra de espaco'],
  enter: ['enter'],
  esc: ['esc', 'escape'],
  up: ['up', 'cima'],
  down: ['down', 'baixo'],
  left: ['left', 'esquerda'],
  right: ['right', 'direita'],
  tab: ['tab'],
  backspace: ['backspace'],
  shift: ['shift'],
  ctrl: ['ctrl', 'control'],
  alt: ['alt'],
  f1: ['f1'], f2: ['f2'], f3: ['f3'], f4: ['f4'], f5: ['f5'], f6: ['f6'],
  f7: ['f7'], f8: ['f8'], f9: ['f9'], f10: ['f10'], f11: ['f11'], f12: ['f12'],
};

/**
 * Gera aliases sugeridos para um controle novo (visíveis e editáveis no
 * assistente — o streamer ajusta o que quiser antes de salvar).
 *
 * Regras:
 *  - o label vira a palavra principal ("Pular" → "pular");
 *  - teclas conhecidas ganham traduções PT/EN ("space" → "space, espaco,
 *    barra de espaco"; "up" → "up, cima");
 *  - letras e números geram só eles mesmos ("l" → "l");
 *  - COMBOS (shift+f5) não geram nada além do label — "shift f5" no chat
 *    seria confuso; o streamer escolhe a palavra (ex.: "salvar").
 *  - palavras reservadas do sistema nunca são geradas.
 *
 * @param {string} key - Tecla física ("space", "shift+f5")
 * @param {string} [label] - Nome amigável do controle
 * @returns {string[]} aliases normalizados (podem vir vazios)
 */
function gerarAliases(key, label) {
  const saida = [];
  const slug = slugificar(label);
  if (slug && !RESERVADOS.has(slug)) saida.push(slug);

  const tecla = String(key || '').toLowerCase().trim();
  if (tecla && !tecla.includes('+')) {
    const traducoes = TRADUCOES_TECLA[tecla];
    if (traducoes) saida.push(...traducoes);
    else if (/^[a-z0-9]$/.test(tecla)) saida.push(tecla);
    // tecla válida mas sem tradução (ex.: "tab") → só o label já cobre
  }

  // dedupa preservando a ordem
  const vistos = new Set();
  return saida.filter((a) => {
    const n = normalizarAlias(a);
    if (!n || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Validação de tecla (delega ao backend de teclado — carregamento tardio
// para não tropeçar em stubs de teste do módulo keyboard)
// ---------------------------------------------------------------------------

/**
 * Verifica se a tecla (simples ou combo) é suportada pelo backend.
 * @param {string} tecla
 * @returns {boolean}
 */
function teclaSuportada(tecla) {
  const { teclaSuportada: validar } = require('./controllers/keyboard');
  if (typeof validar !== 'function') return true; // stub de teste sem a fn
  return validar(tecla);
}

/**
 * Lista das teclas simples suportadas (para validação no navegador).
 * @returns {string[]}
 */
function teclasValidas() {
  const { listarTeclasValidas } = require('./controllers/keyboard');
  if (typeof listarTeclasValidas !== 'function') return [];
  return listarTeclasValidas();
}

// ---------------------------------------------------------------------------
// Lista padrão (derivada do .env: EMULADOR_PRESET + TECLA_*)
// ---------------------------------------------------------------------------

/**
 * Monta a lista de controles padrão (botões embutidos + teclas do preset
 * escolhido no .env + overrides TECLA_*). É o estado de quem nunca tocou
 * na seção de controles do assistente — comportamento idêntico às versões
 * anteriores à v2.9.
 *
 * @param {string} [nomePreset] - default: config.teclado.preset
 * @param {object} [overrides] - default: config.teclado.teclas (TECLA_*)
 * @returns {object[]} lista de controles
 */
function controlesPadrao(nomePreset, overrides) {
  const { mapa } = montarMapeamento(
    nomePreset !== undefined ? nomePreset : config.teclado.preset,
    overrides !== undefined ? overrides : config.teclado.teclas
  );
  return BUILTINS.map((b) => {
    const key = mapa[b.id] || '';
    return {
      id: b.id,
      label: b.label,
      icone: b.icone,
      key,
      aliases: [...ALIASES_PADRAO[b.id]],
      // combo não pode ser segurado (keydown+keyup de modificador sozinho
      // não faz sentido); savestates são toques por natureza
      holdable: b.holdable === false ? false : !String(key).includes('+'),
      builtin: true,
      enabled: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Estado do registro + persistência (dados/controles.json)
// ---------------------------------------------------------------------------

/** @type {object[]} */
let itens = controlesPadrao();

/** @type {Map<string, string>} alias normalizado → id do controle */
let mapaAlias = new Map();

/** De onde veio o registro atual: 'env' | 'arquivo'. */
let origemAtual = 'env';

/**
 * Já garantiu a carga de dados/controles.json neste processo?
 * (garantirInicializado lê o arquivo UMA vez; restaurarPadrao/salvarArquivo
 * ajustam a bandeira para os testes e para o fluxo do assistente)
 */
let arquivoGarantido = false;

// estado inicial já responde ao parser (o boot chama inicializar() depois
// para trocar pelo arquivo salvo, se existir)
reconstruirMapaAlias();

/**
 * Caminho do arquivo de controles (pode ser trocado via CONTROLES_ARQUIVO
 * no .env — padrão dados/controles.json, ao lado do stats.json).
 * @returns {string}
 */
function caminhoArquivo() {
  const rel = String(process.env.CONTROLES_ARQUIVO || 'dados/controles.json').trim() || 'dados/controles.json';
  return path.resolve(process.cwd(), rel);
}

/** Reconstrói o mapa alias → id a partir da lista atual.
 *
 * Defesa em profundidade: a validação (validarLista) já impede que dois
 * controles ATIVOS disputem a mesma palavra — mas se isso chegar aqui de
 * qualquer jeito (arquivo editado na mão, __definirLista de teste), o mapa
 * NÃO escolhe um vencedor em silêncio: mantém o primeiro e AVISA no log.
 */
function reconstruirMapaAlias() {
  mapaAlias = new Map();
  for (const c of itens) {
    if (!c.enabled) continue;
    for (const alias of c.aliases) {
      const n = normalizarAlias(alias);
      if (!n) continue;
      const anterior = mapaAlias.get(n);
      if (anterior && anterior !== c.id) {
        logger.aviso(`[Controles] ⚠️ Palavra "${n}" serve para "${anterior}" E para "${c.id}" — mantendo a primeira (isso não deveria passar da validação).`);
        continue;
      }
      mapaAlias.set(n, c.id);
    }
  }
}

/**
 * Substitui o registro inteiro (lista JÁ validada/normalizada).
 * @param {object[]} lista
 */
function definirLista(lista) {
  itens = lista.map((c) => ({ ...c, aliases: [...c.aliases] }));
  reconstruirMapaAlias();
}

/**
 * Carrega dados/controles.json se existir (registro salvo pelo assistente).
 * Chamado no boot, depois que o config já está carregado.
 * @returns {{origem: string, quantidade: number}}
 */
function inicializar() {
  arquivoGarantido = true;
  const caminho = caminhoArquivo();
  let bruto = null;
  try {
    bruto = fs.readFileSync(caminho, 'utf8');
  } catch {
    // sem arquivo: fica o derivado do .env (compatibilidade total)
    definirLista(controlesPadrao());
    origemAtual = 'env';
    return { origem: origemAtual, quantidade: itens.length };
  }

  try {
    const dados = JSON.parse(bruto);
    const lista = Array.isArray(dados && dados.controles) ? dados.controles : null;
    if (!lista) throw new Error('campo "controles" ausente');

    const { ok, erros, lista: normalizada } = validarLista(lista);
    if (!ok) throw new Error(erros.join(' · '));

    definirLista(normalizada);
    origemAtual = 'arquivo';
    logger.info(`[Controles] 🎮 ${normalizada.filter((c) => c.enabled).length} controle(s) ativos carregados de ${caminho}`);
    return { origem: origemAtual, quantidade: itens.length };
  } catch (err) {
    // arquivo corrompido NÃO derruba o bot: usa o .env e avisa
    logger.aviso(`[Controles] ⚠️ ${caminho} inválido (${err.message}) — usando EMULADOR_PRESET/TECLA_* do .env.`);
    definirLista(controlesPadrao());
    origemAtual = 'env';
    return { origem: origemAtual, quantidade: itens.length };
  }
}

/**
 * Grava o registro em dados/controles.json (escrita ATÔMICA: .tmp + rename,
 * igual ao stats.json) e o aplica em memória. Valida ANTES de gravar — um
 * arquivo inválido nunca substitui o anterior.
 * @param {object[]} lista - controles (podem vir direto do wizard)
 * @returns {{ok: boolean, erro?: string, avisos?: string[]}}
 */
function salvarArquivo(lista) {
  const { ok, erros, avisos, lista: normalizada } = validarLista(lista);
  if (!ok) return { ok: false, erro: erros.join(' · '), avisos };

  const caminho = caminhoArquivo();
  const dados = {
    versao: 1,
    salvoEm: new Date().toISOString(),
    controles: normalizada,
  };
  try {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    const tmp = `${caminho}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
    fs.renameSync(tmp, caminho);
  } catch (err) {
    // rename falhou? remove o .tmp órfão (best-effort) — o arquivo ANTERIOR
    // continua intacto, que é a garantia que importa
    try { fs.unlinkSync(`${caminho}.tmp`); } catch { /* já não existia */ }
    return { ok: false, erro: `não consegui gravar ${caminho} (${err.message})` };
  }

  definirLista(normalizada);
  origemAtual = 'arquivo';
  arquivoGarantido = true;
  return { ok: true, avisos };
}

/**
 * Garante que o registro reflita dados/controles.json ANTES de qualquer um
 * apresentar estado ao usuário (v2.9.1).
 *
 * Por quê: o assistente abre no boot ANTES do aplicarControles() do
 * index.js — sem isto, o /api/estado mostraria o registro derivado do .env
 * e um "Salvar" sem mexer sobrescreveria os controles personalizados.
 * Idempotente: só a 1ª chamada lê o arquivo; o index.js continua chamando
 * inicializar() depois do wizard (pega o que acabou de ser salvo).
 * @returns {{origem: string, quantidade: number}}
 */
function garantirInicializado() {
  if (arquivoGarantido) return { origem: origemAtual, quantidade: itens.length };
  return inicializar();
}

// ---------------------------------------------------------------------------
// Validação e normalização de uma lista vinda do wizard
// ---------------------------------------------------------------------------

/**
 * Valida e normaliza uma lista de controles (entrada: objetos soltos do
 * wizard, com aliases podendo vir como array OU string separada por vírgula).
 *
 * Erros (bloqueiam o save):
 *  - label vazio/longo demais;
 *  - tecla vazia/não suportada pelo backend;
 *  - alias duplicado ENTRE controles diferentes (nunca escolhemos em
 *    silêncio qual ação venceria);
 *  - alias reservado do sistema (hold, soltar, comandos...);
 *  - alias com caracteres estranhos (só letras/números/espaço);
 *  - controle ATIVO sem nenhuma palavra de chat.
 *
 * Avisos (não bloqueiam):
 *  - alias gerado automaticamente porque veio vazio;
 *  - combo (shift+f5) não pode ser segurável → holdable vira false;
 *  - botão embutido ausente da lista → reaplicado DESATIVADO (não some).
 *
 * @param {object[]} lista
 * @returns {{ok: boolean, erros: string[], avisos: string[], lista: object[]}}
 */
function validarLista(lista) {
  const erros = [];
  const avisos = [];
  const saida = [];

  if (!Array.isArray(lista) || lista.length === 0) {
    return { ok: false, erros: ['lista de controles vazia'], avisos, lista: [] };
  }

  const idsVistos = new Set();
  const donoAlias = new Map(); // alias normalizado → { id, label, enabled } do dono

  /**
   * Um controle reivindica a palavra `n` (v2.9.1 — detecção por ID, não por
   * label: dois controles podem ter o mesmo nome, e o dono registrado tem
   * que ser um ATIVO para o próximo conflito esbarrar nele). Regras:
   *  - mesmo controle (mesmo id): só dedup;
   *  - dois ATIVOS diferentes: ERRO — nunca escolhemos quem vence;
   *  - ativo novo + dono desativado: o ATIVO assume a titularidade (o
   *    desativado não disputa o chat, mas o próximo ativo que pedir a
   *    mesma palavra TEM que esbarrar neste);
   *  - desativado novo + dono existente: não toma a titularidade.
   * @returns {boolean} true se a palavra pode ser usada por este controle
   */
  const reivindicar = (n, dados) => {
    const dono = donoAlias.get(n);
    if (!dono) {
      donoAlias.set(n, dados);
      return true;
    }
    if (dono.id === dados.id) return true; // mesmo controle: dedup
    if (dono.enabled && dados.enabled) return false; // conflito entre ATIVOS
    if (dados.enabled) donoAlias.set(n, dados); // ativo passa a ser o dono
    return true;
  };

  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;

    // ---- label
    const label = String(item.label || '').trim();
    if (!label) {
      erros.push('um controle está sem nome (a ação que o chat faz)');
      continue;
    }
    if (label.length > 30) erros.push(`"${label}" — nome longo demais (máx. 30 caracteres)`);

    // ---- tecla
    const key = String(item.key || '').toLowerCase().replace(/\s+/g, '').trim();
    if (!key) {
      erros.push(`"${label}" está sem tecla de teclado`);
    } else if (!teclaSuportada(key)) {
      erros.push(
        `"${label}": tecla "${key}" não é suportada — use setas, enter, backspace, space, tab, esc, shift, ctrl, alt, f1-f12, a-z, 0-9 e combos como shift+f5`
      );
    }

    // ---- id (embutidos mantêm o id fixo; custom recebe slug único)
    let id = String(item.id || '').trim();
    const ehBuiltin = IDS_BUILTIN.has(id);
    if (!ehBuiltin) {
      id = slugificar(id || label) || 'controle';
      const base = id;
      let n = 2;
      while (idsVistos.has(id) || IDS_BUILTIN.has(id)) id = `${base}${n++}`;
    }
    if (idsVistos.has(id)) {
      erros.push(`dois controles com o mesmo id "${id}" — ajuste um dos nomes`);
    }
    idsVistos.add(id);

    // ---- aliases (aceita array ou "a, b, c")
    const enabled = item.enabled !== false;
    let aliases = [];
    if (Array.isArray(item.aliases)) {
      aliases = item.aliases;
    } else if (typeof item.aliases === 'string') {
      aliases = item.aliases.split(',');
    }

    const aliasLimpos = [];
    for (const bruto of aliases) {
      const n = normalizarAlias(bruto);
      if (!n) continue;
      if (!/^[a-z0-9]+( [a-z0-9]+)*$/.test(n)) {
        erros.push(`"${label}": palavra de chat "${n}" inválida (use só letras, números e espaços)`);
        continue;
      }
      if (RESERVADOS.has(n)) {
        erros.push(`"${label}": "${n}" é palavra reservada do sistema (hold, soltar, !comandos...)`);
        continue;
      }
      // Conflito de palavra é erro SÓ entre controles ATIVOS: um controle
      // desligado nunca disputa o chat (o mapa de aliases só mapeia os
      // ativos). Reativar um deles no assistente reacende o conflito na
      // hora — nunca escolhemos em silêncio qual ação vence.
      const donoAntigo = donoAlias.get(n);
      if (!reivindicar(n, { id, label, enabled })) {
        erros.push(`palavra "${n}" usada por "${donoAntigo.label}" E "${label}" — remova de um dos dois`);
        continue;
      }
      if (!aliasLimpos.includes(n)) aliasLimpos.push(n);
    }

    // vazio → sugere automaticamente (o assistente também sugere na hora);
    // palavras já tomadas por controles ATIVOS não são reaproveitadas
    // (reivindicar registra a titularidade dos gerados que passarem)
    if (aliasLimpos.length === 0) {
      const gerados = gerarAliases(key, label).filter((a) => reivindicar(a, { id, label, enabled }));
      if (gerados.length > 0) {
        aliasLimpos.push(...gerados);
        avisos.push(`"${label}": palavras de chat geradas automaticamente (${gerados.join(', ')})`);
      }
    }

    if (enabled && aliasLimpos.length === 0) {
      erros.push(`"${label}" está ativo sem NENHUMA palavra de chat — adicione ao menos uma`);
    }

    // ---- holdable
    let holdable = item.holdable !== false;
    if (holdable && key.includes('+')) {
      holdable = false;
      avisos.push(`"${label}" usa combo (${key}) — não dá para SEGURAR combos; virá toque simples`);
    }
    if (ehBuiltin && (id === 'salvar' || id === 'carregar')) holdable = false;

    saida.push({
      id,
      label,
      icone: ehBuiltin ? (BUILTINS.find((b) => b.id === id) || {}).icone || '🎮' : '🎮',
      key,
      aliases: aliasLimpos,
      holdable,
      builtin: ehBuiltin,
      enabled,
    });
  }

  // ---- embutidos ausentes voltam DESATIVADOS (não somem do sistema)
  for (const b of BUILTINS) {
    if (saida.some((c) => c.id === b.id)) continue;
    const padrao = controlesPadrao().find((c) => c.id === b.id);
    saida.push({ ...padrao, enabled: false, aliases: [...padrao.aliases] });
    avisos.push(`controle padrão "${b.label}" reaplicado desativado (não pode ser removido — só desligado)`);
  }

  // ordena: embutidos na ordem clássica, custom sempre DEPOIS (alfabético)
  const ordem = (c) => {
    const i = BUILTINS.findIndex((x) => x.id === c.id);
    return i < 0 ? BUILTINS.length : i;
  };
  saida.sort((a, b) => ordem(a) - ordem(b) || a.id.localeCompare(b.id));

  return { ok: erros.length === 0, erros, avisos, lista: saida };
}

// ---------------------------------------------------------------------------
// Consultas (usadas por commands, messages, overlay, index, assistente)
// ---------------------------------------------------------------------------

/** @returns {object[]} cópia da lista completa */
function todos() {
  return itens.map((c) => ({ ...c, aliases: [...c.aliases] }));
}

/** @returns {object[]} só os controles ativos */
function ativos() {
  return itens.filter((c) => c.enabled);
}

/**
 * Metadados de exibição de um controle.
 * @param {string} id
 * @returns {{icone: string, label: string, rotulo: string, holdable: boolean}|null}
 */
function meta(id) {
  const c = itens.find((x) => x.id === id);
  if (!c) return null;
  return { icone: c.icone, label: c.label, rotulo: c.label.toUpperCase(), holdable: c.holdable };
}

/**
 * Mapa id → {icone, rotulo} dos ativos (para o overlay fundir no cliente).
 * @returns {Record<string, {icone: string, rotulo: string}>}
 */
function metaAtivos() {
  const m = {};
  for (const c of ativos()) m[c.id] = { icone: c.icone, rotulo: c.label.toUpperCase() };
  return m;
}

/**
 * Resolve uma palavra do chat para o id do controle ativo.
 * @param {string} palavra - já normalizada (minúscula, sem acentos)
 * @returns {string|null}
 */
function resolverAlias(palavra) {
  return mapaAlias.get(palavra) || null;
}

/**
 * O controle pode ser segurado (hold)? Combos e savestates não.
 * @param {string} id
 * @returns {boolean}
 */
function ehSeguravel(id) {
  const c = itens.find((x) => x.id === id);
  return Boolean(c && c.enabled && c.holdable);
}

/**
 * Mapa id → tecla para o backend do teclado (só controles ativos).
 * @returns {Record<string, string>}
 */
function mapaTeclado() {
  const mapa = {};
  for (const c of ativos()) mapa[c.id] = c.key;
  return mapa;
}

/** De onde veio o registro atual ('env' | 'arquivo'). */
function origem() {
  return origemAtual;
}

/** Volta ao registro derivado do .env (testes / "descartar arquivo") —
 *  também re-arma a garantia de carga: a próxima garantirInicializado lê o
 *  arquivo de novo (é assim que os testes simulam um restart do processo). */
function restaurarPadrao() {
  definirLista(controlesPadrao());
  origemAtual = 'env';
  arquivoGarantido = false;
}

module.exports = {
  // vocabulário do sistema (o commands.js importa daqui)
  VERBOS_HOLD,
  PALAVRAS_SOLTAR,
  PALAVRAS_OLA,
  NOMES_INFO,
  RESERVADOS,
  // normalização
  removerAcentos,
  normalizarAlias,
  slugificar,
  // geração de aliases
  gerarAliases,
  // lista padrão / persistência
  controlesPadrao,
  caminhoArquivo,
  inicializar,
  garantirInicializado,
  salvarArquivo,
  validarLista,
  // consultas
  todos,
  ativos,
  meta,
  metaAtivos,
  resolverAlias,
  ehSeguravel,
  mapaTeclado,
  origem,
  restaurarPadrao,
  // validação de tecla (delegada ao backend)
  teclaSuportada,
  teclasValidas,
  // testes
  __definirLista: definirLista,
};
