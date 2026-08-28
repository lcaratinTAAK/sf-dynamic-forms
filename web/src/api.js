async function get(path) {
  const res = await fetch(path);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Falha em ${path}`);
  return json;
}

export const getRecordTypes = (source) =>
  get(source === 'uiapi-v2' ? '/api/record-types?source=uiapi-v2' : '/api/record-types');
export const getScreenFlows = () => get('/api/screen-flows');
export const getWhoami = () => get('/api/whoami');

/** Catálogo de formulários (FormDefinition__c), filtrado pela fonte. */
export const getForms = (source) => get(`/api/forms?source=${encodeURIComponent(source)}`);

export function getForm({ source, recordTypeId, flowId, formId }) {
  const qs = new URLSearchParams({ source });
  if (formId) qs.set('formId', formId);
  if (recordTypeId) qs.set('recordTypeId', recordTypeId);
  if (flowId) qs.set('flowId', flowId);
  return get(`/api/form?${qs}`);
}

export async function submit(contract, values) {
  const res = await fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract, values }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Falha ao gerar o payload');
  return json;
}

/** Repete uma das chamadas do BFF e devolve o retorno cru, sem afetar a tela. */
export async function replay(path, replayId) {
  const res = await fetch('/api/replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, replayId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !json.preview) throw new Error(json.error || 'Falha ao simular a chamada');
  return json;
}

/**
 * Cria o registro de verdade no Salesforce, via Composite.
 * Devolve o corpo mesmo em erro de negócio (422), para que a UI mostre o motivo.
 */
export async function createRecord(contract, values) {
  const res = await fetch('/api/create-record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract, values }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json;
  if (res.status === 422) return { ...json, ok: false };
  throw new Error(json.error || 'Falha ao criar o registro');
}
