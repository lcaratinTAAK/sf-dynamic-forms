/**
 * O CONTRATO NORMALIZADO.
 *
 * É o artefato durável da arquitetura: o frontend (e o bot, e qualquer outro
 * canal) conhece apenas esta forma. A fonte no Salesforce — Page Layout,
 * FlexiPage, Screen Flow — é detalhe de implementação do adaptador.
 *
 * Trocar a fonte não pode mudar este formato.
 *
 * {
 *   source: 'UI_API' | 'SCREEN_FLOW',
 *   object: 'Case',
 *   recordType: { id, developerName, label } | null,
 *   sections: [{
 *     id, label,
 *     fields: [{
 *       apiName, label, dataType, required, readOnly, helpText, maxLength,
 *       kind: 'field' | 'reference' | 'multireference' | 'attachment' | 'content',
 *       reference: { type, object, externalIdField } | undefined,
 *                                          // kind=reference: o campo é o id externo de um registro que o
 *                                          // usuário ESCOLHE (contrato, imóvel); vai como TEXTO no submit
 *       link: { object, caseField, externalIdField, submissionField } | undefined,
 *                                          // kind=multireference: o usuário escolhe VÁRIOS registros; nada
 *                                          // vai no registro do formulário, cada escolha vira um `object`
 *                                          // (ChildObjectApiName__c, ex. CaseContract__c) com o Id do Caso
 *                                          // em `caseField` e o id externo em `externalIdField` — por
 *                                          // componente, lidos da linha da definição
 *       options: [{ value, label, validFor }] | null,
 *       controllerField: string | null,
 *       visibility: Visibility | null
 *     }]
 *   }],
 *   attachments: { required, minimumCount, documents: [{ code, label }], component },
 *   backendFields: { [apiName]: value },   // gravados pelo BFF, nunca renderizados
 *   formDefinition: { id, key, version, status, versionKey, label, source, channel, description } | null,
 *   diagnostics: { calls: [...], warnings: [...] }
 * }
 *
 * Visibility = {
 *   logic: 'AND' | 'OR',
 *   conditions: [{ field, operator, value, object }]
 *                                          // object: de ConditionObjectApiName__c — numa lista,
 *                                          // o objeto do formulário faz a condição ler as respostas de fora
 * }
 *
 * Seção com `repeating: true` (lista repetível) carrega também:
 *   childObject, childRecordTypeDevName, childRecordTypeId,
 *   caseField, listField, childRelationshipField, submissionField,
 *   itemLabel, addButtonText, minItems, maxItems
 */

export const OPERATORS = Object.freeze({
  EQUALS: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  CONTAINS: 'CONTAINS',
  NOT_CONTAINS: 'NOT_CONTAINS',
  STARTS_WITH: 'STARTS_WITH',
  GREATER_THAN: 'GREATER_THAN',
  LESS_THAN: 'LESS_THAN',
  IS_NULL: 'IS_NULL',
  IS_NOT_NULL: 'IS_NOT_NULL',
});

/** Fields and references both carry an answer into the record; content and attachments do not. */
export const isFieldLike = (f) => (f.kind ?? 'field') === 'field' || f.kind === 'reference';

/**
 * Referência múltipla: não grava no registro do formulário. Cada escolha vira
 * um registro de `link.object` ligado ao Caso gerado — por isso fica fora de
 * `isFieldLike`.
 */
export const isMultiReference = (f) => f.kind === 'multireference';

/** Os ids externos escolhidos numa referência múltipla, sem linha vazia. */
export function escolhidosDe(item, values) {
  const brutos = Array.isArray(values?.[item.apiName]) ? values[item.apiName] : [];
  return brutos.map((v) => String(v ?? '').trim()).filter(Boolean);
}

/** O mesmo contrato duas vezes viraria dois vínculos iguais. */
function repetidos(lista) {
  const vistos = new Set();
  const dobrados = new Set();
  for (const v of lista) (vistos.has(v) ? dobrados : vistos).add(v);
  return [...dobrados];
}

export function emptyContract(source, objectApiName) {
  return {
    source,
    object: objectApiName,
    recordType: null,
    sections: [],
    attachments: emptyAttachments(),
    backendFields: {},
    formDefinition: null,
    diagnostics: { calls: [], warnings: [] },
  };
}

/**
 * Traduz um registro do catálogo nos campos que o BFF injeta no payload.
 * Um lugar só, para as três fontes se comportarem igual.
 */
export function backendFieldsFromForm(form) {
  if (!form) return {};
  const out = {};
  if (form.recordType?.id) out.RecordTypeId = form.recordType.id;

  if (form.typeFieldApiName && form.typeValue) {
    out[form.typeFieldApiName] = form.typeValue;
  } else if (form.caseType) {
    // legado: screenflow.js ainda chama esta função com o shape antigo
    // (FormDefinition__c.CaseType__c) — não remova este ramo.
    out.Type = form.caseType;
  }

  if (form.priorityFieldApiName && form.priorityValue) {
    out[form.priorityFieldApiName] = form.priorityValue;
  }

  // Sem par de valor, ao contrário de Tipo/Prioridade: o valor é sempre a
  // versão ATIVA do próprio formulário, nunca uma escolha do configurador.
  //
  // A chave (`VersionKey__c`, ex. `owner_bank_data_change#18`), e não o
  // número (`Version__c`): é por ela que a trigger do envio acha o formulário
  // e decide se cria o caso auxiliar. Com o número, a trigger não acha nada,
  // o Caso não nasce e os vínculos de contrato quebram com PROCESSING_HALTED.
  if (form.versionFieldApiName && form.versionKey) {
    out[form.versionFieldApiName] = form.versionKey;
  }
  return out;
}


export function emptyAttachments() {
  return { required: false, minimumCount: 0, documents: [], component: null };
}

export function makeField(apiName, overrides = {}) {
  return {
    apiName,
    label: apiName,
    dataType: 'String',
    required: false,
    readOnly: false,
    helpText: null,
    maxLength: null,
    options: null,
    controllerField: null,
    visibility: null,
    /** Torna o campo obrigatório quando as condições batem. Mesma forma de `visibility`. */
    requiredWhen: null,
    /** { message, logic, conditions } — condição VERDADEIRA significa inválido. */
    validation: null,
    /**
     * FULL | HALF | THIRD — largura na linha, como o Cognito modela em cols.
     * `null` quando a fonte não declara largura: aí quem decide é o tipo do
     * campo, que é o comportamento que a UI API e a Screen Flow já tinham.
     */
    width: null,
    ...overrides,
  };
}

/**
 * Índice de campos vindo do EntityParticle, para busca por API name.
 *
 * O object-info devolve um objeto já indexado; o SOQL devolve linhas. Esta
 * função faz a ponte, e é o único lugar que conhece as duas formas.
 */
export function indexarCampos(registros) {
  const mapa = {};
  for (const r of registros ?? []) mapa[r.QualifiedApiName] = r;
  return mapa;
}

/**
 * Enriquece um campo com o schema vindo do EntityParticle.
 *
 * Mesma responsabilidade do `applyObjectInfo`, com a fonte trocada:
 *
 *   object-info            EntityParticle
 *   ───────────────────    ────────────────
 *   label                  Label
 *   dataType               DataType        (minúsculo lá: "picklist", "string")
 *   length                 Length
 *   inlineHelpText         InlineHelpText
 *   required               !IsNillable
 *   controllerName         —  (só IsDependentPicklist; o controlador vem na picklist)
 */
export function applyEntityParticle(field, indice, controladorDe = {}) {
  const meta = indice?.[field.apiName];
  if (!meta) return field;

  return {
    ...field,
    label: meta.Label ?? field.label,
    dataType: normalizarTipo(meta.DataType) ?? field.dataType,
    helpText: meta.InlineHelpText ?? null,
    maxLength: meta.Length ?? null,
    // `required` aqui é obrigatoriedade do OBJETO; a do formulário tem
    // precedência e já veio preenchida pelo adaptador.
    required: field.required || meta.IsNillable === false,
    readOnly: field.readOnly || meta.IsCreatable === false,
    // Picklist dependente: o nome do campo controlador. Nem o EntityParticle
    // nem o picklist-values entregam isso sozinhos — o primeiro só marca
    // IsDependentPicklist, o segundo devolve controllerValues sem nomear quem
    // controla. Vem do FieldDefinition, resolvido pelo DurableId.
    controllerField: controladorDe[field.apiName] ?? field.controllerField ?? null,
  };
}

/**
 * O EntityParticle nomeia os tipos em minúsculo e com algumas variações; o
 * renderizador espera o vocabulário do object-info.
 */
function normalizarTipo(bruto) {
  if (!bruto) return null;
  const t = String(bruto).toLowerCase();
  const mapa = {
    string: 'String', textarea: 'TextArea', picklist: 'Picklist',
    multipicklist: 'MultiPicklist', boolean: 'Boolean', date: 'Date',
    datetime: 'DateTime', time: 'Time', email: 'Email', phone: 'Phone',
    url: 'Url', currency: 'Currency', percent: 'Percent', double: 'Double',
    int: 'Int', integer: 'Int', reference: 'Reference', id: 'Id',
    encryptedstring: 'String', address: 'Address', location: 'Location',
  };
  return mapa[t] ?? (bruto.charAt(0).toUpperCase() + bruto.slice(1));
}

/**
 * Enriquece um campo do contrato com o schema vindo de `ui-api/object-info`.
 * Usado pelos DOIS adaptadores — a estrutura muda, o schema não.
 */
export function applyObjectInfo(field, objectInfo) {
  const meta = objectInfo?.fields?.[field.apiName];
  if (!meta) return field;

  return {
    ...field,
    label: meta.label ?? field.label,
    dataType: meta.dataType ?? field.dataType,
    helpText: meta.inlineHelpText ?? null,
    maxLength: meta.length ?? null,
    // `required` no schema é obrigatoriedade do objeto; a do formulário
    // (layout/flow) tem precedência e já veio preenchida pelo adaptador.
    required: field.required || Boolean(meta.required),
    controllerField: meta.controllerName ?? field.controllerField,
  };
}

/**
 * Enriquece um campo com os valores de picklist válidos para o Record Type.
 */
export function applyPicklistValues(field, picklistPayload) {
  const entry = picklistPayload?.picklistFieldValues?.[field.apiName];
  if (!entry) return field;

  const options = (entry.values || []).map((v) => ({
    value: v.value,
    label: v.label,
    validFor: v.validFor || [],
  }));

  return {
    ...field,
    options,
    // controllerValues mapeia valor-do-controlador -> índice usado em validFor
    controllerValues: entry.controllerValues || null,
    controllerField: field.controllerField ?? null,
    // Defesa contra o EntityParticle ter descrito o objeto errado (ou
    // simplesmente não conhecer o campo): se a UI API devolveu opções de
    // picklist válidas pra este Record Type, o campo É um picklist,
    // independente do que `dataType` tenha vindo do schema.
    dataType:
      options.length > 0 && field.dataType !== 'MultiPicklist' ? 'Picklist' : field.dataType,
  };
}

/** Normaliza um operador de qualquer origem para o vocabulário do contrato. */
export function normalizeOperator(raw) {
  if (!raw) return OPERATORS.EQUALS;
  const key = String(raw).toUpperCase().replace(/[^A-Z]/g, '');

  const map = {
    EQUAL: OPERATORS.EQUALS,
    EQUALS: OPERATORS.EQUALS,
    EQUALTO: OPERATORS.EQUALS,
    NOTEQUAL: OPERATORS.NOT_EQUALS,
    NOTEQUALS: OPERATORS.NOT_EQUALS,
    NOTEQUALTO: OPERATORS.NOT_EQUALS,
    CONTAINS: OPERATORS.CONTAINS,
    NOTCONTAINS: OPERATORS.NOT_CONTAINS,
    DOESNOTCONTAIN: OPERATORS.NOT_CONTAINS,
    STARTSWITH: OPERATORS.STARTS_WITH,
    GREATERTHAN: OPERATORS.GREATER_THAN,
    LESSTHAN: OPERATORS.LESS_THAN,
    ISNULL: OPERATORS.IS_NULL,
    ISNOTNULL: OPERATORS.IS_NOT_NULL,
    WASSET: OPERATORS.IS_NOT_NULL,
  };

  return map[key] ?? OPERATORS.EQUALS;
}

/**
 * Avaliador de visibilidade. Vive no servidor para que a POC possa mostrar
 * o resultado, mas a MESMA função roda no frontend a cada digitação.
 */
export function isVisible(field, values) {
  if (!field.visibility) return true;
  return avaliarGrupo(field.visibility, values, true);
}

/**
 * Um grupo de filtros vale? É a mesma máquina para os três efeitos:
 * visibilidade (SHOW), obrigatoriedade (REQUIRE) e validação (BLOCK).
 *
 * `seVazio` é o que devolver quando não há condição — visibilidade sem regra
 * significa "sempre visível"; obrigatoriedade e validação sem regra significam
 * "não se aplica".
 */
export function avaliarGrupo(grupo, values, seVazio = false) {
  if (!grupo) return seVazio;
  const { logic = 'ALL', expression = null, conditions = [] } = grupo;
  if (conditions.length === 0) return seVazio;

  const resultados = conditions.map((c) => {
    const escopo = escopoDaCondicao(c, values);
    return evaluateCondition(c, escopo[c.field], escopo);
  });

  // ANY/OR e ALL/AND são o mesmo conceito com nomes diferentes: o vocabulário
  // da FlexiPage e o que as fontes anteriores já produziam.
  const modo = String(logic).toUpperCase();
  if (modo === 'CUSTOM') return avaliarExpressao(expression, resultados);
  if (modo === 'ANY' || modo === 'OR') return resultados.some(Boolean);
  return resultados.every(Boolean);
}

/**
 * Os valores que uma condição lê.
 *
 * Dentro de um item de lista, `values` são as respostas do ITEM, e as do
 * formulário viajam junto em `__outer`, marcadas com o objeto do formulário
 * em `__outerObject` (ver `escopoDoItem`). Uma condição que nomeia o objeto do
 * formulário (`object`, de `ConditionObjectApiName__c`) lê as de fora — então
 * um `Type__c` que existe nos dois objetos nunca é lido do lado errado. Sem
 * `object`, vale o escopo do componente, que é o comportamento de antes.
 */
function escopoDaCondicao(condicao, values) {
  return condicao.object && values.__outerObject && condicao.object === values.__outerObject
    ? (values.__outer ?? {})
    : values;
}

/**
 * O que as regras de um componente de lista enxergam: as respostas do item por
 * cima das do formulário, e as do formulário sozinhas em `__outer`, para a
 * condição que aponta o objeto do formulário.
 */
export function escopoDoItem(objetoDoFormulario, values, item) {
  return { ...values, ...item, __outer: values, __outerObject: objetoDoFormulario };
}

/**
 * O campo é obrigatório AGORA? Soma a obrigatoriedade fixa com a condicional.
 * Campo oculto nunca é obrigatório — senão o formulário trava num campo que
 * o usuário não tem como ver nem preencher.
 */
export function isRequired(field, values) {
  if (!isVisible(field, values)) return false;
  if (field.required) return true;
  return avaliarGrupo(field.requiredWhen, values, false);
}

/**
 * Validações que falharam. Devolve as mensagens, na ordem dos componentes.
 *
 * Semântica do Cognito: a condição descreve quando o preenchimento é
 * INVÁLIDO. Componente oculto não valida — a regra fala de algo que não está
 * na tela.
 */
export function validar(contract, values) {
  const erros = [];
  for (const secao of contract.sections || []) {
    // Campo de lista é validado por item, no escopo do item (`montarItensDeLista`).
    if (secao.repeating) continue;
    if (!isVisible(secao, values)) continue;
    for (const item of secao.fields || []) {
      if (!isVisible(item, values)) continue;
      if (item.validation && avaliarGrupo(item.validation, values, false)) {
        erros.push({ apiName: item.apiName, message: item.validation.message });
      }
      if (isMultiReference(item)) {
        const dobrados = repetidos(escolhidosDe(item, values));
        if (dobrados.length) {
          erros.push({ apiName: item.apiName, message: `Contrato repetido: ${dobrados.join(', ')}` });
        }
      }
    }
  }
  return erros;
}

/**
 * Avalia uma expressão de lógica de filtro no formato da FlexiPage:
 * `1 AND (2 OR 3)`, onde os números são a posição 1-based das condições.
 *
 * Parser próprio, e não `new Function`: a expressão vem de um registro que
 * Ops edita, então executá-la como código seria injeção. Aqui só existem
 * número, AND, OR, NOT e parênteses — qualquer outra coisa é erro.
 *
 * Expressão inválida devolve `true` (componente visível). Esconder um campo
 * por causa de erro de configuração é pior do que mostrá-lo: o dado sumiria
 * do formulário sem ninguém perceber.
 */
export function avaliarExpressao(expressao, resultados) {
  if (!expressao || !String(expressao).trim()) return resultados.every(Boolean);

  const bruto = String(expressao).toUpperCase();

  // Estrito de propósito. Um tokenizer que descarta o que não reconhece faria
  // "1; DROP TABLE" virar "1" em silêncio — erro de digitação do Ops mudaria
  // o sentido da regra sem ninguém perceber. Tirados os operadores, só pode
  // sobrar número, espaço e parêntese.
  const resto = bruto.replace(/\bAND\b|\bOR\b|\bNOT\b/g, ' ');
  if (/[^\d\s()]/.test(resto)) return true;

  const tokens = bruto.match(/\d+|AND|OR|NOT|\(|\)/g);
  if (!tokens) return true;

  let i = 0;
  const fim = () => i >= tokens.length;
  const olhar = () => tokens[i];
  const comer = () => tokens[i++];

  // expressão := termo (OR termo)*
  function expr() {
    let v = termo();
    while (!fim() && olhar() === 'OR') {
      comer();
      const d = termo();
      v = v || d;
    }
    return v;
  }
  // termo := fator (AND fator)*
  function termo() {
    let v = fator();
    while (!fim() && olhar() === 'AND') {
      comer();
      const d = fator();
      v = v && d;
    }
    return v;
  }
  // fator := NOT fator | '(' expressão ')' | número
  function fator() {
    if (fim()) throw new Error('expressão incompleta');
    const t = comer();
    if (t === 'NOT') return !fator();
    if (t === '(') {
      const v = expr();
      if (comer() !== ')') throw new Error('parêntese não fechado');
      return v;
    }
    if (/^\d+$/.test(t)) {
      const idx = Number(t) - 1;
      if (idx < 0 || idx >= resultados.length) throw new Error(`filtro ${t} não existe`);
      return Boolean(resultados[idx]);
    }
    throw new Error(`token inesperado: ${t}`);
  }

  try {
    const v = expr();
    if (!fim()) throw new Error('sobrou token');
    return v;
  } catch {
    return true;
  }
}

/**
 * Data relativa como símbolo: HOJE, HOJE+2, HOJE-7, AGORA.
 *
 * O Cognito resolve isso com um campo oculto CALCULADO — o formulário 91 tem
 * `DataHoje` e `DataD2` invisíveis só para a validação poder compará-los. O
 * token faz o mesmo sem exigir um motor de cálculo na definição.
 *
 * `agora` é injetável para o teste não depender do relógio.
 */
export function resolverToken(token, agora = new Date()) {
  const bruto = String(token ?? '').trim().toUpperCase();
  if (bruto === 'AGORA') return agora.toISOString();

  const m = /^HOJE(?:\s*([+-])\s*(\d+))?$/.exec(bruto);
  if (!m) return null;

  const d = new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
  if (m[1]) d.setUTCDate(d.getUTCDate() + (m[1] === '-' ? -1 : 1) * Number(m[2]));
  return d.toISOString().slice(0, 10);
}

/**
 * O valor do outro lado da comparação.
 *
 *   LITERAL  o texto digitado (padrão, e o que sempre houve)
 *   FIELD    `value` é o nome de outro campo; compara campo a campo
 *   TOKEN    `value` é HOJE / HOJE+N / AGORA
 */
function resolverEsperado(condition, values, agora) {
  const origem = condition.valueSource || 'LITERAL';
  // `values` já é o escopo da condição: o outro campo é lido no mesmo objeto.
  if (origem === 'FIELD') return values[condition.value];
  if (origem === 'TOKEN') return resolverToken(condition.value, agora);
  return condition.value;
}

/** Data em ISO ou dd/mm/aaaa vira número comparável; o resto devolve null. */
function comoData(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t;
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const n = Date.parse(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  return Number.isNaN(n) ? null : n;
}

/**
 * Maior/menor com dois tipos possíveis. Data primeiro, porque `Number('2026-08-27')`
 * é NaN e a comparação virava `false` em silêncio — o filtro nunca disparava e
 * ninguém descobria olhando a configuração.
 */
function compara(a, b, ehMaior) {
  const da = comoData(a);
  const db = comoData(b);
  if (da !== null && db !== null) return ehMaior ? da > db : da < db;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return ehMaior ? na > nb : na < nb;
}

function evaluateCondition(condition, actual, values = {}, agora = new Date()) {
  const expected = resolverEsperado(condition, values, agora);
  const a = actual == null ? '' : String(actual);
  const b = expected == null ? '' : String(expected);

  switch (condition.operator) {
    case OPERATORS.EQUALS:
      return a === b;
    case OPERATORS.NOT_EQUALS:
      return a !== b;
    case OPERATORS.CONTAINS:
      return a.includes(b);
    case OPERATORS.NOT_CONTAINS:
      return !a.includes(b);
    case OPERATORS.STARTS_WITH:
      return a.startsWith(b);
    case OPERATORS.GREATER_THAN:
      return compara(a, b, true);
    case OPERATORS.LESS_THAN:
      return compara(a, b, false);
    case OPERATORS.IS_NULL:
      return a === '';
    case OPERATORS.IS_NOT_NULL:
      return a !== '';
    default:
      return true;
  }
}

/**
 * Monta o payload que SERIA enviado ao Salesforce.
 *
 * Regra semântica adotada: campo obrigatório e OCULTO não bloqueia o envio,
 * e seu valor não vai no payload.
 *
 * `contract.backendFields` são campos que o BFF grava sem passar pelo
 * formulário — vêm da configuração do formulário, não do usuário. Entram por
 * ÚLTIMO e sobrescrevem: são a autoridade sobre o que o registro é. Quem
 * escolheu o formulário já escolheu o Record Type e o Type; perguntar de novo
 * só abriria espaço para o dado divergir do catálogo.
 *
 * Só a fonte Screen Flow os usa hoje, porque só ela tem catálogo. Contrato sem
 * `backendFields` se comporta exatamente como antes deles existirem.
 */
export function buildSubmitPayload(contract, values) {
  // Seção oculta esconde tudo que está dentro dela. Sem isto, um campo
  // obrigatório numa seção escondida bloquearia um envio válido — e é
  // justamente o caso que a fonte custom introduz, porque só ela expressa
  // visibilidade em SEÇÃO.
  // Lista fica de fora daqui: seus campos não são do Caso, são do objeto do
  // item, e vão para o composite mais abaixo.
  const secoesSimples = contract.sections.filter((s) => !s.repeating);
  const listas = contract.sections.filter((s) => s.repeating && isVisible(s, values));

  const fields = secoesSimples
    .filter((s) => isVisible(s, values))
    .flatMap((s) => s.fields)
    .filter((f) => isFieldLike(f));

  const todosOsCampos = secoesSimples.flatMap((s) => s.fields).filter((f) => isFieldLike(f));
  const visible = fields.filter((f) => isVisible(f, values));

  const record = { attributes: { type: contract.object } };
  if (contract.recordType?.id) record.RecordTypeId = contract.recordType.id;

  for (const f of visible) {
    if (f.readOnly) continue;
    // Campo oculto não é digitado: o valor vem da definição. Se alguém mandar
    // um valor para ele mesmo assim, a definição vence — é o ponto de ser oculto.
    const value = f.hidden ? (f.defaultValue ?? values[f.apiName]) : (values[f.apiName] ?? f.defaultValue);
    if (value !== undefined && value !== null && value !== '') record[f.apiName] = value;
  }

  const backendFields = contract.backendFields ?? {};
  const overwritten = [];
  for (const [apiName, value] of Object.entries(backendFields)) {
    if (value === null || value === undefined || value === '') continue;
    if (record[apiName] !== undefined && record[apiName] !== value) overwritten.push(apiName);
    record[apiName] = value;
  }

  // isRequired e não f.required: a obrigatoriedade pode vir de regra, e aí
  // depende do que o usuário preencheu até agora.
  const missing = visible
    .filter((f) => isRequired(f, values) && !f.readOnly)
    // Oculto com valor padrão está preenchido por definição; sem valor padrão
    // não há como o usuário resolver, então travar o envio nele não ajuda.
    .filter((f) => !f.hidden)
    .filter((f) => backendFields[f.apiName] === undefined)
    .filter((f) => values[f.apiName] === undefined || values[f.apiName] === '')
    .map((f) => f.apiName);

  const attachmentsProvided = Array.isArray(values.__attachments) ? values.__attachments.length : 0;
  if (contract.attachments.required && attachmentsProvided < contract.attachments.minimumCount) {
    missing.push(`__attachments (${attachmentsProvided}/${contract.attachments.minimumCount})`);
  }

  const invalid = validar(contract, values);
  const { itens, problemasDeLista, invalidosDeLista } = montarItensDeLista(listas, values, contract.object);
  missing.push(...problemasDeLista);
  invalid.push(...invalidosDeLista);

  const { vinculos, problemasDeVinculo } = montarVinculos(secoesSimples, values);
  missing.push(...problemasDeVinculo);

  const composto = itens.length || vinculos.length;
  const subrequests = composto ? compositeDoEnvio(contract.object, record, itens, vinculos, 'vXX.X') : [];

  return {
    valid: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    listas: itens,
    vinculos,
    hiddenFieldsIgnored: todosOsCampos
      .filter((f) => !visible.includes(f))
      .map((f) => f.apiName),
    injectedFields: backendFields,
    injectedOverwroteForm: overwritten,
    // O composite em palavras, na ordem: o que cada subrequisição cria e de onde
    // vem cada vínculo. O inspetor mostra isto acima do JSON.
    etapas: composto ? descreverEtapas(subrequests, itens, vinculos) : [],
    request: composto
      ? {
          method: 'POST',
          url: '/services/data/vXX.X/composite',
          body: { allOrNone: true, compositeRequest: subrequests },
        }
      : {
          method: 'POST',
          url: `/services/data/vXX.X/sobjects/${contract.object}`,
          body: record,
        },
  };
}

/**
 * Os itens preenchidos de cada lista visível.
 *
 * `values.__listas[secaoId]` é um array de objetos, um por item. Item vazio é
 * descartado em silêncio: o cliente clicou em "adicionar" e desistiu, e isso
 * não é erro.
 *
 * Cada item é avaliado no próprio escopo (`escopoDoItem`): visibilidade,
 * obrigatoriedade e validação dos campos dele leem as respostas do item, ou as
 * do formulário quando a regra aponta o objeto do formulário.
 */
function montarItensDeLista(listas, values, objetoDoFormulario) {
  const itens = [];
  const problemasDeLista = [];
  const invalidosDeLista = [];

  for (const lista of listas) {
    const brutos = (values.__listas && values.__listas[lista.id]) || [];
    const campos = lista.fields.filter((f) => isFieldLike(f));
    let digitados = 0;

    brutos.forEach((item, i) => {
      const escopo = escopoDoItem(objetoDoFormulario, values, item);
      const visiveis = campos.filter((f) => isVisible(f, escopo));

      const registro = {};
      for (const f of visiveis) {
        if (f.readOnly) continue;
        const v = f.hidden ? (f.defaultValue ?? item[f.apiName]) : (item[f.apiName] ?? f.defaultValue);
        if (v !== undefined && v !== null && v !== '') registro[f.apiName] = v;
      }

      // Só o que o usuário DIGITOU conta, como no formRunner (`collectListItems`):
      // valor padrão — de campo oculto ou não — preenche sozinho, e um item que
      // só tem isso não foi preenchido por ninguém e não deve virar registro.
      const foiPreenchido = visiveis.some((f) => !f.hidden && !f.readOnly && digitado(item[f.apiName]));
      if (!foiPreenchido) return;
      digitados += 1;

      const rotulo = `${lista.itemLabel ?? 'Item'} ${i + 1}`;
      for (const f of visiveis) {
        if (f.hidden || f.readOnly) continue;
        if (!digitado(item[f.apiName]) && isRequired(f, escopo)) problemasDeLista.push(`${lista.label} · ${rotulo}: ${f.label}`);
        if (f.validation && avaliarGrupo(f.validation, escopo, false)) {
          invalidosDeLista.push({ apiName: `${lista.id}[${i}].${f.apiName}`, message: `${rotulo}: ${f.validation.message}` });
        }
      }

      itens.push({
        secaoId: lista.id,
        listaLabel: lista.label,
        object: lista.childObject,
        recordTypeId: lista.childRecordTypeId ?? null,
        recordTypeDevName: lista.childRecordTypeDevName ?? null,
        caseField: lista.caseField ?? null,
        listField: lista.listField ?? null,
        relationshipField: lista.childRelationshipField ?? null,
        submissionField: lista.submissionField ?? null,
        record: registro,
      });
    });

    if (lista.minItems && digitados < lista.minItems) {
      problemasDeLista.push(`${lista.label} (${digitados}/${lista.minItems} itens)`);
    }
    if (lista.maxItems && digitados > lista.maxItems) {
      problemasDeLista.push(`${lista.label} (${digitados} itens, máximo ${lista.maxItems})`);
    }
  }

  return { itens, problemasDeLista, invalidosDeLista };
}

/** Resposta de fato dada num item de lista: `false` e lista vazia não contam. */
function digitado(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== '' && v !== false;
}

/**
 * As escolhas das referências múltiplas visíveis, um vínculo por escolha.
 * Linha vazia é descartada em silêncio, como item de lista vazio.
 *
 * Cada componente diz o próprio destino (`f.link`, lido da linha da definição):
 * duas referências múltiplas no mesmo formulário podem criar objetos
 * diferentes, com o Caso e o id externo em campos diferentes.
 */
function montarVinculos(secoesSimples, values) {
  const vinculos = [];
  const problemasDeVinculo = [];

  const multiplas = secoesSimples
    .filter((s) => isVisible(s, values))
    .flatMap((s) => s.fields)
    .filter((f) => isMultiReference(f) && isVisible(f, values));

  for (const f of multiplas) {
    // Repetido já é invalidez (ver `validar`); aqui só não vira dois registros.
    const escolhidos = [...new Set(escolhidosDe(f, values))];
    if (escolhidos.length === 0 && isRequired(f, values)) {
      problemasDeVinculo.push(`${f.label} (nenhum ${f.reference?.object ?? 'registro'} escolhido)`);
    }
    for (const externalId of escolhidos) {
      vinculos.push({
        origem: f.apiName,
        label: f.label,
        object: f.link.object,
        caseField: f.link.caseField,
        externalIdField: f.link.externalIdField,
        externalId,
        submissionField: f.link.submissionField,
        record: { [f.link.externalIdField]: externalId },
      });
    }
  }

  return { vinculos, problemasDeVinculo };
}

/** referenceId da subrequisição que cria o registro do formulário. */
export const REF_PAI = 'refPai';

/** referenceId da consulta que acha o Caso gerado pelo envio. */
export const REF_CASO = 'casoGerado';

/** O lookup do Caso que aponta para o envio, quando o contrato não disser outro. */
const CAMPO_DO_ENVIO_PADRAO = 'RelatedCaseFormSubmission__c';

/**
 * As subrequisições do envio, na ordem em que o Salesforce as executa.
 *
 *   1. o registro do formulário                         `refPai`
 *   2. a leitura do Caso que o trigger dele criou       `casoGerado`  (se precisar)
 *   3. um POST por item de lista                        `item1..N`
 *   4. um POST por escolha de referência múltipla      `vinculo1..N`
 *      (no objeto e nos campos que CADA componente declara)
 *
 * O registro do formulário não é o Caso: o Caso nasce no trigger after insert
 * do envio, na MESMA transação, com o Id do envio em `submissionField`
 * (Case.RelatedCaseFormSubmission__c). Então uma consulta logo depois do POST já
 * o encontra, e itens e vínculos usam `@{casoGerado.records[0].Id}`. Formulário
 * que cria o próprio Case dispensa a consulta.
 *
 * Cada item leva o que a definição da lista manda: o `RecordTypeId` dos itens,
 * o Id do Caso no campo `caseField` (o trigger do item preenche o envio a partir
 * dele) e o Id da lista no campo `listField` (o trigger aplica o Record Type e os
 * valores padrão daquela lista). Lista sem `caseField` cai no modelo antigo: o
 * item aponta direto para o registro, por `relationshipField`.
 *
 * Uma subrequisição por registro, e não um `composite/sobjects` com a lista: a
 * coleção reporta a falha de cada registro DENTRO de uma resposta 200, e o
 * `allOrNone` de fora decide pelo status da subrequisição. Com um POST por
 * registro, a falha é um 400 e a transação inteira volta, envio incluído.
 *
 * A referência dentro da URL vai crua, sem encode — encodada, a consulta
 * devolve 200 com zero registros (ver `schemaEFormulario`).
 */
export function compositeDoEnvio(objetoPai, record, itens = [], vinculos = [], versao = 'vXX.X') {
  const subrequests = [
    { referenceId: REF_PAI, method: 'POST', url: `/services/data/${versao}/sobjects/${objetoPai}`, body: record },
  ];

  const precisaDoCaso = itens.some((i) => i.caseField) || vinculos.length > 0;
  let idDoCaso = `@{${REF_PAI}.id}`;
  if (precisaDoCaso && objetoPai !== 'Case') {
    const campo =
      itens.find((i) => i.caseField)?.submissionField ?? vinculos[0]?.submissionField ?? CAMPO_DO_ENVIO_PADRAO;
    subrequests.push({
      referenceId: REF_CASO,
      method: 'GET',
      url: `/services/data/${versao}/query?q=SELECT+Id,CaseNumber+FROM+Case+WHERE+${campo}='@{${REF_PAI}.id}'+LIMIT+1`,
    });
    idDoCaso = `@{${REF_CASO}.records[0].Id}`;
  }

  itens.forEach((item, i) => {
    const body = {};
    if (item.recordTypeId) body.RecordTypeId = item.recordTypeId;
    Object.assign(body, item.record);
    if (item.listField) body[item.listField] = item.secaoId;
    if (item.caseField) body[item.caseField] = idDoCaso;
    else if (item.relationshipField) body[item.relationshipField] = `@{${REF_PAI}.id}`;
    subrequests.push({
      referenceId: `item${i + 1}`,
      method: 'POST',
      url: `/services/data/${versao}/sobjects/${item.object}`,
      body,
    });
  });

  vinculos.forEach((v, i) => {
    subrequests.push({
      referenceId: `vinculo${i + 1}`,
      method: 'POST',
      url: `/services/data/${versao}/sobjects/${v.object}`,
      body: { ...v.record, [v.caseField]: idDoCaso },
    });
  });

  return subrequests;
}

/**
 * O composite em palavras: uma linha por subrequisição, com o que ela cria e de
 * onde vem cada vínculo. É o que o inspetor mostra acima do JSON, para quem
 * monta o envio no canal conferir a ordem e os campos sem decifrar o corpo.
 */
function descreverEtapas(subrequests, itens, vinculos) {
  const porLista = {};
  return subrequests.map((s) => {
    const alvo = s.url.split('/sobjects/')[1] ?? (s.method === 'GET' ? 'Case' : '');
    const base = { referenceId: s.referenceId, method: s.method, alvo };

    if (s.referenceId === REF_PAI) {
      return { ...base, nota: `o registro do formulário · ${Object.keys(s.body).length - 1} campo(s)` };
    }
    if (s.referenceId === REF_CASO) {
      return { ...base, nota: 'o Caso que o trigger do envio criou; itens e vínculos se ligam a ele' };
    }
    const item = /^item(\d+)$/.exec(s.referenceId);
    if (item) {
      const it = itens[Number(item[1]) - 1];
      porLista[it.secaoId] = (porLista[it.secaoId] ?? 0) + 1;
      const partes = [`${it.listaLabel}, item ${porLista[it.secaoId]}`];
      if (it.recordTypeId) partes.push(`RecordTypeId = ${it.recordTypeDevName ?? it.recordTypeId}`);
      if (it.caseField) partes.push(`${it.caseField} = id do Caso`);
      else if (it.relationshipField) partes.push(`${it.relationshipField} = id do registro`);
      if (it.listField) partes.push(`${it.listField} = id da lista`);
      return { ...base, nota: partes.join(' · ') };
    }
    const vinc = /^vinculo(\d+)$/.exec(s.referenceId);
    if (vinc) {
      const v = vinculos[Number(vinc[1]) - 1];
      return {
        ...base,
        nota: `${v.label ?? 'referência múltipla'} · ${v.externalIdField} = ${v.externalId} · ${v.caseField} = id do Caso`,
      };
    }
    return { ...base, nota: '' };
  });
}
