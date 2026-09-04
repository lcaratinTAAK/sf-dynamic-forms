/**
 * BFF da POC.
 *
 * Um contrato normalizado, duas fontes:
 *   GET /api/form?source=uiapi&recordTypeId=...
 *   GET /api/form?source=screenflow&flowId=...&recordTypeId=...
 *
 * O frontend consome sempre o mesmo formato, independente da fonte.
 */

import express from 'express';
import { config } from './config.js';
import {
  getObjectInfo,
  listScreenFlows,
  whoami,
  createRecordComposite,
  discoverViaSoql,
  discoverFormCatalog,
  sfGet,
  SalesforceError,
  schemaEFormulario,
} from './salesforce.js';
import { buildSubmitPayload, indexarCampos } from './contract.js';
import * as uiapi from './adapters/uiapi.js';
import * as uiapiV2 from './adapters/uiapi-v2.js';
import * as screenflow from './adapters/screenflow.js';
import * as formspec from './adapters/formspec.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const ok = (res, data) => res.json(data);

function fail(res, err) {
  const status = err instanceof SalesforceError ? err.status || 502 : 500;
  console.error(`[erro ${status}]`, err.message);
  res.status(status).json({
    error: err.message,
    details: err instanceof SalesforceError ? err.body : undefined,
  });
}

// --- diagnóstico ------------------------------------------------------------

app.get('/api/health', (_req, res) =>
  ok(res, { status: 'up', object: config.objectApiName, apiVersion: config.apiVersion })
);

app.get('/api/whoami', async (_req, res) => {
  try {
    ok(res, await whoami());
  } catch (err) {
    fail(res, err);
  }
});

// --- catálogo: o que o usuário pode escolher --------------------------------

/**
 * Record Types disponíveis.
 *
 * `?source=uiapi-v2` usa a descoberta alternativa por SOQL — 26x menor e
 * batchável, mas SEM filtro de visibilidade por profile.
 */
app.get('/api/record-types', async (req, res) => {
  try {
    if (req.query.source === 'uiapi-v2') {
      const { recordTypes } = await uiapiV2.discover();
      return ok(res, {
        object: config.objectApiName,
        via: 'composite/batch + SOQL',
        curated: false,
        recordTypes: recordTypes.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
      });
    }

    const info = await getObjectInfo(config.objectApiName);
    const recordTypes = Object.values(info.recordTypeInfos || {})
      .filter((rt) => rt.available && !rt.master)
      .map((rt) => ({ id: rt.recordTypeId, label: rt.name, defaultRecordType: rt.defaultRecordTypeMapping }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

    ok(res, { object: config.objectApiName, via: 'ui-api/object-info', curated: true, recordTypes });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Catálogo de formulários — o seletor da tela.
 *
 * Uma requisição resolve nome, Record Type e versão ativa do flow. É o que
 * permite UM seletor onde antes eram dois (o flow e o Record Type das
 * picklists, que o Flow não declara).
 */
app.get('/api/forms', async (req, res) => {
  try {
    const source = req.query.source ? String(req.query.source) : null;

    // A fonte custom tem catálogo próprio: as linhas raiz de FormDefinition__c.
    // Uma SOQL, sem composite — não há flow nem Record Type para resolver.
    if (source === 'FORM_SPEC') {
      const forms = await formspec.listarFormularios();
      return ok(res, { object: config.objectApiName, via: 'SOQL em FormDefinition__c', forms, warnings: [] });
    }

    const { forms, warnings } = await discoverFormCatalog({
      objectApiName: config.objectApiName,
      source,
    });
    ok(res, { object: config.objectApiName, via: 'composite/batch (3 subrequests)', forms, warnings });
  } catch (err) {
    fail(res, err);
  }
});

/** Screen Flows crus, sem catálogo. Mantido para comparação no inspetor. */
app.get('/api/screen-flows', async (_req, res) => {
  try {
    const result = await listScreenFlows();
    const flows = (result.records || []).map((f) => ({
      id: f.Id,
      label: f.MasterLabel,
      status: f.Status,
      version: f.VersionNumber,
    }));
    ok(res, { flows });
  } catch (err) {
    fail(res, err);
  }
});

// --- o contrato -------------------------------------------------------------

app.get('/api/form', async (req, res) => {
  const { source = 'uiapi', recordTypeId, flowId, formId } = req.query;

  try {
    let contract;

    if (source === 'uiapi') {
      if (!recordTypeId) throw new Error('Parâmetro obrigatório: recordTypeId');
      contract = await uiapi.buildContract({
        objectApiName: config.objectApiName,
        recordTypeId,
      });
    } else if (source === 'uiapi-v2') {
      if (!recordTypeId) throw new Error('Parâmetro obrigatório: recordTypeId');
      contract = await uiapiV2.buildContract({
        objectApiName: config.objectApiName,
        recordTypeId,
      });
    } else if (source === 'screenflow') {
      // Caminho normal: o catálogo resolve flow e Record Type de uma vez.
      // `flowId` continua aceito para comparar com o comportamento antigo.
      let form = null;
      if (formId) {
        if (!/^[A-Za-z0-9]{15,18}$/.test(String(formId))) {
          throw new Error(`formId inválido: ${formId}`);
        }
        const { forms } = await discoverFormCatalog({
          objectApiName: config.objectApiName,
          source: 'SCREEN_FLOW',
          formId,
        });
        form = forms[0] ?? null;
        if (!form) throw new Error(`Formulário ${formId} não encontrado no catálogo.`);
      } else if (!flowId) {
        throw new Error('Parâmetro obrigatório: formId (ou flowId, no modo antigo)');
      }

      contract = await screenflow.buildContract({
        form,
        flowId,
        objectApiName: config.objectApiName,
        recordTypeId: recordTypeId || null,
      });
    } else if (source === 'formspec') {
      if (!formId) throw new Error('Parâmetro obrigatório: formId');
      if (!/^[A-Za-z0-9]{15,18}$/.test(String(formId))) throw new Error(`formId inválido: ${formId}`);
      // O DeveloperName vem do catálogo que o cliente já leu para montar o
      // seletor. É PALPITE: serve só para o Record Type caber no mesmo
      // composite da especificação. O adaptador confere contra o que a
      // especificação diz antes de usar — ver `buildContract`.
      contract = await formspec.buildContract({
        formId,
        objectApiName: req.query.objectApiName || config.objectApiName,
        recordTypeDevName: req.query.recordTypeDevName || null,
      });
    } else {
      throw new Error(
        `source inválido: "${source}". Use "uiapi", "uiapi-v2", "screenflow" ou "formspec".`
      );
    }

    ok(res, contract);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Tradução pura: retornos do Salesforce -> contrato, SEM tocar na org.
 *
 * É o mesmo `specToContract` que o adaptador usa de verdade — não uma cópia
 * didática. Serve a dois públicos: quem quer entender a conversão sem precisar
 * de credencial, e quem for reimplementar o adaptador em outra linguagem e
 * precisa de um oráculo para conferir a saída.
 *
 * O corpo espelha, campo a campo, o que as chamadas 01 a 04 devolvem.
 */
app.post('/api/traduzir', (req, res) => {
  const { spec, schema = [], dependentes = [], picklists = null, recordType = null, formId } =
    req.body || {};

  if (!Array.isArray(spec) || spec.length === 0) {
    return res.status(400).json({ error: 'Informe `spec`: as linhas de FormDefinition__c.' });
  }

  const raiz =
    spec.find((r) => r.Id === formId) ?? spec.find((r) => r.RecordType?.DeveloperName === 'Form');
  if (!raiz) {
    return res.status(400).json({ error: 'Nenhuma linha com RecordType.DeveloperName = "Form".' });
  }

  // O mesmo cruzamento que `schemaEFormulario` faz com o retorno do composite:
  // ControllingFieldDefinitionId aponta para o DurableId de OUTRO campo.
  const porDurable = {};
  for (const c of schema) if (c.DurableId) porDurable[c.DurableId] = c.QualifiedApiName;
  const controladorDe = {};
  for (const d of dependentes) {
    controladorDe[d.QualifiedApiName] =
      porDurable[d.ControllingFieldDefinitionId] ?? d.ControllingFieldDefinitionId;
  }

  try {
    const contract = formspec.specToContract(spec, {
      formId: raiz.Id,
      objectApiName: raiz.ObjectApiName__c || config.objectApiName,
      indiceDeCampos: indexarCampos(schema),
      controladorDe,
      picklists,
      rt: recordType,
    });
    ok(res, contract);
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// --- envio (POC: só gera o payload) ----------------------------------------

app.post('/api/submit', (req, res) => {
  const { contract, values } = req.body || {};
  if (!contract || !values) {
    return res.status(400).json({ error: 'Informe { contract, values } no corpo.' });
  }

  try {
    ok(res, {
      ...buildSubmitPayload(contract, values),
      note: 'POC: o payload é apenas gerado, não enviado ao Salesforce.',
    });
  } catch (err) {
    fail(res, err);
  }
});

// --- simulação de chamada (inspetor) ---------------------------------------

/**
 * Repete UMA das chamadas que o BFF fez, e devolve o retorno cru.
 *
 * O path vem do cliente, então é validado contra uma allowlist: sem isso, o
 * endpoint viraria um proxy aberto para qualquer recurso da org.
 */
const REPLAY_ALLOWLIST = [
  /^\/ui-api\/object-info\/[A-Za-z0-9_]+$/,
  /^\/ui-api\/object-info\/[A-Za-z0-9_]+\/picklist-values\/[A-Za-z0-9]+$/,
  // picklist de UM campo: a variante que evita baixar as 333 KB de todas
  /^\/ui-api\/object-info\/[A-Za-z0-9_]+\/picklist-values\/[A-Za-z0-9]+\/[A-Za-z0-9_]+$/,
  /^\/ui-api\/layout\/[A-Za-z0-9_]+\?recordTypeId=[A-Za-z0-9]+(&mode=[A-Za-z]+)?$/,
  /^\/ui-api\/record-defaults\/create\/[A-Za-z0-9_]+\?recordTypeId=[A-Za-z0-9]+$/,
  /^\/tooling\/sobjects\/Flow\/[A-Za-z0-9]+$/,
  /^\/query\?q=SELECT\s/i,
];

const PREVIEW_LIMIT = 60_000;

/**
 * `request` é o que foi ENVIADO. Nos GETs é só método e URL; nas chamadas
 * compostas há um corpo, e é justamente ele que interessa ver — a URL sozinha
 * não diz nada sobre o que o batch pediu.
 */
const responder = (res, inicio, path, body, request = null) => {
  const pretty = JSON.stringify(body, null, 2);
  ok(res, {
    path,
    elapsedMs: Date.now() - inicio,
    bytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
    truncated: pretty.length > PREVIEW_LIMIT,
    preview: pretty.slice(0, PREVIEW_LIMIT),
    request,
    requestBytes: request?.body ? Buffer.byteLength(JSON.stringify(request.body), 'utf8') : null,
  });
};

app.post('/api/replay', async (req, res) => {
  const path = String(req.body?.path || '');
  const replayId = req.body?.replayId;

  // As descobertas compostas são POST. O corpo é montado no servidor — nada
  // vem do cliente, então não há como transformar isso em proxy aberto.
  if (replayId === 'discovery') {
    const inicio = Date.now();
    try {
      const { raw, request } = await discoverViaSoql(config.objectApiName, config.rulesObject);
      return responder(res, inicio, path, raw, request);
    } catch (err) {
      return res.status(502).json({ path, error: err.message, preview: null });
    }
  }

  // `pacote:<Objeto>:<formId>:<recordTypeDevName>` — schema, dependências de
  // picklist, especificação e Record Type, no mesmo composite/batch que o
  // adaptador monta. O último segmento pode vir vazio: o palpite é opcional.
  if (typeof replayId === 'string' && replayId.startsWith('pacote:')) {
    const [objeto = '', formId = '', devName = ''] = replayId.slice('pacote:'.length).split(':');
    if (!/^[A-Za-z0-9_]{1,64}$/.test(objeto)) {
      return res.status(400).json({ error: `Objeto inválido: ${objeto}` });
    }
    if (!/^[A-Za-z0-9]{15,18}$/.test(formId)) {
      return res.status(400).json({ error: `formId inválido: ${formId}` });
    }
    const inicio = Date.now();
    try {
      const { raw, request } = await schemaEFormulario(objeto, {
        specSoql: formspec.querySpec(formId),
        recordTypeDevName: devName || null,
      });
      return responder(res, inicio, path, raw, request);
    } catch (err) {
      return res.status(502).json({ path, error: err.message, preview: null });
    }
  }

  // `catalog:<SOURCE>` lista; `catalog:<SOURCE>:<Id>` resolve um formulário só.
  if (typeof replayId === 'string' && replayId.startsWith('catalog:')) {
    const [source, formId = null] = replayId.slice('catalog:'.length).split(':');
    if (!['LAYOUT', 'SCREEN_FLOW'].includes(source)) {
      return res.status(400).json({ error: `Source inválido para o catálogo: ${source}` });
    }
    if (formId !== null && !/^[A-Za-z0-9]{15,18}$/.test(formId)) {
      return res.status(400).json({ error: `formId inválido: ${formId}` });
    }
    const inicio = Date.now();
    try {
      const { raw, request } = await discoverFormCatalog({
        objectApiName: config.objectApiName,
        source,
        formId,
      });
      return responder(res, inicio, path, raw, request);
    } catch (err) {
      return res.status(502).json({ path, error: err.message, preview: null });
    }
  }

  if (!REPLAY_ALLOWLIST.some((re) => re.test(path))) {
    return res.status(400).json({ error: `Path não permitido para simulação: ${path}` });
  }

  // A SOQL é registrada legível no diagnóstico; para executar precisa ir encodada.
  let alvo = path;
  if (path.startsWith('/query?q=')) {
    alvo = `/query?q=${encodeURIComponent(path.slice('/query?q='.length))}`;
  }

  const inicio = Date.now();
  const url = `/services/data/v${config.apiVersion}${alvo}`;
  try {
    const body = await sfGet(url);
    responder(res, inicio, path, body, { method: 'GET', url, body: null });
  } catch (err) {
    res.status(err instanceof SalesforceError ? err.status || 502 : 500).json({
      path,
      elapsedMs: Date.now() - inicio,
      error: err.message,
      preview: JSON.stringify(err.body ?? null, null, 2),
    });
  }
});

// --- criação real do registro ----------------------------------------------

app.post('/api/create-record', async (req, res) => {
  const { contract, values } = req.body || {};
  if (!contract || !values) {
    return res.status(400).json({ error: 'Informe { contract, values } no corpo.' });
  }

  try {
    const payload = buildSubmitPayload(contract, values);

    if (!payload.valid) {
      return res.status(422).json({
        ok: false,
        error: 'Formulário incompleto',
        missing: payload.missing,
      });
    }

    // O payload inteiro, e não só o registro: é ele que carrega os itens de lista.
    const composite = await createRecordComposite(contract.object, payload);
    const respostas = composite.compositeResponse ?? [];
    const criacao = respostas[0];
    const leitura = respostas[respostas.length - 1];
    const filhos = respostas.slice(1, -1);

    // Composite devolve 200 no envelope mesmo quando um subrequest falha. E
    // quando o PAI falha, os filhos reportam "Could not find the referenced
    // operation refPai" — que é sintoma, não causa. Por isso o erro do pai vem
    // primeiro, e o dos filhos só se ele tiver passado.
    const falhou = respostas.find((r) => r && r.httpStatusCode >= 300);
    if (falhou) {
      const ehPai = falhou === criacao;
      const erro = Array.isArray(falhou.body) ? falhou.body[0] : falhou.body;
      return res.status(422).json({
        ok: false,
        error: erro?.message || 'O Salesforce recusou a criação.',
        errorCode: erro?.errorCode ?? null,
        fields: erro?.fields ?? [],
        onde: ehPai ? contract.object : `item da lista (${falhou.referenceId})`,
        composite,
      });
    }

    ok(res, {
      ok: true,
      id: criacao.body?.id ?? null,
      record: leitura?.body ?? null,
      filhos: filhos.map((f, i) => ({
        object: payload.listas?.[i]?.object ?? null,
        id: f.body?.id ?? null,
      })),
      attachmentsNote: Array.isArray(values.__attachments) && values.__attachments.length
        ? `${values.__attachments.length} anexo(s) selecionado(s) não foram enviados: a POC não faz upload de arquivo.`
        : null,
      composite,
    });
  } catch (err) {
    fail(res, err);
  }
});

app.listen(config.port, () => {
  console.log(`\n  BFF da POC de formulários`);
  console.log(`  http://localhost:${config.port}`);
  console.log(`  objeto: ${config.objectApiName}  ·  API v${config.apiVersion}\n`);
  console.log(`  GET  /api/whoami`);
  console.log(`  GET  /api/record-types`);
  console.log(`  GET  /api/forms?source=SCREEN_FLOW`);
  console.log(`  GET  /api/screen-flows`);
  console.log(`  GET  /api/form?source=uiapi&recordTypeId=...`);
  console.log(`  GET  /api/form?source=screenflow&formId=...`);
  console.log(`  POST /api/submit\n`);
});
