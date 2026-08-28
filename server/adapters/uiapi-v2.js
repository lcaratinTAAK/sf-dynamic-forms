/**
 * ADAPTADOR 3 — UI API v2.
 *
 * Mesma fonte da v1 (Page Layout), orquestração diferente:
 *
 *   v1  descoberta = ui-api/object-info/Case          (517 KB, não batchável)
 *       render     = layout + picklist-values + query de regras
 *
 *   v2  descoberta = composite/batch: RecordType + regras   (21 KB, 1 request)
 *       render     = record-defaults/create + picklist-values
 *
 * A troca do `layout` pelo `record-defaults/create` é obrigatória, não estética:
 * sem o `object-info` na descoberta, o layout sozinho não traz os tipos dos
 * campos — ele é puramente estrutural. O `record-defaults` devolve layout e
 * schema juntos, e ainda os valores default do registro.
 *
 * O preço: a SOQL em RecordType não respeita visibilidade por profile.
 */

import { config } from '../config.js';
import { getRecordDefaults, getPicklistValues, discoverViaSoql } from '../salesforce.js';
import { emptyContract, makeField, applyObjectInfo, applyPicklistValues, normalizeOperator } from '../contract.js';

/** Descoberta: Record Types e regras numa requisição. */
export async function discover() {
  const { recordTypes, rules, rulesFailed } = await discoverViaSoql(
    config.objectApiName,
    config.rulesObject
  );

  return {
    recordTypes: recordTypes.map((rt) => ({
      id: rt.Id,
      label: rt.Name,
      developerName: rt.DeveloperName,
    })),
    rules,
    rulesFailed,
  };
}

export async function buildContract({ objectApiName, recordTypeId }) {
  const contract = emptyContract('UI_API_V2', objectApiName);
  const track = (label, path, extra = {}) =>
    contract.diagnostics.calls.push({ label, path, ...extra });

  // 1. Descoberta — Record Types + regras num único request
  track(
    'Descoberta (RecordType + regras)',
    '/composite/batch → query RecordType + query FormFieldRule__c',
    { replayId: 'discovery' }
  );
  const { recordTypes, rules, rulesFailed } = await discover();

  const rt = recordTypes.find((r) => r.id === recordTypeId);
  contract.recordType = {
    id: recordTypeId,
    developerName: rt?.developerName ?? null,
    label: rt?.label ?? null,
  };

  if (rulesFailed) {
    contract.diagnostics.warnings.push(
      `Não foi possível carregar as regras de ${config.rulesObject}.`
    );
  }

  // 2. Layout + schema + defaults numa chamada
  track(
    'Layout + schema + defaults',
    `/ui-api/record-defaults/create/${objectApiName}?recordTypeId=${recordTypeId}`
  );
  const defaults = await getRecordDefaults(objectApiName, recordTypeId);
  const objectInfo = defaults.objectInfos?.[objectApiName];

  // 3. Valores de picklist — o record-defaults não os traz
  track('Valores de picklist', `/ui-api/object-info/${objectApiName}/picklist-values/${recordTypeId}`);
  const picklists = await getPicklistValues(objectApiName, recordTypeId);

  // --- montagem, idêntica à v1 a partir daqui --------------------------------

  const rulesByTarget = agruparRegras(
    rules.filter((r) => r.RecordTypeDeveloperName__c === contract.recordType.developerName)
  );

  contract.sections = (defaults.layout?.sections || [])
    .map((section, sIdx) => ({
      id: section.id ?? `section-${sIdx}`,
      label: section.heading ?? null,
      fields: extrairCampos(section)
        .map((item) => {
          let field = makeField(item.apiName, {
            label: item.label ?? item.apiName,
            required: Boolean(item.required),
            readOnly: item.editableForNew === false || item.uiBehavior === 'Readonly',
          });
          field = applyObjectInfo(field, objectInfo);
          field = applyPicklistValues(field, picklists);
          field.visibility = rulesByTarget.get(item.apiName) ?? null;
          return field;
        })
        .filter((f) => f.apiName !== config.docsField)
        .filter((f) => !config.excludedFields.includes(f.apiName)),
    }))
    .filter((s) => s.fields.length > 0);

  contract.attachments = montarAnexos(defaults.layout, picklists);

  // Exclusivo da v2: valores default vindos do próprio Salesforce.
  const defaultValues = {};
  for (const [apiName, campo] of Object.entries(defaults.record?.fields ?? {})) {
    if (campo?.value !== null && campo?.value !== undefined) defaultValues[apiName] = campo.value;
  }
  contract.defaultValues = defaultValues;

  return contract;
}

function extrairCampos(section) {
  const out = [];
  for (const row of section.layoutRows || []) {
    for (const item of row.layoutItems || []) {
      for (const comp of item.layoutComponents || []) {
        if (comp.componentType !== 'Field' || !comp.apiName) continue;
        out.push({
          apiName: comp.apiName,
          label: item.label ?? comp.label,
          required: item.required,
          editableForNew: item.editableForNew,
          uiBehavior: item.uiBehavior,
        });
      }
    }
  }
  return out;
}

function agruparRegras(rules) {
  const byTarget = new Map();
  for (const r of rules) {
    if (r.Effect__c && r.Effect__c !== 'SHOW') continue;
    const target = r.TargetField__c;
    if (!byTarget.has(target)) byTarget.set(target, { logic: 'AND', conditions: [] });
    byTarget.get(target).conditions.push({
      field: r.ConditionField__c,
      operator: normalizeOperator(r.Operator__c),
      value: r.Value__c,
    });
  }
  return byTarget;
}

function montarAnexos(layout, picklists) {
  const presente = (layout?.sections || []).some((s) =>
    extrairCampos(s).some((f) => f.apiName === config.docsField)
  );
  if (!presente) return { required: false, minimumCount: 0, documents: [], component: null };

  const values = picklists?.picklistFieldValues?.[config.docsField]?.values || [];
  const documents = values.map((v) => ({ code: v.value, label: v.label }));

  return { required: documents.length > 0, minimumCount: documents.length, documents, component: null };
}
