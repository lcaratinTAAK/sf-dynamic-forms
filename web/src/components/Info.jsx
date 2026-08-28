/**
 * Página de Informações.
 *
 * Não é documentação decorativa: tudo aqui foi medido ou verificado contra a
 * org, e os números batem com o que o inspetor mostra ao lado da demo. Onde
 * algo NÃO foi verificado, está dito.
 */

import '../info.css';

/**
 * Níveis de atendimento.
 *
 * A distinção que importa não é "atende / não atende" — é O QUE CUSTOU atender.
 * NATIVO sai de graça do Salesforce; CONSTRUIDO exige metadado que a gente
 * criou e passa a manter.
 */
const NATIVO = 'nativo';
const CONSTRUIDO = 'construido';
const PARCIAL = 'parcial';
const NAO = 'nao';

/**
 * Requisitos que uma solução de formulário dinâmico precisa atender, e como
 * cada uma das duas implementações da POC resolve — não "o que o Salesforce
 * entrega de graça", mas o que está de pé e funcionando na demo ao lado.
 */
const REQUISITOS = [
  {
    n: 1,
    titulo: 'Listar os formulários disponíveis',
    detalhe:
      'O consumidor precisa saber o que pode abrir. As duas resolvem, por caminhos diferentes — e a diferença tem consequência.',
    uiapi: {
      nivel: CONSTRUIDO,
      via: 'permission set + object-info',
      texto:
        'Os Record Types são liberados por permission set, e o object-info devolve recordTypeInfos[].available já filtrado pelo profile do usuário autenticado. O BFF lista só os available. Quem controla o catálogo é a permissão — não há objeto de catálogo.',
    },
    flow: {
      nivel: CONSTRUIDO,
      via: 'FormDefinition__c',
      texto:
        'A Tooling lista os 44 flows ativos da org, inclusive os que não são formulário — não serve de catálogo. Uma query no objeto customizado resolve: só o que está lá, e ativo, aparece.',
    },
    nota:
      'A UI API amarra a identidade do formulário ao Record Type: dois canais com o mesmo formulário exigem dois Record Types. O catálogo separa as duas coisas.',
  },
  {
    n: 2,
    titulo: 'Vincular o formulário ao Record Type',
    detalhe:
      'O Record Type decide quais valores de picklist são válidos e em que tipo o registro nasce. Sem ele não há formulário nem caso.',
    uiapi: {
      nivel: NATIVO,
      via: 'é o próprio eixo da UI API',
      texto:
        'O layout já vem resolvido por Record Type + profile. Não há o que amarrar: o Record Type É a seleção.',
    },
    flow: {
      nivel: CONSTRUIDO,
      via: 'FormDefinition__c.RecordTypeDevName__c',
      texto:
        'O Flow NÃO declara Record Type em lugar nenhum do metadado — verificado no payload da Tooling. Era isso que obrigava a tela a ter dois seletores; o catálogo guarda o par e sobrou um seletor só.',
    },
  },
  {
    n: 3,
    titulo: 'Vincular o formulário ao Type do Case',
    detalhe:
      'Quem escolheu o formulário já escolheu o Type. Perguntar de novo abre espaço para o dado divergir.',
    uiapi: {
      nivel: NAO,
      via: null,
      texto:
        'Não implementado nesta versão. Type é um campo como outro qualquer, e o layout não sabe que ele é fixo para aquele formulário — hoje ele iria como pergunta ou não iria.',
    },
    flow: {
      nivel: CONSTRUIDO,
      via: 'FormDefinition__c.CaseType__c',
      texto:
        'O BFF injeta Type no payload sem renderizar campo nenhum. Verificado ponta a ponta: o caso 00001021 nasceu com Type = BankDataChange.',
    },
  },
  {
    n: 4,
    titulo: 'Descrever o schema: campos, tipos, labels, ajuda',
    detalhe:
      'O front precisa saber que SI_BankBranch__c é texto e SI_BankType__c é picklist, para escolher o componente certo.',
    uiapi: {
      nivel: NATIVO,
      via: 'object-info',
      texto:
        'Vem do object-info (517 KB). O layout sozinho NÃO serve: é puramente estrutural — zero ocorrências de dataType, type ou length no retorno.',
    },
    flow: {
      nivel: NATIVO,
      via: 'object-info',
      texto:
        'O Flow guarda só o ponteiro (objectFieldReference: "Case1.SI_BankType__c"). Tipo, label e tamanho vêm do mesmo object-info — a chamada é idêntica.',
    },
  },
  {
    n: 5,
    titulo: 'Descrever as picklists por Record Type, com dependências',
    detalhe:
      'Valores válidos mudam por Record Type, e campos dependentes precisam de controllerValues e validFor para filtrar em tempo de digitação.',
    uiapi: {
      nivel: NATIVO,
      via: 'picklist-values',
      texto:
        'É a ÚNICA chamada que respeita Record Type e devolve as dependências. Testamos describe, FieldDefinition, EntityParticle e PicklistValueInfo — nenhuma fecha.',
    },
    flow: {
      nivel: NATIVO,
      via: 'picklist-values',
      texto:
        'A mesma chamada, com o Record Type vindo do catálogo. Sem o item 02 resolvido, esta chamada não teria como ser montada.',
    },
  },
  {
    n: 6,
    titulo: 'Definir a estrutura: seções, ordem e quais campos',
    detalhe: 'O que o usuário vê, agrupado e na sequência certa.',
    uiapi: {
      nivel: NATIVO,
      via: 'Page Layout',
      texto: 'sections → layoutRows → layoutItems, já na ordem em que o admin montou.',
    },
    flow: {
      nivel: PARCIAL,
      via: 'screens + conectores',
      texto:
        'screens[] volta em ordem ARBITRÁRIA. A sequência real está nos conectores (start.connector → screen.connector) e o adaptador percorre a cadeia. Telas fora da cadeia principal geram aviso, porque a ordem delas não é confiável.',
    },
  },
  {
    n: 7,
    titulo: 'Obrigatoriedade por formulário',
    detalhe:
      'Diferente da obrigatoriedade do objeto: o mesmo campo pode ser exigido num formulário e opcional noutro.',
    uiapi: {
      nivel: NATIVO,
      via: 'layoutItems[].required',
      texto: 'É por layout, e portanto por formulário. Sai de graça.',
    },
    flow: {
      nivel: NAO,
      via: null,
      texto:
        'Dá para marcar campo como obrigatório num Screen Flow — mas não um campo VINCULADO ao objeto. Os dois recursos são mutuamente exclusivos, e o detalhe está logo abaixo da tabela.',
    },
  },
  {
    n: 8,
    titulo: 'Regras de visibilidade condicional',
    detalhe: 'Mostrar "CPF do parceiro" só quando o solicitante for Parceiro.',
    uiapi: {
      nivel: CONSTRUIDO,
      via: 'FormFieldRule__c',
      texto:
        'O Page Layout não modela condição, e o retorno da UI API não é extensível. Um objeto de regras devolve alvo, campo condicionante, operador e valor; o avaliador roda no mesmo código no servidor e no navegador.',
    },
    flow: {
      nivel: NATIVO,
      via: 'visibilityRule',
      texto: 'Nativa no metadado do Flow, com conditionLogic e operadores, campo a campo.',
    },
  },
  {
    n: 9,
    titulo: 'Política de anexos: exige? quantos? quais documentos?',
    detalhe:
      'O formulário do Cognito pede documento com foto, selfie e comprovante — a lista muda por tipo de solicitação.',
    uiapi: {
      nivel: CONSTRUIDO,
      via: 'FormRequiredDocuments__c',
      texto:
        'Não existe conceito de anexo no Page Layout. Um campo picklist resolve sem chamada extra: a PRESENÇA dele no layout sinaliza a exigência, e os valores habilitados por Record Type listam os documentos.',
    },
    flow: {
      nivel: NATIVO,
      via: 'forceContent:fileUpload',
      texto: 'Componente nativo com isRequired, e o label descreve o documento pedido.',
    },
  },
  {
    n: 10,
    titulo: 'Governança: quem edita, e sem deploy',
    detalhe: 'Se cada formulário novo virar uma release de engenharia, a solução não escala.',
    uiapi: {
      nivel: NATIVO,
      via: 'Setup + registros',
      texto:
        'Admin edita o Page Layout no Setup. Regras e documentos exigidos são REGISTROS — Ops mexe sem deploy.',
    },
    flow: {
      nivel: PARCIAL,
      via: 'Flow Builder + registros',
      texto:
        'Admin edita no Flow Builder, e o catálogo é registro. Mas publicar cria uma versão nova: o catálogo precisa apontar por ApiName e resolver a versão ativa a cada chamada, senão serve estrutura velha em silêncio.',
    },
  },
  {
    n: 11,
    titulo: 'Superfície de permissão do usuário de integração',
    detalhe: 'É um usuário que serve formulário para cliente final. Quanto menos ele enxergar, melhor.',
    uiapi: {
      nivel: NATIVO,
      via: 'só FLS',
      texto: 'FLS dos campos e visibilidade do Record Type. Nada de Setup.',
    },
    flow: {
      nivel: PARCIAL,
      via: 'FLS + 3 permissões de Setup',
      texto:
        'Ler Flow pela Tooling exige ViewSetup + ViewRoles + ViewAllNonSetupFlows. Com isso o usuário passa a enxergar TODOS os 44 flows da org, não só os do formulário.',
    },
  },
];

/** Custos medidos na scratch, pelo usuário de integração. */
const CUSTOS = [
  { fonte: 'UI API', chamadas: 5, kb: 859.7, obs: 'object-info 517 + picklists 333 = 99% do total' },
  { fonte: 'Screen Flow', chamadas: 5, kb: 968.2, obs: 'catálogo 2× 40 + flow 38 + as mesmas 850 da UI API' },
];

const CHAMADAS = {
  uiapi: [
    ['ui-api', 'object-info/Case', '517 KB', 'tipos, labels e a lista de Record Types'],
    ['ui-api', 'layout/Case?recordTypeId&mode=Create', '7,6 KB', 'seções, ordem e obrigatoriedade'],
    ['ui-api', 'object-info/Case/picklist-values/{rt}', '333 KB', 'valores válidos e dependências'],
    ['soql', 'RecordType', '0,2 KB', 'DeveloperName, que a UI API não devolve'],
    ['soql', 'FormFieldRule__c', '1,5 KB', 'regras de visibilidade'],
  ],
  flow: [
    ['batch', 'FormDefinition__c + FlowDefinitionView + RecordType', '40 KB', 'lista o catálogo e alimenta o seletor'],
    ['batch', 'idem, com AND Id = {formulário}', '40 KB', 'resolve o formulário escolhido'],
    ['tooling', 'sobjects/Flow/{versão ativa}', '38 KB', 'estrutura, visibilidade e anexo'],
    ['ui-api', 'object-info/Case', '517 KB', 'tipos e labels — o Flow só tem o ponteiro'],
    ['ui-api', 'object-info/Case/picklist-values/{rt}', '333 KB', 'valores válidos e dependências'],
  ],
};

const ROTULO = {
  [NATIVO]: 'nativo',
  [CONSTRUIDO]: 'construído',
  [PARCIAL]: 'com ressalva',
  [NAO]: 'não atende',
};

export default function Info() {
  return (
    <div className="info">
      <Cabecalho />
      <Arquitetura />
      <Requisitos />
      <Fluxos />
      <Custos />
      <Armadilhas />
      <Veredito />
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

function Cabecalho() {
  return (
    <Secao titulo="O que esta POC está avaliando" chapeu="Contexto">
      <p>
        A pergunta não é “dá para renderizar um formulário a partir do Salesforce” — dá, das duas
        formas, e as duas estão de pé na aba Demo. É <strong>qual delas sustenta o catálogo inteiro
        de solicitações</strong> sem virar release de engenharia a cada formulário novo.
      </p>
      <p>
        Abaixo estão os 11 requisitos que a solução precisa atender e como cada uma resolve cada
        um — o que ela ganha do Salesforce e o que precisou ser construído. Tudo foi medido ou
        verificado contra a scratch org, pelo usuário de integração: é ele quem vai fazer as
        chamadas em produção, então é a permissão dele que vale.
      </p>
      <p>
        O comparativo é entre <strong>UI API (Page Layout)</strong> e{' '}
        <strong>Screen Flow (Tooling)</strong>. A terceira variante da demo, a UI API v2, foi um
        caminho de orquestração testado e descartado — aparece só como nota no custo.
      </p>
      <p className="info-nota">
        As duas fontes compartilham o mesmo <strong>contrato normalizado</strong>. É ele o artefato
        durável: o front, o bot e qualquer outro canal conhecem só esse formato. Trocar a fonte no
        Salesforce não pode mudá-lo.
      </p>
    </Secao>
  );
}

function Arquitetura() {
  return (
    <Secao titulo="Onde cada peça entra" chapeu="Arquitetura">
      <svg className="diagrama" viewBox="0 0 900 300" role="img" aria-label="Canais consomem o BFF, que traduz as fontes do Salesforce para um contrato normalizado">
        <defs>
          <marker id="seta" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 z" className="d-seta" />
          </marker>
        </defs>

        <text x="12" y="20" className="d-titulo">CANAIS</text>
        {['Magic Link', 'Site / App', 'Bot'].map((c, i) => (
          <g key={c}>
            <rect className="d-box" x="12" y={38 + i * 52} width="130" height="38" rx="5" />
            <text className="d-label" x="77" y={62 + i * 52} textAnchor="middle">{c}</text>
          </g>
        ))}

        <line className="d-linha" x1="150" y1="115" x2="215" y2="115" markerEnd="url(#seta)" />

        <rect className="d-box d-destaque" x="222" y="38" width="196" height="194" rx="6" />
        <text className="d-titulo" x="320" y="62" textAnchor="middle">BFF</text>
        <text className="d-sub" x="320" y="84" textAnchor="middle">contrato normalizado</text>
        <rect className="d-chip" x="242" y="100" width="156" height="30" rx="4" />
        <text className="d-mono" x="320" y="120" textAnchor="middle">sections[].fields[]</text>
        <rect className="d-chip" x="242" y="138" width="156" height="30" rx="4" />
        <text className="d-mono" x="320" y="158" textAnchor="middle">attachments</text>
        <rect className="d-chip" x="242" y="176" width="156" height="30" rx="4" />
        <text className="d-mono" x="320" y="196" textAnchor="middle">backendFields</text>

        <line className="d-linha" x1="426" y1="115" x2="491" y2="115" markerEnd="url(#seta)" />

        <text x="498" y="20" className="d-titulo">ADAPTADORES</text>
        <rect className="d-box" x="498" y="38" width="150" height="84" rx="5" />
        <text className="d-label" x="573" y="62" textAnchor="middle">UI API</text>
        <text className="d-sub" x="573" y="82" textAnchor="middle">Page Layout</text>
        <text className="d-sub" x="573" y="100" textAnchor="middle">+ FormFieldRule__c</text>

        <rect className="d-box" x="498" y="134" width="150" height="84" rx="5" />
        <text className="d-label" x="573" y="158" textAnchor="middle">Screen Flow</text>
        <text className="d-sub" x="573" y="178" textAnchor="middle">Tooling API</text>
        <text className="d-sub" x="573" y="196" textAnchor="middle">+ FormDefinition__c</text>

        <line className="d-linha" x1="656" y1="80" x2="716" y2="110" markerEnd="url(#seta)" />
        <line className="d-linha" x1="656" y1="176" x2="716" y2="146" markerEnd="url(#seta)" />

        <rect className="d-box" x="723" y="90" width="160" height="76" rx="5" />
        <text className="d-label" x="803" y="122" textAnchor="middle">Salesforce</text>
        <text className="d-sub" x="803" y="142" textAnchor="middle">scratch / forno / prod</text>

        <text className="d-rodape" x="12" y="272">
          Só a coluna dos adaptadores muda entre as fontes. O contrato e os canais não sabem de onde veio.
        </text>
      </svg>
    </Secao>
  );
}

function Requisitos() {
  return (
    <Secao titulo="Requisitos, e como cada fonte responde" chapeu="O comparativo">
      <p>
        Quase tudo é atendido pelas duas. O que separa uma da outra não é a lista de “sim” — é{' '}
        <strong>o que cada uma obrigou a construir</strong> para chegar lá. Por isso os selos
        distinguem <span className="selo nativo em-linha">nativo</span> de{' '}
        <span className="selo construido em-linha">construído</span>: o segundo funciona igual, mas
        é metadado nosso, que alguém passa a manter.
      </p>

      <div className="tabela-scroll">
        <table className="tab-req">
          <thead>
            <tr>
              <th className="c-req">Requisito</th>
              <th>UI API · Page Layout</th>
              <th>Screen Flow · Tooling</th>
            </tr>
          </thead>
          <tbody>
            {REQUISITOS.map((r) => (
              <tr key={r.n}>
                <td className="c-req">
                  <div className="req-titulo">
                    <span className="req-n">{String(r.n).padStart(2, '0')}</span>
                    {r.titulo}
                  </div>
                  <div className="req-detalhe">{r.detalhe}</div>
                  {r.nota && <div className="req-nota">{r.nota}</div>}
                </td>
                <Celula dado={r.uiapi} />
                <Celula dado={r.flow} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="info-nota">
        As lacunas são <strong>complementares</strong>, e é o achado central: a UI API não modela
        condição nem anexo — precisou de dois objetos. O Screen Flow entrega os dois de graça, mas
        não sabe em que Record Type o caso nasce — precisou de um. E{' '}
        <strong>nenhuma das duas lista formulários sozinha</strong>: uma delega à permissão, a
        outra a um objeto.
      </p>

      <ObrigatoriedadeNoFlow />
    </Secao>
  );
}

/**
 * O item 07 é o único da lista que não tem contorno, e a razão não é óbvia —
 * por isso ganha espaço próprio, com as mensagens de erro que o Salesforce
 * devolveu no deploy.
 */
function ObrigatoriedadeNoFlow() {
  return (
    <div className="aprofunda">
      <div className="aprofunda-head">
        Por que não dá para marcar um campo como obrigatório no Screen Flow
      </div>

      <p>
        Dá — só não no campo que interessa. Uma tela de Flow tem dois tipos de componente de
        entrada, e cada um entrega metade do que precisamos:
      </p>

      <div className="dois-tipos">
        <div className="tipo">
          <code>ObjectProvided</code>
          <span className="tipo-sub">“Record Field” no Flow Builder</span>
          <ul>
            <li className="ok">
              vincula direto ao campo: <code>Case1.SI_FullName__c</code>
            </li>
            <li className="nao">recusa <code>isRequired</code></li>
            <li className="nao">recusa <code>validationRule</code></li>
          </ul>
        </div>
        <div className="tipo">
          <code>InputField</code>
          <span className="tipo-sub">componente de entrada comum</span>
          <ul>
            <li className="ok">
              aceita <code>isRequired</code> — 27 campos usam assim nesta org
            </li>
            <li className="ok">aceita <code>validationRule</code></li>
            <li className="nao">não vincula a campo nenhum do objeto</li>
          </ul>
        </div>
      </div>

      <p>
        As duas chaves <em>existem</em> na estrutura do <code>ObjectProvided</code> — voltam como{' '}
        <code>false</code> e <code>null</code> na Tooling, o que dá a impressão de que bastaria
        preencher. O deploy é quem recusa:
      </p>

      <pre className="erro-deploy">
{`You can't set isRequired to TRUE for a FlowScreenField with a type
of ObjectProvided. Remove the isRequired field from the FlowScreenField
with the "Case1.SI_FullName__c" objectFieldReference.

A screen field of type ObjectProvided can't validate user input.
Remove the validationRule field from the screen field with
objectFieldReference "Case1.SI_FullName__c".`}
      </pre>

      <p>
        Verificado em 20 flows ativos da org: <strong>zero</strong> <code>InputField</code> com{' '}
        <code>objectFieldReference</code>, em 57 encontrados. Não é convenção — é exclusão mútua.
      </p>

      <p>
        Restam dois contornos, e nenhum resolve o requisito:
      </p>
      <ul className="lista">
        <li>
          <strong>Tornar o campo obrigatório no objeto.</strong> O Record Field herda. Mas aí ele
          fica obrigatório em <em>todos</em> os formulários e em toda integração que criar Case —
          é o oposto de obrigatoriedade por formulário.
        </li>
        <li>
          <strong>Usar InputField e mapear na lógica do flow</strong>, com um Assignment antes do
          Create Records. Funciona para quem <em>executa</em> o flow — mas o mapeamento vive nos
          elementos de lógica, não na definição da tela. Quem lê a tela pela Tooling, como o BFF
          faz, não enxerga em que campo aquilo grava.
        </li>
      </ul>

      <p className="info-nota">
        Por isso o item 07 fica em <span className="selo nao em-linha">não atende</span>: existe
        obrigatoriedade no Screen Flow, mas não convive com o vínculo ao campo — e é justamente o
        vínculo que torna o Flow legível como fonte de formulário.
      </p>
    </div>
  );
}

function Celula({ dado }) {
  return (
    <td>
      <span className={`selo ${dado.nivel}`}>{ROTULO[dado.nivel]}</span>
      {dado.via && <span className="celula-via">{dado.via}</span>}
      <div className="celula-texto">{dado.texto}</div>
    </td>
  );
}

function Fluxos() {
  return (
    <Secao titulo="As chamadas, na ordem" chapeu="Fluxo">
      <div className="fluxos">
        <Fluxo titulo="UI API" chamadas={CHAMADAS.uiapi} total="859,7 KB" />
        <Fluxo titulo="Screen Flow" chamadas={CHAMADAS.flow} total="968,2 KB" />
      </div>
      <p className="info-nota">
        As duas terminam nas <strong>mesmas duas chamadas de ui-api</strong> — 850 KB de schema e
        picklists. É por isso que a diferença de custo entre elas é pequena: o peso não está na
        estrutura do formulário, está no schema do objeto Case.
      </p>
    </Secao>
  );
}

function Fluxo({ titulo, chamadas, total }) {
  return (
    <div className="fluxo">
      <div className="fluxo-head">
        <strong>{titulo}</strong>
        <span>{chamadas.length} chamadas · {total}</span>
      </div>
      <ol className="fluxo-passos">
        {chamadas.map(([tipo, alvo, peso, porque], i) => (
          <li key={i}>
            <div className="passo-topo">
              <span className={`tag ${tipo}`}>{tipo}</span>
              <span className="passo-peso">{peso}</span>
            </div>
            <div className="passo-alvo">{alvo}</div>
            <div className="passo-porque">{porque}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Custos() {
  const maior = Math.max(...CUSTOS.map((c) => c.kb));

  return (
    <Secao titulo="Custo medido de montar um formulário" chapeu="Números">
      <table className="tab-custo">
        <thead>
          <tr>
            <th>Fonte</th>
            <th className="num">Chamadas</th>
            <th className="num">Payload</th>
            <th>Onde está o peso</th>
          </tr>
        </thead>
        <tbody>
          {CUSTOS.map((c) => (
            <tr key={c.fonte}>
              <td>{c.fonte}</td>
              <td className="num">{c.chamadas}</td>
              <td className="num">
                <div className="barra">
                  <span style={{ width: `${(c.kb / maior) * 100}%` }} />
                </div>
                {c.kb.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} KB
              </td>
              <td className="celula-texto">{c.obs}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="info-nota">
        Medido na scratch, pelo usuário de integração, somando cada chamada individualmente. A
        diferença de 108 KB é o catálogo e o metadado do flow — <strong>ruído perto das 850 KB que
        as duas gastam igual</strong> em schema e picklists. Custo não decide esta escolha.
      </p>
      <p className="info-nota">
        Otimização conhecida e <strong>não aplicada</strong>: o endpoint de picklist por campo
        devolve o mesmo conteúdo em 6 KB / 264 ms, contra 333 KB / 1.400 ms da chamada completa.
        Troca 333 KB por 12 requisições concorrentes, e vale para as duas fontes.
      </p>
      <p className="info-nota">
        Existe uma terceira variante na demo (<strong>UI API v2</strong>), que troca a descoberta
        por SOQL e o layout pelo <code>record-defaults/create</code>. Ficou de fora deste
        comparativo: gasta 987 KB para fazer menos chamadas, porque o{' '}
        <code>record-defaults</code> devolve o objeto inteiro — 652 campos — para um formulário de
        15. Caminho testado e descartado.
      </p>
    </Secao>
  );
}

function Armadilhas() {
  const itens = [
    {
      t: 'Id de versão de flow serve definição obsoleta em silêncio',
      d: 'Cada publicação cria uma versão nova e aposenta a anterior — mas o Id antigo continua respondendo 200, com a estrutura velha. Por isso o catálogo guarda ApiName, não Id, e resolve pela FlowDefinitionView.ActiveVersionId a cada chamada.',
    },
    {
      t: 'A Tooling entra no composite/batch e volta sem os campos',
      d: 'Devolve 200 e o totalSize correto, mas cada registro vem só com attributes. Verificado em Flow e FlexiPage, com RecordType como controle na mesma requisição. Por isso as três queries do catálogo são SOQL padrão.',
    },
    {
      t: 'SOQL em RecordType ignora visibilidade por profile',
      d: '94 registros contra os 50 que o object-info devolve. Quem trocar a descoberta por SOQL precisa filtrar por conta própria.',
    },
    {
      t: 'ui-api não é batchável por nenhum mecanismo',
      d: 'composite → NOT_FOUND; composite/batch → INVALID_BATCH_REQUEST; GraphQL não expõe objectInfo/layout/picklistValues; aggregate-ui não existe em v58 a v66. As 850 KB de schema saem em chamadas separadas, sempre.',
    },
    {
      t: 'Não existe API que resolva a FlexiPage efetiva',
      d: '692 objetos na Tooling, nenhum de action override. A associação só existe dentro de CustomApplication.Metadata. Foi o que eliminou Dynamic Forms como fonte.',
    },
    {
      t: 'Label de campo tem limite de 40 caracteres',
      d: 'Várias perguntas do formulário do Cognito não cabem como label e precisam ir para o help text.',
    },
  ];

  return (
    <Secao titulo="Armadilhas verificadas" chapeu="O que morde depois">
      <div className="armadilhas">
        {itens.map((i) => (
          <div className="armadilha" key={i.t}>
            <strong>{i.t}</strong>
            <p>{i.d}</p>
          </div>
        ))}
      </div>
    </Secao>
  );
}

function Veredito() {
  return (
    <Secao titulo="Onde isso chega" chapeu="Leitura">
      <p>
        As duas atendem quase tudo, e as duas precisam de metadado de apoio. O que cada uma cobra
        é diferente:
      </p>
      <ul className="lista">
        <li>
          <strong>UI API</strong> — dois objetos a manter (<code>FormFieldRule__c</code> e{' '}
          <code>FormRequiredDocuments__c</code>), e o catálogo delegado à permissão. Em troca:
          obrigatoriedade por formulário de graça e nenhum acesso a Setup.
        </li>
        <li>
          <strong>Screen Flow</strong> — um objeto a manter (<code>FormDefinition__c</code>), e
          visibilidade e anexo nativos. Em troca: sem obrigatoriedade por formulário, e o usuário
          de integração passa a enxergar todos os flows da org.
        </li>
      </ul>
      <p className="info-nota">
        Uma leitura possível é que as duas se completam: o Page Layout define <em>o que é
        obrigatório</em>, o catálogo define <em>o que o formulário é</em>. Nada impede um{' '}
        <code>FormDefinition__c</code> com <code>Source__c = LAYOUT</code> servindo a fonte UI API —
        o campo existe justamente para isso, e é o que resolveria o item 03 nela.
      </p>
      <p className="info-nota">
        O ponto sem contorno é a <strong>obrigatoriedade por formulário no Screen Flow</strong>:
        campo vinculado ao objeto não aceita nem <code>isRequired</code> nem{' '}
        <code>validationRule</code>, e quem aceita não vincula. Validar só no cliente é possível —
        é a mesma decisão de risco já tomada para anexos — mas aqui ela valeria para o formulário
        inteiro, não para um campo.
      </p>
      <p className="info-nota aviso">
        O que esta POC <strong>não</strong> demonstra: upload real de arquivo, autenticação de
        cliente final, cache do catálogo e enforcement no lado Salesforce. São exatamente os pontos
        que decidem viabilidade em produção e continuam em aberto.
      </p>
    </Secao>
  );
}
