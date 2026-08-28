/**
 * ADAPTADOR 1 — Page Layout via UI API, + objeto de regras complementar.
 *
 * Corresponde à "Opção 2" do estudo: o Page Layout define estrutura, ordem,
 * seções e obrigatoriedade; o que ele não modela (regras de visibilidade e
 * política de anexos) vem de fora, porque o retorno da UI API não é extensível.
 *
 * Chamadas:
 *   GET  /ui-api/object-info/{obj}
 *   GET  /ui-api/layout/{obj}?recordTypeId=..&mode=Create
 *   GET  /ui-api/object-info/{obj}/picklist-values/{rt}
 *   GET  /query?q=SELECT .. FROM FormFieldRule__c ..
 */

import { config } from '../config.js';
import { getObjectInfo, getLayout, getPicklistValues, soql } from '../salesforce.js';
import {
  emptyContract,
  makeField,
  applyObjectInfo,
  applyPicklistValues,
  normalizeOperator,
} from '../contract.js';

export async function buildContract({ objectApiName, recordTypeId }) {
  const contract = emptyContract('UI_API', objectApiName);
  const track = (label, path) => contract.diagnostics.calls.push({ label, path });

  // 1. Schema do objeto
  track('Schema do objeto', `/ui-api/object-info/${objectApiName}`);
  const objectInfo = await getObjectInfo(objectApiName);

  const rtInfo = objectInfo.recordTypeInfos?.[recordTypeId];
  contract.recordType = {
    id: recordTypeId,
    developerName: null, // a UI API não expõe DeveloperName; resolvido abaixo
    label: rtInfo?.name ?? null,
  };

  // 2. Layout — resolvido pelo Salesforce a partir do PROFILE do usuário
  //    autenticado + Record Type. É a "resolução por identidade".
  track('Page Layout', `/ui-api/layout/${objectApiName}?recordTypeId=${recordTypeId}&mode=Create`);
  const layout = await getLayout(objectApiName, recordTypeId, 'Create');

  // 3. Valores de picklist do Record Type
  track('Valores de picklist', `/ui-api/object-info/${objectApiName}/picklist-values/${recordTypeId}`);
  const picklists = await getPicklistValues(objectApiName, recordTypeId);

  // 4. DeveloperName do Record Type — necessário para casar com as regras,
  //    porque a UI API só devolve o label.
  const qRt = `SELECT DeveloperName FROM RecordType WHERE Id = '${recordTypeId}' LIMIT 1`;
  track('DeveloperName do Record Type', `/query?q=${qRt}`);
  const rtRow = await soql(qRt).catch(() => null);
  const developerName = rtRow?.records?.[0]?.DeveloperName ?? null;
  contract.recordType.developerName = developerName;

  // 5. Regras de visibilidade
  const rules = await loadRules(objectApiName, developerName, contract);

  // 6. Documentos exigidos — a chamada a mais que o desenho de tabela custa.
  const documentos = await loadDocumentos(objectApiName, developerName, contract);

  const built = layoutToContract(layout, {
    objectApiName,
    recordTypeId,
    objectInfo,
    picklists,
    rules,
    documentos,
  });

  built.recordType = contract.recordType;
  built.diagnostics.calls = contract.diagnostics.calls;
  built.diagnostics.warnings.push(...contract.diagnostics.warnings);
  return built;
}

/**
 * Tradução pura: Page Layout + regras → contrato. Sem I/O, testável offline.
 */
export function layoutToContract(layout, {
  objectApiName,
  recordTypeId,
  objectInfo,
  picklists,
  rules = [],
  documentos = [],
}) {
  const contract = emptyContract('UI_API', objectApiName);
  if (recordTypeId) contract.recordType = { id: recordTypeId, developerName: null, label: null };

  const rulesByTarget = groupRulesByTarget(rules);

  contract.sections = (layout.sections || []).map((section, sIdx) => ({
    id: section.id ?? `section-${sIdx}`,
    label: section.heading ?? null,
    fields: extractFields(section)
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
      // O campo de configuração de documentos nunca é input do formulário,
      // e os campos impostos pela plataforma também não pertencem a ele.
      .filter((f) => f.apiName !== config.docsField)
      .filter((f) => !config.excludedFields.includes(f.apiName)),
  }))
  // seções que ficaram vazias após a exclusão não vão para o contrato
  .filter((s) => s.fields.length > 0);

  contract.attachments = montarAnexos(documentos, rules);
  return contract;
}

/** Percorre sections → layoutRows → layoutItems → layoutComponents. */
function extractFields(section) {
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

async function loadRules(objectApiName, recordTypeDeveloperName, contract) {
  if (!recordTypeDeveloperName) {
    contract.diagnostics.warnings.push(
      'Não foi possível resolver o DeveloperName do Record Type; regras não carregadas.'
    );
    return [];
  }

  const query = `
    SELECT TargetField__c, TargetDocumentCode__c, ConditionField__c, Operator__c, Value__c,
           Effect__c, Sort__c, FilterLogicType__c, FilterLogic__c
    FROM ${config.rulesObject}
    WHERE ObjectApiName__c = '${objectApiName}'
      AND RecordTypeDeveloperName__c = '${recordTypeDeveloperName}'
      AND IsActive__c = true
    ORDER BY TargetField__c, Sort__c NULLS FIRST
  `.replace(/\s+/g, ' ').trim();

  contract.diagnostics.calls.push({ label: 'Regras de visibilidade', path: `/query?q=${query}` });

  try {
    const res = await soql(query);
    return res.records || [];
  } catch (err) {
    // O objeto pode ainda não existir na org — a POC segue sem regras.
    contract.diagnostics.warnings.push(
      `Regras não carregadas (${config.rulesObject}): ${err.message}`
    );
    return [];
  }
}

/**
 * Converte registros de regra no formato `visibility` do contrato.
 *
 * Semântica: regras do mesmo LogicGroup são combinadas com AND.
 * Grupos diferentes para o mesmo campo alvo ainda não são suportados
 * (ficaria OR entre grupos) — a POC usa o primeiro grupo encontrado.
 */
function groupRulesByTarget(rules) {
  const byTarget = new Map();

  for (const r of rules) {
    if (r.Effect__c && r.Effect__c !== 'SHOW') continue; // POC: só SHOW
    if (r.TargetDocumentCode__c) continue; // essa mira num documento, não num campo

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

async function loadDocumentos(objectApiName, recordTypeDeveloperName, contract) {
  if (!recordTypeDeveloperName) return [];

  const query = `
    SELECT Name, DocumentCode__c, IsRequired__c, HelpText__c,
           MinFiles__c, MaxFiles__c, MaxSizeMb__c, AcceptedTypes__c, Sort__c
    FROM ${config.documentsObject}
    WHERE ObjectApiName__c = '${objectApiName}'
      AND RecordTypeDeveloperName__c = '${recordTypeDeveloperName}'
      AND IsActive__c = true
    ORDER BY Sort__c NULLS FIRST
  `.replace(/\s+/g, ' ').trim();

  contract.diagnostics.calls.push({ label: 'Documentos exigidos', path: `/query?q=${query}` });

  try {
    const res = await soql(query);
    return res.records || [];
  } catch (err) {
    contract.diagnostics.warnings.push(
      `Documentos não carregados (${config.documentsObject}): ${err.message}`
    );
    return [];
  }
}

/**
 * Documentos exigidos, vindos de FormRequiredDocument__c.
 *
 * O desenho anterior codificava isso na PRESENÇA do campo picklist
 * FormRequiredDocuments__c no Page Layout, com os documentos como valores de
 * picklist por Record Type. Economizava uma chamada, mas usava um campo do
 * Caso como marcador de política de formulário — invisível para quem lesse o
 * layout, e impossível de configurar sem mexer em metadado.
 *
 * Agora é registro, como as regras. Custa uma consulta a mais.
 */
function montarAnexos(documentos, regras) {
  if (!documentos.length) {
    return { required: false, minimumCount: 0, documents: [], component: null };
  }

  const regrasPorDoc = new Map();
  for (const r of regras) {
    if (!r.TargetDocumentCode__c) continue;
    if (!regrasPorDoc.has(r.TargetDocumentCode__c)) regrasPorDoc.set(r.TargetDocumentCode__c, []);
    regrasPorDoc.get(r.TargetDocumentCode__c).push(r);
  }

  const docs = documentos.map((d) => {
    const suas = (regrasPorDoc.get(d.DocumentCode__c) || []).sort(
      (a, b) => (a.Sort__c ?? 0) - (b.Sort__c ?? 0)
    );
    const modo = suas[0]?.FilterLogicType__c || 'ALL';
    return {
      code: d.DocumentCode__c,
      label: d.Name,
      required: d.IsRequired__c === true,
      helpText: d.HelpText__c ?? null,
      minFiles: d.MinFiles__c ?? (d.IsRequired__c ? 1 : 0),
      maxFiles: d.MaxFiles__c ?? null,
      maxSizeMb: d.MaxSizeMb__c ?? null,
      acceptedTypes: d.AcceptedTypes__c ? d.AcceptedTypes__c.split(',').map((s) => s.trim()) : [],
      // Anexo condicional: mesma máquina de filtros dos campos.
      visibility: suas.length
        ? {
            logic: modo === 'CUSTOM' && suas[0].FilterLogic__c ? 'CUSTOM' : modo === 'ANY' ? 'ANY' : 'ALL',
            expression: modo === 'CUSTOM' ? suas[0].FilterLogic__c ?? null : null,
            conditions: suas.map((r) => ({
              field: r.ConditionField__c,
              operator: normalizeOperator(r.Operator__c),
              value: r.Value__c,
            })),
          }
        : null,
    };
  });

  const obrigatorios = docs.filter((d) => d.required);
  return {
    required: obrigatorios.length > 0,
    minimumCount: obrigatorios.reduce((n, d) => n + (d.minFiles || 1), 0),
    documents: docs,
    component: null,
  };
}
