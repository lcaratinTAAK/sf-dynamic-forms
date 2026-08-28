import { isRequired } from '../../../server/contract.js';

/**
 * Renderiza UM campo do contrato normalizado.
 *
 * Não sabe se a definição veio da UI API ou de um Screen Flow — esse é o ponto.
 */

const WIDE_TYPES = new Set(['TextArea', 'LongTextArea', 'RichTextArea']);

/**
 * Largura declarada na definição -> classe de grade.
 *
 * O Cognito modela isso como `cols` numa grade de 24, e 49 dos 53 formulários
 * usam meia largura em pares como Agência/Conta. Tipo de campo continua tendo
 * a última palavra: caixa de texto longa ocupa a linha inteira mesmo marcada
 * como metade, senão fica ilegível.
 */
const LARGURAS = { FULL: 'is-wide', HALF: 'is-half', THIRD: 'is-third' };

function describeRule(visibility) {
  const parts = visibility.conditions.map(
    (c) => `${c.field} ${c.operator.toLowerCase().replace(/_/g, ' ')} ${c.value ? `"${c.value}"` : ''}`.trim()
  );
  return parts.join(visibility.logic === 'OR' ? ' ou ' : ' e ');
}

/** Filtra opções de picklist dependente conforme o valor do campo controlador. */
function visibleOptions(field, values) {
  if (!field.options) return null;
  if (!field.controllerField || !field.controllerValues) return field.options;

  const controllerValue = values[field.controllerField];
  const index = field.controllerValues[controllerValue];
  if (index === undefined) return field.options.filter((o) => !o.validFor?.length);

  return field.options.filter((o) => !o.validFor?.length || o.validFor.includes(index));
}

function classeLargura(field) {
  // Tipo tem a última palavra: caixa de texto longa ocupa a linha inteira
  // mesmo marcada como metade, senão fica ilegível.
  if (WIDE_TYPES.has(field.dataType)) return 'is-wide';
  // Sem largura declarada, quem decide é a grade — comportamento que a UI API
  // e a Screen Flow já tinham antes de existir Width__c.
  return LARGURAS[field.width] ?? '';
}

export default function Field({ field, value, onChange, values, erro }) {
  const obrigatorio = isRequired(field, values || {});
  const id = `f-${field.apiName}`;
  const common = {
    id,
    value: value ?? '',
    disabled: field.readOnly,
    onChange: (e) => onChange(field.apiName, e.target.value),
  };

  const options = visibleOptions(field, values);

  let input;
  switch (field.dataType) {
    case 'Picklist':
      input = (
        <select {...common}>
          <option value="">— selecione —</option>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;

    case 'MultiPicklist':
      input = (
        <select
          {...common}
          multiple
          value={Array.isArray(value) ? value : []}
          onChange={(e) =>
            onChange(field.apiName, Array.from(e.target.selectedOptions, (o) => o.value))
          }
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;

    case 'Boolean':
      input = (
        <div className="checkbox-row">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            disabled={field.readOnly}
            onChange={(e) => onChange(field.apiName, e.target.checked)}
          />
          <span className="help">{field.label}</span>
        </div>
      );
      break;

    case 'TextArea':
    case 'LongTextArea':
    case 'RichTextArea':
      input = <textarea {...common} maxLength={field.maxLength || undefined} />;
      break;

    case 'Date':
      input = <input {...common} type="date" />;
      break;
    case 'DateTime':
      input = <input {...common} type="datetime-local" />;
      break;
    case 'Email':
      input = <input {...common} type="email" />;
      break;
    case 'Phone':
      input = <input {...common} type="tel" />;
      break;
    case 'Url':
      input = <input {...common} type="url" />;
      break;
    case 'Int':
    case 'Double':
    case 'Currency':
    case 'Percent':
      input = <input {...common} type="number" />;
      break;

    case 'Reference':
      input = <input {...common} type="text" placeholder="Id do registro relacionado" />;
      break;

    default:
      input = <input {...common} type="text" maxLength={field.maxLength || undefined} />;
  }

  return (
    <div className={`field ${classeLargura(field)}${erro ? ' is-invalid' : ''}`}>
      <label htmlFor={id}>
        {field.label}
        {obrigatorio && <span className="req" title="obrigatório">*</span>}
        {field.visibility && (
          <span className="ruled" title="campo condicional">
            visível se {describeRule(field.visibility)}
          </span>
        )}
        {field.requiredWhen && (
          <span className="ruled ruled-req" title="obrigatoriedade condicional">
            exigido se {describeRule(field.requiredWhen)}
          </span>
        )}
      </label>
      {input}
      {field.helpText && <span className="help">{field.helpText}</span>}
      {erro && <span className="erro-validacao">{erro}</span>}
    </div>
  );
}
