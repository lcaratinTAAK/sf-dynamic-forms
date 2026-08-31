# sf-dynamic-forms

Formulários dinâmicos renderizados a partir da definição que vive no Salesforce.

O cliente abre um link, preenche um formulário e um Caso é criado. A diferença
para um formulário comum é que **nada aqui é codificado**: quais campos existem,
em que ordem, quais aparecem sob condição, quais anexos são exigidos e o que
bloqueia o envio — tudo vem de metadado ou de dado do Salesforce. Mudar o
formulário não passa por deploy desta aplicação.

Nasceu para responder a uma pergunta concreta: **dá para substituir o Cognito
Forms pelo Salesforce?** Por isso existem quatro fontes de definição
implementadas lado a lado, comparáveis na mesma tela.

---

## Rodando

```bash
cp .env.example .env     # preencha as credenciais — ver abaixo
npm install
npm run dev
```

- **API** — <http://localhost:3000>
- **Web** — <http://localhost:5173>

O `npm run dev` sobe os dois juntos. O Vite faz proxy de `/api` para a porta
3000, então o front nunca precisa saber o endereço do servidor.

### As credenciais

O `.env` é ignorado pelo git e o repositório traz um `.env.example` comentado.
Há **dois modos**, e basta um:

| modo | quando usar | o que preencher |
| :-- | :-- | :-- |
| **Client Credentials** | é o modo representativo — o BFF autentica como aplicação | `SF_LOGIN_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET` |
| **Token direto** | atalho para rodar antes de existir o External Client App | `SF_ACCESS_TOKEN`, `SF_INSTANCE_URL` |

Se `SF_ACCESS_TOKEN` estiver preenchido, ele vence. Pegue um com:

```bash
sf org display --verbose --json -o <alias-da-org>
```

> **Uma armadilha que vale saber antes.** No modo Client Credentials, o Page
> Layout devolvido pela UI API é resolvido pelo **profile do usuário "Run As"**
> do External Client App — não pelo do cliente que preenche. Se esse usuário
> enxergar um layout diferente, o formulário sai errado e nada acusa. As fontes
> que leem layout pelo nome, e não pelo perfil, não têm esse problema.

Para conferir com qual identidade o servidor está falando:

```bash
curl localhost:3000/api/whoami
```

---

## As quatro fontes

Todas produzem o **mesmo contrato normalizado**, então a tela não sabe de onde
a definição veio — é esse o ponto do desenho.

| fonte | de onde vem a estrutura | de onde vêm as regras |
| :-- | :-- | :-- |
| **UI API** | Page Layout | objetos `FormFieldRule__c` e `FormRequiredDocument__c` |
| **UI API v2** | `record-defaults/create` | — (variante enxuta, para comparação) |
| **Screen Flow** | a definição do Flow | o próprio Flow |
| **Spec custom** | `SI_FormSpec__c` | `SI_FormSpec__c` |

A **Spec custom** é a mais completa: seções, campos, blocos de texto, anexos,
listas repetíveis, regras de visibilidade, obrigatoriedade condicional e
validação com mensagem — tudo numa consulta só.

Cada fonte é um arquivo em `server/adapters/`, e o contrato que todas devolvem
está descrito em `server/contract.js`.

---

## O contrato

```js
{
  source: 'UI_API',            // qual fonte produziu
  object: 'Case',
  recordType: { id, developerName, label },
  sections: [
    {
      id, label, visibility,
      repeating: false,        // true → é uma lista; ver abaixo
      fields: [
        {
          apiName, label, dataType, required, readOnly,
          helpText, maxLength, options, controllerField,
          width,                 // FULL | HALF | THIRD
          hidden, defaultValue,  // campo que não se desenha, mas vai no payload
          visibility,            // { logic, expression, conditions[] }
          requiredWhen,          // mesma forma — torna obrigatório sob condição
          validation,            // { message, logic, conditions[] } — impede o envio
        }
      ]
    }
  ],
  attachments: { required, minimumCount, documents[] },
  backendFields: { RecordTypeId, Type },   // gravados sem passar pelo formulário
  diagnostics: { calls[], warnings[] },
}
```

Uma seção com `repeating: true` carrega `childObject` e
`childRelationshipField`: cada item vira um **registro filho**, e o envio deixa
de ser um POST e passa a ser um `composite` com `@{refPai.id}`.

### O avaliador de regras

`isVisible`, `requiredWhen` e `validation` usam a **mesma função**, e ela roda
nos dois lados — no servidor ao montar o payload, no front a cada tecla. É por
isso que a tela e o envio nunca discordam sobre o que está oculto ou inválido.

A lógica combina condições com `ALL`, `ANY` ou uma expressão do tipo
`1 AND (2 OR 3)`. A expressão é interpretada por um parser próprio, **não por
`eval`**: ela vem de um registro que o time de operações edita, e executá-la
como código seria injeção.

---

## Endpoints

| rota | o que faz |
| :-- | :-- |
| `GET /api/health` | está de pé |
| `GET /api/whoami` | com qual identidade o servidor fala com o Salesforce |
| `GET /api/forms` | catálogo de formulários |
| `GET /api/record-types` | Record Types do objeto |
| `GET /api/screen-flows` | Flows disponíveis |
| `GET /api/form` | **o principal** — devolve o contrato normalizado |
| `POST /api/submit` | monta o payload que *seria* enviado, sem enviar |
| `POST /api/create-record` | cria de verdade |
| `POST /api/replay` | reexecuta uma chamada e devolve peso e tempo |
| `POST /api/traduzir` | converte retornos do Salesforce no contrato **sem tocar na org** |

`GET /api/form` recebe `source` e o identificador correspondente:

```
/api/form?source=uiapi&recordTypeId=012...
/api/form?source=screenflow&formId=a0v...
/api/form?source=formspec&formId=a0x...
```

---

## Estrutura

```
server/
  index.js         as rotas
  salesforce.js    autenticação e chamadas — o único lugar que fala com a org
  contract.js      o contrato e o avaliador de regras
  config.js        leitura do .env
  adapters/        uma fonte por arquivo
web/
  src/
    App.jsx                seletor de fonte e estado do formulário
    components/
      FormRenderer.jsx     desenha seções, campos, anexos e listas
      Field.jsx            um campo, por tipo de dado
      Inspector.jsx        as chamadas feitas, com envio e retorno
      Info.jsx             comparativo das abordagens
      InfoCustom.jsx       a solução escolhida, em detalhe
  public/prints/           capturas do configurador e do formulário
postman/                   a coleção e o environment de exemplo
docs/                      notas de decisão
fixtures/                  payloads capturados, para rodar sem org
scripts/
  offline-check.js         verificação sem org
  peek-*.mjs               sondas de investigação (28) — cada uma responde
                           uma pergunta que apareceu no caminho
```

O `web/` não importa nada do `server/` além do `contract.js` — a conversa é por
HTTP. São duas aplicações independentes que moram no mesmo repositório porque o
ciclo de vida delas é o mesmo.

---

## O inspetor

A aba lateral mostra **cada chamada feita ao Salesforce**, com o que foi enviado,
o que voltou, o peso e o tempo. Não é enfeite: foi assim que descobrimos que
`ui-api/object-info` traz 518 KB para um formulário que usa dez campos, e que
`EntityParticle` filtrado resolve o mesmo em 2 KB.

O `POST /api/replay` reexecuta qualquer chamada da lista, para medir sem
recarregar a página.

---

## As páginas de informações

A aplicação tem três abas. A **Demo** é o formulário; as outras duas são
documentação que se mantém sozinha, porque lê da mesma fonte que o código.

| aba | o que responde |
| :-- | :-- |
| **Comparativo** | qual das fontes sustenta o catálogo inteiro, e o que cada uma cobrou para chegar lá |
| **Solução Custom** | como a fonte escolhida funciona, do primeiro GET ao Caso criado |

A aba **Solução Custom** traz um tradutor ao vivo: à esquerda, os retornos do
Salesforce; à direita, o contrato. Editar a esquerda muda a direita. Não é
simulação — ela chama `POST /api/traduzir`, que roda o mesmo
`specToContract()` do adaptador. Quem for reimplementar isso em outra
linguagem pode colar o retorno da própria org e usar a saída como oráculo.

As capturas em `web/public/prints/` são do configurador na org e do formulário
renderizado. Foram tiradas contra uma scratch real; se a interface mudar, elas
envelhecem — vale refazê-las junto.

---

## A coleção Postman

`postman/` traz as chamadas em seis pastas, com um *environment* de exemplo.
A coleção roda de cima para baixo: cada pasta grava nas variáveis o que a
próxima precisa.

```bash
newman run postman/Formularios-Dinamicos.postman_collection.json   -e postman/Scratch-org.postman_environment.json
```

Duas requisições **falham de propósito** e estão lá por isso: uma prova que a
UI API é recusada dentro de `composite/batch`, outra que `EntityParticle` não
expõe `ControllingFieldDefinitionId`. As duas falhas são a justificativa de
decisões de desenho, e vale poder repetir o experimento em vez de acreditar
numa nota de rodapé.

---

## Sem org à mão

```bash
npm run check
```

Roda o contrato contra os payloads em `fixtures/` e confere que os adaptadores
continuam produzindo a mesma coisa. Não substitui o teste contra a org, mas
pega regressão de tradução.

As `scripts/peek-*.mjs` são outra coisa: sondas de uma pergunta só, escritas
durante a investigação e mantidas porque **registram o que foi testado**. O
comentário no topo de cada uma diz a pergunta. Precisam de `.env` e de org:

```bash
node --env-file=.env scripts/peek-picklist-por-campo.mjs
```

---

## Notas de decisão

Em `docs/`, o registro do que foi tentado e por quê:

| | |
| :-- | :-- |
| `ESTADO.md` | onde o trabalho parou, e o que está aberto |
| `FONTE-CUSTOM.md` | o desenho do `SI_FormSpec__c` |
| `FormFieldRule.md` | o objeto de regras da fonte UI API |
| `URLS.md` | as chamadas de cada fonte, uma a uma |
| `RFC-Formularios-Dinamicos.md` | a proposta formal: modelo, contrato, chamadas, riscos |

---

## Estado

É uma prova de conceito. O que ela demonstra funciona de ponta a ponta contra
uma org real, mas há decisões em aberto — modelagem dos objetos de destino,
hospedagem de imagens, e qual das quatro fontes segue adiante. Estão listadas
em `docs/ESTADO.md`.
