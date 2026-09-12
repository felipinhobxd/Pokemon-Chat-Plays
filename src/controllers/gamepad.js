'use strict';

/**
 * Gamepad virtual Xbox 360 para Windows via ViGEmClient/ViGEmBus.
 *
 * Sem dependencia npm nativa: um worker PowerShell compila um pequeno bridge
 * C# em memoria e conversa com ViGEmClient.dll. Se o driver/DLL nao existir,
 * o ChatPlays apenas avisa e continua normalmente (fail-open).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

const PADRAO_TAP_MS = 220;
const PADRAO_ANALOG_MS = 320;
const MAX_ACOES_PENDENTES = 32;

/**
 * Situação do gamepad para diagnóstico (dashboard/overlay) — v3.1: nunca
 * mais um "indisponível" genérico. Estados possíveis:
 *  - desativado        (GAMEPAD_ENABLED=off)
 *  - aguardando        (auto: cria no primeiro comando)
 *  - dll-ausente       (ViGEmClient.dll não encontrada em lugar nenhum)
 *  - arquitetura-errada(DLL não é x64 / formato inválido)
 *  - falha-carregamento(DLL encontrada mas não carrega)
 *  - sem-vigembus      (driver ViGEmBus ausente ou desconectado)
 *  - falha-desconhecida(erro do worker sem classificação)
 *  - pronto            (controle Xbox virtual criado)
 */
let estado = 'aguardando';
let estadoDetalhe = '';

/** Plataforma injetável para os testes (produção: process.platform). */
let plataformaFake = null;
function plataformaAtual() {
  return plataformaFake || process.platform;
}

/** Linhas escritas no worker quando simulado nos testes. */
let linhasSimuladas = null;

let opcoes = {
  modo: 'auto', // auto | on | off
  vigemDll: '',
  tapMs: PADRAO_TAP_MS,
  analogMs: PADRAO_ANALOG_MS,
};

const worker = {
  proc: null,
  ready: false,
  alvoDll: '',
  buffer: [],
  stderr: '',
  retryAfter: 0,
};

const timers = new Map();
let ultimoAviso = 0;
let envSincronizado = false;

function limitar(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function inteiroEnv(valor, fallback, min, max) {
  const n = Number.parseInt(String(valor ?? ''), 10);
  return Number.isFinite(n) ? Math.round(limitar(n, min, max)) : fallback;
}

function normalizarModo(valor) {
  const t = String(valor ?? 'auto').trim().toLowerCase();
  if (['1', 'true', 'yes', 'sim', 'on', 'ligado'].includes(t)) return 'on';
  if (['0', 'false', 'no', 'nao', 'off', 'desligado'].includes(t)) return 'off';
  return 'auto';
}

function configurar(op = {}) {
  const anterior = { ...opcoes };
  opcoes = {
    modo: op.modo !== undefined ? normalizarModo(op.modo) : opcoes.modo,
    vigemDll: op.vigemDll !== undefined ? String(op.vigemDll || '').trim() : opcoes.vigemDll,
    tapMs: op.tapMs !== undefined ? inteiroEnv(op.tapMs, PADRAO_TAP_MS, 40, 10000) : opcoes.tapMs,
    analogMs: op.analogMs !== undefined ? inteiroEnv(op.analogMs, PADRAO_ANALOG_MS, 40, 10000) : opcoes.analogMs,
  };

  if (opcoes.modo === 'off') {
    estado = 'desativado';
    estadoDetalhe = 'GAMEPAD_ENABLED=off';
  } else if (estado === 'desativado') {
    estado = 'aguardando';
    estadoDetalhe = '';
  }

  if (anterior.vigemDll !== opcoes.vigemDll || anterior.modo !== opcoes.modo) {
    pararWorker();
  }
  return status();
}

function configurarDeEnv(env = process.env) {
  envSincronizado = true;
  return configurar({
    modo: env.GAMEPAD_ENABLED ?? 'auto',
    vigemDll: env.GAMEPAD_VIGEM_DLL ?? '',
    tapMs: env.GAMEPAD_TAP_MS ?? PADRAO_TAP_MS,
    analogMs: env.GAMEPAD_ANALOG_MS ?? PADRAO_ANALOG_MS,
  });
}

function garantirEnv() {
  if (!envSincronizado) configurarDeEnv(process.env);
}

function procurarDll() {
  garantirEnv();
  if (opcoes.vigemDll) {
    const p = path.resolve(opcoes.vigemDll.replace(/^"|"$/g, ''));
    return fs.existsSync(p) ? p : opcoes.vigemDll;
  }

  // v3.1: ordem determinística — o .exe empacotado (pkg) NÃO pode depender
  // de cwd nem do filesystem virtual do pkg: process.execPath é o CAMINHO
  // REAL do executável em builds pkg, então o diretório dele vem primeiro.
  // node src/boot.js de qualquer cwd continua achando a DLL na raiz do repo.
  const candidatos = [
    path.join(path.dirname(process.execPath), 'ViGEmClient.dll'),
    path.join(process.cwd(), 'ViGEmClient.dll'),
    path.resolve(__dirname, '..', '..', 'ViGEmClient.dll'),
  ];
  for (const p of candidatos) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch { /* ignora */ }
  }
  return 'ViGEmClient.dll';
}

const { fonteWorker } = require('./gamepad-worker');

/**
 * Classifica a mensagem de erro do worker em um estado de diagnóstico.
 * (Mensagens do .NET/PowerShell podem vir localizadas — casa os dois idiomas.)
 * @param {string} mensagem
 * @returns {{estado: string, detalhe: string}}
 */
function classificarErroWorker(mensagem) {
  const t = String(mensagem || '').toLowerCase();
  if (/vigem_connect/.test(t)) {
    return { estado: 'sem-vigembus', detalhe: 'driver ViGEmBus ausente ou serviço parado (o instalador está na pasta drivers/ do app)' };
  }
  if (/vigem_alloc|vigem_target|primeiro update/.test(t)) {
    return { estado: 'sem-vigembus', detalhe: 'falha ao criar o controle virtual — verifique o driver ViGEmBus' };
  }
  if (/format|valid win32|32-bit|não é um aplicativo|nao e um aplicativo|incorrect format|incorreto/.test(t)) {
    return { estado: 'arquitetura-errada', detalhe: 'ViGEmClient.dll não é x64 — use a versão de 64 bits ao lado do ChatPlays.exe' };
  }
  if (/load dll|carregar a dll|unable to load|could not load|não é possível carregar|nao e possivel carregar|could not be loaded|dllnotfound/.test(t)) {
    return { estado: 'falha-carregamento', detalhe: 'ViGEmClient.dll foi encontrada mas não pôde ser carregada' };
  }
  return { estado: 'falha-desconhecida', detalhe: String(mensagem || '').slice(0, 160) };
}

function avisar(texto, forcar = false) {
  const agora = Date.now();
  if (!forcar && agora - ultimoAviso < 10000) return;
  ultimoAviso = agora;
  logger.aviso(`[Gamepad] ${texto}`);
}

function limparTimers() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

function agendar(chave, duracaoMs, fn) {
  const anterior = timers.get(chave);
  if (anterior) clearTimeout(anterior);
  const timer = setTimeout(() => {
    timers.delete(chave);
    fn();
  }, duracaoMs);
  timer.unref?.();
  timers.set(chave, timer);
}

function pararWorker() {
  limparTimers();
  worker.buffer = [];
  worker.ready = false;
  if (linhasSimuladas) linhasSimuladas = null;
  if (!worker.proc) return;
  const proc = worker.proc;
  worker.proc = null;
  try { proc.stdin?.write('RESET\nQUIT\n'); } catch { /* fechando */ }
  try { proc.kill(); } catch { /* ja saiu */ }
}

function iniciarWorker() {
  garantirEnv();
  if (opcoes.modo === 'off') return false;
  if (plataformaAtual() !== 'win32') {
    avisar('gamepad virtual esta disponivel apenas no Windows nesta versao.');
    return false;
  }
  if (worker.proc && !worker.proc.killed) return true;
  if (Date.now() < worker.retryAfter) return false;

  const dll = procurarDll();
  if (opcoes.vigemDll && dll !== 'ViGEmClient.dll' && !fs.existsSync(path.resolve(dll))) {
    avisar(`GAMEPAD_VIGEM_DLL nao foi encontrado: ${opcoes.vigemDll}`, true);
    estado = 'dll-ausente';
    estadoDetalhe = `caminho configurado não existe: ${opcoes.vigemDll}`;
    worker.retryAfter = Date.now() + 10000;
    return false;
  }
  // v3.1: DLL "bare" (nenhum candidato existia) não carrega de forma
  // confiável — o PATH do PowerShell não inclui a pasta do app. Diagnóstico
  // explícito em vez de erro genérico de Add-Type depois de 25s.
  if (!opcoes.vigemDll && dll === 'ViGEmClient.dll') {
    avisar('ViGEmClient.dll nao foi encontrada (procure ao lado do ChatPlays.exe). O jogo continua com teclado/mouse.', true);
    estado = 'dll-ausente';
    estadoDetalhe = 'ViGEmClient.dll ausente — coloque a DLL (x64) ao lado do ChatPlays.exe ou defina GAMEPAD_VIGEM_DLL';
    worker.retryAfter = Date.now() + 60000;
    return false;
  }

  try {
    const encoded = Buffer.from(fonteWorker(), 'utf16le').toString('base64');
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, CHATPLAYS_VIGEM_DLL: dll },
      }
    );

    worker.proc = proc;
    worker.ready = false;
    worker.alvoDll = dll;
    worker.stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    proc.stdout.on('data', (dados) => {
      const linhas = String(dados).split(/\r?\n/).filter(Boolean);
      for (const linha of linhas) {
        if (linha === 'READY') {
          worker.ready = true;
          estado = 'pronto';
          estadoDetalhe = `ViGEmClient.dll: ${worker.alvoDll || dll}`;
          logger.info('[Gamepad] 🎮 Controle virtual Xbox 360 conectado via ViGEm.');
          const pendentes = worker.buffer.splice(0);
          for (const cmd of pendentes) enviarDireto(cmd);
        } else if (linha.startsWith('ERROR ')) {
          worker.ready = false;
          worker.buffer = [];
          worker.retryAfter = Date.now() + 10000;
          const msg = linha.slice(6);
          const c = classificarErroWorker(msg);
          estado = c.estado;
          estadoDetalhe = c.detalhe;
          avisar(`${msg}. ${c.estado === 'sem-vigembus'
            ? 'Instale o driver ViGEmBus (o instalador está em drivers/ ao lado do ChatPlays.exe).'
            : 'Instale o ViGEmBus e deixe ViGEmClient.dll ao lado do ChatPlays.exe ou configure GAMEPAD_VIGEM_DLL.'}`, true);
        }
      }
    });

    proc.stderr.on('data', (dados) => {
      worker.stderr += String(dados);
      if (worker.stderr.length > 3000) worker.stderr = worker.stderr.slice(-3000);
    });

    proc.on('error', (err) => {
      worker.ready = false;
      worker.retryAfter = Date.now() + 10000;
      avisar(`nao foi possivel iniciar o worker: ${err.message}`, true);
    });

    proc.on('exit', (codigo) => {
      if (worker.proc === proc) worker.proc = null;
      worker.ready = false;
      worker.buffer = [];
      if (estado === 'pronto') {
        // worker caiu depois de pronto: próximo comando tenta subir de novo
        estado = 'aguardando';
        estadoDetalhe = 'worker caiu — tenta recriar no próximo comando';
      }
      if (codigo && codigo !== 0) worker.retryAfter = Date.now() + 10000;
    });
    return true;
  } catch (err) {
    worker.retryAfter = Date.now() + 10000;
    avisar(`falha ao iniciar gamepad: ${err.message}`, true);
    return false;
  }
}

function enviarDireto(linha) {
  if (linhasSimuladas) {
    linhasSimuladas.push(String(linha).trim());
    return true;
  }
  if (!worker.proc || !worker.proc.stdin?.writable) return false;
  try {
    worker.proc.stdin.write(`${linha}\n`);
    return true;
  } catch (err) {
    avisar(`falha ao enviar acao: ${err.message}`);
    return false;
  }
}

function enviar(linha) {
  garantirEnv();
  if (opcoes.modo === 'off') {
    avisar('comandos de gamepad estao desativados (GAMEPAD_ENABLED=off).');
    return false;
  }
  if (linhasSimuladas || worker.proc) {
    // worker simulado (testes) ou vivo: manda direto / buffering normal
    if (worker.ready || linhasSimuladas) return enviarDireto(linha);
    if (worker.buffer.length >= MAX_ACOES_PENDENTES) worker.buffer.shift();
    worker.buffer.push(linha);
    return true;
  }
  if (!iniciarWorker()) return false;
  if (worker.ready) return enviarDireto(linha);
  if (worker.buffer.length >= MAX_ACOES_PENDENTES) worker.buffer.shift();
  worker.buffer.push(linha);
  return true;
}

function duracaoDaAcao(valor, fallback) {
  // v3.1: piso de 1ms (era 40ms) — a faixa de hold é 1ms–10s
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(limitar(n, 1, 10000)) : fallback;
}

function pressionar(botao, duracaoMs) {
  const duracao = duracaoDaAcao(duracaoMs, opcoes.tapMs);
  if (!enviar(`B ${botao} 1`)) return false;
  agendar(`B:${botao}`, duracao, () => enviar(`B ${botao} 0`));
  return true;
}

function moverStick(stick, x, y, duracaoMs) {
  const nx = Math.round(limitar(x, -100, 100));
  const ny = Math.round(limitar(y, -100, 100));
  const duracao = duracaoDaAcao(duracaoMs, opcoes.analogMs);
  if (!enviar(`S ${stick} ${nx} ${ny}`)) return false;
  agendar(`S:${stick}`, duracao, () => enviar(`S ${stick} 0 0`));
  return true;
}

function acionarTrigger(trigger, valor, duracaoMs) {
  const pct = Math.round(limitar(valor, 0, 100));
  const duracao = duracaoDaAcao(duracaoMs, opcoes.analogMs);
  if (!enviar(`T ${trigger} ${pct}`)) return false;
  agendar(`T:${trigger}`, duracao, () => enviar(`T ${trigger} 0`));
  return true;
}

function resetar() {
  limparTimers();
  if (linhasSimuladas) {
    worker.buffer = [];
    return enviarDireto('RESET');
  }
  if (!worker.proc) return false;
  worker.buffer = ['RESET'];
  if (worker.ready) {
    worker.buffer = [];
    return enviarDireto('RESET');
  }
  return true;
}

function executar(comando) {
  if (!comando || typeof comando !== 'object') return false;
  if (comando.tipo === 'gamepad-botao') return pressionar(comando.botao, comando.duracaoMs);
  if (comando.tipo === 'gamepad-stick') return moverStick(comando.stick, comando.x, comando.y, comando.duracaoMs);
  if (comando.tipo === 'gamepad-trigger') return acionarTrigger(comando.trigger, comando.valor, comando.duracaoMs);
  if (comando.tipo === 'gamepad-reset') return resetar();
  return false;
}

function preparar() {
  garantirEnv();
  if (opcoes.modo !== 'on') return false;
  return iniciarWorker();
}

function status() {
  return {
    modo: opcoes.modo,
    pronto: worker.ready,
    rodando: Boolean(worker.proc && !worker.proc.killed) || Boolean(linhasSimuladas),
    vigemDll: worker.alvoDll || opcoes.vigemDll || '',
    tapMs: opcoes.tapMs,
    analogMs: opcoes.analogMs,
    suportado: plataformaAtual() === 'win32',
    // v3.1: diagnóstico diferenciado (nunca mais "indisponível" genérico)
    estado,
    detalhe: estadoDetalhe,
  };
}

function parar() {
  resetar();
  pararWorker();
}

process.once('exit', parar);

module.exports = {
  configurar,
  configurarDeEnv,
  preparar,
  pressionar,
  moverStick,
  acionarTrigger,
  resetar,
  executar,
  status,
  parar,
  __test: {
    limitar,
    inteiroEnv,
    normalizarModo,
    procurarDll,
    fonteWorker,
    duracaoDaAcao,
    classificarErroWorker,
    /** Injeta plataforma + worker simulado (captura linhas) p/ testes. */
    simular({ plataforma = 'win32', pronto = true, linhas = [] } = {}) {
      plataformaFake = plataforma;
      linhasSimuladas = linhas;
      worker.ready = Boolean(pronto);
      if (pronto) {
        estado = 'pronto';
        estadoDetalhe = 'worker simulado (teste)';
      }
    },
    restaurarSimulacao() {
      plataformaFake = null;
      linhasSimuladas = null;
      worker.ready = false;
      worker.proc = null;
      worker.buffer = [];
      worker.retryAfter = 0;
      limparTimers();
      estado = 'aguardando';
      estadoDetalhe = '';
    },
    definirEstado(novoEstado, detalhe = '') {
      estado = novoEstado;
      estadoDetalhe = detalhe;
    },
  },
};
