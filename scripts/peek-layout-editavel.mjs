/**
 * Dá para LER e ALTERAR um Page Layout por API?
 *
 * Duas candidatas:
 *   Tooling API   Layout como sObject, REST, com campo Metadata
 *   Metadata API  SOAP, o caminho canônico
 *
 * Só leitura aqui. Nada é alterado.
 */
import { sfGet, toolingSoql } from '../server/salesforce.js';
import { config } from '../server/config.js';

const V = `/services/data/v${config.apiVersion}`;
const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));
const kb = (o) => `${(Buffer.byteLength(JSON.stringify(o), 'utf8') / 1024).toFixed(1)} KB`;

// ---------------------------------------------------------------------------
linha('1) Tooling API lista Layouts?');
let layouts = null;
try {
  layouts = await toolingSoql(
    "SELECT Id, Name, TableEnumOrId FROM Layout WHERE TableEnumOrId = 'Case' ORDER BY Name LIMIT 200"
  );
  console.log(`  ${layouts.totalSize} layouts de Case`);
  const demo = layouts.records.filter((l) => /SI Demo/i.test(l.Name));
  demo.forEach((l) => console.log(`  DEMO -> ${l.Id}  "${l.Name}"`));
  if (!demo.length) console.log('  (nenhum "SI Demo" — mostrando os 3 primeiros)');
  layouts.records.slice(0, 3).forEach((l) => console.log(`         ${l.Id}  "${l.Name}"`));
} catch (e) {
  console.log('  FALHOU:', e.message.slice(0, 200));
}

// ---------------------------------------------------------------------------
linha('2) O Metadata do layout vem completo?');
const alvo =
  layouts?.records?.find((l) => /SI Demo/i.test(l.Name)) ?? layouts?.records?.[0] ?? null;

if (alvo) {
  try {
    const det = await sfGet(`${V}/tooling/sobjects/Layout/${alvo.Id}`);
    const m = det.Metadata;
    console.log(`  "${alvo.Name}"  ${kb(det)}`);
    console.log(`  chaves do Metadata: ${Object.keys(m ?? {}).join(', ')}`);
    const secoes = m?.layoutSections ?? [];
    console.log(`  seções: ${secoes.length}`);
    secoes.slice(0, 4).forEach((s) => {
      const campos = (s.layoutColumns ?? []).flatMap((c) =>
        (c.layoutItems ?? []).map((i) => `${i.field}${i.behavior === 'Required' ? '*' : ''}`)
      );
      console.log(`    "${s.label}" (${s.style}) -> ${campos.length} campos`);
      console.log(`       ${campos.slice(0, 6).join(', ')}`);
    });
  } catch (e) {
    console.log('  FALHOU ao ler Metadata:', e.message.slice(0, 300));
  }
}

// ---------------------------------------------------------------------------
linha('3) Existe ProfileLayout / atribuição de layout por profile?');
for (const q of [
  'SELECT Id, Layout, Profile, RecordType FROM ProfileLayout LIMIT 3',
  "SELECT Id, LayoutId, ProfileId, RecordTypeId FROM ProfileLayout WHERE Layout.TableEnumOrId = 'Case' LIMIT 3",
]) {
  try {
    const r = await toolingSoql(q);
    console.log(`  OK: ${q.slice(0, 60)}…  -> ${r.totalSize} registro(s)`);
    if (r.records[0]) console.log('     ' + JSON.stringify(r.records[0]).slice(0, 260));
    break;
  } catch (e) {
    console.log(`  falhou: ${e.message.split('\n')[0].slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------------------
linha('4) Quem é o usuário que a POC usa, e ele enxerga qual layout?');
const eu = await sfGet(`${V}/chatter/users/me`).catch(() => null);
console.log(`  usuário da POC: ${eu?.displayName} (${eu?.username})`);
const rt = await sfGet(
  `${V}/query?q=${encodeURIComponent(
    "SELECT Id, Name FROM RecordType WHERE SobjectType='Case' AND DeveloperName='SI_Demo_BankDataChange'"
  )}`
);
const rtId = rt.records[0]?.Id;
const lay = await sfGet(`${V}/ui-api/layout/Case?recordTypeId=${rtId}&mode=Create`);
console.log(`  ui-api/layout devolve ${lay.sections?.length} seções:`);
(lay.sections ?? []).forEach((s) => console.log(`    "${s.heading}"`));
