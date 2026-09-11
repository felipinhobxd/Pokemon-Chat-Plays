'use strict';

const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { criarStore } = require('./perfis');

function resumoPerfil(p) {
  const v = p.valores || {};
  const jogo = v.JOGO_ROM || v.EMULADOR_EXE || '(sem executavel/ROM)';
  const teclado = v.MODO_TECLADO || 'janela';
  const mouse = v.MODO_MOUSE || teclado;
  return `${p.ativo ? '*' : ' '} ${p.nome}  |  ${jogo}  | teclado=${teclado} mouse=${mouse}`;
}

function imprimir(store) {
  const perfis = store.listar();
  console.log('\n==========================================');
  console.log('  ChatPlays - Perfis por jogo');
  console.log('==========================================\n');
  perfis.forEach((p, i) => console.log(`${i + 1}. ${resumoPerfil(p)}`));
  console.log('\nEscolha:');
  console.log('  numero = ativar perfil');
  console.log('  N = novo perfil usando a configuracao atual');
  console.log('  D = duplicar o perfil ativo');
  console.log('  R = renomear o perfil ativo');
  console.log('  X = excluir um perfil inativo');
  console.log('  Q = continuar com o perfil ativo');
  return perfis;
}

async function executar(store = criarStore(), opcoes = {}) {
  store.garantirInicial();

  if (!input.isTTY || !output.isTTY) {
    const perfis = store.listar();
    console.log('[Perfis] Perfis disponiveis:');
    perfis.forEach((p) => console.log(`  ${resumoPerfil(p)}`));
    console.log('[Perfis] Para ativar sem menu: ChatPlays.exe --perfil "Nome do perfil"');
    return { ok: true, ativo: store.ativo() };
  }

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const perfis = imprimir(store);
      const resposta = (await rl.question('\n> ')).trim();
      const cmd = resposta.toLowerCase();

      if (!resposta || cmd === 'q' || cmd === 'sair' || cmd === 'continuar') {
        break;
      }

      const numero = Number.parseInt(resposta, 10);
      if (Number.isInteger(numero) && numero >= 1 && numero <= perfis.length) {
        const escolhido = perfis[numero - 1];
        const r = store.ativar(escolhido.id);
        if (r.ok) {
          console.log(`\n[Perfis] OK: "${r.perfil.nome}" agora e o perfil ativo.`);
          if (opcoes.sairAoAtivar) break;
        } else {
          console.log(`\n[Perfis] ERRO: ${r.motivo}`);
        }
        continue;
      }

      if (cmd === 'n' || cmd === 'novo') {
        const nome = (await rl.question('Nome do novo perfil: ')).trim();
        if (!nome) continue;
        // Mantem o perfil antigo atualizado antes de criar uma copia do estado atual.
        store.sincronizarAtivo();
        const r = store.criar(nome, store.snapshotAtual(), { ativar: true });
        console.log(r.ok
          ? `\n[Perfis] Criado e ativado: "${r.perfil.nome}".`
          : `\n[Perfis] ERRO: ${r.motivo}`);
        continue;
      }

      if (cmd === 'd' || cmd === 'duplicar') {
        const atual = store.ativo();
        if (!atual) continue;
        const nome = (await rl.question(`Nome da copia de "${atual.nome}": `)).trim();
        if (!nome) continue;
        store.sincronizarAtivo();
        const atualizado = store.ativo();
        const r = store.criar(
          nome,
          { valores: atualizado.valores, controles: atualizado.controles },
          { ativar: false }
        );
        console.log(r.ok
          ? `\n[Perfis] Copia criada: "${r.perfil.nome}".`
          : `\n[Perfis] ERRO: ${r.motivo}`);
        continue;
      }

      if (cmd === 'r' || cmd === 'renomear') {
        const atual = store.ativo();
        if (!atual) continue;
        const nome = (await rl.question(`Novo nome para "${atual.nome}": `)).trim();
        if (!nome) continue;
        const r = store.renomear(atual.id, nome);
        console.log(r.ok
          ? `\n[Perfis] Renomeado para "${r.perfil.nome}".`
          : `\n[Perfis] ERRO: ${r.motivo}`);
        continue;
      }

      if (cmd === 'x' || cmd === 'excluir') {
        const lista = store.listar();
        const ref = (await rl.question('Numero do perfil INATIVO para excluir: ')).trim();
        const n = Number.parseInt(ref, 10);
        if (!Number.isInteger(n) || n < 1 || n > lista.length) {
          console.log('\n[Perfis] Numero invalido.');
          continue;
        }
        const escolhido = lista[n - 1];
        const r = store.excluir(escolhido.id);
        console.log(r.ok
          ? `\n[Perfis] Perfil "${escolhido.nome}" excluido.`
          : `\n[Perfis] ERRO: ${r.motivo}`);
        continue;
      }

      console.log('\n[Perfis] Opcao invalida.');
    }
  } finally {
    rl.close();
  }

  return { ok: true, ativo: store.ativo() };
}

if (require.main === module) {
  executar().catch((err) => {
    console.error(`[Perfis] ERRO: ${err?.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { executar, resumoPerfil };
