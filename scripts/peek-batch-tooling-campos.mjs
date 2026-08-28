/**
 * O `/composite/batch` aceita query Tooling e devolve 200 + totalSize correto,
 * mas devolve os REGISTROS? E a FlowDefinitionView (objeto padrão) resolve?
 */
import { sfPost, sfGet } from '../server/salesforce.js';
import { config } from '../server/config.js';

const V = `v${config.apiVersion}`;
const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

const casos = [
  ['Tooling · campos simples', 'tooling/query', "SELECT Id, MasterLabel FROM Flow WHERE Status = 'Active' LIMIT 3"],
  ['Tooling · relacionamento', 'tooling/query', "SELECT Id, Definition.DeveloperName FROM Flow WHERE Status = 'Active' LIMIT 3"],
  ['Tooling · outro objeto', 'tooling/query', 'SELECT Id, DeveloperName FROM FlexiPage LIMIT 3'],
  ['PADRÃO · RecordType (controle)', 'query', "SELECT Id, DeveloperName, Name FROM RecordType WHERE SobjectType = 'Case' LIMIT 3"],
  [
    'PADRÃO · FlowDefinitionView (a alternativa)',
    'query',
    "SELECT DurableId, ApiName, Label, ActiveVersionId FROM FlowDefinitionView WHERE ProcessType = 'Flow' AND IsActive = true LIMIT 3",
  ],
];

for (const [nome, recurso, q] of casos) {
  linha(nome);
  console.log(`  ${q}`);

  const b = await sfPost(`/services/data/${V}/composite/batch`, {
    batchRequests: [{ method: 'GET', url: `${V}/${recurso}?q=${encodeURIComponent(q)}` }],
  });
  const r = b.results[0];
  const solto = await sfGet(`/services/data/${V}/${recurso}?q=${encodeURIComponent(q)}`);

  const chaves = (rec) => Object.keys(rec ?? {}).filter((k) => k !== 'attributes');
  const noBatch = chaves(r.result?.records?.[0]);
  const naSolta = chaves(solto.records?.[0]);

  console.log(`\n  BATCH  status=${r.statusCode} totalSize=${r.result?.totalSize}  campos=[${noBatch.join(', ')}]`);
  console.log(`  SOLTA  totalSize=${solto.totalSize}  campos=[${naSolta.join(', ')}]`);
  console.log(`  => ${noBatch.length === naSolta.length && noBatch.length > 0 ? 'OK — batchável' : 'PERDEU DADO'}`);
  if (noBatch.length) console.log(`     ex.: ${JSON.stringify(r.result.records[0])}`.slice(0, 260));
}

linha('a query que a POC precisa: ApiName -> versão ativa, DENTRO do batch');
const q =
  "SELECT ApiName, Label, ActiveVersionId FROM FlowDefinitionView " +
  "WHERE ProcessType = 'Flow' AND IsActive = true AND ApiName = 'SI_Demo_BankDataChange_Form'";
const b = await sfPost(`/services/data/${V}/composite/batch`, {
  batchRequests: [{ method: 'GET', url: `${V}/query?q=${encodeURIComponent(q)}` }],
});
console.log(JSON.stringify(b.results[0].result?.records ?? b.results[0], null, 2));
