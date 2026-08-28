import { getLayout } from '../server/salesforce.js';
const rt = '012Ha000002eNzHIAU';
const layout = await getLayout('Case', rt, 'Create');
for (const s of layout.sections ?? []) {
  for (const row of s.layoutRows ?? []) {
    for (const item of row.layoutItems ?? []) {
      for (const comp of item.layoutComponents ?? []) {
        if (comp.apiName === 'FormRequiredDocuments__c') {
          console.log('seção:', s.heading);
          console.log(JSON.stringify({
            label: item.label,
            required: item.required,
            uiBehavior: item.uiBehavior,
            layoutComponents: item.layoutComponents,
          }, null, 2));
        }
      }
    }
  }
}
