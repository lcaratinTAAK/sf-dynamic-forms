# Estado do trabalho — Support Intelligence · formulários

Documento de retomada. Se o contexto da conversa for resumido, ou se você abrir
um chat novo, comece por aqui.

Última atualização: 14/08/2026

---

## Onde está cada coisa

| O quê | Onde |
|---|---|
| Estudo comparativo das 10 opções | `~/Downloads/Estudo - Formularios Salesforce para Support Intelligence.md` |
| Mesmo estudo publicado | https://claude.ai/code/artifact/3c2fa0b3-e8a0-47fb-a072-51a1f43e1d06 |
| RFC de anexos (EN, canônica) | `~/Downloads/RFC - Salesforce Attachment Supplemental Metadata.md` |
| RFC de anexos (PT-BR, validação) | `~/Downloads/RFC - Salesforce Attachment Supplemental Metadata (PT-BR).md` |
| POC (código) | `~/Documents/GitHub/sf-forms-poc` |
| Metadata da demo | repo `salesforce`, branch `demo/support-intelligence-forms-v1` |

**A branch `demo/*` não dispara CI** — só `forno`, `staging` e `main` disparam.
Ela **não deve ser mergeada**: adiciona 15 campos de demo ao objeto Case.

---

## Org

`benvi2-scratch-org` — scratch, autenticada no CLI.

| Artefato | Identificador |
|---|---|
| Record Type da demo | `SI_Demo_BankDataChange` · `012Ha000002eNzHIAU` |
| Screen Flow | `SI Demo - Alteração de Dados Bancários` · v2 Active · `301Ha000010Os5GIAS` |
| Layout | `Case-SI Demo Bank Data Change` · `00hHa000004iLPqIAM` |
| Usuário de integração | `integration.scratch@ext.quintoandar.com.br` · profile `MagicLink Integration_Profile` |
| Connected App | `SI Forms POC` · Client Credentials · Run As = usuário acima |
| Objeto de regras | `FormFieldRule__c` (5 registros ativos) |
| Permission sets | `SI_Demo_FormsPOC_PS` (leitura, integração) · `SI_Demo_FormsAdmin_PS` (escrita, Ops) |

Campos de demo: 13 com prefixo `SI_` + `FormRequiredDocuments__c`.

> **Atenção:** nesta org o acesso a objeto e campo vem **só de Permission Set** —
> nenhum Profile carrega FLS. Um usuário sem os permission sets certos vê o
> objeto Case com 49 campos em vez de 652, e o describe simplesmente omite o
> resto sem erro nenhum.

---

## POC

```bash
cd ~/Documents/GitHub/sf-forms-poc
npm run dev          # sobe BFF (3000) + Vite (5173)
npm run check        # smoke test offline, sem credenciais
```

Credenciais em `.env` (git-ignored). Dois modos: Client Credentials (em uso) ou
`SF_ACCESS_TOKEN` direto.

### Arquitetura

Um contrato normalizado, três adaptadores. Só os arquivos em `server/adapters/`
mudam entre as fontes; o frontend é o mesmo.

| Fonte | Chamadas | Descoberta | Seletor |
| :---- | :---- | :---- | :---- |
| `uiapi` | 4 | `object-info` (517 KB, filtra por profile → 50 RTs) | Record Type |
| `uiapi-v2` | 3 | `composite` SOQL (21 KB, sem filtro → 94 RTs) | Record Type |
| `screenflow` | 5 | `composite` do catálogo, 2× (40 KB cada) | **Formulário** |
| `formspec` | **2** | SOQL no catálogo (0,3 KB) | **Formulário** |

O avaliador de regras (`server/contract.js`) é importado pelo frontend também —
o mesmo código roda nos dois lados.

### `FormDefinition__c` — o catálogo (só a fonte Screen Flow)

Um registro descreve UM formulário: onde está a definição e o que o back-end
grava sem passar pelo formulário.

**As fontes UI API não usam o catálogo.** Elas já estavam corretas — descobrem
por Record Type, e o Page Layout resolve estrutura e obrigatoriedade sozinho. O
catálogo existe para resolver um problema que era só do Screen Flow.

| Campo | Papel |
| :---- | :---- |
| `Name` | rótulo exposto ao usuário |
| `ObjectApiName__c` | objeto que o formulário cria |
| `RecordTypeDevName__c` | resolve picklists **e** vira `RecordTypeId` no payload |
| `Source__c` | `LAYOUT` \| `SCREEN_FLOW` |
| `FlowApiName__c` | API Name do flow (só em `SCREEN_FLOW`) |
| `Channel__c` | `ONLINE` \| `MAGICLINK` \| `BOT` |
| `CaseType__c` | vira `Type` no payload |
| `IsActive__c` | fora do catálogo quando falso |

Resolveu dois problemas, os dois exclusivos do Screen Flow:

1. **Os dois seletores.** O Flow não declara Record Type, então a tela precisava
   de um seletor para o flow e outro para as picklists — e o usuário podia
   combinar flow e Record Type que não têm nada a ver. Agora é um seletor só: o
   catálogo é quem sabe o par.
2. **Campos de back-end.** `RecordTypeId` e `Type` vão no payload sem serem
   renderizados (`contract.backendFields`). Quem escolheu o formulário já
   escolheu os dois; perguntar de novo abriria espaço para divergir do catálogo.
   Entram por último em `buildSubmitPayload` e sobrescrevem — e a UI mostra
   quais foram, separados do que o usuário digitou. Contrato sem
   `backendFields` (v1 e v2) se comporta exatamente como antes deles existirem.

O catálogo guarda **nomes, não Ids**, de propósito: Id de versão de flow muda a
cada deploy (e o Id velho continua respondendo com a definição antiga), e Id de
Record Type muda entre orgs.

`Source__c` aceita `LAYOUT` para o dia em que o catálogo servir também às fontes
UI API — hoje não há registro `LAYOUT` e nenhum adaptador consulta esse valor.

**O catálogo roda duas vezes por formulário aberto**, e as duas contam:

1. ao entrar na fonte, **lista** os formulários e alimenta o seletor — sem ela
   não existe Id para escolher;
2. ao escolher, **resolve** o formulário (`AND Id = '...'`).

A segunda não é cache mal feito. O cliente manda um Id, e é o servidor que
decide o que aquele Id significa: aceitar o Record Type e o flow que o cliente
mandasse junto tornaria os campos de back-end forjáveis, e eles existem
justamente para não depender do que vem do formulário.

Escopar por Id **não economiza payload hoje** (40.840 bytes nos dois casos): o
`FormDefinition__c` tem 1 registro, e o peso está nas outras duas queries — 44
flows e 94 Record Types. E não dá para escopar `FlowDefinitionView` junto:
dentro de um batch os subrequests são independentes, então o ApiName do flow
ainda não é conhecido quando a query dele é montada. Quem for implementar de
verdade resolve isso com cache do catálogo, não com mais uma query.

Seed: `scripts/demo/si-forms/FormDefinition.json` (repo do Salesforce).

### Scripts de investigação

`scripts/peek-*.mjs` — rodam com `node --env-file=.env scripts/<arquivo>` e
consultam a org **como o usuário de integração**, que é o que importa.

---

## Medições (scratch, usuário de integração)

| Chamada | Payload | Latência |
| :---- | ----: | ----: |
| `ui-api/object-info/Case` | 517 KB | ~600-900 ms |
| `ui-api/layout/Case?recordTypeId&mode=Create` | 8 KB | ~500 ms |
| `ui-api/.../picklist-values/{rt}` | 333 KB | ~1.500 ms |
| `ui-api/record-defaults/create/Case?recordTypeId` | 633 KB | ~3.500 ms |
| `tooling/sobjects/Flow/{id}` | 35 KB | ~700 ms |
| `composite` (RecordType + regras) | 21 KB | ~200 ms |

`record-defaults` traz o **objeto inteiro** (652 campos) mais 4 objectInfos
aninhados — 98% da resposta é schema, para um layout de 23 campos. Não há como
enxugar: `optionalFields` só acrescenta.

---

## Conclusões verificadas empiricamente

1. **`ui-api` não é batchável.** `/composite` → `NOT_FOUND`; `/composite/batch` →
   `INVALID_BATCH_REQUEST`; GraphQL `UIAPI` não expõe `objectInfo`/`layout`/
   `picklistValues`; `/ui-api/aggregate-ui` não existe em v58/60/62/66.
   `/query` **é** batchável.
   Mas use `/composite`, não `/composite/batch`: o batch devolve query
   cortada (`done: false`, parte dos registros) com status 200. Medido — a
   especificação de um formulário voltou com 1 de 38 registros quando posta
   depois do schema. O `/composite` não corta e ainda é mais rápido.
2. **Não existe API que resolva a FlexiPage efetiva.** 692 objetos na Tooling,
   nenhum de action override. A associação só existe dentro de
   `CustomApplication.Metadata` (1.930 overrides na `ServiceConsole`).
3. **`ui-api/layout` é puramente estrutural** — zero ocorrências de `dataType`,
   `type`, `length`. Os tipos vêm sempre do `object-info`, nas três fontes.
4. **Screen Flow tem vínculo nativo com o campo** (`objectFieldReference`) e
   anexo obrigatório nativo (`forceContent:fileUpload` + `isRequired`).
5. **Mas Record Fields de Flow NÃO aceitam `isRequired`** — a obrigatoriedade é
   herdada do objeto. Obrigatoriedade por formulário só existe no Page Layout.
6. **Ler Flow pela Tooling exige `ViewSetup` + `ViewRoles` +
   `ViewAllNonSetupFlows`** no usuário de integração, que passa a enxergar todos
   os flows da org. A UI API não exige nada disso.
7. **SOQL em RecordType não respeita visibilidade por profile**: 94 contra 50.
8. **Deploy de Flow cria versão nova e aposenta a anterior**, mas o Id antigo
   continua respondendo com a definição velha. Consumir por Id de versão serve
   definição obsoleta em silêncio.
9. Limite de label de campo: **40 caracteres**. Várias perguntas do Cognito não
   cabem como label.
10. Limites de anexo (doc oficial): multipart em ContentVersion **2 GB**;
    demais objetos 500 MB; `composite/sobjects` 500 MB no total;
    base64 em JSON apenas **37,5 MB**.
11. **A Tooling API entra no `composite/batch` e não serve para nada.** Devolve
    `200` e o `totalSize` correto, mas **descarta todos os campos
    selecionados**: cada registro volta só com `attributes` — e o `url` dentro
    dele aponta para `/sobjects/`, não `/tooling/sobjects/`. Verificado em
    `Flow` (campo simples e relacionamento) e `FlexiPage`, com `RecordType` como
    controle na mesma requisição. `/composite` nem aceita: recusa com
    `PROCESSING_HALTED — Cannot make Tooling API calls with the Data API
    composite resource`. Existe `/tooling/composite`, só que aceita Tooling
    exclusivamente. Script: `scripts/peek-batch-tooling-campos.mjs`.

    Consequência prática: para descobrir flows dentro de um batch, use
    `FlowDefinitionView` — objeto **padrão**, sobrevive ao batch e expõe
    `ApiName` e `ActiveVersionId` direto, que é a chave estável. A Tooling
    continua necessária, mas só depois, para ler a definição do flow escolhido
    (`/tooling/sobjects/Flow/{ActiveVersionId}`).

---

## Investigação de orquestração — encerrada

Testamos exaustivamente se dava para montar o formulário mais barato que a v1.
**Conclusão: a fonte da v1 (Page Layout + UI API) vence.** As alternativas
resolvem um problema e criam outro.

| Alternativa | Payload | Por que não fecha |
| :---- | ----: | :---- |
| `record-defaults/create` | 633 KB | traz o objeto INTEIRO (652 campos) + 4 objectInfos aninhados; 98% da resposta é schema. `optionalFields` só acrescenta, não restringe |
| `query RecordType` na descoberta | 20 KB | não respeita visibilidade por profile: 94 contra 50 |
| `query FieldDefinition` para tipos | 5,6 KB | `DataType` é string localizada (depende do locale do usuário); não tem `controllerName` |
| `/sobjects/{obj}/describe` | 1.194 KB | é batchável e tem `controllerName`, mas **ignora Record Type** e o `validFor` vem como bitmask base64 |
| `EntityParticle` | — | não tem `ControllerName` |
| `PicklistValueInfo` (Tooling) | — | `sObject type not supported` nesta org |

**A UI API é a única que respeita Record Type**, que é requisito porque o
formulário muda por tipo de solicitação.

### Otimização conhecida, não aplicada

O `picklist-values` completo é 333 KB dos 341 KB por formulário — devolve as 209
picklists do objeto quando o formulário usa 12. O endpoint **por campo** é a
mesma UI API e resolve:

```
/ui-api/object-info/Case/picklist-values/{rt}          333 KB · 1.500 ms
/ui-api/object-info/Case/picklist-values/{rt}/{campo}  ×12 em paralelo
                                                         6 KB ·   264 ms
```

Verificado: o retorno por campo é **idêntico** ao da chamada completa —
`controllerValues` e `validFor` inclusive. Custo: 12 requisições concorrentes em
vez de 1 (troca bytes por cota de API).

Outras duas medições úteis para quem implementar:

- `picklist-values` **não depende do layout** (só do recordTypeId), então as duas
  podem sair em paralelo: 2.689 ms → 1.633 ms.
- `ui-api` não é batchável, mas `sobjects` e `query` são. Então `describe` e
  qualquer SOQL **padrão** cabem num `composite/batch`; nenhuma chamada de
  `ui-api` cabe, e a Tooling cabe mas volta sem os campos (conclusão 11).

---

## Decisões tomadas

- **RFC de anexos**: campo picklist `FormRequiredDocuments__c` cuja *presença* no
  layout sinaliza a exigência e cujos *valores por Record Type* listam os
  documentos. Zero chamadas adicionais. Reverte a rejeição do "marker field" da
  RFC anterior — está declarado no documento.
- **Enforcement é só no cliente.** Não haverá verificação no lado Salesforce
  nesta versão. Risco residual aceito e registrado.
- **Codificação opaca**: a lib/BFF não conhece os códigos de documento; repassa
  o que vier. Por isso renomear valor de picklist não quebra contrato.
- **POC fora do repo do Salesforce**, porque husky/lint-staged brigariam com o
  código React e `scratch/*` dispararia criação de org.

---

## Pendente

- [ ] Levantamento com Produto/Ops de quais formulários exigem quais documentos
      (action item do Raphael com Yule e Juliana)
- [ ] Card do Jira para a branch e para a RFC — a branch `demo/*` não passa no
      `pr-conventions` se virar PR
- [ ] Confirmar o limite real de API em produção (a transcrição registrou 1.800
      chamadas/dia, provavelmente errado por ordens de magnitude)
- [ ] Decidir se o Connected App vira External Client App (modelo novo; a org já
      usa ECA no `MagicLinkIntegrationApp`)
- [ ] Upload real de anexo na POC (hoje só lista e bloqueia; não envia)
- [ ] Aplicar os `defaultValues` da v2 no formulário (já vêm no contrato)

---

## Casos criados na scratch durante os testes

`00001018`, `00001019` e os que a demo gerar. Podem ser apagados.
