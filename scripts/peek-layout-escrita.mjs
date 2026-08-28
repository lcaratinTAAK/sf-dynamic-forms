/**
 * A Tooling API aceita GRAVAR um Page Layout?
 *
 * Teste de ida e volta no layout da DEMO:
 *   1. lê o Metadata
 *   2. devolve IDÊNTICO (prova permissão de escrita sem mudar nada)
 *   3. faz uma alteração real e reversível, confere, e desfaz
 *
 * Só mexe em "SI Demo Bank Data Change". Se não achar, aborta.
 */
import { sfGet, sfPost, toolingSoql } from '../server/salesforce.js';
import { config } from '../server/config.js';

const V = `/services/data/v${config.apiVersion}`;
const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

/** PATCH via override, porque o cliente da POC só tem GET e POST. */
async function sfPatch(path, body) {
  return sfPost(`${path}?_HttpMethod=PATCH`, body);
}

const achados = await toolingSoql(
  "SELECT Id, Name FROM Layout WHERE TableEnumOrId = 'Case' AND Name LIKE 'SI Demo%'"
);
if (!achados.totalSize) {
  console.log('Layout da demo não encontrado. Abortando para não tocar em layout alheio.');
  process.exit(0);
}
const alvo = achados.records[0];
console.log(`alvo: "${alvo.Name}"  ${alvo.Id}`);

// ---------------------------------------------------------------------------
linha('1) Ler');
const antes = await sfGet(`${V}/tooling/sobjects/Layout/${alvo.Id}`);
const secoesAntes = (antes.Metadata.layoutSections ?? []).map((s) => s.label);
console.log('  seções:', JSON.stringify(secoesAntes));

// ---------------------------------------------------------------------------
linha('2) Regravar IDÊNTICO — prova escrita sem alterar nada');
try {
  await sfPatch(`${V}/tooling/sobjects/Layout/${alvo.Id}`, { Metadata: antes.Metadata });
  console.log('  ACEITO — a Tooling grava layout.');
} catch (e) {
  console.log('  RECUSADO:', e.message.slice(0, 400));
  console.log('\n  => a Tooling NÃO serve para escrita; resta a Metadata API (SOAP).');
  process.exit(0);
}

// ---------------------------------------------------------------------------
linha('3) Alteração real e reversível: renomear uma seção');
const ORIGINAL = 'Identificação';
const TEMP = 'Identificação (teste de escrita)';

const comMudanca = JSON.parse(JSON.stringify(antes.Metadata));
const sec = comMudanca.layoutSections.find((s) => s.label === ORIGINAL);
if (!sec) {
  console.log(`  seção "${ORIGINAL}" não encontrada; pulando.`);
  process.exit(0);
}
sec.label = TEMP;

await sfPatch(`${V}/tooling/sobjects/Layout/${alvo.Id}`, { Metadata: comMudanca });
const depois = await sfGet(`${V}/tooling/sobjects/Layout/${alvo.Id}`);
const mudou = (depois.Metadata.layoutSections ?? []).some((s) => s.label === TEMP);
console.log(`  renomeou? ${mudou ? 'SIM' : 'não'}`);

// a UI API já enxerga a mudança?
const rt = await sfGet(
  `${V}/query?q=${encodeURIComponent(
    "SELECT Id FROM RecordType WHERE SobjectType='Case' AND DeveloperName='SI_Demo_BankDataChange'"
  )}`
);
const lay = await sfGet(`${V}/ui-api/layout/Case?recordTypeId=${rt.records[0].Id}&mode=Create`);
console.log('  ui-api enxerga:', JSON.stringify((lay.sections ?? []).map((s) => s.heading)));

// ---------------------------------------------------------------------------
linha('4) Desfazer');
await sfPatch(`${V}/tooling/sobjects/Layout/${alvo.Id}`, { Metadata: antes.Metadata });
const final = await sfGet(`${V}/tooling/sobjects/Layout/${alvo.Id}`);
console.log('  seções:', JSON.stringify((final.Metadata.layoutSections ?? []).map((s) => s.label)));
console.log(
  '  restaurado?',
  JSON.stringify((final.Metadata.layoutSections ?? []).map((s) => s.label)) === JSON.stringify(secoesAntes)
    ? 'SIM'
    : 'NÃO — CONFERIR À MÃO'
);
