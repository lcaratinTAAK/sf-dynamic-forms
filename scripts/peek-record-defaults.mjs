import { sfGet } from '../server/salesforce.js';

const rt = '012Ha000002eNzHIAU';
const V = '/services/data/v66.0';

async function medir(nome, path) {
  const t = Date.now();
  const body = await sfGet(path);
  const kb = Buffer.byteLength(JSON.stringify(body), 'utf8') / 1024;
  console.log(`  ${nome.padEnd(34)} ${kb.toFixed(0).padStart(6)} KB  ${String(Date.now() - t).padStart(5)} ms`);
  return body;
}

console.log('FLUXO ATUAL (3 chamadas):');
await medir('object-info/Case', `${V}/ui-api/object-info/Case`);
await medir('layout?recordTypeId&mode=Create', `${V}/ui-api/layout/Case?recordTypeId=${rt}&mode=Create`);
await medir('picklist-values/{rt}', `${V}/ui-api/object-info/Case/picklist-values/${rt}`);

console.log('\nALTERNATIVA record-defaults/create:');
const rd = await medir('record-defaults/create/Case', `${V}/ui-api/record-defaults/create/Case?recordTypeId=${rt}`);

console.log('\n  devolve            :', Object.keys(rd).join(', '));
console.log('  objectInfos        :', Object.keys(rd.objectInfos ?? {}).join(', '));
console.log('  layout             :', `layoutType=${rd.layout?.layoutType} mode=${rd.layout?.mode} secoes=${rd.layout?.sections?.length}`);

const raw = JSON.stringify(rd);
console.log('  valores de picklist?', raw.includes('BancoDigital') ? 'SIM' : 'NAO');
console.log('  recordTypeInfos?   ', rd.objectInfos?.Case?.recordTypeInfos ? 'SIM' : 'NAO');

const campos = rd.record?.fields ?? {};
const comDefault = Object.entries(campos).filter(([, v]) => v?.value !== null && v?.value !== undefined);
console.log('  campos com default :', comDefault.map(([k]) => k).join(', ') || '(nenhum)');
