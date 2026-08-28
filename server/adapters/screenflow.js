/**
 * ADAPTADOR 2 — Screen Flow via Tooling API.
 *
 * Corresponde à "Opção 4" do estudo. Uma chamada devolve estrutura, ordem,
 * vínculo com o campo do objeto, obrigatoriedade, regras de visibilidade
 * e o componente de anexo.
 *
 * Chamadas:
 *   GET  /tooling/sobjects/Flow/{flowId}
 *   GET  /ui-api/object-info/{obj}                      (tipos e labels)
 *   GET  /ui-api/object-info/{obj}/picklist-values/{rt} (valores)
 *
 * Observação importante: o Flow guarda apenas o PONTEIRO para o campo
 * (`objectFieldReference`). Tipo, label e valores de picklist NÃO estão no
 * payload — vêm do schema. E o Flow não declara Record Type: era isso que
 * obrigava a tela a ter DOIS seletores, um para o flow e outro para o Record
 * Type das picklists.
 *
 * É o buraco que o `FormDefinition__c` fecha. O catálogo é quem sabe que o
 * formulário "Alteração de dados bancários" é o flow X sobre o Record Type Y —
 * e traz junto os campos que o BFF grava sem perguntar nada ao usuário.
 */

import { getFlowById, getObjectInfo, getPicklistValues } from '../salesforce.js';
import {
  emptyContract,
  makeField,
  applyObjectInfo,
  applyPicklistValues,
  normalizeOperator,
  backendFieldsFromForm,
} from '../contract.js';

const FILE_UPLOAD_COMPONENT = 'forceContent:fileUpload';

/**
 * Busca os dados no Salesforce e delega a tradução à função pura abaixo.
 *
 * `form` é o registro do catálogo, já resolvido (flow → versão ativa,
 * DeveloperName → Id do Record Type). Quando vem, dispensa `flowId` e
 * `recordTypeId`: o catálogo é a fonte dos dois.
 */
export async function buildContract({ flowId, objectApiName, recordTypeId, form = null }) {
  const idDoFlow = form?.flow?.versionId ?? flowId;
  const idDoRecordType = form?.recordType?.id ?? recordTypeId;

  if (!idDoFlow) {
    throw new Error(
      form
        ? `O formulário "${form.label}" não aponta para uma versão ativa de flow.`
        : 'Informe flowId ou formId.'
    );
  }

  const calls = [];
  const track = (label, path, extra = {}) => calls.push({ label, path, ...extra });

  if (form) {
    // Duas, e as duas de verdade. A primeira já rodou antes desta requisição,
    // quando a tela montou o seletor — sem ela não haveria Id para escolher.
    track(
      'Catálogo — lista os formulários (alimenta o seletor)',
      '/composite/batch → FormDefinition__c (todos) + FlowDefinitionView + RecordType',
      { replayId: 'catalog:SCREEN_FLOW' }
    );
    track(
      'Catálogo — resolve o formulário escolhido',
      `/composite/batch → FormDefinition__c (Id = ${form.id}) + FlowDefinitionView + RecordType`,
      { replayId: `catalog:SCREEN_FLOW:${form.id}` }
    );
  }

  track('Definição do Screen Flow', `/tooling/sobjects/Flow/${idDoFlow}`);
  const flow = await getFlowById(idDoFlow);
  if (!flow.Metadata) throw new Error(`Flow ${idDoFlow} não retornou Metadata.`);

  track('Schema do objeto', `/ui-api/object-info/${objectApiName}`);
  const objectInfo = await getObjectInfo(objectApiName);

  let picklists = null;
  if (idDoRecordType) {
    track('Valores de picklist', `/ui-api/object-info/${objectApiName}/picklist-values/${idDoRecordType}`);
    picklists = await getPicklistValues(objectApiName, idDoRecordType);
  }

  const contract = flowMetadataToContract(flow.Metadata, {
    objectApiName,
    recordTypeId: idDoRecordType,
    objectInfo,
    picklists,
  });

  if (form) {
    contract.formDefinition = {
      id: form.id,
      label: form.label,
      source: form.source,
      channel: form.channel,
      flowApiName: form.flow?.apiName ?? null,
    };
    contract.backendFields = backendFieldsFromForm(form);
    contract.recordType = {
      id: form.recordType.id,
      developerName: form.recordType.developerName,
      label: form.recordType.label,
    };
    contract.diagnostics.warnings.push(...(form.problems ?? []));
  }

  contract.diagnostics.calls = calls;
  return contract;
}

/**
 * Tradução pura: Flow.Metadata → contrato. Sem I/O, testável offline.
 */
export function flowMetadataToContract(meta, { objectApiName, recordTypeId, objectInfo, picklists }) {
  const contract = emptyContract('SCREEN_FLOW', objectApiName);

  // Mapa variável → objeto:  "Case1" → "Case"
  const variableMap = new Map(
    (meta.variables || [])
      .filter((v) => v.dataType === 'SObject' && v.objectType)
      .map((v) => [v.name, v.objectType])
  );

  if (recordTypeId) {
    contract.recordType = {
      id: recordTypeId,
      developerName: null,
      label: objectInfo?.recordTypeInfos?.[recordTypeId]?.name ?? null,
    };
  } else {
    contract.diagnostics.warnings.push(
      'Nenhum recordTypeId informado. O Screen Flow não declara Record Type, ' +
        'então os valores de picklist não puderam ser resolvidos.'
    );
  }

  const attachments = { required: false, minimumCount: 0, documents: [], component: null };

  contract.sections = orderScreens(meta, contract).map((screen, idx) => ({
    id: screen.name ?? `screen-${idx}`,
    label: screen.label ?? screen.name ?? `Etapa ${idx + 1}`,
    fields: walkFields(screen.fields || [], {
      variableMap,
      objectInfo,
      picklists,
      objectApiName,
      attachments,
      contract,
    }),
  }));

  contract.attachments = attachments;
  return contract;
}

/**
 * A Tooling API devolve `screens[]` em ordem arbitrária, não na ordem em que o
 * usuário navega. A sequência real está nos conectores: `start` aponta para a
 * primeira tela, e cada tela aponta para a próxima.
 *
 * Telas não alcançadas pela navegação (por exemplo, depois de um Decision) são
 * anexadas ao final, na ordem original, e geram um aviso.
 */
function orderScreens(meta, contract) {
  const screens = meta.screens || [];
  if (screens.length <= 1) return screens;

  const byName = new Map(screens.map((s) => [s.name, s]));
  const ordered = [];
  const seen = new Set();

  let current = meta.start?.connector?.targetReference;
  while (current && byName.has(current) && !seen.has(current)) {
    seen.add(current);
    const screen = byName.get(current);
    ordered.push(screen);
    current = screen.connector?.targetReference;
  }

  const unreachable = screens.filter((s) => !seen.has(s.name));
  if (unreachable.length > 0) {
    contract.diagnostics.warnings.push(
      `${unreachable.length} tela(s) não alcançada(s) seguindo os conectores — ` +
        'a ordem delas pode não refletir a navegação real: ' +
        unreachable.map((s) => s.name).join(', ')
    );
    ordered.push(...unreachable);
  }

  return ordered;
}

/**
 * `fields[]` é RECURSIVO: componentes de Section aninham campos filhos.
 */
function walkFields(fields, ctx) {
  const out = [];

  for (const raw of fields) {
    if (Array.isArray(raw.fields) && raw.fields.length > 0) {
      out.push(...walkFields(raw.fields, ctx));
    }

    switch (raw.fieldType) {
      case 'ObjectProvided': {
        const field = fromObjectProvided(raw, ctx);
        if (field) out.push(field);
        break;
      }

      case 'ComponentInstance': {
        if (raw.extensionName === FILE_UPLOAD_COMPONENT) {
          applyFileUpload(raw, ctx.attachments);
        } else if (raw.extensionName) {
          ctx.contract.diagnostics.warnings.push(
            `Componente não suportado ignorado: ${raw.extensionName}`
          );
        }
        break;
      }

      case 'RegionContainer':
      case 'Region':
        break; // já tratados pela recursão acima

      case 'DisplayText':
        break; // texto estático não é input

      default:
        if (raw.fieldType) {
          ctx.contract.diagnostics.warnings.push(
            `fieldType não suportado ignorado: ${raw.fieldType}${raw.name ? ` (${raw.name})` : ''}`
          );
        }
    }
  }

  return out;
}

function fromObjectProvided(raw, ctx) {
  const ref = raw.objectFieldReference; // ex.: "Case1.AccountType__c"
  if (!ref) return null;

  const [variableName, ...rest] = ref.split('.');
  const fieldApiName = rest.join('.');
  const resolvedObject = ctx.variableMap.get(variableName);

  if (!resolvedObject) {
    ctx.contract.diagnostics.warnings.push(
      `Variável "${variableName}" não encontrada em variables[]; campo ${ref} ignorado.`
    );
    return null;
  }

  if (resolvedObject !== ctx.objectApiName) {
    ctx.contract.diagnostics.warnings.push(
      `Campo ${ref} aponta para ${resolvedObject}, não ${ctx.objectApiName}; ignorado.`
    );
    return null;
  }

  let field = makeField(fieldApiName, {
    required: raw.isRequired === true,
    readOnly: raw.isReadOnly === true,
    visibility: convertVisibilityRule(raw.visibilityRule, ctx),
  });

  field = applyObjectInfo(field, ctx.objectInfo);
  if (ctx.picklists) field = applyPicklistValues(field, ctx.picklists);

  return field;
}

function applyFileUpload(raw, attachments) {
  attachments.component = FILE_UPLOAD_COMPONENT;
  attachments.required = raw.isRequired === true;
  attachments.minimumCount = raw.isRequired === true ? 1 : 0;

  const label = (raw.inputParameters || []).find((p) => p.name === 'label')?.value?.stringValue;
  if (label) attachments.documents.push({ code: raw.name ?? 'FILE', label });
}

/**
 * Converte a `visibilityRule` do Flow para o formato do contrato.
 *
 * Formato do Flow:
 *   { conditionLogic: "and", conditions: [
 *       { leftValueReference: "Case1.Campo__c",
 *         operator: "EqualTo",
 *         rightValue: { stringValue: "X" } } ] }
 *
 * Aceita também o formato da FlexiPage (booleanFilter + criteria), para o caso
 * de reaproveitarmos este conversor no adaptador de FlexiPage.
 */
function convertVisibilityRule(rule, ctx) {
  if (!rule) return null;

  const rawConditions = rule.conditions || rule.criteria || [];
  if (rawConditions.length === 0) return null;

  const logicText = String(rule.conditionLogic || rule.booleanFilter || 'and').toLowerCase();
  const logic = logicText.includes('or') ? 'OR' : 'AND';

  const conditions = rawConditions
    .map((c) => {
      const left = c.leftValueReference || c.leftValue || '';
      const field = stripReference(left, ctx.variableMap);
      if (!field) return null;

      return {
        field,
        operator: normalizeOperator(c.operator),
        value: extractValue(c.rightValue ?? c.rightValueReference ?? c.value),
      };
    })
    .filter(Boolean);

  if (conditions.length === 0) return null;
  if (logicText.match(/\d/)) {
    ctx.contract.diagnostics.warnings.push(
      `Lógica booleana customizada "${logicText}" simplificada para ${logic}.`
    );
  }

  return { logic, conditions };
}

/** "Case1.Campo__c" ou "{!Record.Campo__c}" → "Campo__c" */
function stripReference(ref, variableMap) {
  const cleaned = String(ref).replace(/^\{!/, '').replace(/\}$/, '');
  const parts = cleaned.split('.');
  if (parts.length < 2) return cleaned || null;

  const head = parts[0];
  if (variableMap.has(head) || head === 'Record') return parts.slice(1).join('.');
  return parts.slice(1).join('.') || cleaned;
}

/** Desembrulha o objeto genérico de valor do Flow. */
function extractValue(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;

  for (const key of [
    'stringValue',
    'numberValue',
    'booleanValue',
    'dateValue',
    'dateTimeValue',
    'elementReference',
  ]) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return null;
}
