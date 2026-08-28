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
 * Cria o registro e devolve os dados dele numa única requisição.
 *
 * Usa Composite com `allOrNone`, encadeando as duas operações por referência:
 * o GET aponta para `@{novoRegistro.id}`, que só existe depois do POST.
 * Diferente da ui-api, o recurso `sobjects` É suportado pelo Composite.
 */
export async function createRecordComposite(objectApiName, record) {
  const version = `v${config.apiVersion}`;

  return sfPost(`${v()}/composite`, {
    allOrNone: true,
    compositeRequest: [
      {
        method: 'POST',
        url: `/services/data/${version}/sobjects/${objectApiName}`,
        referenceId: 'novoRegistro',
        body: record,
      },
      {
        method: 'GET',
        url: `/services/data/${version}/sobjects/${objectApiName}/@{novoRegistro.id}?fields=Id,CaseNumber,Status,CreatedDate`,
        referenceId: 'registroCriado',
      },
    ],
  });
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
  const version = `v${config.apiVersion}`;

  const qRecordTypes =
    `SELECT Id, DeveloperName, Name FROM RecordType ` +
    `WHERE SobjectType = '${objectApiName}' AND IsActive = true ORDER BY Name`;

  const qRegras =
    `SELECT RecordTypeDeveloperName__c, TargetField__c, ConditionField__c, ` +
    `Operator__c, Value__c, Effect__c, LogicGroup__c FROM ${rulesObject} ` +
    `WHERE ObjectApiName__c = '${objectApiName}' AND IsActive__c = true`;

  const corpo = {
    batchRequests: [
      { method: 'GET', url: `${version}/query?q=${encodeURIComponent(qRecordTypes)}` },
      { method: 'GET', url: `${version}/query?q=${encodeURIComponent(qRegras)}` },
    ],
  };
  const request = { method: 'POST', url: `${v()}/composite/batch`, body: corpo };

  const resposta = await sfPost(request.url, corpo);

  const [rt, regras] = resposta.results ?? [];
  return {
    recordTypes: rt?.result?.records ?? [],
    rules: regras?.statusCode === 200 ? regras.result?.records ?? [] : [],
    rulesFailed: regras?.statusCode !== 200,
    request,
    raw: resposta,
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
 * ÚNICA requisição HTTP: três subrequests em `/composite/batch`.
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
 * mesma requisição. Ou seja: a Tooling entra no batch e não serve para nada.
 * (`/composite` nem aceita: recusa com PROCESSING_HALTED.)
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
  const version = `v${config.apiVersion}`;
  const enc = encodeURIComponent;

  const qForms = queryFormDefinitions(objectApiName, source, formId);
  const qFlows = queryFlowDefinitions();

  const qRecordTypes = umaLinha(`
    SELECT Id, DeveloperName, Name FROM RecordType
    WHERE SobjectType = '${objectApiName}' AND IsActive = true
  `);

  // Guardado para o inspetor poder mostrar o que FOI ENVIADO, não só o retorno.
  const corpo = {
    batchRequests: [
      { method: 'GET', url: `${version}/query?q=${enc(qForms)}` },
      { method: 'GET', url: `${version}/query?q=${enc(qFlows)}` },
      { method: 'GET', url: `${version}/query?q=${enc(qRecordTypes)}` },
    ],
  };
  const request = { method: 'POST', url: `${v()}/composite/batch`, body: corpo };

  const resposta = await sfPost(request.url, corpo);

  const [rForms, rFlows, rRts] = resposta.results ?? [];
  const warnings = [];

  const erro = (r, nome) => {
    if (r?.statusCode === 200) return false;
    const corpo = Array.isArray(r?.result) ? r.result[0] : r?.result;
    warnings.push(`${nome}: ${corpo?.errorCode ?? r?.statusCode} — ${corpo?.message ?? 'falhou'}`);
    return true;
  };

  if (erro(rForms, config.formsObject)) {
    return { forms: [], recordTypes: [], warnings, request, raw: resposta };
  }
  erro(rFlows, 'FlowDefinitionView');
  erro(rRts, 'RecordType');

  const flowPorApiName = new Map(
    (rFlows?.result?.records ?? [])
      .filter((f) => f.ApiName && f.ActiveVersionId)
      .map((f) => [
        f.ApiName,
        { apiName: f.ApiName, versionId: f.ActiveVersionId, definitionId: f.DurableId, label: f.Label },
      ])
  );

  const rtRows = rRts?.result?.records ?? [];
  const rtPorDevName = new Map(rtRows.map((rt) => [rt.DeveloperName, rt]));

  const forms = (rForms.result?.records ?? []).map((fd) => {
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
