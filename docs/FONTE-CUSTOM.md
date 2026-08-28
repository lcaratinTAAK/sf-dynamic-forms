# Fonte custom — `SI_FormSpec__c`

Quarta fonte da POC. As três anteriores leem uma estrutura que o Salesforce
mantém para **outro** propósito: Page Layout existe para a tela interna, Screen
Flow existe para ser executado. Cada uma esbarra num limite diferente por isso.

Aqui a estrutura existe para ser formulário.

## O modelo

Uma tabela, Record Type dizendo o que cada linha é.

| RT | Papel |
| :--- | :--- |
| `Form` | a raiz — objeto e Record Type de destino, canal, Type do Caso |
| `Section` | agrupamento, **com visibilidade própria** e suporte a repetição |
| `Field` | campo, vinculado a um campo do SObject por `FieldApiName__c` |
| `Attachment` | documento exigido, tratado como componente |
| `Rule` | regra de visibilidade, filha do componente que afeta |
| `Content` | bloco de texto estático |

33 campos, todos opcionais no schema de propósito: a tabela é esparsa por
natureza — `Operator__c` só faz sentido no RT `Rule`, `FieldApiName__c` só no
`Field`. Obrigatoriedade é responsabilidade do configurador.

### As duas chaves

`Form__c` aponta da linha para a raiz. **Toda** linha preenche, inclusive
regras e anexos.

`Parent__c` monta a árvore: campo dentro de seção, regra dentro do componente
que ela afeta. Vazio = filho direto da raiz.

Essa redundância é deliberada e é o que responde a pergunta do composite.

## Composite ou Apex REST? Nenhum dos dois

```sql
SELECT ... FROM SI_FormSpec__c
WHERE (Id = :formId OR Form__c = :formId) AND IsActive__c = true
ORDER BY Sort__c NULLS FIRST
```

**A especificação inteira numa SOQL: 27 registros, 27,7 KB, 165 ms.**

Se a hierarquia estivesse em objetos separados (Form → Section → Field → Rule)
isso exigiria várias chamadas, porque SOQL só desce **um** nível de sub-query —
`Form → Sections → Fields` já não cabe. Com `Form__c` plano em todas as linhas,
uma condição resolve, e a árvore é remontada pelo consumidor a partir de
`Parent__c`.

Testado também: as três queries (catálogo + spec + RecordType) cabem num
`composite/batch` — 44 KB, `hasErrors=false`. Só que não é necessário.

## O que continua vindo da UI API, e por quê

`object-info` (517 KB) e `picklist-values` (333 KB). **Label, tipo, tamanho e
ajuda do campo não são guardados na especificação.**

Guardar seria criar uma segunda verdade sobre o campo, que diverge no dia em
que alguém alterar o campo no Setup e não lembrar de atualizar o formulário.
`LabelOverride__c` e `HelpTextOverride__c` existem para quando a pergunta do
formulário precisa ser diferente do label do campo — e só nesse caso.

## Custo comparado

| Fonte | Chamadas | Seções | Seção condicional | Anexo condicional |
| :--- | ---: | ---: | :--- | :--- |
| UI API | 5 | 2 | não expressa | não expressa |
| UI API v2 | 3 | 2 | não expressa | não expressa |
| Screen Flow | 5 | 2 | custaria uma tela | não expressa |
| **Custom** | **4** | **4** | **sim** | **sim** |

As 850 KB de `object-info` + `picklist-values` são as mesmas nas quatro. A
diferença de custo entre elas é ruído; o que muda é o que cada uma consegue
**dizer**.

## O que a fonte custom expressa e as outras não

1. **Visibilidade em seção.** Mostrar ou esconder um bloco inteiro por uma
   condição. No Page Layout não existe; no Screen Flow custaria uma tela nova.
2. **Anexo como componente posicionado.** Vive dentro de uma seção, tem ordem e
   regra de visibilidade própria. Nas outras o anexo é um bloco à parte no topo.
3. **Obrigatoriedade por formulário no mesmo lugar que a estrutura.** É a
   lacuna sem contorno do Screen Flow (campo `ObjectProvided` recusa
   `isRequired` no deploy).
4. **Bloco de conteúdo.** 192 deles nos 53 formulários do Cognito carregam boa
   parte da explicação. Nenhuma das outras fontes tem onde colocar isso.

## Cobertura do Cognito

Levantado dos 53 formulários exportados em `docs/cognito/forms/`.

### Coberto

| Capacidade | Onde |
| :--- | :--- |
| Seções, com aninhamento | RT `Section` + `Parent__c` |
| Visibilidade de campo (782 no Cognito) | RT `Rule` |
| Visibilidade de seção (108) | RT `Rule` com alvo seção |
| Obrigatoriedade estática (1.400) | `IsRequired__c` |
| Obrigatoriedade condicional (64) | RT `Rule` com `Effect__c = REQUIRE` |
| Anexos (203) | RT `Attachment` |
| Blocos de conteúdo HTML (192) | RT `Content` |
| Picklists (475) | UI API `picklist-values` |
| Ajuda e placeholder | `HelpTextOverride__c`, `Placeholder__c` |
| Largura em grade | `Width__c` |
| Múltiplas páginas (1 form usa) | `Page__c` |
| Seção repetível (29 seções) | `IsRepeating__c`, `ItemLabel__c`, `AddButtonText__c` |

### Não coberto — e é decisão, não esquecimento

| Capacidade | Volume no Cognito | Por quê |
| :--- | :--- | :--- |
| Campos calculados | 113, todos ocultos | São regra de negócio e roteamento. Viram record-triggered flow, não definição de formulário. |
| Validação customizada | 23 campos | Mesma razão; e boa parte é validação de formato que o tipo do campo já resolve. |
| Tipos compostos (Name, Address) | 29 campos | O Salesforce modela isso em campos separados. É decisão de modelagem do Case, não do formulário. |
| Multi-select (`String[]`) | 36 campos | Depende de campo multi-picklist no Case. Cabe no modelo, falta o campo. |
| `Entry.Role` / `Entry.Status` | face interna vs. pública | O formulário do Cognito tem duas caras na mesma definição. No Salesforce isso é permissão, não formulário. |
| Lógica booleana aninhada | expressões JS livres | O contrato normalizado suporta AND dentro de grupo e OR entre grupos. Aninhamento arbitrário viraria um interpretador. |

## Como a visibilidade é configurada

O JavaScript que aparece no export do Cognito
(`(Departamento !== null) && (Departamento !== "Visitas&Propostas")`) é a forma
**compilada**. Na tela, o Ops monta linhas de campo / operador / valor com AND
e OR, e só recorre ao editor avançado quando precisa de fórmula.

O modelo aqui segue o padrão que a **FlexiPage** já usa, porque é o que Tools
conhece:

- cada `Rule` é um **filtro numerado** — o número é a `Ordem` (`Sort__c`);
- o **modo** fica no componente alvo, em `FilterLogicType__c`:
  `ALL` (todos verdadeiros), `ANY` (qualquer um) ou `CUSTOM`;
- em `CUSTOM`, `FilterLogic__c` guarda a expressão: `1 AND (2 OR 3)`.

É literalmente o "Show component when: All filters are true / Any filters are
true / The filter logic is met" da FlexiPage.

### O avaliador da expressão

Parser próprio, recursivo — **não `eval` nem `new Function`**. A expressão vem
de um registro que Ops edita; executá-la como código seria injeção.

Só existem número, `AND`, `OR`, `NOT` e parênteses, com `AND` tendo
precedência sobre `OR`. Qualquer outro caractere invalida a expressão em vez
de ser descartado — senão `1; DROP TABLE` viraria `1` em silêncio, e um erro
de digitação mudaria o sentido da regra sem ninguém perceber.

Expressão inválida deixa o componente **visível**. Esconder um campo por erro
de configuração é pior do que mostrá-lo: o dado sumiria do formulário sem
sinal nenhum.

18 casos cobertos, incluindo precedência, parênteses aninhados e tentativas de
injeção.

### O que o modelo não tenta fazer

O editor avançado do Cognito aceita fórmula livre. Aqui não — expressão é só
lógica booleana sobre filtros. Fórmula de verdade (aritmética, datas,
`indexOf` em multi-select) exigiria um interpretador, e é justamente o que
impediria um configurador visual. Se algum formulário precisar, a saída é
campo fórmula no Salesforce alimentando um filtro comum.

## Estado

Objeto e permission sets deployados em `benvi2-scratch-org`. Um formulário
semeado: **Alteração de dados bancários**, o mesmo já reproduzido nas fontes UI
API e Screen Flow, para a comparação ser sobre arquitetura e não sobre
formulários diferentes.

```bash
sf apex run -o benvi2-scratch-org -f scripts/demo/si-forms/seed-formspec.apex
```

Verificação: `node --env-file=.env scripts/peek-formspec.mjs` (a SOQL única e a
árvore remontada) e `node scripts/peek-formspec-payload.mjs` (seção oculta
saindo do payload e da validação).
