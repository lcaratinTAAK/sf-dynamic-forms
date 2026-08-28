/**
 * ATENÇÃO: este script olha apenas statusCode e totalSize.
 *
 * O caso 1 abaixo "passa" — e a conclusão que se tira dele está ERRADA. O
 * `/composite/batch` aceita a query Tooling e devolve 200 com o totalSize
 * certo, mas descarta todos os campos selecionados: os registros voltam só com
 * `attributes`. Ver `peek-batch-tooling-campos.mjs`, que abre os registros.
 *
 * O valor que sobra aqui são os casos 2, 3 e 4: o comportamento do `/composite`
 * e do `/tooling/composite`, que o outro script não cobre.
 */
import { sfPost } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const linha = (t) => console.log('\n' + '='.repeat(74) + '\n' + t + '\n' + '='.repeat(74));

const soqlPadrao = `SELECT Id, DeveloperName FROM RecordType WHERE SobjectType = 'Case' LIMIT 2`;
const soqlTooling = `SELECT Id, MasterLabel FROM Flow WHERE ProcessType = 'Flow' AND Status = 'Active' LIMIT 2`;

// ---------------------------------------------------------------------------
linha('1) /composite/batch — misturando query padrão + tooling/query');
try {
  const r = await sfPost(`${V}/composite/batch`, {
    batchRequests: [
      { method: 'GET', url: `v66.0/query?q=${encodeURIComponent(soqlPadrao)}` },
      { method: 'GET', url: `v66.0/tooling/query?q=${encodeURIComponent(soqlTooling)}` },
    ],
  });
  console.log(`hasErrors=${r.hasErrors}`);
  r.results.forEach((s, i) => {
    const corpo = Array.isArray(s.result) ? s.result[0] : s.result;
    console.log(`  [${i}] status=${s.statusCode} ${s.statusCode === 200 ? `totalSize=${corpo?.totalSize}` : `${corpo?.errorCode}: ${corpo?.message}`}`);
  });
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('2) /composite — misturando query padrão + tooling/query');
try {
  const r = await sfPost(`${V}/composite`, {
    allOrNone: false,
    compositeRequest: [
      { method: 'GET', url: `${V}/query?q=${encodeURIComponent(soqlPadrao)}`, referenceId: 'padrao' },
      { method: 'GET', url: `${V}/tooling/query?q=${encodeURIComponent(soqlTooling)}`, referenceId: 'tooling' },
    ],
  });
  r.compositeResponse.forEach((s) => {
    const corpo = Array.isArray(s.body) ? s.body[0] : s.body;
    console.log(`  ${s.referenceId.padEnd(8)} status=${s.httpStatusCode} ${s.httpStatusCode === 200 ? `totalSize=${corpo?.totalSize}` : `${corpo?.errorCode}: ${corpo?.message}`}`);
  });
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('3) Existe /tooling/composite? (só Tooling entre si)');
try {
  const r = await sfPost(`${V}/tooling/composite`, {
    allOrNone: false,
    compositeRequest: [
      { method: 'GET', url: `${V}/tooling/query?q=${encodeURIComponent(soqlTooling)}`, referenceId: 'f1' },
      {
        method: 'GET',
        url: `${V}/tooling/query?q=${encodeURIComponent(`SELECT Id, DeveloperName FROM FlexiPage LIMIT 2`)}`,
        referenceId: 'f2',
      },
    ],
  });
  console.log('FUNCIONA:');
  r.compositeResponse?.forEach((s) => {
    const corpo = Array.isArray(s.body) ? s.body[0] : s.body;
    console.log(`  ${s.referenceId} status=${s.httpStatusCode} ${s.httpStatusCode === 200 ? `size=${corpo?.size ?? corpo?.totalSize}` : `${corpo?.errorCode}: ${corpo?.message}`}`);
  });
} catch (e) {
  console.log('ERRO:', e.message);
}

// ---------------------------------------------------------------------------
linha('4) /tooling/composite aceita uma query PADRÃO no meio?');
try {
  const r = await sfPost(`${V}/tooling/composite`, {
    allOrNone: false,
    compositeRequest: [
      { method: 'GET', url: `${V}/tooling/query?q=${encodeURIComponent(soqlTooling)}`, referenceId: 'tooling' },
      { method: 'GET', url: `${V}/query?q=${encodeURIComponent(soqlPadrao)}`, referenceId: 'padrao' },
    ],
  });
  r.compositeResponse?.forEach((s) => {
    const corpo = Array.isArray(s.body) ? s.body[0] : s.body;
    console.log(`  ${s.referenceId.padEnd(8)} status=${s.httpStatusCode} ${s.httpStatusCode === 200 ? `size=${corpo?.size ?? corpo?.totalSize}` : `${corpo?.errorCode}: ${corpo?.message}`}`);
  });
} catch (e) {
  console.log('ERRO:', e.message);
}
