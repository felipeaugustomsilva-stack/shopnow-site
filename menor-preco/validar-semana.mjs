// Valida dados/semana.json ANTES de publicar:  node menor-preco/validar-semana.mjs [menor-preco/dados/semana.json]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('./semana.js');
const arq = process.argv[2] || new URL('./dados/semana.json', import.meta.url).pathname;
const r = S.ler(readFileSync(arq, 'utf8'));
if (r.erros.length) { console.error('✗ REJEITADO (' + arq + '):'); r.erros.forEach((e) => console.error('   - ' + e)); process.exit(1); }
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
console.log(`✓ coleta ${r.dados.coleta}, ${r.dados.regiao}; destaque: ${r.dados.destaque.item}`);
r.dados.categorias.forEach((c) => {
  console.log(`  ${c.nome}`);
  [['varejo', c.varejo], ['atacado', c.atacado]].forEach(([n, l]) => console.log(`    ${n} (${l.itens.length} itens): ` + (l.mercados.map((m) => `${m.mercado} ${brl(m.total)}`).join(' · ') || '—')));
});
if (r.dados.caiu) console.log('  caiu desde ' + r.dados.caiu.de + ': ' + r.dados.caiu.itens.map((i) => `${i.item} (${i.mercado}) ${brl(i.de)} → ${brl(i.para)}`).join(' · '));
