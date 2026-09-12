'use strict';

/**
 * Testes de empacotamento (v3.3.1).
 *
 * Motivação: a v3.3.0 saiu com docs/MINECRAFT-ATLAUNCHER.md citado no README
 * mas AUSENTE do ZIP e do instalador — as listas de arquivos de
 * scripts/build.js, installer.nsi e .github/workflows/build-release.yml
 * tinham ficado dessincronizadas.
 *
 * Regra protegida aqui: TODO .md de docs/ (documentação de usuário) precisa
 * (1) ser copiado pelo build; (2) ser instalado E removido pelo NSIS;
 * (3) ser verificado DENTRO do ZIP real e no smoke test silencioso do
 * instalador, ambos no workflow de release. E qualquer doc CITADO no README
 * precisa existir no repositório.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Todos os .md de documentação do repositório. */
function docsDoRepo() {
  return fs.readdirSync(path.join(ROOT, 'docs'))
    .filter((n) => n.endsWith('.md'))
    .sort();
}

/** Docs .md citados pelo README como docs/<NOME>.md. */
function docsCitadosNoReadme() {
  const achados = new Set();
  for (const m of ler('README.md').matchAll(/\((?:\.\/)?docs\/([A-Za-z0-9._-]+\.md)\)/g)) {
    achados.add(m[1]);
  }
  return [...achados].sort();
}

test('empacotamento: docs citados no README existem no repositório', () => {
  const citados = docsCitadosNoReadme();
  assert.ok(citados.includes('MINECRAFT-ATLAUNCHER.md'), 'README deve citar o doc do Minecraft');
  for (const doc of citados) {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'docs', doc)),
      `README cita docs/${doc} mas o arquivo não existe`
    );
  }
});

test('empacotamento: TODO doc do repositório vai no build, no instalador e nas verificações', () => {
  const docs = docsDoRepo();
  assert.ok(docs.length >= 3, `esperado ao menos 3 docs, veio ${docs.length}`);
  const build = ler('scripts/build.js');
  const nsi = ler('installer.nsi');
  const workflow = ler('.github/workflows/build-release.yml');

  for (const doc of docs) {
    // 1) build copia para dist/docs
    assert.ok(
      build.includes(`'${doc}'`),
      `scripts/build.js não copia ${doc} para o pacote`
    );
    // 2) NSIS instala E remove (mesmo caminho aparece na seção e no desinstalador)
    const ocorrenciasNsi = nsi.split(`docs\\${doc}`).length - 1;
    assert.ok(
      ocorrenciasNsi >= 2,
      `installer.nsi cita docs\\${doc} ${ocorrenciasNsi}x — precisa instalar E remover`
    );
    // 3) workflow: assemble do staging + checagem do ZIP real + smoke test
    //    do instalador (o doc precisa aparecer nas TRÊS listas)
    const noWorkflow = workflow.split(`docs\\${doc}`).length - 1;
    assert.ok(
      noWorkflow >= 3,
      `build-release.yml cita docs\\${doc} ${noWorkflow}x — precisa estar no assemble, na checagem do ZIP E no smoke test`
    );
  }
});

test('empacotamento: o ZIP portátil inclui TODO doc via curinga, não lista fixa', () => {
  // v3.3.2: o 7z listava os docs um a um e ficou dessincronizado (a própria
  // checagem do ZIP pegou o MINECRAFT-ATLAUNCHER.md faltando). Agora o ZIP
  // carrega docs\*.md — qualquer doc novo entra sozinho e a checagem de
  // nomes (teste acima) continua garantindo a presença individual.
  const workflow = ler('.github/workflows/build-release.yml');
  const linha7z = workflow.split('\n').find((l) => l.includes('7z a -tzip'));
  assert.ok(linha7z, 'workflow precisa criar o ZIP portátil com 7z');
  assert.ok(
    /docs\\\*\.md/.test(linha7z),
    'a linha do 7z deve incluir docs\\*.md (curinga) e não uma lista fixa de docs'
  );
});

test('empacotamento: MINECRAFT-ATLAUNCHER.md específico da v3.3.1 acompanha tudo', () => {
  // regressão pontual do bug real da v3.3.0 (o genérico acima já cobre, mas o
  // nome explícito facilita achar a intenção)
  const build = ler('scripts/build.js');
  const nsi = ler('installer.nsi');
  const workflow = ler('.github/workflows/build-release.yml');
  assert.ok(build.includes('MINECRAFT-ATLAUNCHER.md'));
  assert.ok(nsi.includes('MINECRAFT-ATLAUNCHER.md'));
  assert.ok(workflow.includes('MINECRAFT-ATLAUNCHER.md'));
});
