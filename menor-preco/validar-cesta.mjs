// Valida o CSV da Cesta de Sexta ANTES de publicar. Não envia nada a lugar nenhum.
//   node menor-preco/validar-cesta.mjs menor-preco/dados/cesta-sexta.csv
// Rejeita (saída 1) com mensagem clara: coluna faltando, mercado/estado desconhecido, preço com estado "indisponivel",
// preço inválido ou zero, coletado_em vazio ou diferente entre as linhas, item repetido, atacado sem condicao.
// Avisos (não bloqueiam): item sem linha para um mercado, mercado sem nenhuma linha, nome de item que só aparece em poucos mercados.
// O formato das colunas está em cesta.js.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const C = createRequire(import.meta.url)('./cesta.js');
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const arquivo = process.argv[2];

if (!arquivo) {
  console.error('Uso: node menor-preco/validar-cesta.mjs <arquivo.csv>');
  console.error('Colunas obrigatórias: ' + C.COLUNAS.join(',') + '  (opcional: ' + C.OPCIONAIS.join(', ') + ')');
  process.exit(2);
}
let texto;
try { texto = readFileSync(arquivo, 'utf8'); } catch (e) { console.error(`✗ não consegui abrir ${arquivo} (${e.code})`); process.exit(1); }

const r = C.ler(texto);
if (r.erros.length) {
  console.error(`✗ arquivo REJEITADO (${arquivo}), ${r.erros.length} problema(s):`);
  r.erros.slice(0, 40).forEach((e) => console.error('   - ' + e));
  if (r.erros.length > 40) console.error(`   … e mais ${r.erros.length - 40}`);
  process.exit(1);
}
for (const cesta of Object.values(r.modelo.cestas)) {
  console.log(`✓ ${cesta.nome}: ${cesta.n} itens, coleta ${cesta.momento.data.split('-').reverse().join('/')} às ${cesta.momento.hora}`);
  cesta.ranking.forEach((m) => console.log(`    ${String(m.posicao).padStart(2)}. ${m.nome.padEnd(14)} ${brl(m.total)}  (${m.comPreco} de ${cesta.n} itens)`));
  cesta.incompletos.forEach((m) => console.log(`     –  ${m.nome.padEnd(14)} incompleto, fora do ranking (${m.comPreco} de ${cesta.n} itens; mínimo 80%)`));
}
if (r.avisos.length) {
  console.log(`\nAvisos (${r.avisos.length}), não bloqueiam:`);
  r.avisos.forEach((a) => console.log('   ! ' + a));
}
