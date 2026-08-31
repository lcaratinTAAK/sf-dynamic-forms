import { useEffect, useState } from 'react';
import * as api from './api.js';
import FormRenderer from './components/FormRenderer.jsx';
import Inspector from './components/Inspector.jsx';
import Info from './components/Info.jsx';
import InfoCustom from './components/InfoCustom.jsx';

const SOURCES = [
  { id: 'uiapi', label: 'UI API', hint: 'object-info + layout + picklists + regras' },
  { id: 'uiapi-v2', label: 'UI API v2', hint: 'descoberta por SOQL + record-defaults' },
  { id: 'screenflow', label: 'Screen Flow', hint: 'Tooling API' },
  { id: 'formspec', label: 'Custom', hint: 'FormDefinition__c — definição própria, uma SOQL' },
];

const usaRecordType = (source) => source === 'uiapi' || source === 'uiapi-v2';
/** Fontes cujo seletor é o catálogo de formulários, não o Record Type. */
const usaCatalogo = (source) => source === 'screenflow' || source === 'formspec';
const CATALOGO_DE = { screenflow: 'SCREEN_FLOW', formspec: 'FORM_SPEC' };

export default function App() {
  const [aba, setAba] = useState('demo'); // demo | info | custom
  const [source, setSource] = useState('uiapi');
  const [recordTypes, setRecordTypes] = useState([]);
  const [forms, setForms] = useState([]);
  const [recordTypeId, setRecordTypeId] = useState('');
  const [formId, setFormId] = useState('');

  const [contract, setContract] = useState(null);
  const [values, setValues] = useState({});
  const [files, setFiles] = useState([]);
  const [submitResult, setSubmitResult] = useState(null);
  const [createResult, setCreateResult] = useState(null);
  const [creating, setCreating] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [chamadaDoCatalogo, setChamadaDoCatalogo] = useState(null);

  useEffect(() => {
    api.getWhoami().then(setSession).catch(() => setSession(null));
  }, []);

  // O catálogo é o seletor da fonte Screen Flow. Uma requisição já traz o
  // formulário, o Record Type dele e a versão ativa do flow — por isso aqui
  // é UM seletor, e não dois.
  useEffect(() => {
    if (!usaCatalogo(source)) return;

    api
      .getForms(CATALOGO_DE[source])
      .then((r) => {
        setForms(r.forms);
        // A busca do catálogo é uma ida ao Salesforce como qualquer outra. Ela
        // acontece em outra rota, então não entra em diagnostics.calls — mas
        // precisa aparecer no inspetor, senão a tela conta duas chamadas onde
        // houve três.
        setChamadaDoCatalogo(r.chamada ?? null);
        setFormId((atual) =>
          r.forms.some((f) => f.id === atual) ? atual : r.forms[0]?.id ?? ''
        );
        if (!r.forms.length) {
          setError(
            source === 'formspec'
              ? 'Nenhum formulário ativo em FormDefinition__c.'
              : 'Nenhum formulário ativo em FormDefinition__c com Source = SCREEN_FLOW.'
          );
        }
      })
      .catch((e) => setError(e.message));
  }, [source]);

  // A descoberta dos Record Types muda conforme a fonte: a v1 usa object-info
  // (filtra por profile), a v2 usa SOQL (não filtra).
  useEffect(() => {
    if (!usaRecordType(source)) return;

    api
      .getRecordTypes(source)
      .then((r) => {
        setCatalogo({ via: r.via, curated: r.curated, total: r.recordTypes.length });
        setRecordTypes(r.recordTypes);
        setRecordTypeId((atual) =>
          r.recordTypes.some((rt) => rt.id === atual) ? atual : r.recordTypes[0]?.id ?? ''
        );
      })
      .catch((e) => setError(e.message));
  }, [source]);

  // contrato
  useEffect(() => {
    const ready = usaRecordType(source) ? recordTypeId : formId;
    if (!ready) return;

    setLoading(true);
    setError(null);
    setSubmitResult(null);
    setCreateResult(null);

    // O catálogo já trouxe o Record Type de cada formulário; repassá-lo deixa
    // o servidor montar tudo num composite só, em vez de descobrir o Id numa
    // chamada à parte depois de ler a especificação.
    const escolhido = forms.find((f) => f.id === formId);

    api
      .getForm({
        source,
        recordTypeId: usaRecordType(source) ? recordTypeId : undefined,
        formId: usaCatalogo(source) ? formId : undefined,
        recordTypeDevName: source === 'formspec' ? escolhido?.recordTypeDevName : undefined,
        objectApiName: source === 'formspec' ? escolhido?.objectApiName : undefined,
      })
      .then((c) => {
        setContract(c);
        setValues({});
        setFiles([]);
      })
      .catch((e) => {
        setContract(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [source, recordTypeId, formId, forms]);

  const handleChange = (apiName, value) =>
    setValues((prev) => ({ ...prev, [apiName]: value }));

  /**
   * Estado dos itens de lista. Vive em `__listas[secaoId]` — fora do espaço de
   * nomes dos campos do Caso, porque um item tem campos de OUTRO objeto e
   * `Name` do CaseMember__c não é o `Name` do Caso.
   */
  const handleLista = (secaoId, acao, indice, apiName, valor) =>
    setValues((prev) => {
      const listas = { ...(prev.__listas || {}) };
      const atual = [...(listas[secaoId] || [])];
      if (acao === 'adicionar') atual.push({});
      else if (acao === 'remover') atual.splice(indice, 1);
      else atual[indice] = { ...atual[indice], [apiName]: valor };
      listas[secaoId] = atual;
      return { ...prev, __listas: listas };
    });

  /** Preenche com um cenário de teste, ou limpa quando recebe null. */
  const handleFill = (cenario) => {
    setSubmitResult(null);
    setCreateResult(null);
    setValues(cenario ? { ...cenario.values } : {});
    setFiles(cenario ? [...cenario.files] : []);
  };

  const handleSubmit = async () => {
    setError(null);
    setCreateResult(null);
    try {
      setSubmitResult(await api.submit(contract, { ...values, __attachments: files }));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      setCreateResult(await api.createRecord(contract, { ...values, __attachments: files }));
    } catch (e) {
      setCreateResult({ ok: false, error: e.message });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="app" data-source={source}>
      <header className="topbar">
        <div className="brand">
          <strong>Formulários dinâmicos a partir do Salesforce</strong>
          <span>
            um contrato normalizado · quatro fontes
            {session?.user ? ` · autenticado como ${session.user.name}` : ''}
          </span>
        </div>

        <div className="sources">
          {aba === 'demo' &&
            SOURCES.map((s) => (
              <button
                key={s.id}
                className={`source-btn${source === s.id ? ' is-active' : ''}`}
                onClick={() => setSource(s.id)}
                title={s.hint}
              >
                <span className="dot" />
                {s.label}
              </button>
            ))}
        </div>

        <div className="topbar-controls">
          <div className="abas">
            <button
              className={`aba-btn${aba === 'demo' ? ' is-active' : ''}`}
              onClick={() => setAba('demo')}
            >
              Demo
            </button>
            <button
              className={`aba-btn${aba === 'info' ? ' is-active' : ''}`}
              onClick={() => setAba('info')}
            >
              Comparativo
            </button>
            <button
              className={`aba-btn${aba === 'custom' ? ' is-active' : ''}`}
              onClick={() => setAba('custom')}
            >
              Solução Custom
            </button>
          </div>

          {aba !== 'demo' ? null : usaCatalogo(source) ? (
            <div className="control">
              <label htmlFor="form">
                Formulário
                <span className="badge">FormDefinition__c</span>
              </label>
              <select id="form" value={formId} onChange={(e) => setFormId(e.target.value)}>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                    {f.version ? ` (v${f.version}${f.status ? ` · ${f.status}` : ''})` : ''}
                    {f.channel ? ` · ${f.channel}` : ''}
                    {f.problems?.length ? ' ⚠' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="control">
              <label htmlFor="rt">
                Record Type
                {catalogo && (
                  <span className={`badge${catalogo.curated ? '' : ' warn'}`}>
                    {catalogo.total} · {catalogo.curated ? 'por profile' : 'sem filtro'}
                  </span>
                )}
              </label>
              <select id="rt" value={recordTypeId} onChange={(e) => setRecordTypeId(e.target.value)}>
                {recordTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      {aba === 'info' ? (
        <Info />
      ) : aba === 'custom' ? (
        <InfoCustom />
      ) : (
      <div className="main">
        <div className="pane">
          <h2 className="pane-title">Formulário renderizado</h2>

          {error && <div className="note err">{error}</div>}
          {loading && <div className="empty">Carregando definição…</div>}

          {!loading && contract && (
            <FormRenderer
              contract={contract}
              values={values}
              onChange={handleChange}
              onLista={handleLista}
              files={files}
              onFiles={setFiles}
              onSubmit={handleSubmit}
              onFill={handleFill}
            />
          )}

          {!loading && !contract && !error && (
            <div className="empty">Selecione uma fonte e um formulário.</div>
          )}
        </div>

        <div className="pane">
          <h2 className="pane-title">De onde veio</h2>
          {contract ? (
            <Inspector
              contract={contract}
              chamadaDoCatalogo={usaCatalogo(source) ? chamadaDoCatalogo : null}
              submitResult={submitResult}
              createResult={createResult}
              creating={creating}
              onCreate={handleCreate}
            />
          ) : (
            <div className="empty">—</div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
