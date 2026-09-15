# 💬 RFC — Formulários dinâmicos a partir do Salesforce

| Review Status | Accepting comments |
| :---- | :---- |
| Comments until | @date |
| Review until | @date |

## Revisions

| Date | Description |
| :---- | :---- |
| 28 de ago. de 2026 | Started |
| 31 de ago. de 2026 | Dividida em duas etapas; VO da tabela por Record Type; retornos de API; contrato rebaixado a proposta |
| 10 de set. de 2026 | Objeto renomeado para `FormDefinition__c`; versões (`FormKey__c`/`Version__c`/`Status__c`); cabeçalho por campo/valor (Tipo, Prioridade, Versão, Fila); campos de referência (RT `Reference`, entidades vindas do metadado) |

## Approvers

| Status | Name | Date |
| :---- | :---- | :---- |
| ⚪️ Not started | Léo Caratin | @date |
| ⚪️ Not started | @nome | @date |
| ⚪️ Not started | @nome | @date |

# Overview

Esta RFC propõe substituir o Cognito Forms por formulários renderizados a partir de uma definição que vive no Salesforce. Hoje 53 formulários do Cognito coletam solicitações de clientes — alteração de dados bancários, rescisão, reparos, entre outras — e o resultado chega ao Salesforce por integração, fora do modelo de dados do Caso.

A proposta é inverter a direção: a definição do formulário passa a ser um registro na org, e o preenchimento cria o Caso diretamente, com os campos já no lugar certo.

O documento está dividido em **duas etapas**, que podem ser lidas — e implementadas — separadamente:

| | Etapa | Escopo | Quem executa |
| :---- | :---- | :---- | :---- |
| **1** | A definição no Salesforce | modelo de dados, regras, e a tela onde operação monta o formulário | time Salesforce |
| **2** | O consumo pelas APIs | quais chamadas fazer, com quais payloads, e o que cada uma devolve | time consumidor |

Quatro fontes de definição foram implementadas e comparadas numa prova de conceito. Esta RFC propõe **uma delas** — um objeto customizado, `FormDefinition__c` — e registra por que as outras três foram descartadas.

# Goals & Non-Goals

## Goals

* Definir o modelo de dados que descreve um formulário dentro do Salesforce, incluindo estrutura, regras condicionais, validação e anexos exigidos.
* Especificar, para cada Record Type da tabela, **quais colunas são significativas** — a tabela é compartilhada e a consulta é unificada, então essa delimitação é o que torna o retorno interpretável.
* Especificar as **chamadas de API** necessárias para montar e submeter um formulário: método, URL, payload enviado e forma do retorno.
* Descrever a tela de configuração no Salesforce e o modelo operacional: quem cria um formulário novo, com qual ferramenta, e sem depender de deploy.

## Non-Goals

* **Definir o contrato que o front consome.** Isso é responsabilidade de quem constrói o BFF. Esta RFC entrega as consultas e os retornos; o formato normalizado aparece como *proposta*, não como especificação.
* Definir a experiência visual dos canais que consomem os dados.
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

As setas são numeradas porque leitura e escrita compartilham as mesmas colunas — sem a numeração não dá para saber o que acontece antes do quê. **O pedido vai numa direção e o dado volta na outra.**

```
  CANAIS                   CONSUMIDOR                    SALESFORCE
  ──────                   ──────────                    ──────────

 ┌────────────┐  1 pede   ┌──────────────────┐ 2 consulta  ┌──────────────────┐
 │ Magic Link │ ────────▶ │     MONTAR       │ ──────────▶ │ FormDefinition__c   │
 ├────────────┤           │                  │             │ RecordType       │
 │ Site / App │           │ lê a definição   │ 3 devolve   │ EntityParticle   │
 ├────────────┤ ◀──────── │ e o schema       │ ◀────────── │ ui-api picklists │
 │    Bot     │ 4 devolve └──────────────────┘             └──────────────────┘
 └────────────┘
                                                           ┌──────────────────┐
 ┌ ─ ─ ─ ─ ─ ─┐  5 envia  ┌──────────────────┐ 6 cria      │ Case + filhos    │
   avaliador   ────────▶  │     ENVIAR       │ ──────────▶ │ uma transação    │
   a cada tecla           │                  │             └──────────────────┘
 └ ─ ─ ─ ─ ─ ─┘           │ ┌ ─ ─ ─ ─ ─ ─ ─┐ │
                          │   avaliador      │
                          │   ao montar      │
                          │ └ ─ ─ ─ ─ ─ ─ ─┘ │
                          └──────────────────┘
```

**A avaliação das regras acontece do lado do consumidor**, e em dois momentos: ao desenhar a tela (quais componentes aparecem, quais estão exigidos) e ao montar o envio (o que vai no payload, o que trava). O Salesforce não avalia regra nenhuma em tempo de leitura — devolve a definição, e a definição contém as condições em forma de dado.

Recomendação: usar **o mesmo código** nos dois momentos. Se a checagem da tela e a do envio forem implementações distintas, elas divergem, e a divergência aparece como campo exigido que o usuário não consegue ver.

Nada nos canais conhece a origem da definição. Trocar a fonte no Salesforce não muda nada do lado deles.

---

# ETAPA 1 — A definição no Salesforce

## O modelo de dados

A definição inteira vive num objeto customizado, `FormDefinition__c`. O Record Type discrimina o papel de cada linha, e `Parent__c` monta a árvore.

| Record Type | O que é | Filhos que aceita |
| :---- | :---- | :---- |
| `Form` | a raiz | seções, listas e componentes soltos |
| `Section` | agrupamento visual | campos, textos e anexos |
| `RepeatingSection` | lista repetível | campos — que endereçam o objeto **filho**, não o Caso |
| `Field` | um campo do objeto | regras |
| `Attachment` | documento exigido | regras |
| `Content` | bloco de texto | regras |
| `Rule` | uma condição | — |
| `Reference` | um campo de texto em que o cliente **escolhe** um registro de outro objeto (contrato, imóvel) | regras |

Três decisões merecem registro.

**`Form__c` aponta sempre para a raiz, em toda linha.** É redundante com `Parent__c` e é intencional: é essa redundância que permite trazer a árvore inteira com uma condição plana (`Id = :formId OR Form__c = :formId`), em uma consulta. Sem ela seriam N consultas ou Apex REST, porque SOQL só desce um nível de sub-query.

**A especificação não guarda rótulo, tipo, tamanho nem texto de ajuda do campo.** Isso é metadado do campo e é lido do schema em tempo de execução. Duplicar criaria uma segunda verdade, que passa a divergir no dia em que alguém alterar o campo em Setup. Existem sobrescritas explícitas (`LabelOverride__c`, `HelpTextOverride__c`) para o caso concreto de o rótulo do campo não caber na pergunta — o limite de rótulo no Salesforce é 40 caracteres, e várias perguntas do Cognito passam disso.

**A referência ao Record Type de destino é por `DeveloperName`, não por Id.** Id de Record Type muda entre orgs e não sobreviveria a uma promoção de forno para produção.

## Quais colunas importam em cada Record Type

A tabela é compartilhada e a consulta é unificada: **uma linha traz todas as colunas, e a maioria vem nula**. Uma linha `Rule` não usa nenhuma coluna de campo; uma linha `Field` não usa nenhuma coluna de regra. Sem esta delimitação, o retorno não é interpretável.

`O` = obrigatório · `•` = usado · em branco = deve ser ignorado nesse Record Type.

### Colunas comuns

| Coluna | Tipo | `Form` | `Section` | `Repeat.` | `Field` | `Attach.` | `Content` | `Rule` |
| :---- | :---- | :----: | :----: | :----: | :----: | :----: | :----: | :----: |
| `Name` | Text(80) | O | O | O | • | O | • | • |
| `Form__c` | Lookup | | O | O | O | O | O | O |
| `Parent__c` | Lookup | | • | • | • | • | • | O |
| `Sort__c` | Number | | • | • | • | • | • | • |
| `IsActive__c` | Checkbox | O | • | • | • | • | • | • |

`Parent__c` vazio significa **filho direto da raiz**. Em `Rule` ele é obrigatório e aponta para o componente que a regra afeta. Em `Rule`, `Sort__c` é o **número** usado na expressão de lógica customizada.

`IsActive__c = false` remove a linha da leitura. Desativar a raiz tira o formulário do catálogo.

### `Form` — a raiz

| Coluna | Tipo | | O que é |
| :---- | :---- | :----: | :---- |
| `FormKey__c` | Text(80), External ID | O | **identificador estável** do formulário, como o API Name de um Flow. Igual em todas as versões; é o que canais e automações referenciam |
| `Version__c` | Number | O | sequencial dentro da chave, a partir de 1 |
| `Status__c` | Picklist | O | `DRAFT` (editável, não servida), `ACTIVE` (a que os canais leem), `ARCHIVED` (histórico) |
| `VersionKey__c` | Text, único | O | `FormKey__c#Version__c`, preenchido pelo controller. A unicidade impede duas linhas reivindicarem a mesma versão |
| `IsActive__c` | Checkbox | O | derivado de `Status__c = ACTIVE`. É o único filtro que o consumidor precisa conhecer |
| `ObjectApiName__c` | Text | O | objeto que o formulário cria (`Case`, `CaseSI__c`). A lista permitida é o metadado `FormBuilderAllowlist__mdt` |
| `TargetRecordTypeDevName__c` | Text | O | `DeveloperName` do Record Type de destino |
| `QueueDeveloperName__c` | Text | • | `DeveloperName` da fila que recebe o registro (`OwnerId`). Nome, não Id: Id de fila muda entre orgs |
| `TypeFieldApiName__c` / `TypeValue__c` | Text | • | em que campo do objeto gravar o tipo, e com que valor, sem virar pergunta |
| `PriorityFieldApiName__c` / `PriorityValue__c` | Text | • | idem para a prioridade |
| `VersionFieldApiName__c` | Text | • | campo do objeto que recebe a versão do formulário na criação |
| `Channel__c` | Multi-select | • | canais em que o formulário é oferecido (`ONLINE`, `MAGICLINK`, `BOT`). Vem como `A;B` |
| `PublicLabel__c` | Text | • | rótulo exibido ao cliente. Sem ele, usa-se `Name` |
| `Description__c` | LongText | • | para que serve o formulário, nas palavras do cliente. É o texto de abertura **e** o que o bot usa para levar o cliente ao formulário certo — obrigatória para ativar |

`Form__c` e `Parent__c` ficam **vazios** na raiz — é assim que ela se identifica.

### `Section` — agrupamento

| Coluna | Tipo | | O que é |
| :---- | :---- | :----: | :---- |
| `FilterLogicType__c` | Picklist | • | `ALL` (padrão), `ANY` ou `CUSTOM` |
| `FilterLogic__c` | Text | • | a expressão, quando `CUSTOM`. Ex.: `1 AND (2 OR 3)` |

Uma seção oculta esconde tudo que está dentro dela, inclusive campos obrigatórios — que deixam de ser exigidos enquanto ela estiver oculta.

### `RepeatingSection` — lista repetível

| Coluna | Tipo | | O que é |
| :---- | :---- | :----: | :---- |
| `ChildObjectApiName__c` | Text | O | objeto de cada item. Ex.: `CaseMember__c` |
| `ChildRelationshipField__c` | Text | O | campo de lookup do filho para o pai |
| `ItemLabel__c` | Text | • | rótulo de cada item. Ex.: "Representante" |
| `AddButtonText__c` | Text | • | texto do botão de adicionar |
| `MinItems__c` | Number | • | mínimo exigido no envio |
| `MaxItems__c` | Number | • | máximo aceito |
| `FilterLogicType__c` / `FilterLogic__c` | | • | visibilidade da lista inteira |

Sem `ChildObjectApiName__c` **ou** sem `ChildRelationshipField__c` a lista é inutilizável e deve ser descartada com aviso — não há para onde gravar os itens.

**Atenção:** os `Field` filhos de uma `RepeatingSection` referenciam campos do **objeto filho**, não do `Case`. Quem for buscar o schema desses campos precisa consultar o outro objeto.

### `Field` — um campo do objeto

| Coluna | Tipo | | O que é |
| :---- | :---- | :----: | :---- |
| `FieldApiName__c` | Text | O | API name do campo no objeto |
| `LabelOverride__c` | Text | • | substitui o rótulo do schema |
| `HelpTextOverride__c` | Text | • | substitui o texto de ajuda do schema |
| `Placeholder__c` | Text | • | texto de exemplo dentro do campo |
| `DefaultValue__c` | Text | • | valor inicial |
| `IsRequired__c` | Checkbox | • | obrigatório **neste formulário** |
| `IsReadOnly__c` | Checkbox | • | exibido, não editável, não enviado |
| `IsHidden__c` | Checkbox | • | **não desenhado**, mas vai no payload com `DefaultValue__c` |
| `Width__c` | Picklist | • | `FULL`, `HALF` ou `THIRD` |
| `FilterLogicType__c` / `FilterLogic__c` | | • | modo da **visibilidade** |
| `RequiredLogicType__c` | Picklist | • | modo da **obrigatoriedade condicional**: `ALL` ou `ANY` |
| `ValidationLogicType__c` | Picklist | • | modo da **validação**: `ALL` ou `ANY` |
| `Message__c` | Text | • | mensagem exibida quando a validação reprova |

Os três modos de lógica são separados de propósito: um campo pode *aparecer* sob uma condição e só ser *exigido* sob outra.

**`Message__c` vive no componente, não na regra.** É a pegadinha mais provável para quem consumir: a condição está nas linhas `Rule` filhas, a mensagem está no pai.

### `Attachment` — documento exigido

| Coluna | Tipo | | O que é |
| :---- | :---- | :----: | :---- |
| `DocumentCode__c` | Text | • | código do documento. Ex.: `RG_FRENTE` |
| `AcceptedTypes__c` | Text | • | extensões separadas por vírgula |
| `MinFiles__c` | Number | • | mínimo. Sem valor, `IsRequired__c` implica 1 |
| `MaxFiles__c` | Number | • | máximo |
| `MaxSizeMb__c` | Number | • | tamanho por arquivo |
| `IsRequired__c` | Checkbox | • | exigido para enviar |
| `Width__c` | Picklist | • | `FULL`, `HALF` ou `THIRD` |
| os três modos de lógica | | • | anexo aceita condição como qualquer componente |

`Name` é o rótulo exibido — "Documento com foto", não um identificador interno.

### `Content` — bloco de texto

| Coluna | Tipo | | O que é |
| :---- | :---- | :----: | :---- |
| `Body__c` | RichText | O | o conteúdo exibido |
| `Width__c` | Picklist | • | `FULL`, `HALF` ou `THIRD` |
| `FilterLogicType__c` / `FilterLogic__c` | | • | visibilidade |

Aqui `Name` é identificação interna e **não deve ser exibido** — o que aparece é `Body__c`.

### `Rule` — uma condição

| Coluna | Tipo | | O que é |
| :---- | :---- | :----: | :---- |
| `Parent__c` | Lookup | O | o componente que esta regra afeta |
| `ConditionFieldApiName__c` | Text | O | campo observado |
| `Operator__c` | Picklist | O | ver tabela de operadores |
| `Value__c` | Text | • | valor comparado; vazio em `IS_NULL` / `IS_NOT_NULL` |
| `ValueSource__c` | Picklist | • | `LITERAL` (padrão), `FIELD` ou `TOKEN` |
| `Effect__c` | Picklist | • | `SHOW` (padrão), `REQUIRE` ou `BLOCK` |
| `Sort__c` | Number | • | o número da condição na expressão `CUSTOM` |

### `Reference` — um campo que aponta para outro registro

Um campo de texto em que o cliente **escolhe** um registro de outro objeto (o contrato, o imóvel) em vez de digitar. É um `Field` com a entidade declarada: ocupa lugar no grid, tem largura, obrigatoriedade e regras, e grava em `FieldApiName__c`. O que muda é que o consumidor sabe **o que** o campo é sem adivinhar pelo nome, e renderiza o seletor da entidade. No app esses campos podem ser pedidos antes do formulário; na web entram no layout como qualquer campo — inclusive sob condição.

| Coluna | Tipo | | O que é |
| :---- | :---- | :----: | :---- |
| `ReferenceType__c` | Text | O | a entidade: `CONTRACT`, `PROPERTY`. Os valores válidos são os registros `Reference` ativos de `FormBuilderAllowlist__mdt` para o objeto do formulário |
| `FieldApiName__c` | Text | O | o campo **texto** do objeto de destino que recebe o identificador escolhido (`RelatedContractId__c`). Vem do metadado, não do operador |
| `ReferenceObjectApiName__c` | Text | O | objeto onde a entidade vive (`Contract`, `Property__c`). Copiado do metadado no save |
| `ExternalIdFieldApiName__c` | Text | O | qual identificador do registro escolhido vai no texto (`ExternalId__c`). Copiado do metadado no save |
| `LabelOverride__c`, `HelpTextOverride__c`, `IsRequired__c`, `Width__c` e as lógicas | — | • | iguais a `Field` |

O metadado (`FormBuilderAllowlist__mdt`, categoria `Reference`) amarra, por objeto de destino, a entidade ao campo de texto que a recebe, ao objeto referenciado, à chave externa e ao lookup que o Salesforce preenche quando o texto bate (`TargetLookupApiName__c`). O operador só escolhe a entidade; o resto é curadoria de engenharia, revisada em PR. O mesmo objeto pode aparecer em duas entidades com chaves externas diferentes (contrato de aluguel e de venda), por isso a identidade é a entidade, não o objeto.

**No submit o valor vai como texto**, no próprio campo. Nada de lookup nem de chave externa na relação: o Salesforce procura o registro e, se achar, preenche o lookup; se não achar, o registro é criado mesmo assim. É a garantia que o Magic Link já dá hoje, com o campo declarado em vez de adivinhado.

## Regras: uma máquina de filtros, três efeitos

Uma `Rule` é filha do componente que ela afeta e carrega um efeito. O **modo** da lógica fica no componente alvo, não na regra — mesmo desenho do "Show component when" da FlexiPage.

| `Effect__c` | Efeito quando as condições batem | Modo vem de |
| :---- | :---- | :---- |
| `SHOW` | o componente aparece | `FilterLogicType__c` + `FilterLogic__c` |
| `REQUIRE` | o campo passa a ser exigido | `RequiredLogicType__c` |
| `BLOCK` | o preenchimento está **inválido** e o envio trava | `ValidationLogicType__c` + `Message__c` |

A condição de `BLOCK` descreve **quando está errado**, não quando está certo. É a semântica do Cognito, onde a expressão dispara a mensagem, e manter a inversão foi o que permitiu traduzir as 23 validações do corpus sem reescrever nenhuma.

Uma regra `BLOCK` sem mensagem deve ser descartada com aviso, em vez de travar o envio sem explicar por quê.

### Operadores

| `Operator__c` | Comparação |
| :---- | :---- |
| `EQUALS` / `NOT_EQUALS` | igualdade textual |
| `CONTAINS` / `NOT_CONTAINS` | substring |
| `STARTS_WITH` | prefixo |
| `GREATER_THAN` / `LESS_THAN` | numérica **ou** de data |
| `IS_NULL` / `IS_NOT_NULL` | preenchimento; ignora `Value__c` |

`GREATER_THAN` e `LESS_THAN` precisam tentar data **antes** de número: `Number('2026-08-27')` é `NaN`, e a comparação viraria `false` em silêncio — a regra nunca dispararia e ninguém descobriria olhando a configuração.

### Origem do valor comparado

| `ValueSource__c` | `Value__c` contém | Uso |
| :---- | :---- | :---- |
| `LITERAL` | o texto configurado | o caso comum |
| `FIELD` | o API name de outro campo | comparação campo a campo |
| `TOKEN` | `HOJE`, `HOJE+30`, `HOJE-7`, `AGORA` | datas relativas |

O token existe porque o Cognito resolve datas relativas com campos ocultos calculados: um formulário do corpus tem dois campos invisíveis, criados apenas para a validação poder compará-los. O token faz o mesmo sem exigir um motor de cálculo na definição.

## A tela de configuração no Salesforce

O argumento inteiro depende disto: **se cada formulário novo virar uma release de engenharia, a solução não escala.** O configurador é uma LWC dentro do Salesforce, e o que ela edita são registros — nada aqui passa por deploy.

🟡 **INSERIR PRINT — `builder-formulario.png`**
*Legenda sugerida: o configurador, com paleta de componentes à esquerda, o formulário no centro e as propriedades à direita. A paleta traz Seção, Lista, Anexo e Texto; abaixo, os campos do objeto, filtráveis. Arrastar um campo para dentro de uma seção cria a linha `Field`. As condições aparecem sob o componente que elas afetam, e os campos ocultos ficam marcados como tal.*

🟡 **INSERIR PRINT — `builder-propriedades.png`**
*Legenda sugerida: as propriedades de um `Field`. O bloco no topo diz o que NÃO se guarda ali: rótulo, tipo e limites vêm do schema. Abaixo, os três grupos de filtro — visibilidade, obrigatoriedade e validação — cada um com sua lógica própria. "Valor digitado" é o seletor de `ValueSource__c`.*

### Onde cada coluna do VO é preenchida

As três capturas seguintes mostram, na tela, as colunas que a seção anterior especifica.

🟡 **INSERIR PRINT — `builder-lista.png`**
*Legenda sugerida: propriedades de uma `RepeatingSection`. "Cada item vira um registro de" é o `ChildObjectApiName__c`; abaixo dele, a tela resolve e exibe o `ChildRelationshipField__c` — o único caminho de volta ao Caso. Rótulo do item, texto do botão, mínimo e máximo completam o resto.*

🟡 **INSERIR PRINT — `builder-anexo.png`**
*Legenda sugerida: propriedades de um `Attachment` — código do documento, tipos aceitos, mínimo, máximo e tamanho. Aqui a visibilidade usa lógica `CUSTOM`: duas condições numeradas e a expressão `1 OR 2`, que é o que vai em `FilterLogic__c`.*

🟡 **INSERIR PRINT — `builder-validacao.png`**
*Legenda sugerida: o grupo de validação de um campo de data. As duas condições usam `ValueSource__c = TOKEN` — "Data relativa", com `HOJE+30` e `HOJE`. "Impedir o envio quando" é o `ValidationLogicType__c`, e a mensagem embaixo é o `Message__c`, que vive no componente e não na regra.*

### Governança

| Quem | O que faz | Precisa de deploy? |
| :---- | :---- | :---- |
| Operação | cria e edita formulários no configurador | não |
| Administração | cria o campo no objeto, quando não existe | sim — é metadado |
| Engenharia | evolui o configurador e o objeto de definição | sim |

O caso que **exige** engenharia é campo novo no `Case`. Formulário novo com campos existentes, mudança de ordem, de texto, de regra ou de documento exigido é operação.

---

# ETAPA 2 — O consumo pelas APIs

## O fluxo de chamadas

```
 CONSUMIDOR                                    SALESFORCE
 ──────────                                    ──────────

 ┌─ AO ABRIR ─ uma vez por sessão ────────────────────────────────┐
 │                                                                │
 │   POST /composite ──────────────────────────▶  catálogo        │
 │                                                 + Record Types │
 │   ◀───────── formulários, cada um com o Id do seu Record Type  │
 │                                                                │
 └────────────────────────────────────────────────────────────────┘

 ┌─ AO ESCOLHER UM FORMULÁRIO ─ as duas em PARALELO ──────────────┐
 │                                                                │
 │   POST /composite ──────────────────────────▶  especificação   │
 │                                                 + dependências │
 │                                                 + schema       │
 │                                                                │
 │   GET /ui-api/…/picklist-values/{rtId} ─────▶  valores válidos │
 │                                                                │
 │   ◀──────────────────────── os dois retornos                   │
 │   monta a tela                                                 │
 │                                                                │
 └────────────────────────────────────────────────────────────────┘

 ┌─ AO ENVIAR ────────────────────────────────────────────────────┐
 │                                                                │
 │   avalia as regras  ·  monta o payload                         │
 │   POST /composite ──────────────────────────▶  Caso + filhos   │
 │   ◀───────── Caso criado                       (allOrNone)     │
 │                                                                │
 └────────────────────────────────────────────────────────────────┘
```

🟡 **INSERIR PRINT — `inspetor-chamadas.png`**
*Legenda sugerida: as chamadas efetivamente feitas, com verbo, rota e retorno — capturadas na prova de conceito.*

## 1. Ao abrir — catálogo e Record Types

Uma requisição, duas consultas.

**`POST /services/data/v66.0/composite`**

```jsonc
{
  "allOrNone": false,
  "compositeRequest": [
    {
      "method": "GET",
      "referenceId": "catalogo",
      "url": "/services/data/v66.0/query?q=SELECT+Id,+Name,+PublicLabel__c,+Description__c,+ObjectApiName__c,+TargetRecordTypeDevName__c,+QueueDeveloperName__c,+TypeFieldApiName__c,+TypeValue__c,+PriorityFieldApiName__c,+PriorityValue__c,+VersionFieldApiName__c,+FormKey__c,+Version__c,+Status__c,+VersionKey__c,+Channel__c+FROM+FormDefinition__c+WHERE+RecordType.DeveloperName+%3D+'Form'+AND+IsActive__c+%3D+true+ORDER+BY+Name"
    },
    {
      "method": "GET",
      "referenceId": "recordTypes",
      "url": "/services/data/v66.0/query?q=SELECT+Id,+DeveloperName,+Name+FROM+RecordType+WHERE+SobjectType+%3D+'Case'+AND+IsActive+%3D+true"
    }
  ]
}
```

**Por que os Record Types vêm aqui, e não depois.** A chamada de picklists exige o **Id** do Record Type na URL. Se ele só for descoberto junto com a especificação, as duas chamadas do próximo passo ficam obrigatoriamente sequenciais; resolvendo o Id na abertura, elas rodam **em paralelo**. Custa ~20 KB uma vez por sessão, e o resultado serve a todos os formulários.

A alternativa de **gravar o Id na tabela** — no momento em que operação escolhe o Record Type — foi descartada: Id de Record Type muda entre orgs, e o registro é dado migrado entre ambientes, então chegaria morto em produção. É o problema que `DeveloperName` existe para evitar.

## 2. Ao escolher — a definição do formulário

**`POST /services/data/v66.0/composite`**

```jsonc
{
  "allOrNone": false,
  "compositeRequest": [
    { "method": "GET", "referenceId": "especificacao", "url": "/services/data/v66.0/query?q=SELECT+…+FROM+FormDefinition__c+WHERE+(Id+%3D+'{formId}'+OR+Form__c+%3D+'{formId}')+AND+IsActive__c+%3D+true+ORDER+BY+Sort__c+NULLS+FIRST,+Name" },
    { "method": "GET", "referenceId": "dependentes",   "url": "/services/data/v66.0/query?q=SELECT+DurableId,+QualifiedApiName,+ControllingFieldDefinitionId+FROM+FieldDefinition+WHERE+EntityDefinition.QualifiedApiName+%3D+'Case'+AND+ControllingFieldDefinitionId+!%3D+null" },
    { "method": "GET", "referenceId": "schema",        "url": "/services/data/v66.0/query?q=SELECT+QualifiedApiName,+Label,+DataType,+Length,+InlineHelpText,+IsNillable,+IsCreatable,+IsDependentPicklist,+DurableId+FROM+EntityParticle+WHERE+EntityDefinition.QualifiedApiName+%3D+'Case'+AND+IsCreatable+%3D+true" }
  ]
}
```

**`especificacao`** traz a árvore inteira — todas as linhas do formulário, de todos os Record Types, na ordem.

**`schema`** substitui `ui-api/object-info`, que devolve todos os campos com 36 atributos cada e não aceita filtro. `EntityParticle` é SOQL comum: escolhe as colunas, e por ser SOQL cabe em composite. Num objeto `Case` com ~400 campos criáveis, a diferença medida foi de ~380 KB para ~160 KB.

**`dependentes`** existe por uma lacuna: nem `EntityParticle` nem `picklist-values` entregam o **nome** do campo que controla uma picklist dependente. O primeiro só marca `IsDependentPicklist`; o segundo devolve `controllerValues` sem nomear quem controla. `FieldDefinition.ControllingFieldDefinitionId` aponta para o `DurableId` de outro campo — que `schema` já traz. Custo: menos de 1 KB.

### Forma do retorno de `/composite` com `/query`

Todas as consultas SOQL desta RFC devolvem a mesma forma. Um exemplo real, abreviado:

```jsonc
{
  "compositeResponse": [
    {
      "referenceId": "especificacao",
      "httpStatusCode": 200,
      "body": {
        "totalSize": 38,
        "done": true,
        "records": [
          {
            "attributes": { "type": "FormDefinition__c", "url": "/services/data/…/a0x…" },
            "Id": "a0x…", "Name": "Papel",
            "RecordType": { "DeveloperName": "Field" },
            "Parent__c": "a0x…", "Sort__c": 1,
            "FieldApiName__c": "Type__c", "IsRequired__c": false, "Width__c": "FULL"
          }
          // … demais linhas
        ]
      }
    }
    // … demais referenceIds
  ]
}
```

Três pontos de atenção para quem consumir:

* O `referenceId` volta na resposta. **Mapeie por nome, não por posição** — assim uma subrequisição a mais no meio não desalinha nada.
* `httpStatusCode` é **por subrequisição**. Com `allOrNone: false`, uma que falha falha sozinha e as outras continuam válidas.
* **`done: false` é resultado errado, não parcial** — ver abaixo.

**Use `/composite`, não `/composite/batch`.** O batch devolve query cortada — `done: false` com parte dos registros — junto de um status 200, e o sintoma é um formulário sem seção nenhuma, sem erro. O `/composite` não apresentou o problema em nenhum teste, e é mais rápido.

Ainda assim, **confira `done` em toda subrequisição** e refaça fora do lote o que voltar cortado. Conferir custa uma comparação; não conferir custa uma falha invisível.

## 3. Ao escolher — valores de picklist

**`GET /services/data/v66.0/ui-api/object-info/Case/picklist-values/{recordTypeId}`**

É a única chamada que permanece na UI API, e a única que **não** entra em composite — o endpoint recusa recursos de `ui-api` com `INVALID_BATCH_REQUEST`.

Ela permanece porque é a única fonte que respeita Record Type **e** devolve as dependências entre picklists. Não há substituto em SOQL.

### Forma do retorno

```jsonc
{
  "picklistFieldValues": {
    "SI_BankType__c": {
      "controllerValues": {},
      "defaultValue": null,
      "eTag": "7b015839ce7f6b65d372e638075808c9",
      "url": "/services/data/v66.0/ui-api/object-info/Case/picklist-values/{rtId}/SI_BankType__c",
      "values": [
        { "attributes": null, "label": "Banco Digital", "validFor": [], "value": "BancoDigital" },
        { "attributes": null, "label": "Banco Físico",  "validFor": [], "value": "BancoFisico"  }
      ]
    },

    "CollectionAddress__StateCode__s": {
      "controllerValues": { "BR": 30, "US": 233, "…": 0 },
      "values": [
        { "label": "São Paulo", "value": "SP", "validFor": [30] },
        { "label": "Texas",     "value": "TX", "validFor": [233] }
      ]
    }
  },
  "eTag": "…"
}
```

**Como ler uma picklist dependente:** `controllerValues` mapeia *valor do campo controlador* → *índice*. Cada opção traz `validFor` com os índices em que ela é válida. Para filtrar, pegue o índice do valor escolhido no controlador e mantenha só as opções cujo `validFor` o contém.

**Qual é o campo controlador** não vem daqui — vem da subrequisição `dependentes` do passo 2.

`values` vazio para um campo significa que ele não tem valor válido naquele Record Type.

O mesmo endpoint aceita **um campo no fim da URL** (`…/picklist-values/{rtId}/SI_BankType__c`), e aí o retorno cai de 250 KB para ~1 KB. Ver "O custo total".

## 4. Ao enviar

**`POST /services/data/v66.0/composite`**, com `allOrNone: true`.

O Caso ainda não existe quando o cliente preenche, então os itens de lista não têm o Id do pai para gravar. O composite resolve dentro da própria transação: o `referenceId` da primeira subrequisição vira `@{refPai.id}` nas seguintes.

```jsonc
{
  "allOrNone": true,
  "compositeRequest": [
    {
      "referenceId": "refPai",
      "method": "POST",
      "url": "/services/data/v66.0/sobjects/Case",
      "body": {
        "RecordTypeId": "012…",
        "Type": "BankDataChange",
        "SI_RequesterType__c": "Proprietario",
        "SI_BankBranch__c": "0001"
      }
    },
    {
      "referenceId": "item1",
      "method": "POST",
      "url": "/services/data/v66.0/sobjects/CaseMember__c",
      "body": { "Name": "João Souza", "Case__c": "@{refPai.id}" }
    },
    {
      "referenceId": "registroCriado",
      "method": "GET",
      "url": "/services/data/v66.0/sobjects/Case/@{refPai.id}?fields=Id,CaseNumber,Status"
    }
  ]
}
```

`allOrNone: true` **aqui**, ao contrário das leituras: um Caso sem os registros filhos que o justificam é pior que erro nenhum — a pessoa reenviaria e criaria um Caso duplicado.

**Ao ler o erro, procure a falha raiz.** Quando o pai falha, os filhos reportam `Could not find the referenced operation`; quando um filho falha, o pai reporta `PROCESSING_HALTED`. Nos dois casos, a mensagem que interessa é a única que **não** é uma dessas duas.

🟡 **INSERIR PRINT — `inspetor-payload.png`**
*Legenda sugerida: o payload montado antes do envio — os campos injetados pelo back-end, o campo oculto, e o filho referenciando `@{refPai.id}`.*

## O custo total

Medido com um formulário de 38 linhas de definição, contra um `Case` com ~400 campos criáveis e ~90 Record Types ativos. Mediana de cinco execuções.

| Quando | Chamada | Peso | Tempo |
| :---- | :---- | ----: | ----: |
| ao abrir, **uma vez** | `composite` — catálogo + Record Types | 20,2 KB | 190 ms |
| por formulário | `composite` — especificação + dependentes + schema | 209,1 KB | 210 ms |
| por formulário | `ui-api` — picklists | 260,4 KB | 1.035 ms |

Montar um formulário custa **469,5 KB**, e ~950 ms com as duas chamadas em paralelo — contra ~1.200 ms em sequência. É esse ganho que justifica resolver o Record Type na abertura.

**Onde o custo está: 89% do peso é metadado do objeto, não do formulário.** A definição inteira custa 48,7 KB. Daí saem as duas otimizações de maior impacto, nenhuma aplicada na prova de conceito:

* O **schema não muda entre formulários do mesmo objeto** — cache por sessão elimina 160 KB de toda troca no seletor.
* As **picklists são 55% do peso e 87% do tempo** — a versão por campo troca 260 KB por ~12 KB concorrentes.

## Campos gravados sem passar pelo formulário

Estes campos são gravados pelo consumidor e **nunca** aceitos do cliente:

| Campo | Origem |
| :---- | :---- |
| `RecordTypeId` | resolvido a partir de `TargetRecordTypeDevName__c` da raiz |
| campo de `TypeFieldApiName__c` | `TypeValue__c` da raiz (ex.: `Type = BankDataChange`) |
| campo de `PriorityFieldApiName__c` | `PriorityValue__c` da raiz |
| campo de `VersionFieldApiName__c` | `VersionKey__c` da raiz (`bank_data_change#2`): identifica qual formulário e versão criou o registro |
| `OwnerId` | fila resolvida por `QueueDeveloperName__c` |
| campo de cada `Reference` | o id externo do registro que o cliente escolheu, **como texto** no próprio campo (`RelatedContractId__c`). O Salesforce resolve o lookup depois, sem travar a criação |

Isso não é detalhe de implementação: se o Record Type vier do cliente, quem editar a requisição escolhe em que Record Type o registro nasce — e com ele o roteamento, o layout e as regras de atendimento. O mesmo vale para uma referência: o consumidor manda o id que o cliente escolheu, e o vínculo é feito no Salesforce.

Se a implementação otimizar recebendo o Record Type já resolvido (como o passo 1 permite), **o valor recebido deve ser tratado como palpite**: comparar com `TargetRecordTypeDevName__c` da especificação e descartar se divergir. A divergência também acontece sem má-fé — basta o catálogo estar velho em cache depois de operação trocar o Record Type do formulário.

## O que sai disso

As capturas abaixo são o mesmo formulário renderizado a partir da definição da Etapa 1, pelas chamadas desta etapa, **sem uma linha de código específica para ele**. Servem de referência do que o consumidor precisa construir.

🟡 **INSERIR PRINT — `form-condicional.png`**
*Legenda sugerida: visibilidade e obrigatoriedade condicional. A seção só aparece porque o solicitante é Parceiro; dentro dela, o CPF ganhou o asterisco pela mesma razão.*

🟡 **INSERIR PRINT — `form-validacao.png`**
*Legenda sugerida: validação customizada. A condição `BLOCK` bateu e a mensagem da regra apareceu; o envio fica travado enquanto ela estiver valendo.*

🟡 **INSERIR PRINT — `form-lista.png`**
*Legenda sugerida: lista repetível. Cada item vira um registro filho ligado ao Caso. Rótulo do item e texto do botão vêm da definição; mínimo e máximo são validados no envio.*

🟡 **INSERIR PRINT — `form-anexos.png`**
*Legenda sugerida: anexos como componente posicionado, não como bloco no fim. Cada um carrega código do documento, tipos aceitos e limites — e pode ter condição própria.*

## Proposta de modelo para contrato

> Esta seção é **proposta, não especificação.** O formato entregue ao front é decisão de quem constrói o BFF. Está aqui porque a prova de conceito precisou de um, e o formato abaixo cobriu os 53 formulários do corpus — serve de ponto de partida, não de requisito.

A ideia é que os canais conheçam apenas esta forma, e a fonte da definição no Salesforce seja detalhe de implementação:

```jsonc
{
  "object": "Case",
  "recordType": { "id": "012…", "developerName": "…", "label": "…" },
  "sections": [{
    "id": "a0x…", "label": "Identificação", "repeating": false,
    "visibility": null,                    // { logic, expression, conditions[] }
    "fields": [{
      "kind": "field",                     // field | reference | attachment | content
      "reference": null,                   // kind=reference: { type, object, externalIdField }; o valor vai como texto
      "apiName": "SI_BankBranch__c",
      "label": "Agência", "dataType": "String", "maxLength": 10,
      "required": true, "readOnly": false, "hidden": false,
      "defaultValue": null, "helpText": null, "width": "FULL",
      "options": null,                     // preenchido em picklists
      "controllerField": null,             // picklist dependente
      "visibility": null, "requiredWhen": null,
      "validation": null                   // { message, logic, conditions[] }
    }]
  }],
  "attachments": { "required": true, "minimumCount": 2, "documents": [] },
  "backendFields": { "RecordTypeId": "012…", "Type": "BankDataChange", "Priority": "Medium" },
  "formDefinition": { "key": "bank_data_change", "version": 2 },
  "diagnostics": { "warnings": [] }
}
```

Seção com `repeating: true` carrega `childObject` e `childRelationshipField`; cada item vira um registro filho.

Três características que valem preservar em qualquer formato escolhido:

* **Um só vocabulário de condição** para visibilidade, obrigatoriedade e validação. As três são a mesma máquina com destinos diferentes; separá-las multiplica o código do avaliador por três.
* **`backendFields` explícito e separado dos campos do formulário**, para que a fronteira entre "o que o cliente preencheu" e "o que o servidor decidiu" seja visível no próprio dado.
* **`diagnostics.warnings`**, para que definição malformada — lista sem objeto filho, validação sem mensagem — apareça em vez de sumir.

### Onde avaliar as regras

O avaliador precisa rodar em **dois momentos**: ao desenhar a tela e ao montar o envio. A recomendação é que seja **o mesmo código**, chamado nos dois — se forem implementações distintas, elas divergem, e a divergência aparece como campo exigido que o usuário não consegue ver.

A validação de cliente **não substitui** enforcement no servidor. Nada impede uma requisição direta à API que ignore toda regra da definição — o que a definição descreve é a experiência, não a integridade do dado. Enforcement no lado Salesforce continua em aberto, e está em Risks.

**Cuidado com expressões `CUSTOM`.** `FilterLogic__c` é texto editado por operação. Interpretá-lo com `eval` — ou equivalente — é execução de código vindo de um registro. Use um parser próprio.

---

# Timeline

| Etapa | Entrega |
| :---- | :---- |
| 1 | Objeto de definição, configurador e um formulário piloto migrado |
| 2 | Leitura pelas APIs e renderização em um canal |
| 3 | Migração dos demais formulários, por lote |

# Dependencies

* **Salesforce Platform** — objeto customizado `FormDefinition__c`, o configurador LWC, e os campos de destino no `Case`.
* **External Client App** com OAuth 2.0 Client Credentials, para o consumidor autenticar como aplicação. A chave e o segredo são gerados **por org** e não vêm no metadata: cada ambiente tem o seu par, e o usuário "Run As" precisa ser definido manualmente em Setup.
* **Permission set** com FLS de leitura sobre `FormDefinition__c` e sobre todo campo usado por algum formulário. Administrador **não** recebe FLS automático em campo customizado implantado por metadata, e a API REST reporta campo sem FLS como `No such column` — o erro parece de campo inexistente.
* **Objetos de destino dos itens de lista** (ex.: `CaseMember__c`), com o campo de vínculo ao Caso.

# Alternatives Considered & Prior Art

Quatro fontes de definição foram implementadas e comparadas.

| Fonte | Estrutura vem de | Por que não foi escolhida |
| :---- | :---- | :---- |
| **Page Layout** (UI API) | `ui-api/layout` | O layout não modela condição nem anexo. Exigiu dois objetos de apoio, e o layout devolvido depende do *profile* do usuário autenticado — o formulário sai diferente sem nada acusar |
| **`record-defaults/create`** | UI API | Devolve o objeto inteiro para montar um formulário de 15 campos. Mais dado, menos controle |
| **Screen Flow** | Tooling API | Visibilidade e anexo nativos, mas **não** aceita obrigatoriedade em campo vinculado ao objeto — os dois recursos são mutuamente exclusivos no metadado do Flow. Ler Flow pela Tooling também exige três permissões de Setup, e com elas o usuário de integração enxerga todos os flows da org |
| **Objeto customizado** | `FormDefinition__c` | **A proposta.** Nada é nativo — tudo foi construído — mas nada esbarra em limite de estrutura alheia |

O que decidiu foi o item da obrigatoriedade condicional: é requisito do corpus, e é o único ponto sem contorno no Screen Flow.

# Operations

A mudança operacional é que **operação passa a manter formulários dentro do Salesforce**, no configurador, sem abrir demanda para engenharia.

Um formulário novo com campos que já existem é trabalho de operação, do começo ao fim. Campo novo no `Case` continua sendo metadado e exige deploy — e é o único caso que atravessa a fronteira.

Formulário publicado é o que tem `IsActive__c = true` na raiz. Não há versionamento: editar um formulário ativo muda o que o próximo cliente vê. Se controle de versão for requisito, é desenho adicional.

# Observability

* **Definição malformada** — lista sem objeto filho, validação sem mensagem, Record Type inexistente, campo sem FLS. Devem virar aviso estruturado no retorno do consumidor, e não falha silenciosa.
* **Formulário que não monta** — taxa de erro por formulário, para distinguir problema de definição de problema de integração.
* **Envio rejeitado por validação** — quais regras mais barram, e em quais formulários. É sinal de formulário mal desenhado, não de erro técnico.
* **Peso e latência das chamadas de leitura**, com atenção à chamada de picklists, que é a maior do fluxo.

# Security & Privacy & Compliance

Os formulários coletam **dado pessoal de cliente final** — nome, documento, dados bancários e, em vários casos, documento com foto. A mudança traz esse dado para dentro do perímetro do Salesforce, o que é um ganho em relação ao arranjo atual.

Pontos que precisam de decisão antes de produção:

* **Autenticação do cliente final.** Nada nesta RFC identifica quem preenche. Sem isso, quem tiver o link cria Caso em nome de terceiro.
* **Superfície do usuário de integração.** Ele precisa de FLS de leitura sobre os campos usados e de criação sobre o objeto de destino — e de nada mais. Nenhuma permissão de Setup é necessária nesta proposta, diferente da alternativa por Screen Flow.
* **Expressões `CUSTOM` são dado editável por operação.** Interpretá-las como código seria injeção com privilégio de servidor.
* **Retenção de anexos.** Documento com foto entra na org e passa a seguir a política de retenção dela.

# Risks

* **Enforcement só no cliente.** A definição descreve a experiência, não a integridade do dado: uma requisição direta à API ignora toda regra. Se a regra for de negócio e não de usabilidade, precisa existir também como Validation Rule ou trigger. Esta RFC não resolve isso.
* **Sem versionamento de formulário.** Editar um formulário ativo muda o que o próximo cliente vê, sem trilha.
* **A tabela é compartilhada e sem integridade referencial de papel.** Nada no objeto impede uma linha `Field` com `Body__c` preenchido ou uma `Rule` sem `Parent__c`. A validação vive no configurador; quem escrever registros por API ou Data Loader contorna. É o custo do desenho de tabela única, e a delimitação por Record Type nesta RFC é a mitigação.
* **Anexos ainda não implementados de ponta a ponta.** A definição descreve o que é exigido; o upload real, o vínculo ao Caso e a validação de tamanho e tipo no servidor não foram construídos.
* **Migração dos 53 formulários é trabalho manual.** Não existe importador do Cognito. O corpus está catalogado, mas cada formulário precisa ser remontado.
* **Volume de Record Types no objeto.** A chamada de abertura traz todos os Record Types ativos do objeto. Em orgs com centenas, vale escopar por canal.
