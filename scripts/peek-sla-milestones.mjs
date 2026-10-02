/**
 * Pergunta: dá para ler o milestone "SLA de atendimento" do caso gerado por um
 * envio, e por qual dos dois caminhos?
 *
 *   A · pelo envio — WHERE Case.RelatedCaseFormSubmission__c = :submissionId
 *   B · pelo caso  — WHERE CaseId = :caseId
 *
 * Também confere o que a rota GET /api/sla assume:
 *   - o campo de vínculo existe em Case (sem ele a variante A nem compila);
 *   - FIELDS(ALL) sem LIMIT é recusado pela API.
 *
 * Uso:
 *   node --env-file=.env scripts/peek-sla-milestones.mjs [submissionId] [caseId]
 *
 * Sem caseId, usa o caso mais recente que tenha algum milestone.
 */

import { soql, SalesforceError, querySla } from '../server/salesforce.js';
import { config } from '../server/config.js';

const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

const tentar = async (rotulo, q) => {
  const inicio = Date.now();
  try {
    const r = await soql(q);
    const kb = (Buffer.byteLength(JSON.stringify(r), 'utf8') / 1024).toFixed(1);
    console.log(`  OK   ${rotulo}  ·  ${r.totalSize} registro(s)  ·  ${kb} KB  ·  ${Date.now() - inicio} ms`);
    return r;
  } catch (e) {
    console.log(`  ERRO ${rotulo}  ·  ${e instanceof SalesforceError ? e.message : String(e)}`);
    return null;
  }
};

linha(`o campo de vínculo existe em Case? (${config.slaSubmissionField})`);
const campo = await tentar(
  'FieldDefinition',
  `SELECT QualifiedApiName, DataType FROM FieldDefinition
   WHERE EntityDefinition.QualifiedApiName = 'Case' AND QualifiedApiName = '${config.slaSubmissionField}'`
);
console.log('  ', campo?.records?.[0] ?? '— não existe nesta org: a variante A vai falhar com INVALID_FIELD');

linha('tipos de milestone da org');
const tipos = await tentar('MilestoneType', 'SELECT Id, Name FROM MilestoneType ORDER BY Name');
for (const t of tipos?.records ?? []) console.log(`    ${t.Name === config.slaMilestone ? '→' : ' '} ${t.Name}`);

const [, , submissionId, caseArg] = process.argv;

let caseId = caseArg ?? null;
if (!caseId) {
  const recente = await tentar(
    'caso mais recente com milestone',
    'SELECT CaseId FROM CaseMilestone ORDER BY CreatedDate DESC LIMIT 1'
  );
  caseId = recente?.records?.[0]?.CaseId ?? null;
}

linha('FIELDS(ALL) sem LIMIT — esperado: recusado');
await tentar('sem LIMIT', `SELECT FIELDS(ALL) FROM CaseMilestone WHERE MilestoneType.Name = '${config.slaMilestone}'`);

if (caseId) {
  linha(`B · pelo caso (${caseId})`);
  const b = await tentar('pelo caso', querySla({ caseId }));
  if (b?.records?.[0]) console.log(JSON.stringify(b.records[0], null, 2));
}

if (submissionId) {
  linha(`A · pelo envio (${submissionId})`);
  const a = await tentar('pelo envio', querySla({ submissionId }));
  if (a?.records?.[0]) console.log(JSON.stringify(a.records[0], null, 2));
} else {
  console.log('\n  (sem submissionId: a variante A não foi exercitada)');
}
