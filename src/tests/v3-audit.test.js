const test = require('node:test');
const assert = require('node:assert');

const handlers = require('../handlers');
const jogo = require('../utils/jogo');
const overlay = require('../overlay');
const votacao = require('../utils/votacao');
const pausa = require('../utils/pausa');
const controles = require('../controles');
const { testarComando } = require('../testar-comando');
const perfis = require('../perfis');
const teclado = require('../controllers/keyboard');

test('v3 identity: stable actor is namespaced by platform and ID', () => {
  assert.strictEqual(handlers.identidadeAtor({ plataforma: 'youtube', usuario: 'same', usuarioId: 'UC123' }), 'youtube:uc123');
  assert.strictEqual(handlers.identidadeAtor({ plataforma: 'twitch', usuario: 'same', usuarioId: '42' }), 'twitch:42');
  assert.notStrictEqual(
    handlers.identidadeAtor({ plataforma: 'youtube', usuario: 'same', usuarioId: '42' }),
    handlers.identidadeAtor({ plataforma: 'twitch', usuario: 'same', usuarioId: '42' })
  );
});

test('v3 privilege: YouTube displayName cannot impersonate Twitch broadcaster', () => {
  const { config } = require('../config');
  const antes = config.twitch.channel;
  config.twitch.channel = 'sindromegames';
  try {
    assert.strictEqual(handlers.ehStreamerContexto({ plataforma: 'youtube', usuario: 'sindromegames' }), false);
    assert.strictEqual(handlers.ehStreamerContexto({ plataforma: 'youtube', usuario: 'qualquer', broadcaster: true }), true);
    assert.strictEqual(handlers.ehStreamerContexto({ plataforma: 'twitch', usuario: 'sindromegames' }), true);
  } finally { config.twitch.channel = antes; }
});

test('v3 UNC: normalização preserva prefixo de rede', () => {
  const entrada = '\\\\servidor\\share\\Pasta\\Game.exe';
  assert.strictEqual(jogo.normalizarCaminhoJogo(entrada), entrada);
});

test('v3 overlay: Host/Origin externos são rejeitados e localhost aceito', () => {
  assert.strictEqual(overlay.__test.hostPermitido({ headers: { host: 'localhost:8899' } }), true);
  assert.strictEqual(overlay.__test.hostPermitido({ headers: { host: 'evil.example:8899' } }), false);
  assert.strictEqual(overlay.__test.origemPermitida({ headers: { origin: 'http://127.0.0.1:8899' } }), true);
  assert.strictEqual(overlay.__test.origemPermitida({ headers: { origin: 'https://evil.example' } }), false);
});

test('v3 mode majority: majority-chat obeys anti flip-flop interval', () => {
  votacao.resetar();
  votacao.configurar({ intervaloMs: 1000, trocaMinMs: 60000 });
  assert.strictEqual(votacao.definirModo('democracia', 'tecla streamer').mudou, true);
  assert.strictEqual(votacao.votarModo('anarquia', 'twitch:1').mudou, false);
  const r = votacao.votarModo('anarquia', 'twitch:2');
  assert.strictEqual(r.mudou, false);
  assert.strictEqual(r.motivo, 'troca recente');
  votacao.resetar();
});

test('v3 tester: mouse-pos usa xPct/yPct e respeita gates do runtime', () => {
  const r = testarComando('mouse 25 75', undefined, { modoMouse: 'off', alvoExe: 'C:\\Game\\game.exe' });
  assert.strictEqual(r.reconhecido, true);
  assert.ok(r.detalhes.some((x) => x.includes('25%') && x.includes('75%')));
  assert.strictEqual(r.executaria, false);
});

test('v3 tester: gamepad desligado/democracia não é descrito como execução direta', () => {
  assert.strictEqual(testarComando('pad a', undefined, { gamepadEnabled: 'off' }).executaria, false);
  assert.strictEqual(testarComando('pad a', undefined, { gamepadEnabled: 'auto', democracia: true }).executaria, false);
});

test('v3 profiles: gamepad mode/timings belong to profile but DLL path does not', () => {
  assert.ok(perfis.CHAVES_PERFIL.includes('GAMEPAD_ENABLED'));
  assert.ok(perfis.CHAVES_PERFIL.includes('GAMEPAD_TAP_MS'));
  assert.ok(perfis.CHAVES_PERFIL.includes('GAMEPAD_ANALOG_MS'));
  assert.ok(!perfis.CHAVES_PERFIL.includes('GAMEPAD_VIGEM_DLL'));
});

test('v3 panic queue: cancellable taps can be purged and priority goes to front', () => {
  const q = teclado.__test.fila;
  q.limpar();
  // Block processing flag via first action that never concludes, then queue distinct actions.
  q.enfileirar(() => {});
  q.enfileirar(() => {}, true);
  q.enfileirar(() => {}, { descartavel: false });
  q.enfileirar(() => {}, { descartavel: false, prioridade: true });
  const antes = q.inspecaoDetalhada();
  assert.strictEqual(antes[0].prioridade, true);
  assert.ok(q.inspecao().includes('toque'));
  assert.strictEqual(q.cancelarToquesPendentes(), 1);
  assert.ok(q.inspecao().every((x) => x !== 'toque'));
  q.limpar();
});

// ---------------------------------------------------------------------------
// v3.0.1: regressões de auditoria de release
// ---------------------------------------------------------------------------

test('v3.0.1 gamepad pipeline: "pad" durante PAUSA não lança exceção (config ausente)', () => {
  const gamepadIntegration = require('../gamepad-integration');
  gamepadIntegration.instalar();
  pausa.definir(true, 'teste');
  try {
    assert.doesNotThrow(() => {
      handlers.processarMensagem({ plataforma: 'twitch', usuario: 'alguem', usuarioId: '7', broadcaster: false, texto: 'pad a' });
    });
  } finally {
    pausa.definir(false, 'teste');
  }
});

test('v3.0.1 gamepad pipeline: "pad" em DEMOCRACIA não lança exceção nem executa', () => {
  const gamepadIntegration = require('../gamepad-integration');
  gamepadIntegration.instalar();
  votacao.resetar();
  votacao.definirModo('democracia', 'teste');
  try {
    assert.doesNotThrow(() => {
      handlers.processarMensagem({ plataforma: 'youtube', usuario: 'alguem', usuarioId: 'UC9', broadcaster: false, texto: 'pad a' });
    });
    // em democracia o gamepad é bloqueado: nenhum voto de botão contabilizado
    const st = votacao.status();
    assert.strictEqual(st.totalVotantes, 0);
  } finally {
    votacao.resetar();
  }
});

test('v3.0.1 dialogo em democracia: voto usa identidade estável, não displayName', () => {
  votacao.resetar();
  votacao.definirModo('democracia', 'teste');
  try {
    // Dois usuários DIFERENTES do YouTube com o MESMO displayName: 2 votos.
    // (Com displayName como chave, o segundo voto era ignorado como
    // "mesmo usuário" — e displayNames do YouTube podem colidir.)
    handlers.processarMensagem({ plataforma: 'youtube', usuario: 'Nome Igual', usuarioId: 'UC1', broadcaster: false, texto: 'dialogo' });
    handlers.processarMensagem({ plataforma: 'youtube', usuario: 'Nome Igual', usuarioId: 'UC2', broadcaster: false, texto: 'dialogo' });
    const st = votacao.status();
    assert.strictEqual(st.totalVotantes, 2);
    const candidatoA = st.candidatos.find((c) => c.botao === 'a');
    assert.strictEqual(candidatoA ? candidatoA.votos : 0, 2);
    // repetir o voto do MESMO usuário é idempotente (não soma)
    handlers.processarMensagem({ plataforma: 'youtube', usuario: 'Nome Igual', usuarioId: 'UC1', broadcaster: false, texto: 'dialogo' });
    const st2 = votacao.status();
    assert.strictEqual(st2.totalVotantes, 2);
    const a2 = st2.candidatos.find((c) => c.botao === 'a');
    assert.strictEqual(a2 ? a2.votos : 0, 2);
  } finally {
    votacao.resetar();
  }
});

test('v3.0.1 aliases: palavras exatas dos namespaces mouse/macro são reservadas', () => {
  // 'clique'/'dialogo' etc. são comandos que o runtime resolve ANTES do
  // registro de controles — o assistente precisa recusir o alias na origem.
  const lista = [{ label: 'Tiro', key: 'f', aliases: ['clique', 'tiro'] }];
  const v = controles.validarLista(lista);
  assert.ok(v.erros.some((e) => e.includes('"clique"') && e.includes('reservada')));
  assert.ok(!v.erros.some((e) => e.includes('"tiro"')));

  const lista2 = [{ label: 'Macro', key: 'f', aliases: ['dialogo'] }];
  const v2 = controles.validarLista(lista2);
  assert.ok(v2.erros.some((e) => e.includes('"dialogo"') && e.includes('reservada')));

  // o wizard recebe a lista reservada do servidor (espelho em tempo real)
  assert.ok(controles.RESERVADOS.has('dialogo'));
  assert.ok(controles.RESERVADOS.has('right click'));
});
