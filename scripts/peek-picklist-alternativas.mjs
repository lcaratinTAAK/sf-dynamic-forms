import { sfGet, sfPost } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const rt = '012Ha000002eNzHIAU';
const campo = 'CaseToBeHandled__c'; // picklist dependente, 89 valores
const kb = (o) => (Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1);
const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

// ---------------------------------------------------------------------------
linha('1) EntityParticle — SOQL padrão. Tem a relação de dependência?');
try {
  const q =
    `SELECT QualifiedApiName, DataType, IsDependentPicklist, ControllerName, ` +
    `IsPicklistValueSetInherited FROM EntityParticle ` +
    `WHERE EntityDefinition.QualifiedApiName = 'Case' AND QualifiedApiName = '${campo}'`;
  const r = await sfGet(`${V}/query?q=${encodeURIComponent(q)}`);
  console.log(JSON.stringify(r.records?.[0], null, 2));
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('2) PicklistValueInfo (Tooling) — traz valores + validFor?');
try {
  const q =
    `SELECT Value, Label, IsActive, IsDefaultValue, ValidFor, DurableId ` +
    `FROM PicklistValueInfo WHERE EntityParticleId = 'Case.${campo}' LIMIT 5`;
  const r = await sfGet(`${V}/tooling/query?q=${encodeURIComponent(q)}`);
  console.log(`registros: ${r.size}`);
  console.log(JSON.stringify(r.records?.slice(0, 3), null, 2));
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('3) /sobjects/Case/describe — é batchável e tem dependência?');
try {
  const t = Date.now();
  const d = await sfGet(`${V}/sobjects/Case/describe`);
  const f = d.fields.find((x) => x.name === campo);
  console.log(`describe completo: ${kb(d)} KB · ${Date.now() - t} ms`);
  console.log(`\ncampo ${campo}:`);
  console.log(
    JSON.stringify(
      {
        type: f?.type,
        dependentPicklist: f?.dependentPicklist,
        controllerName: f?.controllerName,
        restrictedPicklist: f?.restrictedPicklist,
        qtdValores: f?.picklistValues?.length,
      },
      null,
      2
    )
  );
  console.log('\nprimeiros valores (repare no validFor):');
  console.log(JSON.stringify(f?.picklistValues?.slice(0, 3), null, 2));
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('4) describe entra em /composite/batch?');
try {
  const b = await sfPost(`${V}/composite/batch`, {
    batchRequests: [{ method: 'GET', url: 'v66.0/sobjects/Case/describe' }],
  });
  console.log(`hasErrors=${b.hasErrors} · status=${b.results[0].statusCode}`);
  if (b.results[0].statusCode >= 300) console.log(JSON.stringify(b.results[0].result));
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('5) O describe respeita o Record Type?');
const uiRt = await sfGet(`${V}/ui-api/object-info/Case/picklist-values/${rt}/${campo}`);
const d2 = await sfGet(`${V}/sobjects/Case/describe`);
const fd = d2.fields.find((x) => x.name === campo);
console.log(`  ui-api, Record Type SI_Demo : ${uiRt.values.length} valores`);
console.log(`  describe (sem Record Type)  : ${fd.picklistValues.length} valores`);
console.log(
  `  => describe ${fd.picklistValues.length === uiRt.values.length ? 'coincide neste caso' : 'IGNORA o Record Type'}`
);
