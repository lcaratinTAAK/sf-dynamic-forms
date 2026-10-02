import { Fragment, useEffect, useState } from 'react';
import * as api from '../api.js';
import SlaPanel from './SlaPanel.jsx';

const formatBytes = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024).toLocaleString('pt-BR')} KB`;

const TABS = [
  { id: 'calls', label: 'Chamadas' },
  { id: 'contract', label: 'Contrato' },
  { id: 'payload', label: 'Payload' },
];

export default function Inspector({ contract, chamadaDoCatalogo, submitResult, createResult, creating, onCreate }) {
  const [tab, setTab] = useState('calls');

  // Ao gerar o payload, traz o inspetor para a aba certa — senão o clique
  // no botão não produz nenhum efeito visível.
  useEffect(() => {
    if (submitResult) setTab('payload');
  }, [submitResult]);

  return (
    <div>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'payload' && submitResult && <span className="tab-dot" />}
          </button>
        ))}
      </div>

      {tab === 'calls' && <Calls contract={contract} chamadaDoCatalogo={chamadaDoCatalogo} />}
      {tab === 'contract' && <pre className="json">{JSON.stringify(contract, null, 2)}</pre>}
      {tab === 'payload' && (
        <Payload
          contract={contract}
          result={submitResult}
          createResult={createResult}
          creating={creating}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}

function Calls({ contract, chamadaDoCatalogo }) {
  const { calls = [], warnings = [] } = contract.diagnostics || {};
  const fd = contract.formDefinition;

  // A busca do catálogo é uma ida ao Salesforce como qualquer outra — só
  // acontece ANTES da seleção, noutra rota, e por isso não está em
  // `diagnostics.calls`. Sem ela aqui a tela contava duas chamadas onde houve
  // três, e o catálogo parecia sair de graça.
  const todas = chamadaDoCatalogo ? [chamadaDoCatalogo, ...calls] : calls;

  return (
    <>
      <div className="note">
        Todas as idas ao Salesforce para chegar neste formulário — inclusive a do
        catálogo, que acontece antes da seleção. Trocar a fonte muda esta lista; o
        formulário ao lado não muda.
      </div>

      {fd && (
        <div className="note">
          <strong>Catálogo:</strong> “{fd.label}” · <code>{fd.source}</code> · {fd.channel}
          {fd.flowApiName && (
            <>
              {' · '}flow <code>{fd.flowApiName}</code>
            </>
          )}
          <div className="help">
            {fd.source === 'FORM_SPEC' ? (
              <>
                É a linha raiz de <code>FormDefinition__c</code> — a de Record Type{' '}
                <code>Form</code> — que amarra o formulário ao Record Type de destino e ao
                Tipo do registro. Na fonte custom o catálogo e a definição são a mesma tabela.
              </>
            ) : (
              <>
                É o registro de <code>FormDefinition__c</code> que amarra o formulário ao
                Record Type. Sem ele, a fonte Screen Flow precisava de dois seletores — o Flow
                não declara Record Type, então as picklists não tinham como ser resolvidas.
              </>
            )}
          </div>
        </div>
      )}

      {warnings.map((w, i) => (
        <div className="note err" key={i}>
          {w}
        </div>
      ))}

      <ol className="calls">
        {todas.map((c, i) => (
          <Call key={`${c.path}-${i}`} call={c} index={i} />
        ))}
      </ol>
    </>
  );
}

/**
 * Um card de chamada, com simulação sob demanda.
 *
 * A simulação é isolada: repete a requisição só para exibir o retorno cru,
 * sem tocar no contrato nem re-renderizar o formulário ao lado.
 */
function Call({ call, index }) {
  const [estado, setEstado] = useState('idle'); // idle | carregando | pronto
  const [resultado, setResultado] = useState(null);
  const [aba, setAba] = useState('retorno'); // retorno | envio

  const simular = async () => {
    if (estado === 'pronto') {
      setEstado('idle');
      setResultado(null);
      return;
    }
    setEstado('carregando');
    try {
      const r = await api.replay(call.path, call.replayId);
      setResultado(r);
      // Num POST composto o que interessa é o corpo enviado: a URL é sempre a
      // mesma `/composite/batch` e não diz o que foi pedido.
      setAba(r?.request?.body ? 'envio' : 'retorno');
    } catch (e) {
      setResultado({ error: e.message });
      setAba('retorno');
    }
    setEstado('pronto');
  };

  const temEnvio = Boolean(resultado?.request?.body);

  return (
    <li className="call">
      <div className="call-head">
        <div>
          <div className="n">{String(index + 1).padStart(2, '0')}</div>
          <div className="label">{call.label}</div>
          {/* Nem toda chamada acontece no mesmo momento: a do catálogo é
              anterior à seleção. Sem isso, a lista sugere uma sequência única. */}
          {call.quando && <div className="quando">{call.quando}</div>}
        </div>
        <button className="btn ghost small" onClick={simular} disabled={estado === 'carregando'}>
          {estado === 'carregando' ? 'Chamando…' : estado === 'pronto' ? 'Ocultar' : 'Ver retorno'}
        </button>
      </div>

      {/* O verbo importa: composite é POST com corpo, e é o corpo que diz o
          que foi pedido — a URL sozinha não conta nada nesse caso. */}
      <div className="path">
        <span className={`verbo verbo-${(call.method || 'GET').toLowerCase()}`}>
          {call.method || 'GET'}
        </span>
        {call.path}
      </div>

      {estado === 'pronto' && resultado && (
        <div className="replay">
          {resultado.error ? (
            <div className="note err">{resultado.error}</div>
          ) : (
            <div className="replay-meta">
              {temEnvio && (
                <span className="replay-tabs">
                  <button
                    className={`chip${aba === 'envio' ? ' is-active' : ''}`}
                    onClick={() => setAba('envio')}
                  >
                    Envio
                  </button>
                  <button
                    className={`chip${aba === 'retorno' ? ' is-active' : ''}`}
                    onClick={() => setAba('retorno')}
                  >
                    Retorno
                  </button>
                </span>
              )}
              <span>
                <b>
                  {aba === 'envio'
                    ? formatBytes(resultado.requestBytes ?? 0)
                    : formatBytes(resultado.bytes)}
                </b>{' '}
                {aba === 'envio' ? 'enviados' : 'de retorno'}
              </span>
              <span>
                <b>{resultado.elapsedMs} ms</b>
              </span>
              {aba === 'retorno' && resultado.truncated && (
                <span className="trunc">exibição truncada</span>
              )}
            </div>
          )}

          {aba === 'envio' && temEnvio ? (
            <Envio request={resultado.request} />
          ) : (
            <pre className="json small">{resultado.preview}</pre>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Decodifica a SOQL das URLs de um corpo composto, SÓ PARA EXIBIÇÃO.
 *
 * Na rede a query vai percent-encoded — `%20`, `%2C`, `%3D` — e é ilegível
 * numa call. Aqui ela volta a `SELECT Id, Name FROM ... WHERE x = 'y'`.
 * Nada além da URL é tocado, e o objeto original não é mutado.
 */
function decodificarQueries(body) {
  const chave = body?.batchRequests ? 'batchRequests' : body?.compositeRequest ? 'compositeRequest' : null;
  if (!chave) return { body, decodificou: false };

  let decodificou = false;
  const subs = body[chave].map((sub) => {
    const url = String(sub.url ?? '');
    const i = url.indexOf('?q=');
    if (i === -1) return sub;
    try {
      decodificou = true;
      return { ...sub, url: `${url.slice(0, i + 3)}${decodeURIComponent(url.slice(i + 3))}` };
    } catch {
      return sub;
    }
  });

  return { body: { ...body, [chave]: subs }, decodificou };
}

/** O corpo enviado, com a SOQL legível — e a opção de ver o original. */
function Envio({ request }) {
  const [cru, setCru] = useState(false);
  const { body, decodificou } = decodificarQueries(request.body);

  return (
    <>
      <div className="path envio">
        {request.method} {request.url}
      </div>

      <pre className="json small">{JSON.stringify(cru ? request.body : body, null, 2)}</pre>

      {decodificou && (
        <div className="help envio-nota">
          {cru
            ? 'Corpo exato que vai na rede, com a SOQL percent-encoded.'
            : 'SOQL decodificada para leitura; na rede ela vai percent-encoded.'}{' '}
          <button className="link" onClick={() => setCru((v) => !v)}>
            {cru ? 'ver decodificado' : 'ver como foi enviado'}
          </button>
        </div>
      )}
    </>
  );
}

function Payload({ contract, result, createResult, creating, onCreate }) {
  if (!result) {
    return <div className="empty">Preencha o formulário e clique em “Gerar payload de envio”.</div>;
  }

  const injetados = Object.entries(result.injectedFields ?? {});

  return (
    <>
      <div className={`note ${result.valid ? 'ok' : 'err'}`}>
        {result.valid
          ? 'Válido — obrigatórios preenchidos e nenhuma validação disparada.'
          : result.missing.length > 0
            ? `Faltando: ${result.missing.join(', ')}`
            : 'Preenchimento inválido.'}
      </div>

      {/* Falta e invalidez são coisas diferentes: falta é campo vazio, invalidez
          é campo preenchido de um jeito que a regra de negócio recusa. Misturar
          as duas numa lista só esconde o motivo real do bloqueio. */}
      {(result.invalid ?? []).length > 0 && (
        <div className="note err">
          <strong>Validações que impedem o envio</strong>
          <ul className="lista-invalido">
            {result.invalid.map((e) => (
              <li key={e.apiName}>
                <code>{e.apiName}</code> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {injetados.length > 0 && (
        <div className="note">
          <strong>Gravados pelo back-end</strong>
          {contract?.formDefinition ? (
            <>
              , a partir de{' '}
              <code>FormDefinition__c</code>{' '}
              — “{contract.formDefinition.label}”
            </>
          ) : null}
          :
          <dl className="created injected">
            {injetados.map(([apiName, valor]) => (
              <Fragment key={apiName}>
                <dt className="mono">{apiName}</dt>
                <dd className="mono">{String(valor)}</dd>
              </Fragment>
            ))}
          </dl>
          <div className="help">
            Não aparecem no formulário e o usuário não os digita. Quem escolheu o formulário
            já escolheu o Record Type e o Type do caso — perguntar de novo só abriria espaço
            para o dado divergir do catálogo.
          </div>
          {result.injectedOverwroteForm?.length > 0 && (
            <div className="hidden-list">
              sobrescreveram o que veio do formulário: {result.injectedOverwroteForm.join(', ')}
            </div>
          )}
        </div>
      )}

      {result.hiddenFieldsIgnored?.length > 0 && (
        <div className="note">
          Campos ocultos por regra, ignorados no payload:{' '}
          <span className="hidden-list">{result.hiddenFieldsIgnored.join(', ')}</span>
        </div>
      )}

      <pre className="json">{JSON.stringify(result.request, null, 2)}</pre>

      <div className="create-bar">
        <button className="btn" disabled={!result.valid || creating} onClick={onCreate}>
          {creating ? 'Criando…' : 'Criar registro no Salesforce'}
        </button>
        <span className="help">
          {result.valid
            ? 'Envia de verdade, via Composite, para a scratch org.'
            : 'Complete os campos obrigatórios para habilitar.'}
        </span>
      </div>

      {createResult && <CreateResult result={createResult} objeto={contract?.object} />}
    </>
  );
}

function CreateResult({ result, objeto }) {
  if (!result.ok) {
    return (
      <div className="note err create-result">
        <strong>Não foi possível criar o registro.</strong>
        <div>{result.error}</div>
        {result.errorCode && <div className="hidden-list">código: {result.errorCode}</div>}
        {result.fields?.length > 0 && (
          <div className="hidden-list">campos: {result.fields.join(', ')}</div>
        )}
        {result.missing?.length > 0 && (
          <div className="hidden-list">faltando: {result.missing.join(', ')}</div>
        )}
      </div>
    );
  }

  const rec = result.record || {};

  return (
    <>
      <div className="note ok create-result">
        <strong>Registro criado no Salesforce.</strong>
        <dl className="created">
          {rec.CaseNumber ? (
            <>
              <dt>Número</dt>
              <dd>{rec.CaseNumber}</dd>
            </>
          ) : rec.Name ? (
            <>
              <dt>Nome</dt>
              <dd>{rec.Name}</dd>
            </>
          ) : null}
          <dt>Id</dt>
          <dd className="mono">{result.id}</dd>
          {rec.Status && (
            <>
              <dt>Status</dt>
              <dd>{rec.Status}</dd>
            </>
          )}
          {rec.CreatedDate && (
            <>
              <dt>Criado em</dt>
              <dd>{new Date(rec.CreatedDate).toLocaleString('pt-BR')}</dd>
            </>
          )}
        </dl>
        {result.attachmentsNote && <div className="help">{result.attachmentsNote}</div>}
      </div>

      {/* key: um registro novo é outro teste — o painel recomeça e busca sozinho. */}
      {result.id && <SlaPanel key={result.id} idCriado={result.id} objeto={objeto} />}
    </>
  );
}
