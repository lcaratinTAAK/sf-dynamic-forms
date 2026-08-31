/**
 * Página de Informações — a solução CUSTOM, sozinha.
 *
 * A página `Info.jsx` compara as fontes; esta não compara nada. Assume que a
 * escolha já foi feita e responde a uma pergunta só: como o Custom funciona,
 * do primeiro GET até o Caso criado.
 *
 * Todo número aqui foi medido contra a scratch org (Case com 397 campos
 * criáveis) — não são estimativas. Onde algo é decisão em aberto, está dito.
 */

import { useEffect, useMemo, useState } from 'react';
import { EXEMPLO_JSON } from '../exemploTraducao.js';
import '../info.css';
import '../info-custom.css';

/* ══════════════════════════════════════════════════════════════════════════
   DADOS — medidos, não estimados
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A chamada que abre a aplicação, antes de qualquer formulário ser escolhido.
 * Fica fora da lista abaixo porque acontece em outro momento e não depende de
 * escolha nenhuma.
 */
const CHAMADA_INICIAL = {
  metodo: 'GET',
  rota: "/query?q=SELECT … FROM SI_FormSpec__c WHERE RecordType.DeveloperName = 'Form'",
  peso: '0,3 KB',
  paraQue:
    'O catálogo: quais formulários existem e, para cada um, o objeto, o Record Type de destino, o Type do Caso e o canal. É ele que alimenta o seletor — e é dele que sai o DeveloperName que a chamada 01 recebe pronto.',
};

/**
 * Duas chamadas montam o formulário inteiro. Eram quatro.
 *
 * O que juntou três delas foi o catálogo acima: ele já devolve o DeveloperName
 * do Record Type de cada formulário. Com esse nome vindo pronto, a consulta do
 * Record Type deixa de depender do retorno da especificação e cabe no mesmo
 * composite. É palpite, não verdade — o servidor confere contra a especificação
 * antes de usar.
 */
const CHAMADAS = [
  {
    n: '01',
    metodo: 'POST',
    quando: 'ao escolher um formulário',
    titulo: 'A definição inteira, numa viagem',
    rota: '/services/data/v66.0/composite',
    peso: '209,4 KB',
    tempo: '298 ms',
    paraQue:
      'Trazer de uma vez a árvore do formulário, o Record Type onde o Caso vai nascer, quem controla cada picklist dependente e o metadado de todo campo do objeto — rótulo, tipo, tamanho, texto de ajuda e obrigatoriedade.',
    detalhe: [
      ['SI_FormSpec__c', 'a especificação: 38 linhas, WHERE (Id = :formId OR Form__c = :formId)', '48,7 KB'],
      ['RecordType', 'DeveloperName → Id', '0,3 KB'],
      ['FieldDefinition', 'picklist dependente → quem a controla', '0,3 KB'],
      ['EntityParticle', 'schema dos 397 campos criáveis de Case', '159,9 KB'],
    ],
    porqueAssim:
      'O schema substitui ui-api/object-info, que devolve todo campo com 36 atributos — 377,5 KB nesta org — e não aceita filtro de campo nem de coluna. EntityParticle é SOQL comum: escolhe as colunas e, por ser SOQL, cabe em composite junto das outras três.',
    alerta:
      'É /composite e NÃO /composite/batch. O batch devolve query cortada — done: false com parte dos registros — junto de um status 200: a especificação vinha com 1 dos 38 registros quando colocada depois do schema. Trinta e oito registros não chegam perto do limite de 2.000 do SOQL, então o corte é do batch, não da consulta. O /composite devolve tudo inteiro e ainda é mais rápido: 298 ms contra 499 ms.',
  },
  {
    n: '02',
    metodo: 'GET',
    quando: 'ao escolher um formulário',
    titulo: 'Valores de picklist',
    rota: '/services/data/v66.0/ui-api/object-info/Case/picklist-values/{recordTypeId}',
    peso: '260,4 KB',
    tempo: '1.212 ms',
    paraQue:
      'Os valores válidos de cada picklist NAQUELE Record Type, com validFor e controllerValues para filtrar campos dependentes em tempo de digitação.',
    detalhe: [['ui-api', 'picklist-values por Record Type', '260,4 KB']],
    porqueAssim:
      'É a única fonte que respeita Record Type e devolve dependências — describe, FieldDefinition, EntityParticle e PicklistValueInfo foram testados e nenhum fecha. E é a única que não entra no composite: o endpoint recusa recursos de ui-api com INVALID_BATCH_REQUEST.',
    alerta:
      'Sozinha, é 55% do peso e 80% do tempo do fluxo. Existe a versão por campo — mesma informação, 0,4 a 1,3 KB por campo, ~110 ms. Doze campos concorrentes trocariam 260 KB por ~12 KB. Medido; não aplicado.',
  },
];

/** Os seis papéis de linha em SI_FormSpec__c, discriminados por Record Type. */
const PAPEIS = [
  {
    rt: 'Form',
    o: 'a raiz',
    guarda: 'objeto e Record Type de destino, Type do Caso, canal, rótulo público, descrição',
    filhos: 'seções, listas e componentes soltos',
  },
  {
    rt: 'Section',
    o: 'agrupamento visual',
    guarda: 'nome e ordem; visibilidade própria via regras filhas',
    filhos: 'campos, textos e anexos',
  },
  {
    rt: 'RepeatingSection',
    o: 'lista repetível',
    guarda: 'objeto filho, campo de vínculo, mínimo e máximo de itens, rótulo do item',
    filhos: 'campos — que endereçam o objeto FILHO, não o Caso',
  },
  {
    rt: 'Field',
    o: 'um campo',
    guarda:
      'FieldApiName__c e as escolhas de formulário: obrigatório, oculto, largura, padrão, sobrescritas de rótulo e ajuda',
    filhos: 'regras',
  },
  {
    rt: 'Attachment',
    o: 'documento exigido',
    guarda: 'código do documento, tipos aceitos, mínimo/máximo de arquivos, tamanho',
    filhos: 'regras',
  },
  {
    rt: 'Content',
    o: 'bloco de texto',
    guarda: 'HTML em Body__c',
    filhos: 'regras',
  },
  {
    rt: 'Rule',
    o: 'uma condição',
    guarda: 'campo, operador, valor, origem do valor e EFEITO — filha do componente que afeta',
    filhos: '—',
  },
];

/** Os três efeitos de regra. Mesma máquina de filtros, três destinos. */
const EFEITOS = [
  {
    e: 'SHOW',
    vira: 'visibility',
    quando: 'as condições batem → o componente aparece',
    modo: 'FilterLogicType__c · aceita ALL, ANY e CUSTOM com expressão',
  },
  {
    e: 'REQUIRE',
    vira: 'requiredWhen',
    quando: 'as condições batem → o campo passa a ser exigido',
    modo: 'RequiredLogicType__c · ALL ou ANY',
  },
  {
    e: 'BLOCK',
    vira: 'validation',
    quando: 'as condições batem → o preenchimento está INVÁLIDO e o envio trava',
    modo: 'ValidationLogicType__c · ALL ou ANY · exige Message__c',
  },
];

/* ── O contrato, tipo a tipo ─────────────────────────────────────────────── */

const TIPO_CONTRATO = [
  [
    'source',
    "'FORM_SPEC'",
    'Qual adaptador produziu. O consumidor não deveria precisar olhar — existe para diagnóstico.',
  ],
  ['object', 'string', 'API name do objeto que o formulário cria. Hoje sempre Case.'],
  [
    'recordType',
    'RecordType | null',
    'Record Type de destino, já resolvido. null quando o DeveloperName não existe na org — vem com aviso.',
  ],
  [
    'sections',
    'Section[]',
    'A estrutura. Seções sem nenhum componente são removidas antes de sair.',
  ],
  [
    'attachments',
    'Attachments',
    'Agregado dos anexos, para validação. Os itens seguem posicionados dentro das seções.',
  ],
  [
    'backendFields',
    '{ [apiName]: string }',
    'Campos gravados pelo BFF, nunca renderizados nem aceitos do cliente.',
  ],
  [
    'formDefinition',
    'FormDefinition | null',
    'Identidade do formulário: id, rótulo público, canal, descrição.',
  ],
  [
    'diagnostics',
    'Diagnostics',
    'As chamadas feitas e os avisos. É o que alimenta o painel "De onde veio".',
  ],
];

const TIPO_SECTION = [
  ['id', 'string', 'Id do registro em SI_FormSpec__c. Estável entre carregamentos.'],
  [
    'label',
    'string | null',
    'Título. null na seção sintética que recolhe componentes soltos na raiz.',
  ],
  [
    'visibility',
    'Grupo | null',
    'Seção oculta esconde tudo dentro dela — inclusive os obrigatórios, que deixam de bloquear o envio.',
  ],
  ['repeating', 'boolean', 'true → é uma lista. Muda o que o envio faz com os campos.'],
  ['fields', 'Item[]', 'Campos, blocos de texto e anexos, na ordem de Sort__c.'],
];

const TIPO_LISTA = [
  ['childObject', 'string', 'API name do objeto de cada item. Ex.: CaseMember__c.'],
  [
    'childRelationshipField',
    'string',
    'O lookup do filho para o pai. É ele que recebe @{refPai.id} no composite.',
  ],
  ['itemLabel', 'string', 'Rótulo de cada item: "Titular 1", "Titular 2".'],
  ['addButtonText', 'string', 'Texto do botão de adicionar.'],
  [
    'minItems',
    'number | null',
    'Abaixo disso o envio é bloqueado, com o item nomeado na lista de pendências.',
  ],
  ['maxItems', 'number | null', 'Acima disso, idem.'],
];

const TIPO_FIELD = [
  ['apiName', 'string', 'API name do campo no SObject. Dentro de uma lista, no objeto FILHO.'],
  ['label', 'string', 'Rótulo do EntityParticle, salvo se LabelOverride__c disser outra coisa.'],
  [
    'dataType',
    'DataType',
    'Normalizado para o vocabulário do object-info — Picklist, String, Date… O EntityParticle devolve minúsculo.',
  ],
  [
    'required',
    'boolean',
    'Obrigatoriedade DESTE formulário, ou do objeto (IsNillable = false). O que vem do formulário vence.',
  ],
  ['readOnly', 'boolean', 'Marcado na especificação, ou herdado de IsCreatable = false.'],
  [
    'helpText',
    'string | null',
    'InlineHelpText do campo, salvo se HelpTextOverride__c disser outra coisa.',
  ],
  ['maxLength', 'number | null', 'Length do campo. Alimenta o maxlength do input.'],
  [
    'options',
    'Option[] | null',
    'Valores de picklist válidos no Record Type. null quando não é picklist.',
  ],
  [
    'controllerField',
    'string | null',
    'API name do campo que controla esta picklist dependente. Resolvido pelo DurableId.',
  ],
  ['controllerValues', 'object | null', 'Valor do controlador → índice usado em Option.validFor.'],
  [
    'width',
    "'FULL' | 'HALF' | 'THIRD'",
    'Largura na linha. A grade tem 6 colunas, o mínimo múltiplo comum de 2 e 3, para meio e um terço conviverem.',
  ],
  [
    'hidden',
    'boolean',
    'Não se desenha, mas vai no payload com o defaultValue. É como Type__c e MemberSource__c entram nos itens da lista.',
  ],
  [
    'defaultValue',
    'string | null',
    'Valor inicial. Em campo oculto, ele VENCE o que vier do cliente — é o ponto de ser oculto.',
  ],
  ['placeholder', 'string | null', 'Texto do campo vazio.'],
  ['visibility', 'Grupo | null', 'Regras SHOW.'],
  [
    'requiredWhen',
    'Grupo | null',
    'Regras REQUIRE. Grupo e lógica próprios: um campo pode aparecer sob uma condição e só ser exigido sob outra.',
  ],
  ['validation', 'Validation | null', 'Regras BLOCK.'],
];

const TIPO_GRUPO = [
  [
    'logic',
    "'ALL' | 'ANY' | 'CUSTOM'",
    'Como as condições se combinam. CUSTOM só existe em visibility.',
  ],
  [
    'expression',
    'string | null',
    'A expressão do modo CUSTOM: "1 AND (2 OR 3)". Os números são a Ordem de cada condição.',
  ],
  [
    'conditions',
    'Condition[]',
    'Os filtros, ordenados por Sort__c — é essa ordem que a expressão numera.',
  ],
];

const TIPO_CONDITION = [
  ['field', 'string', 'API name do campo OBSERVADO. Não precisa estar no formulário.'],
  [
    'operator',
    'Operator',
    'EQUALS, NOT_EQUALS, CONTAINS, NOT_CONTAINS, STARTS_WITH, GREATER_THAN, LESS_THAN, IS_NULL, IS_NOT_NULL.',
  ],
  ['value', 'string', 'O outro lado da comparação. O que ele significa depende de valueSource.'],
  [
    'valueSource',
    "'LITERAL' | 'FIELD' | 'TOKEN'",
    'LITERAL: o texto digitado. FIELD: value é o nome de outro campo — compara campo a campo. TOKEN: HOJE, HOJE+30, HOJE-7, AGORA.',
  ],
];

const TIPO_VALIDATION = [
  [
    'message',
    'string',
    'O que o usuário lê. Sem mensagem a regra é descartada com aviso, em vez de travar o envio em silêncio.',
  ],
  ['logic', "'ALL' | 'ANY'", 'Como as condições se combinam.'],
  [
    'conditions',
    'Condition[]',
    'A condição descreve quando está INVÁLIDO — é a semântica do Cognito, onde a expressão dispara a mensagem.',
  ],
];

const TIPO_ANEXO = [
  ['kind', "'attachment'", 'Discrimina o item dentro de fields[].'],
  [
    'code',
    'string | null',
    'Código do documento: DOC_FOTO, DOC_SELFIE. É por ele que o arquivo é etiquetado no envio.',
  ],
  ['required', 'boolean', 'Exigido.'],
  ['minFiles / maxFiles', 'number | null', 'Quantidade de arquivos.'],
  ['maxSizeMb', 'number | null', 'Tamanho por arquivo.'],
  ['acceptedTypes', 'string[]', 'Extensões aceitas, já separadas.'],
];

const TIPO_CONTENT = [
  ['kind', "'content'", 'Discrimina o item dentro de fields[].'],
  [
    'apiName',
    'string',
    '__content_{id}. Sintético: não existe campo por trás, mas o renderizador precisa de uma chave.',
  ],
  [
    'label',
    'string',
    'Nome interno do bloco. Serve à operação, não ao cliente — o que ele lê é o html.',
  ],
  ['html', 'string', 'O conteúdo. Vem de Body__c.'],
];

/* ══════════════════════════════════════════════════════════════════════════
   PÁGINA
   ══════════════════════════════════════════════════════════════════════════ */

export default function InfoCustom() {
  return (
    <div className="info info-custom">
      <Abertura />
      <Modelo />
      <Arquitetura />
      <Sequencia />
      <Chamadas />
      <Contrato />
      <Tradutor />
      <Envio />
      <Operacao />
      <Aberto />
    </div>
  );
}

function Secao({ id, titulo, chapeu, children }) {
  return (
    <section className="info-secao" id={id}>
      {chapeu && <div className="info-chapeu">{chapeu}</div>}
      <h2>{titulo}</h2>
      {children}
    </section>
  );
}

/* ── 1. Abertura ─────────────────────────────────────────────────────────── */

function Abertura() {
  return (
    <Secao titulo="Formulário como dado, não como metadado" chapeu="Solução Custom">
      <p>
        As outras três fontes leem uma estrutura que o Salesforce mantém para{' '}
        <em>outro propósito</em> — Page Layout existe para a tela interna, Screen Flow existe para
        ser executado. Cada uma esbarra num limite diferente: o layout não modela condição nem
        anexo, o flow não declara Record Type nem aceita obrigatoriedade por formulário.
      </p>
      <p>
        Aqui a estrutura existe <strong>para ser formulário</strong>. É um objeto customizado,{' '}
        <code>SI_FormSpec__c</code>, com Record Type dizendo o que cada linha é. Isso muda três
        coisas de uma vez:
      </p>
      <div className="cartoes">
        <Cartao titulo="É dado, não metadado">
          Criar um formulário é inserir registros. Não passa por deploy, não passa por engenharia,
          não espera janela de release. Quem opera edita no configurador e salva.
        </Cartao>
        <Cartao titulo="Cabe numa consulta">
          A árvore inteira sai de uma SOQL, porque toda linha aponta para a raiz. Sem composite, sem
          Apex REST, sem N+1.
        </Cartao>
        <Cartao titulo="Não tem teto">
          Condição, obrigatoriedade condicional, validação com mensagem, lista repetível, campo
          oculto, largura — nenhum depende do que o Salesforce quis modelar.
        </Cartao>
      </div>
      <p className="info-nota">
        O preço está do outro lado: é metadado <strong>nosso</strong>. Um objeto, um configurador e
        um adaptador que alguém passa a manter. As outras fontes cobram menos manutenção e entregam
        menos.
      </p>
    </Secao>
  );
}

function Cartao({ titulo, children }) {
  return (
    <div className="cartao">
      <strong>{titulo}</strong>
      <p>{children}</p>
    </div>
  );
}

/* ── 2. O modelo ─────────────────────────────────────────────────────────── */

function Modelo() {
  return (
    <Secao titulo="Uma tabela, sete papéis" chapeu="O modelo">
      <p>
        Tudo vive em <code>SI_FormSpec__c</code>. O Record Type discrimina o papel da linha, e{' '}
        <code>Parent__c</code> monta a árvore. <code>Form__c</code> aponta sempre para a raiz — é
        essa redundância que faz a consulta caber em um nível.
      </p>

      <div className="tabela-scroll">
        <table className="tab-papeis">
          <thead>
            <tr>
              <th>Record Type</th>
              <th>O que é</th>
              <th>O que guarda</th>
              <th>Filhos</th>
            </tr>
          </thead>
          <tbody>
            {PAPEIS.map((p) => (
              <tr key={p.rt}>
                <td>
                  <code className="rt">{p.rt}</code>
                </td>
                <td className="c-forte">{p.o}</td>
                <td className="celula-texto">{p.guarda}</td>
                <td className="celula-texto">{p.filhos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="aprofunda">
        <div className="aprofunda-head">O que a especificação NÃO guarda, de propósito</div>
        <p>
          Rótulo, tipo, tamanho e texto de ajuda do campo. Isso é metadado do campo e vem do schema
          em tempo de leitura. Duplicar aqui criaria uma segunda verdade, que diverge no dia em que
          alguém mexer no campo em Setup e ninguém lembrar de mexer aqui também.
        </p>
        <p>
          As sobrescritas existem — <code>LabelOverride__c</code> e <code>HelpTextOverride__c</code>{' '}
          — mas são exceção declarada, não a regra. Um rótulo de campo tem limite de 40 caracteres;
          várias perguntas do Cognito não cabem, e é para elas que a sobrescrita serve.
        </p>
      </div>

      <h3>Três efeitos, uma máquina de filtros</h3>
      <p>
        Uma <code>Rule</code> é filha do componente que ela afeta e carrega um efeito. O{' '}
        <em>modo</em> da lógica não fica na regra — fica no componente alvo, igual ao “Show
        component when” da FlexiPage. As regras são os filtros numerados, e o número é a{' '}
        <code>Sort__c</code> de cada uma.
      </p>
      <div className="tabela-scroll">
        <table className="tab-efeitos">
          <thead>
            <tr>
              <th>Effect__c</th>
              <th>Vira</th>
              <th>Quando as condições batem</th>
              <th>Onde fica o modo</th>
            </tr>
          </thead>
          <tbody>
            {EFEITOS.map((e) => (
              <tr key={e.e}>
                <td>
                  <code className={`efeito ef-${e.e.toLowerCase()}`}>{e.e}</code>
                </td>
                <td>
                  <code>{e.vira}</code>
                </td>
                <td className="celula-texto">{e.quando}</td>
                <td className="celula-texto">{e.modo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="info-nota">
        Grupos separados porque um campo pode <em>aparecer</em> sob uma condição e só ser{' '}
        <em>exigido</em> sob outra. Reaproveitar o mesmo grupo forçaria as duas a coincidirem.
      </p>
    </Secao>
  );
}

/* ── 3. Arquitetura ──────────────────────────────────────────────────────── */

function Arquitetura() {
  return (
    <Secao titulo="Onde cada peça entra" chapeu="Arquitetura">
      <svg
        className="diagrama"
        viewBox="0 0 900 330"
        role="img"
        aria-label="Canais consomem o BFF, que traduz SI_FormSpec__c para o contrato normalizado"
      >
        <defs>
          <marker id="c-seta" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 z" className="d-seta" />
          </marker>
        </defs>

        <text x="12" y="20" className="d-titulo">
          CANAIS
        </text>
        {['Magic Link', 'Site / App', 'Bot'].map((c, i) => (
          <g key={c}>
            <rect className="d-box" x="12" y={38 + i * 52} width="128" height="38" rx="5" />
            <text className="d-label" x="76" y={62 + i * 52} textAnchor="middle">
              {c}
            </text>
          </g>
        ))}
        <text className="d-nota" x="12" y="212">
          só conhecem o contrato
        </text>

        <line className="d-linha" x1="148" y1="115" x2="205" y2="115" markerEnd="url(#c-seta)" />

        <text x="212" y="20" className="d-titulo">
          BFF
        </text>
        <rect className="d-box d-destaque" x="212" y="38" width="200" height="194" rx="6" />
        <text className="d-sub" x="312" y="62" textAnchor="middle">
          contrato normalizado
        </text>
        {['sections[].fields[]', 'attachments', 'backendFields', 'diagnostics'].map((t, i) => (
          <g key={t}>
            <rect className="d-chip" x="230" y={76 + i * 38} width="164" height="28" rx="4" />
            <text className="d-mono" x="312" y={95 + i * 38} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}

        <line className="d-linha" x1="420" y1="115" x2="477" y2="115" markerEnd="url(#c-seta)" />

        <text x="484" y="20" className="d-titulo">
          ADAPTADOR
        </text>
        <rect className="d-box d-destaque" x="484" y="38" width="176" height="86" rx="5" />
        <text className="d-label" x="572" y="64" textAnchor="middle">
          FORM_SPEC
        </text>
        <text className="d-sub" x="572" y="84" textAnchor="middle">
          specToContract()
        </text>
        <text className="d-sub" x="572" y="102" textAnchor="middle">
          função pura, sem I/O
        </text>

        <rect className="d-box" x="484" y="146" width="176" height="86" rx="5" />
        <text className="d-label" x="572" y="172" textAnchor="middle">
          Avaliador de regras
        </text>
        <text className="d-sub" x="572" y="192" textAnchor="middle">
          isVisible · isRequired
        </text>
        <text className="d-sub" x="572" y="210" textAnchor="middle">
          validar
        </text>

        <line className="d-linha" x1="668" y1="81" x2="726" y2="110" markerEnd="url(#c-seta)" />

        <text x="734" y="20" className="d-titulo">
          SALESFORCE
        </text>
        <rect className="d-box" x="734" y="38" width="154" height="62" rx="5" />
        <text className="d-mono d-forte" x="811" y="64" textAnchor="middle">
          SI_FormSpec__c
        </text>
        <text className="d-sub" x="811" y="84" textAnchor="middle">
          a definição
        </text>

        <rect className="d-box" x="734" y="112" width="154" height="62" rx="5" />
        <text className="d-mono d-forte" x="811" y="138" textAnchor="middle">
          EntityParticle
        </text>
        <text className="d-sub" x="811" y="158" textAnchor="middle">
          o schema
        </text>

        <rect className="d-box" x="734" y="186" width="154" height="62" rx="5" />
        <text className="d-mono d-forte" x="811" y="212" textAnchor="middle">
          Case
        </text>
        <text className="d-sub" x="811" y="232" textAnchor="middle">
          o destino
        </text>

        <text className="d-rodape" x="12" y="292">
          O avaliador roda nos DOIS lados — no navegador a cada tecla, no servidor ao montar o
          payload.
        </text>
        <text className="d-rodape" x="12" y="312">
          É por isso que a tela e o envio nunca discordam sobre o que está oculto ou inválido.
        </text>
      </svg>
    </Secao>
  );
}

/* ── 4. Sequência ────────────────────────────────────────────────────────── */

/**
 * Diagrama de sequência em três raias.
 *
 * O que ele precisa deixar claro é a QUEBRA: o bloco 01 acontece uma vez, ao
 * abrir; os blocos 02–04 acontecem a cada formulário escolhido. Quem lê a lista
 * de chamadas sem isso conclui que são cinco chamadas por formulário.
 */
function Sequencia() {
  // Raias afastadas o bastante para as notas de custo caberem à DIREITA das
  // setas. Nota embaixo da seta encostava no rótulo da seta seguinte, e ficava
  // ambíguo a qual das duas ela pertencia.
  const RAIAS = [
    { x: 92, nome: 'Cliente', sub: 'navegador' },
    { x: 372, nome: 'BFF', sub: 'Node' },
    { x: 644, nome: 'Salesforce', sub: 'REST + UI API' },
  ];
  const NOTA_X = 700;

  const PASSOS = [
    { y: 148, de: 0, para: 1, txt: 'abre o link', tipo: 'ui' },
    {
      y: 180,
      de: 1,
      para: 2,
      txt: 'GET /query — o catálogo',
      tipo: 'get',
      nota: '0,3 KB',
    },
    { y: 212, de: 2, para: 1, txt: 'formulários + Record Type de cada um', tipo: 'volta' },
    { y: 236, de: 1, para: 0, txt: 'lista de formulários', tipo: 'ui' },

    { y: 304, de: 0, para: 1, txt: 'escolhe um  ·  manda o formId e o Record Type', tipo: 'ui' },
    {
      y: 344,
      de: 1,
      para: 2,
      txt: '01  POST /composite — 4 subrequisições',
      tipo: 'post',
      nota: '209,4 KB · 298 ms',
    },
    { y: 376, de: 2, para: 1, txt: 'especificação + Record Type + dependentes + schema', tipo: 'volta' },
    {
      y: 408,
      de: 1,
      para: 2,
      txt: '02  GET /ui-api/picklist-values',
      tipo: 'get',
      nota: '260,4 KB · 1.212 ms',
    },
    { y: 440, de: 2, para: 1, txt: 'valores válidos no Record Type', tipo: 'volta' },
    { y: 468, de: 1, para: 1, txt: 'specToContract()  ·  tradução, sem I/O', tipo: 'self' },
    { y: 494, de: 1, para: 0, txt: 'o contrato', tipo: 'ui' },

    { y: 568, de: 0, para: 0, txt: 'preenche  ·  o avaliador roda a cada tecla', tipo: 'self' },
    { y: 600, de: 0, para: 1, txt: 'envia', tipo: 'ui' },
    { y: 632, de: 1, para: 2, txt: 'POST /composite — Caso + filhos, allOrNone', tipo: 'post' },
    { y: 660, de: 2, para: 1, txt: 'Caso criado', tipo: 'volta' },
  ];

  const FASES = [
    { y: 100, h: 140, rotulo: 'AO ABRIR  ·  uma vez por sessão' },
    { y: 256, h: 256, rotulo: 'AO ESCOLHER UM FORMULÁRIO  ·  a cada troca no seletor' },
    { y: 520, h: 152, rotulo: 'AO ENVIAR' },
  ];

  return (
    <Secao titulo="O fluxo, do link ao Caso" chapeu="Sequência">
      <p>
        Ao abrir, uma consulta traz o catálogo — e com ele o Record Type de cada formulário. É esse
        detalhe que faz a montagem caber em <strong>duas chamadas</strong>: como o cliente já sabe
        o Record Type quando escolhe, a consulta dele não precisa esperar a especificação chegar, e
        entra no mesmo composite.
      </p>

      <svg
        className="diagrama diagrama-seq"
        viewBox="0 0 900 700"
        role="img"
        aria-label="Diagrama de sequência entre cliente, BFF e Salesforce"
      >
        <defs>
          <marker id="s-seta" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="d-seta" />
          </marker>
        </defs>

        {FASES.map((f) => (
          <g key={f.rotulo}>
            <rect className="fase" x="16" y={f.y} width="868" height={f.h} rx="6" />
            <text className="fase-rotulo" x="30" y={f.y + 17}>
              {f.rotulo}
            </text>
          </g>
        ))}

        {RAIAS.map((r) => (
          <g key={r.nome}>
            <rect className="d-box d-destaque" x={r.x - 74} y="24" width="148" height="46" rx="5" />
            <text className="d-label" x={r.x} y="44" textAnchor="middle">
              {r.nome}
            </text>
            <text className="d-sub" x={r.x} y="61" textAnchor="middle">
              {r.sub}
            </text>
            <line className="raia" x1={r.x} y1="74" x2={r.x} y2="684" />
          </g>
        ))}

        {PASSOS.map((p, i) => {
          const x1 = RAIAS[p.de].x;
          const x2 = RAIAS[p.para].x;

          if (p.de === p.para) {
            // Auto-chamada: um laço curto à direita da própria raia.
            return (
              <g key={i}>
                <path
                  className={`seta seta-${p.tipo}`}
                  d={`M${x1} ${p.y - 9} h30 v18 h-30`}
                  markerEnd="url(#s-seta)"
                />
                <text className="seta-txt" x={x1 + 40} y={p.y + 4}>
                  {p.txt}
                </text>
              </g>
            );
          }

          const meio = (x1 + x2) / 2;
          return (
            <g key={i}>
              <line
                className={`seta seta-${p.tipo}`}
                x1={x1}
                y1={p.y}
                x2={x2 + (x2 > x1 ? -8 : 8)}
                y2={p.y}
                markerEnd="url(#s-seta)"
              />
              <text className="seta-txt" x={meio} y={p.y - 8} textAnchor="middle">
                {p.txt}
              </text>
              {p.nota && (
                <text className="seta-nota" x={NOTA_X} y={p.y + 4}>
                  {p.nota}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="info-nota">
        A chamada 01 é a única que o cliente não espera duas vezes — e é justamente a que carrega o
        schema. Se ela fosse por formulário, o custo do fluxo dobraria a cada troca no seletor.
      </p>
    </Secao>
  );
}

/* ── 5. As chamadas em detalhe ───────────────────────────────────────────── */

function Chamadas() {
  const total = 470.0;

  return (
    <Secao titulo="Cada chamada, e para que serve" chapeu="As chamadas">
      <p>
        Medido na scratch org, pelo usuário de integração — é a permissão dele que vale em produção.
        Case tem <strong>397 campos criáveis</strong> nesta org.
      </p>

      <div className="chamada-inicial">
        <div className="ci-topo">
          <span className={`verbo verbo-${CHAMADA_INICIAL.metodo.toLowerCase()}`}>
            {CHAMADA_INICIAL.metodo}
          </span>
          <span className="ci-rot">Antes de tudo · uma vez, ao abrir</span>
          <span className="ci-peso">{CHAMADA_INICIAL.peso}</span>
        </div>
        <code className="ci-rota">{CHAMADA_INICIAL.rota}</code>
        <p>{CHAMADA_INICIAL.paraQue}</p>
      </div>

      <div className="chamadas">
        {CHAMADAS.map((c) => (
          <div className="chamada" key={c.n}>
            <div className="chamada-topo">
              <span className="chamada-n">{c.n}</span>
              <div className="chamada-ident">
                <div className="chamada-titulo">{c.titulo}</div>
                <div className="chamada-quando">{c.quando}</div>
              </div>
              <div className="chamada-custo">
                <span className={`verbo verbo-${c.metodo.toLowerCase()}`}>{c.metodo}</span>
                <span className="peso">{c.peso}</span>
                <span className="tempo">{c.tempo}</span>
              </div>
            </div>

            <code className="chamada-rota">{c.rota}</code>

            <div className="chamada-corpo">
              <div className="bloco">
                <span className="bloco-rot">Para que serve</span>
                <p>{c.paraQue}</p>
              </div>

              <div className="bloco">
                <span className="bloco-rot">O que volta</span>
                <table className="tab-sub">
                  <tbody>
                    {c.detalhe.map((d) => (
                      <tr key={d[0]}>
                        <td>
                          <code>{d[0]}</code>
                        </td>
                        <td className="celula-texto">{d[1]}</td>
                        <td className="num">{d[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bloco">
                <span className="bloco-rot">Por que assim</span>
                <p>{c.porqueAssim}</p>
              </div>

              {c.alerta && (
                <div className="bloco alerta">
                  <span className="bloco-rot">Otimização conhecida, não aplicada</span>
                  <p>{c.alerta}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="totalizador">
        <div>
          <span className="tot-n">2</span>
          <span className="tot-rot">chamadas</span>
        </div>
        <div>
          <span className="tot-n">470 KB</span>
          <span className="tot-rot">para montar um formulário</span>
        </div>
        <div>
          <span className="tot-n">~1,5 s</span>
          <span className="tot-rot">somando os tempos</span>
        </div>
        <p className="tot-obs">
          <strong>89% do peso é metadado do objeto</strong> — 159,9 KB de schema dos campos e
          260,4 KB de picklists. A definição do formulário em si custa 48,7 KB, e o Record Type
          mais as dependências somam 0,6 KB. O peso não está no formulário, está no objeto Case.
        </p>
      </div>

      <div className="barras">
        {[
          ['01 · especificação', 48.7],
          ['01 · Record Type + dependências', 0.6],
          ['01 · schema dos campos', 159.9],
          ['02 · picklists', 260.4],
        ].map(([rot, kb]) => (
          <div className="barra-linha" key={rot}>
            <span className="barra-rot">{rot}</span>
            <div className="barra">
              <span style={{ width: `${(kb / total) * 100}%` }} />
            </div>
            <span className="barra-num">
              {kb.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} KB
            </span>
          </div>
        ))}
      </div>
    </Secao>
  );
}

/* ── 6. O contrato ───────────────────────────────────────────────────────── */

function Tipo({ nome, resumo, linhas }) {
  return (
    <div className="vo">
      <div className="vo-head">
        <code className="vo-nome">{nome}</code>
        <span className="vo-resumo">{resumo}</span>
      </div>
      <table className="tab-vo">
        <tbody>
          {linhas.map(([campo, t, texto]) => (
            <tr key={campo}>
              <td className="c-campo">
                <code>{campo}</code>
              </td>
              <td className="c-tipo">
                <code>{t}</code>
              </td>
              <td className="celula-texto">{texto}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Contrato() {
  return (
    <Secao titulo="O contrato normalizado" chapeu="O artefato durável">
      <p>
        É o que o front, o bot e qualquer outro canal conhecem. A fonte no Salesforce é detalhe de
        implementação do adaptador: <strong>trocar a fonte não pode mudar este formato</strong>. As
        quatro fontes da POC produzem exatamente esta forma, e é por isso que o seletor de fonte na
        aba Demo não muda o formulário ao lado.
      </p>

      <Tipo nome="Contract" resumo="a raiz do que /api/form devolve" linhas={TIPO_CONTRATO} />
      <Tipo
        nome="Section"
        resumo="um agrupamento; a lista repetível é uma seção com repeating = true"
        linhas={TIPO_SECTION}
      />
      <Tipo
        nome="Section · quando repeating = true"
        resumo="os campos extras que só existem em lista"
        linhas={TIPO_LISTA}
      />
      <Tipo
        nome="Field"
        resumo="um campo — kind = 'field', o item mais comum de fields[]"
        linhas={TIPO_FIELD}
      />
      <Tipo
        nome="Grupo"
        resumo="a forma compartilhada por visibility e requiredWhen"
        linhas={TIPO_GRUPO}
      />
      <Tipo
        nome="Condition"
        resumo="um filtro — a unidade que todas as regras compartilham"
        linhas={TIPO_CONDITION}
      />
      <Tipo
        nome="Validation"
        resumo="um Grupo com mensagem; a condição descreve o INVÁLIDO"
        linhas={TIPO_VALIDATION}
      />
      <Tipo
        nome="Item · kind = 'attachment'"
        resumo="documento exigido, posicionado dentro da seção"
        linhas={TIPO_ANEXO}
      />
      <Tipo nome="Item · kind = 'content'" resumo="bloco de texto estático" linhas={TIPO_CONTENT} />

      <div className="aprofunda">
        <div className="aprofunda-head">Três detalhes que mordem quem reimplementar</div>
        <ul className="lista">
          <li>
            <code>fields[]</code> é heterogêneo. Contém campos, anexos e blocos de texto, e o{' '}
            <code>kind</code> discrimina. Quem iterar assumindo que tudo é campo vai tentar ler{' '}
            <code>dataType</code> de um bloco de texto. Campos sem <code>kind</code> são campos — é
            a compatibilidade com as fontes que não marcam.
          </li>
          <li>
            <code>attachments</code> é um <em>agregado</em>, não a lista de renderização. Os itens
            já estão dentro de <code>sections[].fields[]</code>, na posição em que a operação os
            colocou. O agregado existe só para o validador contar mínimos.
          </li>
          <li>
            <code>validation.conditions</code> é invertida em relação à intuição. A condição
            descreve <strong>quando está errado</strong>, não quando está certo. É a semântica do
            Cognito, e trocar isso quebraria a tradução de todas as 23 validações do corpus.
          </li>
        </ul>
      </div>

      <h3>A expressão CUSTOM não passa por eval</h3>
      <p>
        <code>logic: 'CUSTOM'</code> traz uma expressão como <code>1 AND (2 OR 3)</code>, onde os
        números são a ordem das condições. Ela é interpretada por um parser próprio,{' '}
        <strong>
          nunca por <code>eval</code>
        </strong>
        : a expressão vem de um registro que o time de operações edita, e executá-la como código
        seria injeção — com o agravante de que rodaria também no servidor, onde o avaliador é o
        mesmo.
      </p>
    </Secao>
  );
}

/* ── 7. O tradutor ao vivo ───────────────────────────────────────────────── */

/**
 * Converte, na tela, o retorno bruto do Salesforce no contrato.
 *
 * Não é uma simulação: chama `POST /api/traduzir`, que roda o MESMO
 * `specToContract` do adaptador. Editar o JSON da esquerda muda a direita.
 */
function Tradutor() {
  const [entrada, setEntrada] = useState(EXEMPLO_JSON);
  const [saida, setSaida] = useState('');
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      let corpo;
      try {
        corpo = JSON.parse(entrada);
      } catch (e) {
        if (vivo) {
          setErro(`JSON inválido: ${e.message}`);
          setSaida('');
        }
        return;
      }

      setCarregando(true);
      try {
        const r = await fetch('/api/traduzir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok) {
          setErro(j.error || `HTTP ${r.status}`);
          setSaida('');
        } else {
          setErro(null);
          setSaida(JSON.stringify(j, null, 2));
        }
      } catch (e) {
        if (vivo) {
          setErro(e.message);
          setSaida('');
        }
      } finally {
        if (vivo) setCarregando(false);
      }
    }, 400);

    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [entrada]);

  const resumo = useMemo(() => {
    if (!saida) return null;
    try {
      const c = JSON.parse(saida);
      const itens = c.sections.flatMap((s) => s.fields);
      const conta = (f) => itens.filter(f).length;
      return [
        ['seções', c.sections.length],
        ['campos', conta((i) => (i.kind ?? 'field') === 'field')],
        ['anexos', conta((i) => i.kind === 'attachment')],
        ['textos', conta((i) => i.kind === 'content')],
        ['listas', c.sections.filter((s) => s.repeating).length],
        [
          'condicionais',
          conta((i) => i.visibility) + c.sections.filter((s) => s.visibility).length,
        ],
        ['validações', conta((i) => i.validation)],
      ];
    } catch {
      return null;
    }
  }, [saida]);

  return (
    <Secao titulo="Do retorno do Salesforce ao contrato" chapeu="A tradução, ao vivo">
      <p>
        À esquerda, o que as chamadas devolvem — com a forma exata do retorno real, o{' '}
        <code>attributes</code> de cada linha de SOQL incluído, só que pequeno o bastante para caber
        na tela. À direita, o contrato. <strong>Edite a esquerda e a direita acompanha.</strong>
      </p>
      <p className="info-nota">
        Não é uma simulação: a página chama <code>POST /api/traduzir</code>, que executa o mesmo{' '}
        <code>specToContract()</code> do adaptador. Quem for reimplementar isso em outra linguagem
        pode colar o retorno da própria org aqui e usar a saída como oráculo.
      </p>

      <div className="tradutor">
        <div className="lado">
          <div className="lado-head">
            <span className="lado-tit">Entrada · o que o Salesforce devolve</span>
            <button className="btn-min" onClick={() => setEntrada(EXEMPLO_JSON)}>
              restaurar exemplo
            </button>
          </div>
          <textarea
            className="cod-edit"
            value={entrada}
            spellCheck={false}
            onChange={(e) => setEntrada(e.target.value)}
          />
          <div className="lado-pe">
            <code>spec</code>, <code>recordType</code>, <code>dependentes</code> e{' '}
            <code>schema</code> = as quatro subrequisições da chamada 01 ·{' '}
            <code>picklists</code> = chamada 02
          </div>
        </div>

        <div className="lado">
          <div className="lado-head">
            <span className="lado-tit">Saída · o contrato normalizado</span>
            {carregando && <span className="pulsa">traduzindo…</span>}
          </div>
          {erro ? (
            <div className="cod-erro">{erro}</div>
          ) : (
            <pre className="cod-saida">{saida || '…'}</pre>
          )}
          {resumo && (
            <div className="lado-pe resumo">
              {resumo.map(([r, n]) => (
                <span key={r}>
                  <strong>{n}</strong> {r}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="aprofunda">
        <div className="aprofunda-head">Coisas para experimentar</div>
        <ul className="lista">
          <li>
            Troque <code>Effect__c</code> da regra <code>a0xR2</code> de <code>REQUIRE</code> para{' '}
            <code>SHOW</code>: o CPF do parceiro deixa de ser exigido sob condição e passa a
            aparecer sob condição. Mesma regra, destino diferente.
          </li>
          <li>
            Apague o <code>Message__c</code> da linha <code>a0xF7</code>: a validação some e um
            aviso aparece em <code>diagnostics.warnings</code>. Regra sem mensagem é descartada em
            vez de travar o envio sem explicar por quê.
          </li>
          <li>
            Remova <code>ChildRelationshipField__c</code> da lista: ela é ignorada, com aviso. Sem o
            campo de vínculo não há como amarrar o item ao Caso, e criar órfãos seria pior que não
            criar.
          </li>
          <li>
            Apague a entrada de <code>dependentes</code>: <code>SI_BankType__c</code> perde o{' '}
            <code>controllerField</code>. É exatamente o vazio que a terceira subrequisição da
            chamada 01 preenche.
          </li>
        </ul>
      </div>
    </Secao>
  );
}

/* ── 8. O envio ──────────────────────────────────────────────────────────── */

function Envio() {
  return (
    <Secao titulo="Do preenchimento ao Caso" chapeu="O envio">
      <p>
        Sem lista repetível, o envio é um <code>POST</code> em <code>/sobjects/Case</code> e acabou.
        Com lista, não dá: o Caso ainda não existe quando o cliente preenche, então os itens não têm
        o Id do pai para gravar.
      </p>

      <svg
        className="diagrama"
        viewBox="0 0 900 300"
        role="img"
        aria-label="Composite com o Caso e os registros filhos numa transação"
      >
        <defs>
          <marker id="e-seta" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 z" className="d-seta" />
          </marker>
        </defs>

        <rect className="fase" x="16" y="14" width="868" height="252" rx="7" />
        <text className="fase-rotulo" x="32" y="36">
          POST /composite · allOrNone: true · UMA transação
        </text>

        <rect className="d-box d-destaque" x="48" y="58" width="230" height="76" rx="5" />
        <text className="d-mono d-forte" x="163" y="82" textAnchor="middle">
          referenceId: refPai
        </text>
        <text className="d-sub" x="163" y="102" textAnchor="middle">
          POST /sobjects/Case
        </text>
        <text className="d-sub" x="163" y="120" textAnchor="middle">
          campos visíveis + backendFields
        </text>

        <path className="d-linha" d="M278 96 h26 V151 h18" markerEnd="url(#e-seta)" />
        <path className="d-linha" d="M278 96 h26 V221 h18" markerEnd="url(#e-seta)" />

        <rect className="d-box" x="330" y="122" width="250" height="58" rx="5" />
        <text className="d-mono" x="455" y="144" textAnchor="middle">
          item1 · POST CaseMember__c
        </text>
        <text className="d-mono d-forte" x="455" y="164" textAnchor="middle">
          {'Case__c: "@{refPai.id}"'}
        </text>

        <rect className="d-box" x="330" y="192" width="250" height="58" rx="5" />
        <text className="d-mono" x="455" y="214" textAnchor="middle">
          item2 · POST CaseMember__c
        </text>
        <text className="d-mono d-forte" x="455" y="234" textAnchor="middle">
          {'Case__c: "@{refPai.id}"'}
        </text>

        <line className="d-linha" x1="278" y1="80" x2="628" y2="80" markerEnd="url(#e-seta)" />
        <rect className="d-box" x="636" y="58" width="216" height="58" rx="5" />
        <text className="d-mono" x="744" y="80" textAnchor="middle">
          registroCriado · GET
        </text>
        <text className="d-sub" x="744" y="99" textAnchor="middle">
          Id, CaseNumber, Status
        </text>

        <text className="d-rodape" x="48" y="286">
          O referenceId da primeira subrequisição vira @&#123;refPai.id&#125; nas seguintes —
          resolvido DENTRO da transação.
        </text>
      </svg>

      <div className="dois">
        <div className="aprofunda">
          <div className="aprofunda-head">Por que allOrNone</div>
          <p>
            Um Caso sem os membros que o justificam é pior que erro nenhum: a pessoa reenviaria e
            criaria um Caso duplicado, e a operação receberia dois pedidos para a mesma coisa — um
            deles incompleto, sem sinal de que está.
          </p>
        </div>
        <div className="aprofunda">
          <div className="aprofunda-head">O erro que o composite mostra não é o erro</div>
          <p>
            Quando o pai falha, cada filho reporta{' '}
            <em>“Could not find the referenced operation refPai”</em>. Quando um filho falha, o pai
            reporta <code>PROCESSING_HALTED</code>. Os dois são sintoma. O BFF procura a falha{' '}
            <strong>raiz</strong> — a subrequisição cujo erro não é nenhum desses — e é ela que
            chega ao cliente.
          </p>
        </div>
      </div>

      <h3>O que o cliente não decide</h3>
      <p>
        <code>backendFields</code> — hoje <code>RecordTypeId</code> e <code>Type</code> — é injetado
        pelo servidor a partir do catálogo, depois de montar o registro. Não é renderizado e não é
        aceito do cliente: quem escolheu o formulário já escolheu o Record Type e o Type do Caso, e
        perguntar de novo abriria espaço para o dado divergir do catálogo.
      </p>
      <p className="info-nota">
        Vale para os campos ocultos também. Em campo com <code>hidden: true</code>, o{' '}
        <code>defaultValue</code> da definição VENCE o que vier do cliente — é assim que{' '}
        <code>Type__c = Landlord</code> e <code>MemberSource__c = Cognito</code> entram em cada item
        da lista sem aparecer na tela.
      </p>
      <p className="info-nota aviso">
        O que ainda não está resolvido: <strong>upload de arquivo</strong>. Os anexos são
        etiquetados por código de documento — e, dentro de uma lista, por item — mas o envio da POC
        não cria <code>ContentVersion</code> nem roteia o arquivo para o registro filho. É a peça
        que falta entre o formulário funcionando e o formulário em produção.
      </p>
    </Secao>
  );
}

/* ── 9. A operação ───────────────────────────────────────────────────────── */

function Print({ src, alt, legenda }) {
  return (
    <figure className="print">
      <img src={src} alt={alt} loading="lazy" />
      <figcaption>{legenda}</figcaption>
    </figure>
  );
}

function Operacao() {
  return (
    <Secao titulo="Como um formulário nasce" chapeu="A operação">
      <p>
        O argumento inteiro depende disto: se cada formulário novo virar uma release de engenharia,
        a solução não escala. O configurador é uma LWC dentro do Salesforce, e o que ela edita são
        registros — nada aqui passa por deploy.
      </p>

      <Print
        src="/prints/builder-formulario.png"
        alt="O configurador SI Form Builder, com paleta de componentes à esquerda, o formulário no centro e as propriedades à direita"
        legenda="A paleta traz Seção, Lista, Anexo e Texto; abaixo, os campos do objeto, filtráveis. Arrastar um campo para dentro de uma seção cria a linha Field. As condições aparecem sob o componente que elas afetam — “visível se SI_RequesterType__c é igual a Parceiro” — e os campos ocultos da lista ficam marcados como tal."
      />

      <Print
        src="/prints/builder-propriedades.png"
        alt="Painel de propriedades de um campo, com visibilidade e obrigatoriedade condicional"
        legenda="As propriedades de um campo. O bloco cinza no topo diz o que NÃO se guarda aqui: rótulo, tipo e limites vêm do schema. Abaixo, os três grupos de filtro — visibilidade, obrigatoriedade e validação — cada um com sua lógica própria. “Valor digitado” é o seletor de valueSource: aqui se troca para outro campo ou para um token de data."
      />

      <h3>E o que sai disso</h3>
      <p>
        As quatro capturas seguintes são o mesmo formulário renderizado pelo contrato, sem uma linha
        de código específica para ele.
      </p>

      <div className="prints-grade">
        <Print
          src="/prints/form-condicional.png"
          alt="Seção condicional visível, com um campo exigido sob condição"
          legenda="Visibilidade e obrigatoriedade condicional. A seção só existe porque o solicitante é Parceiro; dentro dela, o CPF ganhou o asterisco pela mesma razão. A etiqueta amarela é da POC — mostra a regra que está agindo."
        />
        <Print
          src="/prints/form-validacao.png"
          alt="Campo com mensagem de validação bloqueando o envio"
          legenda="Validação customizada. A condição BLOCK bateu e a mensagem da regra apareceu. O envio fica travado enquanto ela estiver valendo — e a mesma avaliação roda de novo no servidor."
        />
        <Print
          src="/prints/form-lista.png"
          alt="Lista repetível com dois itens"
          legenda="Lista repetível. Cada item vira um CaseMember__c ligado ao Caso. O rótulo do item e o texto do botão vêm da definição; o mínimo e o máximo são validados no envio."
        />
        <Print
          src="/prints/form-anexos.png"
          alt="Documentos exigidos, cada um com código e tipos aceitos"
          legenda="Anexos como componente posicionado, não como bloco no fim. Cada um carrega o código do documento, os tipos aceitos e os limites — e pode ter condição própria, como qualquer outro."
        />
      </div>

      <h3>E o que o desenvolvedor vê</h3>
      <div className="prints-grade">
        <Print
          src="/prints/inspetor-chamadas.png"
          alt="Painel lateral listando as chamadas feitas ao Salesforce"
          legenda="O painel “De onde veio” lista cada chamada com verbo, rota e retorno. Não é enfeite: foi assim que descobrimos que object-info trazia 377 KB para um formulário de quinze campos."
        />
        <Print
          src="/prints/inspetor-payload.png"
          alt="O payload composite que seria enviado, com o Caso e um CaseMember filho"
          legenda="O payload montado. Dá para ver os backendFields injetados, o campo oculto ignorado, e o filho referenciando @{refPai.id} — tudo antes de qualquer coisa ser gravada."
        />
      </div>
    </Secao>
  );
}

/* ── 10. Em aberto ───────────────────────────────────────────────────────── */

function Aberto() {
  const itens = [
    {
      t: 'Upload de arquivo',
      d: 'Os anexos estão modelados e etiquetados, inclusive por item de lista, mas o envio não cria ContentVersion nem vincula ao registro. É o maior buraco entre a POC e produção.',
      p: 'bloqueia produção',
    },
    {
      t: 'Autenticação do cliente final',
      d: 'O BFF fala com a org como aplicação, via Client Credentials. Quem é a pessoa do outro lado, e o que ela pode abrir, não está resolvido — hoje qualquer um com o link vê qualquer formulário do catálogo.',
      p: 'bloqueia produção',
    },
    {
      t: 'Imagens no formulário',
      d: 'O bloco de texto aceita HTML, mas não há decisão sobre onde a imagem mora. ContentAsset com isVisibleByExternalUsers evita CDN externo e mantém tudo na org; um token {{asset:Nome}} em Body__c resolveria a referência na leitura.',
      p: 'decisão pendente',
    },
    {
      t: 'Modelagem do objeto de itens',
      d: 'CaseMember__c é magro: tem nome e um identificador externo, mas não CPF próprio, telefone nem endereço — o CPF foi para ExternalId__c. E Case__c é lookup opcional, sem cascata: apagar o Caso deixa órfãos.',
      p: 'do dono do objeto',
    },
    {
      t: 'Cache do catálogo e do schema',
      d: 'A chamada 01 sai a cada abertura, e o schema de Case muda raramente. Um cache com invalidação por deploy tiraria 160 KB do caminho quente sem mudar o contrato.',
      p: 'otimização',
    },
    {
      t: 'Picklist por campo',
      d: 'Medido: 0,4 a 1,3 KB por campo contra 260,4 KB da chamada completa. Troca uma requisição grande por N pequenas concorrentes. Vale para todas as fontes.',
      p: 'otimização',
    },
    {
      t: 'Enforcement do lado Salesforce',
      d: 'Hoje a obrigatoriedade e a validação por formulário são verificadas no BFF. Nada impede uma integração de criar um Caso ignorando tudo — a regra vive no formulário, não no objeto.',
      p: 'risco aceito',
    },
  ];

  return (
    <Secao titulo="O que continua em aberto" chapeu="Honestidade">
      <p>
        A POC funciona de ponta a ponta contra uma org real — o Caso <strong>00001022</strong>{' '}
        nasceu por ela, com dois <code>CaseMember__c</code> ligados, os campos ocultos preenchidos
        pela definição e o Type vindo do catálogo. O que segue são as decisões que ela não tomou.
      </p>
      <div className="abertos">
        {itens.map((i) => (
          <div className="aberto" key={i.t}>
            <div className="aberto-topo">
              <strong>{i.t}</strong>
              <span className={`pri pri-${i.p.split(' ')[0]}`}>{i.p}</span>
            </div>
            <p>{i.d}</p>
          </div>
        ))}
      </div>
    </Secao>
  );
}
