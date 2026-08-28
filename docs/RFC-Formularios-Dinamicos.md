# 💬 RFC — Formulários dinâmicos a partir do Salesforce

| Review Status | Accepting comments |
| :---- | :---- |
| Comments until | @date |
| Review until | @date |

## Revisions

| Date | Description |
| :---- | :---- |
| 28 de ago. de 2026 | Started |
|  |  |

## Approvers

| Status | Name | Date |
| :---- | :---- | :---- |
| ⚪️ Not started | Léo Caratin | @date |
| ⚪️ Not started | @nome | @date |
| ⚪️ Not started | @nome | @date |

# Overview

Esta RFC propõe substituir o Cognito Forms por formulários renderizados a partir de uma definição que vive no Salesforce. Hoje 53 formulários do Cognito coletam solicitações de clientes — alteração de dados bancários, rescisão, reparos, entre outras — e o resultado chega ao Salesforce por integração, fora do modelo de dados do Caso.

A proposta é inverter a direção: a definição do formulário passa a ser um registro na org, um BFF a traduz para um contrato normalizado, e o preenchimento cria o Caso diretamente, com os campos já no lugar certo. O documento especifica o modelo de dados, as chamadas de API, o contrato entre o Salesforce e os canais que consomem, e o que fica de responsabilidade de cada lado.

Quatro fontes de definição foram implementadas e comparadas numa prova de conceito. Esta RFC propõe **uma delas** — um objeto customizado, `SI_FormSpec__c` — e registra por que as outras três foram descartadas.

# Goals & Non-Goals

## Goals

* Definir o modelo de dados que descreve um formulário dentro do Salesforce, incluindo estrutura, regras condicionais, validação e anexos exigidos.
* Especificar o **contrato normalizado** entre o Salesforce e os canais que consomem formulários, de modo que a fonte da definição seja detalhe de implementação e possa mudar sem quebrar consumidor.
* Especificar as chamadas de API necessárias para montar e submeter um formulário, com o custo medido de cada uma.
* Descrever o modelo operacional: quem cria um formulário novo, com qual ferramenta, e sem depender de deploy.

## Non-Goals

* Definir a experiência visual dos canais que consomem o contrato. O contrato descreve *o que* renderizar, não *como*.
* Especificar a autenticação do cliente final. É pré-requisito para produção e está listado em Risks, mas o desenho de identidade é assunto de outra RFC.
* Migrar os 53 formulários do Cognito. Esta RFC habilita a migração; o plano de corte por formulário é trabalho subsequente.
* Alterar o modelo de atendimento dos Casos criados — roteamento, filas e SLA seguem como estão.

# Background & Motivation

Os formulários de solicitação de cliente hoje vivem no Cognito Forms. O modelo funciona, e é justamente por funcionar que cresceu: 53 formulários ativos, mantidos por operação, com regras condicionais, validações customizadas e listas repetíveis.

O arranjo atual apresenta quatro problemas estruturais.

1. **A definição está fora do sistema de registro.** O Salesforce é onde o Caso vive, onde o atendimento acontece e onde os campos são definidos. A pergunta que gera o dado está noutro lugar, e nada garante que as duas descrições concordem. Renomear ou aposentar um campo no Salesforce não produz sinal nenhum no Cognito.

2. **O dado chega desestruturado.** A integração entrega o preenchimento como texto, e a distribuição para campos do Caso é feita depois, por automação que replica — em outro lugar e em outra linguagem — o mapeamento que o formulário já conhecia. Cada campo novo exige mexer nos dois lados.

3. **Não há reaproveitamento entre canais.** O mesmo pedido feito por Magic Link, pelo app e por bot precisa de três implementações, porque não existe uma descrição do formulário que os três possam ler.

4. **Custo e dependência externa.** É uma ferramenta paga, fora do perímetro de dados da empresa, com dados de cliente final — incluindo documentos com foto — trafegando e residindo nela.

O que motiva a mudança não é substituir a ferramenta, é **mover a definição para junto do dado**. O ganho decisivo é o item 2: se a definição sabe que uma pergunta grava em `SI_BankBranch__c`, o Caso pode nascer com o campo preenchido, sem etapa de tradução no meio.

## O que foi analisado antes de propor

Os 53 formulários do Cognito foram extraídos e catalogados: todo tipo de campo, componente, interação e regra em uso. O levantamento produziu 17 tipos de componente distintos e 23 validações customizadas. A prova de conceito foi construída para responder se o Salesforce cobre esse conjunto, e a resposta orientou o desenho abaixo — em particular a obrigatoriedade condicional, a validação com mensagem e a lista repetível, que só existem nesta proposta porque o corpus as exige.

# Detailed Proposal

## Visão geral

```
canais            BFF                     Salesforce
────────          ─────────────────       ──────────────────
Magic Link  ──┐                           SI_FormSpec__c   (a definição)
Site / App  ──┼──▶  contrato       ──▶    EntityParticle   (o schema)
Bot         ──┘     normalizado           Case             (o destino)
```

O BFF é o único componente que fala com a org. Os canais conhecem apenas o contrato normalizado e não sabem de que fonte a definição veio.

## O modelo de dados

A definição inteira vive num objeto customizado, `SI_FormSpec__c`. O Record Type discrimina o papel de cada linha, e `Parent__c` monta a árvore.

| Record Type | O que é | O que guarda |
| :---- | :---- | :---- |
| `Form` | a raiz | objeto e Record Type de destino, `Type` do Caso, canal, rótulo público, descrição |
| `Section` | agrupamento visual | nome, ordem; visibilidade própria via regras filhas |
| `RepeatingSection` | lista repetível | objeto filho, campo de vínculo, mínimo e máximo de itens, rótulo do item |
| `Field` | um campo | `FieldApiName__c` e as escolhas de formulário: obrigatório, oculto, largura, valor padrão, sobrescritas de rótulo e ajuda |
| `Attachment` | documento exigido | código do documento, tipos aceitos, mínimo e máximo de arquivos, tamanho |
| `Content` | bloco de texto | HTML em `Body__c` |
| `Rule` | uma condição | campo observado, operador, valor, origem do valor e efeito — filha do componente que afeta |

Três decisões merecem registro.

**`Form__c` aponta sempre para a raiz, em toda linha.** É redundante com `Parent__c` e é intencional: é essa redundância que permite trazer a árvore inteira com uma condição plana (`Id = :formId OR Form__c = :formId`), em uma consulta. Sem ela seriam N consultas ou Apex REST, porque SOQL só desce um nível de sub-query.

**A especificação não guarda rótulo, tipo, tamanho nem texto de ajuda do campo.** Isso é metadado do campo e é lido do schema em tempo de execução. Duplicar criaria uma segunda verdade, que passa a divergir no dia em que alguém alterar o campo em Setup. Existem sobrescritas explícitas (`LabelOverride__c`, `HelpTextOverride__c`) para o caso concreto de o rótulo do campo não caber na pergunta — o limite de rótulo no Salesforce é 40 caracteres, e várias perguntas do Cognito passam disso.

**A referência ao Record Type de destino é por `DeveloperName`, não por Id.** Id de Record Type muda entre orgs e não sobreviveria a uma promoção de forno para produção. O preço é uma chamada de 0,2 KB para resolvê-lo na leitura.

## Regras: uma máquina de filtros, três efeitos

Uma `Rule` é filha do componente que ela afeta e carrega um efeito. O **modo** da lógica (ALL, ANY, CUSTOM) fica no componente alvo, não na regra — mesmo desenho do "Show component when" da FlexiPage. As regras são os filtros numerados, e o número é a ordem de cada uma.

| `Effect__c` | Vira no contrato | Quando as condições batem |
| :---- | :---- | :---- |
| `SHOW` | `visibility` | o componente aparece |
| `REQUIRE` | `requiredWhen` | o campo passa a ser exigido |
| `BLOCK` | `validation` | o preenchimento está **inválido** e o envio trava |

Os três grupos são independentes porque um campo pode *aparecer* sob uma condição e só ser *exigido* sob outra. Reaproveitar um grupo só forçaria as duas a coincidirem.

A condição de `BLOCK` descreve **quando está errado**, não quando está certo. É a semântica do Cognito, onde a expressão dispara a mensagem, e manter a inversão foi o que permitiu traduzir as 23 validações do corpus sem reescrever nenhuma.

O valor do outro lado da comparação tem três origens:

* `LITERAL` — o texto configurado.
* `FIELD` — o valor é o nome de outro campo; a comparação é campo a campo.
* `TOKEN` — datas relativas: `HOJE`, `HOJE+30`, `HOJE-7`, `AGORA`.

O token existe porque o Cognito resolve datas relativas com campos ocultos calculados: um formulário do corpus tem dois campos invisíveis, `DataHoje` e `DataD2`, criados apenas para a validação poder compará-los. O token faz o mesmo sem exigir um motor de cálculo na definição.

Uma regra `BLOCK` sem mensagem é descartada, com aviso em `diagnostics`, em vez de travar o envio sem explicar por quê.

## O contrato normalizado

É o artefato durável desta proposta. Os canais conhecem apenas esta forma; trocar a fonte no Salesforce não pode alterá-la.

```jsonc
{
  "source": "FORM_SPEC",
  "object": "Case",
  "recordType":     { "id": "...", "developerName": "...", "label": "..." },
  "formDefinition": { "id": "...", "label": "...", "channel": "ONLINE", "description": "..." },

  "sections": [{
    "id": "...",
    "label": "Dados do parceiro",
    "visibility": { "logic": "ALL", "expression": null, "conditions": [ /* Condition */ ] },
    "repeating": false,
    "fields": [ /* Item — ver abaixo */ ]
  }],

  "attachments":   { "required": true, "minimumCount": 3, "documents": [{ "code", "label" }] },
  "backendFields": { "RecordTypeId": "012...", "Type": "BankDataChange" },
  "diagnostics":   { "calls": [ /* … */ ], "warnings": [ /* … */ ] }
}
```

### `Item` — o elemento de `sections[].fields[]`

`fields[]` é **heterogêneo**. O discriminador é `kind`; item sem `kind` é campo, por compatibilidade.

**`kind: "field"`**

| Campo | Tipo | Descrição |
| :---- | :---- | :---- |
| `apiName` | `string` | API name no SObject. Dentro de uma lista, no objeto **filho**. |
| `label` | `string` | Rótulo do schema, salvo sobrescrita explícita. |
| `dataType` | `DataType` | Normalizado para o vocabulário do `object-info`: `String`, `Picklist`, `Date`, `Email`, `Phone`, `Currency`, `Boolean`, … |
| `required` | `boolean` | Obrigatoriedade **deste formulário**, ou do objeto. O formulário vence. |
| `readOnly` | `boolean` | Da especificação, ou herdado de `IsCreatable = false`. |
| `helpText` | `string \| null` | Texto de ajuda do campo, salvo sobrescrita. |
| `maxLength` | `number \| null` | Tamanho do campo. |
| `options` | `Option[] \| null` | Valores de picklist válidos no Record Type. `null` quando não é picklist. |
| `controllerField` | `string \| null` | API name do campo que controla esta picklist dependente. |
| `controllerValues` | `object \| null` | Valor do controlador → índice usado em `Option.validFor`. |
| `width` | `'FULL' \| 'HALF' \| 'THIRD'` | Largura na linha. |
| `hidden` | `boolean` | Não é renderizado, mas vai no payload com o `defaultValue`. |
| `defaultValue` | `string \| null` | Valor inicial. Em campo oculto, **vence** o que vier do cliente. |
| `placeholder` | `string \| null` | Texto do campo vazio. |
| `visibility` | `Grupo \| null` | Regras `SHOW`. |
| `requiredWhen` | `Grupo \| null` | Regras `REQUIRE`. |
| `validation` | `Validation \| null` | Regras `BLOCK`. |

**`kind: "attachment"`** — `code`, `required`, `minFiles`, `maxFiles`, `maxSizeMb`, `acceptedTypes[]`, mais `visibility`, `requiredWhen` e `validation` como qualquer outro item.

**`kind: "content"`** — `apiName` sintético (`__content_{id}`), `label` (nome interno, para a operação) e `html`.

### `Option`

| Campo | Tipo | Descrição |
| :---- | :---- | :---- |
| `value` | `string` | O valor gravado. |
| `label` | `string` | O texto exibido. |
| `validFor` | `number[]` | Índices dos valores do controlador para os quais esta opção é válida. Vazio quando o campo não é dependente. |

### `Grupo` — a forma de `visibility` e `requiredWhen`

| Campo | Tipo | Descrição |
| :---- | :---- | :---- |
| `logic` | `'ALL' \| 'ANY' \| 'CUSTOM'` | Como as condições se combinam. `CUSTOM` só existe em `visibility`. |
| `expression` | `string \| null` | A expressão do modo `CUSTOM`: `"1 AND (2 OR 3)"`. Os números são a ordem das condições. |
| `conditions` | `Condition[]` | Os filtros, na ordem que a expressão numera. |

### `Condition`

| Campo | Tipo | Descrição |
| :---- | :---- | :---- |
| `field` | `string` | API name do campo **observado**. Não precisa estar no formulário. |
| `operator` | `Operator` | `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `GREATER_THAN`, `LESS_THAN`, `IS_NULL`, `IS_NOT_NULL`. |
| `value` | `string` | O outro lado da comparação. |
| `valueSource` | `'LITERAL' \| 'FIELD' \| 'TOKEN'` | Como interpretar `value`. |

### `Validation`

`Grupo` sem `CUSTOM`, mais `message: string`. A condição descreve o **inválido**.

### `Section` quando `repeating: true`

Acrescenta `childObject`, `childRelationshipField`, `itemLabel`, `addButtonText`, `minItems` e `maxItems`. Os campos de uma lista endereçam o objeto **filho**, não o Caso.

### Notas de implementação para quem consumir

* `attachments` é um **agregado para validação**, não a lista de renderização. Os itens já estão posicionados dentro das seções, na ordem que a operação definiu.
* Seção oculta esconde tudo dentro dela, **inclusive os obrigatórios** — que deixam de bloquear o envio. Sem isso, um campo obrigatório numa seção escondida travaria um preenchimento válido.
* `expression` do modo `CUSTOM` **não deve ser avaliada como código**. Ela vem de um registro editado por operação; executá-la seria injeção. Na POC é interpretada por um parser dedicado.

## As chamadas

Medidas na scratch org, pelo usuário de integração, com o objeto `Case` em 397 campos criáveis.

### Ao abrir a aplicação — uma vez por sessão

| # | Método | Recurso | Peso | Tempo |
| :---- | :---- | :---- | ----: | ----: |
| 01 | POST | `/composite/batch` — três subrequisições | 160,6 KB | 492 ms |

As três subrequisições:

1. `EntityParticle` — o schema dos campos: rótulo, tipo, tamanho, texto de ajuda, obrigatoriedade no objeto, FLS do usuário corrente.
2. `FieldDefinition` — picklists dependentes e o campo que controla cada uma.
3. `SI_FormSpec__c` — o catálogo: as linhas com Record Type `Form`.

O catálogo vem **junto** e não depois, porque é ele que alimenta o seletor: sem catálogo não há formulário para escolher.

Esta chamada substitui `ui-api/object-info`, que devolve todos os campos com 36 atributos cada — 377,5 KB nesta org — e não aceita filtro. `EntityParticle` é SOQL comum: escolhe as colunas, e por ser SOQL cabe no mesmo composite do catálogo.

A segunda subrequisição existe por uma lacuna: nem `EntityParticle` nem `picklist-values` entregam o **nome** do campo controlador. O primeiro só marca `IsDependentPicklist`; o segundo devolve `controllerValues` sem nomear quem controla. `FieldDefinition.ControllingFieldDefinitionId` aponta para o `DurableId` de outro campo — que a primeira subrequisição já traz. Custo: 0,3 KB.

### Ao escolher um formulário — a cada troca no seletor

| # | Método | Recurso | Peso | Tempo |
| :---- | :---- | :---- | ----: | ----: |
| 02 | GET | `/query` — `SELECT … FROM SI_FormSpec__c WHERE (Id = :formId OR Form__c = :formId)` | 48,7 KB | 165 ms |
| 03 | GET | `/query` — `RecordType` por `DeveloperName` | 0,2 KB | 132 ms |
| 04 | GET | `/ui-api/object-info/Case/picklist-values/{recordTypeId}` | 260,4 KB | 1.224 ms |

A chamada 04 é a única que permanece na UI API. É a única fonte que respeita Record Type e devolve as dependências — `describe`, `FieldDefinition`, `EntityParticle` e `PicklistValueInfo` foram testados e nenhum atende. E é a única que **não** pode entrar no composite: o endpoint recusa recursos de `ui-api` com `INVALID_BATCH_REQUEST`.

### Total

**4 chamadas, 470 KB, ~2,0 s.** Noventa por cento do peso está em duas chamadas de schema (160,6 KB e 260,4 KB). A definição do formulário custa 48,9 KB. O peso não está no formulário — está no objeto `Case`.

### Ao enviar

`POST /composite`, com `allOrNone: true`:

```jsonc
{
  "allOrNone": true,
  "compositeRequest": [
    { "referenceId": "refPai", "method": "POST", "url": "/sobjects/Case",
      "body": { "RecordTypeId": "012…", "Type": "BankDataChange", "SI_FullName__c": "…" } },

    { "referenceId": "item1",  "method": "POST", "url": "/sobjects/CaseMember__c",
      "body": { "Name": "…", "Type__c": "Landlord", "Case__c": "@{refPai.id}" } },

    { "referenceId": "registroCriado", "method": "GET",
      "url": "/sobjects/Case/@{refPai.id}?fields=Id,CaseNumber,Status,CreatedDate" }
  ]
}
```

O Caso ainda não existe quando o cliente preenche, então os itens não têm o Id do pai para gravar. O `referenceId` da primeira subrequisição vira `@{refPai.id}` nas seguintes, resolvido dentro da própria transação.

`allOrNone` porque um Caso sem os registros que o justificam é pior que erro nenhum: a pessoa reenviaria e criaria um Caso duplicado, e a operação receberia dois pedidos para a mesma coisa, um deles silenciosamente incompleto.

**Nota de diagnóstico.** Quando o pai falha, cada filho reporta *"Could not find the referenced operation refPai"*. Quando um filho falha, o pai reporta `PROCESSING_HALTED`. Os dois são sintoma; o consumidor precisa localizar a subrequisição cujo erro não é nenhum desses e reportar essa.

## Campos gravados pelo back-end

`RecordTypeId` e `Type` são injetados pelo BFF a partir do catálogo, depois de montar o registro. Não são renderizados nem aceitos do cliente: quem escolheu o formulário já escolheu o Record Type e o Type do Caso, e perguntar de novo abriria espaço para o dado divergir do catálogo.

O mesmo princípio vale para campos com `hidden: true`: o `defaultValue` da definição vence o que vier do cliente. É assim que `Type__c` e `MemberSource__c` entram em cada item de lista sem aparecer na tela.

## Avaliação de regras nos dois lados

A mesma função avalia visibilidade, obrigatoriedade condicional e validação **no navegador e no servidor** — no primeiro a cada digitação, no segundo ao montar o payload. É o que garante que a tela e o envio não discordem sobre o que está oculto ou inválido.

Isso **não** é enforcement: veja Risks.

# Timeline

@preencher

# Dependencies

* **Salesforce Platform**
  * Objeto `SI_FormSpec__c` com os sete Record Types, e o configurador (LWC) que o edita.
  * Objeto de destino dos itens de lista. Hoje `CaseMember__c`; ver Risks.
  * External Client App com Client Credentials Flow habilitado e um usuário "Run As" definido.
* **BFF**
  * Componente novo, a ser hospedado. A POC roda em Node com Express, sem SDK do Salesforce.
* **Permissões**
  * Permission set para o usuário de integração, com FLS de leitura em `SI_FormSpec__c` e de criação nos campos que os formulários preenchem. FLS ausente faz a REST reportar `No such column` — o erro não indica permissão, e é fácil concluir que o campo não existe.
* **Operação**
  * Titularidade do catálogo: quem cria, revisa e desativa formulário.

# Alternatives Considered & Prior Art

Quatro fontes de definição foram implementadas e comparadas na mesma tela, produzindo o mesmo contrato. Três foram descartadas.

**Page Layout, via UI API.** O layout já traz seções, ordem e obrigatoriedade por formulário, de graça, e o admin edita em Setup. Descartada por dois limites que não têm contorno: o Page Layout **não modela condição nem anexo**, e o retorno da UI API não é extensível — as duas capacidades exigiram objetos de apoio (`FormFieldRule__c`, `FormRequiredDocument__c`), o que anula a vantagem de "não construir nada". Além disso, o layout amarra a identidade do formulário ao Record Type: dois canais com o mesmo formulário exigiriam dois Record Types.

**Screen Flow, via Tooling API.** Traz visibilidade condicional e componente de anexo nativos, e o admin edita no Flow Builder. Descartada por três razões: (a) o Flow **não declara Record Type** em lugar nenhum do metadado, então as picklists não têm como ser resolvidas sem um catálogo à parte; (b) **não aceita obrigatoriedade por formulário** — um campo vinculado ao objeto (`ObjectProvided`) recusa `isRequired` e `validationRule` no deploy, e o componente que aceita não vincula a campo nenhum; (c) ler Flow pela Tooling exige `ViewSetup`, `ViewRoles` e `ViewAllNonSetupFlows`, o que faz o usuário de integração enxergar todos os flows da org.

**`record-defaults/create`, via UI API.** Faz menos chamadas, mas devolve o objeto inteiro — 652 campos — para um formulário de 15. Gasta mais para entregar menos estrutura.

**Dynamic Forms / FlexiPage.** Investigada e eliminada antes de virar implementação: não existe API que resolva qual FlexiPage está efetivamente associada a uma ação. A associação só existe dentro de `CustomApplication.Metadata`, e 692 objetos da Tooling foram varridos sem encontrar um de action override.

**Manter o Cognito.** É a alternativa de menor esforço imediato e continua sendo uma opção defensável para formulários simples. Foi descartada como estratégia porque não resolve o problema central — a definição segue fora do sistema de registro, e o dado segue chegando desestruturado.

# Operations

A mudança operacional é a criação e manutenção de formulários passar para dentro do Salesforce.

Um formulário novo é criado no **SI Form Builder**, uma LWC na org. A ferramenta traz uma paleta com Seção, Lista, Anexo e Texto, e a lista de campos do objeto, filtrável. Arrastar um campo para dentro de uma seção cria o componente; o painel de propriedades expõe as sobrescritas, a largura, o valor padrão e os três grupos de filtro. As condições aparecem sob o componente que elas afetam.

**Nada disso passa por deploy.** São registros. Um formulário novo, ou uma pergunta a mais num formulário existente, é uma edição de dado — não entra em janela de release e não depende de engenharia.

Duas exceções, que a operação precisa conhecer:

* Uma pergunta que grava num campo **que ainda não existe** exige criar o campo, e isso é metadado — passa por deploy e por FLS.
* Um formulário que cria registros filhos exige que o objeto filho e o campo de vínculo existam.

Sugere-se que o catálogo tenha titularidade explícita, com revisão antes de ativar (`IsActive__c`), pelo mesmo motivo que o Cognito tem hoje: formulário é interface com cliente.

# Observability

**Chamadas ao Salesforce.** O BFF registra cada chamada — recurso, verbo, peso e tempo — e devolve a lista em `diagnostics.calls` do próprio contrato. Na POC isso alimenta um painel de inspeção; em produção deve alimentar métrica de latência e volume por recurso. As duas chamadas de schema são as candidatas naturais a alarme de latência, por serem 90% do peso.

**Avisos de tradução.** `diagnostics.warnings` acumula os problemas que não impedem servir o formulário mas indicam definição malformada: Record Type inexistente, lista sem campo de vínculo, validação sem mensagem, lógica `CUSTOM` sem expressão. Estes avisos devem ser coletados e revisados — cada um é um formulário servindo menos do que a operação configurou, sem erro visível.

**Envio.** Taxa de sucesso do `composite`, e os `errorCode` de falha agrupados. A falha raiz precisa ser extraída antes de agregar; agrupar por `PROCESSING_HALTED` não distingue causas.

**Formulários sem uso.** Um formulário ativo no catálogo que não recebe envio há muito tempo é candidato a desativação, e a métrica é trivial: envios por `formDefinition.id`.

# Security & Privacy & Compliance

**Dado pessoal.** Os formulários coletam nome, CPF, e-mail, telefone, dados bancários e documentos com foto. É dado pessoal sensível, e o volume não é pequeno. O ganho de privacidade da proposta é real: o dado deixa de residir e trafegar por uma ferramenta de terceiro e passa a nascer dentro da org, sob os mesmos controles do resto do Caso.

**Superfície de permissão do usuário de integração.** O desenho exige apenas FLS de campo e leitura em `SI_FormSpec__c`. Nenhuma permissão de Setup — foi um dos critérios que eliminou a fonte Screen Flow, que exigia três.

**Autenticação máquina a máquina.** O BFF autentica por Client Credentials Flow, sem usuário no meio. O usuário "Run As" do External Client App é quem define o FLS efetivo, e portanto quais campos os formulários conseguem ler e gravar.

**Autenticação do cliente final.** Não resolvida. Ver Risks.

**Campos não forjáveis.** `RecordTypeId` e `Type` são injetados pelo servidor a partir do catálogo, e campos ocultos usam o valor da definição em vez do que vier do cliente. O payload do cliente não pode alterar em que Record Type o Caso nasce.

**Expressões de operação não são código.** A expressão do modo `CUSTOM` é interpretada por parser dedicado, nunca por `eval`. Ela vem de um registro editável por operação e roda também no servidor.

# Risks

* **Não há enforcement no lado Salesforce.** A obrigatoriedade por formulário, a validação customizada e os mínimos de lista são verificados no BFF. Nada impede uma integração — ou uma chamada direta à API — de criar um Caso ignorando tudo. É consequência direta do desenho: a regra pertence ao *formulário*, não ao objeto, e o objeto é compartilhado por todos os formulários. Mitigação possível: replicar as validações críticas em Validation Rules do objeto, ao custo de duplicar a regra em dois lugares.

* **Upload de arquivo não está implementado.** Os anexos estão modelados, etiquetados por código de documento e, dentro de listas, por item — mas a POC não cria `ContentVersion` nem vincula o arquivo ao registro. É a maior lacuna entre o que está de pé e o que produção exige, e envolve decisão sobre tamanho, antivírus e retenção.

* **Autenticação do cliente final não está resolvida.** Hoje qualquer um com o link vê qualquer formulário do catálogo. Antes de produção é preciso decidir como o link identifica a pessoa e o que ela pode abrir.

* **O objeto de itens de lista está subespecificado.** `CaseMember__c` tem nome e identificador externo, mas não CPF próprio, telefone nem endereço — na POC o CPF foi para `ExternalId__c`, o que não é o uso pretendido do campo. E `Case__c` é lookup opcional sem cascata: apagar o Caso deixa órfãos. Decisão do dono do objeto, e ela precisa vir antes da primeira lista em produção.

* **O catálogo é ponto único de configuração incorreta.** Uma linha `Form` com `TargetRecordTypeDevName__c` errado serve um formulário sem picklists, com aviso mas sem erro. O configurador reduz o risco ao oferecer seletores em vez de texto livre, mas edição direta de registro continua possível.

* **A migração dos 53 formulários é trabalho real e não está estimada.** O levantamento mostra que o modelo cobre os componentes em uso, mas cobertura de modelo não é migração: cada formulário precisa dos campos de destino existindo no objeto, e vários não existem.

* **Hospedagem de imagem em bloco de conteúdo indefinida.** O bloco aceita HTML, mas onde a imagem reside não foi decidido. `ContentAsset` com `isVisibleByExternalUsers` mantém tudo na org e evita CDN externo; a alternativa é hospedagem externa, com o custo de mais um lugar para manter.
