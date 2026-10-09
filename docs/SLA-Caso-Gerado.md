# SLA do caso gerado: guia de integração

Como obter o prazo de SLA do Caso que nasce de um envio de formulário **na mesma requisição do submit**: um `POST /composite` em que a última subrequisição lê o SLA.

Tudo aqui foi conferido no FornoV1 (`https://quintoandar--fornov1.sandbox.my.salesforce.com`) em 07/10/2026, com três envios reais do formulário `owner_bank_data_change#11` (casos 00086455, 00086456 e 00086458). Os retornos mostrados são reais.

## 1. Como funciona

O submit **não cria o Caso**. Ele cria o registro do formulário, e o resto acontece no Salesforce, dentro do mesmo save:

```
1. POST do envio           cria CaseFormSubmission__c
2. trigger do envio        CaseFormSubmissionTrigger (after insert) cria o Caso,
                           com Case.RelatedCaseFormSubmission__c = Id do envio,
                           e grava o Caso de volta em CaseFormSubmission__c.GeneratedCase__c
3. processo de direito     o Caso nasce com Entitlement, e o Salesforce cria um
                           CaseMilestone para cada prazo que começa a correr
4. consulta do SLA         CaseMilestone do Caso, filtrado pelo tipo "SLA de atendimento"
```

### Os objetos envolvidos

```
CaseFormSubmission__c ◀── RelatedCaseFormSubmission__c ── Case ◀── CaseId ── CaseMilestone ── MilestoneTypeId ──▶ MilestoneType
     (o envio)                                          (o Caso)             (um por prazo)                     (o nome do prazo)
```

| Objeto | O que é | Como se liga ao anterior |
| :-- | :-- | :-- |
| `CaseFormSubmission__c` | o envio do formulário, com as respostas do cliente | — |
| `Case` | o Caso criado pelo trigger do envio | `Case.RelatedCaseFormSubmission__c` = Id do envio |
| `CaseMilestone` | **a tabela do SLA**: um registro por prazo do Caso | `CaseMilestone.CaseId` = Id do Caso |
| `MilestoneType` | o catálogo de prazos ("SLA de atendimento", "Primeiro contato de e-mail"…) | `CaseMilestone.MilestoneTypeId` |

### Por que é preciso obter o Caso antes

O SLA é um `CaseMilestone`, e `CaseMilestone` pertence ao **Caso**, não ao envio. Só que o POST do envio devolve apenas o Id do envio: o Id do Caso não aparece em nenhum retorno de escrita. Por isso o composite tem uma subrequisição `getCase`, que procura o Caso pelo envio recém-criado (`WHERE RelatedCaseFormSubmission__c = '@{createSubmission.id}'`). Com o Id do Caso em mãos, as subrequisições seguintes vinculam os anexos (`LinkedEntityId`) e buscam o SLA (`CaseId`).

### Por que funciona numa requisição só

O Caso e os milestones nascem **durante** o POST do envio, não depois. Os horários de criação dos três envios de teste mostram a ordem:

| Caso | envio criado | Caso criado | milestones criados | anexos vinculados |
| :-- | :-- | :-- | :-- | :-- |
| 00086455 | 13:10:05 | 13:10:33 | 13:10:39 | 13:10:40 |
| 00086456 | 13:15:55 | 13:15:56 | 13:15:59 | 13:16:00 |
| 00086458 | 13:51:40 | 13:51:41 | 13:51:43 | 13:51:44 |

Os milestones já existem antes dos anexos (subrequisição 5), então a subrequisição 6 sempre os encontra. Não é preciso esperar nem repetir. Horários em UTC.

## 2. A requisição

```http
POST {instanceUrl}/services/data/v66.0/composite
Authorization: Bearer {accessToken}
Content-Type: application/json
```

São seis subrequisições, executadas em ordem. Cada uma pode usar o resultado das anteriores com `@{referenceId.caminho}`:

| # | `referenceId` | Chamada | Objeto | O que faz | Usa |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | `getAccountRecordType` | `GET /query` | `RecordType` | busca o Record Type de conta pessoa (`PersonAccount`) | — |
| 2 | `upsertAccount` | `PATCH /sobjects/Account/ExternalId__c/{id}` | `Account` | cria ou atualiza a conta do solicitante pelo id externo | `@{getAccountRecordType.records[0].Id}` |
| 3 | `createSubmission` | `POST /sobjects/CaseFormSubmission__c` | `CaseFormSubmission__c` | cria o envio; o trigger cria o Caso e os milestones | — |
| 4 | `getCase` | `GET /query` | `Case` | lê o Caso que o envio gerou | `@{createSubmission.id}` |
| 5 | `createContentDocumentLinks` | `POST /composite/sobjects` | `ContentDocumentLink` | vincula os documentos já enviados ao Caso | `@{getCase.records[0].Id}` |
| 6 | `getSla` | `GET /query` | `CaseMilestone` | **lê o SLA do Caso** | `@{getCase.records[0].Id}` |

O corpo completo:

```json
{
  "allOrNone": true,
  "compositeRequest": [
    {
      "method": "GET",
      "url": "/services/data/v66.0/query?q=SELECT+Id+FROM+RecordType+WHERE+SObjectType='Account'+AND+DeveloperName='PersonAccount'+LIMIT+1",
      "referenceId": "getAccountRecordType",
      "body": null
    },
    {
      "method": "PATCH",
      "url": "/services/data/v66.0/sobjects/Account/ExternalId__c/524259ea-fb28-431a-8439-babc37da03a8",
      "referenceId": "upsertAccount",
      "body": {
        "FirstName": "Lucas",
        "LastName": "C C M",
        "PersonId__c": "524259ea-fb28-431a-8439-babc37da03a8",
        "ExternalDomain__c": "person",
        "RecordTypeId": "@{getAccountRecordType.records[0].Id}",
        "MainId__c": "1604446"
      }
    },
    {
      "method": "POST",
      "url": "/services/data/v66.0/sobjects/CaseFormSubmission__c",
      "referenceId": "createSubmission",
      "body": {
        "RecordTypeId": "012be000002WjAYAA0",
        "FormVersion__c": "owner_bank_data_change#11",
        "Origin__c": "Web",
        "RegisteredEmail__c": "lucas.maia@quintoandar.com.br",
        "FullName__c": "Lucas C C M",
        "DocumentType__c": "CNH",
        "RequesterType__c": "Proprietário",
        "IsPPMulti__c": "Sim",
        "SameAccountAllContracts__c": "Sim",
        "AccountHolderRelation__c": "Terceiro",
        "AccountHolderDocumentType__c": "CPF",
        "AccountHolderName__c": "JOAO TESTE",
        "AccountHolderCPF__c": "12345678912",
        "BankName__c": "Actinver ( 133 )",
        "BankBranch__c": "3123131",
        "BankBranchDigit__c": "21",
        "BankAccount__c": "212121",
        "BankAccountDigit__c": "21",
        "BankAccountType__c": "Conta Corrente Conjunta",
        "RequesterAccount__r": {
          "ExternalId__c": "524259ea-fb28-431a-8439-babc37da03a8"
        }
      }
    },
    {
      "method": "GET",
      "url": "/services/data/v66.0/query?q=SELECT+Id,CaseNumber,Status,Type,Priority,RecordType.DeveloperName,CreatedDate+FROM+Case+WHERE+RelatedCaseFormSubmission__c='@{createSubmission.id}'",
      "referenceId": "getCase",
      "body": null
    },
    {
      "method": "POST",
      "url": "/services/data/v66.0/composite/sobjects",
      "referenceId": "createContentDocumentLinks",
      "body": {
        "allOrNone": true,
        "records": [
          {
            "attributes": { "type": "ContentDocumentLink" },
            "ContentDocumentId": "069be000007OWtyAAG",
            "LinkedEntityId": "@{getCase.records[0].Id}",
            "ShareType": "V",
            "Visibility": "AllUsers"
          },
          {
            "attributes": { "type": "ContentDocumentLink" },
            "ContentDocumentId": "069be000007OgYSAA0",
            "LinkedEntityId": "@{getCase.records[0].Id}",
            "ShareType": "V",
            "Visibility": "AllUsers"
          },
          {
            "attributes": { "type": "ContentDocumentLink" },
            "ContentDocumentId": "069be000007OmFbAAK",
            "LinkedEntityId": "@{getCase.records[0].Id}",
            "ShareType": "V",
            "Visibility": "AllUsers"
          }
        ]
      }
    },
    {
      "method": "GET",
      "url": "/services/data/v66.0/query?q=SELECT+FIELDS(ALL),+MilestoneType.Name+FROM+CaseMilestone+WHERE+CaseId+=+'@{getCase.records[0].Id}'+AND+MilestoneType.Name+=+'SLA+de+atendimento'+LIMIT+200",
      "referenceId": "getSla",
      "body": null
    }
  ]
}
```

`FormVersion__c` precisa ser a chave completa da versão (`owner_bank_data_change#11`), e não só o número: é por ela que o trigger encontra o formulário e decide criar o Caso.

### A subrequisição do SLA

Decodificada, a SOQL do `getSla` é:

```sql
SELECT FIELDS(ALL), MilestoneType.Name
FROM CaseMilestone
WHERE CaseId = '@{getCase.records[0].Id}'
  AND MilestoneType.Name = 'SLA de atendimento'
LIMIT 200
```

| Trecho | Por quê |
| :-- | :-- |
| `FROM CaseMilestone` | é a tabela dos prazos; cada SLA é um registro |
| `FIELDS(ALL)` | todos os campos do milestone (prazo, status, tempo restante) |
| `MilestoneType.Name` | o nome do prazo. `FIELDS(ALL)` não traz relacionamento, então ele é pedido ao lado |
| `CaseId = '@{getCase.records[0].Id}'` | o Caso que a subrequisição 4 encontrou. O campo é `CaseId`, não `Case` |
| `MilestoneType.Name = 'SLA de atendimento'` | só o prazo de SLA. O Caso tem outros milestones, como "Primeiro contato de e-mail", que não são SLA |
| `LIMIT 200` | obrigatório com `FIELDS(ALL)`; sem ele a consulta é recusada inteira |

### Como escrever a URL dentro do composite

A `url` de cada subrequisição é um texto dentro do JSON: nenhum cliente HTTP a codifica por você. O Salesforce aceita espaço e acento crus ali, mas quatro caracteres quebram a consulta. Testado no FornoV1:

| Na `url` | Resultado |
| :-- | :-- |
| espaço e acento crus (`'Reparos - Incêndio - 5 dias'`) | `200` |
| `+` | vira espaço: `'SLA+de+atendimento'` encontra "SLA de atendimento". É assim que o exemplo está escrito |
| `&` | corta a consulta: `400 MALFORMED_QUERY` |
| `#` | corta a consulta: `400 MALFORMED_QUERY` |
| `%` | é lido como início de código: `400 MALFORMED_QUERY` |

Se um valor tiver `&`, `#`, `%` ou um `+` de verdade, codifique esse caractere (`%26`, `%23`, `%25`, `%2B`).

### Alternativa: buscar pelo envio

O `getSla` também pode filtrar pelo envio, sem passar pelo Caso, atravessando o relacionamento:

```sql
WHERE Case.RelatedCaseFormSubmission__c = '@{createSubmission.id}'
  AND MilestoneType.Name = 'SLA de atendimento'
```

Também foi testada dentro do composite e devolve o mesmo registro. Mas o `getCase` continua sendo necessário para os anexos, então o caminho principal é pelo `CaseId`.

### Outros tipos de SLA

Para trazer mais de um tipo de prazo, troque o `=` por `IN`. A POC usa estes 19 nomes (`server/sla.js`), todos existentes no FornoV1 com esta grafia exata:

```sql
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
```

Os nomes são comparados letra por letra: "Reparos – Vistoriador Danificou o Imóvel" usa travessão (–), não hífen, e "responsibillidade" é a grafia que existe na org. Corrigir um nome faz aquele tipo sumir do resultado sem erro nenhum.

## 3. A resposta

O composite responde `200 OK` **mesmo quando uma subrequisição falha**. O resultado de cada uma vem em `compositeResponse`, na mesma ordem do pedido:

```json
{
  "compositeResponse": [
    { "body": { ... }, "httpHeaders": { ... }, "httpStatusCode": 200, "referenceId": "getAccountRecordType" },
    ...
  ]
}
```

O que cada subrequisição devolve quando dá certo:

| `referenceId` | `httpStatusCode` | `body` |
| :-- | :-- | :-- |
| `getAccountRecordType` | `200` | resultado de consulta: `totalSize`, `done`, `records` |
| `upsertAccount` | `200` se a conta já existia, `201` se foi criada | `{ "id", "success", "errors", "created" }` |
| `createSubmission` | `201` | `{ "id", "success", "errors" }`: o `id` é o Id do envio |
| `getCase` | `200` | resultado de consulta, com o Caso em `records[0]` |
| `createContentDocumentLinks` | `200` | lista com um `{ "id", "success", "errors" }` por anexo |
| `getSla` | `200` | resultado de consulta, com **um registro por SLA** |

As duas últimas consultas, no caso 00086455:

```json
[
  {
    "body": {
      "totalSize": 1,
      "done": true,
      "records": [
        {
          "attributes": { "type": "Case", "url": "/services/data/v66.0/sobjects/Case/500be00000KKRezAAH" },
          "Id": "500be00000KKRezAAH",
          "CaseNumber": "00086455",
          "Status": "Open",
          "Type": "New Account",
          "Priority": "Critical",
          "RecordType": {
            "attributes": { "type": "RecordType", "url": "/services/data/v66.0/sobjects/RecordType/012be000001zYygAAE" },
            "DeveloperName": "Payments_BankAccountChanges"
          },
          "CreatedDate": "2026-10-07T13:10:33.000+0000"
        }
      ]
    },
    "httpHeaders": {},
    "httpStatusCode": 200,
    "referenceId": "getCase"
  },
  {
    "body": {
      "totalSize": 1,
      "done": true,
      "records": [
        {
          "attributes": { "type": "CaseMilestone", "url": "/services/data/v66.0/sobjects/CaseMilestone/555be00000vGUCzAAO" },
          "MilestoneType": {
            "attributes": { "type": "MilestoneType", "url": "/services/data/v66.0/sobjects/MilestoneType/557bL0000000NuMQAU" },
            "Name": "SLA de atendimento"
          },
          "Id": "555be00000vGUCzAAO",
          "CaseId": "500be00000KKRezAAH",
          "StartDate": "2026-10-07T13:10:39.000+0000",
          "TargetDate": "2026-10-15T13:10:00.000+0000",
          "CompletionDate": null,
          "MilestoneTypeId": "557bL0000000NuMQAU",
          "IsCompleted": false,
          "IsViolated": false,
          "SystemModstamp": "2026-10-07T13:10:39.000+0000",
          "CreatedDate": "2026-10-07T13:10:39.000+0000",
          "CreatedById": "005be00000GNTUuAAP",
          "LastModifiedDate": "2026-10-07T13:10:39.000+0000",
          "LastModifiedById": "005be00000GNTUuAAP",
          "IsDeleted": false,
          "TargetResponseInMins": 7200,
          "TargetResponseInHrs": 120,
          "TargetResponseInDays": 5,
          "TimeRemainingInMins": "7155:41",
          "TimeRemainingInHrs": "119:15",
          "TimeRemainingInDays": 4.969227233796296,
          "ElapsedTimeInMins": null,
          "ElapsedTimeInHrs": null,
          "ElapsedTimeInDays": null,
          "TimeSinceTargetInMins": "00:00",
          "TimeSinceTargetInHrs": "00:00",
          "TimeSinceTargetInDays": 0,
          "BusinessHoursId": "01mbL000000AB2DQAW"
        }
      ]
    },
    "httpHeaders": {},
    "httpStatusCode": 200,
    "referenceId": "getSla"
  }
]
```

### Como ler o SLA do retorno

Procure a subrequisição pelo `referenceId`, não pela posição, e confira o `httpStatusCode` de cada uma antes de ler o corpo:

```js
const passos = resposta.compositeResponse;
const falha = passos.find((p) => p.httpStatusCode >= 400);
if (falha) throw new Error(JSON.stringify(falha.body)); // ver a seção 6

const porRef = Object.fromEntries(passos.map((p) => [p.referenceId, p.body]));
const envioId = porRef.createSubmission.id;
const caso = porRef.getCase.records[0];
const sla = porRef.getSla.records.find((m) => !m.IsCompleted); // o vigente
```

Nenhum SLA também é sucesso: `getSla` volta `200` com `"totalSize": 0` e `"records": []`. Acontece quando o Caso não entrou num processo de direito que tenha esse prazo.

## 4. Os campos do SLA

O que mostrar ao cliente, e de qual campo do `CaseMilestone` cada informação sai:

| Informação | Campo | Tipo | Observação |
| :-- | :-- | :-- | :-- |
| Qual SLA | `MilestoneType.Name` | string | Só vem porque a consulta pede ao lado do `FIELDS(ALL)`. |
| Status | `IsCompleted` + `IsViolated` | boolean | Não há campo de status; ver seção 5. |
| Caso | `CaseId` | Id | O mesmo `getCase.records[0].Id`. |
| Início | `StartDate` | datetime (UTC) | Quando o relógio começou. |
| Prazo | `TargetDate` | datetime (UTC) | **O prazo é este campo.** Já respeita o horário comercial. |
| Meta | `TargetResponseInMins` | number | A meta em tempo de horário comercial. `…InHrs` e `…InDays` são a mesma meta em outra unidade. |
| Tempo restante | `TimeRemainingInMins` | **string** `"mm:ss"` | Texto, não número: `"7155:41"`. `…InHrs` é `"hh:mm"`; `…InDays` é número. |
| Atrasado há | `TimeSinceTargetInMins` | **string** `"mm:ss"` | `"00:00"` enquanto está dentro do prazo, não `null`. |
| Concluído em | `CompletionDate` | datetime (UTC) \| null | `null` enquanto aberto. |
| Tempo até concluir | `ElapsedTimeInMins` | number \| null | `null` enquanto aberto. |
| Horário comercial | `BusinessHoursId` | Id | O calendário que o prazo segue. |

O prazo **não** é `StartDate` + meta. No exemplo, a meta é 7.200 min (5 dias úteis) e o `TargetDate` caiu 8 dias corridos depois do início, porque o fim de semana e o feriado de 12/10 não contam. Use sempre `TargetDate`.

As datas vêm em UTC (`+0000`). `2026-10-15T13:10:00.000+0000` é 15/10 às 10:10 no horário de Brasília.

## 5. Como derivar o status

| `IsCompleted` | `IsViolated` | Status |
| :-- | :-- | :-- |
| `false` | `false` | Em andamento |
| `false` | `true` | Violado: passou do prazo e segue aberto |
| `true` | `false` | Concluído dentro do prazo |
| `true` | `true` | Concluído fora do prazo |

## 6. Erros

### Uma falha desfaz tudo

Com `allOrNone: true`, se qualquer subrequisição falhar, **nada fica gravado**: nem a conta, nem o envio, nem o Caso, nem os anexos. A subrequisição que falhou traz a causa; as outras voltam `400` com `PROCESSING_HALTED`, que é só consequência.

O erro mais provável é o Caso não ser encontrado. Retorno real, com um envio que não gerou Caso:

```json
{
  "compositeResponse": [
    {
      "body": [{ "errorCode": "PROCESSING_HALTED", "message": "The transaction was rolled back since another operation in the same transaction failed." }],
      "httpHeaders": {},
      "httpStatusCode": 400,
      "referenceId": "getCase"
    },
    {
      "body": [{ "errorCode": "PROCESSING_HALTED", "message": "Invalid reference specified. No value for getCase.records[0].Id found in getCase. Provided referenceId ('getCase.records[0].Id') must start with a letter or a number, and it can contain only letters, numbers and underscores ('_')." }],
      "httpHeaders": {},
      "httpStatusCode": 400,
      "referenceId": "getSla"
    }
  ]
}
```

Note que o `getCase` aparece com erro, mas a causa está na mensagem do `getSla`: `No value for getCase.records[0].Id`, ou seja, a consulta do Caso voltou vazia e não havia Id para referenciar. O texto sobre "must start with a letter" é genérico do Salesforce e não indica problema no nome.

O trigger não deixa a falha do Caso derrubar o envio: se o Caso não puder ser criado, ele grava um `Log__c` e segue. Dentro do composite, porém, o envio é desfeito junto, e o `Log__c` também. Para investigar, mande só o POST do envio, fora do composite, e consulte o `Log__c` e o campo `GeneratedCase__c` do envio. As causas mais comuns:

- `FormVersion__c` vazio ou sem a chave completa (`"11"` em vez de `"owner_bank_data_change#11"`);
- uma regra de validação do `Case` recusando o Caso.

### Outros erros

| Onde | Status | Corpo | Causa | O que fazer |
| :-- | :-- | :-- | :-- | :-- |
| a requisição toda | `401` | `INVALID_SESSION_ID` | token expirado ou inválido | autenticar de novo e repetir |
| `getSla` | `400` | `MALFORMED_QUERY` | `FIELDS(ALL)` sem `LIMIT`, ou `&`, `#`, `%` crus na `url` | manter o `LIMIT 200`; codificar o caractere (seção 2) |
| qualquer `GET /query` | `400` | `INVALID_FIELD` | campo que não existe na org, ou invisível para o usuário de integração (FLS) | conferir a org e as permissões do usuário |
| `createSubmission` | `400` | `REQUIRED_FIELD_MISSING`, `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`… | dado do formulário inválido | corrigir o payload |

Os erros vêm como lista: `[{ "errorCode": "...", "message": "..." }]`.

### Tempo de resposta

Pelos horários dos registros (seção 1), o composite levou cerca de 5 s nos envios de 13:15 e 13:51. No de 13:10, o Caso demorou 28 s para nascer, e a requisição levou ao menos 35 s. Configure o timeout do cliente bem acima disso.

Um timeout do lado do cliente **não** cancela nada no Salesforce: a transação continua e é gravada. Antes de reenviar, confira se o envio já existe (por exemplo, pelo `RequesterAccount__c` e pela data de criação), senão o reenvio cria um segundo envio e um segundo Caso.

## 7. Limites e cuidados

- **Limite do composite**: até 25 subrequisições, e no máximo 5 delas de consulta ou de sObject Collections. Este fluxo usa 4 (`getAccountRecordType`, `getCase`, `getSla` e `createContentDocumentLinks`), então sobra espaço para só mais uma.
- **Reenviar cria outro envio e outro Caso.** Só o upsert da conta é idempotente, porque é pelo `ExternalId__c`.
- **O campo é `CaseId`**, não `Case`. `WHERE Case = '500…'` não compila; `Case.` só serve para atravessar o relacionamento, como na alternativa pelo envio.
- **Pode vir mais de um registro do mesmo tipo.** Quando um prazo recomeça, o milestone anterior é concluído e um novo começa. O **vigente** é o que tem `IsCompleted = false`; para histórico, ordene por `StartDate`. Nunca confie na posição do registro.
- **Em produção, prefira listar as colunas** em vez de `FIELDS(ALL)`. A resposta fica bem menor e não há o teto de 200:

  ```sql
  SELECT Id, CaseId, MilestoneType.Name, StartDate, TargetDate, CompletionDate,
         IsCompleted, IsViolated, TargetResponseInMins, TimeRemainingInMins, TimeSinceTargetInMins
  FROM CaseMilestone
  WHERE CaseId = '@{getCase.records[0].Id}'
    AND MilestoneType.Name = 'SLA de atendimento'
  ```

## 8. Para testar

- **Postman, o composite**: pasta `SUBMIT` da coleção `postman/Formularios-Dinamicos.postman_collection.json`, requisição *Composite · envio → Caso → anexos → SLA*. Rode `00 · Autenticação` antes, com o environment `postman/FornoV1.postman_environment.json`. O Console mostra o status de cada subrequisição, o Caso e o SLA. Cria registros de verdade, então use em sandbox.
- **Use o app desktop do Postman**, ou o Desktop Agent no Postman web. O Cloud Agent, padrão do navegador, corta a requisição aos 30 s; o Salesforce termina e grava mesmo assim (ver *Tempo de resposta*).
- **Só a consulta, para um Caso que já existe**: pasta `07 · SLA do caso gerado`, com as variáveis `submissionId` ou `caseId`. Um envio com SLA no FornoV1, para testar sem criar nada: `a1Ube000001bgJMEAY` (caso 00086458, `500be00000KKYjpAAH`).
- **Em passos, sem composite**: pasta `08 · Fluxo do SI · envio → SLAs`, com o envio e a consulta em requisições separadas.
- **POC**: `GET http://localhost:3000/api/sla?caseId={idDoCaso}` roda a mesma consulta fora do composite, com os 19 tipos.
