/**
 * Obrigatoriedade em Screen Flow: o que o metadado REALMENTE expõe.
 *
 * Pergunta: dá para marcar um campo como obrigatório num Screen Flow, e isso
 * chega até quem lê a definição pela Tooling API?
 */
import { getFlowById, toolingSoql } from '../server/salesforce.js';

const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

const ativa = await toolingSoql(
  "SELECT Id FROM Flow WHERE Definition.DeveloperName = 'SI_Demo_BankDataChange_Form' AND Status = 'Active'"
);
const flow = await getFlowById(ativa.records[0].Id);

linha('CAMPOS DAS TELAS — o que cada um declara');
const percorrer = (campos, nivel = 0) => {
  for (const c of campos ?? []) {
    if (c.fields?.length) percorrer(c.fields, nivel + 1);
    if (!c.fieldType) continue;

    const chaves = Object.keys(c).sort();
    const marca = (k) => (c[k] === undefined ? '—' : String(c[k]));

    console.log(
      `  ${'  '.repeat(nivel)}${String(c.fieldType).padEnd(18)} ` +
        `isRequired=${marca('isRequired').padEnd(6)} ` +
        `${c.objectFieldReference ?? c.name ?? ''}`
    );
    if (c.fieldType === 'ObjectProvided' || c.fieldType === 'InputField') {
      console.log(`  ${'  '.repeat(nivel)}   chaves: ${chaves.join(', ')}`);
    }
  }
};
for (const s of flow.Metadata.screens ?? []) {
  console.log(`\n  [tela] ${s.name}`);
  percorrer(s.fields, 1);
}

linha('EXISTE isRequired EM ALGUM LUGAR DO PAYLOAD?');
const cru = JSON.stringify(flow);
for (const termo of ['isRequired', 'validationRule', 'errorMessage', 'inputValidation']) {
  const n = (cru.match(new RegExp(termo, 'g')) ?? []).length;
  console.log(`  ${termo.padEnd(18)} ${n} ocorrência(s)`);
}

linha('COMO OUTROS FLOWS DA ORG FAZEM');
const outros = await toolingSoql(
  "SELECT Id, MasterLabel FROM Flow WHERE ProcessType = 'Flow' AND Status = 'Active' LIMIT 12"
);
let comObjectProvidedRequired = 0;
let comInputFieldRequired = 0;
let totalObjectProvided = 0;
let totalInputField = 0;

for (const f of outros.records) {
  const def = await getFlowById(f.Id).catch(() => null);
  if (!def?.Metadata?.screens) continue;

  const contar = (campos) => {
    for (const c of campos ?? []) {
      if (c.fields?.length) contar(c.fields);
      if (c.fieldType === 'ObjectProvided') {
        totalObjectProvided++;
        if (c.isRequired === true) comObjectProvidedRequired++;
      }
      if (c.fieldType === 'InputField') {
        totalInputField++;
        if (c.isRequired === true) comInputFieldRequired++;
      }
    }
  };
  for (const s of def.Metadata.screens) contar(s.fields);
}

console.log(`  ObjectProvided : ${totalObjectProvided} campos, ${comObjectProvidedRequired} com isRequired=true`);
console.log(`  InputField     : ${totalInputField} campos, ${comInputFieldRequired} com isRequired=true`);
console.log('\n  (amostra de 12 flows ativos da org)');
