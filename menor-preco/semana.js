/* Lê e valida dados/semana.json (a coleta da semana). Sem dependências; roda na página e em Node (validar-semana.mjs).
   Regras: versao 1 ou 2 (a 1 é normalizada para o formato da 2: categoria com varejo{itens,mercados} e atacado{itens,mercados}); data AAAA-MM-DD; preços > 0 com até 2 casas; listas de mercados em ordem crescente de total
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
  function lados(c, v) {
    if (v === 1) return {
      varejo: { itens: (c.varejo || []).length ? (c.itens || []) : [], mercados: c.varejo || [] },
      atacado: { itens: (c.atacado || []).length ? (c.itens || []) : [], mercados: c.atacado || [] }
    };
    function b(x) { x = x || {}; return { itens: Array.isArray(x.itens) ? x.itens : [], mercados: Array.isArray(x.mercados) ? x.mercados : [] }; }
    return { varejo: b(c.varejo), atacado: b(c.atacado) };
  }
  function ler(texto) {
    var erros = [], d;
    try { d = JSON.parse(String(texto)); } catch (e) { return { erros: ['JSON inválido (' + e.message + ')'], dados: null }; }
    if (!d || typeof d !== 'object') return { erros: ['o JSON precisa ser um objeto'], dados: null };
    if (d.versao !== 1 && d.versao !== 2) erros.push('versao precisa ser 1 ou 2');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.coleta)) || isNaN(Date.parse(d.coleta + 'T12:00:00Z'))) erros.push('coleta (AAAA-MM-DD) inválida');
    if (typeof d.regiao !== 'string' || !d.regiao) erros.push('falta regiao');
    var x = d.destaque;
    if (!x || typeof x.item !== 'string' || !x.a || !x.b || !x.a.mercado || !x.b.mercado || !preco(x.a.preco) || !preco(x.b.preco)) erros.push('destaque incompleto (item, a e b com mercado e preço)');
    if (!Array.isArray(d.categorias) || !d.categorias.length) erros.push('falta categorias');
    else d.categorias.forEach(function (c, i) {
      var L = 'categorias[' + i + '] (' + (c && c.nome) + ') ';
      if (!c || !c.nome) { erros.push(L + 'sem nome'); return; }
      var n = lados(c, d.versao);
      ['varejo', 'atacado'].forEach(function (k) {
        var b = n[k];
        if (!b.mercados.length) { if (b.itens.length) erros.push(L + k + ' tem itens mas nenhum mercado'); return; }
        if (!b.itens.length) erros.push(L + k + ' sem itens');
        lista(L + k, b.mercados, 'total', erros);
      });
      if (!n.varejo.mercados.length && !n.atacado.mercados.length) erros.push(L + 'sem nenhum mercado');
      c._n = n;
    });
    var ml = d.mercado_livre;
    if (!ml || !Array.isArray(ml.itens) || !ml.itens.length) erros.push('mercado_livre sem itens');
    else {
      ml.itens.forEach(function (it, i) {
        if (!it || !it.nome || !preco(it.preco)) erros.push('mercado_livre.itens[' + i + '] inválido');
        else if (it.link !== undefined && !/^https:\/\//.test(String(it.link))) erros.push('mercado_livre.itens[' + i + '].link precisa ser https');
      });
      if (ml.total_itens_cesta !== undefined && !(ml.total_itens_cesta >= ml.itens.length)) erros.push('mercado_livre.total_itens_cesta precisa ser >= ao número de itens');
      if (d.versao === 1 && ml.total_itens_cesta === undefined) erros.push('mercado_livre.total_itens_cesta obrigatório na versao 1');
      if (!/^https:\/\//.test(String(ml.link))) erros.push('mercado_livre.link precisa ser https');
    }
    if (d.caiu !== undefined) {
      var cu = d.caiu;
      if (!cu || !/^\d{4}-\d{2}-\d{2}$/.test(String(cu.de)) || !Array.isArray(cu.itens)) erros.push('caiu precisa de de (AAAA-MM-DD) e itens');
      else cu.itens.forEach(function (it, i) {
        if (!it || !it.item || !it.mercado || !preco(it.de) || !preco(it.para)) erros.push('caiu.itens[' + i + '] inválido');
        else if (!(it.para < it.de)) erros.push('caiu.itens[' + i + ']: "para" precisa ser menor que "de"');
      });
    }
    if (!erros.length) d.categorias.forEach(function (c) { c.varejo = c._n.varejo; c.atacado = c._n.atacado; delete c._n; });
    return { erros: erros, dados: erros.length ? null : d };
  }
  /* ---- HTML compartilhado pela página da semana e pelo arquivo ---- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function brl(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function dm(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  function lado(titulo, b, vazio) {
    var h = '<div class="sm-col"><h4>' + titulo + '</h4>';
    if (!b.mercados.length) return h + '<p class="sm-nada">' + vazio + '</p></div>';
    return h + '<ol class="sm-rk">' + b.mercados.map(function (m, i) {
      return '<li' + (i === 0 ? ' class="top"' : '') + '><span>' + esc(m.mercado) + '</span><b>' + brl(m.total) + '</b></li>';
    }).join('') + '</ol><details><summary>Ver os ' + b.itens.length + ' itens</summary><ul>' +
      b.itens.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></details></div>';
  }
  function categorias(d) {
    return d.categorias.map(function (c) {
      return '<article class="sm-cat"><h3>' + esc(c.nome) + '</h3><div class="sm-cols">' +
        lado('Varejo', c.varejo, 'Nenhum varejo tinha os mesmos itens.') +
        lado('Atacado', c.atacado, 'Nenhum atacado tinha os mesmos itens.') + '</div></article>';
    }).join('');
  }
  function ml(d) {
    var m = d.mercado_livre;
    return {
      titulo: m.itens.length + ' itens com menor valor no Mercado Livre' + (m.total_itens_cesta ? ' (de ' + m.total_itens_cesta + ' da cesta)' : ''),
      lista: m.itens.map(function (i) {
        var n = '<span>' + esc(i.nome) + '</span><b>' + brl(i.preco) + '</b>';
        return '<li>' + (i.link ? '<a class="sm-mli" data-mercado="mercadolivre" href="' + esc(i.link) + '" target="_blank" rel="sponsored noopener">' + n + '</a>' : n) + '</li>';
      }).join('')
    };
  }
  function caiu(d) {
    if (!d.caiu || !d.caiu.itens.length) return '';
    return '<ul class="sm-caiu">' + d.caiu.itens.map(function (i) {
      return '<li><span>' + esc(i.item) + ' no ' + esc(i.mercado) + '</span><small>de ' + brl(i.de) + ' para <b>' + brl(i.para) + '</b></small></li>';
    }).join('') + '</ul>';
  }
  function rodape(d) {
    return 'Menor valor entre os mercados que coletamos em ' + dm(d.coleta) + '. Só itens iguais nos mercados comparados. Mercado Livre: vendedor parceiro, à vista. Sem frete. Preços podem mudar.';
  }
  return { ler: ler, esc: esc, brl: brl, dm: dm, categorias: categorias, ml: ml, caiu: caiu, rodape: rodape };
});
