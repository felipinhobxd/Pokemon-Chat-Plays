'use strict';

/**
 * Painel local de diagnostico do ChatPlays (Passo 6).
 *
 * Reutiliza o mesmo servidor loopback da overlay, portanto nao abre porta
 * extra e nao expoe credenciais. A pagina consulta /api/estado e mostra o
 * que ajuda o streamer a entender rapidamente se o bot esta saudavel.
 */

const PAGINA_DASHBOARD = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ChatPlays — Painel ao vivo</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#0a0d14;color:#edf2f7;font-family:Segoe UI,system-ui,sans-serif}
body{padding:20px}.wrap{max-width:1450px;margin:auto}.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
h1{font-size:26px;margin:0}.muted{color:#8da0ba}.spacer{flex:1}.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid #273349;border-radius:999px;padding:6px 10px;font-size:12px;background:#111827}
.dot{width:9px;height:9px;border-radius:50%;background:#64748b}.on .dot{background:#22c55e}.bad .dot{background:#ef4444}.warn .dot{background:#f59e0b}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{background:#101722;border:1px solid #222f43;border-radius:14px;padding:14px;min-height:118px}
.card h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8da0ba;margin:0 0 10px}.big{font-size:23px;font-weight:750}.line{display:flex;justify-content:space-between;gap:12px;margin:7px 0;font-size:13px}.line b{text-align:right;overflow-wrap:anywhere}
.wide{grid-column:span 2}.full{grid-column:1/-1}.list{display:flex;flex-direction:column;gap:7px}.row{background:#0c121c;border:1px solid #1d293a;border-radius:9px;padding:9px 10px;font-size:13px;display:flex;gap:10px;align-items:center}.row .time{color:#71839c;margin-left:auto;font-variant-numeric:tabular-nums}
.err{border-color:#51272c;background:#1a1115}.warnrow{border-color:#57451c;background:#18150d}.oktxt{color:#6ee7a0}.badtxt{color:#fca5a5}.yellow{color:#fde68a}.mono{font-family:Consolas,ui-monospace,monospace}
.empty{color:#71839c;font-size:13px;padding:8px 0}.footer{color:#66758a;font-size:12px;margin-top:14px;text-align:center}
.reat{background:#1c2a3a;border:1px solid #2f4a63;border-radius:999px;padding:6px 12px;font-size:12px;color:#fde68a;cursor:pointer;font-family:inherit}
.reat:hover{background:#243447}.reat:disabled{opacity:.55;cursor:wait}
@media(max-width:1050px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wide{grid-column:span 2}}
@media(max-width:650px){body{padding:12px}.grid{grid-template-columns:1fr}.wide,.full{grid-column:1}h1{font-size:21px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1>🎮 ChatPlays <span class="muted">Painel ao vivo</span></h1>
    <span id="versao" class="pill">v?</span>
    <span class="pill"><span class="dot"></span> somente neste PC</span>
    <span class="spacer"></span>
    <span id="sync" class="pill warn"><span class="dot"></span> conectando…</span>
  </div>

  <div class="grid">
    <section class="card"><h2>Plataformas</h2><div id="plataformas"></div></section>
    <section class="card"><h2>Chat</h2><div id="chat"></div></section>
    <section class="card"><h2>Jogo / teclado</h2><div id="jogo"></div></section>
    <section class="card"><h2>Fila de input</h2><div id="fila"></div></section>
    <section class="card wide"><h2>Cooldown / anti-spam</h2><div id="cooldown"></div></section>
    <section class="card wide"><h2>Gamepad virtual</h2><div id="gamepad"></div></section>
    <section class="card wide"><h2>Últimas ações</h2><div id="acoes" class="list"></div></section>
    <section class="card wide"><h2>Avisos e erros recentes</h2><div id="logs" class="list"></div></section>
  </div>
  <div class="footer">Atualiza automaticamente. Nenhum token, API key ou segredo é enviado para esta página.</div>
</div>
<script>
(function(){
  'use strict';
  var $=function(id){return document.getElementById(id)};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmtMs(ms){ms=Math.max(0,Number(ms)||0);if(ms<1000)return Math.round(ms)+'ms';if(ms<60000)return (ms/1000).toFixed(ms<10000?1:0)+'s';return Math.floor(ms/60000)+'m '+Math.floor((ms%60000)/1000)+'s'}
  function line(a,b,cls){return '<div class="line"><span>'+esc(a)+'</span><b class="'+(cls||'')+'">'+esc(b)+'</b></div>'}
  function pill(nome,on){return '<span class="pill '+(on?'on':'bad')+'"><span class="dot"></span>'+esc(nome)+'</span>'}
  function pillYoutube(s){
    if(s.youtubeSuspensoQuota){
      return '<span class="pill warn"><span class="dot"></span>YouTube: SUSPENSO — QUOTA</span>'+
        '<button id="reativarYt" class="reat" type="button">\ud83d\udd01 Reativar YouTube</button>';
    }
    return pill('YouTube',!!(s.conexoes&&s.conexoes.youtube));
  }
  function ligarReativacao(){
    var btn=$('reativarYt');
    if(!btn)return;
    btn.addEventListener('click',function(){
      btn.disabled=true;btn.textContent='reativando…';
      fetch('/api/reativar-youtube',{method:'POST'}).then(function(r){return r.json()}).then(function(){ciclo()}).catch(function(){
        btn.disabled=false;btn.textContent='\ud83d\udd01 Reativar YouTube (tente de novo)';
      });
    });
  }
  var ESTADOS_PAD={desativado:['DESATIVADO',''],aguardando:['AGUARDANDO COMANDO','yellow'],pronto:['CONTROLE CRIADO','oktxt'],'dll-ausente':['DLL AUSENTE','badtxt'],'arquitetura-errada':['DLL NÃO É x64','badtxt'],'falha-carregamento':['DLL NÃO CARREGA','badtxt'],'sem-vigembus':['DRIVER ViGEmBus AUSENTE','badtxt'],'falha-desconhecida':['FALHA','badtxt']};
  function estadoPad(g){return ESTADOS_PAD[g&&g.estado]||ESTADOS_PAD.aguardando}
  function render(s){
    var d=s.diagnostico||{}, t=d.teclado||{}, c=d.cooldown||{}, g=d.gamepad||{}, b=c.bloqueios||{};
    $('versao').textContent='v'+(s.versao||'?');
    $('sync').className='pill on';$('sync').innerHTML='<span class="dot"></span> ao vivo · '+new Date(s.geradoEm||Date.now()).toLocaleTimeString();
    $('plataformas').innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'+pill('Twitch',!!(s.conexoes&&s.conexoes.twitch))+pillYoutube(s)+'</div>'+line('Comandos processados',s.stats&&s.stats.totalComandos||0)+line('Uptime',fmtMs(s.uptimeMs));
    ligarReativacao();
    var modo=(s.votacao&&s.votacao.modo)||'anarquia';
    $('chat').innerHTML=line('Estado',s.pausado?'PAUSADO':'LIBERADO',s.pausado?'badtxt':'oktxt')+line('Modo',modo)+line('Teclas seguradas',(s.seguradas||[]).length)+line('Tecla de pausa',String(s.teclaPausa||'f9').toUpperCase());
    var j=s.jogo||{}, alvo=s.alvo||{};
    $('jogo').innerHTML=line('Jogo',j.ativo?(j.rodando?'RODANDO':(j.reabrindo?'REABRINDO':'PARADO')):'não gerenciado',j.rodando?'oktxt':(j.reabrindo?'yellow':''))+line('Processo',j.nome||'—')+line('Alvo do teclado',alvo.ativo?(alvo.nome||'janela'):'janela em foco')+line('Backend',t.modo||'—');
    var q=Number(t.fila)||0, qm=Number(t.filaMax)||0;
    $('fila').innerHTML='<div class="big '+(qm&&q>=qm?'yellow':'')+'">'+q+(qm?' / '+qm:'')+'</div>'+line('Executando agora',t.processando?'sim':'não')+line('Toques descartados',t.descartados||0,(t.descartados||0)>0?'yellow':'')+line('Worker',t.worker&&t.worker.legacy?'compatível':(t.worker&&t.worker.pronto?'pronto':(t.worker&&t.worker.booting?'iniciando':'parado')));
    $('cooldown').innerHTML=line('Cooldown por usuário',fmtMs(c.baseMs))+line('Cooldown global',fmtMs(c.globalMs))+line('Regras específicas',c.regrasEspecificas||0)+line('Bloqueios globais',b.global||0)+line('Bloqueios por usuário',b.usuario||0)+line('Bloqueios específicos',b.comando||0);
    var ep=estadoPad(g);
    $('gamepad').innerHTML=line('Modo',g.modo||'—')+line('Suportado neste SO',g.suportado?'sim':'não',g.suportado?'oktxt':'')+line('Situação',ep[0],ep[1])+line('Detalhe',(g.detalhe||'—').slice(0,80))+line('Worker',g.pronto?'PRONTO':(g.rodando?'INICIANDO':'PARADO'),g.pronto?'oktxt':'')+line('Tap padrão',g.tapMs!=null?fmtMs(g.tapMs):'—')+line('Analógico padrão',g.analogMs!=null?fmtMs(g.analogMs):'—');
    var a=(s.acoes||[]).slice(0,10);$('acoes').innerHTML=a.length?a.map(function(x){return '<div class="row"><span>'+esc(x.icone||'🎮')+'</span><b>'+esc(x.usuario||'?')+'</b><span>'+esc(x.rotulo||x.botao||'?')+'</span><span class="muted">'+esc(x.tipo||'tap')+'</span><span class="time">'+new Date(x.ts||Date.now()).toLocaleTimeString()+'</span></div>'}).join(''):'<div class="empty">Nenhuma ação ainda.</div>';
    var logs=(d.logs||[]).slice(0,10);$('logs').innerHTML=logs.length?logs.map(function(x){var cls=x.nivel==='erro'?'err':'warnrow';return '<div class="row '+cls+'"><b>'+esc(String(x.nivel||'').toUpperCase())+'</b><span>'+esc(x.mensagem||'')+'</span><span class="time">'+new Date(x.ts||Date.now()).toLocaleTimeString()+'</span></div>'}).join(''):'<div class="empty">Sem avisos recentes. Ótimo sinal.</div>';
  }
  function ciclo(){fetch('/api/estado',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(render).catch(function(){var el=$('sync');el.className='pill bad';el.innerHTML='<span class="dot"></span> sem resposta';})}
  ciclo();setInterval(ciclo,750);
})();
</script>
</body>
</html>`;

module.exports = { PAGINA_DASHBOARD };
