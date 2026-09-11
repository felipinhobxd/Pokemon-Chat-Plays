/**
 * Macro de diálogo: avança caixas de texto pressionando o botão A
 * repetidamente por alguns segundos.
 *
 * Segurança:
 *  - só uma macro pode ficar ativa por vez;
 *  - para imediatamente se o chat for pausado;
 *  - `soltar` pode cancelar a macro pelo handlers;
 *  - se o botão A não puder ser executado, a macro aborta sem insistir.
 */

const DURACAO_MS = 5000;
const INTERVALO_MS = 150;

function normalizar(texto) {
  return String(texto || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Reconhece o comando de chat sem prefixo.
 * PT-BR: dialogo / diálogo
 * EN: dialogue
 */
function ehComando(texto) {
  const t = normalizar(texto);
  return t === 'dialogo' || t === 'dialogue';
}

/**
 * Fábrica usada para deixar o relógio/agendador testáveis sem esperar 5s.
 */
function criarExecutor({
  agendar = setTimeout,
  cancelar = clearTimeout,
  agora = Date.now,
} = {}) {
  let ativo = false;
  let timer = null;
  let geracao = 0;

  function parar() {
    geracao += 1;
    ativo = false;
    if (timer !== null) {
      try { cancelar(timer); } catch { /* já finalizado */ }
      timer = null;
    }
  }

  function iniciar({
    executar,
    estaPausado = () => false,
    duracaoMs = DURACAO_MS,
    intervaloMs = INTERVALO_MS,
  } = {}) {
    if (ativo || typeof executar !== 'function') return false;

    const duracao = Math.max(1, Number(duracaoMs) || DURACAO_MS);
    const intervalo = Math.max(20, Number(intervaloMs) || INTERVALO_MS);
    const inicio = agora();
    const minhaGeracao = ++geracao;
    ativo = true;

    const passo = () => {
      if (!ativo || minhaGeracao !== geracao) return;

      const decorrido = agora() - inicio;
      if (decorrido >= duracao || estaPausado()) {
        parar();
        return;
      }

      const ok = executar();
      if (ok === false) {
        parar();
        return;
      }

      const restante = duracao - (agora() - inicio);
      if (restante <= 0) {
        parar();
        return;
      }

      timer = agendar(passo, Math.min(intervalo, restante));
    };

    // Primeiro A é imediato para o comando parecer responsivo.
    passo();
    return ativo;
  }

  return {
    iniciar,
    parar,
    estaAtivo: () => ativo,
  };
}

const executorPadrao = criarExecutor();

module.exports = {
  DURACAO_MS,
  INTERVALO_MS,
  ehComando,
  criarExecutor,
  iniciar: executorPadrao.iniciar,
  parar: executorPadrao.parar,
  estaAtivo: executorPadrao.estaAtivo,
};
