import { sfGet } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

linha('COMO É HOJE — Tooling Flow (o que listScreenFlows faz)');
const tool = await sfGet(
  `${V}/tooling/query?q=` +
    encodeURIComponent(
      `SELECT Id, MasterLabel, Status, VersionNumber, DefinitionId FROM Flow WHERE MasterLabel LIKE 'SI Demo%' ORDER BY VersionNumber`
    )
);
for (const f of tool.records) {
  console.log(`  v${f.VersionNumber}  Id=${f.Id}  [${f.Status}]  DefinitionId=${f.DefinitionId}`);
}
console.log('\n  => o Id MUDA a cada deploy. O Id antigo continua respondendo,');
console.log('     servindo a definição velha sem erro nenhum.');

linha('A ALTERNATIVA — FlowDefinitionView (SOQL padrão)');
const view = await sfGet(
  `${V}/query?q=` +
    encodeURIComponent(
      `SELECT DurableId, ApiName, Label, IsActive, Description FROM FlowDefinitionView WHERE Label LIKE 'SI Demo%'`
    )
);
for (const f of view.records) {
  console.log(`  ApiName=${f.ApiName}`);
  console.log(`  DurableId=${f.DurableId}   (prefixo 300 = a DEFINIÇÃO, não a versão)`);
  console.log(`  IsActive=${f.IsActive}`);
}
console.log('\n  => ApiName e DurableId são ESTÁVEIS. Não mudam com deploy.');

linha('RESOLVENDO: da definição para a versão ativa');
const def = view.records[0];
const ativa = await sfGet(
  `${V}/tooling/query?q=` +
    encodeURIComponent(
      `SELECT Id, VersionNumber, Status FROM Flow WHERE DefinitionId = '${def.DurableId}' AND Status = 'Active'`
    )
);
console.log(`  DefinitionId ${def.DurableId}`);
console.log(`    -> versão ativa: v${ativa.records[0]?.VersionNumber}  Id=${ativa.records[0]?.Id}`);
console.log('\n  => sempre a versão corrente, sem hardcode de Id de versão.');

linha('O QUE CADA UMA SERVE');
console.log('  FlowDefinitionView  descoberta / listagem  · SOQL padrão · batchável · Id estável');
console.log('  Tooling Flow        ler a definição        · não batchável · Id por versão · Metadata');
