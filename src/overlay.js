/**
 * Overlay para OBS Studio (v2.3).
 *
 * Servidor HTTP embutido (zero dependências, funciona dentro do .exe do
 * pkg) que serve uma página para usar como "Fonte de Navegador" no OBS:
 *
 *   http://localhost:8899
 *
 * A página mostra AO VIVO:
 *  - as últimas ações do chat (quem apertou o quê)
 *  - o botão do controle com cor/ícone
 *  - o TOP 3 jogadores
 *  - as teclas seguradas no momento (hold) com contagem regressiva
 *  - status: chat no controle (verde) ou PAUSADO pelo streamer (vermelho)
 *  - conexões Twitch/YouTube, total de comandos e uptime
 *
 * Como não há como o OBS "empurrar" eventos, a página faz polling de
 * /api/estado a cada 1s — leve o suficiente e robusto contra reconexões.
 *
 * Configuração (.env):
 *   OVERLAY_ATIVA=true|false   (padrão: true)
 *   OVERLAY_PORTA=8899         (se a porta estiver ocupada, tenta +1..+5)
 */

const http = require('http');

const logger = require('./utils/logger');
const { BOTOES } = require('./commands');

/** Máximo de ações mantidas no feed. */
const MAX_ACOES = 15;

// ---------------------------------------------------------------------------
// Estado do overlay
// ---------------------------------------------------------------------------

const estado = {
  versao: '',
  iniciadoEm: Date.now(),
  pausado: false,
  conexoes: { twitch: false, youtube: false },
  acoes: [],
  // v2.4: alvo do teclado (modo janela)
  alvo: { ativo: false, nome: '' },
};

/** Provedores injetados pelo index.js (evita dependências circulares). */
let provedores = {
  seguradas: () => [],
  resumoStats: () => ({}),
};

/**
 * Registra os provedores de dados (teclas seguradas, estatísticas).
 * @param {object} p - { seguradas: () => [], resumoStats: () => ({}) }
 */
function configurarProvedores(p) {
  provedores = { ...provedores, ...p };
}

/** Define a versão exibida no cabeçalho. */
function setVersao(v) {
  estado.versao = String(v || '');
}

/** Define o estado de pausa (espelha o botão F9 do streamer). */
function setPausado(p) {
  estado.pausado = Boolean(p);
}

/** Define o status de conexão de uma plataforma. */
function setConexao(plataforma, conectado) {
  if (plataforma === 'twitch' || plataforma === 'youtube') {
    estado.conexoes[plataforma] = Boolean(conectado);
  }
}

/**
 * Define o emulador alvo do teclado (v2.4) — mostra no rodapé da overlay
 * se as teclas estão indo só para o emulador (modo janela).
 * @param {string|null} exe - caminho do .exe ou null (modo global)
 */
function setAlvo(exe) {
  const caminho = String(exe || '').trim();
  if (!caminho) {
    estado.alvo = { ativo: false, nome: '' };
    return;
  }
  // caminho pode ser do Windows (barras invertidas) — basename manual
  // para mostrar só o nome do .exe em qualquer plataforma
  const nome = caminho.replace(/\\/g, '/').split('/').filter(Boolean).pop() || caminho;
  estado.alvo = { ativo: true, nome };
}

/**
 * Registra uma ação do chat no feed do overlay.
 * @param {string} usuario - Quem mandou
 * @param {string|null} botao - Botão canônico (up, a, start...) ou null
 * @param {'tap'|'hold'|'soltar'} tipo
 * @param {number} [duracaoMs] - Duração do hold
 */
function registrarAcao(usuario, botao, tipo, duracaoMs) {
  const meta = botao ? BOTOES[botao] : null;
  estado.acoes.unshift({
    usuario: String(usuario || 'alguem'),
    botao: botao || null,
    icone: meta ? meta.icone : (tipo === 'soltar' ? '🔓' : '🎮'),
    rotulo: meta ? meta.rotulo : 'SOLTAR',
    tipo: tipo || 'tap',
    duracaoMs: duracaoMs || 0,
    ts: Date.now(),
  });
  if (estado.acoes.length > MAX_ACOES) {
    estado.acoes.length = MAX_ACOES;
  }
}

/** Gera o snapshot completo para /api/estado. */
function snapshot() {
  // provedores podem falhar (stats corrompido etc.) — a overlay do OBS não
  // pode morrer por causa disso: cada parte cai no fallback vazio.
  let stats = {};
  let seguradas = [];
  try {
    stats = provedores.resumoStats() || {};
  } catch { /* segue com vazio */ }
  try {
    seguradas = provedores.seguradas ? provedores.seguradas() : [];
  } catch { /* segue com vazio */ }
  const uptimeMs = Date.now() - estado.iniciadoEm;
  return {
    versao: estado.versao,
    pausado: estado.pausado,
    conexoes: { ...estado.conexoes },
    uptimeMs,
    acoes: estado.acoes,
    alvo: { ...estado.alvo },
    seguradas,
    stats: {
      total: stats.total || 0,
      holds: stats.holds || 0,
      totalComandos: stats.total || 0,
      topUsuarios: (stats.topUsuarios || []).slice(0, 3),
    },
  };
}

// ---------------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------------

let servidor = null;
let portaReal = null;

/** Trata uma requisição HTTP do overlay. */
function tratarRequisicao(req, res) {
  const caminho = (req.url || '/').split('?')[0];
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405');
    return;
  }
  if (caminho === '/' || caminho === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
    return;
  }
  if (caminho === '/api/estado') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(snapshot()));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404');
}

/**
 * Inicia o servidor do overlay. Se a porta estiver ocupada, tenta +1..+5.
 * @param {number} [porta=8899]
 * @returns {Promise<number>} Porta onde realmente subiu
 */
function iniciar(porta = 8899) {
  if (servidor) return Promise.resolve(portaReal);

  return new Promise((resolve) => {
    const tentar = (candidata, restantes) => {
      const srv = http.createServer(tratarRequisicao);
      srv.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && restantes > 0) {
          logger.aviso(`[Overlay] Porta ${candidata} ocupada — tentando ${candidata + 1}...`);
          tentar(candidata + 1, restantes - 1);
        } else {
          logger.aviso(`[Overlay] Não foi possível subir o servidor (${err.code || err.message}). Overlay desativada.`);
          resolve(null);
        }
      });
      srv.listen(candidata, '127.0.0.1', () => {
        servidor = srv;
        portaReal = srv.address().port || candidata;
        if (candidata !== 0) {
          logger.info(`[Overlay] 🖥️  Overlay do OBS: http://localhost:${candidata}`);
          logger.info('[Overlay] No OBS: Fontes → + → Navegador → cole o endereço acima.');
        }
        resolve(portaReal);
      });
    };
    tentar(Number.isInteger(porta) ? porta : 8899, 5);
  });
}

/** Para o servidor (testes / encerramento). */
function parar() {
  return new Promise((resolve) => {
    if (!servidor) { resolve(); return; }
    const srv = servidor;
    servidor = null;
    portaReal = null;
    srv.close(() => resolve());
  });
}

/** URL atual do overlay (ou null se desativado). */
function url() {
  return portaReal ? `http://localhost:${portaReal}` : null;
}

// ---------------------------------------------------------------------------
// Página HTML (embutida — sem arquivos externos, funciona no .exe)
// ---------------------------------------------------------------------------

const PAGINA = [
  '<!DOCTYPE html>',
  '<html lang="pt-BR">',
  '<head>',
  '<meta charset="UTF-8">',
  '<title>Pokemon Chat Plays — Overlay</title>',
  '<style>',
  '* { margin: 0; padding: 0; box-sizing: border-box; }',
  'html, body { width: 100%; height: 100%; overflow: hidden; }',
  'body {',
  '  font-family: "Segoe UI", "Noto Sans", system-ui, sans-serif;',
  '  background: linear-gradient(135deg, #0b0d13 0%, #12161f 100%);',
  '  color: #e8ecf3; padding: 18px;',
  '}',
  '.grade { display: grid; grid-template-columns: 1.7fr 1fr; gap: 18px; height: 100%; }',
  '.painel {',
  '  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);',
  '  border-radius: 14px; padding: 14px 16px; backdrop-filter: blur(4px);',
  '}',
  '.titulo-painel {',
  '  font-size: 15px; letter-spacing: 2px; font-weight: 700; color: #8fa3bf;',
  '  margin-bottom: 10px; text-transform: uppercase;',
  '}',
  '/* ---------- cabeçalho ---------- */',
  '.cabecalho { grid-column: 1 / 3; display: flex; align-items: center; gap: 14px; }',
  '.logo { font-size: 26px; font-weight: 800; letter-spacing: 1px; }',
  '.logo span { color: #facc15; }',
  '.badge-versao {',
  '  font-size: 13px; background: rgba(250,204,21,0.15); color: #facc15;',
  '  padding: 3px 10px; border-radius: 999px; font-weight: 600;',
  '}',
  '.pontinhos { margin-left: auto; display: flex; gap: 10px; font-size: 14px; font-weight: 600; }',
  '.ponto { display: flex; align-items: center; gap: 5px; color: #64748b; }',
  '.ponto .bolinha { width: 10px; height: 10px; border-radius: 50%; background: #3a475a; }',
  '.ponto.on { color: #cbd5e1; }',
  '.ponto.on .bolinha { background: #22c55e; box-shadow: 0 0 8px #22c55e; }',
  '/* ---------- feed de ações ---------- */',
  '.feed { display: flex; flex-direction: column; gap: 8px; overflow: hidden; }',
  '.acao {',
  '  display: flex; align-items: center; gap: 12px;',
  '  background: rgba(255,255,255,0.05); border-radius: 10px; padding: 8px 12px;',
  '  animation: surgir 0.35s ease-out;',
  '}',
  '@keyframes surgir {',
  '  from { opacity: 0; transform: translateX(-24px); }',
  '  to { opacity: 1; transform: translateX(0); }',
  '}',
  '.acao .icone-botao {',
  '  width: 44px; height: 44px; border-radius: 10px; display: flex;',
  '  align-items: center; justify-content: center; font-size: 24px;',
  '  background: #334155; flex: none;',
  '}',
  '.acao .quem { font-size: 20px; font-weight: 700; }',
  '.acao .o-que { margin-left: auto; text-align: right; }',
  '.acao .nome-botao { font-size: 19px; font-weight: 800; letter-spacing: 1px; }',
  '.acao .selo {',
  '  display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px;',
  '  border-radius: 999px; margin-top: 2px; background: rgba(255,255,255,0.12);',
  '  color: #9fb1c9; letter-spacing: 1px;',
  '}',
  '.acao .selo.hold { background: rgba(139,92,246,0.25); color: #c4b5fd; }',
  '.acao .selo.soltar { background: rgba(34,197,94,0.2); color: #86efac; }',
  '/* ---------- coluna direita ---------- */',
  '.coluna-dir { display: flex; flex-direction: column; gap: 18px; overflow: hidden; }',
  '.status { text-align: center; padding: 20px 12px; }',
  '.status .led {',
  '  font-size: 22px; font-weight: 800; letter-spacing: 1px; padding: 10px;',
  '  border-radius: 12px;',
  '}',
  '.status .led.livre { background: rgba(34,197,94,0.14); color: #4ade80; }',
  '.status .led.pausado { background: rgba(239,68,68,0.16); color: #f87171; animation: pulsar 1.2s infinite; }',
  '@keyframes pulsar { 50% { opacity: 0.45; } }',
  '.status .sub { font-size: 13px; color: #8fa3bf; margin-top: 6px; }',
  '/* ---------- top 3 ---------- */',
  '.jogador { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }',
  '.jogador .medalha { font-size: 22px; width: 30px; text-align: center; }',
  '.jogador .nome { font-size: 18px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.jogador .qtd { margin-left: auto; font-size: 16px; color: #93a5c0; font-weight: 700; }',
  '.jogador .barra { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }',
  '.jogador .barra i { display: block; height: 100%; background: linear-gradient(90deg, #facc15, #f97316); }',
  '.vazio { color: #5b6a80; font-size: 15px; }',
  '/* ---------- seguradas ---------- */',
  '.chips { display: flex; flex-wrap: wrap; gap: 8px; }',
  '.chip {',
  '  background: rgba(139,92,246,0.18); border: 1px solid rgba(139,92,246,0.4);',
  '  border-radius: 999px; padding: 6px 14px; font-size: 16px; font-weight: 700;',
  '}',
  '.chip small { color: #c4b5fd; font-weight: 600; }',
  '/* ---------- rodapé ---------- */',
  '.rodape { display: flex; justify-content: space-between; font-size: 14px; color: #7d8fa8; gap: 10px; }',
  '#alvo { color: #facc15; font-weight: 600; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.reconectando { position: fixed; inset: 0; display: none; align-items: center; justify-content: center;',
  '  background: rgba(11,13,19,0.88); font-size: 22px; font-weight: 700; color: #facc15; }',
  '</style>',
  '</head>',
  '<body>',
  '<div class="reconectando" id="reconectando">⟳ reconectando ao overlay...</div>',
  '<div class="grade">',
  '  <div class="painel cabecalho">',
  '    <div class="logo">🎮 POKÉMON <span>CHAT PLAYS</span></div>',
  '    <div class="badge-versao" id="versao"></div>',
  '    <div class="pontinhos">',
  '      <div class="ponto" id="pt-twitch"><div class="bolinha"></div>TWITCH</div>',
  '      <div class="ponto" id="pt-youtube"><div class="bolinha"></div>YOUTUBE</div>',
  '    </div>',
  '  </div>',
  '  <div class="painel">',
  '    <div class="titulo-painel">Últimas ações do chat</div>',
  '    <div class="feed" id="feed"></div>',
  '  </div>',
  '  <div class="coluna-dir">',
  '    <div class="painel status">',
  '      <div class="led livre" id="led">🟢 CHAT NO CONTROLE</div>',
  '      <div class="sub" id="led-sub">o chat está jogando</div>',
  '    </div>',
  '    <div class="painel">',
  '      <div class="titulo-painel">Top jogadores</div>',
  '      <div id="top"><div class="vazio">ninguém jogou ainda...</div></div>',
  '    </div>',
  '    <div class="painel">',
  '      <div class="titulo-painel">Segurando agora</div>',
  '      <div class="chips" id="seguradas"><span class="vazio">nada preso</span></div>',
  '    </div>',
  '    <div class="painel rodape" style="margin-top:auto">',
  '      <span id="alvo" title="para onde as teclas do chat estão indo">⌨️ teclado global</span>',
  '      <span id="total">0 comandos</span>',
  '      <span id="uptime">0min</span>',
  '    </div>',
  '  </div>',
  '</div>',
  '<script>',
  'var CORES_BOTAO = {',
  '  up: "#3b82f6", down: "#3b82f6", left: "#3b82f6", right: "#3b82f6",',
  '  a: "#22c55e", b: "#ef4444", l: "#8b5cf6", r: "#f97316",',
  '  start: "#eab308", select: "#64748b"',
  '};',
  'function esc(t) {',
  '  return String(t == null ? "" : t).replace(/[&<>"\\\']/g, function(c) {',
  '    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\\\'": "&#39;" }[c];',
  '  });',
  '}',
  'function fmtUptime(ms) {',
  '  var min = Math.floor(ms / 60000);',
  '  if (min < 60) return min + "min";',
  '  var h = Math.floor(min / 60);',
  '  return h + "h " + (min % 60) + "min";',
  '}',
  'function renderizarAcao(a) {',
  '  var div = document.createElement("div");',
  '  div.className = "acao";',
  '  var cor = CORES_BOTAO[a.botao] || "#334155";',
  '  var selo = "";',
  '  if (a.tipo === "hold") selo = \'<span class="selo hold">HOLD \' + (Math.round(a.duracaoMs / 100) / 10) + \'s</span>\';',
  '  if (a.tipo === "soltar") selo = \'<span class="selo soltar">SOLTOU TUDO</span>\';',
  '  if (a.tipo === "tap") selo = \'<span class="selo">TOQUE</span>\';',
  '  div.innerHTML = \'<div class="icone-botao" style="background:\' + cor + \'">\' + esc(a.icone) +',
  '    \'</div><div class="quem">\' + esc(a.usuario) +',
  '    \'</div><div class="o-que"><div class="nome-botao">\' + esc(a.rotulo) + \'</div>\' + selo + \'</div>\';',
  '  return div;',
  '}',
  'var ultimaChave = "";',
  'function chaveAcoes(acoes) {',
  '  var c = "";',
  '  for (var i = 0; i < acoes.length; i++) c += acoes[i].usuario + "|" + acoes[i].botao + "|" + acoes[i].ts + ";";',
  '  return c;',
  '}',
  'function atualizar(d) {',
  '  document.getElementById("versao").textContent = d.versao ? ("v" + d.versao) : "";',
  '  document.getElementById("pt-twitch").className = "ponto" + (d.conexoes.twitch ? " on" : "");',
  '  document.getElementById("pt-youtube").className = "ponto" + (d.conexoes.youtube ? " on" : "");',
  '  var led = document.getElementById("led");',
  '  if (d.pausado) {',
  '    led.className = "led pausado";',
  '    led.textContent = "⛔ PAUSADO PELO STREAMER";',
  '    document.getElementById("led-sub").textContent = "aperte F9 para liberar";',
  '  } else {',
  '    led.className = "led livre";',
  '    led.textContent = "🟢 CHAT NO CONTROLE";',
  '    document.getElementById("led-sub").textContent = "o chat está jogando";',
  '  }',
  '  var c = chaveAcoes(d.acoes);',
  '  if (c !== ultimaChave) {',
  '    ultimaChave = c;',
  '    var feed = document.getElementById("feed");',
  '    feed.innerHTML = "";',
  '    for (var i = 0; i < d.acoes.length; i++) feed.appendChild(renderizarAcao(d.acoes[i]));',
  '  }',
  '  var top = document.getElementById("top");',
  '  if (d.stats && d.stats.topUsuarios && d.stats.topUsuarios.length > 0) {',
  '    var max = d.stats.topUsuarios[0].comandos || 1;',
  '    var medalhas = ["🥇", "🥈", "🥉"];',
  '    var html = "";',
  '    for (var j = 0; j < d.stats.topUsuarios.length; j++) {',
  '      var u = d.stats.topUsuarios[j];',
  '      html += \'<div class="jogador"><div class="medalha">\' + medalhas[j] +',
  '        \'</div><div style="flex:1;min-width:0"><div class="nome">\' + esc(u.nome) +',
  '        \'</div><div class="barra"><i style="width:\' + Math.max(8, Math.round(100 * u.comandos / max)) + \'%"></i></div></div>\' +',
  '        \'<div class="qtd">\' + u.comandos + \'</div></div>\';',
  '    }',
  '    top.innerHTML = html;',
  '  } else {',
  '    top.innerHTML = \'<div class="vazio">ninguém jogou ainda...</div>\';',
  '  }',
  '  var seg = document.getElementById("seguradas");',
  '  if (d.seguradas && d.seguradas.length > 0) {',
  '    var htmlSeg = "";',
  '    for (var k = 0; k < d.seguradas.length; k++) {',
  '      var s = d.seguradas[k];',
  '      var segs = Math.ceil(s.restanteMs / 1000);',
  '      htmlSeg += \'<div class="chip">\' + esc(String(s.tecla).toUpperCase()) +',
  '        \' <small>\' + segs + \'s</small></div>\';',
  '    }',
  '    seg.innerHTML = htmlSeg;',
  '  } else {',
  '    seg.innerHTML = \'<span class="vazio">nada preso</span>\';',
  '  }',
  '  document.getElementById("total").textContent = (d.stats ? d.stats.total : 0) + " comandos";',
  '  document.getElementById("uptime").textContent = fmtUptime(d.uptimeMs);',
  '  var alvoEl = document.getElementById("alvo");',
  '  if (d.alvo && d.alvo.ativo) {',
  '    alvoEl.textContent = "🎯 " + d.alvo.nome;',
  '    alvoEl.title = "teclas do chat indo SÓ para: " + d.alvo.nome;',
  '  } else {',
  '    alvoEl.textContent = "⌨️ teclado global";',
  '    alvoEl.title = "teclas do chat indo para a janela em foco";',
  '  }',
  '}',
  'var falhas = 0;',
  'function ciclar() {',
  '  fetch("/api/estado").then(function(r) { return r.json(); }).then(function(d) {',
  '    falhas = 0;',
  '    document.getElementById("reconectando").style.display = "none";',
  '    atualizar(d);',
  '  }).catch(function() {',
  '    falhas++;',
  '    if (falhas >= 3) document.getElementById("reconectando").style.display = "flex";',
  '  });',
  '}',
  'ciclar();',
  'setInterval(ciclar, 1000);',
  '</script>',
  '</body>',
  '</html>',
].join('\n');

module.exports = {
  iniciar,
  parar,
  url,
  snapshot,
  registrarAcao,
  setPausado,
  setConexao,
  setVersao,
  setAlvo,
  configurarProvedores,
  PAGINA,
};
