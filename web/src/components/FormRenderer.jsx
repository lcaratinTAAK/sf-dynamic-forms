import Field from './Field.jsx';
import { cenariosPara, suportaDemo } from '../demoData.js';
// O MESMO avaliador que o servidor usa. Um módulo puro, sem I/O.
import { isVisible, validar } from '../../../server/contract.js';

/**
 * Um item de seção. As três primeiras fontes só produzem campos; a fonte
 * custom também produz bloco de conteúdo e anexo POSICIONADO — um anexo que
 * vive dentro de uma seção e tem regra de visibilidade própria, como qualquer
 * outro componente.
 */
function Componente({ item, values, onChange, files, onFiles, erro }) {
  const kind = item.kind ?? 'field';

  if (kind === 'content') {
    return (
      <div className="bloco-conteudo" dangerouslySetInnerHTML={{ __html: item.html }} />
    );
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
 */
function Lista({ secao, values, onLista, files, onFiles }) {
  const itens = (values.__listas && values.__listas[secao.id]) || [];
  const campos = secao.fields.filter((f) => !f.hidden);
  const noMaximo = Boolean(secao.maxItems) && itens.length >= secao.maxItems;

  return (
    <div className="section is-lista">
      <header>
        {secao.label}
        <span className="ruled ruled-lista">
          {itens.length} {itens.length === 1 ? 'item' : 'itens'} · cada um vira um{' '}
          <code>{secao.childObject}</code>
        </span>
      </header>

      <div className="lista-corpo">
        {itens.length === 0 && <p className="lista-vazia">Nenhum item ainda.</p>}

        {itens.map((item, i) => (
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
                (f.kind ?? 'field') === 'attachment' ? (
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
                    values={item}
                    onChange={(apiName, valor) => onLista(secao.id, 'campo', i, apiName, valor)}
                  />
                )
              )}
            </div>
          </div>
        ))}

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
