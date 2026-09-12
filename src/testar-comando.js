'use strict';

/**
 * Simulador do pipeline do chat para o assistente.
 * Interpreta exatamente o que o chat digitou, mas NUNCA executa teclado,
 * mouse ou gamepad. Pode receber a lista ainda não salva do wizard para
 * testar aliases enquanto o streamer edita.
 */

const controles = require('./controles');
const dialogo = require('./utils/dialogo');
const { parseComando } = require('./commands');
const { parseMouseCommand } = require('./mouse-commands');
const { parseGamepadCommand } = require('./gamepad-commands');

function copiarLista(lista) {
  return (Array.isArray(lista) ? lista : []).map((c) => ({
    ...c,
    aliases: Array.isArray(c.aliases) ? [...c.aliases] : [],
  }));
}

function comControlesTemporarios(lista, fn) {
  if (!Array.isArray(lista)) return fn();
  const validacao = controles.validarLista(lista);
  if (validacao.erros.length) {
    return {
      ok: false,
      reconhecido: false,
      erros: validacao.erros.map((e) => `Controles: ${e}`),
    };
  }

  const anteriores = copiarLista(controles.todos());
  try {
    controles.__definirLista(validacao.lista);
    return fn();
  } finally {
    controles.__definirLista(anteriores);
  }
}

function controlePorId(id) {
  return controles.todos().find((c) => c.id === id) || null;
}

function interpretar(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return null;

  // Mesma prioridade do gameplay: macros especiais primeiro; depois os
  // namespaces próprios de mouse/gamepad; por fim teclado/admin.
  if (dialogo.ehComando(bruto)) return { tipo: 'dialogo' };
  return parseMouseCommand(bruto)
    || parseGamepadCommand(bruto)
    || parseComando(bruto);
}

function respostaBase(entrada, parsed) {
  return {
    ok: true,
    reconhecido: true,
    entrada,
    tipo: parsed.tipo,
    categoria: 'sistema',
    titulo: 'Comando reconhecido',
    resumo: 'O ChatPlays reconheceu o comando.',
    detalhes: [],
    executaria: false,
    parsed,
  };
}

function descrever(entrada, parsed) {
  if (!parsed) {
    return {
      ok: true,
      reconhecido: false,
      entrada,
      tipo: null,
      categoria: 'nenhum',
      titulo: 'Não reconhecido',
      resumo: 'Nenhuma ação seria executada. Confira o comando ou os aliases do perfil.',
      detalhes: [],
      executaria: false,
    };
  }

  const r = respostaBase(entrada, parsed);

  if (parsed.tipo === 'dialogo') {
    r.categoria = 'macro';
    r.titulo = '💬 Diálogo';
    r.resumo = 'Apertaria o botão A repetidamente por 5 segundos.';
    r.detalhes = ['Macro protegida: não empilha duas execuções ao mesmo tempo.'];
    r.executaria = true;
    return r;
  }

  if (parsed.tipo && parsed.tipo.startsWith('mouse-')) {
    r.categoria = 'mouse';
    r.titulo = '🖱️ Mouse';
    r.resumo = parsed.descricao || 'Executaria uma ação de mouse.';
    if (parsed.tipo === 'mouse-mover') r.detalhes.push(`Movimento relativo: x=${parsed.dx}, y=${parsed.dy}`);
    if (parsed.tipo === 'mouse-pos') r.detalhes.push(`Posição na área do jogo: ${parsed.x}% × ${parsed.y}%`);
    if (parsed.tipo === 'mouse-click') r.detalhes.push(`Botão: ${parsed.botao || 'esquerdo'}`);
    r.executaria = true;
    return r;
  }

  if (parsed.tipo && parsed.tipo.startsWith('gamepad-')) {
    r.categoria = 'gamepad';
    r.titulo = '🎮 Gamepad virtual';
    r.resumo = parsed.descricao || 'Executaria uma ação no controle Xbox 360 virtual.';
    if (parsed.duracaoMs) r.detalhes.push(`Duração: ${parsed.duracaoMs} ms`);
    r.executaria = true;
    return r;
  }

  if (parsed.tipo === 'botao' || parsed.tipo === 'hold') {
    const c = controlePorId(parsed.botao);
    r.categoria = 'teclado';
    r.titulo = `⌨️ ${c?.label || parsed.botao}`;
    r.resumo = parsed.tipo === 'hold'
      ? `Seguraria a tecla por ${parsed.duracaoMs} ms.`
      : 'Apertaria a tecla uma vez.';
    r.detalhes = [
      `Controle: ${parsed.botao}`,
      `Tecla: ${c?.key || '(não encontrada)'}`,
    ];
    r.executaria = true;
    return r;
  }

  if (parsed.tipo === 'soltar') {
    r.categoria = 'segurança';
    r.titulo = '🔓 Soltar tudo';
    r.resumo = 'Liberaria teclas presas e neutralizaria comandos mantidos.';
    r.executaria = true;
    return r;
  }

  if (parsed.tipo === 'info') {
    r.categoria = 'chat';
    r.titulo = `💬 !${parsed.bruto || parsed.comando}`;
    r.resumo = `Comando administrativo reconhecido: ${parsed.comando}.`;
    r.detalhes = ['Não aperta tecla no jogo; o bot responde/atua no chat conforme o comando.'];
    return r;
  }

  if (parsed.tipo === 'ola') {
    r.categoria = 'chat';
    r.titulo = '👋 Saudação';
    r.resumo = 'O bot reconheceria a saudação e poderia responder no chat.';
    return r;
  }

  if (parsed.tipo === 'hold-invalido') {
    r.categoria = 'inválido';
    r.titulo = '⚠️ Hold incompleto';
    r.resumo = 'O formato parece um hold, mas falta um controle válido.';
    return r;
  }

  return r;
}

function testarComando(texto, listaControles) {
  const entrada = String(texto || '').trim();
  if (!entrada) {
    return {
      ok: false,
      reconhecido: false,
      entrada: '',
      erros: ['Digite um comando para testar.'],
    };
  }
  if (entrada.length > 100) {
    return {
      ok: false,
      reconhecido: false,
      entrada,
      erros: ['O comando deve ter no máximo 100 caracteres.'],
    };
  }

  controles.garantirInicializado();
  return comControlesTemporarios(listaControles, () => descrever(entrada, interpretar(entrada)));
}

module.exports = { testarComando, interpretar, descrever };
