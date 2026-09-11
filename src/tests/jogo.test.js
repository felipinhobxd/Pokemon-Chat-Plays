/**
 * Testes do gerenciador de jogo (v2.7) — caminhos, linha de comando,
 * decisão de reabertura (anti crash-loop) e watchdog com processo real.
 *
 * O "jogo" dos testes é um script node que morre sozinho em ~150ms —
 * assim o watchdog é exercitado de verdade (spawn → exit → reabrir →
 * desistir) sem depender de emulador.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const jogo = require('../utils/jogo');

/** Espera uma condição virar verdadeira (poll de 25ms). */
function esperar(cond, limiteMs = 8000, msg = 'condição') {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok;
      try { ok = cond(); } catch (e) { reject(e); return; }
      if (ok) { resolve(); return; }
      if (Date.now() - inicio > limiteMs) {
        reject(new Error(`Timeout esperando: ${msg}`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// normalizarCaminhoJogo — colagem suja do Windows/chat vira caminho limpo
// ---------------------------------------------------------------------------

test('normalizarCaminhoJogo: tira aspas, espaços, CR/LF e barras duplas', () => {
  assert.strictEqual(jogo.normalizarCaminhoJogo('  "C:\\Games\\vbam.exe"  '), 'C:\\Games\\vbam.exe');
  assert.strictEqual(jogo.normalizarCaminhoJogo("'C:/x/y.exe'"), 'C:/x/y.exe');
  assert.strictEqual(jogo.normalizarCaminhoJogo('C:\\Games\\\\vbam.exe\r\n'), 'C:\\Games\\vbam.exe');
  assert.strictEqual(jogo.normalizarCaminhoJogo('  '), '');
  assert.strictEqual(jogo.normalizarCaminhoJogo(null), '');
  assert.strictEqual(jogo.normalizarCaminhoJogo(undefined), '');
});

// ---------------------------------------------------------------------------
// dividirArgs — respeita aspas no meio do caminho (ROM com espaço)
// ---------------------------------------------------------------------------

test('dividirArgs: separa por espaço mas respeita aspas', () => {
  assert.deepStrictEqual(jogo.dividirArgs(''), []);
  assert.deepStrictEqual(jogo.dividirArgs(null), []);
  assert.deepStrictEqual(jogo.dividirArgs('-L "C:\\cores\\mgba.dll" --fullscreen'), ['-L', 'C:\\cores\\mgba.dll', '--fullscreen']);
  assert.deepStrictEqual(jogo.dividirArgs("-L 'core gba.dll'"), ['-L', 'core gba.dll']);
  assert.deepStrictEqual(jogo.dividirArgs('a b  c'), ['a', 'b', 'c']);
});

// ---------------------------------------------------------------------------
// montarLinhaComando — exe + ROM + args na ordem certa
// ---------------------------------------------------------------------------

test('montarLinhaComando: exe com ROM e args extras na ordem', () => {
  const r = jogo.montarLinhaComando({
    exe: 'C:\\Emus\\vbam.exe',
    rom: 'C:\\Games\\Pokemon - Esmeralda.gba',
    args: '--fullscreen --scale=3',
  });
  assert.strictEqual(r.file, 'C:\\Emus\\vbam.exe');
  assert.deepStrictEqual(r.args, [
    'C:\\Games\\Pokemon - Esmeralda.gba',
    '--fullscreen',
    '--scale=3',
  ]);
  assert.ok(r.cwd && r.cwd.length > 0, 'cwd = pasta do exe');
});

test('montarLinhaComando: sem ROM e sem args fica só o exe (Minecraft)', () => {
  const r = jogo.montarLinhaComando({ exe: 'C:\\Games\\minecraft.exe' });
  assert.strictEqual(r.file, 'C:\\Games\\minecraft.exe');
  assert.deepStrictEqual(r.args, []);
});

// ---------------------------------------------------------------------------
// avaliarQueda — o cérebro do watchdog (PURO)
// ---------------------------------------------------------------------------

const QUEDA_BASE = {
  autoReiniciar: true,
  encerrando: false,
  desistiu: false,
  viveuMs: 60000,
  tentativas: 0,
  tentativasMax: 5,
  vidaMinimaMs: 15000,
};

test('avaliarQueda: jogo saudável que fechou → reabrir e zerar contador', () => {
  const r = jogo.avaliarQueda({ ...QUEDA_BASE, viveuMs: 3600000, tentativas: 3 });
  assert.strictEqual(r.acao, 'reabrir');
  assert.strictEqual(r.tentativas, 0, 'rodada longa reseta as quedas rápidas');
});

test('avaliarQueda: queda rápida incrementa contador', () => {
  const r = jogo.avaliarQueda({ ...QUEDA_BASE, viveuMs: 2000, tentativas: 2 });
  assert.strictEqual(r.acao, 'reabrir');
  assert.strictEqual(r.tentativas, 3);
});

test('avaliarQueda: teto de quedas rápidas → desistir (anti crash-loop)', () => {
  const r = jogo.avaliarQueda({ ...QUEDA_BASE, viveuMs: 100, tentativas: 4, tentativasMax: 5 });
  assert.strictEqual(r.acao, 'desistir');
  assert.strictEqual(r.tentativas, 5);
});

test('avaliarQueda: bot encerrando nunca reabre', () => {
  const r = jogo.avaliarQueda({ ...QUEDA_BASE, encerrando: true, viveuMs: 100 });
  assert.strictEqual(r.acao, 'nada');
});

test('avaliarQueda: autoReiniciar desligado não reabre', () => {
  const r = jogo.avaliarQueda({ ...QUEDA_BASE, autoReiniciar: false, viveuMs: 100 });
  assert.strictEqual(r.acao, 'nada');
});

test('avaliarQueda: já desistiu → nada', () => {
  const r = jogo.avaliarQueda({ ...QUEDA_BASE, desistiu: true });
  assert.strictEqual(r.acao, 'nada');
});

// ---------------------------------------------------------------------------
// nomeDoProcesso / contarLinhasDeProcesso
// ---------------------------------------------------------------------------

test('nomeDoProcesso: basename em caminho Windows e Unix', () => {
  assert.strictEqual(jogo.nomeDoProcesso('C:\\Users\\Admin\\Downloads\\visualboyadvance-m-Win-x86_64\\visualboyadvance-m.exe'), 'visualboyadvance-m.exe');
  assert.strictEqual(jogo.nomeDoProcesso('/usr/bin/mgba'), 'mgba');
  assert.strictEqual(jogo.nomeDoProcesso(''), '');
});

test('contarLinhasDeProcesso: CSV do tasklist — cabeçalho sozinho = parado', () => {
  const cabecalho = '"Image Name","PID","Session Name","Session#","Mem Usage"\r\n';
  const rodando = cabecalho + '"visualboyadvance-m.exe","1234","Console","1","45.678 K"\r\n';
  const infoLocalizado = 'INFO: No tasks are running which match the specified criteria.\r\n';
  assert.strictEqual(jogo.contarLinhasDeProcesso(cabecalho), 1, 'só cabeçalho');
  assert.strictEqual(jogo.contarLinhasDeProcesso(rodando), 2, 'cabeçalho + processo');
  assert.strictEqual(jogo.contarLinhasDeProcesso(infoLocalizado), 0, 'INFO não tem aspas');
  assert.strictEqual(jogo.contarLinhasDeProcesso(''), 0);
});

// ---------------------------------------------------------------------------
// Watchdog de verdade: script node que morre sozinho = "jogo"
// ---------------------------------------------------------------------------

/** Cria um "jogo" que morre sozinho depois de X ms. */
function criarJogoFalso(vidaMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-jogo-'));
  const arquivo = path.join(dir, 'jogo.js');
  fs.writeFileSync(arquivo, `setTimeout(() => process.exit(0), ${vidaMs});\n`);
  return arquivo;
}

test('watchdog: jogo que morre rápido repetidamente → reabre e DESISTE no teto', async () => {
  const jogoJs = criarJogoFalso(120); // morre em ~120ms (vida "rápida")
  const eventos = [];
  jogo.__resetTeste();
  jogo.configurar({
    exe: process.execPath,
    args: `"${jogoJs}"`,
    autoReiniciar: true,
    delayMs: 40,
    tentativasMax: 3,
    vidaMinimaMs: 60000, // tudo morre "rápido"
    detector: () => false, // nunca "já rodando" — força o spawn
    aoEvento: (ev) => eventos.push(ev.tipo),
  });

  const r = await jogo.iniciar();
  assert.strictEqual(r.modo, 'spawn', 'abriu como filho');

  await esperar(() => jogo.status().desistiu, 10000, 'desistir do crash loop');

  const st = jogo.status();
  assert.strictEqual(st.tentativas, 3, 'contou as 3 quedas rápidas');
  assert.strictEqual(st.reinicios, 2, 'reabriu 2x (3ª queda = desistiu)');
  assert.ok(!st.rodando, 'parou de rodar');
  assert.ok(eventos.includes('reabrindo'), 'avisou que estava reabrindo');
  assert.ok(eventos.includes('desistiu'), 'avisou que desistiu');

  jogo.parar();
});

test('watchdog: parar() impede a reabertura programada', async () => {
  const jogoJs = criarJogoFalso(80);
  jogo.__resetTeste();
  jogo.configurar({
    exe: process.execPath,
    args: `"${jogoJs}"`,
    autoReiniciar: true,
    delayMs: 4000, // reabertura longe
    detector: () => false,
  });

  await jogo.iniciar();
  await esperar(() => !jogo.status().rodando, 5000, 'jogo falso morrer');
  jogo.parar(); // mata o timer de reabrir

  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(jogo.status().reinicios, 0, 'não reabriu após parar()');
});

test('watchdog: jogo fechou com autoReiniciar=false → não reabre nem desiste', async () => {
  const jogoJs = criarJogoFalso(80);
  jogo.__resetTeste();
  jogo.configurar({
    exe: process.execPath,
    args: `"${jogoJs}"`,
    autoReiniciar: false,
    delayMs: 40,
    detector: () => false,
  });

  await jogo.iniciar();
  await esperar(() => !jogo.status().rodando, 5000, 'jogo falso morrer');
  await new Promise((r) => setTimeout(r, 120));

  const st = jogo.status();
  assert.strictEqual(st.reinicios, 0);
  assert.ok(!st.desistiu, 'sem auto-reinício não há crash-loop');
});

test('iniciar: jogo JÁ rodando → modo anexar (não abre 2ª instância)', async () => {
  jogo.__resetTeste();
  jogo.configurar({
    exe: 'C:\\Emus\\vbam.exe',
    detector: () => true, // "está rodando"
  });
  const r = await jogo.iniciar();
  assert.strictEqual(r.modo, 'anexar');
  assert.strictEqual(r.ok, true);
  assert.ok(jogo.status().rodando, 'status enxerga como rodando');
  jogo.parar();
});

test('status(): reflete config e não explode sem nada configurado', () => {
  jogo.__resetTeste();
  const st = jogo.status();
  assert.strictEqual(st.ativo, false);
  assert.strictEqual(st.modo, 'off');
  assert.strictEqual(st.romNome, '');
  jogo.configurar({ exe: 'C:\\a\\vbam.exe', rom: 'C:\\r\\Pokemon.gba' });
  const st2 = jogo.status();
  assert.strictEqual(st2.romNome, 'Pokemon.gba');
  assert.strictEqual(st2.nome, 'vbam.exe');
  assert.strictEqual(st2.tentativasMax, 5);
});
