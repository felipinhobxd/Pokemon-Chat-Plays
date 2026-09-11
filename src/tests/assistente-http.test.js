/**
 * Testes de SEGURANÇA do servidor do assistente (v2.8.1).
 *
 * Cenários que ficaram abertos até a v2.8.0 e agora são regressão:
 *  1. DNS rebinding: um domínio do atacante que resolve para 127.0.0.1
 *     falava com o wizard na MESMA origem (sem CORS para impedir) e um
 *     simples GET /api/estado levava os segredos em claro. Hoje TODO pedido
 *     valida o Host ANTES de qualquer rota.
 *  2. CSRF de site malicioso: Origin estranho era barrado só no POST;
 *     agora vale para todo método.
 *  3. Segredos nunca voltam em claro: /api/estado entrega MÁSCARAS.
 *
 * Roda contra o servidor HTTP real (porta aleatória, só 127.0.0.1).
 */

// ⚠️ ANTES de requerer qualquer módulo do app: segredo falso no env para
// provar que ele NÃO vaza nas respostas (cada arquivo roda em processo próprio).
process.env.TWITCH_BOT_USERNAME = 'bot_de_teste';
process.env.TWITCH_OAUTH_TOKEN = 'oauth:segredotestesupersecreto';
process.env.TWITCH_CHANNEL = 'canalteste';
process.env.YOUTUBE_API_KEY = 'AIzaSyCHAVEsupersecreta999';
process.env.YOUTUBE_VIDEO_ID = 'jfKfPfyJRdk';
process.env.ACTIVE_PLATFORMS = 'twitch,youtube';

// v2.9.1: controles.json isolado para esta suíte — o iniciar() do assistente
// garante a carga do registro PERSISTIDO ao subir o servidor; sem isto, um
// dados/controles.json real na pasta do repo tornaria os testes dependentes
// do estado da máquina de quem roda.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.CONTROLES_ARQUIVO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-http-')), 'controles.json');

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');

const assistente = require('../assistente');
const controles = require('../controles');
const { parseComando } = require('../commands');
const { mascararSegredo } = assistente;

const TOKEN = 'oauth:segredotestesupersecreto';
const CHAVE = 'AIzaSyCHAVEsupersecreta999';

/** Faz um pedido HTTP e resolve {status, headers, corpo}. */
function pedir(porta, caminho, opcoes = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: porta,
        path: caminho,
        method: opcoes.metodo || 'GET',
        headers: opcoes.headers || {},
      },
      (res) => {
        let corpo = '';
        res.on('data', (c) => { corpo += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo }));
      }
    );
    req.on('error', reject);
    if (opcoes.body) req.write(opcoes.body);
    req.end();
  });
}

/** Pedido cru via socket (para mandar HTTP/1.0 SEM Host — o http.ClientRequest
 *  sempre injeta Host, então aqui escrevemos o protocolo na mão). */
function pedidoSemHost(porta, caminho) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(porta, '127.0.0.1', () => {
      sock.write(`GET ${caminho} HTTP/1.0\r\n\r\n`);
    });
    let dados = '';
    sock.on('data', (c) => { dados += c; });
    sock.on('end', () => resolve(dados));
    sock.on('error', reject);
    setTimeout(() => { sock.destroy(); resolve(dados); }, 2000).unref?.();
  });
}

let porta = null;

test.before(async () => {
  porta = await assistente.iniciar(0);
  assert.ok(porta, 'servidor do assistente deveria subir');
});

test.after(async () => {
  await assistente.parar();
  try { fs.rmSync(path.dirname(process.env.CONTROLES_ARQUIVO), { recursive: true, force: true }); } catch { /* ignora */ }
});

// ---------------------------------------------------------------------------
// DNS rebinding / Host estranho — vale para GET TAMBÉM (regressão v2.8.1)
// ---------------------------------------------------------------------------

test('GET /api/estado com Host do domínio do atacante é 403 (DNS rebinding)', async () => {
  const r = await pedir(porta, '/api/estado', {
    headers: { Host: 'evil-attacker.com:8124' },
  });
  assert.strictEqual(r.status, 403, 'Host estranho tem que ser barrado ANTES da rota');
  assert.strictEqual(JSON.parse(r.corpo).ok, false);
});

test('GET /api/estado com Host localhost.evil.com é 403 (sufixo não engana)', async () => {
  const r = await pedir(porta, '/api/estado', {
    headers: { Host: 'localhost.evil.com' },
  });
  assert.strictEqual(r.status, 403);
});

test('GET / Host 127.0.0.1 (com porta) passa — é o fluxo normal', async () => {
  const r = await pedir(porta, '/', {
    headers: { Host: `127.0.0.1:${porta}` },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.corpo.includes('<!DOCTYPE html>'));
});

test('pedido HTTP/1.0 SEM Host nenhum é 403', async () => {
  const bruto = await pedidoSemHost(porta, '/api/estado');
  assert.ok(/^HTTP\/1\.[01] 403/.test(bruto), 'sem Host o servidor desconfia: ' + bruto.split('\r\n')[0]);
});

// ---------------------------------------------------------------------------
// Origin estranho — agora barrado em TODO método (regressão v2.8.1)
// ---------------------------------------------------------------------------

test('GET /api/estado com Origin de site malicioso é 403 (era liberado na v2.8.0)', async () => {
  const r = await pedir(porta, '/api/estado', {
    headers: { Origin: 'https://evil-attacker.com' },
  });
  assert.strictEqual(r.status, 403);
});

test('POST /api/salvar com Origin de site malicioso é 403 (anti-CSRF)', async () => {
  const r = await pedir(porta, '/api/salvar', {
    metodo: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil-attacker.com',
    },
    body: JSON.stringify({ twitchAtivo: true, TWITCH_OAUTH_TOKEN: 'hackeado' }),
  });
  assert.strictEqual(r.status, 403, 'CSRF contra o .env continua barrado');
  assert.ok(!r.corpo.includes('continuara'));
});

test('POST sem Origin (curl/node) com Host válido passa — ferramentas locais funcionam', async () => {
  const r = await pedir(porta, '/api/verificar-jogo', {
    metodo: 'POST',
    headers: { 'Content-Type': 'application/json', Host: `localhost:${porta}` },
    body: JSON.stringify({ EMULADOR_EXE: '', JOGO_ROM: '' }),
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(JSON.parse(r.corpo).ok, true, 'sem jogo configurado é ok');
});

test('GET /api/estado com Origin http://localhost (a própria página) passa', async () => {
  const r = await pedir(porta, '/api/estado', {
    headers: { Origin: `http://localhost:${porta}`, Host: `localhost:${porta}` },
  });
  assert.strictEqual(r.status, 200);
});

// ---------------------------------------------------------------------------
// Segredos nunca voltam em claro (regressão v2.8.1)
// ---------------------------------------------------------------------------

test('GET /api/estado devolve MÁSCARAS — o token/chave em claro não aparecem', async () => {
  const r = await pedir(porta, '/api/estado', {
    headers: { Host: `localhost:${porta}` },
  });
  assert.strictEqual(r.status, 200);
  const d = JSON.parse(r.corpo);

  // máscara correta (bolinhas + 4 últimos)
  assert.strictEqual(d.valores.TWITCH_OAUTH_TOKEN, mascararSegredo(TOKEN));
  assert.strictEqual(d.valores.YOUTUBE_API_KEY, mascararSegredo(CHAVE));
  // flags de "há valor salvo" para a página montar a dica
  assert.strictEqual(d.temTokenTwitch, true);
  assert.strictEqual(d.temChaveYoutube, true);
  // o veneno de verdade JAMAIS pode estar no corpo
  assert.ok(!r.corpo.includes(TOKEN), 'token em claro vazou no /api/estado!');
  assert.ok(!r.corpo.includes(CHAVE), 'chave da API em claro vazou no /api/estado!');
  assert.ok(!r.corpo.includes('segredotestesupersecreto'));
  assert.ok(!r.corpo.includes('CHAVEsupersecreta'));
});

test('/api/estado vai com Cache-Control: no-store e nosniff', async () => {
  const r = await pedir(porta, '/api/estado', {
    headers: { Host: `localhost:${porta}` },
  });
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
});

test('página HTML (/) tem CSP, no-store e nosniff', async () => {
  const r = await pedir(porta, '/', {
    headers: { Host: `localhost:${porta}` },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  assert.ok(String(r.headers['content-security-policy']).includes("default-src 'none'"));
});

// ---------------------------------------------------------------------------
// hostPermitido / origemPermitida — unidades puras
// ---------------------------------------------------------------------------

test('hostPermitido: aceita localhost, 127.0.0.1 e [::1], com ou sem porta', () => {
  for (const h of ['localhost', 'localhost:8124', '127.0.0.1', '127.0.0.1:8124', '[::1]', '[::1]:8124', 'LOCALHOST:8124']) {
    assert.strictEqual(
      assistente.hostPermitido({ headers: { host: h } }),
      true,
      `Host "${h}" deveria passar`
    );
  }
});

test('hostPermitido: recusa domínio estranho, sufixo parecido e Host ausente', () => {
  for (const h of ['evil.com', 'evil.com:8124', 'localhost.evil.com', '127.0.0.1.evil.com', 'evil-localhost.com', '']) {
    assert.strictEqual(
      assistente.hostPermitido({ headers: { host: h } }),
      false,
      `Host "${h}" deveria ser barrado`
    );
  }
  assert.strictEqual(assistente.hostPermitido({ headers: {} }), false, 'sem Host = recusa');
});

test('origemPermitida: sem Origin passa (curl/node); Origin local passa; resto cai', () => {
  assert.strictEqual(assistente.origemPermitida({ headers: {} }), true);
  assert.strictEqual(assistente.origemPermitida({ headers: { origin: 'http://localhost:8124' } }), true);
  assert.strictEqual(assistente.origemPermitida({ headers: { origin: 'https://127.0.0.1' } }), true);
  assert.strictEqual(assistente.origemPermitida({ headers: { origin: 'http://[::1]:8124' } }), true);
  assert.strictEqual(assistente.origemPermitida({ headers: { origin: 'null' } }), false);
  assert.strictEqual(assistente.origemPermitida({ headers: { origin: 'https://evil.com' } }), false);
  assert.strictEqual(assistente.origemPermitida({ headers: { origin: 'https://localhost.evil.com' } }), false);
});

// ---------------------------------------------------------------------------
// v2.9: controles do chat no wizard — estado, aliases e SEGURANÇA da rota nova
// ---------------------------------------------------------------------------

test('GET /api/estado entrega os controles do registro (sem segredos, claro)', async () => {
  const r = await pedir(porta, '/api/estado', {
    headers: { Host: `localhost:${porta}` },
  });
  assert.strictEqual(r.status, 200);
  const d = JSON.parse(r.corpo);
  assert.ok(Array.isArray(d.controles) && d.controles.length >= 12, 'lista de controles ausente');
  assert.strictEqual(d.origemControles, 'env');
  assert.ok(Array.isArray(d.reservados) && d.reservados.includes('hold'));
  assert.ok(Array.isArray(d.teclasValidas) && d.teclasValidas.includes('space'));
  // modelos p/ o botão "Aplicar modelo"
  for (const m of ['vbam', 'mgba', 'desmume', 'retroarch']) {
    assert.ok(Array.isArray(d.modelos[m]) && d.modelos[m].length === 12, `modelo ${m} ausente`);
  }
  // controles não são segredo — mas o corpo continua sem os segredos
  assert.ok(!r.corpo.includes(TOKEN));
  assert.ok(!r.corpo.includes(CHAVE));
});

test('POST /api/gerar-aliases sugere palavras PT/EN a partir da tecla', async () => {
  const r = await pedir(porta, '/api/gerar-aliases', {
    metodo: 'POST',
    headers: { 'Content-Type': 'application/json', Host: `localhost:${porta}` },
    body: JSON.stringify({ chave: 'space', rotulo: 'Pular' }),
  });
  assert.strictEqual(r.status, 200);
  const d = JSON.parse(r.corpo);
  assert.deepStrictEqual(d.aliases, ['pular', 'space', 'espaco', 'barra de espaco']);
});

test('POST /api/gerar-aliases com Host/Origin do atacante é 403 (rota nova segue as regras)', async () => {
  const r = await pedir(porta, '/api/gerar-aliases', {
    metodo: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: 'evil-attacker.com',
      Origin: 'https://evil-attacker.com',
    },
    body: JSON.stringify({ chave: 'space' }),
  });
  assert.strictEqual(r.status, 403);
});

test('POST /api/gerar-aliases sem corpo não explode (400 do JSON inválido)', async () => {
  const r = await pedir(porta, '/api/gerar-aliases', {
    metodo: 'POST',
    headers: { 'Content-Type': 'application/json', Host: `localhost:${porta}` },
    body: 'isto não é json',
  });
  assert.strictEqual(r.status, 400);
});

// ---------------------------------------------------------------------------
// REGRESSÃO v2.9.1 — o wizard entrega os controles PERSISTIDOS no boot
//
// Cenário exato do bug: o assistente abre ANTES do aplicarControles() do
// index.js. Sem a garantia de carga no iniciar(), o /api/estado mostrava o
// registro derivado do .env (preset do emulador) e um "Salvar" SEM MEXER
// sobrescrevia dados/controles.json com os padrões — apagando os controles
// personalizados do usuário. (Este teste roda por último: ele gravaria um
// .env real — em diretório isolado — e recarrega a config do processo.)
// ---------------------------------------------------------------------------

test('REGRESSÃO boot: wizard mostra controles PERSISTIDOS; salvar sem mexer NÃO os troca pelos padrão', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-wizard-boot-'));
  const arquivoControles = path.join(dir, 'controles.json');
  const controlesArquivoOriginal = process.env.CONTROLES_ARQUIVO;
  const cwdOriginal = process.cwd();
  process.env.CONTROLES_ARQUIVO = arquivoControles;
  try {
    // 1) o usuário criou um controle personalizado e SALVOU
    const salvo = controles.salvarArquivo([{ label: 'Pular', key: 'space', aliases: ['pular', 'jump'] }]);
    assert.strictEqual(salvo.ok, true, salvo.erro);

    // 2) RESTART: o módulo volta ao estado recém-carregado (derivado do .env)
    controles.restaurarPadrao();
    assert.strictEqual(controles.origem(), 'env');

    // 3) o wizard abre — iniciar() roda ANTES do aplicarControles() do boot
    await assistente.parar();
    const porta2 = await assistente.iniciar(0);
    assert.ok(porta2, 'servidor deveria subir de novo');

    // 4) a página VÊ os controles PERSISTIDOS (não os padrão do preset)
    const r = await pedir(porta2, '/api/estado', { headers: { Host: `localhost:${porta2}` } });
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.corpo);
    assert.strictEqual(d.origemControles, 'arquivo', 'wizard deveria refletir o controles.json');
    const pular = d.controles.find((c) => c.id === 'pular');
    assert.ok(pular, 'controle persistido "Pular" deveria aparecer para o usuário');
    assert.strictEqual(pular.key, 'space');
    assert.deepStrictEqual(pular.aliases, ['pular', 'jump']);

    // 5) o usuário salva SEM MEXER (a página manda o que ela mesma mostrou)
    process.chdir(dir); // .env isolado — nunca o do repositório
    const rs = await pedir(porta2, '/api/salvar', {
      metodo: 'POST',
      headers: { 'Content-Type': 'application/json', Host: `localhost:${porta2}` },
      body: JSON.stringify({
        twitchAtivo: true,
        TWITCH_BOT_USERNAME: 'bot_wizard',
        TWITCH_OAUTH_TOKEN: 'oauth:xyz123',
        TWITCH_CHANNEL: 'canal_wizard',
        controles: d.controles,
      }),
    });
    const ds = JSON.parse(rs.corpo);
    assert.strictEqual(ds.ok, true, JSON.stringify(ds.erros));

    // 6) o arquivo continua PERSONALIZADO — não virou o preset do .env
    const disco = JSON.parse(fs.readFileSync(arquivoControles, 'utf8'));
    const pular2 = disco.controles.find((c) => c.id === 'pular');
    assert.ok(pular2, '"Pular" sumiu do controles.json depois de salvar sem mexer!');
    assert.strictEqual(pular2.key, 'space');
    assert.deepStrictEqual(pular2.aliases, ['pular', 'jump']);

    // 7) RESTART de novo: o boot lê o arquivo e o parser reconhece tudo
    controles.restaurarPadrao();
    controles.inicializar();
    assert.strictEqual(parseComando('pular').botao, 'pular');
    assert.strictEqual(parseComando('jump').botao, 'pular');
    assert.strictEqual(parseComando('cima'), null, 'os padrões do preset não deveriam ter voltado');
  } finally {
    process.chdir(cwdOriginal);
    process.env.CONTROLES_ARQUIVO = controlesArquivoOriginal;
    await assistente.parar();
    fs.rmSync(dir, { recursive: true, force: true });
    controles.restaurarPadrao();
  }
});
