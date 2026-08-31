# URLs usadas pela POC

> **Este documento é histórico.** Foi escrito na fase das três primeiras fontes,
> antes da `formspec` existir, e a org que ele cita já foi apagada — os Ids
> abaixo não resolvem mais. Os `composite/batch` também não refletem o código
> atual: as leituras migraram para `/composite`, porque o batch devolve query
> cortada com status 200 (ver `ESTADO.md`, conclusão 1).
>
> **A referência viva é a coleção Postman**, em `postman/`: ela roda contra a
> org e é verificada por `newman`, então não tem como divergir em silêncio. Para
> a fonte Custom em específico, ver `RFC-Formularios-Dinamicos.md`.
>
> O que continua valendo aqui são os **experimentos** — a Tooling dentro do
> lote, as alternativas investigadas e por que cada uma foi descartada.

Org: `benvi2-scratch-org` — `https://aries-trailblazer-7495.scratch.my.salesforce.com` *(apagada)*

- Record Type da demo: `012Ha000002eNzHIAU`
- Flow (versão ativa hoje): `301Ha000010PSOnIAO`
- Flow (definição, estável): `300Ha00000MKBMDIA5` · ApiName `SI_Demo_BankDataChange_Form`

Todos os paths abaixo são relativos — cole direto no **REST Explorer** do Workbench.

---

## Fonte: SCREEN FLOW

### 1. Catálogo — é daqui que vem o seletor da tela

**POST** `/services/data/v66.0/composite/batch`, corpo:

```json
{
  "batchRequests": [
    { "method": "GET", "url": "v66.0/query?q=SELECT Id, Name, ObjectApiName__c, RecordTypeDevName__c, Source__c, FlowApiName__c, Channel__c, CaseType__c FROM FormDefinition__c WHERE IsActive__c = true AND ObjectApiName__c = 'Case' AND Source__c = 'SCREEN_FLOW' ORDER BY Name" },
    { "method": "GET", "url": "v66.0/query?q=SELECT DurableId, ApiName, Label, ActiveVersionId FROM FlowDefinitionView WHERE ProcessType = 'Flow' AND IsActive = true" },
    { "method": "GET", "url": "v66.0/query?q=SELECT Id, DeveloperName, Name FROM RecordType WHERE SobjectType = 'Case' AND IsActive = true" }
  ]
}
```

Uma requisição resolve o formulário, o Id da versão ativa do flow
(`FormDefinition__c.FlowApiName__c` → `FlowDefinitionView.ActiveVersionId`) e o
Id do Record Type (`RecordTypeDevName__c` → `RecordType.Id`).

As três são SOQL **padrão** de propósito — a Tooling entra no batch mas volta
sem os campos (ver "Tooling dentro do batch" abaixo).

### 1b. O mesmo batch, escopado ao formulário escolhido

Depois que o usuário escolhe, o servidor repete o batch com a primeira query
filtrada — ele não confia no Record Type nem no flow que viessem do cliente:

```
... FROM FormDefinition__c WHERE IsActive__c = true AND ObjectApiName__c = 'Case' AND Source__c = 'SCREEN_FLOW' AND Id = 'a0vHa000006CFmDIAW'
```

### 2. Ler a definição do flow — aqui sim, Tooling

```
/services/data/v66.0/tooling/sobjects/Flow/301Ha000010PSOnIAO
```

O Id vem do `ActiveVersionId` da chamada 1.

O que interessa está em `Metadata.variables[]` e `Metadata.screens[].fields[]`.

### 3. Schema do objeto (tipos e labels)

```
/services/data/v66.0/ui-api/object-info/Case
```

### 4. Valores de picklist

```
/services/data/v66.0/ui-api/object-info/Case/picklist-values/012Ha000002eNzHIAU
```

---

## Fonte: UI API (v1)

```
/services/data/v66.0/ui-api/object-info/Case
/services/data/v66.0/ui-api/layout/Case?recordTypeId=012Ha000002eNzHIAU&mode=Create
/services/data/v66.0/ui-api/object-info/Case/picklist-values/012Ha000002eNzHIAU
/services/data/v66.0/query?q=SELECT+DeveloperName+FROM+RecordType+WHERE+Id='012Ha000002eNzHIAU'
/services/data/v66.0/query?q=SELECT+TargetField__c,ConditionField__c,Operator__c,Value__c,Effect__c,LogicGroup__c+FROM+FormFieldRule__c+WHERE+ObjectApiName__c='Case'+AND+RecordTypeDeveloperName__c='SI_Demo_BankDataChange'+AND+IsActive__c=true
```

---

## Fonte: UI API v2

Descoberta — **POST** `/services/data/v66.0/composite/batch`, corpo:

```json
{
  "batchRequests": [
    { "method": "GET", "url": "v66.0/query?q=SELECT Id, DeveloperName, Name FROM RecordType WHERE SobjectType = 'Case' AND IsActive = true ORDER BY Name" },
    { "method": "GET", "url": "v66.0/query?q=SELECT RecordTypeDeveloperName__c, TargetField__c, ConditionField__c, Operator__c, Value__c, Effect__c, LogicGroup__c FROM FormFieldRule__c WHERE ObjectApiName__c = 'Case' AND IsActive__c = true" }
  ]
}
```

Depois:

```
/services/data/v66.0/ui-api/record-defaults/create/Case?recordTypeId=012Ha000002eNzHIAU
/services/data/v66.0/ui-api/object-info/Case/picklist-values/012Ha000002eNzHIAU
```

---

## Tooling dentro do `composite/batch` — aceita, mas não serve

```
POST /services/data/v66.0/composite/batch
{ "batchRequests": [
  { "method": "GET", "url": "v66.0/tooling/query?q=SELECT Id, MasterLabel FROM Flow WHERE Status = 'Active' LIMIT 3" }
]}
```

Volta `statusCode: 200`, `totalSize: 3` — e três registros assim:

```json
{ "attributes": { "type": "Flow", "url": "/services/data/v66.0/sobjects/Flow/301Ha000010JMV7IAO" } }
```

Nenhum campo selecionado. A mesma query solta devolve `Id` e `MasterLabel`
normalmente. Reproduzido em `Flow` (campo simples e relacionamento) e
`FlexiPage`, com `RecordType` como controle na mesma requisição.

- `/composite` recusa antes: `PROCESSING_HALTED — Cannot make Tooling API calls
  with the Data API composite resource`
- `/tooling/composite` existe, mas só aceita Tooling

Script: `scripts/peek-batch-tooling-campos.mjs`.

---

## Alternativas investigadas

### FieldDefinition — tipos dos campos sem object-info

```
/services/data/v66.0/query?q=SELECT+QualifiedApiName,Label,DataType,ValueTypeId,Length+FROM+FieldDefinition+WHERE+EntityDefinition.QualifiedApiName='Case'+AND+QualifiedApiName+IN+('SI_BankType__c','SI_Email__c','SI_FullName__c')
```

O `WHERE EntityDefinition.QualifiedApiName` é obrigatório.

### Picklist de UM campo só (com dependências)

```
/services/data/v66.0/ui-api/object-info/Case/picklist-values/012Ha000002eNzHIAU/SI_BankType__c
```

### describe — tem `controllerName`, mas ignora Record Type

```
/services/data/v66.0/sobjects/Case/describe
```

---

## Endpoints da própria POC (localhost:3000)

```
GET  /api/whoami
GET  /api/record-types
GET  /api/record-types?source=uiapi-v2
GET  /api/forms?source=SCREEN_FLOW        catálogo — o seletor do Screen Flow
GET  /api/screen-flows                    lista crua, sem catálogo (comparação)
GET  /api/form?source=uiapi&recordTypeId=012Ha000002eNzHIAU
GET  /api/form?source=uiapi-v2&recordTypeId=012Ha000002eNzHIAU
GET  /api/form?source=screenflow&formId=a0vHa000006CFmDIAW
POST /api/replay          { "path": "/ui-api/object-info/Case" }
POST /api/replay          { "path": "...", "replayId": "catalog:SCREEN_FLOW" }
POST /api/submit          { "contract": {...}, "values": {...} }
POST /api/create-record   { "contract": {...}, "values": {...} }
```
