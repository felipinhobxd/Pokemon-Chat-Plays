#!/usr/bin/env node
/**
 * Roda os testes com `node --test` de forma compativel com QUALQUER versao do
 * Node (18, 20, 22, 24+).
 *
 * Motivo: o runner de testes muda o comportamento dos argumentos conforme a
 * versao — Node 18 aceita diretorios mas nao globs; Node 21+ aceita globs
 * nativos mas trata caminho sem glob como modulo literal. Passar a LISTA
 * EXPLICITA de arquivos .test.js funciona em todas as versoes.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDir = path.resolve(__dirname, '..', 'src', 'tests');

let files;
try {
  files = fs
    .readdirSync(testDir)
    .filter((f) => f.endsWith('.test.js'))
    .sort()
    .map((f) => path.join(testDir, f));
} catch {
  console.error(`ERRO: diretorio de testes nao encontrado: ${testDir}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error('ERRO: nenhum arquivo *.test.js encontrado em src/tests/');
  process.exit(1);
}

console.log(`Executando ${files.length} arquivo(s) de teste com node --test...`);

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
