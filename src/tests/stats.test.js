/**
 * Testes das stats persistentes (src/utils/stats.js).
 * Usa instâncias ISOLADAS da classe (não o singleton) + diretório
 * temporário — nada vaza para o ambiente de testes.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StatsManager } = require('../utils/stats');

function dirTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-stats-'));
}

test('configurarArquivo em arquivo novo: carregou=false, salva ao registrar', () => {
  const dir = dirTemp();
  const arquivo = path.join(dir, 'stats.json');
  const s = new StatsManager();

  const carregou = s.configurarArquivo(arquivo);
  assert.strictEqual(carregou, false, 'arquivo ainda não existe');

  assert.strictEqual(s.salvar(), false, 'sem mudanças não salva');

  s.registrar('up', 'twitch', 'ana');
  s.registrar('a', 'twitch', 'bia');
  s.registrar('hold up', 'youtube', 'ana');
  assert.strictEqual(s.salvar(), true);
  assert.ok(fs.existsSync(arquivo), 'arquivo criado no disco');
  assert.strictEqual(s.salvar(), false, 'após salvar não está mais sujo');

  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.strictEqual(bruto.total, 3);
  assert.strictEqual(bruto.usuarios.ana, 2);
  assert.strictEqual(bruto.holds, 1);
});

test('histórico sobrevive a um restart (nova instância carrega tudo)', () => {
  const dir = dirTemp();
  const arquivo = path.join(dir, 'stats.json');

  const s1 = new StatsManager();
  s1.configurarArquivo(arquivo);
  for (let i = 0; i < 5; i++) s1.registrar('up', 'twitch', 'campea');
  s1.registrar('start', 'twitch', 'eterno');
  s1.registrar('soltar', 'twitch', 'eterno');
  s1.salvar();

  const s2 = new StatsManager();
  const carregou = s2.configurarArquivo(arquivo);
  assert.strictEqual(carregou, true);

  const resumo = s2.resumo();
  assert.strictEqual(resumo.total, 7);
  assert.strictEqual(resumo.holds, 0);
  assert.strictEqual(resumo.soltas, 1);
  assert.strictEqual(resumo.jogadores, 2);
  assert.strictEqual(resumo.topUsuarios[0].nome, 'campea');
  assert.strictEqual(resumo.topUsuarios[0].comandos, 5);

  // novo comando some ao histórico carregado, não substitui
  s2.registrar('up', 'twitch', 'campea');
  assert.strictEqual(s2.resumo().total, 8);
});

test('uptime acumulada entre sessões é somada no resumo', () => {
  const dir = dirTemp();
  const arquivo = path.join(dir, 'stats.json');

  const s1 = new StatsManager();
  s1.configurarArquivo(arquivo);
  s1.uptimeAcumuladoMin = 90; // simula 1h30 de live anterior
  s1.inicio = Date.now() - 120000; // 2 min de sessão atual
  s1.registrar('up', 'twitch', 'x');
  s1.salvar();

  const s2 = new StatsManager();
  s2.configurarArquivo(arquivo);
  assert.strictEqual(s2.uptimeAcumuladoMin, 92, '90 da sessão passada + 2 da atual');
  assert.ok(s2.resumo().uptimeMin >= 92);
});

test('arquivo corrompido não derruba o app (começa do zero)', () => {
  const dir = dirTemp();
  const arquivo = path.join(dir, 'stats.json');
  fs.writeFileSync(arquivo, 'isto não é JSON{');

  const s = new StatsManager();
  const carregou = s.configurarArquivo(arquivo);
  assert.strictEqual(carregou, false);
  assert.strictEqual(s.resumo().total, 0);

  // e o arquivo inválido é sobrescrito na primeira gravação
  s.registrar('a', 'twitch', 'alguem');
  s.salvar();
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.strictEqual(bruto.total, 1);
});

test('JSON com valores absurdos é sanitizado no carregamento', () => {
  const dir = dirTemp();
  const arquivo = path.join(dir, 'stats.json');
  fs.writeFileSync(arquivo, JSON.stringify({
    comandos: { up: '10', down: -3 },
    usuarios: { ana: 4, '': 9 },
    total: 'não numérico',
    holds: 2,
  }));

  const s = new StatsManager();
  const carregou = s.configurarArquivo(arquivo);
  assert.strictEqual(carregou, true);
  assert.strictEqual(s.comandos.get('up'), 10, 'número em texto vira número');
  assert.strictEqual(s.comandos.has('down'), false, 'negativo é descartado');
  assert.strictEqual(s.usuarios.has(''), false, 'chave vazia é descartada');
  assert.strictEqual(s.total, 0, 'total inválido vira 0');
  assert.strictEqual(s.holds, 2);
});
