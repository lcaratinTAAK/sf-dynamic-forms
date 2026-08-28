import { sfGet } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const rt = '012Ha000002eNzHIAU';

// pega os campos do layout para montar o IN(...)
const layout = await sfGet(`${V}/ui-api/layout/Case?recordTypeId=${rt}&mode=Create`);
const campos = [];
for (const s of layout.sections ?? [])
  for (const r of s.layoutRows ?? [])
    for (const i of r.layoutItems ?? [])
      for (const c of i.layoutComponents ?? []) if (c.apiName) campos.push(c.apiName);

const soql =
  `SELECT QualifiedApiName, Label, DataType, ValueTypeId, Length, IsNillable, IsCalculated ` +
  `FROM FieldDefinition ` +
  `WHERE EntityDefinition.QualifiedApiName = 'Case' ` +
  `AND QualifiedApiName IN (${campos.map((c) => `'${c}'`).join(',')})`;

console.log('='.repeat(78));
console.log('SOQL');
console.log('='.repeat(78));
console.log(soql);

console.log('\n' + '='.repeat(78));
console.log('REQUISIÇÃO');
console.log('='.repeat(78));
console.log('GET ' + `${V}/query?q=${encodeURIComponent(soql)}`);
console.log('\nHeaders:');
console.log('  Authorization: Bearer <token>');
console.log('  Accept: application/json');
console.log('\n(não é Tooling API — é o /query padrão, o mesmo usado para SOQL de dados)');

const res = await sfGet(`${V}/query?q=${encodeURIComponent(soql)}`);

console.log('\n' + '='.repeat(78));
console.log('RESPOSTA — envelope');
console.log('='.repeat(78));
console.log(JSON.stringify({ totalSize: res.totalSize, done: res.done }, null, 2));

console.log('\n' + '='.repeat(78));
console.log('RESPOSTA — 3 registros representativos');
console.log('='.repeat(78));
const amostra = res.records.filter((r) =>
  ['SI_BankType__c', 'SI_Email__c', 'SI_FullName__c'].includes(r.QualifiedApiName)
);
console.log(JSON.stringify(amostra, null, 2));

console.log('\n' + '='.repeat(78));
console.log('TODOS os 23, resumido');
console.log('='.repeat(78));
for (const r of res.records) {
  console.log(
    `  ${String(r.QualifiedApiName).padEnd(30)} DataType=${String(r.DataType).padEnd(22)} ValueTypeId=${String(r.ValueTypeId).padEnd(10)} Len=${r.Length}`
  );
}
