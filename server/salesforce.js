/**
 * Cliente HTTP do Salesforce.
 *
 * Deliberadamente sem SDK (jsforce e afins): as chamadas ficam visíveis,
 * que é parte do que a POC precisa demonstrar. Cada função abaixo corresponde
 * a um endpoint citado no estudo.
 */

import { config, assertAuthConfigured } from './config.js';

let cached = null; // { accessToken, instanceUrl, mode }

async function authenticate() {
  const mode = assertAuthConfigured();

  if (mode === 'static-token') {
    cached = {
      accessToken: config.auth.staticToken,
      instanceUrl: config.auth.staticInstanceUrl.replace(/\/$/, ''),
      mode,
    };
    return cached;
  }

  // OAuth 2.0 Client Credentials Flow
  const url = `${config.auth.loginUrl.replace(/\/$/, '')}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.auth.clientId,
    client_secret: config.auth.clientSecret,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SalesforceError(
      `Falha na autenticação (${res.status}): ${json.error_description || json.error || 'erro desconhecido'}`,
      res.status,
      json
    );
  }

  cached = {
    accessToken: json.access_token,
    instanceUrl: json.instance_url.replace(/\/$/, ''),
    mode,
  };
  return cached;
}

async function session() {
  return cached ?? (await authenticate());
}

export class SalesforceError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'SalesforceError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Executa um GET em um path da API do Salesforce.
 * Reautentica uma vez em caso de 401 (token expirado).
 */
export async function sfGet(path, { retryOn401 = true } = {}) {
  const { accessToken, instanceUrl } = await session();
  const url = `${instanceUrl}${path}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401 && retryOn401 && cached?.mode === 'client-credentials') {
    cached = null;
    return sfGet(path, { retryOn401: false });
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new SalesforceError(`Resposta não-JSON de ${path}`, res.status, text.slice(0, 500));
  }

  if (!res.ok) {
    const first = Array.isArray(json) ? json[0] : json;
    throw new SalesforceError(
      `${first?.errorCode || res.status}: ${first?.message || 'erro na chamada ao Salesforce'}`,
      res.status,
      json
    );
  }

  return json;
}

/**
 * Executa um POST em um path da API do Salesforce.
 */
export async function sfPost(path, body, { retryOn401 = true } = {}) {
  const { accessToken, instanceUrl } = await session();

  const res = await fetch(`${instanceUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 && retryOn401 && cached?.mode === 'client-credentials') {
    cached = null;
    return sfPost(path, body, { retryOn401: false });
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new SalesforceError(`Resposta não-JSON de ${path}`, res.status, text.slice(0, 500));
  }

  if (!res.ok) {
    const first = Array.isArray(json) ? json[0] : json;
    throw new SalesforceError(
      `${first?.errorCode || res.status}: ${first?.message || 'erro na chamada ao Salesforce'}`,
      res.status,
      json
    );
  }

  return json;
}

const v = () => `/services/data/v${config.apiVersion}`;

/**
 * Cria o registro e, quando o formulário tem listas, os filhos junto.
 *
 * O pai ainda não existe quando o cliente preenche, então os itens não têm o
 * id dele para gravar. O composite resolve dentro da própria transação: o
 * `referenceId` da primeira subrequisição vira `@{refPai.id}` nas seguintes.
 *
 * `allOrNone` porque um Caso sem os membros que o justificam é pior que erro
 * nenhum — a pessoa reenviaria e criaria um Caso duplicado.
 *
 * Recebe o payload já montado pelo contrato, e não só o registro: é ele que
 * sabe quais itens de lista existem e em qual objeto cada um grava.
 */
export async function createRecordComposite(objectApiName, payload) {
  const version = `v${config.apiVersion}`;
  const REF_PAI = 'refPai';

  // Compatibilidade: aceita tanto o payload completo quanto só o registro.
  const registro = payload?.request?.body?.compositeRequest
    ? payload.request.body.compositeRequest[0].body
    : (payload?.request?.body ?? payload);
  const itens = payload?.listas ?? [];

  const CAMPOS_LEITURA = {
    Case: 'Id,CaseNumber,Status,CreatedDate',
    Contract: 'Id,ContractNumber,Status,CreatedDate',
    Account: 'Id,Name,CreatedDate',
    FormSpec__c: 'Id,Name,CreatedDate',
  };
  const campos = CAMPOS_LEITURA[objectApiName] ?? 'Id,Name,CreatedDate';

  const compositeRequest = [
    {
      method: 'POST',
      url: `/services/data/${version}/sobjects/${objectApiName}`,
      referenceId: REF_PAI,
      body: registro,
    },
    ...itens.map((item, i) => ({
      method: 'POST',
      url: `/services/data/${version}/sobjects/${item.object}`,
      referenceId: `item${i + 1}`,
      body: { ...item.record, [item.relationshipField]: `@{${REF_PAI}.id}` },
    })),
    {
      method: 'GET',
      url: `/services/data/${version}/sobjects/${objectApiName}/@{${REF_PAI}.id}?fields=${campos}`,
      referenceId: 'registroCriado',
    },
  ];

  return sfPost(`${v()}/composite`, { allOrNone: true, compositeRequest });
}

// ---------------------------------------------------------------------------
// UI API
// ---------------------------------------------------------------------------

/** Schema do objeto: campos, tipos, labels e Record Types disponíveis. */
export const getObjectInfo = (objectApiName) => sfGet(`${v()}/ui-api/object-info/${objectApiName}`);

/** Page Layout resolvido para o profile do usuário autenticado + Record Type. */
export const getLayout = (objectApiName, recordTypeId, mode = 'Create') =>
  sfGet(`${v()}/ui-api/layout/${objectApiName}?recordTypeId=${recordTypeId}&mode=${mode}`);

/** Valores de picklist válidos para o Record Type, com dependências. */
export const getPicklistValues = (objectApiName, recordTypeId) =>
  sfGet(`${v()}/ui-api/object-info/${objectApiName}/picklist-values/${recordTypeId}`);

/**
 * Layout + schema + valores default numa chamada só.
 *
 * Exige recordTypeId, então NÃO serve para descobrir os Record Types — só para
 * montar o formulário depois que um já foi escolhido.
 */
export const getRecordDefaults = (objectApiName, recordTypeId) =>
  sfGet(`${v()}/ui-api/record-defaults/create/${objectApiName}?recordTypeId=${recordTypeId}`);

/**
 * Descoberta alternativa: Record Types e regras numa única requisição.
 *
 * Diferente da ui-api, `/query` é suportado pelo Composite — então as duas
 * consultas cabem num request só. O custo é que a SOQL em RecordType NÃO
 * respeita a visibilidade por profile: devolve todos os ativos do objeto.
 */
export async function discoverViaSoql(objectApiName, rulesObject) {
  const qRecordTypes =
    `SELECT Id, DeveloperName, Name FROM RecordType ` +
    `WHERE SobjectType = '${objectApiName}' AND IsActive = true ORDER BY Name`;

  const qRegras =
    `SELECT RecordTypeDeveloperName__c, TargetField__c, ConditionField__c, ` +
    `Operator__c, Value__c, Effect__c, LogicGroup__c FROM ${rulesObject} ` +
    `WHERE ObjectApiName__c = '${objectApiName}' AND IsActive__c = true`;

  const { raw, request, refeitos, registros, falhou } = await consultasEmLote({
    recordTypes: qRecordTypes,
    regras: qRegras,
  });

  return {
    recordTypes: registros('recordTypes'),
    rules: falhou('regras') ? [] : registros('regras'),
    rulesFailed: falhou('regras'),
    truncated: refeitos,
    request,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Catálogo de formulários (FormDefinition__c)
// ---------------------------------------------------------------------------

const umaLinha = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * SOQL do catálogo. Exposta para o diagnóstico poder MOSTRAR a query, e não só
 * dizer que ela existe.
 */
export const queryFormDefinitions = (objectApiName, source, formId = null) =>
  umaLinha(`
    SELECT Id, Name, ObjectApiName__c, RecordTypeDevName__c, Source__c,
           FlowApiName__c, Channel__c, CaseType__c
    FROM ${config.formsObject}
    WHERE IsActive__c = true AND ObjectApiName__c = '${objectApiName}'
      ${source ? `AND Source__c = '${source}'` : ''}
      ${formId ? `AND Id = '${formId}'` : ''}
    ORDER BY Name
  `);

/** Query da resolução ApiName do flow → Id da versão ativa. */
export const queryFlowDefinitions = () =>
  umaLinha(`
    SELECT DurableId, ApiName, Label, ActiveVersionId
    FROM FlowDefinitionView
    WHERE ProcessType = 'Flow' AND IsActive = true
  `);

/**
 * O catálogo de formulários e tudo que ele precisa para ser resolvido, numa
 * ÚNICA requisição HTTP: três subrequests, via `consultasEmLote`.
 *
 *   1. FormDefinition__c    — o catálogo em si
 *   2. FlowDefinitionView   — API Name do flow → Id da versão ativa
 *   3. RecordType           — DeveloperName → Id
 *
 * As três são SOQL PADRÃO, e isso não é acidente.
 *
 * A Tooling API é aceita pelo `/composite/batch` — devolve 200 e o `totalSize`
 * certo — mas descarta todos os campos selecionados: cada registro volta só com
 * `attributes`. Verificado em Flow e FlexiPage, com RecordType como controle na
 * mesma requisição. Ou seja: a Tooling entra no lote e não serve para nada.
 * (No `/composite` a Tooling também não passa.)
 *
 * A `FlowDefinitionView` é a saída — objeto padrão, sobrevive ao batch, e ainda
 * é a fonte mais correta: expõe `ActiveVersionId` diretamente. A Tooling
 * continua necessária, mas só depois, para LER a definição do flow escolhido.
 *
 * Os dois joins existem porque o catálogo guarda NOMES, não Ids:
 *   - o Id da versão de um flow muda a cada deploy, e o Id antigo continua
 *     respondendo — serviria a definição velha sem erro nenhum;
 *   - o Id de Record Type muda entre orgs, então não sobreviveria a um deploy
 *     de forno para produção.
 *
 * Roda duas vezes por formulário aberto, e as duas são necessárias:
 *   - sem `formId`, LISTA o catálogo para alimentar o seletor;
 *   - com `formId`, RESOLVE só o formulário escolhido.
 *
 * A segunda não é desperdício: o cliente manda um Id, e é o servidor que
 * decide o que aquele Id significa. Aceitar o Record Type e o flow que o
 * cliente mandasse junto tornaria os campos de back-end forjáveis — eles
 * existem justamente para não depender do que vem do formulário.
 *
 * `FlowDefinitionView` não dá para escopar junto: dentro de um batch os
 * subrequests são independentes, então o ApiName do flow ainda não é conhecido
 * quando a query dele é montada.
 */
export async function discoverFormCatalog({ objectApiName, source = null, formId = null }) {
  const qForms = queryFormDefinitions(objectApiName, source, formId);
  const qFlows = queryFlowDefinitions();

  const qRecordTypes = umaLinha(`
    SELECT Id, DeveloperName, Name FROM RecordType
    WHERE SobjectType = '${objectApiName}' AND IsActive = true
  `);

  const { raw: resposta, request, refeitos, registros, falhou, erro: mensagemDeErro } =
    await consultasEmLote({ forms: qForms, flows: qFlows, recordTypes: qRecordTypes });

  const warnings = [];

  // Uma query cortada volta 200 e parece sucesso. Aqui isso significaria menos
  // formulários no catálogo, ou um Record Type "inexistente" que existe — por
  // isso o `consultasEmLote` refaz, e o aviso registra que a viagem extra houve.
  for (const nome of refeitos) {
    warnings.push(`"${nome}" voltou cortado do lote e foi refeito numa consulta própria.`);
  }

  const erro = (nome, rotulo) => {
    if (!falhou(nome)) return false;
    warnings.push(`${rotulo}: ${mensagemDeErro(nome) ?? 'falhou'}`);
    return true;
  };

  if (erro('forms', config.formsObject)) {
    return { forms: [], recordTypes: [], warnings, request, raw: resposta };
  }
  erro('flows', 'FlowDefinitionView');
  erro('recordTypes', 'RecordType');

  const flowPorApiName = new Map(
    registros('flows')
      .filter((f) => f.ApiName && f.ActiveVersionId)
      .map((f) => [
        f.ApiName,
        { apiName: f.ApiName, versionId: f.ActiveVersionId, definitionId: f.DurableId, label: f.Label },
      ])
  );

  const rtRows = registros('recordTypes');
  const rtPorDevName = new Map(rtRows.map((rt) => [rt.DeveloperName, rt]));

  const forms = registros('forms').map((fd) => {
    const rt = rtPorDevName.get(fd.RecordTypeDevName__c) ?? null;
    const flow = fd.FlowApiName__c ? flowPorApiName.get(fd.FlowApiName__c) ?? null : null;
    const problemas = [];

    if (!rt) problemas.push(`Record Type "${fd.RecordTypeDevName__c}" não existe ou está inativo.`);
    if (fd.Source__c === 'SCREEN_FLOW' && !fd.FlowApiName__c) {
      problemas.push('Source = SCREEN_FLOW sem FlowApiName__c preenchido.');
    }
    if (fd.FlowApiName__c && !flow) {
      problemas.push(`Nenhuma versão ativa do flow "${fd.FlowApiName__c}".`);
    }

    return {
      id: fd.Id,
      label: fd.Name,
      source: fd.Source__c,
      channel: fd.Channel__c,
      objectApiName: fd.ObjectApiName__c,
      recordType: rt
        ? { id: rt.Id, developerName: rt.DeveloperName, label: rt.Name }
        : { id: null, developerName: fd.RecordTypeDevName__c, label: null },
      flow,
      caseType: fd.CaseType__c ?? null,
      problems: problemas,
    };
  });

  return {
    forms,
    recordTypes: rtRows.map((rt) => ({ id: rt.Id, developerName: rt.DeveloperName, label: rt.Name })),
    warnings,
    request,
    raw: resposta,
  };
}

// ---------------------------------------------------------------------------
// REST padrão
// ---------------------------------------------------------------------------

export const soql = (query) => sfGet(`${v()}/query?q=${encodeURIComponent(query)}`);

/**
 * Várias SOQL numa requisição HTTP só, com os resultados COMPLETOS.
 *
 * Usa `/composite`, e não `/composite/batch`, por um motivo medido: o batch
 * devolve query CORTADA — `done: false` e uma fração dos registros — junto de
 * um status 200. Quem não olhar o `done` trata o pedaço como se fosse o todo.
 *
 * Medido nesta org, com a especificação de um formulário (38 linhas largas de
 * 44 colunas) e o schema de Case (397 campos):
 *
 *   composite/batch, [schema, spec]   397 → 397  |  38 → 1   CORTADO   499 ms
 *   composite,       [schema, spec]   397 → 397  |  38 → 38            331 ms
 *
 * Trinta e oito registros não chegam nem perto do limite de 2.000 do SOQL: o
 * corte não vem do tamanho da consulta, vem do batch reduzindo o lote depois de
 * já ter processado o schema. Outras combinações confirmam que não é teto de
 * tamanho — [spec, schema, schema] passa inteiro com 369 KB, e [schema, spec]
 * corta com 162 KB. Não sei a regra exata do batch, e chutar seria pior que
 * admitir; o que sei é que o `/composite` não faz isso, e ainda é mais rápido.
 *
 * `allOrNone: false` porque aqui só se lê, e algumas consultas PODEM falhar sem
 * invalidar as outras — o objeto de regras pode não existir na org. Verificado
 * que nesse modo o comportamento é o do batch: a que falha falha sozinha. Com
 * `true`, uma falha derruba as demais com PROCESSING_HALTED.
 *
 * A verificação de `done` continua aqui como rede: o `/composite` não cortou em
 * nenhum caso testado, mas o custo de conferir é uma comparação, e o custo de
 * não conferir é um formulário sem seções que ninguém vê quebrar.
 *
 * Recebe `{ nome: soql }` e devolve os registros por nome, mais a lista do que
 * precisou ser refeito — para o chamador poder contar as viagens de verdade.
 */
export async function consultasEmLote(queries) {
  const version = v();
  const uma = (q) => q.replace(/\s+/g, ' ').trim();
  const url = (q) => `${version}/query?q=${encodeURIComponent(uma(q))}`;

  const nomes = Object.keys(queries).filter((n) => queries[n]);
  const corpo = {
    allOrNone: false,
    compositeRequest: nomes.map((n) => ({ method: 'GET', url: url(queries[n]), referenceId: n })),
  };
  const request = { method: 'POST', url: `${version}/composite`, body: corpo };

  const raw = await sfPost(request.url, corpo);

  // O referenceId volta na resposta, então o mapeamento é por nome e não por
  // posição — uma subrequisição a mais no meio não desalinha nada.
  const porNome = {};
  for (const r of raw.compositeResponse ?? []) porNome[r.referenceId] = r;

  const refeitos = [];
  for (const n of nomes) {
    if (porNome[n]?.body?.done === false) {
      refeitos.push(n);
      porNome[n] = { httpStatusCode: 200, referenceId: n, body: await sfGet(url(queries[n])) };
    }
  }

  return {
    raw,
    request,
    refeitos,
    resultado: (n) => porNome[n] ?? null,
    registros: (n) => porNome[n]?.body?.records ?? [],
    falhou: (n) => (porNome[n] ? porNome[n].httpStatusCode !== 200 : true),
    erro: (n) => {
      const b = porNome[n]?.body;
      const primeiro = Array.isArray(b) ? b[0] : b;
      return primeiro?.errorCode ? `${primeiro.errorCode} — ${primeiro.message}` : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Tooling API
// ---------------------------------------------------------------------------

export const toolingSoql = (query) => sfGet(`${v()}/tooling/query?q=${encodeURIComponent(query)}`);

/**
 * Definição completa de um Screen Flow.
 * Consultas que incluem `Metadata` só podem retornar 1 registro.
 */
export const getFlowById = (flowId) =>
  sfGet(`${v()}/tooling/sobjects/Flow/${flowId}`);

/**
 * Lista Screen Flows, sem Metadata (para o seletor da POC).
 *
 * Só versões ATIVAS. Cada deploy de um flow cria uma versão nova e aposenta a
 * anterior, então listar todas devolveria o mesmo formulário várias vezes — e
 * o Id de uma versão obsoleta continua respondendo, servindo uma definição
 * desatualizada em silêncio.
 */
export const listScreenFlows = () =>
  toolingSoql(
    `SELECT Id, MasterLabel, Status, VersionNumber, DefinitionId
     FROM Flow
     WHERE ProcessType = 'Flow' AND Status = 'Active'
     ORDER BY MasterLabel
     LIMIT 50`.replace(/\s+/g, ' ')
  );

/** Diagnóstico: mostra como o servidor está autenticado. */
export async function whoami() {
  const { instanceUrl, mode } = await session();
  const identity = await sfGet(`${v()}/chatter/users/me`).catch(() => null);
  return {
    mode,
    instanceUrl,
    apiVersion: config.apiVersion,
    user: identity ? { id: identity.id, name: identity.displayName, username: identity.username } : null,
  };
}

// ---------------------------------------------------------------------------
// Schema por SOQL — a alternativa ao ui-api/object-info
// ---------------------------------------------------------------------------

/**
 * As colunas do EntityParticle que substituem o object-info.
 *
 * `IsNillable` é a obrigatoriedade no objeto, `IsCreatable` é o FLS do usuário
 * corrente, e `InlineHelpText` é o texto de ajuda do campo — os três que
 * faltariam no FieldDefinition, que não expõe help text.
 */
const COLUNAS_SCHEMA = [
  'QualifiedApiName', 'Label', 'DataType', 'Length', 'Precision', 'Scale',
  'IsNillable', 'IsCalculated', 'InlineHelpText', 'IsDependentPicklist',
  'IsCreatable', 'IsUpdatable',
  // DurableId é o que amarra o campo dependente ao seu controlador: o
  // ControllingFieldDefinitionId do FieldDefinition aponta para ele.
  'DurableId',
].join(', ');

/** Nome de API do Salesforce. Serve de guarda contra injeção em SOQL. */
const NOME_API = /^[A-Za-z0-9_]{1,80}$/;

/**
 * Tudo que o formulário precisa do Salesforce, numa viagem só.
 *
 *   1. EntityParticle    schema dos campos: tipo, label, tamanho, ajuda
 *   2. FieldDefinition   quem controla cada picklist dependente
 *   3. FormDefinition__c a especificação inteira do formulário escolhido
 *   4. RecordType        o Id do Record Type de destino          (opcional)
 *
 * O schema troca `ui-api/object-info` por SOQL: o object-info devolve TODOS os
 * campos do objeto com 36 atributos cada — 377 KB em Case nesta org — e a UI
 * API não aceita filtro. O EntityParticle é consultável, então dá para escolher
 * as colunas, e por ser SOQL comum entra em composite.
 *
 * A quarta subrequisição só existe quando o chamador informa o DeveloperName.
 * Ele vem do catálogo, que o cliente já leu para montar o seletor. Sem isso a
 * consulta dependeria do retorno da especificação, e aqui as subrequisições são
 * tratadas como independentes. (O `/composite` resolveria a dependência com
 * `@{ref.records[0].campo}` — testado, funciona — mas a referência não pode ir
 * URL-encodada, e errar isso devolve 200 com zero registros: falha silenciosa.
 * Receber o nome pronto é mais simples e não tem essa armadilha.)
 *
 * O DeveloperName que chega é PALPITE, não verdade: quem manda é o
 * `TargetRecordTypeDevName__c` da especificação, e conferir isso é do chamador.
 *
 * As picklists continuam na UI API: é a única fonte que respeita Record Type e
 * devolve as dependências, e não entra em composite — o endpoint recusa
 * recursos de ui-api com INVALID_BATCH_REQUEST.
 */
export async function schemaEFormulario(objectApiName, { specSoql, recordTypeDevName = null } = {}) {
  const qSchema = `SELECT ${COLUNAS_SCHEMA} FROM EntityParticle
    WHERE EntityDefinition.QualifiedApiName = '${objectApiName}' AND IsCreatable = true`;

  // Picklist dependente: quem controla quem.
  //
  // Nem o EntityParticle nem o picklist-values dizem o NOME do campo
  // controlador — o primeiro só marca `IsDependentPicklist`, o segundo devolve
  // `controllerValues` (valor do controlador → índice) sem nomeá-lo. Sem esse
  // nome o formulário não sabe qual campo observar para filtrar as opções.
  //
  // O FieldDefinition tem `ControllingFieldDefinitionId`, no mesmo formato do
  // `DurableId` — então uma consulta resolve o par, e ela cabe aqui dentro.
  const qDependentes = `SELECT DurableId, QualifiedApiName, ControllingFieldDefinitionId
    FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objectApiName}'
    AND ControllingFieldDefinitionId != null`;

  // Interpolar num SOQL o que veio do cliente exige a guarda; sem ela, o
  // parâmetro fecharia a aspa e escreveria a própria condição.
  const palpite = recordTypeDevName && NOME_API.test(recordTypeDevName) ? recordTypeDevName : null;

  const qRt = `SELECT Id, Name, DeveloperName FROM RecordType
    WHERE SobjectType = '${objectApiName}' AND DeveloperName = '${palpite}' LIMIT 1`;

  // A ordem coloca o schema, que é o pesado, POR ÚLTIMO: reduz a chance de o
  // batch cortar o que vem depois. É otimização — quem garante o resultado
  // completo é o `consultasEmLote`, que confere `done` e refaz o que veio
  // cortado. Ver a explicação e as medições lá.
  const { raw, request, refeitos, registros } = await consultasEmLote({
    spec: specSoql,
    recordType: palpite ? qRt : null,
    dependentes: qDependentes,
    schema: qSchema,
  });

  const campos = registros('schema');
  const linhasDep = registros('dependentes');

  // O ControllingFieldDefinitionId aponta para o DurableId de OUTRO campo. A
  // consulta de dependentes só traz quem TEM controlador, e o controlador
  // normalmente não tem — então o índice vem do schema, que já traz todos os
  // campos com o DurableId. Custo zero: a coluna veio junto.
  const porDurable = {};
  for (const c of campos) if (c.DurableId) porDurable[c.DurableId] = c.QualifiedApiName;

  const controladorDe = {};
  for (const d of linhasDep) {
    const nome = porDurable[d.ControllingFieldDefinitionId];
    // Sem resolver o nome, guarda o id: um vínculo opaco ainda é melhor que
    // nenhum, e deixa visível que faltou resolver.
    controladorDe[d.QualifiedApiName] = nome ?? d.ControllingFieldDefinitionId;
  }

  return {
    raw,
    request,
    campos,
    controladorDe,
    spec: registros('spec'),
    recordType: registros('recordType')[0] ?? null,
    palpiteRecusado: Boolean(recordTypeDevName) && !palpite,
    /** Subrequisições que o batch truncou e precisaram ser refeitas sozinhas. */
    refeitos,
  };
}
