import { sfGet, sfPost } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const flowId = '301Ha000010Os5GIAS';
const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

// ---------------------------------------------------------------------------
linha('1) FlowDefinitionView — objeto PADRÃO, logo batchável. Existe?');
try {
  const q =
    `SELECT DurableId, ApiName, Label, ProcessType, IsActive, IsTemplate, Description ` +
    `FROM FlowDefinitionView WHERE ProcessType = 'Flow' AND IsActive = true ORDER BY Label`;
  const r = await sfGet(`${V}/query?q=${encodeURIComponent(q)}`);
  console.log(`registros: ${r.totalSize}`);
  const demo = r.records.find((x) => String(x.Label).includes('SI Demo'));
  console.log('\nnosso flow:');
  console.log(JSON.stringify(demo, null, 2));
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('2) FlowDefinitionView entra em /composite/batch?');
try {
  const q = `SELECT ApiName, Label FROM FlowDefinitionView WHERE ProcessType = 'Flow' AND IsActive = true`;
  const b = await sfPost(`${V}/composite/batch`, {
    batchRequests: [{ method: 'GET', url: `v66.0/query?q=${encodeURIComponent(q)}` }],
  });
  console.log(`hasErrors=${b.hasErrors} · status=${b.results[0].statusCode} · totalSize=${b.results[0].result?.totalSize}`);
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('3) O Flow pode declarar o próprio Record Type? (constants / variables)');
const flow = await sfGet(`${V}/tooling/sobjects/Flow/${flowId}`);
const m = flow.Metadata;
console.log('chaves do Metadata que podem carregar um valor fixo:');
for (const chave of ['constants', 'variables', 'formulas', 'textTemplates', 'processMetadataValues']) {
  const v = m[chave];
  console.log(`  ${chave.padEnd(22)} ${Array.isArray(v) ? `${v.length} item(ns)` : JSON.stringify(v)}`);
}
console.log('\nconstants[] hoje:');
console.log(JSON.stringify(m.constants ?? [], null, 2));
console.log('\nvariables[] hoje:');
console.log(JSON.stringify(m.variables ?? [], null, 2));
console.log('\ndescription do flow (poderia carregar convenção):');
console.log(`  "${flow.Description ?? m.description ?? '(vazio)'}"`);

// ---------------------------------------------------------------------------
linha('4) Existe algum campo do Flow que já aponte para Record Type?');
const raw = JSON.stringify(flow);
for (const termo of ['recordType', 'RecordType', '012Ha']) {
  const n = (raw.match(new RegExp(termo, 'g')) ?? []).length;
  console.log(`  "${termo}": ${n} ocorrência(s)`);
}
