import { sfGet, sfPost } from '../server/salesforce.js';

const V = '/services/data/v66.0';
const q = `SELECT Id FROM RecordType WHERE SobjectType = 'Case' LIMIT 1`;
const N = 25; // máximo de subrequests
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// O contador DailyApiRequests atualiza com atraso. Espera antes de cada leitura.
const restantes = async () => {
  await espera(4000);
  return (await sfGet(`${V}/limits`)).DailyApiRequests.Remaining;
};

console.log(`medindo com N=${N} subrequests, 4s de espera entre leituras...\n`);

const base = await restantes();

await sfPost(`${V}/composite`, {
  allOrNone: false,
  compositeRequest: Array.from({ length: N }, (_, i) => ({
    method: 'GET',
    url: `${V}/query?q=${encodeURIComponent(q)}`,
    referenceId: `r${i}`,
  })),
});
const apos1 = await restantes();
const custoComposite = base - apos1;

await sfPost(`${V}/composite/batch`, {
  batchRequests: Array.from({ length: N }, () => ({
    method: 'GET',
    url: `v66.0/query?q=${encodeURIComponent(q)}`,
  })),
});
const apos2 = await restantes();
const custoBatch = apos1 - apos2;

for (let i = 0; i < N; i++) await sfGet(`${V}/query?q=${encodeURIComponent(q)}`);
const apos3 = await restantes();
const custoSoltas = apos2 - apos3;

const veredito = (c) => {
  if (c <= 3) return '≈ 1 chamada  (o composite conta como UMA)';
  if (c >= N - 5) return `≈ ${N} chamadas  (cada subrequest conta)`;
  return 'inconclusivo';
};

console.log(`  /composite         ${String(custoComposite).padStart(4)}   ${veredito(custoComposite)}`);
console.log(`  /composite/batch   ${String(custoBatch).padStart(4)}   ${veredito(custoBatch)}`);
console.log(`  ${N} chamadas soltas    ${String(custoSoltas).padStart(4)}   (referência: deveria ser ~${N})`);
console.log(`\n  cota restante: ${apos3.toLocaleString('pt-BR')}`);
console.log('  obs: o servidor da POC está no ar; algum ruído é esperado.');
