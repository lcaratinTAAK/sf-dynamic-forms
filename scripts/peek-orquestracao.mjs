import { sfGet } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const rt = '012Ha000002eNzHIAU';
const kb = (o) => Number((Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1));

const layoutUrl = `${V}/ui-api/layout/Case?recordTypeId=${rt}&mode=Create`;
const picklistUrl = `${V}/ui-api/object-info/Case/picklist-values/${rt}`;

const camposDoLayout = (layout) => {
  const out = [];
  for (const s of layout.sections ?? [])
    for (const r of s.layoutRows ?? [])
      for (const i of r.layoutItems ?? [])
        for (const c of i.layoutComponents ?? []) if (c.apiName) out.push(c.apiName);
  return out;
};

const fieldDefUrl = (campos) =>
  `${V}/query?q=` +
  encodeURIComponent(
    `SELECT QualifiedApiName, Label, DataType, Length FROM FieldDefinition ` +
      `WHERE EntityDefinition.QualifiedApiName = 'Case' ` +
      `AND QualifiedApiName IN (${campos.map((c) => `'${c}'`).join(',')})`
  );

// ---------------------------------------------------------------------------
console.log('A) SEQUENCIAL — layout, depois FieldDefinition, depois picklists');
let t = Date.now();
let layout = await sfGet(layoutUrl);
const campos = camposDoLayout(layout);
const fd1 = await sfGet(fieldDefUrl(campos));
const pk1 = await sfGet(picklistUrl);
console.log(`   ${Date.now() - t} ms · ${(kb(layout) + kb(fd1) + kb(pk1)).toFixed(1)} KB\n`);

// ---------------------------------------------------------------------------
console.log('B) PARALELO — layout e picklists juntos (picklists NÃO depende do layout)');
t = Date.now();
const [layout2, pk2] = await Promise.all([sfGet(layoutUrl), sfGet(picklistUrl)]);
const fd2 = await sfGet(fieldDefUrl(camposDoLayout(layout2)));
console.log(`   ${Date.now() - t} ms · ${(kb(layout2) + kb(fd2) + kb(pk2)).toFixed(1)} KB\n`);

// ---------------------------------------------------------------------------
console.log('C) PICKLISTS POR CAMPO — só as do formulário, em paralelo');
const picklistFields = Object.keys(pk2.picklistFieldValues ?? {}).filter((f) => campos.includes(f));
console.log(`   picklists no objeto: ${Object.keys(pk2.picklistFieldValues ?? {}).length} · usadas pelo formulário: ${picklistFields.length}`);
t = Date.now();
const porCampo = await Promise.all(
  picklistFields.map((f) => sfGet(`${V}/ui-api/object-info/Case/picklist-values/${rt}/${f}`))
);
const somaPorCampo = porCampo.reduce((acc, p) => acc + kb(p), 0);
console.log(`   ${Date.now() - t} ms · ${somaPorCampo.toFixed(1)} KB em ${porCampo.length} chamadas`);
console.log(`   (contra ${kb(pk2)} KB numa chamada só)\n`);

// ---------------------------------------------------------------------------
console.log('D) FIELDDEFINITION GLOBAL — todos os campos, cacheável como o object-info');
t = Date.now();
const fdAll = await sfGet(
  `${V}/query?q=` +
    encodeURIComponent(
      `SELECT QualifiedApiName, Label, DataType, Length FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'Case'`
    )
);
console.log(`   ${Date.now() - t} ms · ${kb(fdAll)} KB · ${fdAll.totalSize} campos`);
const oi = await sfGet(`${V}/ui-api/object-info/Case`);
console.log(`   object-info equivalente: ${kb(oi)} KB\n`);

// ---------------------------------------------------------------------------
console.log('RESUMO — custo por SELEÇÃO de formulário (assumindo schema em cache)');
console.log(`   v1  layout + picklists                     ${(kb(layout) + kb(pk2)).toFixed(1)} KB`);
console.log(`   v2  layout + FieldDefinition + picklists    ${(kb(layout) + kb(fd2) + kb(pk2)).toFixed(1)} KB`);
console.log(`   v2' layout + FieldDefinition + por-campo    ${(kb(layout) + kb(fd2) + somaPorCampo).toFixed(1)} KB`);
