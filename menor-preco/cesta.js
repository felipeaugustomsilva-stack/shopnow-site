/* ShopNowCesta: lê e valida o CSV da Cesta de Sexta e calcula totais e ranking.
   Um arquivo só para a página (navegador) e para validar-cesta.mjs (Node). Sem dado de preço aqui dentro.

   CSV: UTF-8, vírgula, uma linha por item e por mercado. Colunas obrigatórias:
     cesta        varejo | atacado
     item         nome do produto (marca e tamanho); igual em todos os mercados da mesma cesta
     mercado      varejo: carrefour, paodeacucar, shopper, sonda, mercadolivre   atacado: atacadao, assai
     preco        reais com ponto decimal e até 2 casas (ex.: 12.90); vazio quando indisponivel
     estado       preco | indisponivel
     coletado_em  AAAA-MM-DD HH:MM (hora de Brasília); o mesmo valor em todas as linhas da cesta
   Colunas opcionais:
     condicao     texto curto com a quantidade mínima ou o fardo daquele preço (ex.: "a partir de 6 un", "fardo com 12").
                  OBRIGATÓRIA no atacado quando estado = preco.
   Um campo com vírgula (ex.: "Arroz Camil, 5 kg") vai entre aspas.
   Item sem linha para um mercado conta como indisponível (o validador avisa). Preço nunca vira zero. */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.ShopNowCesta = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLUNAS = ['cesta', 'item', 'mercado', 'preco', 'estado', 'coletado_em'];
  var OPCIONAIS = ['condicao'];
  var ESTADOS = ['preco', 'indisponivel'];
  /* Mínimo de itens com preço para o mercado entrar no ranking (regra da página: 80%). */
  var MINIMO_RANKING = 0.8;
  /* Ordem fixa (desempate e ordem dos mercados incompletos). `fisico`: o "Onde comprar" abre o Google Maps. */
  var CESTAS = {
    varejo: {
      nome: 'Varejo',
      mercados: [
        { id: 'carrefour', nome: 'Carrefour', fisico: false },
        { id: 'paodeacucar', nome: 'Pão de Açúcar', fisico: false },
        { id: 'shopper', nome: 'Shopper', fisico: false },
        { id: 'sonda', nome: 'Sonda', fisico: true },
        { id: 'mercadolivre', nome: 'Mercado Livre', fisico: false, parceiro: true }
      ]
    },
    atacado: {
      nome: 'Atacado',
      mercados: [
        { id: 'atacadao', nome: 'Atacadão', fisico: true },
        { id: 'assai', nome: 'Assaí', fisico: true },
        { id: 'spani', nome: 'Spani', fisico: true }
      ]
    }
  };

  function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function chave(s) { return semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

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

  /* Preço em centavos (inteiro) ou null. Só ponto decimal, até 2 casas, maior que zero. */
  function centavosDe(txt) {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(txt)) return null;
    var p = txt.split('.'), c = parseInt(p[0], 10) * 100 + (p[1] ? parseInt((p[1] + '0').slice(0, 2), 10) : 0);
    return c > 0 ? c : null;
  }

  /* 'AAAA-MM-DD HH:MM' (ou com T) → { texto, data:'AAAA-MM-DD', hora:'HH:MM', ms } ou null. Sem fuso: é a hora de Brasília. */
  function momentoValido(txt) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(txt);
    if (!m) return null;
    var a = +m[1], mes = +m[2], d = +m[3], h = +m[4], mi = +m[5];
    var dt = new Date(Date.UTC(a, mes - 1, d, h + 3, mi)); // Brasília = UTC-3
    if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d || h > 23 || mi > 59) return null;
    return { texto: m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5], data: m[1] + '-' + m[2] + '-' + m[3], hora: m[4] + ':' + m[5], ms: dt.getTime() };
  }

  /* Monta o modelo de uma cesta: itens = [{ nome, k, celulas: { mercadoId: { estado, centavos, condicao } } }]; def = { nome, mercados:[{id,nome,fisico,parceiro}] }. */
  function construir(cestaId, def, itens, momento, avisos) {
    var mercados = def.mercados.map(function (m) {
      var comPreco = 0, total = 0;
      itens.forEach(function (it) { var c = it.celulas[m.id]; if (c && c.estado === 'preco') { comPreco++; total += c.centavos; } });
      var semLinha = itens.filter(function (it) { return !it.celulas[m.id]; }).length;
      var temLinha = itens.some(function (it) { return it.celulas[m.id]; });
      if (semLinha && temLinha) avisos.push('cesta ' + cestaId + ': ' + m.id + ' não tem linha para ' + semLinha + ' item(ns); contam como indisponíveis');
      return { id: m.id, nome: m.nome, fisico: !!m.fisico, parceiro: !!m.parceiro, comPreco: comPreco, total: comPreco ? total : null, completo: false, noRanking: false, semLinha: semLinha };
    });
    var n = itens.length;
    mercados.forEach(function (m) {
      m.completo = m.comPreco === n;
      m.noRanking = m.comPreco > 0 && m.comPreco * 5 >= n * 4; /* ≥ 80% */
    });
    var ranking = mercados.filter(function (m) { return m.noRanking; }).sort(function (a, b) { return a.total - b.total; }); // sort estável: empate mantém a ordem fixa
    var incompletos = mercados.filter(function (m) { return !m.noRanking; });
    var maior = ranking.length ? ranking[ranking.length - 1].total : 0;
    ranking.forEach(function (m, i) { m.posicao = i + 1; m.largura = maior ? Math.max(4, Math.round(m.total / maior * 100)) : 0; });
    var presentes = {};
    itens.forEach(function (it) { Object.keys(it.celulas).forEach(function (id) { presentes[id] = true; }); });
    mercados.forEach(function (m) { if (!presentes[m.id]) avisos.push('cesta ' + cestaId + ': nenhuma linha para o mercado ' + m.id + ' (aparece como incompleto)'); });
    itens.forEach(function (it) {
      var nm = Object.keys(it.celulas).length;
      if (nm * 2 < def.mercados.length) avisos.push('cesta ' + cestaId + ': o item "' + it.nome + '" só aparece em ' + nm + ' de ' + def.mercados.length + ' mercados (confira se o nome está igual nos outros)');
    });
    return { id: cestaId, nome: def.nome, itens: itens, n: n, mercados: mercados, ranking: ranking, incompletos: incompletos, momento: momento };
  }

  /* Lê e valida. Devolve { erros: [texto], avisos: [texto], modelo }. Com qualquer erro, modelo é null: o arquivo é rejeitado inteiro.
     modelo = { cestas: { varejo?: cesta, atacado?: cesta } }; cada cesta traz itens, mercados com total e o ranking. */
  function ler(texto) {
    var erros = [], avisos = [], lc = lerCsv(String(texto));
    if (lc.erro) return { erros: [lc.erro], avisos: avisos, modelo: null };
    if (!lc.linhas.length) return { erros: ['o arquivo está vazio'], avisos: avisos, modelo: null };
    var cab = lc.linhas[0].campos.map(function (s) { return s.trim().toLowerCase(); });
    if (cab.length === 1 && cab[0].indexOf(';') >= 0) return { erros: ['o separador precisa ser vírgula, não ponto e vírgula'], avisos: avisos, modelo: null };
    var faltam = COLUNAS.filter(function (c) { return cab.indexOf(c) < 0; });
    if (faltam.length) return { erros: ['faltam colunas: ' + faltam.join(', ') + '. Cabeçalho esperado: ' + COLUNAS.join(',')], avisos: avisos, modelo: null };
    var idx = {}, vistaCol = {};
    cab.forEach(function (c, i) {
      if (COLUNAS.indexOf(c) < 0 && OPCIONAIS.indexOf(c) < 0) erros.push('coluna desconhecida: "' + c + '"');
      if (vistaCol[c]) erros.push('coluna repetida: "' + c + '"');
      vistaCol[c] = true; idx[c] = i;
    });
    if (erros.length) return { erros: erros, avisos: avisos, modelo: null };

    var brutas = {}, vistas = {};
    lc.linhas.slice(1).forEach(function (l) {
      var L = 'linha ' + l.n + ': ';
      if (l.campos.length !== cab.length) {
        erros.push(L + 'tem ' + l.campos.length + ' campos e o cabeçalho tem ' + cab.length + ' (campo com vírgula precisa de aspas)');
        return;
      }
      var v = function (c) { return c in idx ? l.campos[idx[c]].trim() : ''; };
      var cestaId = v('cesta').toLowerCase();
      if (!CESTAS[cestaId]) { erros.push(L + 'cesta "' + v('cesta') + '" desconhecida (use varejo ou atacado)'); return; }
      var item = v('item');
      if (!item) { erros.push(L + 'item vazio'); return; }
      var mercado = null;
      CESTAS[cestaId].mercados.forEach(function (m) { if (chave(v('mercado')) === m.id) mercado = m; });
      if (!mercado) {
        erros.push(L + 'mercado "' + v('mercado') + '" não existe na cesta ' + cestaId + ' (use: ' + CESTAS[cestaId].mercados.map(function (m) { return m.id; }).join(', ') + ')');
        return;
      }
      var estado = v('estado').toLowerCase();
      if (ESTADOS.indexOf(estado) < 0) { erros.push(L + 'estado "' + v('estado') + '" desconhecido (use preco ou indisponivel)'); return; }
      var momento = momentoValido(v('coletado_em'));
      if (!momento) erros.push(L + 'coletado_em "' + v('coletado_em') + '" inválido (use AAAA-MM-DD HH:MM, ex.: 2026-11-13 09:30)');
      var preco = null, precoTxt = v('preco');
      if (estado === 'preco') {
        preco = centavosDe(precoTxt);
        if (preco === null) erros.push(L + 'estado "preco" precisa de um valor maior que zero, com ponto decimal e até 2 casas (veio "' + precoTxt + '")');
      } else if (precoTxt !== '') {
        erros.push(L + 'estado "indisponivel" não pode ter preço (veio "' + precoTxt + '"); deixe o preço vazio');
      }
      var condicao = v('condicao');
      if (condicao.length > 60) erros.push(L + 'condicao passa de 60 caracteres');
      if (estado === 'preco' && cestaId === 'atacado' && !condicao) erros.push(L + 'no atacado todo preço precisa de condicao (quantidade mínima ou fardo; ex.: "a partir de 6 un", "fardo com 12")');
      var rep = cestaId + '|' + chave(item) + '|' + mercado.id;
      if (vistas[rep]) { erros.push(L + 'repete o item "' + item + '" no mercado ' + mercado.id + ' (já está na linha ' + vistas[rep] + ')'); return; }
      vistas[rep] = l.n;
      (brutas[cestaId] = brutas[cestaId] || []).push({ item: item, k: chave(item), mercado: mercado.id, estado: estado, centavos: preco, condicao: condicao, momento: momento });
    });
    if (erros.length) return { erros: erros, avisos: avisos, modelo: null };
    if (!Object.keys(brutas).length) return { erros: ['o arquivo não tem nenhuma linha de dados'], avisos: avisos, modelo: null };

    var modelo = { cestas: {} };
    Object.keys(brutas).forEach(function (cestaId) {
      var linhas = brutas[cestaId], def = CESTAS[cestaId];
      var momentos = {};
      linhas.forEach(function (r) { momentos[r.momento.texto] = r.momento; });
      var textos = Object.keys(momentos);
      if (textos.length > 1) {
        erros.push('cesta ' + cestaId + ': coletado_em diferente entre as linhas (' + textos.join(' e ') + '); use o mesmo valor em todas');
        return;
      }
      var itens = [], porK = {};
      linhas.forEach(function (r) { if (!porK[r.k]) { porK[r.k] = { nome: r.item, k: r.k, celulas: {} }; itens.push(porK[r.k]); } porK[r.k].celulas[r.mercado] = r; });
      modelo.cestas[cestaId] = construir(cestaId, def, itens, textos.length ? momentos[textos[0]] : null, avisos);
    });
    if (erros.length) return { erros: erros, avisos: avisos, modelo: null };
    return { erros: [], avisos: avisos, modelo: modelo };
  }

  /* Lê o JSON v2 da coleta (o arquivo que o Analista gera) e usa as cestas que ele definiu em `cestas.varejo` e `cestas.atacado`:
     os itens e os mercados de cada aba, só preço de nível "exato". `cestas.todos` é ignorada. O total de cada mercado é recalculado
     dos preços e precisa bater com `cestas.<aba>.totais`; senão o arquivo é rejeitado. */
  var FISICOS = { sonda: 1, atacadao: 1, assai: 1, spani: 1 };
  function lerJson(texto) {
    var erros = [], avisos = [], d;
    try { d = JSON.parse(String(texto)); } catch (e) { return { erros: ['o arquivo não é um JSON válido (' + e.message + ')'], avisos: avisos, modelo: null }; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { erros: ['o JSON precisa ser um objeto'], avisos: avisos, modelo: null };
    if (d.versao !== 2) erros.push('versao precisa ser 2 (veio ' + JSON.stringify(d.versao) + ')');
    var hf = d.horario_coleta && d.horario_coleta.fim;
    var momento = momentoValido(String(d.data_coleta) + ' ' + String(hf));
    if (!momento) erros.push('data_coleta (AAAA-MM-DD) e horario_coleta.fim (HH:MM) inválidos (vieram ' + JSON.stringify(d.data_coleta) + ' e ' + JSON.stringify(hf) + ')');
    var catalogo = {};
    (Array.isArray(d.mercados) ? d.mercados : []).forEach(function (m) { if (m && m.id) catalogo[m.id] = m; });
    var porId = {};
    (Array.isArray(d.itens) ? d.itens : []).forEach(function (it) { if (it && it.id) porId[it.id] = it; });
    if (!d.cestas || typeof d.cestas !== 'object') erros.push('falta o campo cestas');
    if (erros.length) return { erros: erros, avisos: avisos, modelo: null };
    var modelo = { cestas: {} };
    ['varejo', 'atacado'].forEach(function (tab) {
      var c = d.cestas[tab];
      if (!c) return;
      var L = 'cestas.' + tab + ': ';
      if (!Array.isArray(c.mercados) || !c.mercados.length || !Array.isArray(c.itens) || !c.itens.length) { erros.push(L + 'precisa de mercados e itens'); return; }
      var def = { nome: CESTAS[tab].nome, mercados: [] };
      c.mercados.forEach(function (id) {
        var m = catalogo[id];
        if (!m) { erros.push(L + 'mercado "' + id + '" não está em mercados'); return; }
        var parceiro = id === 'mercadolivre' || Object.keys(porId).some(function (k) { var p = porId[k].precos && porId[k].precos[id]; return p && p.vendedor_parceiro === true; });
        def.mercados.push({ id: id, nome: m.nome || id, fisico: !!FISICOS[id], parceiro: parceiro });
      });
      var itens = [];
      c.itens.forEach(function (iid) {
        var it = porId[iid];
        if (!it) { erros.push(L + 'item "' + iid + '" não está em itens'); return; }
        var linha = { nome: it.nome || iid, k: iid, celulas: {} };
        def.mercados.forEach(function (m) {
          var p = it.precos && it.precos[m.id];
          if (p && p.status === 'ok') {
            if (p.nivel !== 'exato') { erros.push(L + 'item "' + iid + '" em ' + m.id + ' tem nível "' + p.nivel + '"; só "exato" entra na cesta'); return; }
            var cts = typeof p.preco === 'number' ? Math.round(p.preco * 100) : NaN;
            if (!(cts > 0) || Math.abs(p.preco * 100 - cts) > 1e-6) { erros.push(L + 'preço inválido em ' + iid + '/' + m.id + ' (veio ' + JSON.stringify(p.preco) + '): use valor maior que zero com até 2 casas'); return; }
            linha.celulas[m.id] = { estado: 'preco', centavos: cts, condicao: '' };
          } else {
            linha.celulas[m.id] = { estado: 'indisponivel', centavos: null, condicao: '' };
          }
        });
        itens.push(linha);
      });
      if (erros.length) return;
      var cesta = construir(tab, def, itens, momento, avisos);
      if (c.totais) {
        cesta.mercados.forEach(function (m) {
          var esp = c.totais[m.id];
          if (typeof esp === 'number' && m.completo && Math.abs(Math.round(esp * 100) - m.total) > 1) erros.push(L + 'o total de ' + m.id + ' no arquivo (' + esp + ') não bate com a soma dos preços (' + (m.total / 100) + ')');
        });
      }
      modelo.cestas[tab] = cesta;
    });
    if (!erros.length && !Object.keys(modelo.cestas).length) erros.push('o arquivo não tem cestas.varejo nem cestas.atacado');
    if (erros.length) return { erros: erros, avisos: avisos, modelo: null };
    return { erros: [], avisos: avisos, modelo: modelo };
  }

  /* Dias inteiros entre a coleta e agora (ms em UTC). */
  function idadeDias(momento, agoraMs) { return Math.floor((agoraMs - momento.ms) / 86400000); }

  return { COLUNAS: COLUNAS, OPCIONAIS: OPCIONAIS, CESTAS: CESTAS, MINIMO_RANKING: MINIMO_RANKING, lerCsv: lerCsv, ler: ler, lerJson: lerJson, centavosDe: centavosDe, momentoValido: momentoValido, idadeDias: idadeDias };
});
