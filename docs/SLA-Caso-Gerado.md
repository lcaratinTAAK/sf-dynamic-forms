# SLA do caso gerado: guia de integração

Como buscar os prazos de SLA do Caso que nasce de um envio de formulário. É uma consulta só, por `GET` na REST API do Salesforce, logo depois do submit.

Tudo aqui foi conferido no FornoV1 (`https://quintoandar--fornov1.sandbox.my.salesforce.com`) em 02/10/2026. Os exemplos são retornos reais.

## 1. Como funciona

O submit **não cria o Caso**. Ele cria o registro do formulário (`CaseFormSubmission__c`). O resto acontece no Salesforce, por automação:

```
1. SI cria o envio            POST /sobjects/CaseFormSubmission__c   →  devolve o Id do envio
2. automação cria o Caso      Case.RelatedCaseFormSubmission__c = Id do envio
3. processo de direito        cria um CaseMilestone para cada prazo que começa a correr
4. SI consulta o SLA          GET /query  →  CaseMilestone filtrado pelo Id do envio
```

Cada prazo é um `CaseMilestone`. Um Caso pode ter vários (ex.: "SLA de atendimento" e "SLA Total do Atendimento - Urgente"), e também milestones que **não** são SLA. A consulta filtra pelos tipos que contam como SLA (seção 8) e devolve um registro por prazo.

## 2. A requisição

```http
GET {instanceUrl}/services/data/v66.0/query?q={soql}
Authorization: Bearer {accessToken}
Accept: application/json
```

| Parte | Valor | Observação |
| :-- | :-- | :-- |
| Método | `GET` | |
| Endpoint | `{instanceUrl}/services/data/v66.0/query` | O endpoint padrão de consulta da REST API. |
| Header `Authorization` | `Bearer {accessToken}` | Token OAuth do usuário de integração. |
| Header `Accept` | `application/json` | Opcional; JSON já é o padrão. |
| Query string `q` | a SOQL abaixo, **percent-encoded** | Obrigatório. Nada de espaço cru na URL: espaço vira `%20` (ou `+`, os dois funcionam), `,` vira `%2C`, `=` vira `%3D`, `é` vira `%C3%A9`, `–` vira `%E2%80%93`. |

Como a rota fica na rede (variante B, início da URL):

```http
GET https://quintoandar--fornov1.sandbox.my.salesforce.com/services/data/v66.0/query?q=SELECT%20FIELDS(ALL)%2C%20MilestoneType.Name%20FROM%20CaseMilestone%20WHERE%20CaseId%20%3D%20'500be00000Du7NEAAZ'%20AND%20MilestoneType.Name%20IN%20('Agents'%2C%20'SLA%20de%20atendimento'%2C%20...)%20LIMIT%20200
```

Com `+` no lugar do espaço também é aceito:

```http
GET .../services/data/v66.0/query?q=SELECT+FIELDS%28ALL%29%2C+MilestoneType.Name+FROM+CaseMilestone+WHERE+CaseId+%3D+%27500be00000Du7NEAAZ%27+AND+...
```

Há duas variantes. É o mesmo `GET`, e muda só a linha do `WHERE`:

| Variante | Filtro | Quando usar |
| :-- | :-- | :-- |
| **A · pelo envio** | `Case.RelatedCaseFormSubmission__c = '{idDoEnvio}'` | Logo depois do submit, com o Id que o POST devolveu. Não precisa conhecer o Caso, e cada registro volta com o `CaseId`. |
| **B · pelo Caso** | `CaseId = '{idDoCaso}'` | Quando o Id do Caso já é conhecido. Logo depois do submit ele não é; seria preciso consultar o Caso antes. |

### Variante A: pelo envio

```sql
SELECT FIELDS(ALL), MilestoneType.Name
FROM CaseMilestone
WHERE Case.RelatedCaseFormSubmission__c = '{idDoEnvio}'
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

### Variante B: pelo Caso

A mesma consulta, com o `WHERE` trocado:

```sql
WHERE CaseId = '{idDoCaso}'
  AND MilestoneType.Name IN ( ...a mesma lista... )
```

### Exemplo com curl

Salve a SOQL num arquivo (`sla.soql`) e deixe o curl codificar:

```bash
curl -G "https://quintoandar--fornov1.sandbox.my.salesforce.com/services/data/v66.0/query" \
  -H "Authorization: Bearer $SF_TOKEN" \
  -H "Accept: application/json" \
  --data-urlencode "q@sla.soql"
```

Por que arquivo: a lista tem acento e travessão. Escritos direto na linha de comando, eles chegam corrompidos no Windows, e o Salesforce responde `400` com uma página HTML ("Illegal Request") em vez de JSON.

Em código, monte a URL codificando a SOQL em UTF-8 (`encodeURIComponent` no JS, `URLEncoder.encode(soql, UTF_8)` no Java, `urllib.parse.quote` no Python). A SOQL pode ir em uma linha só, com quebras de linha ou espaços extras.

### Dá para mandar a SOQL crua, direto na URL?

Depende de quem envia. Uma URL não carrega espaço nem acento: alguém precisa codificar. Alguns clientes HTTP fazem isso sozinhos; outros recusam a URL antes de enviar. Testado no FornoV1 com a consulta da variante B, escrita crua depois de `?q=`:

| Cliente | SOQL crua na URL | Do jeito certo |
| :-- | :-- | :-- |
| Postman | `200`: codifica ao enviar (conferido com o `newman`, que usa o mesmo motor; é assim que a coleção do repo está escrita) | — |
| JS `fetch` (Node/navegador) | `200`: codifica sozinho | — |
| curl | recusa (exit 3, URL malformada) | `--data-urlencode "q@sla.soql"` → `200` |
| Java `HttpClient` | `IllegalArgumentException: Illegal character in query` | `URLEncoder.encode(soql, UTF_8)` → `200` |
| Python `urllib` | `InvalidURL: URL can't contain control characters` | `urlencode({'q': soql})` → `200` |

O jeito mais simples de fazer "direto" é passar `q` como parâmetro da biblioteca HTTP, em vez de colar na string da URL: `params={'q': soql}` no Python `requests`, `params: { q: soql }` no axios, `new URLSearchParams({ q: soql })` no JS. A biblioteca codifica, e não há trabalho extra.

Mesmo quando o cliente codifica sozinho, quatro caracteres não sobrevivem crus. Nenhum aparece na lista de tipos de hoje, mas um nome novo com eles quebra a consulta:

| Caractere cru | O que acontece (testado) |
| :-- | :-- |
| `+` | vira espaço: `'SLA+de+atendimento'` encontra "SLA de atendimento" |
| `&` | corta o parâmetro `q` no meio: `400 MALFORMED_QUERY` |
| `#` | corta a URL (vira fragmento): `400 MALFORMED_QUERY` |
| `%` | é lido como início de um código `%XX`: `'100%Bom'` dá `400` em HTML ("Illegal Request"); `'50%25'` passa, mas chega como `'50%'` |

## 3. A resposta

`200 OK`, no formato padrão do `/query`: `totalSize`, `done` e um registro por milestone. Retorno real do FornoV1, envio `a1Ube000001bH4XEAU`, caso 00086283:

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

Nenhum SLA também é `200`, com `"totalSize": 0` e `"records": []`.

## 4. Os campos principais

O que mostrar ao cliente, e de qual campo cada informação sai:

| Informação | Campo | Tipo | Observação |
| :-- | :-- | :-- | :-- |
| Qual SLA | `MilestoneType.Name` | string | Diz **qual** prazo é. Só vem porque a consulta pede ao lado do `FIELDS(ALL)`. |
| Status | `IsCompleted` + `IsViolated` | boolean | Não há campo de status; ver seção 5. |
| Caso | `CaseId` | Id | O Caso que nasceu do envio. |
| Início | `StartDate` | datetime (UTC) | Quando o relógio começou. |
| Prazo | `TargetDate` | datetime (UTC) | **O prazo é este campo.** Já respeita o horário comercial. |
| Meta | `TargetResponseInMins` | number | A meta em tempo de horário comercial. `…InHrs` e `…InDays` são a mesma meta em outra unidade. |
| Tempo restante | `TimeRemainingInMins` | **string** `"mm:ss"` | Texto, não número: `"5541:47"`. `…InHrs` é `"hh:mm"`; `…InDays` é número. |
| Atrasado há | `TimeSinceTargetInMins` | **string** `"mm:ss"` | `"00:00"` enquanto está dentro do prazo, não `null`. |
| Concluído em | `CompletionDate` | datetime (UTC) \| null | `null` enquanto aberto. |
| Tempo até concluir | `ElapsedTimeInMins` | number \| null | `null` enquanto aberto. |
| Horário comercial | `BusinessHoursId` | Id | O calendário que o prazo segue. |

O prazo **não** é `StartDate` + meta. No exemplo, a meta é 7.200 min (5 dias úteis), e o `TargetDate` caiu 7 dias corridos depois do início, porque o fim de semana não conta. Use sempre `TargetDate`.

As datas vêm em UTC (`+0000`). `2026-10-08T13:59:00.000+0000` é 08/10 às 10:59 no horário de Brasília.

## 5. Como derivar o status

| `IsCompleted` | `IsViolated` | Status |
| :-- | :-- | :-- |
| `false` | `false` | Em andamento |
| `false` | `true` | Violado: passou do prazo e segue aberto |
| `true` | `false` | Concluído dentro do prazo |
| `true` | `true` | Concluído fora do prazo |

## 6. Erros

Todos provocados de propósito no FornoV1:

| Status | Corpo | Causa | O que fazer |
| :-- | :-- | :-- | :-- |
| `400` | `MALFORMED_QUERY` | SOQL inválida, ex.: `FIELDS(ALL)` sem `LIMIT` | Manter o `LIMIT 200`. |
| `400` | `INVALID_FIELD` | Campo que não existe na org, ex.: `RelatedCaseFormSubmission__c` numa org sem o objeto | Conferir a org. |
| `400` | HTML ("Illegal Request"), sem JSON | Acento na URL sem codificar | Codificar o `q` em UTF-8 (seção 2). |
| `401` | `INVALID_SESSION_ID` | Token expirado ou inválido | Autenticar de novo e repetir. |

Os erros JSON vêm como lista: `[{ "message": "...", "errorCode": "MALFORMED_QUERY" }]`.

## 7. Cuidados

- **`LIMIT 200` é obrigatório** com `FIELDS(ALL)`. Sem ele, a consulta é recusada inteira, não cortada.
- **O campo é `CaseId`**, não `Case`. `WHERE Case = '500…'` não compila; `Case.` só serve para atravessar o relacionamento, como na variante A.
- **Pode vir mais de um registro, inclusive do mesmo tipo.** Um Caso pode ter vários SLAs da lista ao mesmo tempo, e o mesmo tipo se repete quando o prazo recomeça: o milestone anterior é concluído e um novo começa. No FornoV1, o caso `500be00000Du7NEAAZ` tem três "SLA de atendimento" (março e abril, concluídos; maio, aberto). O **vigente** é o que tem `IsCompleted = false`; para histórico, ordene por `StartDate`. Nunca confie na posição do registro.
- **Vazio logo depois do submit não é erro.** O Caso nasce por automação depois do envio, e só ganha milestone quando entra num processo de direito. Se vier vazio, repita depois de alguns segundos. Se continuar vazio, aquele Caso não tem SLA desses tipos.
- **Os nomes são comparados letra por letra.** "Reparos – Vistoriador Danificou o Imóvel" usa travessão (–), não hífen, e "responsibillidade" é a grafia que existe na org. Corrigir um nome faz aquele tipo sumir do resultado sem erro nenhum.
- **Para produção, prefira listar as colunas** em vez de `FIELDS(ALL)`. Pesa uma fração e não tem o teto de 200:

  ```sql
  SELECT Id, CaseId, MilestoneType.Name, StartDate, TargetDate, CompletionDate,
         IsCompleted, IsViolated, TargetResponseInMins, TimeRemainingInMins, TimeSinceTargetInMins
  FROM CaseMilestone
  WHERE Case.RelatedCaseFormSubmission__c = '{idDoEnvio}'
    AND MilestoneType.Name IN ( ...a mesma lista... )
  ```

## 8. Os tipos que contam como SLA

São os 19 nomes da consulta da seção 2. Todos existem no FornoV1 com essa grafia exata. Milestones de outros tipos ficam de fora: no caso 00086283, o "Primeiro contato de e-mail" não volta.

Para conferir numa org quais nomes existem:

```sql
SELECT Id, Name FROM MilestoneType WHERE Name IN ( ...a mesma lista... )
```

## 9. Para testar

- **Postman, o fluxo inteiro**: pasta `08 · Fluxo do SI · envio → SLAs` da coleção `postman/Formularios-Dinamicos.postman_collection.json`. São três requisições em sequência:
  1. cria o `CaseFormSubmission__c` e grava `submissionId`;
  2. busca os SLAs pelo envio e grava `caseId`;
  3. busca os SLAs pelo Caso.

  Rode no **Collection Runner**: a 2 repete sozinha até 5 vezes, com 3 s de intervalo, enquanto o Caso ainda não nasceu. O "Send" avulso não repete. A 1 cria registros de verdade, então use em sandbox.
- **Postman, só as consultas**: pasta `07 · SLA do caso gerado`, para um envio ou Caso que já existe (variáveis `submissionId` e `caseId`).
- **Antes de tudo**: rode `00 · Autenticação` para preencher `accessToken` e `instanceUrl`.
- **POC**: `GET http://localhost:3000/api/sla?submissionId={idDoEnvio}` (ou `?caseId=`) roda a mesma consulta, e devolve em `request.url` a rota exata que chamou. Na aba Demo, depois de criar o registro, o painel *SLAs de atendimento do caso gerado* mostra cada SLA com o campo de onde sai cada informação. Em "ver requisição", ele mostra a rota como foi na rede.
- **Envio com SLA no FornoV1**, para testar sem criar nada: `a1Ube000001bH4XEAU` (caso `500be00000K8ULaAAN`).
