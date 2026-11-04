// Valida os CSV de preços da semana ANTES de publicar. Não envia nada a lugar nenhum.
//   node menor-preco/validar-csv.mjs express=<arquivo.csv> [mercearia=<arquivo.csv>]
// Rejeita (saída 1) com mensagem clara: coluna faltando, preço com estado diferente de "preco", data vazia, mercado ou
// estado desconhecido, link fora do site do mercado ou com parâmetro de afiliado, item repetido. Com as duas seções,
// também confere que o mesmo item tem o mesmo preço, estado e data nas duas. O formato das colunas está em precos.js.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('./precos.js');
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const entradas = process.argv.slice(2).map((a) => a.split(/=(.*)/s).slice(0, 2));

if (!entradas.length || entradas.some(([s, f]) => !['express', 'mercearia'].includes(s) || !f)) {
  console.error('Uso: node menor-preco/validar-csv.mjs express=<arquivo.csv> [mercearia=<arquivo.csv>]');
  console.error('Colunas obrigatórias: ' + P.COLUNAS.join(',') + '  (opcionais: ' + P.OPCIONAIS.join(', ') + ')');
  process.exit(2);
}

let falhou = false;
const modelos = {};
for (const [secao, arquivo] of entradas) {
  let texto;
  try { texto = readFileSync(arquivo, 'utf8'); } catch (e) { console.error(`✗ ${secao}: não consegui abrir ${arquivo} (${e.code})`); falhou = true; continue; }
  const r = P.ler(texto, { secao });
  if (r.erros.length) {
    falhou = true;
    console.error(`✗ ${secao} (${arquivo}): arquivo REJEITADO, ${r.erros.length} problema(s):`);
    r.erros.slice(0, 40).forEach((e) => console.error('   - ' + e));
    if (r.erros.length > 40) console.error(`   … e mais ${r.erros.length - 40}`);
    continue;
  }
  modelos[secao] = r.modelo;
  const m = r.modelo, datas = P.datas(m);
  console.log(`✓ ${secao}: ${m.itens.length} itens (${m.nSoma} na soma), ${m.mercados.length} mercados, coleta ${datas.map((d) => d.split('-').reverse().join('/')).join(' e ')}`);
  P.totais(m).forEach((t) => console.log(`    ${t.nome.padEnd(14)} ${t.completo ? brl(t.centavos) + (t.menor ? '  (menor total coletado)' : '') : `faltam ${t.faltam} item(ns): sem total`}`));
}
if (modelos.express && modelos.mercearia) {
  const cruz = P.consistencia(modelos.express, modelos.mercearia);
  if (cruz.length) {
    falhou = true;
    console.error(`✗ divergência entre as seções (${cruz.length}): NÃO publicar.`);
    cruz.forEach((e) => console.error('   - ' + e));
  } else console.log('✓ itens repetidos nas duas seções têm o mesmo preço, estado e data');
}
process.exit(falhou ? 1 : 0);
