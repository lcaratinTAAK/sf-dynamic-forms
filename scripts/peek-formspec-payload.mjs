/**
 * A seção oculta realmente tira os campos dela do payload e da validação?
 *
 * É o comportamento que a fonte custom introduz e as outras três não têm como
 * produzir, porque só ela expressa visibilidade em SEÇÃO.
 */
import { buildSubmitPayload } from '../server/contract.js';

const base = 'http://localhost:3000';
const { forms } = await (await fetch(`${base}/api/forms?source=FORM_SPEC`)).json();
const contrato = await (await fetch(`${base}/api/form?source=formspec&formId=${forms[0].id}`)).json();

const comuns = {
  SI_ContractStatus__c: 'Ativo',
  SI_Email__c: 'maria@exemplo.com',
  SI_FullName__c: 'Maria Teste',
  SI_OwnerDocument__c: '000.000.000-00',
  SI_AccountHolder__c: 'MesmaTitularidade',
  SI_BankType__c: 'BancoDigital',
  SI_BankBranch__c: '0001',
  SI_BankAccount__c: '123456-7',
  SI_DocumentType__c: 'CNH',
  __attachments: ['doc.pdf', 'selfie.jpg', 'titularidade.pdf'],
};

for (const [rotulo, extra] of [
  ['PROPRIETÁRIO — seção do parceiro oculta', { SI_RequesterType__c: 'Proprietario', SI_PPMulti__c: 'Nao', SI_SameAccountAllContracts__c: 'Sim' }],
  ['PARCEIRO — seção do parceiro visível, e vazia', { SI_RequesterType__c: 'Parceiro' }],
  ['PARCEIRO — seção preenchida', { SI_RequesterType__c: 'Parceiro', SI_PartnerRole__c: 'Corretor', SI_PartnerCPF__c: '111', SI_PartnerPhone__c: '11999' }],
]) {
  const p = buildSubmitPayload(contrato, { ...comuns, ...extra });
  console.log('\n' + '='.repeat(70));
  console.log(rotulo);
  console.log('='.repeat(70));
  console.log(`  válido        : ${p.valid}`);
  console.log(`  faltando      : ${p.missing.join(', ') || '—'}`);
  console.log(`  ocultos       : ${p.hiddenFieldsIgnored.join(', ') || '—'}`);
  console.log(`  injetados     : ${JSON.stringify(p.injectedFields)}`);
  console.log(`  campos no body: ${Object.keys(p.request.body).filter((k) => k !== 'attributes').length}`);
}
