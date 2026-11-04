/* ShopNowPrecos: lê e valida o CSV de preços da semana e calcula totais, ordem, selo e barras.
   Um arquivo só para a página (navegador) e para validar-csv.mjs (Node). Sem dado de preço aqui dentro.

   CSV: UTF-8, vírgula, uma linha por item e por mercado. Colunas obrigatórias:
     secao (express|mercearia), item, mercado, preco (ponto decimal; vazio se não houver),
     estado (preco|nao_encontrado|fora_de_estoque|aguardando), data_coleta (AAAA-MM-DD), url_produto (https, pode ficar vazio)
   Colunas opcionais: soma (sim|nao; vazio = sim; "nao" = fora da soma) e pix (sim|nao; vazio = nao).
   Um campo com vírgula (ex.: "Arroz Camil, 5 kg") vai entre aspas. */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.ShopNowPrecos = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLUNAS = ['secao', 'item', 'mercado', 'preco', 'estado', 'data_coleta', 'url_produto'];
  var OPCIONAIS = ['soma', 'pix'];
  var SECOES = ['express', 'mercearia'];
  var ESTADOS = ['preco', 'nao_encontrado', 'fora_de_estoque', 'aguardando'];
  // Ordem fixa das colunas da tabela. Hosts: só a loja do próprio mercado.
  var MERCADOS = [
    { id: 'carrefour', nome: 'Carrefour', hosts: ['carrefour.com.br'] },
    { id: 'paodeacucar', nome: 'Pão de Açúcar', hosts: ['paodeacucar.com'] },
    { id: 'mercadolivre', nome: 'Mercado Livre', hosts: ['mercadolivre.com.br'] },
    { id: 'shopper', nome: 'Shopper', hosts: ['shopper.com.br'] }
  ];
  // Parâmetros típicos de link de afiliado/comissão: o link de produto das seções novas nunca os leva.
  var PARAM_AFILIADO = /^(tag|linkid|linkcode|ref_|matt_.*|aff.*|af_.*|afiliado|partner.*|pid|mkt_.*|deep_link.*)$/i;

  function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function idMercado(txt) {
    var k = semAcento(txt).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (var i = 0; i < MERCADOS.length; i++) if (MERCADOS[i].id === k) return k;
    return null;
  }
  function posMercado(id) { for (var i = 0; i < MERCADOS.length; i++) if (MERCADOS[i].id === id) return i; return -1; }
  function nomeMercado(id) { var i = posMercado(id); return i < 0 ? id : MERCADOS[i].nome; }
  function chaveItem(nome) { return semAcento(nome).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function dataValida(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  // "12.34" -> 1234 (centavos, sem ponto flutuante). null se não for número com ponto e até 2 casas, ou se for zero.
  function centavosDe(txt) {
    if (!/^\d+(\.\d{1,2})?$/.test(txt)) return null;
    var p = txt.split('.'), c = parseInt(p[0], 10) * 100 + (p[1] ? parseInt((p[1] + '0').slice(0, 2), 10) : 0);
    return c > 0 && isFinite(c) ? c : null;
  }

  function urlOk(mercadoId, url) {
    var u;
    try { u = new URL(url); } catch (e) { return 'endereço inválido'; }
    if (u.protocol !== 'https:') return 'precisa começar com https://';
    var m = MERCADOS[posMercado(mercadoId)], host = u.hostname.toLowerCase();
    if (!m.hosts.some(function (h) { return host === h || host.slice(-(h.length + 1)) === '.' + h; })) {
      return 'o endereço (' + host + ') não é do site de ' + m.nome;
    }
    var ruim = null;
    u.searchParams.forEach(function (v, k) { if (PARAM_AFILIADO.test(k)) ruim = k; });
    if (ruim) return 'tem o parâmetro "' + ruim + '", típico de link de afiliado';
    return null;
  }

  // CSV (RFC 4180 enxuto): aspas duplas, "" dentro de campo entre aspas, quebra de linha dentro de aspas, BOM, CRLF.
  function lerCsv(texto) {
    if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
    var linhas = [], row = [], f = '', q = false, ln = 1, rowLn = 1, i, c;
    for (i = 0; i < texto.length; i++) {
      c = texto[i];
      if (q) {
        if (c === '"') { if (texto[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else { if (c === '\n') ln++; f += c; }
      } else if (c === '"' && f === '') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\r') { /* CRLF */ }
      else if (c === '\n') { row.push(f); linhas.push({ n: rowLn, campos: row }); row = []; f = ''; ln++; rowLn = ln; }
      else f += c;
    }
    if (q) return { erro: 'aspas abertas sem fechar (começam na linha ' + rowLn + ')' };
    if (f !== '' || row.length) { row.push(f); linhas.push({ n: rowLn, campos: row }); }
    return { linhas: linhas.filter(function (l) { return !(l.campos.length === 1 && l.campos[0].trim() === ''); }) };
  }

  /* Lê e valida. opc.secao ('express'|'mercearia') exige que todas as linhas sejam dessa seção.
     Devolve { erros: [texto], modelo }. Com qualquer erro, modelo é null: o arquivo é rejeitado inteiro. */
  function ler(texto, opc) {
    opc = opc || {};
    var erros = [], lc = lerCsv(String(texto));
    if (lc.erro) return { erros: [lc.erro], modelo: null };
    if (!lc.linhas.length) return { erros: ['o arquivo está vazio'], modelo: null };
    var cab = lc.linhas[0].campos.map(function (s) { return s.trim().toLowerCase(); });
    if (cab.length === 1 && cab[0].indexOf(';') >= 0) return { erros: ['o separador precisa ser vírgula, não ponto e vírgula'], modelo: null };
    var faltam = COLUNAS.filter(function (c) { return cab.indexOf(c) < 0; });
    if (faltam.length) return { erros: ['faltam colunas: ' + faltam.join(', ') + '. Cabeçalho esperado: ' + COLUNAS.join(',')], modelo: null };
    var idx = {}, vistaCol = {};
    cab.forEach(function (c, i) {
      if (COLUNAS.indexOf(c) < 0 && OPCIONAIS.indexOf(c) < 0) erros.push('coluna desconhecida: "' + c + '"');
      if (vistaCol[c]) erros.push('coluna repetida: "' + c + '"');
      vistaCol[c] = true; idx[c] = i;
    });
    if (erros.length) return { erros: erros, modelo: null };

    var itens = [], porChave = {}, mercadosVistos = {}, vistas = {}, secaoDoArquivo = null;
    lc.linhas.slice(1).forEach(function (l) {
      var L = 'linha ' + l.n + ': ';
      if (l.campos.length !== cab.length) {
        erros.push(L + 'tem ' + l.campos.length + ' campos e o cabeçalho tem ' + cab.length + ' (campo com vírgula precisa de aspas)');
        return;
      }
      var v = function (c) { return c in idx ? l.campos[idx[c]].trim() : ''; };
      var secao = v('secao').toLowerCase(), item = v('item').replace(/\s+/g, ' '), estado = v('estado').toLowerCase();
      var preco = v('preco'), data = v('data_coleta'), url = v('url_produto');
      var mercado = idMercado(v('mercado')), ok = true;
      var falha = function (m) { erros.push(L + m); ok = false; };
      if (SECOES.indexOf(secao) < 0) falha('secao "' + v('secao') + '" inválida (use express ou mercearia)');
      else if (opc.secao && secao !== opc.secao) falha('secao "' + secao + '" não pertence a este arquivo (esperado: ' + opc.secao + ')');
      else secaoDoArquivo = secao;
      if (!item) falha('item vazio'); else if (item.length > 120) falha('item com mais de 120 caracteres');
      if (!mercado) falha('mercado "' + v('mercado') + '" desconhecido (use ' + MERCADOS.map(function (m) { return m.nome; }).join(', ') + ')');
      if (ESTADOS.indexOf(estado) < 0) falha('estado "' + v('estado') + '" inválido (use ' + ESTADOS.join(', ') + ')');
      if (!data) falha('data_coleta vazia'); else if (!dataValida(data)) falha('data_coleta "' + data + '" inválida (use AAAA-MM-DD)');
      var cent = null;
      if (estado === 'preco') {
        if (preco === '') falha('estado "preco" sem valor em preco');
        else { cent = centavosDe(preco); if (cent === null) falha('preco "' + preco + '" inválido (número maior que zero, com ponto e até 2 casas)'); }
      } else if (ESTADOS.indexOf(estado) >= 0 && preco !== '') {
        falha('preco preenchido ("' + preco + '") com estado "' + estado + '": só o estado "preco" leva valor');
      }
      var soma = v('soma').toLowerCase(), pix = v('pix').toLowerCase();
      if (['', 'sim', 'nao'].indexOf(soma) < 0) falha('soma "' + v('soma') + '" inválido (use sim ou nao)');
      if (['', 'sim', 'nao'].indexOf(pix) < 0) falha('pix "' + v('pix') + '" inválido (use sim ou nao)');
      if (url && mercado) { var eu = urlOk(mercado, url); if (eu) falha('url_produto: ' + eu); }
      if (!ok) return;

      var chave = chaveItem(item), dup = secao + '|' + chave + '|' + mercado;
      if (vistas[dup]) { falha('repetido: "' + item + '" em ' + nomeMercado(mercado) + ' (já na linha ' + vistas[dup] + ')'); return; }
      vistas[dup] = l.n;
      var it = porChave[chave];
      if (!it) { it = porChave[chave] = { chave: chave, nome: item, soma: soma !== 'nao', celulas: {} }; itens.push(it); }
      else if (it.soma !== (soma !== 'nao')) { falha('"' + item + '": soma diferente entre os mercados (o item entra ou não na soma em todos)'); return; }
      mercadosVistos[mercado] = true;
      it.celulas[mercado] = { estado: estado, centavos: cent, data: data, url: url || '', pix: pix === 'sim' };
    });
    if (!itens.length && !erros.length) erros.push('nenhuma linha de dados');
    if (itens.length && !itens.some(function (i) { return i.soma; })) erros.push('nenhum item entra na soma');
    if (erros.length) return { erros: erros, modelo: null };
    var mercados = MERCADOS.filter(function (m) { return mercadosVistos[m.id]; }).map(function (m) { return { id: m.id, nome: m.nome }; });
    return { erros: [], modelo: { secao: secaoDoArquivo, itens: itens, mercados: mercados, nSoma: itens.filter(function (i) { return i.soma; }).length } };
  }

  // Total de um mercado: só existe com TODOS os itens da soma em estado "preco".
  function total(modelo, mercadoId) {
    var n = 0, c = 0, faltam = 0;
    modelo.itens.forEach(function (it) {
      if (!it.soma) return;
      n++;
      var ce = it.celulas[mercadoId];
      if (ce && ce.estado === 'preco') c += ce.centavos; else faltam++;
    });
    return faltam === 0 && n > 0 ? { completo: true, centavos: c, n: n, faltam: 0 } : { completo: false, centavos: null, n: n, faltam: faltam };
  }

  /* Linhas de total. Completos primeiro, do menor para o maior (empate: ordem fixa); incompletos depois, em ordem fixa.
     menor = selo "Menor total coletado": só com 2 ou mais completos; no empate, todos os empatados.
     largura = % da barra, proporcional ao maior total entre os completos. Incompleto: sem barra e sem total. */
  function totais(modelo) {
    var linhas = modelo.mercados.map(function (m, i) {
      var t = total(modelo, m.id); t.id = m.id; t.nome = m.nome; t.pos = i; return t;
    });
    var comp = linhas.filter(function (l) { return l.completo; }).sort(function (a, b) { return a.centavos - b.centavos || a.pos - b.pos; });
    var inc = linhas.filter(function (l) { return !l.completo; });
    var min = comp.length ? comp[0].centavos : 0, max = comp.length ? comp[comp.length - 1].centavos : 0;
    comp.forEach(function (l) {
      l.menor = comp.length >= 2 && l.centavos === min;
      l.largura = Math.round(l.centavos / max * 1000) / 10;
    });
    inc.forEach(function (l) { l.menor = false; l.largura = null; });
    return comp.concat(inc);
  }

  // Diferença entre o maior e o menor total completo; null com menos de 2 completos.
  function diferenca(modelo) {
    var c = totais(modelo).filter(function (l) { return l.completo; });
    return c.length >= 2 ? c[c.length - 1].centavos - c[0].centavos : null;
  }

  function datas(modelo) {
    var s = {};
    modelo.itens.forEach(function (it) { Object.keys(it.celulas).forEach(function (m) { s[it.celulas[m].data] = true; }); });
    return Object.keys(s).sort();
  }

  // Mesmo item e mesmo mercado nas duas seções: mesmo estado, mesmo preço, mesma data. Devolve a lista de divergências.
  function consistencia(a, b) {
    var erros = [], ids = a.mercados.map(function (m) { return m.id; }).filter(function (id) {
      return b.mercados.some(function (m) { return m.id === id; });
    });
    var porChaveB = {}; b.itens.forEach(function (it) { porChaveB[it.chave] = it; });
    var rot = function (c) {
      if (!c) return 'sem dado';
      return (c.estado === 'preco' ? 'R$ ' + (c.centavos / 100).toFixed(2).replace('.', ',') : c.estado) + ', ' + c.data;
    };
    a.itens.forEach(function (ia) {
      var ib = porChaveB[ia.chave];
      if (!ib) return;
      ids.forEach(function (id) {
        var ca = ia.celulas[id], cb = ib.celulas[id];
        var igual = (!ca && !cb) || (ca && cb && ca.estado === cb.estado && ca.centavos === cb.centavos && ca.data === cb.data);
        if (!igual) erros.push('"' + ia.nome + '" em ' + nomeMercado(id) + ' diverge: ' + a.secao + ' (' + rot(ca) + ') x ' + b.secao + ' (' + rot(cb) + ')');
      });
    });
    return erros;
  }

  return {
    COLUNAS: COLUNAS, OPCIONAIS: OPCIONAIS, MERCADOS: MERCADOS,
    ler: ler, lerCsv: lerCsv, total: total, totais: totais, diferenca: diferenca, datas: datas, consistencia: consistencia,
    urlOk: urlOk, dataValida: dataValida, centavosDe: centavosDe, nomeMercado: nomeMercado
  };
});
