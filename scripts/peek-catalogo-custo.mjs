/**
 * Quanto pesa cada subrequest do catálogo, e quais deles a LISTAGEM
 * realmente precisa.
 */
import { discoverFormCatalog } from '../server/salesforce.js';

const kb = (o) => `${(Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1)} KB`;
const linha = (t) => console.log('\n' + '='.repeat(70) + '\n' + t + '\n' + '='.repeat(70));

const nomes = ['FormDefinition__c', 'FlowDefinitionView', 'RecordType'];

for (const [rotulo, args] of [
  ['01 · listagem  (sem formId)', { objectApiName: 'Case', source: 'SCREEN_FLOW' }],
  ['02 · resolução (com formId)', { objectApiName: 'Case', source: 'SCREEN_FLOW', formId: 'a0vHa000006CFmDIAW' }],
]) {
  linha(rotulo);
  const r = await discoverFormCatalog(args);

  r.raw.results.forEach((s, i) => {
    console.log(`  ${nomes[i].padEnd(20)} ${String(s.result?.totalSize ?? 0).padStart(4)} registros   ${kb(s).padStart(9)}`);
  });
  console.log(`  ${'TOTAL'.padEnd(20)} ${''.padStart(4)}              ${kb(r.raw).padStart(9)}`);
}

linha('o que a LISTAGEM entrega hoje');
const { forms } = await discoverFormCatalog({ objectApiName: 'Case', source: 'SCREEN_FLOW' });
console.log(JSON.stringify(forms, null, 2));

console.log('\nO seletor usa: id, label, channel e problems[].');
console.log('problems[] só existe porque os dois joins rodaram — é o que marca ⚠');
console.log('num formulário que aponta para flow sem versão ativa ou RT inexistente.');
