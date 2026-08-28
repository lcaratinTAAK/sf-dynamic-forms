import { discoverFormCatalog } from '../server/salesforce.js';

const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

for (const source of [null, 'SCREEN_FLOW', 'LAYOUT']) {
  linha(`source = ${source ?? '(todos)'}`);
  const r = await discoverFormCatalog({ objectApiName: 'Case', source });

  console.log(`subrequests: ${r.raw.results.map((s) => s.statusCode).join(', ')}  ·  hasErrors=${r.raw.hasErrors}`);
  if (r.warnings.length) console.log('avisos:', r.warnings);

  for (const f of r.forms) {
    console.log(`\n  "${f.label}"  [${f.source} · ${f.channel}]`);
    console.log(`    RecordType : ${f.recordType.developerName} -> ${f.recordType.id}  (${f.recordType.label})`);
    console.log(`    Case.Type  : ${f.caseType}`);
    console.log(
      `    Flow       : ${f.flow ? `${f.flow.apiName} -> ${f.flow.versionId} (ativa)` : '—'}`
    );
    if (f.problems.length) console.log(`    PROBLEMAS  : ${f.problems.join(' | ')}`);
  }
}

linha('tamanho da resposta');
const r = await discoverFormCatalog({ objectApiName: 'Case', source: 'SCREEN_FLOW' });
const bytes = Buffer.byteLength(JSON.stringify(r.raw), 'utf8');
console.log(`  ${(bytes / 1024).toFixed(1)} KB em 1 requisição HTTP (3 subrequests)`);
