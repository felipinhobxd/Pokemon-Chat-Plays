const test = require('node:test');
const assert = require('node:assert');

const handlers = require('../handlers');
const jogo = require('../utils/jogo');
const overlay = require('../overlay');
const votacao = require('../utils/votacao');
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
