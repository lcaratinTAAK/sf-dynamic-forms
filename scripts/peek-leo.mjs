import { toolingSoql } from '../server/salesforce.js';
const LEO = '00eHa000007KjxpIAC';
const rts = ['012Ha000002eNzHIAU','012Ha000002dvwZIAQ','012Ha000002dvwaIAA'];
const l = (a)=>a.map(i=>"'"+i+"'").join(',');
const pl = await toolingSoql(`SELECT LayoutId, RecordTypeId FROM ProfileLayout WHERE ProfileId = '${LEO}' AND RecordTypeId IN (${l(rts)})`);
console.log('atribuições do profile de Leo para esses 3 Record Types:', pl.totalSize);
if (pl.totalSize) {
  const ids=[...new Set(pl.records.map(r=>r.LayoutId))];
  const lays=await toolingSoql(`SELECT Id, Name FROM Layout WHERE Id IN (${l(ids)})`);
  const n=Object.fromEntries(lays.records.map(x=>[x.Id,x.Name]));
  pl.records.forEach(r=>console.log('  ', r.RecordTypeId, '->', n[r.LayoutId]));
}
