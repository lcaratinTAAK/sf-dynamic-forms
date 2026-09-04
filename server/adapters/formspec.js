/**
 * ADAPTADOR 4 — FormDefinition__c, definição 100% custom.
 *
 * As três fontes anteriores leem uma estrutura que o Salesforce mantém para
 * OUTRO propósito — Page Layout existe para a tela interna, Screen Flow para
 * ser executado — e por isso cada uma esbarra num limite diferente: o layout
 * não modela condição nem anexo, o flow não declara Record Type nem aceita
 * obrigatoriedade por formulário.
 *
 * Aqui a estrutura existe para ser formulário. Uma tabela só, com Record Type
 * dizendo o que cada linha é:
 *
 *   Form        a raiz — objeto e Record Type de destino, canal, Tipo do registro
 *   Section     agrupamento, com visibilidade própria
 *   Field       campo, vinculado a um campo do SObject
 *   Attachment  documento exigido, tratado como componente
 *   Rule        regra de visibilidade, filha do componente que afeta
 *   Content     bloco de texto estático
 *
 * Chamadas — duas:
 *   POST /composite                                    schema dos campos,
 *                                                      dependências de picklist,
 *                                                      a especificação inteira
 *                                                      e o Record Type de destino
 *   GET  /ui-api/object-info/{obj}/picklist-values/{rt} valores válidos
 *
 * As picklists ficam de fora por imposição do Salesforce: o composite recusa
 * recursos de ui-api com INVALID_BATCH_REQUEST, e é a única fonte que respeita
 * Record Type e devolve as dependências.
 *
 * O que NÃO se guarda aqui, de propósito: label, tipo, tamanho e ajuda do
 * campo. Isso é metadado do campo e vem do schema em tempo de leitura.
 * Duplicar aqui criaria uma segunda verdade que diverge no dia em que alguém
 * mexer no campo.
 */

import { soql, getPicklistValues, schemaEFormulario } from '../salesforce.js';
import {
  emptyContract,
  makeField,
  applyEntityParticle,
  indexarCampos,
  applyPicklistValues,
  normalizeOperator,
  backendFieldsFromForm,
} from '../contract.js';
import { config } from '../config.js';

const OBJ = config.formsObject || 'FormDefinition__c';

const CAMPOS = `Id, Name, RecordType.DeveloperName, Form__c, Parent__c, Sort__c, Width__c,
  ObjectApiName__c, TargetRecordTypeDevName__c,
  FormKey__c, Version__c, Status__c, VersionKey__c,
  TypeFieldApiName__c, TypeValue__c, PriorityFieldApiName__c, PriorityValue__c, QueueDeveloperName__c,
  Channel__c, PublicLabel__c, Description__c,
  FieldApiName__c, LabelOverride__c, HelpTextOverride__c, Placeholder__c, DefaultValue__c, IsHidden__c,
  IsRequired__c, IsReadOnly__c,
  DocumentCode__c, AcceptedTypes__c, MinFiles__c, MaxFiles__c, MaxSizeMb__c,
  ConditionFieldApiName__c, Operator__c, Value__c, Effect__c,
  FilterLogicType__c, FilterLogic__c,
  Body__c, ItemLabel__c, AddButtonText__c,
  Message__c, RequiredLogicType__c, ValidationLogicType__c, ValueSource__c,
  ChildObjectApiName__c, ChildRelationshipField__c, MinItems__c, MaxItems__c`.replace(/\s+/g, ' ');

/** Catálogo: só as linhas raiz. Uma query. */
export const queryCatalogo = () =>
  `SELECT Id, Name, PublicLabel__c, Description__c, ObjectApiName__c, TargetRecordTypeDevName__c, ` +
  `FormKey__c, Version__c, Status__c, VersionKey__c, ` +
  `TypeFieldApiName__c, TypeValue__c, PriorityFieldApiName__c, PriorityValue__c, Channel__c ` +
  `FROM ${OBJ} WHERE RecordType.DeveloperName = 'Form' AND IsActive__c = true ORDER BY Name`;

/**
 * A especificação inteira.
 *
 * `Id = x OR Form__c = x` é o que dispensa composite e Apex REST: como TODA
 * linha aponta para a raiz, uma condição plana traz a árvore completa. Uma
 * hierarquia em objetos separados precisaria de várias chamadas, porque SOQL
 * só desce um nível de sub-query.
 */
export const querySpec = (formId) =>
  `SELECT ${CAMPOS} FROM ${OBJ} ` +
  `WHERE (Id = '${formId}' OR Form__c = '${formId}') AND IsActive__c = true ` +
  `ORDER BY Sort__c NULLS FIRST, Name`;

export async function listarFormularios() {
  const r = await soql(queryCatalogo());
  return (r.records || []).map((f) => ({
    id: f.Id,
    key: f.FormKey__c ?? null,
    version: f.Version__c ?? null,
    status: f.Status__c ?? null,
    versionKey: f.VersionKey__c ?? null,
    label: f.PublicLabel__c || f.Name,
    description: f.Description__c ?? null,
    objectApiName: f.ObjectApiName__c,
    recordTypeDevName: f.TargetRecordTypeDevName__c,
    typeFieldApiName: f.TypeFieldApiName__c ?? null,
    typeValue: f.TypeValue__c ?? null,
    priorityFieldApiName: f.PriorityFieldApiName__c ?? null,
    priorityValue: f.PriorityValue__c ?? null,
    channel: f.Channel__c ?? null,
  }));
}

export async function buildContract({ formId, objectApiName, recordTypeDevName = null }) {
  const calls = [];
  const avisos = [];
  const track = (label, path, extra = {}) => calls.push({ label, path, ...extra });

  // 1. Schema, dependências de picklist, especificação e Record Type — numa
  //    viagem só.
  //
  //    O Record Type cabe aqui porque o DeveloperName vem do CATÁLOGO, que o
  //    cliente já leu para montar o seletor. Sem ele, a consulta dependeria do
  //    retorno da especificação, e as subrequisições do lote são independentes
  //    — era isso que obrigava a duas chamadas separadas.
  const q = querySpec(formId);
  const pacote = await schemaEFormulario(objectApiName, {
    specSoql: q,
    recordTypeDevName,
  });

  track(
    'Metadado dos campos + especificação do formulário',
    `/composite → EntityParticle + FieldDefinition (${objectApiName}) + ${OBJ}` +
      (recordTypeDevName ? ' + RecordType' : ''),
    { replayId: `pacote:${objectApiName}:${formId}:${recordTypeDevName ?? ''}`, method: 'POST' }
  );

  const indiceDeCampos = indexarCampos(pacote.campos);
  const controladorDe = pacote.controladorDe ?? {};
  const linhas = pacote.spec;

  const raiz = linhas.find((r) => r.Id === formId);
  if (!raiz) throw new Error(`Formulário ${formId} não encontrado em ${OBJ}.`);

  const objeto = raiz.ObjectApiName__c || objectApiName;
  const esperado = raiz.TargetRecordTypeDevName__c;

  if (raiz.ObjectApiName__c && objectApiName && raiz.ObjectApiName__c !== objectApiName) {
    avisos.push(
      `ObjectApiName__c da especificação ("${raiz.ObjectApiName__c}") diverge do palpite usado para o schema ("${objectApiName}"); campos exibidos podem vir do objeto errado. Catálogo desatualizado no cliente?`
    );
  }

  if (pacote.palpiteRecusado) {
    avisos.push('recordTypeDevName recebido em formato inválido; ignorado e resolvido pela especificação.');
  }

  // Uma subrequisição pode voltar CORTADA — `done: false`, com parte dos
  // registros — e ainda assim com status 200. Nesse caso ela é refeita sozinha,
  // e a viagem extra aparece aqui: senão o inspetor mostraria duas chamadas
  // onde houve três.
  for (const nome of pacote.refeitos ?? []) {
    track(`Refazendo "${nome}" — veio cortado do lote`, '/query (fora do composite)');
    avisos.push(
      `A subrequisição "${nome}" voltou cortada do lote e foi refeita sozinha. ` +
        'Custou uma viagem extra; vale olhar a largura das linhas dessa consulta.'
    );
  }

  // 2. O DeveloperName que chegou é PALPITE. Quem manda é a especificação: se
  //    divergirem, o que veio na requisição é descartado.
  //
  //    Não é zelo teórico. O `RecordTypeId` é campo de back-end, injetado pelo
  //    servidor justamente para o formulário não escolher em que Record Type o
  //    Caso nasce — aceitar o da query string devolveria essa escolha a quem
  //    edita a URL. A divergência também acontece sem má-fé, quando o admin
  //    troca o Record Type e o cliente está com catálogo velho em cache; nos
  //    dois casos, refazer a consulta é o lado certo para errar.
  let rt = pacote.recordType;
  if (rt && rt.DeveloperName !== esperado) {
    avisos.push(
      `recordTypeDevName "${rt.DeveloperName}" diverge da especificação ("${esperado}"); ` +
        'o da especificação prevaleceu. Catálogo desatualizado no cliente?'
    );
    rt = null;
  }

  if (!rt) {
    const qRt =
      `SELECT Id, Name, DeveloperName FROM RecordType WHERE SobjectType = '${objeto}' ` +
      `AND DeveloperName = '${esperado}' LIMIT 1`;
    track('Record Type de destino', `/query?q=${qRt}`);
    rt = (await soql(qRt)).records?.[0] ?? null;
  }

  // 3. Picklists — continuam na UI API. É a única fonte que respeita Record
  //    Type e devolve as dependências, e não entra em composite: o endpoint
  //    recusa recursos de ui-api com INVALID_BATCH_REQUEST.
  let picklists = null;
  if (rt) {
    track('Valores de picklist', `/ui-api/object-info/${objeto}/picklist-values/${rt.Id}`);
    picklists = await getPicklistValues(objeto, rt.Id);
  }

  const contract = specToContract(linhas, { formId, objectApiName: objeto, indiceDeCampos, controladorDe, picklists, rt });
  contract.diagnostics.calls = calls;
  contract.diagnostics.warnings.unshift(...avisos);
  return contract;
}

/**
 * Tradução pura: linhas de FormDefinition__c -> contrato. Sem I/O, testável offline.
 */
export function specToContract(linhas, { formId, objectApiName, indiceDeCampos, controladorDe = {}, picklists, rt }) {
  const contract = emptyContract('FORM_SPEC', objectApiName);
  const raiz = linhas.find((r) => r.Id === formId);
  const tipo = (r) => r.RecordType?.DeveloperName;

  contract.recordType = rt
    ? { id: rt.Id, developerName: raiz.TargetRecordTypeDevName__c, label: rt.Name }
    : { id: null, developerName: raiz.TargetRecordTypeDevName__c, label: null };

  contract.formDefinition = {
    id: raiz.Id,
    key: raiz.FormKey__c ?? null,
    version: raiz.Version__c ?? null,
    status: raiz.Status__c ?? null,
    versionKey: raiz.VersionKey__c ?? null,
    label: raiz.PublicLabel__c || raiz.Name,
    source: 'FORM_SPEC',
    channel: raiz.Channel__c ?? null,
    description: raiz.Description__c ?? null,
  };

  contract.backendFields = backendFieldsFromForm({
    recordType: contract.recordType,
    typeFieldApiName: raiz.TypeFieldApiName__c,
    typeValue: raiz.TypeValue__c,
    priorityFieldApiName: raiz.PriorityFieldApiName__c,
    priorityValue: raiz.PriorityValue__c,
  });

  if (!rt) {
    contract.diagnostics.warnings.push(
      `Record Type "${raiz.TargetRecordTypeDevName__c}" não existe ou está inativo em ${objectApiName}. ` +
        'Picklists não puderam ser resolvidas.'
    );
  }

  // --- índice das regras, por componente alvo ---
  const regrasPorAlvo = new Map();
  for (const r of linhas.filter((x) => tipo(x) === 'Rule')) {
    if (!r.Parent__c) continue;
    if (!regrasPorAlvo.has(r.Parent__c)) regrasPorAlvo.set(r.Parent__c, []);
    regrasPorAlvo.get(r.Parent__c).push(r);
  }

  /**
   * O MODO da lógica vive no componente alvo, não na regra — igual ao
   * "Show component when" da FlexiPage. As regras são os filtros numerados,
   * e o número é a Ordem (Sort__c) de cada uma.
   */
  const condicoesDe = (regras) =>
    regras.map((r) => ({
      field: r.ConditionFieldApiName__c,
      operator: normalizeOperator(r.Operator__c),
      value: r.Value__c,
      valueSource: r.ValueSource__c || 'LITERAL',
    }));

  const regrasComEfeito = (alvo, efeito) =>
    (regrasPorAlvo.get(alvo.Id) || [])
      // Regra antiga sem efeito gravado é SHOW: era o único que existia.
      .filter((r) => (r.Effect__c || 'SHOW') === efeito)
      .sort((a, b) => (a.Sort__c ?? 0) - (b.Sort__c ?? 0));

  const visibilidadeDe = (alvo) => {
    const regras = regrasComEfeito(alvo, 'SHOW');
    if (regras.length === 0) return null;

    const modo = alvo.FilterLogicType__c || 'ALL';
    if (modo === 'CUSTOM' && !alvo.FilterLogic__c) {
      contract.diagnostics.warnings.push(
        `"${alvo.Name}" usa lógica CUSTOM sem expressão preenchida; tratado como ALL.`
      );
    }

    return {
      logic: modo === 'CUSTOM' && alvo.FilterLogic__c ? 'CUSTOM' : modo === 'ANY' ? 'ANY' : 'ALL',
      expression: modo === 'CUSTOM' ? alvo.FilterLogic__c ?? null : null,
      conditions: condicoesDe(regras),
    };
  };

  /**
   * Obrigatoriedade condicional: mesma máquina de filtros da visibilidade, com
   * grupo e lógica próprios. Um campo pode aparecer sob uma condição e só ser
   * exigido sob outra — por isso não dá para reaproveitar FilterLogicType__c.
   */
  const obrigatoriedadeDe = (alvo) => {
    const regras = regrasComEfeito(alvo, 'REQUIRE');
    if (regras.length === 0) return null;
    return {
      logic: alvo.RequiredLogicType__c === 'ANY' ? 'ANY' : 'ALL',
      expression: null,
      conditions: condicoesDe(regras),
    };
  };

  /**
   * Validação customizada. A condição descreve quando o preenchimento é
   * INVÁLIDO — é a semântica do Cognito, onde a expressão dispara a mensagem.
   * Sem mensagem a regra não teria o que dizer ao usuário, então é descartada
   * com aviso em vez de bloquear o envio em silêncio.
   */
  const validacaoDe = (alvo) => {
    const regras = regrasComEfeito(alvo, 'BLOCK');
    if (regras.length === 0) return null;
    if (!alvo.Message__c) {
      contract.diagnostics.warnings.push(
        `"${alvo.Name}" tem regra de validação sem mensagem; ignorada.`
      );
      return null;
    }
    return {
      message: alvo.Message__c,
      logic: alvo.ValidationLogicType__c === 'ANY' ? 'ANY' : 'ALL',
      expression: null,
      conditions: condicoesDe(regras),
    };
  };

  // --- filhos: quem tem Parent__c vazio é filho direto da raiz ---
  const filhosDe = (paiId) =>
    linhas
      .filter((r) => r.Id !== formId && tipo(r) !== 'Rule')
      .filter((r) => (paiId === formId ? !r.Parent__c : r.Parent__c === paiId))
      .sort((a, b) => (a.Sort__c ?? 0) - (b.Sort__c ?? 0));

  // --- conversão de um componente em item do contrato ---
  const anexos = [];

  const paraItem = (r) => {
    const t = tipo(r);

    if (t === 'Content') {
      return {
        kind: 'content',
        apiName: `__content_${r.Id}`,
        label: r.Name,
        html: r.Body__c ?? '',
        width: r.Width__c ?? 'FULL',
        visibility: visibilidadeDe(r),
      };
    }

    if (t === 'Attachment') {
      const item = {
        kind: 'attachment',
        apiName: `__attachment_${r.DocumentCode__c || r.Id}`,
        label: r.Name,
        code: r.DocumentCode__c ?? null,
        required: r.IsRequired__c === true,
        minFiles: r.MinFiles__c ?? (r.IsRequired__c ? 1 : 0),
        maxFiles: r.MaxFiles__c ?? null,
        maxSizeMb: r.MaxSizeMb__c ?? null,
        acceptedTypes: r.AcceptedTypes__c ? r.AcceptedTypes__c.split(',').map((s) => s.trim()) : [],
        width: r.Width__c ?? 'FULL',
        visibility: visibilidadeDe(r),
        requiredWhen: obrigatoriedadeDe(r),
        validation: validacaoDe(r),
      };
      anexos.push(item);
      return item;
    }

    if (t === 'Field') {
      let campo = makeField(r.FieldApiName__c, {
        label: r.LabelOverride__c || r.FieldApiName__c,
        required: r.IsRequired__c === true,
        readOnly: r.IsReadOnly__c === true,
        visibility: visibilidadeDe(r),
      });
      campo = applyEntityParticle(campo, indiceDeCampos, controladorDe);
      if (picklists) campo = applyPicklistValues(campo, picklists);

      // O que a especificação diz vence o schema, porque é escolha de
      // formulário; o resto continua vindo do object-info.
      if (r.LabelOverride__c) campo.label = r.LabelOverride__c;
      if (r.HelpTextOverride__c) campo.helpText = r.HelpTextOverride__c;
      campo.required = r.IsRequired__c === true;
      campo.kind = 'field';
      campo.width = r.Width__c ?? 'FULL';
      campo.placeholder = r.Placeholder__c ?? null;
      campo.defaultValue = r.DefaultValue__c ?? null;
      campo.hidden = r.IsHidden__c === true;
      campo.requiredWhen = obrigatoriedadeDe(r);
      campo.validation = validacaoDe(r);
      return campo;
    }

    return null;
  };

  // --- monta as seções ---
  const secoes = [];
  const soltos = [];

  for (const filho of filhosDe(formId)) {
    const t = tipo(filho);

    if (t === 'RepeatingSection') {
      // Uma lista não é uma seção com adorno: os campos dentro dela endereçam
      // OUTRO objeto, e no envio ela vira um array de registros filhos em vez
      // de campos no Caso.
      if (!filho.ChildObjectApiName__c) {
        contract.diagnostics.warnings.push(
          `Lista "${filho.Name}" está sem objeto de destino; ignorada.`
        );
        continue;
      }
      if (!filho.ChildRelationshipField__c) {
        contract.diagnostics.warnings.push(
          `Lista "${filho.Name}" está sem o campo de vínculo com o pai; ignorada.`
        );
        continue;
      }
      secoes.push({
        id: filho.Id,
        label: filho.Name,
        visibility: visibilidadeDe(filho),
        repeating: true,
        itemLabel: filho.ItemLabel__c || 'Item',
        addButtonText: filho.AddButtonText__c || 'Adicionar item',
        minItems: filho.MinItems__c ?? null,
        maxItems: filho.MaxItems__c ?? null,
        childObject: filho.ChildObjectApiName__c,
        childRelationshipField: filho.ChildRelationshipField__c,
        fields: filhosDe(filho.Id).map(paraItem).filter(Boolean),
      });
      continue;
    }

    if (t === 'Section') {
      const itens = filhosDe(filho.Id).map(paraItem).filter(Boolean);
      secoes.push({
        id: filho.Id,
        label: filho.Name,
        visibility: visibilidadeDe(filho),
        repeating: false,
        fields: itens,
      });
    } else {
      const item = paraItem(filho);
      if (item) soltos.push(item);
    }
  }

  // Componentes na raiz, fora de qualquer seção, viram uma seção sem título.
  if (soltos.length) secoes.unshift({ id: 'raiz', label: null, visibility: null, fields: soltos });

  contract.sections = secoes.filter((s) => s.fields.length > 0);

  // Agregado de anexos, para o mesmo validador das outras fontes continuar
  // servindo. Os itens seguem posicionados dentro das seções.
  const obrigatorios = anexos.filter((a) => a.required);
  contract.attachments = {
    required: obrigatorios.length > 0,
    minimumCount: obrigatorios.reduce((n, a) => n + (a.minFiles || 1), 0),
    documents: anexos.map((a) => ({ code: a.code, label: a.label })),
    component: null,
  };

  return contract;
}
