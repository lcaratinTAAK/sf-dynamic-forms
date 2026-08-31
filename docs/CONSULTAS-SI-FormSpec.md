# Consultas para o Query Editor — `SI_FormSpec__c`

Uma consulta por Record Type, com os campos que fazem sentido para cada um. O
objeto tem 43 campos e cada papel usa uma fatia diferente; `SELECT *` não
existe em SOQL, e trazer os 43 em todo lugar torna o resultado ilegível.

Todas foram rodadas contra a scratch antes de irem para cá.

> **Para focar num formulário só**, acrescente ao `WHERE` de qualquer uma:
>
> ```
> AND Form__c = 'a0x8800000837LJAAY'
> ```
>
> A raiz é a única exceção — ela tem `Form__c` vazio; nela use `AND Id = '...'`.

---

## Catálogo — quais formulários existem

O que a aplicação lê para montar o seletor.

```sql
SELECT Id, Name, PublicLabel__c, ObjectApiName__c, TargetRecordTypeDevName__c,
       CaseType__c, Channel__c, Description__c, IsActive__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Form' AND IsActive__c = true
ORDER BY Name
```

---

## `Form` — a raiz

Uma linha por formulário. É ela que amarra o formulário ao objeto, ao Record
Type de destino e ao `Type` do Caso.

```sql
SELECT Id, Name, PublicLabel__c, Description__c, ObjectApiName__c,
       TargetRecordTypeDevName__c, CaseType__c, Channel__c, IsActive__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Form'
ORDER BY Name
```

`TargetRecordTypeDevName__c` guarda o **DeveloperName**, não o Id — Id de
Record Type muda entre orgs.

---

## `Section` — agrupamento

```sql
SELECT Id, Name, Sort__c, Page__c, Parent__c, Form__r.Name,
       FilterLogicType__c, FilterLogic__c, IsActive__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Section'
ORDER BY Form__r.Name, Sort__c
```

`FilterLogicType__c` e `FilterLogic__c` são o **modo** da visibilidade. As
condições em si são linhas `Rule` filhas — o modo mora no alvo, as condições
moram nas regras.

---

## `RepeatingSection` — listas repetíveis

```sql
SELECT Id, Name, Sort__c, Form__r.Name,
       ChildObjectApiName__c, ChildRelationshipField__c,
       ItemLabel__c, AddButtonText__c, MinItems__c, MaxItems__c,
       FilterLogicType__c, FilterLogic__c, IsActive__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'RepeatingSection'
ORDER BY Form__r.Name, Sort__c
```

`ChildObjectApiName__c` + `ChildRelationshipField__c` são o par que vira
`@{refPai.id}` no composite de envio. Sem os dois a lista é ignorada.

---

## `Field` — campos

```sql
SELECT Id, Name, Sort__c, Form__r.Name,
       Parent__r.Name, Parent__r.RecordType.DeveloperName,
       FieldApiName__c, LabelOverride__c, HelpTextOverride__c, Placeholder__c,
       DefaultValue__c, Width__c, IsRequired__c, IsReadOnly__c, IsHidden__c,
       FilterLogicType__c, FilterLogic__c, RequiredLogicType__c,
       ValidationLogicType__c, Message__c, IsActive__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Field'
ORDER BY Form__r.Name, Parent__r.Sort__c, Sort__c
```

`Parent__r.RecordType.DeveloperName` diz se o campo está numa `Section` ou
dentro de uma `RepeatingSection` — e isso muda **em qual objeto ele grava**.

Os três `*LogicType__c` são os modos dos três grupos de regra: visibilidade,
obrigatoriedade e validação. `Message__c` só é lido quando há regra `BLOCK`.

---

## `Attachment` — documentos exigidos

```sql
SELECT Id, Name, Sort__c, Form__r.Name, Parent__r.Name,
       DocumentCode__c, AcceptedTypes__c, MinFiles__c, MaxFiles__c, MaxSizeMb__c,
       IsRequired__c, Width__c, FilterLogicType__c, FilterLogic__c, IsActive__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Attachment'
ORDER BY Form__r.Name, Sort__c
```

---

## `Content` — blocos de texto

```sql
SELECT Id, Name, Sort__c, Form__r.Name, Parent__r.Name,
       Body__c, Width__c, FilterLogicType__c, FilterLogic__c, IsActive__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Content'
ORDER BY Form__r.Name, Sort__c
```

`Name` é o nome interno, para a operação achar o bloco. O que o cliente lê é o
`Body__c`.

---

## `Rule` — condições, com o alvo resolvido

A consulta mais útil das sete: sem o `Parent__r`, uma regra é uma linha solta
que não diz o que afeta.

```sql
SELECT Id, Name, Sort__c, Effect__c,
       ConditionFieldApiName__c, Operator__c, Value__c, ValueSource__c,
       Parent__r.Name, Parent__r.RecordType.DeveloperName, Parent__r.FieldApiName__c,
       Parent__r.FilterLogicType__c, Parent__r.RequiredLogicType__c,
       Parent__r.ValidationLogicType__c, Parent__r.Message__c,
       Form__r.Name, IsActive__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Rule'
ORDER BY Form__r.Name, Parent__r.Name, Sort__c
```

Leitura: **`Effect__c` decide para qual grupo a regra vai** — `SHOW` para
visibilidade, `REQUIRE` para obrigatoriedade condicional, `BLOCK` para
validação. O modo (`ALL`/`ANY`/`CUSTOM`) está na coluna correspondente do
alvo, e `Sort__c` é o número que a expressão `CUSTOM` referencia.

---

## A árvore inteira de um formulário, na ordem

Uma linha por componente, achatada. É o resultado de uma consulta só — a
mesma que a aplicação faz.

```sql
SELECT RecordType.DeveloperName, Sort__c, Name, Parent__r.Name,
       FieldApiName__c, Width__c, IsRequired__c, IsHidden__c,
       Effect__c, ConditionFieldApiName__c, Operator__c, Value__c, ValueSource__c,
       DocumentCode__c, ChildObjectApiName__c, ChildRelationshipField__c
FROM SI_FormSpec__c
WHERE (Id = 'a0x8800000837LJAAY' OR Form__c = 'a0x8800000837LJAAY')
ORDER BY Parent__r.Sort__c NULLS FIRST, Sort__c, Name
```

`Id = :formId OR Form__c = :formId` é o que dispensa composite: toda linha
aponta para a raiz, então uma condição plana traz a árvore completa.

---

# Verificações

## Contagem por Record Type

```sql
SELECT RecordType.DeveloperName tipo, COUNT(Id) quantos
FROM SI_FormSpec__c
GROUP BY RecordType.DeveloperName
ORDER BY COUNT(Id) DESC
```

## Regras por efeito

```sql
SELECT Effect__c, COUNT(Id) quantas
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Rule'
GROUP BY Effect__c
ORDER BY COUNT(Id) DESC
```

## Regra órfã — não afeta nada

Regra sem `Parent__c` é ignorada em silêncio pelo adaptador.

```sql
SELECT Id, Name, Effect__c, Form__r.Name
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Rule' AND Parent__c = null
```

## Lista sem objeto ou sem campo de vínculo

Cai fora do contrato com aviso — o formulário serve sem a lista.

```sql
SELECT Id, Name, ChildObjectApiName__c, ChildRelationshipField__c, Form__r.Name
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'RepeatingSection'
  AND (ChildObjectApiName__c = null OR ChildRelationshipField__c = null)
```

## Validação sem mensagem

Regra `BLOCK` sem mensagem é descartada — bloquearia o envio sem dizer por quê.

```sql
SELECT Parent__r.FieldApiName__c, Parent__r.Message__c,
       Name, Operator__c, Value__c, ValueSource__c
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Rule' AND Effect__c = 'BLOCK'
ORDER BY Parent__r.FieldApiName__c, Sort__c
```

> Não dá para filtrar por `Parent__r.Message__c = null`: `Message__c` é
> **LongTextArea**, e o Salesforce recusa esses campos em `WHERE`, `ORDER BY` e
> `GROUP BY` (`INVALID_FIELD: field can not be filtered`). A saída é trazer a
> coluna e procurar as células vazias no olho.

## Lógica CUSTOM sem expressão

Cai para `ALL`, com aviso.

```sql
SELECT Id, Name, RecordType.DeveloperName, FilterLogicType__c, FilterLogic__c, Form__r.Name
FROM SI_FormSpec__c
WHERE FilterLogicType__c = 'CUSTOM' AND FilterLogic__c = null
```

## Campo apontando para API name que não existe

São **duas** consultas: semi-join em SOQL só aceita campos Id
(`MALFORMED_QUERY: semi join sub selects can only query id fields`), então não
dá para cruzar `FieldApiName__c` com `EntityParticle.QualifiedApiName` numa só.

**1.** Os nomes que a especificação usa:

```sql
SELECT FieldApiName__c, COUNT(Id) usos
FROM SI_FormSpec__c
WHERE RecordType.DeveloperName = 'Field' AND FieldApiName__c != null
GROUP BY FieldApiName__c
ORDER BY FieldApiName__c
```

**2.** Cole a lista aqui — o que **não voltar** é o que não existe ou está
invisível para você por FLS:

```sql
SELECT QualifiedApiName, Label, DataType, IsCreatable
FROM EntityParticle
WHERE EntityDefinition.QualifiedApiName = 'Case'
  AND QualifiedApiName IN ('SI_BankType__c','SI_RequesterType__c')
ORDER BY QualifiedApiName
```

> `IsCreatable` é avaliado **para você**. Um campo que existe em Setup mas não
> aparece aqui é FLS — e é exatamente isso que faz a REST responder
> `No such column` numa consulta que o cita. A mensagem não menciona permissão
> em momento nenhum.

---

## Campos do objeto, para referência

| grupo | campos |
| :-- | :-- |
| estrutura | `Form__c`, `Parent__c`, `Sort__c`, `Page__c`, `Width__c`, `IsActive__c` |
| raiz | `PublicLabel__c`, `Description__c`, `ObjectApiName__c`, `TargetRecordTypeDevName__c`, `CaseType__c`, `Channel__c` |
| campo | `FieldApiName__c`, `LabelOverride__c`, `HelpTextOverride__c`, `Placeholder__c`, `DefaultValue__c`, `IsRequired__c`, `IsReadOnly__c`, `IsHidden__c` |
| anexo | `DocumentCode__c`, `AcceptedTypes__c`, `MinFiles__c`, `MaxFiles__c`, `MaxSizeMb__c` |
| conteúdo | `Body__c` |
| lista | `IsRepeating__c`, `ChildObjectApiName__c`, `ChildRelationshipField__c`, `ItemLabel__c`, `AddButtonText__c`, `MinItems__c`, `MaxItems__c` |
| regra | `ConditionFieldApiName__c`, `Operator__c`, `Value__c`, `ValueSource__c`, `Effect__c` |
| modo das regras | `FilterLogicType__c`, `FilterLogic__c`, `RequiredLogicType__c`, `ValidationLogicType__c`, `Message__c` |

**Não filtráveis** (LongTextArea): `Message__c`, `Body__c`, `Description__c`.
Podem ser selecionados, nunca usados em `WHERE`, `ORDER BY` ou `GROUP BY`.
