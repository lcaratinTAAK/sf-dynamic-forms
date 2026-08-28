import { getLayout } from '../server/salesforce.js';
const layout = await getLayout('Case', '012Ha000002eNzHIAU', 'Create');

console.log('chaves de TOPO da resposta do layout:');
console.log('  ' + Object.keys(layout).join(', '));

const item = layout.sections
  .flatMap(s => s.layoutRows ?? [])
  .flatMap(r => r.layoutItems ?? [])
  .find(i => i.layoutComponents?.some(c => c.apiName === 'SI_BankType__c'));

console.log('\nlayoutItem COMPLETO de um campo Picklist (SI_BankType__c):');
console.log(JSON.stringify(item, null, 2));

console.log('\nprocurando qualquer mencao a tipo em TODA a resposta do layout:');
const raw = JSON.stringify(layout);
for (const termo of ['dataType', 'Picklist', 'type', 'length', 'scale']) {
  const n = (raw.match(new RegExp(termo, 'g')) ?? []).length;
  console.log(`  "${termo}": ${n} ocorrência(s)`);
}
