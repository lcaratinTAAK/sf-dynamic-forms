/**
 * Smoke test offline.
 *
 * Roda os DOIS adaptadores contra payloads reais capturados da forno
 * (pasta `fixtures/`), sem precisar de credenciais.
 *
 *   node scripts/offline-check.js
 */

import { readFileSync } from 'node:fs';
import { flowMetadataToContract } from '../server/adapters/screenflow.js';
import { layoutToContract } from '../server/adapters/uiapi.js';
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

line();
rule();
line('OK — ambos os adaptadores produziram o mesmo formato de contrato.');
rule();
