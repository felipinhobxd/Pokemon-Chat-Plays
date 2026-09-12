'use strict';

const MAX_COOLDOWN_MS = 10 * 60 * 1000;

function normalizarChaveCooldown(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseDuracaoCooldown(valor) {
  const t = String(valor || '').trim().toLowerCase();
  if (!t) return null;
  let m = t.match(/^(\d+(?:\.\d+)?)ms$/);
  let ms;
  if (m) ms = Math.round(Number(m[1]));
  else {
    m = t.match(/^(\d+(?:\.\d+)?)s$/);
    if (m) ms = Math.round(Number(m[1]) * 1000);
    else if (/^\d+$/.test(t)) ms = Number(t);
    else return null;
  }
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_COOLDOWN_MS) return null;
  return ms;
}

function analisarCooldownsPorComando(texto) {
  const mapa = Object.create(null);
  const erros = [];
  const vistos = new Set();
  const bruto = String(texto || '').trim();
  if (!bruto) return { mapa, erros };

  const itens = bruto.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  for (const item of itens) {
    const pos = item.indexOf('=');
    if (pos <= 0 || pos === item.length - 1) {
      erros.push(`"${item}" deve usar comando=tempo (ex.: dialogo=10s)`);
      continue;
    }
    const chave = normalizarChaveCooldown(item.slice(0, pos));
    const duracaoTexto = item.slice(pos + 1).trim();
    if (!/^[a-z0-9_-]+(?::[a-z0-9_-]+)?$/.test(chave)) {
      erros.push(`comando "${item.slice(0, pos).trim()}" inválido`);
      continue;
    }
    if (vistos.has(chave)) {
      erros.push(`comando "${chave}" repetido`);
      continue;
    }
    const ms = parseDuracaoCooldown(duracaoTexto);
    if (ms === null) {
      erros.push(`tempo inválido em "${item}" (use ms ou s, máximo 10min)`);
      continue;
    }
    vistos.add(chave);
    mapa[chave] = ms;
  }
  return { mapa, erros };
}

function parseCooldownsPorComando(texto) {
  return analisarCooldownsPorComando(texto).mapa;
}

module.exports = {
  MAX_COOLDOWN_MS,
  normalizarChaveCooldown,
  parseDuracaoCooldown,
  analisarCooldownsPorComando,
  parseCooldownsPorComando,
};
