import { sfGet, sfPost } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const rt = '012Ha000002eNzHIAU';
const kb = (o) => (Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1);

async function medir(nome, fn) {
  const t = Date.now();
  const body = await fn();
  console.log(`  ${nome.padEnd(46)} ${String(kb(body)).padStart(7)} KB  ${String(Date.now() - t).padStart(5)} ms`);
  return body;
}

// quais campos o layout usa
const layout = await sfGet(`${V}/ui-api/layout/Case?recordTypeId=${rt}&mode=Create`);
const campos = [];
for (const s of layout.sections ?? [])
  for (const r of s.layoutRows ?? [])
    for (const i of r.layoutItems ?? [])
      for (const c of i.layoutComponents ?? []) if (c.apiName) campos.push(c.apiName);
console.log(`campos no layout: ${campos.length}\n`);

// 1. FieldDefinition existe na REST PADRAO (batchavel) ou so na Tooling?
console.log('FIELDDEFINITION VIA REST PADRAO');
const todos = `SELECT QualifiedApiName, Label, DataType, ValueTypeId, Length FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'Case'`;
let full;
try {
  full = await medir('todos os campos do Case', () => sfGet(`${V}/query?q=${encodeURIComponent(todos)}`));
  console.log(`     registros: ${full.records.length} (totalSize=${full.totalSize})`);
} catch (e) {
  console.log('     ERRO:', e.message);
}

// 2. So os campos do layout
const lista = campos.map((c) => `'${c}'`).join(',');
const filtrado = `SELECT QualifiedApiName, Label, DataType, ValueTypeId, Length FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'Case' AND QualifiedApiName IN (${lista})`;
let so;
try {
  so = await medir('SO os campos do layout (IN ...)', () => sfGet(`${V}/query?q=${encodeURIComponent(filtrado)}`));
  console.log(`     registros: ${so.records.length}`);
  console.log('\n     amostra do que devolve:');
  for (const r of so.records.slice(0, 5)) {
    console.log(`       ${String(r.QualifiedApiName).padEnd(28)} DataType="${r.DataType}"  ValueTypeId="${r.ValueTypeId}"  Length=${r.Length}`);
  }
} catch (e) {
  console.log('     ERRO:', e.message);
}

// 3. E batchavel?
console.log('\nBATCHAVEL EM /composite/batch?');
try {
  const b = await sfPost(`${V}/composite/batch`, {
    batchRequests: [{ method: 'GET', url: `v66.0/query?q=${encodeURIComponent(filtrado)}` }],
  });
  console.log(`  hasErrors=${b.hasErrors} status=${b.results[0].statusCode} totalSize=${b.results[0].result?.totalSize}`);
} catch (e) {
  console.log('  ERRO:', e.message);
}

// 4. Respeita FLS?
console.log('\nRESPEITA FLS?');
console.log(`  FieldDefinition devolve : ${full?.totalSize ?? '?'} campos do Case`);
const oi = await sfGet(`${V}/ui-api/object-info/Case`);
console.log(`  object-info devolve     : ${Object.keys(oi.fields).length} campos`);

// 5. Comparativo de payload
console.log('\nCOMPARATIVO — como obter os TIPOS dos campos do formulario');
console.log(`  object-info/Case (v1)                    ${String(kb(oi)).padStart(7)} KB`);
if (full) console.log(`  FieldDefinition, todos os campos         ${String(kb(full)).padStart(7)} KB`);
if (so) console.log(`  FieldDefinition, so os do layout         ${String(kb(so)).padStart(7)} KB`);
