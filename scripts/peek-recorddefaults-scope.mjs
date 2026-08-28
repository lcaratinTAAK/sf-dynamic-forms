import { sfGet } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const rt = '012Ha000002eNzHIAU';
const kb = (o) => (Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(0);

const rd = await sfGet(`${V}/ui-api/record-defaults/create/Case?recordTypeId=${rt}`);
const oi = await sfGet(`${V}/ui-api/object-info/Case`);

// quantos campos o LAYOUT realmente usa
const doLayout = new Set();
for (const s of rd.layout?.sections ?? [])
  for (const r of s.layoutRows ?? [])
    for (const i of r.layoutItems ?? [])
      for (const c of i.layoutComponents ?? []) if (c.apiName) doLayout.add(c.apiName);

const camposRD = Object.keys(rd.objectInfos?.Case?.fields ?? {});
const camposOI = Object.keys(oi.fields ?? {});

console.log('CAMPOS');
console.log(`  no layout deste Record Type           : ${doLayout.size}`);
console.log(`  em record-defaults.objectInfos.Case   : ${camposRD.length}`);
console.log(`  em object-info/Case (chamada separada): ${camposOI.length}`);
console.log(`  => record-defaults traz ${camposRD.length === camposOI.length ? 'O OBJETO INTEIRO' : 'um subconjunto'}`);

console.log('\nOBJECTINFOS ANINHADOS (tamanho de cada)');
let soma = 0;
for (const [nome, info] of Object.entries(rd.objectInfos ?? {})) {
  const n = Object.keys(info.fields ?? {}).length;
  soma += Number(kb(info));
  console.log(`  ${nome.padEnd(16)} ${String(n).padStart(4)} campos   ${String(kb(info)).padStart(5)} KB`);
}

console.log('\nCOMPOSIÇÃO DA RESPOSTA');
for (const chave of ['layout', 'objectInfos', 'record']) {
  console.log(`  ${chave.padEnd(12)} ${String(kb(rd[chave])).padStart(5)} KB`);
}
console.log(`  ${'TOTAL'.padEnd(12)} ${String(kb(rd)).padStart(5)} KB`);
console.log(`\n  objectInfos é ${((Number(kb(rd.objectInfos)) / Number(kb(rd))) * 100).toFixed(0)}% da resposta`);

// dá para pedir menos?
console.log('\nEXISTE COMO ENXUGAR?');
const comOptional = await sfGet(
  `${V}/ui-api/record-defaults/create/Case?recordTypeId=${rt}&optionalFields=Case.Subject`
).catch((e) => ({ erro: e.message }));
console.log(`  ?optionalFields=...  ${comOptional.erro ? 'erro: ' + comOptional.erro : kb(comOptional) + ' KB (optionalFields só ACRESCENTA campos)'}`);
