/**
 * Qual Page Layout cada profile enxerga, por Record Type?
 * É o que decide se o configurador mostra o layout certo.
 */
import { toolingSoql } from '../server/salesforce.js';

const rts = ['012Ha000002eNzHIAU', '012Ha000002dvwZIAQ', '012Ha000002dvwaIAA', '012Ha000002dvwbIAA'];
const lista = (a) => a.map((i) => `'${i}'`).join(',');

const perfis = await toolingSoql(
  "SELECT Id, Name FROM Profile WHERE Name IN ('System Administrator','MagicLink Integration_Profile')"
);
const nomePerfil = Object.fromEntries(perfis.records.map((p) => [p.Id, p.Name]));
console.log('perfis encontrados:', JSON.stringify(Object.values(nomePerfil)));

const pl = await toolingSoql(
  `SELECT Id, LayoutId, ProfileId, RecordTypeId FROM ProfileLayout ` +
    `WHERE ProfileId IN (${lista(Object.keys(nomePerfil))}) AND RecordTypeId IN (${lista(rts)})`
);
const layIds = [...new Set(pl.records.map((r) => r.LayoutId))];
const lays = await toolingSoql(`SELECT Id, Name FROM Layout WHERE Id IN (${lista(layIds)})`);
const nomeLay = Object.fromEntries(lays.records.map((l) => [l.Id, l.Name]));

const rtNomes = await toolingSoql(
  `SELECT Id, DeveloperName FROM RecordType WHERE Id IN (${lista(rts)})`
).catch(() => ({ records: [] }));
const nomeRt = Object.fromEntries((rtNomes.records || []).map((r) => [r.Id, r.DeveloperName]));

console.log();
console.log('Record Type'.padEnd(30) + 'Profile'.padEnd(34) + 'Layout');
console.log('-'.repeat(104));
for (const r of pl.records.sort((a, b) => String(nomeRt[a.RecordTypeId]).localeCompare(String(nomeRt[b.RecordTypeId])))) {
  console.log(
    String(nomeRt[r.RecordTypeId] ?? r.RecordTypeId).padEnd(30) +
      String(nomePerfil[r.ProfileId]).padEnd(34) +
      nomeLay[r.LayoutId]
  );
}
