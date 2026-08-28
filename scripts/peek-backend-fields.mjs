/**
 * As três fontes montam o contrato e injetam os mesmos campos de back-end?
 */
import { config } from '../server/config.js';
import { discoverFormCatalog } from '../server/salesforce.js';
import { buildSubmitPayload } from '../server/contract.js';
import * as uiapi from '../server/adapters/uiapi.js';
import * as uiapiV2 from '../server/adapters/uiapi-v2.js';
import * as screenflow from '../server/adapters/screenflow.js';

const RT = '012Ha000002eNzHIAU';
const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

const { forms } = await discoverFormCatalog({ objectApiName: 'Case', source: 'SCREEN_FLOW' });
const form = forms[0];

const valores = {
  SI_RequesterType__c: 'Proprietário',
  SI_FullName__c: 'Maria Souza',
  SI_Email__c: 'maria@exemplo.com',
  SI_DocumentType__c: 'CPF',
  SI_OwnerDocument__c: '123.456.789-00',
  SI_BankType__c: 'Itaú',
  SI_BankBranch__c: '0001',
  SI_BankAccount__c: '12345-6',
  SI_AccountHolder__c: 'Maria Souza',
  Type: 'ValorQueOFormularioTentouMandar',
};

const fontes = [
  ['UI API (v1)', () => uiapi.buildContract({ objectApiName: 'Case', recordTypeId: RT })],
  ['UI API v2', () => uiapiV2.buildContract({ objectApiName: 'Case', recordTypeId: RT })],
  ['Screen Flow', () => screenflow.buildContract({ form, objectApiName: 'Case' })],
];

for (const [nome, montar] of fontes) {
  linha(nome);
  const c = await montar();

  console.log(`  formDefinition : ${c.formDefinition ? `"${c.formDefinition.label}" [${c.formDefinition.source} · ${c.formDefinition.channel}]` : '— (nenhum no catálogo)'}`);
  console.log(`  recordType     : ${c.recordType?.developerName} -> ${c.recordType?.id}`);
  console.log(`  backendFields  : ${JSON.stringify(c.backendFields)}`);

  const campos = c.sections.flatMap((s) => s.fields).map((f) => f.apiName);
  console.log(`  campos no form : ${campos.length}   Type renderizado? ${campos.includes('Type') ? 'SIM (erro!)' : 'não'}`);

  const p = buildSubmitPayload(c, { ...valores, __attachments: ['a.pdf', 'b.pdf', 'c.pdf'] });
  console.log(`  válido         : ${p.valid}${p.missing.length ? ` · faltando: ${p.missing.join(', ')}` : ''}`);
  console.log(`  injetados      : ${JSON.stringify(p.injectedFields)}`);
  console.log(`  sobrescreveu   : ${p.injectedOverwroteForm.length ? p.injectedOverwroteForm.join(', ') : '—'}`);
  console.log(`  body.RecordTypeId = ${p.request.body.RecordTypeId}`);
  console.log(`  body.Type         = ${p.request.body.Type}`);
  console.log(`  chamadas: ${c.diagnostics.calls.length}`);
  c.diagnostics.calls.forEach((ch) => console.log(`    · ${ch.label}`));
  if (c.diagnostics.warnings.length) console.log(`  avisos: ${c.diagnostics.warnings.join(' | ')}`);
}
