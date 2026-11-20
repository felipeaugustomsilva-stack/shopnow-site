/* Lê e valida dados/semana.json (a coleta da semana). Sem dependências; roda na página e em Node (validar-semana.mjs).
   Regras: versao 1; data AAAA-MM-DD; preços > 0 com até 2 casas; listas de mercados em ordem crescente de total
   (a página mostra o menor primeiro e não reordena); categoria com ao menos um item e um mercado; link do ML https. */
(function (raiz, fab) {
  if (typeof module === 'object' && module.exports) module.exports = fab(); else raiz.ShopNowSemana = fab();
})(typeof self !== 'undefined' ? self : this, function () {
  function preco(v) { return typeof v === 'number' && v > 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6; }
  function lista(L, arr, campo, erros) {
    if (!Array.isArray(arr)) { erros.push(L + 'precisa ser uma lista'); return; }
    arr.forEach(function (m, i) {
      if (!m || typeof m.mercado !== 'string' || !m.mercado) erros.push(L + '[' + i + '] sem mercado');
      if (!m || !preco(m[campo])) erros.push(L + '[' + i + '] preço inválido (' + JSON.stringify(m && m[campo]) + ')');
      if (i > 0 && arr[i - 1] && m && arr[i - 1][campo] > m[campo]) erros.push(L + ': fora de ordem crescente em "' + (m.mercado) + '"');
    });
  }
  function ler(texto) {
    var erros = [], d;
    try { d = JSON.parse(String(texto)); } catch (e) { return { erros: ['JSON inválido (' + e.message + ')'], dados: null }; }
    if (!d || typeof d !== 'object') return { erros: ['o JSON precisa ser um objeto'], dados: null };
    if (d.versao !== 1) erros.push('versao precisa ser 1');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.coleta)) || isNaN(Date.parse(d.coleta + 'T12:00:00Z'))) erros.push('coleta (AAAA-MM-DD) inválida');
    if (typeof d.regiao !== 'string' || !d.regiao) erros.push('falta regiao');
    var x = d.destaque;
    if (!x || typeof x.item !== 'string' || !x.a || !x.b || !x.a.mercado || !x.b.mercado || !preco(x.a.preco) || !preco(x.b.preco)) erros.push('destaque incompleto (item, a e b com mercado e preço)');
    if (!Array.isArray(d.categorias) || !d.categorias.length) erros.push('falta categorias');
    else d.categorias.forEach(function (c, i) {
      var L = 'categorias[' + i + '] (' + (c && c.nome) + ') ';
      if (!c || !c.nome) { erros.push(L + 'sem nome'); return; }
      if (!Array.isArray(c.itens) || !c.itens.length) erros.push(L + 'sem itens');
      lista(L + 'atacado', c.atacado || [], 'total', erros);
      lista(L + 'varejo', c.varejo || [], 'total', erros);
      if (!(c.atacado || []).length && !(c.varejo || []).length) erros.push(L + 'sem nenhum mercado');
    });
    var ml = d.mercado_livre;
    if (!ml || !Array.isArray(ml.itens) || !ml.itens.length) erros.push('mercado_livre sem itens');
    else {
      ml.itens.forEach(function (it, i) { if (!it || !it.nome || !preco(it.preco)) erros.push('mercado_livre.itens[' + i + '] inválido'); });
      if (!(ml.total_itens_cesta >= ml.itens.length)) erros.push('mercado_livre.total_itens_cesta precisa ser >= ao número de itens');
      if (!/^https:\/\//.test(String(ml.link))) erros.push('mercado_livre.link precisa ser https');
    }
    return { erros: erros, dados: erros.length ? null : d };
  }
  return { ler: ler };
});
