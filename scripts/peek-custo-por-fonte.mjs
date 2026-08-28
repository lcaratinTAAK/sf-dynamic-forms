/**
 * Custo real de montar UM formulário, por fonte.
 * Mede cada chamada individualmente e soma. Alimenta a página de Informações.
 */
import { config } from '../server/config.js';
import {
  sfGet,
  sfPost,
  getObjectInfo,
  getLayout,
  getPicklistValues,
  getRecordDefaults,
  getFlowById,
  soql,
  discoverFormCatalog,
  discoverViaSoql,
} from '../server/salesforce.js';

const RT = '012Ha000002eNzHIAU';
const FORM = 'a0vHa000006CFmDIAW';
const FLOW = '301Ha000010PSOnIAO';

const bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

async function medir(rotulo, fn) {
  const t = Date.now();
  const r = await fn();
  return { rotulo, bytes: bytes(r), ms: Date.now() - t };
}

const fontes = {
  'UI API (v1)': [
    ['object-info', () => getObjectInfo('Case')],
    ['layout', () => getLayout('Case', RT, 'Create')],
    ['picklist-values', () => getPicklistValues('Case', RT)],
    ['query RecordType', () => soql(`SELECT DeveloperName FROM RecordType WHERE Id = '${RT}'`)],
    ['query FormFieldRule__c', () => soql(`SELECT TargetField__c, ConditionField__c, Operator__c, Value__c, Effect__c, LogicGroup__c FROM ${config.rulesObject} WHERE ObjectApiName__c = 'Case' AND IsActive__c = true`)],
  ],
  'UI API v2': [
    ['composite/batch (descoberta)', () => discoverViaSoql('Case', config.rulesObject).then((r) => r.raw)],
    ['record-defaults/create', () => getRecordDefaults('Case', RT)],
    ['picklist-values', () => getPicklistValues('Case', RT)],
  ],
  'Screen Flow': [
    ['composite/batch (catálogo, lista)', () => discoverFormCatalog({ objectApiName: 'Case', source: 'SCREEN_FLOW' }).then((r) => r.raw)],
    ['composite/batch (catálogo, resolve)', () => discoverFormCatalog({ objectApiName: 'Case', source: 'SCREEN_FLOW', formId: FORM }).then((r) => r.raw)],
    ['tooling/sobjects/Flow', () => getFlowById(FLOW)],
    ['object-info', () => getObjectInfo('Case')],
    ['picklist-values', () => getPicklistValues('Case', RT)],
  ],
};

const resumo = {};

for (const [fonte, chamadas] of Object.entries(fontes)) {
  console.log('\n' + '='.repeat(70) + '\n' + fonte + '\n' + '='.repeat(70));
  let total = 0;
  for (const [rotulo, fn] of chamadas) {
    const m = await medir(rotulo, fn);
    total += m.bytes;
    console.log(`  ${m.rotulo.padEnd(36)} ${kb(m.bytes).padStart(9)}  ${String(m.ms).padStart(5)} ms`);
  }
  resumo[fonte] = { chamadas: chamadas.length, total };
  console.log(`  ${'—'.repeat(36)} ${kb(total).padStart(9)}`);
}

console.log('\n' + '='.repeat(70) + '\nRESUMO\n' + '='.repeat(70));
for (const [fonte, r] of Object.entries(resumo)) {
  console.log(`  ${fonte.padEnd(16)} ${String(r.chamadas).padStart(2)} chamadas   ${kb(r.total).padStart(10)}`);
}
console.log('\nJSON para a página:');
console.log(JSON.stringify(resumo));
