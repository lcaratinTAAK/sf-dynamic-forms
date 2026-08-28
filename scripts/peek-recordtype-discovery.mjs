import { sfGet, sfPost } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const kb = (o) => (Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1);

async function medir(nome, fn) {
  const t = Date.now();
  const body = await fn();
  console.log(`  ${nome.padEnd(40)} ${String(kb(body)).padStart(8)} KB  ${String(Date.now() - t).padStart(5)} ms`);
  return body;
}

// 1. Como é hoje: object-info devolve recordTypeInfos com `available`
const info = await medir('object-info/Case  (hoje)', () => sfGet(`${V}/ui-api/object-info/Case`));
const rts = Object.values(info.recordTypeInfos ?? {});
const disponiveis = rts.filter((r) => r.available && !r.master);
console.log(`     recordTypeInfos: ${rts.length} total · ${disponiveis.length} com available=true e master=false`);

// 2. A alternativa: SOQL em RecordType
const soql =
  "SELECT Id, DeveloperName, Name FROM RecordType WHERE SobjectType = 'Case' AND IsActive = true ORDER BY Name";
const q = await medir('query RecordType  (alternativa)', () =>
  sfGet(`${V}/query?q=${encodeURIComponent(soql)}`)
);
console.log(`     registros devolvidos: ${q.totalSize}`);

// 3. A pergunta central: a SOQL respeita a visibilidade do usuário?
console.log('\n  SOQL respeita a visibilidade do profile?');
console.log(`     object-info diz disponíveis : ${disponiveis.length}`);
console.log(`     SOQL devolve                : ${q.totalSize}`);
console.log(
  q.totalSize === disponiveis.length
    ? '     => SIM, os números batem'
    : `     => NAO. A SOQL devolve ${q.totalSize - disponiveis.length} a mais — inclui RTs que o usuário não pode usar.`
);

// 4. As duas queries num único composite/batch
const batch = await medir('composite/batch: RecordType + regras', () =>
  sfPost(`${V}/composite/batch`, {
    batchRequests: [
      { method: 'GET', url: `v66.0/query?q=${encodeURIComponent(soql)}` },
      {
        method: 'GET',
        url: `v66.0/query?q=${encodeURIComponent(
          "SELECT RecordTypeDeveloperName__c, TargetField__c, ConditionField__c, Operator__c, Value__c FROM FormFieldRule__c WHERE ObjectApiName__c = 'Case' AND IsActive__c = true"
        )}`,
      },
    ],
  })
);
console.log(`     hasErrors: ${batch.hasErrors} · subrequests: ${batch.results.length}`);
batch.results.forEach((r, i) => console.log(`       [${i}] status=${r.statusCode} totalSize=${r.result?.totalSize}`));
