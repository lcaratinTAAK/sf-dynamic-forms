import { Fragment, useEffect, useState } from 'react';
import * as api from '../api.js';

/**
 * SLAs de atendimento do caso gerado.
 *
 * O envio cria o registro do formulário; o Caso nasce depois, por automação,
 * com o Id do envio em `RelatedCaseFormSubmission__c` — e é o processo de
 * direito do Caso que cria os CaseMilestone. Daí os dois caminhos:
 *
 *   pelo envio — o Id que a criação acabou de devolver; não precisa saber o Caso
 *   pelo Caso  — CaseId direto; exige conhecer o Caso antes
 *
 * Quando o formulário cria o próprio Case, o Id criado JÁ é o do Caso, então o
 * caminho padrão passa a ser o segundo.
 *
 * Os dois Ids ficam editáveis: dá para colar o de qualquer envio ou Caso da
 * org e testar sem criar nada.
 */

const VIAS = [
  { id: 'submission', rotulo: 'Pelo envio', campo: 'RelatedCaseFormSubmission__c' },
  { id: 'case', rotulo: 'Pelo Caso', campo: 'CaseId' },
];

/** O Salesforce devolve `+0000`; o ISO que o Date entende em todo navegador é `+00:00`. */
const data = (s) =>
  s ? new Date(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toLocaleString('pt-BR') : '—';

/**
 * A meta na maior unidade que couber, pelas colunas …InDays e …InHrs que o
 * Salesforce já devolve. É tempo de horário comercial: somar ao início não dá
 * o prazo — o prazo é TargetDate.
 */
function meta(m) {
  const fmt = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (m.TargetResponseInMins == null) return '—';
  const min = `${fmt(m.TargetResponseInMins)} min`;
  if (m.TargetResponseInDays >= 1) return `${fmt(m.TargetResponseInDays)} dia(s) · ${min}`;
  if (m.TargetResponseInHrs >= 1) return `${fmt(m.TargetResponseInHrs)} h · ${min}`;
  return min;
}

/** Concluído e violado não se excluem: dá para fechar o milestone depois do prazo. */
function situacao(m) {
  if (m.IsCompleted && m.IsViolated) return { rotulo: 'Concluído fora do prazo', cls: 'warn' };
  if (m.IsCompleted) return { rotulo: 'Concluído', cls: 'ok' };
  if (m.IsViolated) return { rotulo: 'Violado', cls: 'err' };
  return { rotulo: 'Em andamento', cls: 'aberto' };
}

export default function SlaPanel({ idCriado, objeto }) {
  const criaCaso = objeto === 'Case';
  const [via, setVia] = useState(criaCaso ? 'case' : 'submission');
  const [ids, setIds] = useState({
    submission: criaCaso ? '' : idCriado ?? '',
    case: criaCaso ? idCriado ?? '' : '',
  });
  const [estado, setEstado] = useState('idle'); // idle | carregando | pronto
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [cru, setCru] = useState(false);
  // A SOQL leva a lista inteira de tipos e ocupa meia tela: fica recolhida.
  const [verSoql, setVerSoql] = useState(false);

  const buscar = async (qual = via, id = ids[qual]) => {
    if (!id?.trim()) {
      setErro(qual === 'case' ? 'Informe o Id do Caso.' : 'Informe o Id do envio.');
      setResultado(null);
      setEstado('pronto');
      return;
    }
    setEstado('carregando');
    setErro(null);
    try {
      const r = await api.getSla(qual, id.trim());
      setResultado(r);
      // Pelo envio, cada milestone já traz o CaseId: é assim que o Caso aparece
      // sem outra consulta, e o caminho "pelo Caso" fica pronto para comparar.
      const caso = r.records?.[0]?.CaseId;
      if (qual === 'submission' && caso) setIds((atual) => (atual.case ? atual : { ...atual, case: caso }));
    } catch (e) {
      setResultado(null);
      setErro(e.message);
    }
    setEstado('pronto');
  };

  // Busca sozinha ao aparecer: é o teste que interessa logo depois de criar.
  useEffect(() => {
    if (idCriado) buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trocarVia = (nova) => {
    setVia(nova);
    setResultado(null);
    setErro(null);
    if (ids[nova]) buscar(nova, ids[nova]);
    else setEstado('idle');
  };

  const registros = resultado?.records ?? [];
  const viaAtual = VIAS.find((v) => v.id === via);

  return (
    <div className="sla">
      <div className="sla-head">
        <strong>SLAs de atendimento do caso gerado</strong>
        <span className="replay-tabs">
          {VIAS.map((v) => (
            <button
              key={v.id}
              className={`chip${via === v.id ? ' is-active' : ''}`}
              onClick={() => trocarVia(v.id)}
              title={`WHERE ${v.id === 'case' ? 'CaseId' : `Case.${v.campo}`} = :id`}
            >
              {v.rotulo}
            </button>
          ))}
        </span>
      </div>

      <form
        className="sla-busca"
        onSubmit={(e) => {
          e.preventDefault();
          buscar();
        }}
      >
        <label htmlFor="sla-id" className="help">
          <code>{viaAtual.campo}</code> =
        </label>
        <input
          id="sla-id"
          value={ids[via]}
          placeholder={via === 'case' ? 'Id do Caso (500…)' : 'Id do registro do envio'}
          spellCheck={false}
          onChange={(e) => setIds((atual) => ({ ...atual, [via]: e.target.value }))}
        />
        <button className="btn ghost small" type="submit" disabled={estado === 'carregando'}>
          {estado === 'carregando' ? 'Buscando…' : resultado ? 'Buscar de novo' : 'Buscar'}
        </button>
      </form>

      {erro && <div className="note err">{erro}</div>}

      {resultado && (
        <>
          <div className="replay-meta">
            <span>
              <b>{resultado.totalSize}</b> milestone(s)
            </span>
            <span>
              <b>{resultado.elapsedMs} ms</b>
            </span>
            <button className="link" onClick={() => setVerSoql((v) => !v)}>
              {verSoql ? 'ocultar SOQL' : 'ver SOQL'}
            </button>
            <button className="link" onClick={() => setCru((v) => !v)}>
              {cru ? 'ver resumo' : 'ver retorno cru'}
            </button>
          </div>

          {verSoql && (
            <pre className="json small sla-soql">
              <span className="verbo verbo-get">GET</span>
              {resultado.soql}
            </pre>
          )}

          {cru ? (
            <pre className="json small">{JSON.stringify(registros, null, 2)}</pre>
          ) : registros.length === 0 ? (
            <div className="note">
              Nenhum milestone dos tipos de SLA para este {via === 'case' ? 'Caso' : 'envio'}.
              <div className="help">
                Logo depois do envio isso é esperado: o Caso nasce por automação, e só tem milestone
                se entrou num processo de direito (Entitlement). Espere alguns segundos e busque de
                novo.
              </div>
            </div>
          ) : (
            <div className="sla-lista">
              {registros.map((m) => {
                const s = situacao(m);
                return (
                  <div className={`sla-item is-${s.cls}`} key={m.Id}>
                    <div className="sla-item-topo">
                      <span>{m.MilestoneType?.Name ?? m.MilestoneTypeId}</span>
                      <span className={`sla-status is-${s.cls}`}>{s.rotulo}</span>
                    </div>
                    <dl className="created">
                      {[
                        ['Caso', <span className="mono">{m.CaseId}</span>],
                        ['Início', data(m.StartDate)],
                        ['Prazo', data(m.TargetDate)],
                        ['Meta', meta(m)],
                        m.IsCompleted
                          ? ['Concluído em', data(m.CompletionDate)]
                          : m.IsViolated
                            ? ['Atrasado há', m.TimeSinceTargetInMins ? `${m.TimeSinceTargetInMins} (min:s)` : '—']
                            // TimeRemainingInMins é texto "mm:ss", não número — conferido no FornoV1.
                            : ['Restante', m.TimeRemainingInMins ? `${m.TimeRemainingInMins} (min:s)` : '—'],
                      ].map(([rotulo, valor]) => (
                        <Fragment key={rotulo}>
                          <dt>{rotulo}</dt>
                          <dd>{valor}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
