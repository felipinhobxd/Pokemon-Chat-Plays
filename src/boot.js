/**
 * Entry point de produção do ChatPlays.
 *
 * A ordem aqui é intencional:
 *  1. perfis por jogo são resolvidos ANTES de config/teclado serem importados;
 *  2. SaveGuard envolve o teclado;
 *  3. gamepad virtual entra no pipeline depois das proteções do teclado;
 *  4. só então o app principal é carregado.
 *
 * Assim `--perfil "Pokemon Emerald"` consegue trocar .env/controles antes de
 * qualquer módulo congelar a configuração em memória.
 */

async function prepararPerfis() {
  const perfis = require('./perfis');
  const store = perfis.criarStore();
  const inicial = store.garantirInicial();

  if (inicial.criado) {
    const ativo = store.ativo();
    console.log(`[Perfis] Primeiro perfil criado automaticamente: "${ativo?.nome || 'Padrao'}".`);
  }

  if (process.argv.includes('--perfis')) {
    const { executar } = require('./perfis-cli');
    await executar(store);
    const ativo = store.ativo();
    if (ativo) console.log(`[Perfis] Continuando com: "${ativo.nome}".`);
    return;
  }

  const pedido = perfis.argumentoPerfil(process.argv.slice(2));
  if (pedido) {
    const r = store.ativar(pedido);
    if (!r.ok) {
      console.warn(`[Perfis] Nao consegui ativar "${pedido}": ${r.motivo}.`);
      console.warn('[Perfis] Use --perfis para ver os perfis disponiveis.');
    } else {
      console.log(`[Perfis] Perfil ativo: "${r.perfil.nome}"${r.jaAtivo ? ' (ja estava ativo)' : ''}.`);
    }
    return;
  }

  const sync = store.sincronizarAtivo();
  if (sync.ok && sync.perfil) {
    console.log(`[Perfis] Perfil lembrado: "${sync.perfil.nome}".`);
  }
}

(async () => {
  await prepararPerfis();

  const teclado = require('./controllers/keyboard');
  const saveGuard = require('./controllers/save-guard');
  saveGuard.instalar(teclado);

  const gamepadIntegration = require('./gamepad-integration');
  gamepadIntegration.instalar();

  require('./index');
})().catch((err) => {
  console.error(`[Boot] Falha antes de iniciar o ChatPlays: ${err?.stack || err}`);
  process.exitCode = 1;
});
