/** O payload da UI API identifica QUAL layout ele devolveu? */
import { sfGet } from '../server/salesforce.js';
import { config } from '../server/config.js';
const V = `/services/data/v${config.apiVersion}`;

const rt = await sfGet(`${V}/query?q=` + encodeURIComponent(
  "SELECT Id FROM RecordType WHERE SobjectType='Case' AND DeveloperName='SI_Demo_BankDataChange'"));
const rtId = rt.records[0].Id;

const lay = await sfGet(`${V}/ui-api/layout/Case?recordTypeId=${rtId}&mode=Create`);
console.log('ui-api/layout — chaves raiz:', Object.keys(lay).join(', '));
console.log('  id      :', lay.id ?? '(nenhum)');
console.log('  mode    :', lay.mode);
console.log('  eTag    :', (lay.eTag ?? '').slice(0, 16));

const def = await sfGet(`${V}/ui-api/record-defaults/create/Case?recordTypeId=${rtId}`);
console.log('\nrecord-defaults — layout:', Object.keys(def.layout ?? {}).join(', '));
console.log('  id:', def.layout?.id ?? '(nenhum)');
console.log('  chaves de layoutUserState/objectInfos:', Object.keys(def).join(', '));
