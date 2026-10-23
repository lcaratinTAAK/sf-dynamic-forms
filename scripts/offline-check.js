/**
 * Smoke test offline.
 *
 * Roda os DOIS adaptadores contra payloads reais capturados da forno
 * (pasta `fixtures/`), sem precisar de credenciais.
 *
 *   node scripts/offline-check.js
 */

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { flowMetadataToContract } from '../server/adapters/screenflow.js';
import { layoutToContract } from '../server/adapters/uiapi.js';
import { specToContract } from '../server/adapters/formspec.js';
import { isVisible, buildSubmitPayload } from '../server/contract.js';

// Os fixtures foram capturados via PowerShell, que grava UTF-8 com BOM.
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8').replace(/^﻿/, ''));

const RECORD_TYPE_ID = '012be000001zYygAAE'; // Payments_BankAccountChanges

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(72));

function summarize(contract) {
  const fields = contract.sections.flatMap((s) => s.fields);
  line(`  fonte           : ${contract.source}`);
  line(`  seções          : ${contract.sections.length}`);
  line(`  campos          : ${fields.length}`);
  line(`  com picklist    : ${fields.filter((f) => f.options?.length).length}`);
  line(`  obrigatórios    : ${fields.filter((f) => f.required).length}`);
  line(`  com regra       : ${fields.filter((f) => f.visibility).length}`);
  line(`  anexo           : required=${contract.attachments.required} min=${contract.attachments.minimumCount} component=${contract.attachments.component ?? '—'}`);
  if (contract.attachments.documents.length) {
    for (const d of contract.attachments.documents) line(`                    · ${d.code} — ${d.label}`);
  }
  if (contract.diagnostics.warnings.length) {
    line(`  avisos          :`);
    for (const w of contract.diagnostics.warnings) line(`                    ! ${w}`);
  }
  return fields;
}

// ---------------------------------------------------------------------------
rule();
line('ADAPTADOR 1 — UI API (Page Layout + regras)');
rule();

const layout = fixture('layout-bankaccount-create.json');
const recordDefaults = fixture('record-defaults-bankaccount.json');
const objectInfo = recordDefaults.objectInfos.Case;
const picklists = fixture('picklist-values-bankaccount.json');

// Regras sintéticas: simulam registros de FormFieldRule__c
const rules = [
  {
    TargetField__c: 'Description',
    ConditionField__c: 'Origin',
    Operator__c: 'EQUALS',
    Value__c: 'Web',
    Effect__c: 'SHOW',
    LogicGroup__c: 'g1',
  },
];

const uiContract = layoutToContract(layout, {
  objectApiName: 'Case',
  recordTypeId: RECORD_TYPE_ID,
  objectInfo,
  picklists,
  rules,
});

const uiFields = summarize(uiContract);

line();
line('  primeiros campos:');
for (const f of uiFields.slice(0, 6)) {
  const opts = f.options?.length ? ` (${f.options.length} opções)` : '';
  const vis = f.visibility ? `  ← visível se ${f.visibility.conditions.map((c) => `${c.field} ${c.operator} "${c.value}"`).join(' AND ')}` : '';
  line(`    ${f.apiName.padEnd(28)} ${String(f.dataType).padEnd(12)} req=${String(f.required).padEnd(5)}${opts}${vis}`);
}

line();
line('  teste do avaliador de visibilidade:');
const target = uiFields.find((f) => f.apiName === 'Description');
if (target) {
  line(`    Origin="Web"    → Description visível? ${isVisible(target, { Origin: 'Web' })}`);
  line(`    Origin="Email"  → Description visível? ${isVisible(target, { Origin: 'Email' })}`);
} else {
  line('    ! campo Description não está no layout; regra não exercitada');
}

// ---------------------------------------------------------------------------
line();
rule();
line('ADAPTADOR 2 — Screen Flow (Tooling API)');
rule();

const flow = fixture('flow-test_ui_api.json');
const flowContract = flowMetadataToContract(flow.Metadata, {
  objectApiName: 'Case',
  recordTypeId: RECORD_TYPE_ID,
  objectInfo,
  picklists,
});

const flowFields = summarize(flowContract);

line();
line('  campos resolvidos a partir de objectFieldReference:');
for (const f of flowFields) {
  const opts = f.options?.length ? ` (${f.options.length} opções)` : '';
  line(`    ${f.apiName.padEnd(28)} ${String(f.dataType).padEnd(12)} req=${String(f.required).padEnd(5)}${opts}`);
}

// ---------------------------------------------------------------------------
line();
rule();
line('PAYLOAD DE ENVIO (o mesmo código serve às duas fontes)');
rule();

const values = {};
for (const f of flowFields) {
  if (f.options?.length) values[f.apiName] = f.options[0].value;
  else values[f.apiName] = 'valor de teste';
}

const semAnexo = buildSubmitPayload(flowContract, values);
line(`  sem anexo → válido? ${semAnexo.valid}   faltando: ${semAnexo.missing.join(', ') || '—'}`);

const comAnexo = buildSubmitPayload(flowContract, { ...values, __attachments: ['doc.pdf'] });
line(`  com anexo → válido? ${comAnexo.valid}   faltando: ${comAnexo.missing.join(', ') || '—'}`);
line();
line('  request que seria enviado:');
line(JSON.stringify(comAnexo.request, null, 2).split('\n').map((l) => '    ' + l).join('\n'));

// ---------------------------------------------------------------------------
line();
rule();
line('REFERÊNCIA MÚLTIPLA — FormDefinition__c → contrato → composite');
rule();

// Linhas sintéticas no formato da SOQL do adaptador: a raiz e três componentes.
// O destino de cada referência múltipla vem da PRÓPRIA linha (copiado do
// FormBuilderAllowlist__mdt pelo Form Builder): objeto criado por escolha,
// lookup do Caso e campo do id externo. Componentes diferentes, destinos
// diferentes; linha antiga sem as colunas cai no legado CaseContract__c.
const FORM_ID = 'a1Xbe000000MULTI';
const MULTI_ID = 'a1Xbe000000MREF1';
const MULTI_IMOVEL_ID = 'a1Xbe000000MREF2';
const MULTI_LEGADO_ID = 'a1Xbe000000MREF3';
const linhasMulti = [
  {
    Id: FORM_ID,
    Name: 'teste_multi',
    RecordType: { DeveloperName: 'Form' },
    ObjectApiName__c: 'CaseFormSubmission__c',
    TargetRecordTypeDevName__c: 'BankDataChange',
    VersionFieldApiName__c: 'FormVersion__c',
    Version__c: 1,
    VersionKey__c: 'teste_multi#1',
  },
  {
    Id: MULTI_ID,
    Name: 'Contrato',
    RecordType: { DeveloperName: 'MultiReference' },
    Form__c: FORM_ID,
    Sort__c: 10,
    LabelOverride__c: 'Quais contratos?',
    IsRequired__c: true,
    ReferenceType__c: 'CONTRACT',
    ReferenceObjectApiName__c: 'Contract',
    ExternalIdFieldApiName__c: 'ExternalId__c',
    ChildObjectApiName__c: 'CaseContract__c',
    ChildCaseFieldApiName__c: 'Case__c',
    FieldApiName__c: 'RelatedContractExternalId__c',
  },
  {
    Id: MULTI_IMOVEL_ID,
    Name: 'Imóveis',
    RecordType: { DeveloperName: 'MultiReference' },
    Form__c: FORM_ID,
    Sort__c: 20,
    ReferenceType__c: 'PROPERTY',
    ReferenceObjectApiName__c: 'Property__c',
    ExternalIdFieldApiName__c: 'PropertyCode__c',
    ChildObjectApiName__c: 'CaseProperty__c',
    ChildCaseFieldApiName__c: 'RelatedCase__c',
    FieldApiName__c: 'PropertyExternalId__c',
  },
  {
    // Salva antes do destino dinâmico: nenhuma das três colunas.
    Id: MULTI_LEGADO_ID,
    Name: 'Contratos (legado)',
    RecordType: { DeveloperName: 'MultiReference' },
    Form__c: FORM_ID,
    Sort__c: 30,
    ReferenceType__c: 'CONTRACT',
    ReferenceObjectApiName__c: 'Contract',
    ExternalIdFieldApiName__c: 'ExternalId__c',
  },
];
const contratoMulti = specToContract(linhasMulti, {
  formId: FORM_ID,
  objectApiName: 'CaseFormSubmission__c',
  indiceDeCampos: {},
  picklists: null,
  rt: { Id: '012be000000RTXX', Name: 'Bank data change' },
});
const [multi, multiImovel, multiLegado] = contratoMulti.sections[0].fields;
assert.equal(multi.kind, 'multireference');
assert.equal(multi.label, 'Quais contratos?');
assert.deepEqual(
  { object: multi.link.object, caseField: multi.link.caseField, externalIdField: multi.link.externalIdField },
  { object: 'CaseContract__c', caseField: 'Case__c', externalIdField: 'RelatedContractExternalId__c' }
);
assert.deepEqual(
  { object: multiImovel.link.object, caseField: multiImovel.link.caseField, externalIdField: multiImovel.link.externalIdField },
  { object: 'CaseProperty__c', caseField: 'RelatedCase__c', externalIdField: 'PropertyExternalId__c' },
  'o destino vem da linha, não de constante'
);
assert.deepEqual(
  { object: multiLegado.link.object, caseField: multiLegado.link.caseField, externalIdField: multiLegado.link.externalIdField },
  { object: 'CaseContract__c', caseField: 'Case__c', externalIdField: 'RelatedContractExternalId__c' },
  'linha sem as colunas cai no legado'
);
assert.ok(
  contratoMulti.diagnostics.warnings.some((w) => w.includes('Contratos (legado)')),
  'linha legada gera aviso'
);
for (const m of [multi, multiImovel, multiLegado]) {
  line(`  componente      : ${m.apiName} (${m.kind}) → ${m.link.object}.${m.link.caseField} + ${m.link.externalIdField}`);
}

const chave = multi.apiName;

const vazio = buildSubmitPayload(contratoMulti, { [chave]: ['', '  '] });
assert.equal(vazio.valid, false, 'obrigatória sem contrato não envia');
line(`  sem contrato    → válido? ${vazio.valid}   faltando: ${vazio.missing.join(', ')}`);

const repetido = buildSubmitPayload(contratoMulti, { [chave]: ['ctr_1', 'ctr_1'] });
assert.equal(repetido.valid, false, 'contrato repetido não envia');
line(`  repetido        → válido? ${repetido.valid}   ${repetido.invalid.map((e) => e.message).join('; ')}`);

const doisContratos = buildSubmitPayload(contratoMulti, {
  [chave]: ['ctr_1', '', ' ctr_2 '],
  [multiImovel.apiName]: ['imv_7'],
  [multiLegado.apiName]: ['ctr_9'],
});
assert.equal(doisContratos.valid, true);
assert.equal(doisContratos.vinculos.length, 4, 'linha vazia não vira vínculo');
const subs = doisContratos.request.body.compositeRequest;
assert.deepEqual(subs.map((s) => s.referenceId), ['refPai', 'casoGerado', 'registros']);
assert.match(subs[1].url, /WHERE\+RelatedCaseFormSubmission__c='@\{refPai\.id\}'/, 'GET do Caso pelo envio');
assert.equal(subs.filter((s) => s.method === 'GET').length, 1, 'uma consulta do Caso para todos os vínculos');
// Uma coleção só, com cada escolha no objeto e nos campos do SEU componente.
assert.match(subs[2].url, /\/composite\/sobjects$/);
assert.equal(subs[2].body.allOrNone, true);
const recs = subs[2].body.records;
assert.equal(recs.length, 4);
assert.deepEqual(recs[0], {
  attributes: { type: 'CaseContract__c' },
  RelatedContractExternalId__c: 'ctr_1',
  Case__c: '@{casoGerado.records[0].Id}',
});
assert.equal(recs[1].RelatedContractExternalId__c, 'ctr_2');
assert.deepEqual(recs[2], {
  attributes: { type: 'CaseProperty__c' },
  PropertyExternalId__c: 'imv_7',
  RelatedCase__c: '@{casoGerado.records[0].Id}',
});
assert.deepEqual(recs[3], {
  attributes: { type: 'CaseContract__c' },
  RelatedContractExternalId__c: 'ctr_9',
  Case__c: '@{casoGerado.records[0].Id}',
});
assert.equal(subs[0].body[chave], undefined, 'nada da referência múltipla no registro do formulário');
assert.equal(subs[0].body.RelatedContractExternalId__c, undefined, 'FieldApiName__c da multi não é campo do formulário');
line('  dois contratos  → composite:');
line(JSON.stringify(doisContratos.request, null, 2).split('\n').map((l) => '    ' + l).join('\n'));

// ---------------------------------------------------------------------------
line();
rule();
line('CHOICES__C E LISTA REPETÍVEL — FormDefinition__c → contrato → envio');
rule();

const FORM_LISTA = 'a1Xbe000000LISTA';
const LISTA_ID = 'a1Xbe000000LIST1';
const linhasLista = [
  {
    Id: FORM_LISTA,
    Name: 'teste_lista',
    RecordType: { DeveloperName: 'Form' },
    ObjectApiName__c: 'CaseFormSubmission__c',
    TargetRecordTypeDevName__c: 'BankDataChange',
  },
  {
    // Campo texto com opções: "a;b;c", como o FormDefinitionController grava.
    Id: 'a1Xbe000000CHOI1',
    Name: 'Motivo',
    RecordType: { DeveloperName: 'Field' },
    Form__c: FORM_LISTA,
    Sort__c: 10,
    FieldApiName__c: 'Reason__c',
    Choices__c: 'Adicionar pessoa; Despesas condominio;;Outro',
    IsRequired__c: true,
  },
  {
    Id: LISTA_ID,
    Name: 'Pessoas',
    RecordType: { DeveloperName: 'RepeatingSection' },
    Form__c: FORM_LISTA,
    Sort__c: 20,
    ChildObjectApiName__c: 'CaseFormSubmissionItem__c',
    ChildRecordTypeDevName__c: 'Person',
    ChildCaseFieldApiName__c: 'Case__c',
    ChildListFieldApiName__c: 'FormList__c',
    ItemLabel__c: 'Pessoa',
  },
  {
    Id: 'a1Xbe000000LFLD1',
    Name: 'Nome',
    RecordType: { DeveloperName: 'Field' },
    Form__c: FORM_LISTA,
    Parent__c: LISTA_ID,
    Sort__c: 1,
    FieldApiName__c: 'Name__c',
  },
  {
    // Visível, com valor padrão: sozinho não faz um item contar.
    Id: 'a1Xbe000000LFLD2',
    Name: 'Papel',
    RecordType: { DeveloperName: 'Field' },
    Form__c: FORM_LISTA,
    Parent__c: LISTA_ID,
    Sort__c: 2,
    FieldApiName__c: 'Role__c',
    DefaultValue__c: 'Titular',
  },
];
const contratoLista = specToContract(linhasLista, {
  formId: FORM_LISTA,
  objectApiName: 'CaseFormSubmission__c',
  indiceDeCampos: {},
  picklists: null,
  rt: { Id: '012be000000RTXX', Name: 'Bank data change' },
  listas: {
    CaseFormSubmissionItem__c: {
      indiceDeCampos: {},
      controladorDe: {},
      recordTypes: { Person: { Id: '012be000000RTPP', DeveloperName: 'Person' } },
      picklists: {},
    },
  },
});
const motivo = contratoLista.sections[0].fields[0];
assert.equal(motivo.dataType, 'Picklist', 'texto com Choices__c vira lista de escolha');
assert.deepEqual(
  motivo.options.map((o) => o.value),
  ['Adicionar pessoa', 'Despesas condominio', 'Outro'],
  'dividido no ponto e vírgula, sem espaço nas pontas e sem vazio'
);
line(`  Choices__c      : ${motivo.apiName} → ${motivo.options.map((o) => o.value).join(' | ')}`);

const comLista = buildSubmitPayload(contratoLista, {
  Reason__c: 'Outro',
  __listas: { [LISTA_ID]: [{ Name__c: 'Maria' }, {}, { Role__c: '' }] },
});
assert.equal(comLista.valid, true, comLista.missing.join(', '));
assert.equal(comLista.listas.length, 1, 'item só com valor padrão não vira registro');
const subsLista = comLista.request.body.compositeRequest;
assert.deepEqual(subsLista.map((s) => s.referenceId), ['refPai', 'casoGerado', 'registros']);
assert.equal(subsLista[0].body.Reason__c, 'Outro', 'a escolha vai como texto no campo');
assert.match(subsLista[2].url, /\/composite\/sobjects$/);
assert.equal(subsLista[2].body.records.length, 1);
assert.deepEqual(subsLista[2].body.records[0], {
  attributes: { type: 'CaseFormSubmissionItem__c' },
  RecordTypeId: '012be000000RTPP',
  Name__c: 'Maria',
  Role__c: 'Titular',
  FormList__c: LISTA_ID,
  Case__c: '@{casoGerado.records[0].Id}',
});
line('  lista           → composite:');
line(JSON.stringify(comLista.request, null, 2).split('\n').map((l) => '    ' + l).join('\n'));

line();
rule();
line('OK — ambos os adaptadores produziram o mesmo formato de contrato.');
rule();
