/**
 * Dá para ter VÍNCULO com o campo do objeto E obrigatoriedade ao mesmo tempo?
 *
 * ObjectProvided  = vinculado (objectFieldReference), mas recusa isRequired
 *                   e validationRule no deploy.
 * InputField      = aceita isRequired... mas vincula em quê?
 */
import { getFlowById, toolingSoql } from '../server/salesforce.js';

const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

const flows = await toolingSoql(
  "SELECT Id, MasterLabel FROM Flow WHERE ProcessType = 'Flow' AND Status = 'Active' LIMIT 20"
);

let inputComVinculo = 0;
let inputSemVinculo = 0;
let objectProvidedTotal = 0;
const exemplos = [];

for (const f of flows.records) {
  const def = await getFlowById(f.Id).catch(() => null);
  if (!def?.Metadata?.screens) continue;

  const varDeObjeto = new Set(
    (def.Metadata.variables ?? [])
      .filter((v) => v.dataType === 'SObject')
      .map((v) => v.name)
  );

  const andar = (campos) => {
    for (const c of campos ?? []) {
      if (c.fields?.length) andar(c.fields);

      if (c.fieldType === 'ObjectProvided') objectProvidedTotal++;

      if (c.fieldType === 'InputField') {
        if (c.objectFieldReference) inputComVinculo++;
        else inputSemVinculo++;

        if (c.isRequired === true && exemplos.length < 3) {
          exemplos.push({
            flow: f.MasterLabel,
            name: c.name,
            dataType: c.dataType,
            isRequired: c.isRequired,
            objectFieldReference: c.objectFieldReference ?? null,
            temValidacao: Boolean(c.validationRule),
          });
        }
      }
    }
  };
  for (const s of def.Metadata.screens) andar(s.fields);

  // guarda para o teste seguinte
  if (varDeObjeto.size === 0 && exemplos.length) break;
}

linha('InputField vincula a campo do objeto?');
console.log(`  InputField COM objectFieldReference : ${inputComVinculo}`);
console.log(`  InputField SEM objectFieldReference : ${inputSemVinculo}`);
console.log(`  ObjectProvided (sempre vinculado)   : ${objectProvidedTotal}`);

linha('exemplos reais de InputField obrigatório na org');
for (const e of exemplos) {
  console.log(`  ${e.name}  (${e.dataType})`);
  console.log(`    flow                 : ${e.flow}`);
  console.log(`    isRequired           : ${e.isRequired}`);
  console.log(`    objectFieldReference : ${e.objectFieldReference ?? '(nenhum — não está vinculado a campo do objeto)'}`);
  console.log(`    validationRule       : ${e.temValidacao}`);
}

linha('CONCLUSÃO');
console.log(
  inputComVinculo === 0
    ? '  Os dois recursos são MUTUAMENTE EXCLUSIVOS:\n' +
        '    · ObjectProvided  -> vincula ao campo, NÃO aceita obrigatoriedade\n' +
        '    · InputField      -> aceita obrigatoriedade, NÃO vincula ao campo\n\n' +
        '  Para ter os dois, o admin declara InputField obrigatório e mapeia\n' +
        '  campo a campo num elemento de Assignment antes do Create Records.\n' +
        '  Esse mapeamento vive na LÓGICA do flow, não na definição da tela —\n' +
        '  quem lê a tela pela Tooling não enxerga em que campo aquilo grava.'
    : `  Existem ${inputComVinculo} InputField com objectFieldReference — revisar a conclusão.`
);
