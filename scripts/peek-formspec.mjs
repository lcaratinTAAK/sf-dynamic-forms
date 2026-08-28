/**
 * A especificação inteira cabe numa SOQL só?
 *
 * É a pergunta que decide se a fonte custom precisa de Apex REST ou não.
 */
import { soql, sfPost, sfGet } from '../server/salesforce.js';
import { config } from '../server/config.js';

const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));
const kb = (o) => `${(Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1)} KB`;

const CAMPOS = `Id, Name, RecordType.DeveloperName, Form__c, Parent__c, Sort__c, Page__c, Width__c,
  ObjectApiName__c, TargetRecordTypeDevName__c, CaseType__c, Channel__c, PublicLabel__c, Description__c,
  FieldApiName__c, LabelOverride__c, HelpTextOverride__c, Placeholder__c, DefaultValue__c,
  IsRequired__c, IsReadOnly__c,
  DocumentCode__c, AcceptedTypes__c, MinFiles__c, MaxFiles__c, MaxSizeMb__c,
  ConditionFieldApiName__c, Operator__c, Value__c, LogicGroup__c, Effect__c,
  Body__c, IsRepeating__c, ItemLabel__c, AddButtonText__c`.replace(/\s+/g, ' ');

// --- 1. o catálogo (antes da seleção) ---
linha('1) CATÁLOGO — só as raízes');
const cat = await soql(
  `SELECT Id, Name, PublicLabel__c, ObjectApiName__c, TargetRecordTypeDevName__c, CaseType__c, Channel__c ` +
    `FROM SI_FormSpec__c WHERE RecordType.DeveloperName = 'Form' AND IsActive__c = true ORDER BY Name`
);
cat.records.forEach((f) => console.log(`  ${f.Name} [${f.Channel__c}] -> ${f.TargetRecordTypeDevName__c} / Type=${f.CaseType__c}`));
console.log(`  ${kb(cat)}`);

const formId = cat.records[0].Id;

// --- 2. a especificação inteira, UMA query ---
linha('2) ESPECIFICAÇÃO INTEIRA — uma SOQL');
const t0 = Date.now();
const spec = await soql(
  `SELECT ${CAMPOS} FROM SI_FormSpec__c ` +
    `WHERE (Id = '${formId}' OR Form__c = '${formId}') AND IsActive__c = true ` +
    `ORDER BY Sort__c NULLS FIRST`
);
const ms = Date.now() - t0;

const porRt = {};
for (const r of spec.records) {
  const k = r.RecordType.DeveloperName;
  porRt[k] = (porRt[k] || 0) + 1;
}
console.log(`  ${spec.totalSize} registros · ${kb(spec)} · ${ms} ms`);
console.log('  ' + Object.entries(porRt).map(([k, v]) => `${k}=${v}`).join(' · '));

// --- 3. a árvore remontada ---
linha('3) ÁRVORE REMONTADA PELO CONSUMIDOR');
const porId = new Map(spec.records.map((r) => [r.Id, r]));
// Filho direto da raiz é quem tem Parent__c vazio — a raiz não aponta para si.
const filhos = (paiId) =>
  spec.records
    .filter((r) => r.Id !== formId && r.RecordType.DeveloperName !== 'Rule')
    .filter((r) => (paiId === formId ? !r.Parent__c : r.Parent__c === paiId))
    .sort((a, b) => (a.Sort__c ?? 0) - (b.Sort__c ?? 0));
const regrasDe = (id) => spec.records.filter((r) => r.Parent__c === id && r.RecordType.DeveloperName === 'Rule');

const desenha = (id, nivel) => {
  for (const c of filhos(id)) {
    const t = c.RecordType.DeveloperName;
    const rs = regrasDe(c.Id);
    const marca = { Section: '▸', Field: '·', Attachment: '📎', Content: '¶' }[t] || '?';
    const req = c.IsRequired__c ? ' *' : '';
    const cond = rs.length ? `   ⟨se ${rs.map((r) => `${r.ConditionFieldApiName__c} ${r.Operator__c} "${r.Value__c}"`).join(' e ')}⟩` : '';
    console.log('  ' + '   '.repeat(nivel) + `${marca} ${c.FieldApiName__c || c.Name}${req}${cond}`);
    desenha(c.Id, nivel + 1);
  }
};
const raiz = porId.get(formId);
console.log(`  ${raiz.PublicLabel__c}`);
desenha(formId, 1);

// --- 4. as duas chamadas de ui-api que continuam necessárias ---
linha('4) O QUE AINDA VEM DA UI-API');
const rtRow = await soql(
  `SELECT Id FROM RecordType WHERE SobjectType = '${raiz.ObjectApiName__c}' AND DeveloperName = '${raiz.TargetRecordTypeDevName__c}'`
);
const rtId = rtRow.records[0].Id;
for (const [rot, path] of [
  ['object-info (tipos e labels)', `/services/data/v${config.apiVersion}/ui-api/object-info/${raiz.ObjectApiName__c}`],
  ['picklist-values', `/services/data/v${config.apiVersion}/ui-api/object-info/${raiz.ObjectApiName__c}/picklist-values/${rtId}`],
]) {
  const t = Date.now();
  const r = await sfGet(path);
  console.log(`  ${rot.padEnd(30)} ${kb(r).padStart(9)}  ${Date.now() - t} ms`);
}

// --- 5. dá para juntar catálogo + spec + RecordType num composite? ---
linha('5) COMPOSITE — catálogo + spec + RecordType em 1 requisição');
const enc = encodeURIComponent;
const V = `v${config.apiVersion}`;
const b = await sfPost(`/services/data/${V}/composite/batch`, {
  batchRequests: [
    { method: 'GET', url: `${V}/query?q=${enc(`SELECT Id, Name FROM SI_FormSpec__c WHERE RecordType.DeveloperName = 'Form' AND IsActive__c = true`)}` },
    { method: 'GET', url: `${V}/query?q=${enc(`SELECT ${CAMPOS} FROM SI_FormSpec__c WHERE (Id = '${formId}' OR Form__c = '${formId}') AND IsActive__c = true ORDER BY Sort__c NULLS FIRST`)}` },
    { method: 'GET', url: `${V}/query?q=${enc(`SELECT Id, DeveloperName FROM RecordType WHERE SobjectType = 'Case' AND IsActive = true`)}` },
  ],
});
console.log(`  hasErrors=${b.hasErrors}`);
b.results.forEach((s, i) => console.log(`  [${i}] status=${s.statusCode} totalSize=${s.result?.totalSize} campos=${Object.keys(s.result?.records?.[0] ?? {}).filter((k) => k !== 'attributes').length}`));
console.log(`  total: ${kb(b)}`);
