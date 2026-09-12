'use strict';

/**
 * Perfis por jogo do ChatPlays.
 *
 * Cada perfil guarda SOMENTE configuracoes ligadas ao jogo/entrada e uma
 * copia dos controles do chat. Credenciais da Twitch/YouTube nunca entram
 * aqui. O perfil ativo e lembrado em dados/perfis.json.
 *
 * Modelo de funcionamento:
 *  - o .env + dados/controles.json continuam sendo a configuracao que o app
 *    usa normalmente;
 *  - antes de trocar de perfil, o estado atual e sincronizado de volta para
 *    o perfil ativo (assim edicoes feitas no assistente nao se perdem);
 *  - ativar outro perfil copia apenas as chaves de jogo para o .env e troca
 *    os controles de forma atomica/best-effort;
 *  - no boot normal apenas sincronizamos o perfil ativo. Nao sobrescrevemos
 *    a configuracao atual, portanto o que foi salvo no assistente permanece.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const VERSAO_ARQUIVO = 1;
const ARQUIVO_PADRAO = path.join('dados', 'perfis.json');
const CONTROLES_PADRAO = path.join('dados', 'controles.json');

// So configuracoes relacionadas ao jogo/entrada. NENHUM segredo entra aqui.
const CHAVES_PERFIL = Object.freeze([
  'EMULADOR_PRESET',
  'EMULADOR_EXE',
  'JOGO_ROM',
  'JOGO_ARGS',
  'JOGO_AUTO_REINICIAR',
  'JOGO_REINICIAR_DELAY_MS',
  'JOGO_TENTATIVAS_MAX',
  'JOGO_VIDA_MINIMA_MS',
  'MODO_TECLADO',
  'MODO_MOUSE',
  'MOUSE_PASSO_PX',
  'GAMEPAD_ENABLED',
  'GAMEPAD_TAP_MS',
  'GAMEPAD_ANALOG_MS',
  'KEY_PRESS_DURATION_MS',
  'COMMAND_COOLDOWN_MS',
  'COMMAND_COOLDOWNS',
  'HOLD_DEFAULT_MS',
  'HOLD_MAX_MS',
  'MODO_INICIAL',
  'VOTACAO_INTERVALO_MS',
]);

function limparLinha(valor) {
  return String(valor ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function slug(texto) {
  const base = String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'perfil';
}

function nomeSugerido(env = {}) {
  const origem = env.JOGO_ROM || env.EMULADOR_EXE || '';
  if (!origem) return 'Padrao';
  const nome = path.basename(String(origem)).replace(/\.[^.]+$/, '').trim();
  return nome || 'Padrao';
}

function parseEnv(texto) {
  try {
    return dotenv.parse(String(texto || ''));
  } catch {
    return {};
  }
}

/**
 * Atualiza somente CHAVES_PERFIL, preservando comentarios, credenciais e
 * qualquer chave customizada. null/undefined remove a chave do arquivo.
 */
function patchEnvText(texto, valores = {}) {
  const linhas = String(texto || '').split(/\r?\n/);
  const alvo = new Set(CHAVES_PERFIL);
  const vistos = new Set();
  const saida = [];

  for (const linha of linhas) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m || !alvo.has(m[1])) {
      saida.push(linha);
      continue;
    }

    const chave = m[1];
    if (vistos.has(chave)) continue; // remove duplicatas antigas
    vistos.add(chave);
    const valor = valores[chave];
    if (valor === null || valor === undefined) continue;
    saida.push(`${chave}=${limparLinha(valor)}`);
  }

  const novas = [];
  for (const chave of CHAVES_PERFIL) {
    if (vistos.has(chave)) continue;
    const valor = valores[chave];
    if (valor === null || valor === undefined) continue;
    novas.push(`${chave}=${limparLinha(valor)}`);
  }

  if (novas.length) {
    while (saida.length && saida[saida.length - 1] === '') saida.pop();
    saida.push('', '# ----- PERFIL DE JOGO ATIVO (ChatPlays) -----', ...novas, '');
  }

  return saida.join('\n');
}

function lerArquivo(caminho, fallback = '') {
  try {
    return fs.readFileSync(caminho, 'utf8');
  } catch {
    return fallback;
  }
}

function escreverAtomico(caminho, conteudo) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const tmp = `${caminho}.tmp`;
  try {
    fs.writeFileSync(tmp, conteudo, 'utf8');
    fs.renameSync(tmp, caminho);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nada */ }
    throw err;
  }
}

function escreverJsonAtomico(caminho, objeto) {
  escreverAtomico(caminho, `${JSON.stringify(objeto, null, 2)}\n`);
}

function copiarControles(lista) {
  if (!Array.isArray(lista)) return null;
  return lista.map((c) => ({
    ...c,
    aliases: Array.isArray(c.aliases) ? [...c.aliases] : [],
  }));
}

function localizarEnv(baseDir, envPath) {
  if (envPath) return path.resolve(envPath);
  const candidatos = [
    path.join(baseDir, '.env'),
    path.join(path.dirname(process.execPath), '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const p of candidatos) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch { /* ignora */ }
  }
  return path.join(baseDir, '.env');
}

function lerControles(caminho) {
  try {
    const obj = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    return copiarControles(Array.isArray(obj) ? obj : obj.controles);
  } catch {
    return null;
  }
}

function montarArquivoControles(controles) {
  return {
    versao: 1,
    salvoEm: new Date().toISOString(),
    controles: copiarControles(controles) || [],
  };
}

function criarStore(opcoes = {}) {
  const baseDir = path.resolve(opcoes.baseDir || process.cwd());
  const envPath = localizarEnv(baseDir, opcoes.envPath);
  const perfisPath = path.resolve(baseDir, opcoes.perfisPath || ARQUIVO_PADRAO);

  function envAtual() {
    return parseEnv(lerArquivo(envPath));
  }

  function controlesPathDoEnv(env = envAtual()) {
    const rel = limparLinha(env.CONTROLES_ARQUIVO) || CONTROLES_PADRAO;
    return path.resolve(baseDir, rel);
  }

  function snapshotAtual() {
    const env = envAtual();
    const valores = {};
    for (const chave of CHAVES_PERFIL) {
      valores[chave] = Object.prototype.hasOwnProperty.call(env, chave)
        ? limparLinha(env[chave])
        : null;
    }
    return {
      valores,
      controles: lerControles(controlesPathDoEnv(env)),
    };
  }

  function dadosVazios() {
    return {
      versao: VERSAO_ARQUIVO,
      ativoId: null,
      atualizadoEm: new Date().toISOString(),
      perfis: [],
    };
  }

  function lerDados() {
    try {
      const obj = JSON.parse(fs.readFileSync(perfisPath, 'utf8'));
      if (!obj || !Array.isArray(obj.perfis)) throw new Error('estrutura invalida');
      return {
        versao: VERSAO_ARQUIVO,
        ativoId: typeof obj.ativoId === 'string' ? obj.ativoId : null,
        atualizadoEm: obj.atualizadoEm || null,
        perfis: obj.perfis
          .filter((p) => p && typeof p === 'object' && p.id && p.nome)
          .map((p) => ({
            id: String(p.id),
            nome: String(p.nome),
            criadoEm: p.criadoEm || null,
            salvoEm: p.salvoEm || null,
            valores: Object.fromEntries(CHAVES_PERFIL.map((k) => [
              k,
              Object.prototype.hasOwnProperty.call(p.valores || {}, k)
                ? (p.valores[k] === null ? null : limparLinha(p.valores[k]))
                : null,
            ])),
            controles: copiarControles(p.controles),
          })),
      };
    } catch {
      return dadosVazios();
    }
  }

  function salvarDados(dados) {
    dados.versao = VERSAO_ARQUIVO;
    dados.atualizadoEm = new Date().toISOString();
    escreverJsonAtomico(perfisPath, dados);
  }

  function idUnico(nome, dados) {
    const base = slug(nome);
    const usados = new Set(dados.perfis.map((p) => p.id));
    if (!usados.has(base)) return base;
    let n = 2;
    while (usados.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  function garantirInicial() {
    const dados = lerDados();
    if (dados.perfis.length > 0) {
      if (!dados.ativoId || !dados.perfis.some((p) => p.id === dados.ativoId)) {
        dados.ativoId = dados.perfis[0].id;
        salvarDados(dados);
      }
      return { criado: false, dados };
    }

    const snap = snapshotAtual();
    const env = envAtual();
    const agora = new Date().toISOString();
    const nome = nomeSugerido(env);
    const perfil = {
      id: slug(nome),
      nome,
      criadoEm: agora,
      salvoEm: agora,
      valores: snap.valores,
      controles: snap.controles,
    };
    dados.perfis.push(perfil);
    dados.ativoId = perfil.id;
    salvarDados(dados);
    return { criado: true, dados };
  }

  function listar() {
    const { dados } = garantirInicial();
    return dados.perfis.map((p) => ({
      ...p,
      controles: copiarControles(p.controles),
      ativo: p.id === dados.ativoId,
    }));
  }

  function ativo() {
    const { dados } = garantirInicial();
    return dados.perfis.find((p) => p.id === dados.ativoId) || null;
  }

  function sincronizarAtivo() {
    const { dados } = garantirInicial();
    const idx = dados.perfis.findIndex((p) => p.id === dados.ativoId);
    if (idx < 0) return { ok: false, motivo: 'perfil ativo nao encontrado' };
    const snap = snapshotAtual();
    dados.perfis[idx] = {
      ...dados.perfis[idx],
      salvoEm: new Date().toISOString(),
      valores: snap.valores,
      controles: snap.controles,
    };
    salvarDados(dados);
    return { ok: true, perfil: dados.perfis[idx] };
  }

  function achar(ref, dados = lerDados()) {
    const alvo = String(ref || '').trim();
    if (!alvo) return null;
    const normal = slug(alvo);
    return dados.perfis.find((p) => p.id === alvo)
      || dados.perfis.find((p) => p.id === normal)
      || dados.perfis.find((p) => p.nome.toLowerCase() === alvo.toLowerCase())
      || null;
  }

  function criar(nome, snapshot = snapshotAtual(), op = {}) {
    const n = limparLinha(nome).slice(0, 50);
    if (!n) return { ok: false, motivo: 'nome vazio' };
    const { dados } = garantirInicial();
    const agora = new Date().toISOString();
    const perfil = {
      id: idUnico(n, dados),
      nome: n,
      criadoEm: agora,
      salvoEm: agora,
      valores: Object.fromEntries(CHAVES_PERFIL.map((k) => [
        k,
        Object.prototype.hasOwnProperty.call(snapshot.valores || {}, k)
          ? (snapshot.valores[k] === null ? null : limparLinha(snapshot.valores[k]))
          : null,
      ])),
      controles: copiarControles(snapshot.controles),
    };
    dados.perfis.push(perfil);
    if (op.ativar !== false) dados.ativoId = perfil.id;
    salvarDados(dados);
    return { ok: true, perfil };
  }

  function renomear(ref, nome) {
    const dados = lerDados();
    const perfil = achar(ref, dados);
    const novo = limparLinha(nome).slice(0, 50);
    if (!perfil) return { ok: false, motivo: 'perfil nao encontrado' };
    if (!novo) return { ok: false, motivo: 'nome vazio' };
    perfil.nome = novo;
    perfil.salvoEm = new Date().toISOString();
    salvarDados(dados);
    return { ok: true, perfil };
  }

  function excluir(ref) {
    const dados = lerDados();
    const perfil = achar(ref, dados);
    if (!perfil) return { ok: false, motivo: 'perfil nao encontrado' };
    if (perfil.id === dados.ativoId) {
      return { ok: false, motivo: 'nao e possivel excluir o perfil ativo; ative outro primeiro' };
    }
    dados.perfis = dados.perfis.filter((p) => p.id !== perfil.id);
    salvarDados(dados);
    return { ok: true };
  }

  function aplicarArquivos(perfil) {
    const envAntes = lerArquivo(envPath);
    const envDepois = patchEnvText(envAntes, perfil.valores || {});
    const envDepoisObj = parseEnv(envDepois);
    const controlesPath = controlesPathDoEnv(envDepoisObj);
    const controlesExistiam = fs.existsSync(controlesPath);
    const controlesAntes = controlesExistiam ? fs.readFileSync(controlesPath) : null;

    try {
      // Controles primeiro: se falhar, o .env ainda esta intacto.
      if (Array.isArray(perfil.controles)) {
        escreverJsonAtomico(controlesPath, montarArquivoControles(perfil.controles));
      } else {
        try { fs.unlinkSync(controlesPath); } catch (err) {
          if (err && err.code !== 'ENOENT') throw err;
        }
      }
      escreverAtomico(envPath, envDepois);
      return { ok: true };
    } catch (err) {
      // Rollback best-effort para nao deixar metade de um perfil aplicado.
      try {
        if (controlesExistiam && controlesAntes) {
          fs.mkdirSync(path.dirname(controlesPath), { recursive: true });
          fs.writeFileSync(controlesPath, controlesAntes);
        } else {
          fs.unlinkSync(controlesPath);
        }
      } catch { /* mantem o erro original */ }
      return { ok: false, motivo: err.message };
    }
  }

  function ativar(ref) {
    const inicial = garantirInicial().dados;
    const destino = achar(ref, inicial);
    if (!destino) return { ok: false, motivo: `perfil "${ref}" nao encontrado` };
    if (destino.id === inicial.ativoId) {
      return { ok: true, perfil: destino, jaAtivo: true };
    }

    // Salva alteracoes feitas no assistente no perfil que estamos deixando.
    const sync = sincronizarAtivo();
    if (!sync.ok) return sync;

    const dados = lerDados();
    const perfil = achar(destino.id, dados);
    const aplicado = aplicarArquivos(perfil);
    if (!aplicado.ok) return aplicado;

    dados.ativoId = perfil.id;
    perfil.salvoEm = new Date().toISOString();
    salvarDados(dados);
    return { ok: true, perfil };
  }

  return {
    baseDir,
    envPath,
    perfisPath,
    garantirInicial,
    listar,
    ativo,
    lerDados,
    snapshotAtual,
    sincronizarAtivo,
    criar,
    renomear,
    excluir,
    achar,
    ativar,
  };
}

function argumentoPerfil(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--perfil' && argv[i + 1]) return String(argv[i + 1]);
    if (a.startsWith('--perfil=')) return a.slice('--perfil='.length);
  }
  return null;
}

module.exports = {
  CHAVES_PERFIL,
  VERSAO_ARQUIVO,
  CHAVES_PERFIL,
  criarStore,
  argumentoPerfil,
  patchEnvText,
  parseEnv,
  slug,
  nomeSugerido,
};
