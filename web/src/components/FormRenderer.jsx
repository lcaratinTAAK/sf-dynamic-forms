import { useEffect, useMemo, useState } from 'react';
import Field from './Field.jsx';
import { cenariosPara, suportaDemo } from '../demoData.js';
import * as api from '../api.js';
// O MESMO avaliador que o servidor usa. Um módulo puro, sem I/O.
import { avaliarGrupo, escopoDoItem, isRequired, isVisible, validar } from '../../../server/contract.js';

/**
 * Bloco de conteúdo: Body__c é HTML vindo do editor rico do Form Builder
 * (lightning-input-rich-text) — negrito, cores inline, listas, links, títulos,
 * alinhamento e recuo. No Salesforce quem desenha é o
 * lightning-formatted-rich-text, que já sanitiza; aqui o HTML passa por uma
 * lista de permissões antes do `dangerouslySetInnerHTML`.
 *
 * Suficiente para uma POC, não um sanitizador de produção: tag fora da lista
 * vira só o texto dela (as perigosas somem inteiras), atributo fora da lista
 * cai, `style` fica só com as propriedades de formatação, e link só sai com
 * http(s), mailto ou tel.
 */
const TAGS_DO_CONTEUDO = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP',
  'UL', 'OL', 'LI', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR',
]);
const TAGS_DESCARTADAS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON',
  'TEXTAREA', 'SELECT', 'LINK', 'META', 'BASE', 'TEMPLATE', 'NOSCRIPT', 'IMG', 'VIDEO', 'AUDIO',
]);
const ESTILOS_DO_CONTEUDO = new Set([
  'color', 'background-color', 'text-align', 'font-size', 'font-family', 'font-weight',
  'font-style', 'text-decoration', 'padding-left', 'margin-left',
]);

function limparEstilo(estilo) {
  return String(estilo)
    .split(';')
    .map((d) => d.split(':'))
    .filter(([prop, ...resto]) => {
      const valor = resto.join(':').toLowerCase();
      return (
        ESTILOS_DO_CONTEUDO.has(prop?.trim().toLowerCase()) &&
        valor.trim() &&
        !/url\(|expression|javascript:|[<>]/.test(valor)
      );
    })
    .map(([prop, ...resto]) => `${prop.trim().toLowerCase()}: ${resto.join(':').trim()}`)
    .join('; ');
}

function limparNo(no) {
  for (const filho of [...no.childNodes]) {
    if (filho.nodeType === 3) continue; // texto
    if (filho.nodeType !== 1) {
      filho.remove(); // comentário e afins
      continue;
    }
    const tag = filho.tagName.toUpperCase();
    if (TAGS_DESCARTADAS.has(tag)) {
      filho.remove();
      continue;
    }
    limparNo(filho);
    if (!TAGS_DO_CONTEUDO.has(tag)) {
      // Tag desconhecida (font, table…): fica o conteúdo, sai a tag.
      filho.replaceWith(...filho.childNodes);
      continue;
    }
    for (const attr of [...filho.attributes]) {
      const nome = attr.name.toLowerCase();
      if (nome === 'style') {
        const estilo = limparEstilo(attr.value);
        if (estilo) filho.setAttribute('style', estilo);
        else filho.removeAttribute('style');
      } else if (nome === 'class') {
        // Só as classes do Quill (ql-align-*, ql-indent-*), que o CSS desenha.
        const classes = attr.value.split(/\s+/).filter((c) => /^ql-[a-z0-9-]+$/.test(c));
        if (classes.length) filho.setAttribute('class', classes.join(' '));
        else filho.removeAttribute('class');
      } else if (!(tag === 'A' && nome === 'href')) {
        filho.removeAttribute(attr.name);
      }
    }
    if (tag === 'A') {
      const href = (filho.getAttribute('href') || '').trim();
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        filho.setAttribute('target', '_blank');
        filho.setAttribute('rel', 'noopener noreferrer');
      } else {
        filho.removeAttribute('href');
      }
    }
  }
}

/** HTML do Body__c pronto para o `dangerouslySetInnerHTML`. */
function htmlSeguro(html) {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') {
    // Sem DOM (não deveria acontecer no navegador): melhor texto puro que HTML cru.
    return String(html).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  limparNo(doc.body);
  return doc.body.innerHTML;
}

function BlocoConteudo({ html }) {
  const limpo = useMemo(() => htmlSeguro(html), [html]);
  return <div className="bloco-conteudo" dangerouslySetInnerHTML={{ __html: limpo }} />;
}

/**
 * Referência múltipla: uma linha por escolha, com "Nova linha" e lixeira.
 *
 * A resposta é um array de ids externos em `values[item.apiName]`. Nada disso
 * vai no registro do formulário: cada linha preenchida vira um registro de
 * `item.link.object` (ChildObjectApiName__c, ex. CaseContract__c), com o Id do
 * Caso gerado em `link.caseField` e o id externo em `link.externalIdField` —
 * o destino é do componente, lido da definição (ver `compositeDoEnvio`).
 *
 * Na POC não há cliente logado para listar os contratos DELE, então as
 * sugestões vêm da org pelo BFF; digitar um id externo à mão continua valendo,
 * como no campo de referência simples.
 */
/**
 * Uma linha da referência múltipla. A busca e o datalist são DA LINHA: com um
 * termo só para o componente, escolher um registro na primeira linha deixava a
 * lista filtrada por ele, e as linhas novas (vazias) não tinham o que sugerir.
 */
function LinhaReferencia({ item, indice, valor, onValor, onRemover }) {
  const [sugestoes, setSugestoes] = useState([]);
  const [falhaBusca, setFalhaBusca] = useState(null);
  const { object, externalIdField } = item.reference ?? {};

  // Busca com atraso: uma ida ao Salesforce por pausa na digitação, não por tecla.
  useEffect(() => {
    if (!object || !externalIdField) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      api
        .getReferences({ object, externalIdField, term: valor })
        .then((r) => {
          if (!vivo) return;
          setSugestoes(r.records);
          setFalhaBusca(null);
        })
        .catch((e) => vivo && setFalhaBusca(e.message));
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [object, externalIdField, valor]);

  const listaId = `sugestoes-${item.apiName}-${indice}`;

  return (
    <>
      <div className="multiref-linha">
        <input
          type="text"
          list={listaId}
          value={valor}
          placeholder={item.placeholder || `id externo do ${object ?? 'registro'}`}
          onChange={(e) => onValor(e.target.value)}
        />
        <button
          type="button"
          className="multiref-remover"
          onClick={onRemover}
          aria-label={`Excluir linha ${indice + 1}`}
          title="Excluir linha"
        >
          🗑
        </button>
      </div>
      <datalist id={listaId}>
        {sugestoes.map((s) => (
          <option key={s.id} value={s.externalId}>
            {s.name ?? s.externalId}
          </option>
        ))}
      </datalist>
      {falhaBusca && <span className="help">sem sugestões ({falhaBusca}); digite o id externo</span>}
    </>
  );
}

function ReferenciaMultipla({ item, values, onChange, erro }) {
  const brutos = Array.isArray(values[item.apiName]) ? values[item.apiName] : [];
  // Nunca zero linhas: sempre há onde digitar a primeira escolha.
  const linhas = brutos.length ? brutos : [''];
  const obrigatorio = isRequired(item, values);
  const { object, externalIdField } = item.reference ?? {};

  const gravar = (novas) => onChange(item.apiName, novas);

  return (
    <div className={`field multiref is-wide${erro ? ' is-invalid' : ''}`}>
      <label>
        {item.label}
        {obrigatorio && <span className="req" title="obrigatório">*</span>}
        <span className="ruled ruled-lista">
          cada linha vira um <code>{item.link?.object}</code>
        </span>
        {item.visibility && <span className="ruled">condicional</span>}
      </label>

      {linhas.map((valor, i) => (
        <LinhaReferencia
          key={i}
          item={item}
          indice={i}
          valor={valor}
          onValor={(novo) => gravar(linhas.map((v, j) => (j === i ? novo : v)))}
          onRemover={() => gravar(linhas.filter((_, j) => j !== i))}
        />
      ))}

      <button type="button" className="btn ghost small btn-lista" onClick={() => gravar([...linhas, ''])}>
        + Nova linha
      </button>

      {item.helpText && <span className="help">{item.helpText}</span>}
      <span className="help">
        Escolha em <code>{object}</code> por <code>{externalIdField}</code>
        {item.link && (
          <>
            {' · '}cada linha cria um <code>{item.link.object}</code> com{' '}
            <code>{item.link.caseField} = id do Caso</code> e <code>{item.link.externalIdField} = id externo</code>
          </>
        )}
      </span>
      {erro && <span className="erro-validacao">{erro}</span>}
    </div>
  );
}

/**
 * Um item de seção. As três primeiras fontes só produzem campos; a fonte
 * custom também produz bloco de conteúdo e anexo POSICIONADO — um anexo que
 * vive dentro de uma seção e tem regra de visibilidade própria, como qualquer
 * outro componente.
 */
function Componente({ item, values, onChange, files, onFiles, erro }) {
  const kind = item.kind ?? 'field';

  if (kind === 'content') {
    return <BlocoConteudo html={item.html} />;
  }

  if (kind === 'reference') {
    // No app isto vira um seletor da entidade; aqui, um campo de texto que
    // recebe o id externo e diz ao lado do que se trata.
    return (
      <div className="referencia">
        <Field field={item} value={values[item.apiName]} values={values} onChange={onChange} erro={erro} />
        <div className="help">
          Referência a <code>{item.reference?.object}</code> por <code>{item.reference?.externalIdField}</code>
          {' · '}vai como texto em <code>{item.apiName}</code>
        </div>
      </div>
    );
  }

  if (kind === 'multireference') {
    return <ReferenciaMultipla item={item} values={values} onChange={onChange} erro={erro} />;
  }

  if (kind === 'attachment') {
    const selecionados = (files || []).filter((f) => f.__code === item.code);
    return (
      <div className={`anexo-item${item.required ? ' is-required' : ''}`}>
        <label>
          {item.label} {item.required && <span className="req">*</span>}
        </label>
        <div className="help">
          {item.acceptedTypes?.length ? item.acceptedTypes.join(', ') : 'qualquer formato'}
          {item.maxSizeMb ? ` · até ${item.maxSizeMb} MB` : ''}
          {item.maxFiles ? ` · máx. ${item.maxFiles} arquivo(s)` : ''}
          <code className="cod">{item.code}</code>
        </div>
        <input
          type="file"
          multiple={item.maxFiles !== 1}
          onChange={(e) => {
            const novos = [...e.target.files].map((f) => ({ name: f.name, size: f.size, __code: item.code }));
            const outros = (files || []).filter((f) => f.__code !== item.code);
            onFiles([...outros, ...novos]);
          }}
        />
        {selecionados.length > 0 && (
          <span className="help">{selecionados.length} arquivo(s) selecionado(s)</span>
        )}
      </div>
    );
  }

  return (
    <Field field={item} value={values[item.apiName]} values={values} onChange={onChange} erro={erro} />
  );
}

function Attachments({ attachments, files, onFiles }) {
  if (!attachments.required && !attachments.component && attachments.documents.length === 0) {
    return null;
  }

  return (
    <div className={`attachments${attachments.required ? ' is-required' : ''}`}>
      <h3>
        Anexos {attachments.required && <span className="req">*</span>}
      </h3>
      <span className="help">
        {attachments.required
          ? `Mínimo de ${attachments.minimumCount} arquivo(s).`
          : 'Opcional para este formulário.'}
        {attachments.component && ` · componente ${attachments.component}`}
      </span>

      {attachments.documents.length > 0 && (
        <ul className="doc-list">
          {attachments.documents.map((d) => (
            <li key={d.code}>
              <code>{d.code}</code>
              {d.label}
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 12 }}>
        <input
          type="file"
          multiple
          onChange={(e) => onFiles(Array.from(e.target.files).map((f) => f.name))}
        />
        {files.length > 0 && (
          <span className="help"> {files.length} arquivo(s) selecionado(s)</span>
        )}
      </div>
    </div>
  );
}

/**
 * Uma lista repetível. Cada item é um bloco com os mesmos campos, e cada bloco
 * vira um registro do objeto do item no envio — não campos no Caso.
 *
 * Cada item é avaliado no próprio escopo (`escopoDoItem`): as regras dos campos
 * leem as respostas daquele item, ou as do formulário quando a regra aponta o
 * objeto do formulário (`ConditionObjectApiName__c`). É a mesma função que o
 * servidor usa para montar o envio.
 */
function Lista({ secao, objeto, values, onLista, files, onFiles }) {
  const itens = (values.__listas && values.__listas[secao.id]) || [];
  const noMaximo = Boolean(secao.maxItems) && itens.length >= secao.maxItems;
  const vinculo = secao.caseField
    ? `${secao.caseField} = id do Caso`
    : secao.childRelationshipField
      ? `${secao.childRelationshipField} = id do registro`
      : null;

  return (
    <div className="section is-lista">
      <header>
        {secao.label}
        <span className="ruled ruled-lista">
          {itens.length} {itens.length === 1 ? 'item' : 'itens'} · cada um vira um{' '}
          <code>{secao.childObject}</code>
          {secao.childRecordTypeDevName && (
            <>
              {' · '}RT <code>{secao.childRecordTypeDevName}</code>
            </>
          )}
        </span>
        {secao.visibility && <span className="ruled">condicional</span>}
      </header>

      <div className="lista-meta help">
        {vinculo && <code>{vinculo}</code>}
        {secao.listField && (
          <>
            {' · '}
            <code>{secao.listField} = id da lista</code>
          </>
        )}
        {secao.listDefaults?.length > 0 && (
          <>
            {' · '}valor padrão aplicado pelo Salesforce:{' '}
            {secao.listDefaults.map((d) => (
              <code key={d.field}>
                {d.field} = {d.value}
              </code>
            ))}
          </>
        )}
      </div>

      <div className="lista-corpo">
        {itens.length === 0 && <p className="lista-vazia">Nenhum item ainda.</p>}

        {itens.map((item, i) => {
          const escopo = escopoDoItem(objeto, values, item);
          const campos = secao.fields.filter((f) => !f.hidden && isVisible(f, escopo));
          return (
          <div className="lista-item" key={`${secao.id}-${i}`}>
            <div className="lista-item-topo">
              <span>
                {secao.itemLabel} {i + 1}
              </span>
              <button
                type="button"
                className="lista-remover"
                onClick={() => onLista(secao.id, 'remover', i)}
                aria-label={`Remover ${secao.itemLabel} ${i + 1}`}
              >
                ×
              </button>
            </div>
            <div className="body">
              {campos.map((f) =>
                (f.kind ?? 'field') === 'content' ? (
                  <BlocoConteudo key={f.apiName} html={f.html} />
                ) : (f.kind ?? 'field') === 'attachment' ? (
                  <div className="anexo-item" key={f.apiName}>
                    <label>{f.label}</label>
                    {/* O código carrega o escopo do item: o mesmo documento
                        aparece uma vez por item, e sem isso o arquivo do item 2
                        sobrescreveria o do item 1. */}
                    <input
                      type="file"
                      multiple={f.maxFiles !== 1}
                      onChange={(e) => {
                        const tag = `${secao.id}:${i}:${f.code}`;
                        const novos = [...e.target.files].map((x) => ({
                          name: x.name,
                          size: x.size,
                          __code: tag,
                        }));
                        onFiles([...(files || []).filter((x) => x.__code !== tag), ...novos]);
                      }}
                    />
                    <span className="help">
                      {(files || []).filter((x) => x.__code === `${secao.id}:${i}:${f.code}`).length}{' '}
                      arquivo(s)
                    </span>
                  </div>
                ) : (
                  <Field
                    key={f.apiName}
                    field={f}
                    value={item[f.apiName]}
                    values={escopo}
                    onChange={(apiName, valor) => onLista(secao.id, 'campo', i, apiName, valor)}
                    erro={
                      f.validation && avaliarGrupo(f.validation, escopo, false) ? f.validation.message : undefined
                    }
                  />
                )
              )}
            </div>
          </div>
          );
        })}

        <button
          type="button"
          className="btn btn-lista"
          onClick={() => onLista(secao.id, 'adicionar')}
          disabled={noMaximo}
          title={noMaximo ? `Máximo de ${secao.maxItems} itens` : undefined}
        >
          + {secao.addButtonText}
        </button>
      </div>
    </div>
  );
}

export default function FormRenderer({
  contract,
  values,
  onChange,
  onLista,
  files,
  onFiles,
  onSubmit,
  onFill,
}) {
  // Validações que falharam agora. Calculadas uma vez e repassadas por campo —
  // é a mesma função que o servidor usa no envio, então tela e payload nunca
  // discordam sobre o que está errado.
  const errosPorCampo = Object.fromEntries(validar(contract, values).map((e) => [e.apiName, e.message]));

  const allFields = contract.sections
    .filter((s) => !s.repeating)
    .flatMap((s) => s.fields)
    .filter((f) => (f.kind ?? 'field') === 'field');
  // Campo em seção oculta também está oculto — só a fonte custom produz isso.
  const shown = contract.sections
    .filter((s) => !s.repeating)
    .filter((s) => isVisible(s, values))
    .flatMap((s) => s.fields)
    .filter((f) => (f.kind ?? 'field') === 'field')
    .filter((f) => isVisible(f, values));
  const hidden = allFields.length - shown.length;

  // Quando os anexos são componentes posicionados dentro das seções, o bloco
  // agregado no topo seria a mesma informação duas vezes.
  const anexosInline = contract.sections.some((s) =>
    s.fields.some((f) => f.kind === 'attachment')
  );

  return (
    <div>
      {suportaDemo(contract) && (
        <div className="demo-fill">
          <span className="demo-fill-label">Dados de teste</span>
          {cenariosPara(contract).map((c) => (
            <button key={c.id} className="btn ghost small" onClick={() => onFill(c)}>
              {c.label}
            </button>
          ))}
          <button className="btn ghost small" onClick={() => onFill(null)}>
            Limpar
          </button>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <b>{shown.length}</b>
          <span>campos visíveis</span>
        </div>
        <div className="stat">
          <b>{hidden}</b>
          <span>ocultos por regra</span>
        </div>
        <div className="stat">
          <b>{shown.filter((f) => f.required).length}</b>
          <span>obrigatórios</span>
        </div>
      </div>

      {!anexosInline && (
        <Attachments attachments={contract.attachments} files={files} onFiles={onFiles} />
      )}

      {contract.sections.map((section) => {
        // Seção pode ter visibilidade PRÓPRIA — só a fonte custom expressa
        // isso. Nas outras o campo `visibility` da seção vem nulo e
        // `isVisible` devolve true, então o comportamento delas não muda.
        if (!isVisible(section, values)) return null;

        if (section.repeating) {
          return (
            <Lista
              key={section.id}
              secao={section}
              objeto={contract.object}
              values={values}
              onLista={onLista}
              files={files}
              onFiles={onFiles}
            />
          );
        }

        // Campo oculto não é desenhado, mas continua no contrato e no payload.
        const visiveis = section.fields.filter((f) => isVisible(f, values) && !f.hidden);
        if (visiveis.length === 0) return null;

        return (
          <div className="section" key={section.id}>
            {section.label && (
              <header>
                {section.label}
                {section.visibility && <span className="ruled">condicional</span>}
                {section.repeating && <span className="ruled">repetível</span>}
              </header>
            )}
            <div className="body">
              {visiveis.map((f) => (
                <Componente
                  key={f.apiName}
                  item={f}
                  values={values}
                  onChange={onChange}
                  files={files}
                  onFiles={onFiles}
                  erro={errosPorCampo[f.apiName]}
                />
              ))}
            </div>
          </div>
        );
      })}

      <button className="btn" onClick={onSubmit}>
        Gerar payload de envio
      </button>
    </div>
  );
}
