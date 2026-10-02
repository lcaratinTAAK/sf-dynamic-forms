# FormDefinition__c — guia de integração

Referência da tabela que descreve um formulário dinâmico no Salesforce, para quem vai converter as linhas no formato do serviço de SI. Cobre o que ler, em que ordem, e o que gravar no submit.

Fonte de verdade: `force-app/main/default/objects/FormDefinition__c` na branch `feat/swss-3936-sf-forms` do repo `quintoandar/salesforce`. Exemplos abaixo vieram da scratch `dynamic-forms`, formulário `bank_data_change#2`.

## 1. Como a tabela funciona

- **Uma tabela, oito papéis.** Toda linha é um `FormDefinition__c`. O Record Type (`RecordType.DeveloperName`) diz o que a linha é: `Form`, `Section`, `RepeatingSection`, `Field`, `Reference`, `Attachment`, `Content`, `Rule`.
- **`Form__c` aponta para a raiz em toda linha que não é raiz.** É o que permite trazer a definição inteira em uma SOQL: `WHERE Id = :formId OR Form__c = :formId`.
- **`Parent__c` monta a árvore.** Vazio na raiz e nos filhos diretos dela (seções, listas). Em `Rule`, aponta para o componente que a regra afeta.
- **Uma linha usa só as colunas do seu Record Type.** As demais voltam nulas ou com o valor padrão da picklist (`Effect__c = SHOW`, `Width__c = FULL`, `FilterLogicType__c = ALL`, `Channel__c = ONLINE`). Esses defaults em linhas de outro tipo não significam nada. Leia cada linha pela tabela do seu RT e ignore o resto.
- **Versões.** Cada versão de um formulário é uma raiz própria. `FormKey__c` é a identidade estável; `Version__c` numera; `IsActive__c = true` só na versão que está servindo, e é o único filtro que o consumidor precisa. Referencie formulários pela chave, nunca pelo Id, que muda a cada versão.

### Quem lê cada coluna

Cada tabela abaixo tem a coluna **Quem lê**. Ela diz quem precisa **consultar** o campo. Não diz o que vai no registro criado: isso está na seção 12, e é bem menos do que se lê.

| Quem lê | Significa |
| :-- | :-- |
| Front | A consulta do front precisa dele para renderizar o formulário e avaliar as regras na tela |
| Submit | O back-end do SI precisa dele para **montar** o envio: em que objeto criar, em que campo gravar a versão, quais campos ocultos levam valor fixo, quais não enviar, como ligar itens de lista. Colunas de validação não entram aqui: validar é tarefa da consulta do front |
| Front · Submit | As duas consultas precisam dele: o objeto de destino, a chave do formulário, a estrutura da árvore (`Form__c`, `Parent__c`), os campos ocultos com valor fixo |
| Interno | Só o Salesforce lê. **Não selecione**: pode ser removido sem aviso, e uma query que o cita quebraria |

A divisão de responsabilidade no submit: o SI manda as respostas (referências incluídas, como texto), os campos ocultos com valor fixo e a chave da versão. Record Type, tipo, prioridade, fila e caso auxiliar são resolvidos **dentro do Salesforce** a partir dessa chave, por automação nossa. Por isso essas colunas são Interno.

Regra prática: selecione só o que o seu lado lê. Coluna a menos na SOQL é coluna que pode mudar no Salesforce sem quebrar a integração.

### Colunas comuns a todas as linhas

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Nome | `Name` | Text(80) | Front | Nome interno da linha. Na raiz, cai como rótulo quando `PublicLabel__c` está vazio. Em `Content` e `Rule` é só identificação. |
| Tipo de registro | `RecordType.DeveloperName` | — | Front · Submit | O papel da linha. Sempre selecione. |
| Formulário | `Form__c` | Lookup(FormDefinition__c) | Front · Submit | A raiz. Preenchido em toda linha não-raiz, inclusive regras e anexos. |
| Componente pai | `Parent__c` | Lookup(FormDefinition__c) | Front · Submit | Vazio = filho direto da raiz. Em `Rule`, o componente afetado. Em `Field`, diz se o campo é da lista ou do objeto principal. |
| Ordem | `Sort__c` | Number(6,0) | Front | Ordem entre irmãos. Em `Rule` é também o número da regra referenciado por `FilterLogic__c`. |
| Ativo | `IsActive__c` | Checkbox | Front | Filtro, não valor: toda consulta leva `IsActive__c = true` no WHERE. Na raiz, marca a versão que está servindo. Nas demais linhas, `false` significa "ignore esta linha". Nada disso é enviado. |

## 2. Record Types

| Record Type | O que é | Pai | Filhos |
| :-- | :-- | :-- | :-- |
| `Form` | a raiz; o que o catálogo lista | — | Section, RepeatingSection e componentes soltos |
| `Section` | agrupamento visual; pode ter visibilidade própria | raiz | Field, Attachment, Content |
| `RepeatingSection` | lista repetível; cada item vira um registro de outro objeto | raiz | Field (que endereçam o objeto filho) |
| `Field` | um campo do objeto de destino | Section, RepeatingSection ou raiz | Rule |
| `Reference` | um campo de texto em que o usuário **escolhe** um registro de outro objeto (contrato, imóvel) | Section ou raiz | Rule |
| `Attachment` | documento exigido, posicionado como componente | Section ou raiz | Rule |
| `Content` | bloco de texto HTML fixo | Section ou raiz | Rule |
| `Rule` | uma condição (mostrar, exigir ou bloquear) | o componente afetado | — |

## 3. As consultas

**Catálogo, para o front: uma linha por formulário, só versões ativas.**

```sql
SELECT Id, Name, FormKey__c, PublicLabel__c, Description__c, Channel__c,
       ObjectApiName__c, TargetRecordTypeDevName__c
FROM FormDefinition__c
WHERE RecordType.DeveloperName = 'Form' AND IsActive__c = true
ORDER BY Name
```

**Definição para o front, em uma ida.** `formId` é o Id da raiz vindo do catálogo. Só colunas de renderização.

```sql
SELECT Id, Name, RecordType.DeveloperName, Form__c, Parent__c, Sort__c, IsActive__c,
       FormKey__c, PublicLabel__c, Description__c, Channel__c, ObjectApiName__c, TargetRecordTypeDevName__c,
       FieldApiName__c, LabelOverride__c, HelpTextOverride__c, Placeholder__c, DefaultValue__c,
       IsRequired__c, IsReadOnly__c, IsHidden__c, Width__c,
       DocumentCode__c, AcceptedTypes__c, MinFiles__c, MaxFiles__c, MaxSizeMb__c,
       ConditionFieldApiName__c, Operator__c, Value__c, ValueSource__c, Effect__c,
       ChildObjectApiName__c, MinItems__c, MaxItems__c, ItemLabel__c, AddButtonText__c,
       FilterLogicType__c, FilterLogic__c, RequiredLogicType__c, ValidationLogicType__c, Message__c,
       Body__c,
       ReferenceType__c, ReferenceObjectApiName__c, ExternalIdFieldApiName__c
FROM FormDefinition__c
WHERE (Id = :formId OR Form__c = :formId) AND IsActive__c = true
ORDER BY Sort__c NULLS FIRST, Name
```

**Dados do submit, para o back-end do SI.** Só o que ele precisa para montar o envio: em que objeto criar, em que campo gravar a chave da versão, quais campos ocultos levam valor fixo, como ligar itens de lista. Roda na hora de criar, com a versão ativa da chave.

```sql
SELECT Id, RecordType.DeveloperName, Parent__c, Form__c,
       FormKey__c, VersionKey__c, ObjectApiName__c, VersionFieldApiName__c,
       FieldApiName__c, DefaultValue__c, IsHidden__c, IsReadOnly__c,
       ChildObjectApiName__c, ChildRelationshipField__c
FROM FormDefinition__c
WHERE (Id = :formId OR Form__c = :formId) AND IsActive__c = true
  AND RecordType.DeveloperName IN ('Form', 'RepeatingSection', 'Field', 'Reference')
```

Para resolver pela chave em vez do Id: `WHERE FormKey__c = 'bank_data_change' AND IsActive__c = true AND RecordType.DeveloperName = 'Form'` devolve a raiz ativa; depois as consultas acima com o Id dela.

Rótulo, tipo, tamanho e texto de ajuda dos campos **não** estão na tabela. Vêm do schema do objeto de destino (`EntityParticle`, ou o describe), lidos em tempo de execução pelo `FieldApiName__c`.

## 4. `Form` — a raiz

Uma versão de um formulário. É a linha que o catálogo lista. Também carrega a configuração que o Salesforce aplica ao registro quando ele nasce (Record Type, tipo, prioridade, fila): isso fica do nosso lado, o SI só precisa identificar a versão.

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Nome da API | `FormKey__c` | Text(80), External ID | Front · Submit | Identificador estável, igual em todas as versões. Imutável após a criação. É o que canais e automações referenciam. |
| Versão | `Version__c` | Number(4,0) | Interno | Sequencial dentro da chave. O consumidor não precisa dele: `VersionKey__c` já carrega o número. |
| Chave da versão | `VersionKey__c` | Text(90), único | Submit | `FormKey__c#Version__c`, ex. `bank_data_change#2`. É o valor gravado em `VersionFieldApiName__c`. |
| Status | `Status__c` | Picklist: DRAFT, ACTIVE, ARCHIVED | Interno | Ciclo de vida da versão no builder. Fora do Salesforce, use `IsActive__c`. |
| Ativo | `IsActive__c` | Checkbox | Front | `true` somente na versão ativa. É o filtro do catálogo (`IsActive__c = true`), não um valor a tratar nem a enviar. |
| Rótulo público | `PublicLabel__c` | Text(255) | Front | Rótulo exibido ao usuário final. Vazio → usar `Name`. |
| Descrição | `Description__c` | LongTextArea(32768) | Front | Para que serve o formulário, nas palavras do cliente. Texto de abertura e o que o bot usa para direcionar a solicitação. |
| Canais | `Channel__c` | MultiselectPicklist: ONLINE, MAGICLINK, BOT | Front | Onde o formulário é oferecido. Vem como `ONLINE;MAGICLINK`. |
| Objeto (API Name) | `ObjectApiName__c` | Text(80) | Front · Submit | Objeto que o formulário cria (`Case`, `CaseSI__c`). O front precisa para ler o schema dos campos; o submit, para saber onde criar. |
| Record Type de destino | `TargetRecordTypeDevName__c` | Text(80) | Front | `DeveloperName` do Record Type de destino. O front precisa para pedir os valores de picklist certos. O `RecordTypeId` do registro é preenchido no Salesforce. |
| Campo da Versão | `VersionFieldApiName__c` | Text(80) | Submit | Campo texto do objeto de destino onde o SI grava `VersionKey__c` no envio, ex. `FormVersion__c`. É o único campo de cabeçalho que o SI escreve, e é por ele que o Salesforce descobre o formulário e aplica o resto. |
| Fila | `QueueDeveloperName__c` | Text(80) | Interno | Fila que recebe o registro. Aplicada no Salesforce a partir da versão. |
| Campo do Tipo / Valor do Tipo | `TypeFieldApiName__c`, `TypeValue__c` | Text | Interno | Em que campo e com que valor o tipo é gravado. Aplicado no Salesforce. |
| Campo da Prioridade / Valor da Prioridade | `PriorityFieldApiName__c`, `PriorityValue__c` | Text | Interno | Idem para a prioridade. |
| Criar caso auxiliar? | `CreateAuxiliaryCase__c` | Checkbox | Interno | Automação do Salesforce: além do registro criado, nasce um `Case` real. |
| Tipo / Prioridade / Record Type / Fila do Caso Auxiliar | `AuxCaseType__c`, `AuxCasePriority__c`, `AuxCaseRecordTypeDevName__c`, `AuxCaseOwnerQueueDevName__c` | Text | Interno | Configuração do caso auxiliar. |

Todas as versões de uma chave, com o que o front e o submit leem da raiz:

```sql
SELECT Id, Name, FormKey__c, VersionKey__c, IsActive__c, PublicLabel__c, Description__c, Channel__c,
       ObjectApiName__c, TargetRecordTypeDevName__c, VersionFieldApiName__c
FROM FormDefinition__c
WHERE FormKey__c = 'bank_data_change' AND RecordType.DeveloperName = 'Form'
ORDER BY VersionKey__c
```

```json
{
  "Id": "a0u88000004XawrAAC",
  "Name": "Alteração de dados bancários",
  "FormKey__c": "bank_data_change",
  "VersionKey__c": "bank_data_change#2",
  "IsActive__c": false,
  "PublicLabel__c": "Alteração de dados bancários",
  "Description__c": "Use este formulário para alterar a conta bancária que recebe os repasses. Tenha em mãos um documento oficial com foto e um comprovante de titularidade da conta.",
  "Channel__c": "ONLINE;MAGICLINK;BOT",
  "ObjectApiName__c": "Case",
  "TargetRecordTypeDevName__c": "SI_Demo_BankDataChange",
  "VersionFieldApiName__c": null
}
```

Nenhum formulário da scratch tem `VersionFieldApiName__c` preenchido ainda. Em `CaseSI__c` o campo preparado para isso é `FormVersion__c`; os formulários precisam apontar para ele antes de o SI conseguir gravar a versão.

## 5. `Section` — agrupamento

Bloco visual. Pode carregar regras `SHOW` próprias: a seção inteira aparece ou some de uma vez. Só o front lê.

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Nome | `Name` | Text(80) | Front | Título da seção. |
| Lógica dos filtros | `FilterLogicType__c` | Picklist: ALL, ANY, CUSTOM | Front | Como as regras `SHOW` filhas se combinam. |
| Lógica de filtro | `FilterLogic__c` | Text(255) | Front | Expressão sobre os números das regras quando `CUSTOM`, ex. `1 AND (2 OR 3)`. Interpretar, nunca `eval`. |

```sql
SELECT Id, Name, Sort__c, FilterLogicType__c, FilterLogic__c
FROM FormDefinition__c
WHERE Form__c = :formId AND RecordType.DeveloperName = 'Section' AND IsActive__c = true
ORDER BY Sort__c
```

```json
{ "Id": "a0u88000004Xax6AAC", "Name": "Identificação", "Sort__c": 10, "FilterLogicType__c": "ALL", "FilterLogic__c": null }
{ "Id": "a0u88000004XaxAAAS", "Name": "Dados do parceiro", "Sort__c": 20, "FilterLogicType__c": "ALL", "FilterLogic__c": null }
```

A segunda seção tem uma regra `SHOW` filha (`ConditionFieldApiName__c = SI_RequesterType__c EQUALS Parceiro`): ela e todos os campos dentro dela só aparecem para parceiro.

## 6. `RepeatingSection` — lista repetível

Diferente de uma seção em três pontos: os campos filhos endereçam **outro objeto**, o envio vira um array de registros filhos, e há cardinalidade.

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Nome | `Name` | Text(80) | Front | Título da lista. |
| Objeto do item | `ChildObjectApiName__c` | Text(80) | Front · Submit | Objeto que cada item vira, ex. `CaseMember__c`. O front lê o schema dele para os campos da lista; o submit cria os itens nele. |
| Campo de vínculo com o pai | `ChildRelationshipField__c` | Text(80) | Submit | Lookup no objeto filho que aponta para o registro criado, ex. `Case__c`. |
| Mínimo de itens | `MinItems__c` | Number(3,0) | Front | Itens exigidos no envio. Vazio = 0. |
| Máximo de itens | `MaxItems__c` | Number(3,0) | Front | Itens aceitos no envio. Vazio = sem limite. |
| Rótulo do item | `ItemLabel__c` | Text(80) | Front | Nome de cada item na tela, ex. "Titular". |
| Texto do botão adicionar | `AddButtonText__c` | Text(255) | Front | Rótulo do botão que adiciona um item. |
| Lógica dos filtros / Lógica de filtro | `FilterLogicType__c`, `FilterLogic__c` | Picklist, Text | Front | Igual a `Section`. |

```sql
SELECT Id, Name, Sort__c, ChildObjectApiName__c, ChildRelationshipField__c, MinItems__c, MaxItems__c,
       ItemLabel__c, AddButtonText__c, FilterLogicType__c, FilterLogic__c
FROM FormDefinition__c
WHERE Form__c = :formId AND RecordType.DeveloperName = 'RepeatingSection' AND IsActive__c = true
ORDER BY Sort__c
```

```json
{
  "Id": "a0u88000004XaxFAAS",
  "Name": "Quem mais assina a conta",
  "Sort__c": 25,
  "ChildObjectApiName__c": "CaseMember__c",
  "ChildRelationshipField__c": "Case__c",
  "MinItems__c": null,
  "MaxItems__c": 4,
  "ItemLabel__c": "Titular",
  "AddButtonText__c": "Mais alguém assina a conta?",
  "FilterLogicType__c": "ALL"
}
```

## 7. `Field` — um campo do objeto

Vincula uma pergunta a um campo real. Rótulo, tipo, tamanho e ajuda vêm do schema; a tabela guarda só as escolhas de formulário.

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Campo do objeto (API Name) | `FieldApiName__c` | Text(80) | Front · Submit | Campo onde a resposta é gravada. Do objeto da lista quando o pai é `RepeatingSection`; do objeto de destino nos demais casos. |
| Rótulo (sobrescreve) | `LabelOverride__c` | Text(255) | Front | Substitui o rótulo do schema só neste formulário. Vazio = usar o do schema. |
| Ajuda (sobrescreve) | `HelpTextOverride__c` | Text(255) | Front | Substitui o texto de ajuda do schema só neste formulário. |
| Placeholder | `Placeholder__c` | Text(255) | Front | Texto dentro do input. |
| Valor padrão | `DefaultValue__c` | Text(255) | Front · Submit | Valor inicial. Com `IsHidden__c` grava um valor fixo que o usuário nunca vê. |
| Obrigatório | `IsRequired__c` | Checkbox | Front | Obrigatório **neste formulário**. Independente do required do objeto, que o schema já expõe. |
| Somente leitura | `IsReadOnly__c` | Checkbox | Front · Submit | Renderizado, não editável, **não enviado**. |
| Oculto no formulário | `IsHidden__c` | Checkbox | Front · Submit | Não renderizado, mas enviado com `DefaultValue__c`. |
| Largura | `Width__c` | Picklist: FULL, HALF, THIRD | Front | Largura na linha. |
| Lógica dos filtros / Lógica de filtro | `FilterLogicType__c`, `FilterLogic__c` | Picklist, Text | Front | Como as regras `SHOW` filhas se combinam. |
| Lógica da obrigatoriedade | `RequiredLogicType__c` | Picklist: ALL, ANY | Front | Como as regras `REQUIRE` filhas se combinam. |
| Lógica da validação | `ValidationLogicType__c` | Picklist: ALL, ANY | Front | Como as regras `BLOCK` filhas se combinam. |
| Mensagem de validação | `Message__c` | LongTextArea(1000) | Front | Mensagem exibida quando as regras `BLOCK` batem. Fica no campo, não na regra. `BLOCK` sem mensagem no alvo: descartar com aviso. |

```sql
SELECT Id, Name, Parent__c, Sort__c, FieldApiName__c, LabelOverride__c, HelpTextOverride__c, Placeholder__c,
       DefaultValue__c, IsRequired__c, IsReadOnly__c, IsHidden__c, Width__c,
       FilterLogicType__c, FilterLogic__c, RequiredLogicType__c, ValidationLogicType__c, Message__c
FROM FormDefinition__c
WHERE Form__c = :formId AND RecordType.DeveloperName = 'Field' AND IsActive__c = true
ORDER BY Parent__c, Sort__c
```

Campo comum, dentro da lista (`Parent__c` é a `RepeatingSection` acima, então `Name` é `CaseMember__c.Name`):

```json
{
  "Id": "a0u88000004Xax3AAC",
  "Name": "Nome",
  "Parent__c": "a0u88000004XaxFAAS",
  "Sort__c": 3,
  "FieldApiName__c": "Name",
  "LabelOverride__c": "Nome completo",
  "IsRequired__c": true,
  "IsReadOnly__c": false,
  "IsHidden__c": false,
  "Width__c": "FULL"
}
```

Campo oculto com valor fixo: não renderiza, mas cada item da lista nasce com `Type__c = Landlord`.

```json
{
  "Id": "a0u88000004XawxAAC",
  "Name": "Papel",
  "Parent__c": "a0u88000004XaxFAAS",
  "Sort__c": 1,
  "FieldApiName__c": "Type__c",
  "DefaultValue__c": "Landlord",
  "IsHidden__c": true,
  "IsRequired__c": false
}
```

## 8. `Attachment` — documento exigido

Componente posicionado, como um campo. Pode viver dentro de uma seção e ter regras próprias.

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Nome | `Name` | Text(80) | Front | Rótulo do documento na tela. |
| Código do documento | `DocumentCode__c` | Text(80) | Front · Submit | Código opaco do documento pedido, ex. `DOC_FOTO`. Repassar sem interpretar. |
| Tipos aceitos | `AcceptedTypes__c` | Text(255) | Front | Extensões separadas por vírgula, ex. `pdf,jpg,png`. Vazio = qualquer tipo. |
| Mínimo de arquivos | `MinFiles__c` | Number(6,0) | Front | Vazio com `IsRequired__c = true` → assumir 1. |
| Máximo de arquivos | `MaxFiles__c` | Number(6,0) | Front | Vazio = sem limite. |
| Tamanho máx. (MB) | `MaxSizeMb__c` | Number(6,0) | Front | Por arquivo. |
| Obrigatório | `IsRequired__c` | Checkbox | Front | Obrigatório neste formulário. |
| Largura | `Width__c` | Picklist | Front | FULL, HALF, THIRD. |
| Lógicas e mensagem | `FilterLogicType__c`, `FilterLogic__c`, `RequiredLogicType__c`, `ValidationLogicType__c`, `Message__c` | — | Front | Iguais a `Field`. |

```sql
SELECT Id, Name, Parent__c, Sort__c, DocumentCode__c, AcceptedTypes__c, MinFiles__c, MaxFiles__c, MaxSizeMb__c,
       IsRequired__c, Width__c, FilterLogicType__c, FilterLogic__c, RequiredLogicType__c, ValidationLogicType__c, Message__c
FROM FormDefinition__c
WHERE Form__c = :formId AND RecordType.DeveloperName = 'Attachment' AND IsActive__c = true
ORDER BY Parent__c, Sort__c
```

```json
{
  "Id": "a0u88000004Xax5AAC",
  "Name": "Documento oficial com foto (frente e verso)",
  "Parent__c": "a0u88000004XaxLAAS",
  "Sort__c": 10,
  "DocumentCode__c": "DOC_FOTO",
  "AcceptedTypes__c": "pdf,jpg,jpeg,png",
  "MinFiles__c": 1,
  "MaxFiles__c": 2,
  "MaxSizeMb__c": 25,
  "IsRequired__c": true,
  "Width__c": "FULL"
}
```

## 9. `Content` — bloco de texto

Só o front lê.

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Nome | `Name` | Text(80) | Front | Identificação interna. Não exibir. |
| Conteúdo | `Body__c` | LongTextArea(32768) | Front | HTML renderizado como bloco estático. É o que o usuário vê. |
| Largura | `Width__c` | Picklist | Front | FULL, HALF, THIRD. |
| Lógica dos filtros / Lógica de filtro | `FilterLogicType__c`, `FilterLogic__c` | — | Front | Regras `SHOW` filhas. |

```sql
SELECT Id, Name, Parent__c, Sort__c, Body__c, Width__c, FilterLogicType__c, FilterLogic__c
FROM FormDefinition__c
WHERE Form__c = :formId AND RecordType.DeveloperName = 'Content' AND IsActive__c = true
ORDER BY Parent__c, Sort__c
```

```json
{
  "Id": "a0u88000004XawsAAC",
  "Name": "Aviso de prazo",
  "Parent__c": "a0u88000004XaxHAAS",
  "Sort__c": 0,
  "Body__c": "<p><em>A alteração é analisada em até 2 dias úteis. A conta precisa ser de titularidade do proprietário cadastrado.</em></p>",
  "Width__c": "FULL"
}
```

## 10. `Rule` — uma condição

Uma regra é filha do componente que ela afeta e carrega um efeito. **O modo de combinação fica no alvo**, não na regra: `FilterLogicType__c` para `SHOW`, `RequiredLogicType__c` para `REQUIRE`, `ValidationLogicType__c` para `BLOCK`. A mensagem de `BLOCK` também fica no alvo (`Message__c`).

O front avalia as regras para desenhar a tela e para decidir o que trava o envio. Se o back-end quiser revalidar `REQUIRE` e `BLOCK` antes de criar, usa a mesma consulta do front.

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Componente pai | `Parent__c` | Lookup | Front | O componente afetado. Obrigatório. |
| Ordem | `Sort__c` | Number | Front | Número da regra. É o que `FilterLogic__c` do alvo referencia em `CUSTOM`. |
| Campo da condição | `ConditionFieldApiName__c` | Text(80) | Front | Campo observado. Do mesmo escopo do alvo: dentro da mesma lista, ou fora de qualquer lista. |
| Operador | `Operator__c` | Picklist | Front | `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `GREATER_THAN`, `LESS_THAN`, `IS_NULL`, `IS_NOT_NULL`. Maior/menor comparam datas antes de números. `IS_NULL`/`IS_NOT_NULL` ignoram `Value__c`. |
| Valor comparado | `Value__c` | Text(255) | Front | Interpretado conforme `ValueSource__c`. Vazio para `IS_NULL`/`IS_NOT_NULL`. |
| Origem do valor | `ValueSource__c` | Picklist: LITERAL, FIELD, TOKEN | Front | `LITERAL`: o texto como está. `FIELD`: `Value__c` é o API name de outro campo, comparação campo a campo. `TOKEN`: data relativa, `HOJE`, `HOJE+30`, `HOJE-7`, `AGORA`. |
| Efeito | `Effect__c` | Picklist: SHOW, REQUIRE, BLOCK | Front | `SHOW` torna o alvo visível quando bate; `REQUIRE` torna obrigatório; `BLOCK` marca inválido e trava o envio. A condição de `BLOCK` descreve **quando está errado**. |

Alvo sem nenhuma regra `SHOW` está sempre visível. Alvo com regras `SHOW` só aparece quando a combinação bate.

```sql
SELECT Id, Name, Parent__c, Sort__c, ConditionFieldApiName__c, Operator__c, Value__c, ValueSource__c, Effect__c
FROM FormDefinition__c
WHERE Form__c = :formId AND RecordType.DeveloperName = 'Rule' AND IsActive__c = true
ORDER BY Parent__c, Effect__c, Sort__c
```

```json
{ "Id": "a0u88000004XawzAAC", "Name": "PP multi só para proprietário", "Parent__c": "a0u88000004XaxQAAS", "Sort__c": 1,
  "ConditionFieldApiName__c": "SI_RequesterType__c", "Operator__c": "EQUALS", "Value__c": "Proprietario", "ValueSource__c": "LITERAL", "Effect__c": "SHOW" }
{ "Id": "a0u88000004XawwAAC", "Name": "Exigir quando parceiro", "Parent__c": "a0u88000004XaxEAAS", "Sort__c": 1,
  "ConditionFieldApiName__c": "SI_RequesterType__c", "Operator__c": "EQUALS", "Value__c": "Parceiro", "ValueSource__c": "LITERAL", "Effect__c": "REQUIRE" }
{ "Id": "a0u88000004XawtAAC", "Name": "Bloquear contrato em finalização", "Parent__c": "a0u88000004XaxMAAS", "Sort__c": 1,
  "ConditionFieldApiName__c": "SI_ContractStatus__c", "Operator__c": "EQUALS", "Value__c": "EmFinalizacao", "ValueSource__c": "LITERAL", "Effect__c": "BLOCK" }
```

Leitura: o alvo `a0u88000004XaxMAAS` fica inválido quando `SI_ContractStatus__c = EmFinalizacao`, e a mensagem exibida é o `Message__c` desse alvo.

Use o mesmo código de avaliação nos dois momentos. Divergência entre tela e envio aparece como campo exigido que o usuário não consegue ver.

## 11. `Reference` — um campo que aponta para outro registro

Um campo de texto em que o usuário **escolhe** um registro de outro objeto (um contrato, um imóvel) em vez de digitar. É um `Field` com a entidade declarada: ocupa lugar no grid, tem largura, obrigatoriedade e regras de visibilidade, e grava em `FieldApiName__c`. O que muda é que o front sabe **o que** o campo é sem adivinhar pelo nome, e renderiza o seletor da entidade. No app, esses campos podem ser pedidos antes do formulário; na web, entram no layout como qualquer campo.

| Rótulo | API Name | Tipo | Quem lê | Descrição |
| :-- | :-- | :-- | :-- | :-- |
| Entidade referenciada | `ReferenceType__c` | Text(40) | Front | Código da entidade: `CONTRACT`, `PROPERTY`. Diz ao front qual seletor abrir. Os valores válidos são os registros ativos de `FormBuilderAllowlist__mdt` com `Category__c = Reference` para o objeto do formulário. |
| Campo do objeto (API Name) | `FieldApiName__c` | Text(80) | Front · Submit | Campo **texto** do objeto de destino que recebe o identificador escolhido, ex. `RelatedContractId__c`. Vem do metadado, não do operador. |
| Objeto referenciado | `ReferenceObjectApiName__c` | Text(80) | Front | Objeto onde a entidade vive, ex. `Contract`, `Property__c`. O seletor do app lista registros dele. |
| Campo de ID externo | `ExternalIdFieldApiName__c` | Text(80) | Front | Qual identificador do registro escolhido vai no texto, ex. `ExternalId__c`. |
| Rótulo (sobrescreve) | `LabelOverride__c` | Text(255) | Front | Rótulo do campo na tela, ex. "Qual contrato?". |
| Ajuda (sobrescreve) | `HelpTextOverride__c` | Text(255) | Front | Texto de ajuda. |
| Obrigatório | `IsRequired__c` | Checkbox | Front | Obrigatório neste formulário. |
| Largura | `Width__c` | Picklist | Front | FULL, HALF, THIRD. |
| Lógicas | `FilterLogicType__c`, `FilterLogic__c`, `RequiredLogicType__c`, `ValidationLogicType__c`, `Message__c` | — | Front | Iguais a `Field`: aceita regras `SHOW`, `REQUIRE` e `BLOCK`. |

```sql
SELECT Id, Name, Parent__c, Sort__c, ReferenceType__c, FieldApiName__c, ReferenceObjectApiName__c, ExternalIdFieldApiName__c,
       LabelOverride__c, HelpTextOverride__c, IsRequired__c, Width__c, FilterLogicType__c, FilterLogic__c
FROM FormDefinition__c
WHERE Form__c = :formId AND RecordType.DeveloperName = 'Reference' AND IsActive__c = true
ORDER BY Parent__c, Sort__c
```

```json
{ "Id": "a0u88000004Z74LAAS", "Name": "Contrato", "Parent__c": "a0u88000004Xax6AAC", "Sort__c": 80,
  "ReferenceType__c": "CONTRACT", "FieldApiName__c": "RelatedContractId__c",
  "ReferenceObjectApiName__c": "Contract", "ExternalIdFieldApiName__c": "ExternalId__c",
  "LabelOverride__c": "Qual contrato?", "IsRequired__c": true, "Width__c": "FULL" }
```

**No submit o valor vai como texto**, no próprio `FieldApiName__c`: `"RelatedContractId__c": "ctr_8821"`. Nada de lookup, nada de chave externa na relação. O Salesforce procura o registro em `ReferenceObjectApiName__c` pelo `ExternalIdFieldApiName__c` e, se achar, preenche o lookup correspondente; se não achar, o registro é criado mesmo assim, com o texto. É a mesma garantia do Magic Link hoje, só que com o campo declarado em vez de adivinhado.

As referências disponíveis por objeto, com o campo de texto e o lookup que o Salesforce preenche:

```sql
SELECT MasterLabel, ApiName__c, SourceObjectApiName__c, SourceFieldApiName__c,
       ReferenceObjectApiName__c, ExternalIdFieldApiName__c, TargetLookupApiName__c
FROM FormBuilderAllowlist__mdt
WHERE Category__c = 'Reference' AND IsActive__c = true
ORDER BY SourceObjectApiName__c, MasterLabel
```

## 12. O que gravar no submit

O SI cria o registro em `ObjectApiName__c` com três coisas. Nada além disso.

| O que vai | De onde vem |
| :-- | :-- |
| as respostas dos campos | o formulário preenchido, pelo `FieldApiName__c` de cada `Field` e `Reference` (referência vai como texto) |
| campos com `IsHidden__c` | `DefaultValue__c`, sem pergunta |
| a chave da versão, no campo em `VersionFieldApiName__c` | `VersionKey__c` da versão ativa, ex. `bank_data_change#2`. É como o Salesforce descobre qual formulário criou o registro |

Campos com `IsReadOnly__c` não são enviados. Campos ocultos por regra `SHOW` não são enviados.

**Record Type, tipo, prioridade, fila e caso auxiliar não são enviados.** O Salesforce lê a chave da versão no registro recém-criado, encontra a raiz do formulário e aplica isso por automação. Se o SI mandar esses campos, eles serão sobrescritos.

Criação simples, formulário em `CaseSI__c` sem lista:

```http
POST /services/data/v66.0/sobjects/CaseSI__c
{
  "FormVersion__c": "iptu_demands#2",
  "RelatedContractId__c": "ctr_8821",
  "RequesterType__c": "Proprietario",
  "IptuRequestType__c": "Desmembramento"
}
```

Com lista repetível, uma transação (`allOrNone: true`): o pai e cada item, ligados pelo `ChildRelationshipField__c`.

```http
POST /services/data/v66.0/composite
{
  "allOrNone": true,
  "compositeRequest": [
    { "referenceId": "pai", "method": "POST", "url": "/services/data/v66.0/sobjects/CaseSI__c",
      "body": { "FormVersion__c": "bank_data_change_full#3", "RequesterType__c": "Proprietario", "...": "..." } },
    { "referenceId": "item1", "method": "POST", "url": "/services/data/v66.0/sobjects/CaseMember__c",
      "body": { "Case__c": "@{pai.id}", "Name": "Maria", "Type__c": "Landlord" } }
  ]
}
```

## 13. Depois do submit: o SLA do caso gerado

> Guia dedicado, com a requisição HTTP, os erros e como derivar o status: [`SLA-Caso-Gerado.md`](SLA-Caso-Gerado.md).

O submit não cria o Caso, cria o **registro do formulário**. O Caso nasce depois, por automação, com o Id desse registro em `Case.RelatedCaseFormSubmission__c`. O processo de direito do Caso cria então os `CaseMilestone`, um por prazo correndo. O SLA é o milestone cujo tipo (`MilestoneType.Name`) está na lista abaixo.

```
registro do envio  ──automação──▶  Case  ──processo de direito──▶  CaseMilestone
  (o Id do POST)              RelatedCaseFormSubmission__c        CaseId · MilestoneTypeId
```

Há dois caminhos até os milestones, e os dois chegam nos mesmos registros. Muda só qual Id o SI tem na mão.

| | filtra por | quando usar |
| :-- | :-- | :-- |
| **A · pelo envio** | `Case.RelatedCaseFormSubmission__c = :submissionId` | logo depois do submit, com o Id que o POST devolveu. Não precisa conhecer o Caso, e cada milestone volta com `CaseId`. |
| **B · pelo Caso** | `CaseId = :caseId` | quando o Caso já é conhecido. Logo depois do submit o SI não tem esse Id: precisaria de `SELECT Id FROM Case WHERE RelatedCaseFormSubmission__c = :submissionId` antes. |

**A · pelo envio**

```sql
SELECT FIELDS(ALL), MilestoneType.Name
FROM CaseMilestone
WHERE Case.RelatedCaseFormSubmission__c = :submissionId
  AND MilestoneType.Name IN (
    'Agents',
    'SLA de atendimento',
    'SLA de atendimento - Closing - Anexos, Aditivos, Docs e Preferências',
    'SLA de atendimento - FR',
    'Reparos - Incêndio - 5 dias',
    'GeneralPreContractRequirements',
    'GeneralPreContractRequirements - 25 dias',
    'ListingQuality 2 Dias SLA',
    'Photos - SLA - 1 day',
    'Photos - SLA - 2 days',
    'Photography - SLA - 1 day',
    'Placas - Agendamento - SLA - 2 dias',
    'Lockbox - Logistica - SLA - 1 dia',
    'Reembolso de Reparos - SLA - 2 Dias',
    'Reparos - Contestação de responsibillidade ou criticidade - SLA - 3 Dias',
    'Reparos – Vistoriador Danificou o Imóvel',
    'SLA Total do Atendimento - Comum',
    'SLA Total do Atendimento - Emergencial',
    'SLA Total do Atendimento - Urgente'
  )
LIMIT 200
```

**B · pelo Caso**: a mesma consulta, trocando a linha do `WHERE` por `WHERE CaseId = :caseId`.

Na rede: `GET /services/data/v66.0/query?q=<SOQL percent-encoded>`.

Os nomes são comparados **como estão na org**, letra por letra. "Reparos – Vistoriador Danificou o Imóvel" usa travessão (–), não hífen, e "responsibillidade" é a grafia que existe lá. Corrigir um deles faz o tipo sumir do resultado sem erro nenhum.

O retorno é o padrão do `/query`, um registro por milestone. Este é real, capturado no FornoV1 em 02/10/2026: o SLA de atendimento do caso 00086283, que nasceu de um envio de formulário.

```json
{
  "totalSize": 1,
  "done": true,
  "records": [
    {
      "attributes": { "type": "CaseMilestone", "url": "/services/data/v66.0/sobjects/CaseMilestone/555be00000uWhhhAAC" },
      "MilestoneType": {
        "attributes": { "type": "MilestoneType", "url": "/services/data/v66.0/sobjects/MilestoneType/557bL0000000NuMQAU" },
        "Name": "SLA de atendimento"
      },
      "Id": "555be00000uWhhhAAC",
      "CaseId": "500be00000K8ULaAAN",
      "StartDate": "2026-10-01T13:59:15.000+0000",
      "TargetDate": "2026-10-08T13:59:00.000+0000",
      "CompletionDate": null,
      "MilestoneTypeId": "557bL0000000NuMQAU",
      "IsCompleted": false,
      "IsViolated": false,
      "SystemModstamp": "2026-10-01T13:59:15.000+0000",
      "CreatedDate": "2026-10-01T13:59:15.000+0000",
      "CreatedById": "005be00000GNTUuAAP",
      "LastModifiedDate": "2026-10-01T13:59:15.000+0000",
      "LastModifiedById": "005be00000GNTUuAAP",
      "IsDeleted": false,
      "TargetResponseInMins": 7200,
      "TargetResponseInHrs": 120,
      "TargetResponseInDays": 5,
      "TimeRemainingInMins": "5541:47",
      "TimeRemainingInHrs": "92:21",
      "TimeRemainingInDays": 3.8484675462962965,
      "ElapsedTimeInMins": null,
      "ElapsedTimeInHrs": null,
      "ElapsedTimeInDays": null,
      "TimeSinceTargetInMins": "00:00",
      "TimeSinceTargetInHrs": "00:00",
      "TimeSinceTargetInDays": 0,
      "BusinessHoursId": "01mbL000000AB2DQAW"
    }
  ]
}
```

| Coluna | Tipo | O que é |
| :-- | :-- | :-- |
| `MilestoneType.Name` | string | O nome do tipo, que diz **qual** prazo é. Não vem no `FIELDS(ALL)`: precisa ser pedido ao lado. |
| `CaseId` | Id | O Caso. Na variante A, é como o SI descobre qual Caso nasceu do envio. |
| `MilestoneTypeId` | Id | O Id do tipo. O nome está em `MilestoneType.Name`. |
| `StartDate` | datetime | Quando o relógio começou. |
| `TargetDate` | datetime | O prazo. Já respeita o horário comercial de `BusinessHoursId`. |
| `CompletionDate` | datetime \| null | Quando foi concluído. `null` enquanto aberto. |
| `IsCompleted` | boolean | Concluído. |
| `IsViolated` | boolean | Passou do prazo. Pode vir `true` junto com `IsCompleted`: concluído fora do prazo. |
| `TargetResponseInMins` | number | A meta, em tempo de horário comercial; `…InHrs` e `…InDays` são a mesma meta em outra unidade. Por isso o prazo não é `StartDate` + meta: no exemplo, 7.200 min são 5 dias úteis, e `TargetDate` caiu 7 dias corridos depois. O prazo é sempre `TargetDate`. |
| `TimeRemainingInMins` | string | O que falta, como **texto** `"mm:ss"`, não número. `…InHrs` é `"hh:mm"`; `…InDays` é número. |
| `TimeSinceTargetInMins` | string | Há quanto tempo venceu, `"mm:ss"`. Vem `"00:00"`, não `null`, enquanto está dentro do prazo. |
| `ElapsedTimeInMins` | number \| null | Tempo até a conclusão. `null` enquanto aberto. |

Cuidados (todos conferidos no FornoV1):

- **`FIELDS(ALL)` exige `LIMIT` de no máximo 200** na API. Sem ele a consulta é recusada inteira, com `MALFORMED_QUERY`.
- **O campo é `CaseId`**, não `Case`. `WHERE Case = '500…'` não compila; `Case.` só serve para atravessar o relacionamento, como na A.
- **O nome do tipo não vem no `FIELDS(ALL)`**, que não traz relacionamento. Com vários tipos na lista, é o nome que diz qual prazo é qual, por isso a consulta pede `MilestoneType.Name` ao lado. A API aceita a mistura.
- **O mesmo tipo pode vir repetido.** Quando o prazo recomeça, o milestone anterior é concluído e um novo começa (no FornoV1, o caso `500be00000Du7NEAAZ` tem três "SLA de atendimento"). O vigente é o de `IsCompleted = false`; para histórico, ordene por `StartDate`.
- **Para produção, prefira listar as colunas.** Pesa uma fração e não tem o teto de 200:

  ```sql
  SELECT Id, CaseId, MilestoneType.Name, StartDate, TargetDate, CompletionDate,
         IsCompleted, IsViolated, TargetResponseInMins, TimeRemainingInMins, TimeSinceTargetInMins
  FROM CaseMilestone
  WHERE Case.RelatedCaseFormSubmission__c = :submissionId
    AND MilestoneType.Name IN (...)
  ```

- **Zero registros logo depois do submit não é erro.** Ver casos de borda.

A POC expõe as duas variantes em `GET /api/sla?submissionId=…` e `GET /api/sla?caseId=…`, e mostra o resultado na aba Demo depois de criar o registro. A lista de tipos que ela usa está em `server/sla.js`. No FornoV1, as duas variantes devolvem o mesmo milestone para o mesmo envio, os 19 tipos da lista existem com o nome exato, e um milestone fora da lista ("Primeiro contato de e-mail", no mesmo caso) fica de fora.

## 14. Casos de borda

- **Objeto sem Record Types customizados** (`CaseSI__c`): `TargetRecordTypeDevName__c` não resolve para nenhum Record Type. Para os valores de picklist, usar o Record Type padrão do objeto (`defaultRecordTypeId` do object-info). Em objeto que **tem** Record Types (`Case`), um nome que não resolve é erro de configuração; não cair no padrão.
- **`CUSTOM` sem `FilterLogic__c`**: tratar como `ALL` e avisar.
- **`BLOCK` em alvo sem `Message__c`**: descartar a regra e avisar.
- **`MinFiles__c` vazio com `IsRequired__c`**: assumir 1.
- **Regra apontando para campo fora do escopo** (campo da lista observado por regra de fora dela, ou vice-versa): não avaliar; tratar como não batida.
- **SLA vazio logo depois do submit**: o Caso nasce por automação e só ganha milestone se entrar num processo de direito. Uma consulta da seção 13 no mesmo segundo do envio pode chegar antes. Tentar de novo depois de alguns segundos; vazio não é falha do submit.
- **Referência sem correspondência**: o texto enviado em um `Reference` não bate com nenhum registro. O registro do formulário é criado mesmo assim; o lookup fica vazio e a operação resolve depois. Não é erro do SI.
- **Linha com `IsActive__c = false`** fora da raiz: ignorar, com seus filhos.
- **Versão**: se o cliente guardou o Id da raiz, ele para de valer na próxima ativação. Guardar `FormKey__c` e resolver a raiz ativa a cada abertura.
- **Colunas `Interno`**: não aparecem em nenhuma consulta deste guia de propósito. Se uma delas entrar numa SOQL do SI, a remoção do campo no Salesforce passa a quebrar a integração.
