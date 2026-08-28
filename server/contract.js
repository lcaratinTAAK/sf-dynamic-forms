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
 *       options: [{ value, label, validFor }] | null,
 *       controllerField: string | null,
 *       visibility: Visibility | null
 *     }]
 *   }],
 *   attachments: { required, minimumCount, documents: [{ code, label }], component },
 *   backendFields: { [apiName]: value },   // gravados pelo BFF, nunca renderizados
 *   formDefinition: { id, label, source, channel } | null,
 *   diagnostics: { calls: [...], warnings: [...] }
 * }
 *
 * Visibility = {
 *   logic: 'AND' | 'OR',
 *   conditions: [{ field, operator, value }]
 * }
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
  if (form.caseType) out.Type = form.caseType;
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

  return {
    ...field,
    options: (entry.values || []).map((v) => ({
      value: v.value,
      label: v.label,
      validFor: v.validFor || [],
    })),
    // controllerValues mapeia valor-do-controlador -> índice usado em validFor
    controllerValues: entry.controllerValues || null,
    controllerField: field.controllerField ?? null,
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

  const resultados = conditions.map((c) => evaluateCondition(c, values[c.field], values));

  // ANY/OR e ALL/AND são o mesmo conceito com nomes diferentes: o vocabulário
  // da FlexiPage e o que as fontes anteriores já produziam.
  const modo = String(logic).toUpperCase();
  if (modo === 'CUSTOM') return avaliarExpressao(expression, resultados);
  if (modo === 'ANY' || modo === 'OR') return resultados.some(Boolean);
  return resultados.every(Boolean);
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
    if (!isVisible(secao, values)) continue;
    for (const item of secao.fields || []) {
      if (!item.validation || !isVisible(item, values)) continue;
      if (avaliarGrupo(item.validation, values, false)) {
        erros.push({ apiName: item.apiName, message: item.validation.message });
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
    .filter((f) => (f.kind ?? 'field') === 'field');

  const todosOsCampos = secoesSimples.flatMap((s) => s.fields).filter((f) => (f.kind ?? 'field') === 'field');
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
  const { itens, problemasDeLista } = montarItensDeLista(listas, values);
  missing.push(...problemasDeLista);

  const invalid2 = invalid;

  return {
    valid: missing.length === 0 && invalid2.length === 0,
    missing,
    invalid: invalid2,
    listas: itens,
    hiddenFieldsIgnored: todosOsCampos
      .filter((f) => !visible.includes(f))
      .map((f) => f.apiName),
    injectedFields: backendFields,
    injectedOverwroteForm: overwritten,
    request: itens.length
      ? montarComposite(contract, record, itens)
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
 */
function montarItensDeLista(listas, values) {
  const itens = [];
  const problemasDeLista = [];

  for (const lista of listas) {
    const brutos = (values.__listas && values.__listas[lista.id]) || [];
    const campos = lista.fields.filter((f) => (f.kind ?? 'field') === 'field');

    const preenchidos = brutos
      .map((item) => {
        const registro = {};
        for (const f of campos) {
          if (f.readOnly) continue;
          const v = f.hidden ? (f.defaultValue ?? item[f.apiName]) : (item[f.apiName] ?? f.defaultValue);
          if (v !== undefined && v !== null && v !== '') registro[f.apiName] = v;
        }
        return registro;
      })
      .filter((r) => Object.keys(r).length > 0);

    // Campo oculto com valor padrão preenche sozinho — um item que só tem esses
    // não foi preenchido por ninguém e não deve virar registro.
    const digitados = preenchidos.filter((r) =>
      campos.some((f) => !f.hidden && r[f.apiName] !== undefined)
    );

    if (lista.minItems && digitados.length < lista.minItems) {
      problemasDeLista.push(`${lista.label} (${digitados.length}/${lista.minItems} itens)`);
    }
    if (lista.maxItems && digitados.length > lista.maxItems) {
      problemasDeLista.push(`${lista.label} (${digitados.length} itens, máximo ${lista.maxItems})`);
    }

    for (const registro of digitados) {
      itens.push({
        secaoId: lista.id,
        object: lista.childObject,
        relationshipField: lista.childRelationshipField,
        record: registro,
      });
    }
  }

  return { itens, problemasDeLista };
}

/**
 * O Caso ainda não existe quando o cliente preenche, então os itens não têm o
 * id do pai para gravar. O composite resolve isso dentro da própria transação:
 * o `referenceId` da primeira subrequisição vira `@{ref.id}` nas seguintes.
 *
 * `allOrNone` porque um Caso sem os membros que o justificam é pior que erro
 * nenhum — a pessoa reenviaria e criaria um Caso duplicado.
 */
function montarComposite(contract, record, itens) {
  const REF_PAI = 'refPai';
  const subrequests = [
    {
      referenceId: REF_PAI,
      method: 'POST',
      url: `/services/data/vXX.X/sobjects/${contract.object}`,
      body: record,
    },
  ];

  itens.forEach((item, i) => {
    subrequests.push({
      referenceId: `item${i + 1}`,
      method: 'POST',
      url: `/services/data/vXX.X/sobjects/${item.object}`,
      body: { ...item.record, [item.relationshipField]: `@{${REF_PAI}.id}` },
    });
  });

  return {
    method: 'POST',
    url: '/services/data/vXX.X/composite',
    body: { allOrNone: true, compositeRequest: subrequests },
  };
}
